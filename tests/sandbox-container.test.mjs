import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { SandboxContainer, runSandboxProcess } from '../scripts/sandbox-container.mjs';

const MiB = 1024 * 1024;
const image = `sha256:${'a'.repeat(64)}`;
const output = (code = 0, stdout = '', stderr = '', reason = '') => ({code, reason,
  stdout:Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout), stderr:Buffer.from(stderr)});

async function temporary(t) {
  const parent = resolve('runs'); await mkdir(parent, {recursive:true});
  const root = await mkdtemp(join(parent, 'sandbox-container-test-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(parent + sep));
    await rm(root, {recursive:true, force:true});
  });
  return root;
}

function inspected(container, command) {
  return {
    Name:`/${container.name}`, Image:image,
    Config:{Image:image, User:'65534:65534', WorkingDir:'/work', Tty:false, OpenStdin:true, Cmd:command},
    HostConfig:{NetworkMode:'none', Privileged:false, ReadonlyRootfs:true, IpcMode:'private', CgroupnsMode:'private',
      PidMode:'', UTSMode:'', PublishAllPorts:false, PortBindings:{}, CapAdd:null, CapDrop:['ALL'],
      SecurityOpt:['no-new-privileges'], Devices:[], DeviceRequests:null, VolumesFrom:null,
      Memory:container.phase === 'compile' ? 1073741824 : 536870912,
      MemorySwap:container.phase === 'compile' ? 1073741824 : 536870912,
      NanoCpus:1000000000, PidsLimit:128, ShmSize:16777216, LogConfig:{Type:'none'}, RestartPolicy:{Name:'no'}, AutoRemove:false,
      Tmpfs:{'/work':`rw,exec,nosuid,nodev,size=${container.phase === 'compile' ? 128 : 16}m,uid=65534,gid=65534,mode=0700`,
        '/tmp':'rw,noexec,nosuid,nodev,size=32m,uid=65534,gid=65534,mode=0700'},
      Ulimits:[{Name:'core', Soft:0, Hard:0}, {Name:'nofile', Soft:128, Hard:128}, {Name:'fsize', Soft:67108864, Hard:67108864}],
      Binds:null},
    Mounts:container.mounts.map(mount => ({Type:'bind', Source:mount.source, Destination:mount.target, RW:false, Propagation:'rprivate'})),
    State:{Running:false, OOMKilled:false, ExitCode:0}
  };
}

function daemon({phase = 'compile', mounts = [], mutate, respond, failCleanup = false, dockerHost} = {}) {
  let container, exists = false, actual;
  const calls = [];
  const executor = async (executable, allArgs, options) => {
    assert.equal(executable, 'docker');
    assert.equal(allArgs[0], '--host');
    assert.equal(allArgs[1], dockerHost || 'unix:///var/run/docker.sock');
    const args = allArgs.slice(2);
    calls.push({args, options});
    const custom = await respond?.({args, options, container, actual});
    if (custom) return custom;
    if (args[0] === 'create') {
      exists = true; actual = inspected(container, args.slice(args.indexOf(image) + 1)); mutate?.(actual);
      return output(0, `${'b'.repeat(64)}\n`);
    }
    if (args[0] === 'container' && args[1] === 'inspect') return exists ? output(0, JSON.stringify([actual])) : output(1, '[]', `Error: No such container: ${container.name}`);
    if (args[0] === 'start') { actual.State.Running = !args.includes('--attach'); return output(0, args.includes('--attach') ? '' : container.name); }
    if (args[0] === 'exec') return output();
    if (args[0] === 'rm') {
      if (failCleanup) return output(1, '', 'daemon refused removal');
      exists = false; return output(0, container.name);
    }
    throw new Error(`Unexpected Docker command: ${args[0]}`);
  };
  container = new SandboxContainer({image, phase, mounts, executor, ...(dockerHost ? {dockerHost} : {})});
  return {container, calls, actual:() => actual, exists:() => exists};
}

test('sandbox requires immutable images, a local socket and one phase-specific input', () => {
  for (const candidate of ['ubuntu:22.04', 'latest', 'sha256:' + 'A'.repeat(64), '--privileged', 'a'.repeat(64)])
    assert.throws(() => new SandboxContainer({image:candidate, phase:'run'}), /image ID/);
  for (const dockerHost of ['tcp://remote:2375', 'ssh://user@host', 'unix://relative', 'unix:///tmp/../socket', 'unix:///tmp/socket\n'])
    assert.throws(() => new SandboxContainer({image, phase:'run', dockerHost}), /local Unix socket/);
  for (const mounts of [[{source:'.', target:'/input/input.cj'}], [{source:resolve('anything'), target:'/host'}],
    [{source:resolve('anything'), target:'/input/program'}], [{source:resolve('anything'), target:'/input/input.cj', writable:true}]])
    assert.throws(() => new SandboxContainer({image, phase:'compile', mounts}), /input file/);
  assert.throws(() => new SandboxContainer({image, phase:'compile', mounts:[{}, {}]}), /At most one/);
});

test('container creation verifies restrictions and fixes the local daemon independently of environment', async () => {
  const saved = Object.fromEntries(['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY'].map(key => [key, process.env[key]]));
  try {
    process.env.DOCKER_HOST = 'tcp://untrusted:2375'; process.env.DOCKER_CONTEXT = 'remote'; process.env.DOCKER_TLS_VERIFY = '1';
    const {container, calls, exists} = daemon();
    assert.match(container.name, /^doctor-[0-9a-f]{32}$/);
    await container.create(['/bin/sleep', '300']);
    const creation = calls[0];
    assert.equal(creation.args[0], 'create');
    for (const flag of ['--read-only', '--interactive', '--cap-drop', '--memory-swap', '--pids-limit', '--tmpfs', '--ulimit'])
      assert.ok(creation.args.includes(flag), flag);
    assert.equal(creation.args[creation.args.indexOf('--pull') + 1], 'never');
    assert.equal(creation.args.includes('--mount'), false);
    for (const key of Object.keys(saved)) assert.equal(creation.options.env[key], undefined);
    await container.start({detached:true});
    assert.equal(calls.find(call => call.args[0] === 'start').args.includes('--attach'), false);
    assert.equal(calls.filter(call => call.args[0] === 'container').length, 2);
    assert.deepEqual(await container.remove(), {removed:true, detail:'Container absence verified.'});
    assert.equal(exists(), false);
    await assert.rejects(container.start(), /fresh verified/);
    await assert.rejects(container.create(['/bin/true']), /single-use/);
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('a weakened daemon profile is rejected and removed before any start', async t => {
  const changes = {
    network:actual => { actual.HostConfig.NetworkMode = 'host'; },
    privileges:actual => { actual.HostConfig.Privileged = true; },
    seccomp:actual => { actual.HostConfig.SecurityOpt.push('seccomp=unconfined'); },
    memory:actual => { actual.HostConfig.Memory = 0; },
    swap:actual => { actual.HostConfig.MemorySwap = -1; },
    pids:actual => { actual.HostConfig.PidsLimit = 0; },
    disk:actual => { actual.HostConfig.Tmpfs['/tmp'] = 'rw'; },
    fileLimit:actual => { actual.HostConfig.Ulimits[2].Hard = -1; },
    hostMount:actual => { actual.Mounts.push({Type:'bind', Source:'/', Destination:'/host', RW:true}); },
    identity:actual => { actual.Image = 'sha256:' + 'c'.repeat(64); },
    user:actual => { actual.Config.User = 'root'; }
  };
  for (const [name, mutate] of Object.entries(changes)) await t.test(name, async () => {
    const {container, calls, exists} = daemon({mutate});
    await assert.rejects(container.create(['/bin/sleep', '300']), /policy mismatch/);
    assert.equal(calls.some(call => call.args[0] === 'start'), false);
    assert.equal(exists(), false);
  });
});

test('single-file mounts are read-only and source replacement before start is rejected', async t => {
  const root = await temporary(t), source = join(root, 'input.cj'); await writeFile(source, 'main() {}');
  const {container, calls} = daemon({mounts:[{source, target:'/input/input.cj'}]});
  t.after(() => container.remove());
  await container.create(['/bin/sleep', '300']);
  const args = calls[0].args, mount = args[args.indexOf('--mount') + 1];
  assert.match(mount, /readonly,bind-propagation=rprivate$/);
  assert.ok(mount.includes(`source=${source},target=/input/input.cj`));
  await writeFile(source, 'main() { println("changed") }');
  await assert.rejects(container.start({detached:true}), /changed after/);
  assert.equal(calls.some(call => call.args[0] === 'start'), false);
});

test('directories and oversized files never reach Docker create', async t => {
  const root = await temporary(t), source = join(root, 'large.cj'); await writeFile(source, Buffer.alloc(65537));
  for (const path of [root, source]) {
    const {container, calls} = daemon({mounts:[{source:path, target:'/input/input.cj'}]});
    await assert.rejects(container.create(['/bin/true']), /bounded regular file/);
    assert.equal(calls.length, 0);
  }
});

test('symlink inputs are rejected before creating a container', async t => {
  const root = await temporary(t), source = join(root, 'source.cj'), alias = join(root, 'alias.cj');
  await writeFile(source, 'main() {}');
  try { await symlink(source, alias); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) return t.skip('Windows does not permit this account to create file symlinks.');
    throw error;
  }
  const {container, calls} = daemon({mounts:[{source:alias, target:'/input/input.cj'}]});
  await assert.rejects(container.create(['/bin/true']), /bounded regular file/);
  assert.equal(calls.length, 0);
});

test('run and exec preserve binary results and expose explicit output and stdin bounds', async () => {
  const binary = Buffer.from([0, 255, 128, 10]);
  const {container, calls} = daemon({phase:'run', dockerHost:'unix:///run/user/1000/docker.sock', respond:({args}) => {
    if (args[0] === 'start' || args[0] === 'exec') return output(0, binary);
  }});
  await container.create(['/input/program']);
  const started = await container.start({stdin:Buffer.from([0, 255])});
  assert.deepEqual(started.stdout, binary);
  const start = calls.find(call => call.args[0] === 'start');
  assert.equal(start.options.maxBytes, 65536);
  assert.deepEqual(start.options.stdin, Buffer.from([0, 255]));
  const result = await container.exec(['/bin/cat', '/work/program'], {maxBytes:32 * MiB});
  assert.deepEqual(result.stdout, binary);
  assert.equal(calls.find(call => call.args[0] === 'exec').options.maxBytes, 32 * MiB);
  assert.equal(container.policy.memoryBytes, 512 * MiB);
  await container.remove();
});

test('timeouts preserve pre-removal inspection and await container removal before returning', async () => {
  const sequence = [];
  const {container, exists} = daemon({respond:async ({args, options, actual}) => {
    if (args[0] !== 'start') return;
    actual.State.Running = true;
    sequence.push('stopping'); await options.onStop('timeout'); sequence.push('removed');
    return output(null, '', '', 'timeout');
  }});
  await container.create(['/bin/sleep', '300']);
  const result = await container.start();
  assert.equal(result.reason, 'timeout');
  assert.equal(result.lastInspection.State.Running, true);
  assert.deepEqual(sequence, ['stopping', 'removed']);
  assert.equal(exists(), false);
  assert.equal(result.cleanupDetail || '', '');
});

test('cleanup failure remains explicit and is never mistaken for a removed container', async () => {
  const {container, exists} = daemon({failCleanup:true, respond:async ({args, options}) => {
    if (args[0] !== 'start') return;
    let cleanupDetail = '';
    try { await options.onStop('output_limit'); } catch (error) { cleanupDetail = error.message; }
    return {...output(null, 'prefix', '', 'output_limit'), cleanupDetail};
  }});
  await container.create(['/bin/sleep', '300']);
  const result = await container.start();
  assert.equal(result.reason, 'output_limit');
  assert.match(result.cleanupDetail, /Cannot verify container removal/);
  assert.match(container.cleanupDetail, /Cannot verify container removal/);
  assert.equal((await container.remove()).removed, false);
  assert.equal(exists(), true);
});

test('process pipes preserve binary bytes and cap combined stdout and stderr', async () => {
  const input = Buffer.from([0, 255, 10, 128, 13]);
  const echoed = await runSandboxProcess(process.execPath, ['-e',
    'process.stdin.on("data",c=>process.stdout.write(c));process.stdin.on("end",()=>process.stderr.write(Buffer.from([255,0,128])));'], {stdin:input});
  assert.equal(echoed.code, 0); assert.equal(echoed.reason, '');
  assert.deepEqual(echoed.stdout, input); assert.deepEqual(echoed.stderr, Buffer.from([255, 0, 128]));
  let stopped = '';
  const flooded = await runSandboxProcess(process.execPath, ['-e',
    'process.stdout.write(Buffer.alloc(8192,128));setInterval(()=>process.stderr.write("more"),20);'],
  {maxBytes:257, onStop:reason => { stopped = reason; }});
  assert.equal(stopped, 'output_limit'); assert.equal(flooded.reason, 'output_limit');
  assert.equal(flooded.stdout.length + flooded.stderr.length, 257);
  assert.deepEqual(flooded.stdout, Buffer.alloc(257, 128));
});

test('process deadline and cancellation await cleanup; launch failures never succeed', async () => {
  let cleanupFinished = false;
  const timed = await runSandboxProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'],
    {timeoutMs:100, onStop:async () => { await new Promise(resolve => setTimeout(resolve, 30)); cleanupFinished = true; }});
  assert.equal(timed.reason, 'timeout'); assert.equal(cleanupFinished, true);
  const controller = new AbortController();
  const pending = runSandboxProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {signal:controller.signal, timeoutMs:10000});
  setTimeout(() => controller.abort(), 100);
  assert.equal((await pending).reason, 'cancelled');
  const cancelled = await runSandboxProcess('doctor-nonexistent-command', [], {signal:controller.signal});
  assert.equal(cancelled.reason, 'cancelled'); assert.equal(cancelled.code, null);
  const missing = await runSandboxProcess('doctor-nonexistent-command', [], {onStop:() => { throw new Error('cleanup unavailable'); }});
  assert.equal(missing.reason, 'launch_error'); assert.notEqual(missing.code, 0);
  assert.match(missing.cleanupDetail, /cleanup unavailable/);
});
