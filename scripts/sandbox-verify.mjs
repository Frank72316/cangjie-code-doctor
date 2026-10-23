// Experimental Linux development CLI. No HTTP route calls this module.
import { randomBytes, createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SandboxContainer } from './sandbox-container.mjs';
import { runNative } from './native-bridge.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = text => Buffer.byteLength(text, 'utf8');
const json = value => JSON.stringify(value, null, 2) + '\n';
export function validateVerification(input) {
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const text = (value, max) => typeof value === 'string' && value.isWellFormed() && bytes(value) <= max;
  if (!exact(input, ['source', 'tests']) || !exact(input.source, ['name', 'text'])) throw new Error('Expected source {name,text} and public tests.');
  if (!text(input.source.name, 128) || !/^[^\x00-\x1f<>:"/\\|?*]+\.cj$/u.test(input.source.name)
    || input.source.name === '.cj') throw new Error('Source name must be a .cj basename.');
  if (!text(input.source.text, 65536) || !input.source.text.trim() || input.source.text.split(/\r\n|\r|\n/).length > 200)
    throw new Error('Source must be at most 64 KiB and 200 lines.');
  if (!Array.isArray(input.tests) || input.tests.length > 8) throw new Error('At most eight public tests are supported.');
  const ids = new Set();
  for (const test of input.tests) {
    if (!exact(test, ['id', 'stdin', 'expectedStdout']) || typeof test.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(test.id)
      || ids.has(test.id) || !text(test.stdin, 4096) || !text(test.expectedStdout, 16384)) throw new Error('Invalid or duplicate public test.');
    ids.add(test.id);
  }
  return structuredClone(input);
}
function processRecord(result) {
  return {exitCode:result.code, reason:result.reason || '', stdout:result.stdout.toString('utf8'), stderr:result.stderr.toString('utf8'),
    stdoutBytes:result.stdout.length, stderrBytes:result.stderr.length, stdoutSha256:hash(result.stdout), stderrSha256:hash(result.stderr),
    displayEncoding:'UTF-8 replacement; original bytes saved separately', cleanupDetail:result.cleanupDetail || ''};
}
function stateRecord(inspect) {
  if (!inspect) return null;
  return {image:inspect.Image, state:inspect.State, hostConfig:inspect.HostConfig, mounts:inspect.Mounts};
}
async function safeDirectory(path) {
  try { await mkdir(path, {mode:0o700}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Task parent must be a real directory.');
}
async function nativeJson(executable, args, root, executor, signal) {
  const result = await executor(executable, args, {cwd:root, timeout:8000, signal});
  if (result.code !== 0 || result.reason || result.signal) throw new Error(`Native verdict unavailable: ${result.reason || result.code}`);
  return JSON.parse(result.stdout);
}
// Dependencies are injected only by deterministic failure tests, never supplied by input JSON.
export async function verifyPublic(input, {root=process.cwd(), image, core, signal}={},
  {containerFactory=options => new SandboxContainer(options), executor=runNative, platform=process.platform}={}) {
  input = validateVerification(input);
  if (platform !== 'linux') throw new Error('This development CLI requires Linux and a local Docker daemon; the Windows web preview remains unchanged.');
  if (!/^sha256:[a-f0-9]{64}$/.test(image || '')) throw new Error('Pass the exact locally built image ID, not a tag.');
  if (!core) throw new Error('Pass the trusted Doctor binary.');
  root = resolve(root); core = resolve(core);
  await safeDirectory(join(root, 'runs'));
  await safeDirectory(join(root, 'runs', 'verification'));
  const id = randomBytes(16).toString('hex'), directory = join(root, 'runs', 'verification', id);
  await mkdir(directory, {mode:0o700});
  const sourcePath = join(directory, 'input.cj'), artifactPath = join(directory, 'program');
  const report = {schemaVersion:1, kind:'doctor-sandbox-verification', id, startedAt:new Date().toISOString(),
    developmentOnly:true, scope:'public-tests-only', image, sdkVersion:'1.0.5', source:{...input.source, sha256:hash(input.source.text)},
    status:'tool_error', compile:{status:'not_run'}, tests:input.tests.map(test => ({id:test.id, status:'not_run'})),
    testStatus:'not_run', containers:[], detail:''};
  await writeFile(sourcePath, input.source.text, {flag:'wx', mode:0o644});
  await writeFile(join(directory, 'request.json'), json(input), {flag:'wx', mode:0o600});
  // Docker bind mounts the single file; no task directory is mounted or exposed.
  const saveProcess = async (prefix, result) => {
    await writeFile(join(directory, prefix + '.stdout'), result.stdout, {flag:'wx', mode:0o600});
    await writeFile(join(directory, prefix + '.stderr'), result.stderr, {flag:'wx', mode:0o600});
    return processRecord(result);
  };
  const withContainer = async (phase, mounts, operation) => {
    const container = containerFactory({image, phase, mounts});
    const entry = {name:container.name, phase, policy:container.policy, inspection:null, cleanup:null};
    report.containers.push(entry);
    try { return await operation(container, entry); }
    finally {
      entry.cleanup = await container.remove();
      if (!entry.cleanup.removed) throw new Error(`Container cleanup failed for ${container.name}: ${entry.cleanup.detail}`);
    }
  };
  const inspectResult = async (container, result, entry) => {
    let inspection = result.lastInspection;
    if (!inspection && !result.reason) inspection = await container.inspect();
    entry.inspection = stateRecord(inspection);
    return inspection;
  };
  try {
    const version = await executor(core, ['--version'], {cwd:root, timeout:8000, signal});
    if (version.code !== 0 || version.reason || version.signal || !version.stdout.startsWith('Cangjie Code Doctor 0.3.0'))
      throw new Error('Trusted Doctor core is unavailable.');
    const compiled = await withContainer('compile', [{source:sourcePath, target:'/input/input.cj'}], async (container, entry) => {
      await container.create(['/bin/sleep', '300']);
      const started = await container.start({detached:true, timeoutMs:10000, signal});
      if (started.code !== 0 || started.reason) throw new Error('Compiler container could not start.');
      const sdk = await container.exec(['/opt/doctor/with-sdk.sh', 'cjc', '--version'], {timeoutMs:10000, signal});
      if (sdk.code !== 0 || sdk.reason || !sdk.stdout.toString('utf8').startsWith('Cangjie Compiler: 1.0.5 (')) throw new Error('Container SDK version mismatch.');
      report.compilerVersion = sdk.stdout.toString('utf8').trim();
      const result = await container.exec(['/opt/doctor/with-sdk.sh', 'cjc', '--diagnostic-format=json', '--error-count-limit', '8',
        '/input/input.cj', '-o', '/work/program'], {timeoutMs:60000, maxBytes:1024*1024, signal});
      report.compile.process = await saveProcess('compile', result);
      const inspection = await inspectResult(container, result, entry);
      if (result.reason || inspection?.State?.OOMKilled || !inspection?.State?.Running) throw new Error(`Compiler interrupted: ${result.reason || 'container_exit_or_oom'}`);
      if (result.stdout.length && result.stderr.length) throw new Error('Unexpected mixed compiler output streams.');
      const rawPath = result.stderr.length ? 'compile.stderr' : 'compile.stdout';
      report.compile.normalized = await nativeJson(core, ['parse', relative(root, join(directory, rawPath)), String(result.code)], root, executor, signal);
      report.compile.status = report.compile.normalized.status;
      if (!['compile_passed','compile_failed','tool_error'].includes(report.compile.status)) throw new Error('Invalid native compilation verdict.');
      if (report.compile.status !== 'compile_passed') return false;
      const artifact = await container.exec(['/bin/cat', '/work/program'], {timeoutMs:10000, maxBytes:32*1024*1024, signal});
      if (artifact.code !== 0 || artifact.reason || artifact.stderr.length || artifact.stdout.length < 4
        || !artifact.stdout.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46]))) throw new Error('Compiler did not produce a bounded Linux ELF artifact.');
      await writeFile(artifactPath, artifact.stdout, {flag:'wx', mode:0o755});
      report.artifact = {sha256:hash(artifact.stdout), bytes:artifact.stdout.length};
      return true;
    });
    if (!compiled) report.status = report.compile.status;
    else {
      report.status = 'not_run';
      for (const [index, test] of input.tests.entries()) {
        if (signal?.aborted) throw new Error('Verification cancelled before next test.');
        await withContainer('run', [{source:artifactPath, target:'/input/program'}], async (container, entry) => {
          // In-container watchdog also bounds lifetime if the host CLI is killed abruptly.
          await container.create(['/usr/bin/timeout', '--signal=KILL', '5s', '/input/program']);
          const result = await container.start({stdin:Buffer.from(test.stdin), timeoutMs:3000, maxBytes:65536, signal});
          const output = {id:test.id, status:'tool_error', process:await saveProcess(`test-${index}`, result)};
          report.tests[index] = output;
          const inspection = await inspectResult(container, result, entry);
          if (result.reason || inspection?.State?.OOMKilled) {
            output.status = result.reason || 'oom';
            if (!['timeout','output_limit','oom'].includes(output.status)) throw new Error(`Test interrupted: ${output.status}`);
            return;
          }
          if (!inspection || inspection.State.Running || inspection.State.ExitCode !== result.code || inspection.State.Error) throw new Error('Container exit evidence missing or inconsistent.');
          const expectedPath = join(directory, `test-${index}.expected`);
          await writeFile(expectedPath, test.expectedStdout, {flag:'wx', mode:0o600});
          output.verdict = await nativeJson(core, ['check-output', relative(root, join(directory, `test-${index}.stdout`)), relative(root, expectedPath), String(result.code)], root, executor, signal);
          if (!['passed','failed','runtime_error'].includes(output.verdict.status) || output.verdict.comparison !== 'exact_bytes' || output.verdict.exitCode !== result.code)
            throw new Error('Invalid native public-test verdict.');
          output.status = output.verdict.status;
        });
      }
      if (input.tests.length) {
        report.testStatus = report.tests.every(test => test.status === 'passed') ? 'passed' : 'failed';
        report.status = report.testStatus === 'passed' ? 'passed' : 'test_failed';
      }
    }
  } catch (error) {
    report.status = 'tool_error'; report.detail = error.message;
    if ((report.compile.status === 'not_run' && report.compile.process) || (report.compile.status === 'compile_passed' && !report.artifact)) report.compile.status = 'tool_error';
    if (report.tests.some(test => test.status !== 'not_run')) report.testStatus = 'incomplete';
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(join(directory, 'report.pending.json'), json(report), {flag:'wx', mode:0o600});
  await rename(join(directory, 'report.pending.json'), join(directory, 'report.json'));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [inputPath, image, core, ...extra] = process.argv.slice(2);
    if (!inputPath || !image || !core || extra.length) throw new Error('Usage: node scripts/sandbox-verify.mjs <public-request.json> <sha256:image-id> <trusted-doctor-binary>');
    const stat = await lstat(inputPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256*1024) throw new Error('Request must be a regular JSON file, at most 256 KiB.');
    const request = JSON.parse(await readFile(inputPath, 'utf8'));
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    try {
      const report = await verifyPublic(request, {image, core, signal:controller.signal});
      console.log(json(report));
      process.exitCode = report.status === 'tool_error' ? 2 : report.status === 'passed' ? 0 : 1;
    } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
