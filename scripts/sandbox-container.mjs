// Experimental Linux-only execution boundary. Callers pass trusted command arrays;
// source code and public stdin are data, never shell command fragments.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const MiB = 1024 * 1024;
const IMAGE = /^sha256:[0-9a-f]{64}$/;
const STOP_REASONS = new Set(['', 'timeout', 'output_limit', 'cancelled', 'launch_error']);
const MAX_INPUT_BYTES = 64 * 1024;

function boundedInteger(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${name}.`);
  return value;
}
function commandArguments(command) {
  if (!Array.isArray(command) || !command.length || command.length > 64 ||
      command.some(part => typeof part !== 'string' || !part || part.includes('\0') || Buffer.byteLength(part) > 65536))
    throw new Error('A bounded, nonempty trusted command array is required.');
  return [...command];
}
function brief(value) { return String(value ?? '').slice(0, 1024); }
function processResult(result) {
  if (!result || (result.code !== null && !Number.isInteger(result.code)) || !STOP_REASONS.has(result.reason) ||
      !Buffer.isBuffer(result.stdout) || !Buffer.isBuffer(result.stderr)) throw new Error('Invalid Docker executor result.');
  return result;
}
function succeeded(result) { return result.code === 0 && !result.reason; }
function failure(operation, result) {
  return new Error(`${operation} failed (${result.reason || (result.code ?? 'unknown')}): ${brief(result.stderr.toString('utf8'))}`);
}
function dockerEnvironment() {
  const env = {...process.env};
  for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'DOCKER_TLS']) delete env[key];
  return env;
}

// Exported for tests of actual pipe bounds and cancellation without requiring Docker.
// onStop must first remove the named container. Killing a Docker client alone does
// not terminate the daemon-managed process, so this callback is awaited before kill.
export async function runSandboxProcess(executable, args, {
  stdin = Buffer.alloc(0), timeoutMs = 10000, maxBytes = MiB, signal, onStop, env = process.env, leaseFd
} = {}) {
  boundedInteger(timeoutMs, 'timeout', 300000);
  boundedInteger(maxBytes, 'output bound', 64 * MiB);
  if (!Buffer.isBuffer(stdin) || stdin.length > MAX_INPUT_BYTES) throw new Error('stdin must be a Buffer of at most 64 KiB.');
  if (leaseFd !== undefined && (!Number.isInteger(leaseFd) || leaseFd < 3)) throw new Error('Invalid execution lease descriptor.');
  if (signal?.aborted) {
    let cleanupDetail = '';
    try { await onStop?.('cancelled'); } catch (error) { cleanupDetail = brief(error.message); }
    return {code:null, reason:'cancelled', stdout:Buffer.alloc(0), stderr:Buffer.alloc(0), cleanupDetail};
  }
  return new Promise(resolveResult => {
    let child;
    // Keep the workspace flock alive until an in-flight Docker client settles,
    // even if its Node parent is killed while the daemon is creating a container.
    try { child = spawn(executable, args, {shell:false, windowsHide:true, env,
      stdio:leaseFd === undefined ? ['pipe','pipe','pipe'] : ['pipe','pipe','pipe',leaseFd]}); }
    catch (error) {
      let cleanupDetail = '';
      Promise.resolve().then(() => onStop?.('launch_error')).catch(cleanup => { cleanupDetail = brief(cleanup.message); }).finally(() =>
        resolveResult({code:null, reason:'launch_error', stdout:Buffer.alloc(0), stderr:Buffer.from(brief(error.message)), cleanupDetail}));
      return;
    }
    const stdout = [], stderr = [];
    let retained = 0, reason = '', exited = false, closed = false, stopPromise, cleanupDetail = '';
    const stop = why => {
      if (reason || (exited && why !== 'output_limit')) return stopPromise;
      reason = why;
      clearTimeout(timer);
      stopPromise = Promise.resolve().then(() => onStop?.(why)).catch(error => {
        cleanupDetail = brief(error.message);
      }).finally(() => { if (!closed) child.kill('SIGKILL'); });
      return stopPromise;
    };
    const timer = setTimeout(() => { void stop('timeout'); }, timeoutMs);
    const abort = () => { void stop('cancelled'); };
    signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) abort();
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) {
      stream.on('data', chunk => {
        const available = Math.max(0, maxBytes - retained);
        if (available) {
          const prefix = chunk.subarray(0, available);
          chunks.push(Buffer.from(prefix)); retained += prefix.length;
        }
        if (chunk.length > available) void stop('output_limit');
      });
    }
    child.on('error', error => {
      // A spawn error is not a source compilation failure.
      if (!reason) {
        reason = 'launch_error';
        stopPromise = Promise.resolve().then(() => onStop?.('launch_error')).catch(cleanup => {
          cleanupDetail = brief(cleanup.message);
        });
      }
      const remaining = Math.max(0, maxBytes - retained);
      const message = Buffer.from(brief(error.message)).subarray(0, remaining);
      stderr.push(message); retained += message.length;
    });
    child.on('exit', () => { exited = true; });
    child.on('close', async (code, exitSignal) => {
      closed = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      await stopPromise;
      resolveResult({code, reason, stdout:Buffer.concat(stdout), stderr:Buffer.concat(stderr), signal:exitSignal, cleanupDetail});
    });
    // Early program exit may close stdin without consuming all public input.
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}

function nonempty(value) { return Array.isArray(value) ? value.length > 0 : value && Object.keys(value).length > 0; }
function oneOf(actual, expected) { return Array.isArray(actual) && actual.length === 1 && expected.includes(actual[0]); }

export class SandboxContainer {
  constructor({image, phase, mounts = [], docker = 'docker', dockerHost = 'unix:///var/run/docker.sock', executor = runSandboxProcess, owner, leaseFd} = {}) {
    if (!IMAGE.test(image)) throw new Error('Use an immutable sha256 image ID, never a tag.');
    if (!['compile', 'run'].includes(phase)) throw new Error('Unknown sandbox phase.');
    if (typeof docker !== 'string' || !docker || docker.includes('\0')) throw new Error('Invalid Docker executable.');
    if (typeof dockerHost !== 'string' || !/^unix:\/\/\/[^\s\0,]+$/.test(dockerHost) || dockerHost.slice(7).split('/').includes('..'))
      throw new Error('Docker must use an explicit absolute local Unix socket.');
    if (typeof executor !== 'function') throw new Error('Invalid Docker executor.');
    if (owner !== undefined && (!owner || Object.keys(owner).sort().join(',') !== 'operationId,workspaceId'
      || !/^[a-f0-9]{64}$/.test(owner.workspaceId) || !/^[a-f0-9]{32}$/.test(owner.operationId))) throw new Error('Invalid sandbox ownership.');
    if (leaseFd !== undefined && (!Number.isInteger(leaseFd) || leaseFd < 3)) throw new Error('Invalid execution lease descriptor.');
    if (!Array.isArray(mounts) || mounts.length > 1) throw new Error('At most one input file may be mounted.');
    const destination = phase === 'compile' ? '/input/input.cj' : '/input/program';
    this.mounts = mounts.map(mount => {
      if (!mount || Object.keys(mount).sort().join(',') !== 'source,target' || mount.target !== destination ||
          typeof mount.source !== 'string' || !isAbsolute(mount.source) || /[,\r\n\0]/.test(mount.source))
        throw new Error('Only an absolute input file and the fixed phase destination may be mounted.');
      return Object.freeze({source:resolve(mount.source), target:mount.target});
    });
    Object.freeze(this.mounts);
    this.name = `doctor-${randomBytes(16).toString('hex')}`;
    this.image = image; this.phase = phase; this.docker = docker; this.dockerHost = dockerHost; this.executor = executor;
    this.owner = owner ? Object.freeze({...owner}) : null; this.leaseFd = leaseFd;
    this.created = false; this.removed = false; this.cleanupDetail = '';
    const memoryBytes = (phase === 'compile' ? 1024 : 512) * MiB;
    const tmpfs = Object.freeze({
      '/work':`rw,exec,nosuid,nodev,size=${phase === 'compile' ? 128 : 16}m,uid=65534,gid=65534,mode=0700`,
      '/tmp':'rw,noexec,nosuid,nodev,size=32m,uid=65534,gid=65534,mode=0700'
    });
    const flags = [
      '--name', this.name, '--label', 'org.cangjie.doctor.sandbox=experimental-v1', '--pull', 'never',
      '--interactive', '--user', '65534:65534', '--network', 'none', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--read-only', '--memory', String(memoryBytes),
      '--memory-swap', String(memoryBytes), '--pids-limit', '128', '--cpus', '1', '--shm-size', '16m',
      '--ipc', 'private', '--cgroupns', 'private', '--log-driver', 'none', '--workdir', '/work',
      '--tmpfs', `/work:${tmpfs['/work']}`, '--tmpfs', `/tmp:${tmpfs['/tmp']}`,
      '--ulimit', 'core=0:0', '--ulimit', 'nofile=128:128', '--ulimit', `fsize=${64 * MiB}:${64 * MiB}`
    ];
    if (this.owner) flags.push('--label', `org.cangjie.doctor.workspace=${this.owner.workspaceId}`,
      '--label', `org.cangjie.doctor.operation=${this.owner.operationId}`);
    for (const mount of this.mounts) flags.push('--mount', `type=bind,source=${mount.source},target=${mount.target},readonly,bind-propagation=rprivate`);
    this.policy = Object.freeze({version:'doctor-linux-isolation-v1', phase, image, dockerHost, user:'65534:65534',
      memoryBytes, memorySwapBytes:memoryBytes, pids:128, nanoCpus:1e9, shmBytes:16 * MiB,
      maxFileBytes:64 * MiB, tmpfs, mounts:this.mounts, flags:Object.freeze(flags)});
  }

  async validateMounts() {
    for (const mount of this.mounts) {
      const stat = await lstat(mount.source);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > (this.phase === 'compile' ? 64 * 1024 : 32 * MiB))
        throw new Error('Mounted input must be a bounded regular file, not a symlink or directory.');
      const canonical = await realpath(mount.source);
      const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
      if (normalize(canonical) !== normalize(mount.source)) throw new Error('Input paths may not traverse symbolic links.');
      if (this.mountIdentity && this.mountIdentity.some(item => item.source === mount.source &&
        (item.dev !== stat.dev || item.ino !== stat.ino || item.size !== stat.size || item.mtimeMs !== stat.mtimeMs)))
        throw new Error('Mounted input changed after container creation.');
      this.mountIdentity = [{source:mount.source, dev:stat.dev, ino:stat.ino, size:stat.size, mtimeMs:stat.mtimeMs}];
    }
  }

  async execute(args, options = {}) {
    return processResult(await this.executor(this.docker, ['--host', this.dockerHost, ...args],
      {...options, env:dockerEnvironment(), leaseFd:this.leaseFd}));
  }

  async captureLastInspection() {
    try {
      const result = await this.execute(['container', 'inspect', this.name], {timeoutMs:3000, maxBytes:256 * 1024});
      if (!succeeded(result)) throw failure('Pre-cleanup inspect', result);
      const objects = JSON.parse(result.stdout.toString('utf8'));
      if (!Array.isArray(objects) || objects.length !== 1 || objects[0]?.Name !== `/${this.name}`) throw new Error('Unexpected inspection identity.');
      this.lastInspection = objects[0];
    } catch (error) { this.lastInspectionDetail = brief(error.message); }
  }

  async invoke(args, options = {}) {
    const result = await this.execute(args, {...options,
      onStop:async () => {
        await this.captureLastInspection();
        const cleanup = await this.remove();
        if (!cleanup.removed) throw new Error(cleanup.detail);
      }});
    // A timed-out create may race with the first rm request. Check again after the
    // CLI has settled so a late daemon-side creation does not become an orphan.
    if (result.reason) {
      this.removed = false;
      const cleanup = await this.remove();
      if (!cleanup.removed) result.cleanupDetail = cleanup.detail;
      if (this.lastInspection) result.lastInspection = this.lastInspection;
      if (this.lastInspectionDetail) result.lastInspectionDetail = this.lastInspectionDetail;
    }
    if (result.cleanupDetail) this.cleanupDetail = result.cleanupDetail;
    return result;
  }

  async create(commandArray) {
    if (this.created || this.createAttempted) throw new Error('A sandbox container is single-use.');
    const command = commandArguments(commandArray);
    await this.validateMounts();
    this.createAttempted = true;
    const result = await this.invoke(['create', ...this.policy.flags, this.image, ...command], {timeoutMs:15000, maxBytes:64 * 1024});
    if (!succeeded(result)) { await this.remove(); throw failure('Docker create', result); }
    this.created = true; this.removed = false;
    try {
      const actual = await this.inspect();
      this.verifyPolicy(actual, command);
      this.command = command;
      return actual;
    } catch (error) {
      const cleanup = await this.remove();
      if (!cleanup.removed) error.message += `; cleanup failed: ${cleanup.detail}`;
      throw error;
    }
  }

  verifyPolicy(actual, command = this.command) {
    const h = actual?.HostConfig, c = actual?.Config, p = this.policy;
    const reject = why => { throw new Error(`Docker isolation policy mismatch: ${why}.`); };
    if (!h || !c || actual.Name !== `/${this.name}` || actual.Image !== this.image || c.Image !== this.image ||
        c.User !== p.user || c.WorkingDir !== '/work' || c.Tty !== false || c.OpenStdin !== true ||
        JSON.stringify(c.Cmd) !== JSON.stringify(command)) reject('identity or process configuration');
    if (this.owner && (c.Labels?.['org.cangjie.doctor.sandbox'] !== 'experimental-v1'
      || c.Labels?.['org.cangjie.doctor.workspace'] !== this.owner.workspaceId
      || c.Labels?.['org.cangjie.doctor.operation'] !== this.owner.operationId
      || !/^[a-f0-9]{64}$/.test(actual.Id) || (this.containerId && actual.Id !== this.containerId))) reject('workspace ownership');
    if (h.NetworkMode !== 'none' || h.Privileged !== false || h.ReadonlyRootfs !== true ||
        h.IpcMode !== 'private' || h.CgroupnsMode !== 'private' || (h.PidMode ?? '') !== '' ||
        (h.UTSMode ?? '') !== '' || h.PublishAllPorts || nonempty(h.PortBindings) ||
        nonempty(h.CapAdd) || !oneOf(h.CapDrop, ['ALL']) ||
        !oneOf(h.SecurityOpt, ['no-new-privileges', 'no-new-privileges=true', 'no-new-privileges:true']) ||
        nonempty(h.Devices) || nonempty(h.DeviceRequests) || nonempty(h.VolumesFrom)) reject('namespace, permission or network restrictions');
    if (h.Memory !== p.memoryBytes || h.MemorySwap !== p.memorySwapBytes || h.NanoCpus !== p.nanoCpus ||
        h.PidsLimit !== p.pids || h.ShmSize !== p.shmBytes || h.LogConfig?.Type !== 'none' ||
        h.RestartPolicy?.Name !== 'no' || h.AutoRemove) reject('resource or lifecycle restrictions');
    const actualTmpfs = h.Tmpfs || {};
    if (Object.keys(actualTmpfs).sort().join(',') !== '/tmp,/work' ||
        Object.entries(p.tmpfs).some(([path, options]) => actualTmpfs[path] !== options)) reject('bounded writable filesystems');
    const expectedUlimits = {core:0, nofile:128, fsize:p.maxFileBytes};
    if (!Array.isArray(h.Ulimits) || h.Ulimits.length !== 3 || new Set(h.Ulimits.map(limit => limit.Name)).size !== 3 ||
        h.Ulimits.some(limit => !(limit.Name in expectedUlimits) || limit.Soft !== expectedUlimits[limit.Name] ||
          limit.Hard !== expectedUlimits[limit.Name])) reject('ulimits');
    const bindings = (actual.Mounts || []).filter(mount => mount.Type === 'bind');
    if (!Array.isArray(actual.Mounts) || bindings.length !== this.mounts.length || nonempty(h.Binds) ||
        actual.Mounts.some(mount => mount.Type !== 'bind' && !(mount.Type === 'tmpfs' && mount.Destination in p.tmpfs)))
      reject('unexpected host mounts');
    for (const input of this.mounts) {
      const bound = bindings.find(mount => mount.Destination === input.target);
      if (!bound || bound.Source !== input.source || bound.RW !== false || bound.Propagation !== 'rprivate') reject('input mount access');
    }
    if (this.owner) this.containerId = actual.Id;
    return true;
  }

  async start({stdin = Buffer.alloc(0), timeoutMs = 5000, maxBytes = 64 * 1024, detached = false, signal} = {}) {
    if (!this.created || this.removed || this.started) throw new Error('Create a fresh verified container before starting.');
    if (!Buffer.isBuffer(stdin) || stdin.length > MAX_INPUT_BYTES) throw new Error('stdin must be a Buffer of at most 64 KiB.');
    if (detached && stdin.length) throw new Error('Detached holders do not accept stdin.');
    boundedInteger(timeoutMs, 'timeout', 300000); boundedInteger(maxBytes, 'output bound', 64 * MiB);
    await this.validateMounts();
    // Inspect again immediately before starting: local daemon mutations cannot
    // silently replace the profile that was checked at creation.
    this.verifyPolicy(await this.inspect());
    this.started = true;
    return this.invoke(['start', ...(detached ? [] : ['--attach', '--interactive']), this.name],
      {stdin, timeoutMs, maxBytes, signal});
  }

  async exec(commandArray, {timeoutMs = 60000, maxBytes = MiB, signal} = {}) {
    if (!this.created || this.removed || !this.started) throw new Error('Start a verified container before exec.');
    boundedInteger(timeoutMs, 'timeout', 300000); boundedInteger(maxBytes, 'output bound', 64 * MiB);
    return this.invoke(['exec', this.name, ...commandArguments(commandArray)], {timeoutMs, maxBytes, signal});
  }

  async inspect() {
    const result = await this.invoke(['container', 'inspect', this.name], {timeoutMs:10000, maxBytes:256 * 1024});
    if (!succeeded(result)) throw failure('Docker inspect', result);
    let objects;
    try { objects = JSON.parse(result.stdout.toString('utf8')); } catch { throw new Error('Docker inspect returned invalid JSON.'); }
    if (!Array.isArray(objects) || objects.length !== 1 || objects[0]?.Name !== `/${this.name}`)
      throw new Error('Docker inspect returned a different container.');
    return objects[0];
  }

  async remove() {
    if (this.removed) return {removed:true, detail:'Container absence already verified.'};
    if (this.removing) return this.removing;
    this.removing = (async () => {
      try {
        let identifier = this.name;
        const absent = (result, target) => !result.reason && result.code === 1
          && result.stdout.toString('utf8').trim() === '[]'
          && [`Error: No such container: ${target}`, `Error: No such object: ${target}`,
            `Error response from daemon: No such container: ${target}`, `Error response from daemon: No such object: ${target}`]
            .includes(result.stderr.toString('utf8').trim());
        if (this.owner) {
          const initial = await this.execute(['container', 'inspect', this.name], {timeoutMs:10000, maxBytes:256 * 1024});
          if (absent(initial, this.name)) {
            const knownId = this.containerId || this.lastInspection?.Id;
            if (knownId) {
              const known = await this.execute(['container','inspect',knownId], {timeoutMs:10000, maxBytes:256 * 1024});
              if (!absent(known,knownId)) throw new Error('Registered name is absent but its known container ID is not confirmed absent; no deletion performed.');
            }
            this.removed = true; this.created = false;
            return {removed:true, detail:'Registered container absence verified.'};
          }
          if (!succeeded(initial)) throw failure('Cleanup inspect', initial);
          const values = JSON.parse(initial.stdout.toString('utf8')), actual = values?.[0], labels = actual?.Config?.Labels;
          if (!Array.isArray(values) || values.length !== 1 || actual.Name !== `/${this.name}`
            || !/^[a-f0-9]{64}$/.test(actual.Id) || (this.containerId && this.containerId !== actual.Id)
            || actual.Image !== this.image || actual.Config?.Image !== this.image
            || labels?.['org.cangjie.doctor.sandbox'] !== 'experimental-v1'
            || labels?.['org.cangjie.doctor.workspace'] !== this.owner.workspaceId
            || labels?.['org.cangjie.doctor.operation'] !== this.owner.operationId)
            throw new Error('Container ownership changed; no deletion performed.');
          identifier = actual.Id; this.lastInspection = actual;
        }
        const result = await this.execute(['rm', '--force', '--volumes', identifier], {timeoutMs:10000, maxBytes:64 * 1024});
        // A successful rm is followed by an absence check; an absent container is
        // also safe after launch failure or an earlier cancellation cleanup.
        const check = await this.execute(['container', 'inspect', this.name], {timeoutMs:10000, maxBytes:64 * 1024});
        const idCheck = this.owner ? await this.execute(['container','inspect',identifier], {timeoutMs:10000, maxBytes:64 * 1024}) : check;
        if (this.owner ? absent(check,this.name) && absent(idCheck,identifier)
          : !check.reason && check.code !== 0 && /no such (?:container|object)/i.test(check.stderr.toString('utf8'))) {
          this.removed = true; this.created = false;
          return {removed:true, detail:'Container absence verified.'};
        }
        this.cleanupDetail = `Cannot verify container removal (${result.reason || result.code}; ${check.reason || check.code}): ${brief(check.stderr.toString('utf8'))}`;
      } catch (error) { this.cleanupDetail = `Container cleanup failed: ${brief(error.message)}`; }
      return {removed:false, detail:this.cleanupDetail};
    })();
    try { return await this.removing; } finally { this.removing = null; }
  }
}
