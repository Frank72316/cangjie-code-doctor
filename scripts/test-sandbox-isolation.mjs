// Real Docker development acceptance, not model evaluation or A/B results.
import assert from 'node:assert/strict';
import {appendFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {SandboxContainer} from './sandbox-container.mjs';

const image = process.argv[2];
const receiptPath = process.argv[3];
if (process.platform !== 'linux' || !/^sha256:[0-9a-f]{64}$/.test(image ?? '')) {
  console.error('Usage on Linux: node scripts/test-sandbox-isolation.mjs sha256:<image ID> [receipt.json]');
  process.exit(2);
}
const results = [];
const allNames = [];
const python = source => ['/usr/bin/python3', '-u', '-c', source];
const cleanText = buffer => buffer.toString('utf8').slice(0, 4096);

async function probe(name, source, verify, options = {}) {
  const sandbox = new SandboxContainer({image, phase:'run'});
  allNames.push(sandbox.name);
  const startedAt = new Date().toISOString();
  let evidence, cleanup, failure;
  let cancelTimer;
  try {
    await sandbox.create(python(source));
    const controller = options.cancelAfterMs ? new AbortController() : null;
    if (controller) cancelTimer = setTimeout(() => controller.abort(), options.cancelAfterMs);
    const execution = await sandbox.start({timeoutMs:options.timeoutMs ?? 12000,
      maxBytes:options.maxBytes ?? 64 * 1024, signal:controller?.signal});
    clearTimeout(cancelTimer);
    const inspection = sandbox.removed ? sandbox.lastInspection : await sandbox.inspect();
    evidence = await verify(execution, inspection);
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(cancelTimer);
    cleanup = await sandbox.remove();
    if (!cleanup.removed) failure ??= new Error(cleanup.detail);
    results.push({name, status:failure ? 'failed' : 'passed', startedAt,
      completedAt:new Date().toISOString(), container:sandbox.name,
      cleanup, evidence, ...(failure ? {detail:failure.message} : {})});
  }
  console.log(`${failure ? 'FAIL' : 'PASS'} ${name}: ${JSON.stringify(results.at(-1))}`);
  if (failure) throw failure;
}

function successfulJSON(execution, inspection) {
  assert.equal(execution.reason, '', cleanText(execution.stderr));
  assert.equal(execution.code, 0, cleanText(execution.stderr));
  assert.equal(inspection?.State?.OOMKilled, false);
  return JSON.parse(execution.stdout.toString('utf8'));
}

let failed;
try {
  await probe('applied_permissions_filesystems_network_and_cgroups', `
import os, json, resource, socket, errno, subprocess
from pathlib import Path
status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
assert os.getuid() == 65534 and os.getgid() == 65534
assert int(status['CapEff'].strip(), 16) == 0
assert status['NoNewPrivs'].strip() == '1'
assert status['Seccomp'].strip() == '2'
mounts = {line.split()[1]: set(line.split()[3].split(',')) for line in Path('/proc/mounts').read_text().splitlines()}
assert 'ro' in mounts['/']
assert 'noexec' in mounts['/tmp'] and {'nosuid','nodev'} <= mounts['/tmp']
assert 'noexec' not in mounts['/work'] and {'nosuid','nodev'} <= mounts['/work']
assert os.statvfs('/work').f_frsize * os.statvfs('/work').f_blocks == 16 * 1024 * 1024
assert os.statvfs('/tmp').f_frsize * os.statvfs('/tmp').f_blocks == 32 * 1024 * 1024
assert os.statvfs('/dev/shm').f_frsize * os.statvfs('/dev/shm').f_blocks == 16 * 1024 * 1024
try:
    Path('/doctor-forbidden').write_text('forbidden')
    raise AssertionError('root filesystem accepted a write')
except OSError as e:
    assert e.errno in (errno.EROFS, errno.EACCES)
for directory, executable in [('/work', True), ('/tmp', False)]:
    script = Path(directory) / 'execution-probe'
    script.write_text('#!/bin/sh\\nexit 0\\n')
    script.chmod(0o700)
    try:
        result = subprocess.run([str(script)], timeout=2)
        assert executable and result.returncode == 0
    except OSError as e:
        assert not executable and e.errno == errno.EACCES
    script.unlink()
interfaces = sorted(os.listdir('/sys/class/net'))
assert interfaces == ['lo'], interfaces
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(1)
try:
    sock.connect(('192.0.2.1', 9))
    raise AssertionError('isolated container reached a non-loopback address')
except OSError as e:
    assert e.errno in (errno.ENETUNREACH, errno.EHOSTUNREACH), str(e)
finally:
    sock.close()
cg = Path('/sys/fs/cgroup')
limits = {name:(cg / name).read_text().strip() for name in ['memory.max','memory.swap.max','pids.max','cpu.max']}
assert limits['memory.max'] == str(512 * 1024 * 1024), limits
assert limits['memory.swap.max'] == '0', limits
assert limits['pids.max'] == '128', limits
quota, period = map(int, limits['cpu.max'].split())
assert quota == period and quota > 0, limits
assert resource.getrlimit(resource.RLIMIT_CORE) == (0, 0)
assert resource.getrlimit(resource.RLIMIT_NOFILE) == (128, 128)
assert resource.getrlimit(resource.RLIMIT_FSIZE) == (64 * 1024 * 1024, 64 * 1024 * 1024)
print(json.dumps({'uid':os.getuid(),'gid':os.getgid(),'capEff':status['CapEff'].strip(),'noNewPrivs':1,'seccomp':2,'interfaces':interfaces,'cgroups':limits,'rootReadOnly':True,'tmpNoExec':True,'workExecutable':True}))
`, successfulJSON);

  await probe('work_tmpfs_disk_limit', `
import os, errno, json
written = 0
try:
    with open('/work/fill.bin', 'wb', buffering=0) as handle:
        for _ in range(32):
            written += handle.write(b'x' * (1024 * 1024))
    raise AssertionError('16 MiB work volume accepted 32 MiB')
except OSError as e:
    assert e.errno == errno.ENOSPC, str(e)
    assert 15 * 1024 * 1024 <= written <= 16 * 1024 * 1024, written
print(json.dumps({'error':'ENOSPC','bytesWritten':written}))
`, successfulJSON);

  await probe('pids_limit', `
import errno, subprocess, json
children = []
blocked = False
try:
    for _ in range(160):
        try:
            children.append(subprocess.Popen(['/bin/sleep','30'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        except OSError as e:
            assert e.errno == errno.EAGAIN, str(e)
            blocked = True
            break
    assert blocked and 120 <= len(children) <= 127, len(children)
finally:
    for child in children:
        child.kill()
    for child in children:
        child.wait()
print(json.dumps({'error':'EAGAIN','childrenStarted':len(children)}))
`, successfulJSON, {timeoutMs:20000});

  await probe('memory_oom_limit', `
blocks=[]
while True:
    blocks.append(bytearray(8 * 1024 * 1024))
`, (execution, inspection) => {
    assert.equal(execution.reason, '', cleanText(execution.stderr));
    assert.equal(execution.code, 137, cleanText(execution.stderr));
    assert.equal(inspection?.State?.OOMKilled, true);
    return {exitCode:execution.code, oomKilled:true};
  }, {timeoutMs:20000});

  await probe('timeout_removes_running_container', `
import time
print('ready', flush=True)
time.sleep(30)
`, execution => {
    assert.equal(execution.reason, 'timeout');
    assert.match(cleanText(execution.stdout), /ready/);
    return {reason:execution.reason, programStarted:true};
  }, {timeoutMs:2000});

  await probe('output_limit_removes_running_container', `
import os
while True:
    os.write(1, b'x' * 8192)
`, execution => {
    assert.equal(execution.reason, 'output_limit');
    const bytes = execution.stdout.length + execution.stderr.length;
    assert.equal(bytes, 64 * 1024);
    return {reason:execution.reason, retainedBytes:bytes};
  });

  await probe('cancellation_removes_running_container', `
import time
print('ready', flush=True)
time.sleep(30)
`, execution => {
    assert.equal(execution.reason, 'cancelled');
    assert.match(cleanText(execution.stdout), /ready/);
    return {reason:execution.reason, programStarted:true};
  }, {timeoutMs:10000, cancelAfterMs:2000});
} catch (error) {
  failed = error;
} finally {
  const receipt = {schemaVersion:1, kind:'doctor-development-isolation-acceptance',
    image, createdAt:new Date().toISOString(), platform:process.platform,
    status:failed ? 'failed' : 'passed',
    scope:'Development containment probes on this Linux Docker host; not a security certification or A/B result.',
    requires:'Linux Docker Engine with cgroup v2, the default seccomp profile and the local unix socket.',
    containers:allNames, results};
  if (receiptPath) {
    await mkdir(dirname(resolve(receiptPath)), {recursive:true});
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {flag:'wx'});
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = ['## Development container isolation acceptance', '',
      `Result: **${receipt.status}**. Image: \`${image}\`.`, '',
      'These are development containment probes, not A/B results or a security certification.', '',
      '| Probe | Result | Container removal |', '| --- | --- | --- |',
      ...results.map(result => `| ${result.name} | ${result.status} | ${result.cleanup.removed ? 'verified absent' : 'FAILED'} |`),
      '', '```json', JSON.stringify(receipt, null, 2), '```', ''];
    await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
  }
  console.log(JSON.stringify(receipt, null, 2));
}
if (failed) {
  console.error(`Sandbox acceptance failed: ${failed.message}`);
  process.exitCode = 1;
}
