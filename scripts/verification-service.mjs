// Opt-in local Linux HTTP service: only saved, confirmed revision snapshots enter
// the existing container runner. Browser input never selects commands or images.
import { mkdir, lstat, open, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { RevisionStore } from './revision-store.mjs';
import { SandboxContainer } from './sandbox-container.mjs';
import { verifyPublic } from './sandbox-verify.mjs';
import { runNative } from './native-bridge.mjs';
import { validRevisionId } from '../web/revision.mjs';
import { validatePublicTests, validateVerificationRecord, validVerificationId, MAX_VERIFICATION_BYTES } from '../web/verification.mjs';

const imageId = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const failure = (status, message, extra = {}) => Object.assign(new Error(message), {status, ...extra});
const brief = value => String(value ?? '').slice(0, 2048);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

async function directory(parent, name, create = false) {
  const path = join(parent, name);
  if (create) { try { await mkdir(path, {mode:0o700}); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || await realpath(path) !== path)
    throw failure(400, '验证记录目录无效，不接受链接或项目外路径。');
  return path;
}
async function readBounded(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_VERIFICATION_BYTES)
    throw failure(400, '验证记录文件过大或类型无效。');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || actual.size > MAX_VERIFICATION_BYTES || actual.ino !== stat.ino || actual.dev !== stat.dev)
      throw failure(400, '验证记录在读取前发生变化。');
    const buffer = Buffer.alloc(MAX_VERIFICATION_BYTES + 1); let offset = 0;
    while (offset < buffer.length) {
      const {bytesRead} = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > MAX_VERIFICATION_BYTES) throw failure(400, '验证记录读取期间超过大小限制。');
    return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(buffer.subarray(0, offset)));
  } finally { await handle.close(); }
}
function requestBinding(request, record) {
  if (request.state !== 'running' || record.verificationId !== request.verificationId
      || record.createdAt !== request.createdAt || JSON.stringify(record.revision) !== JSON.stringify(request.revision)
      || JSON.stringify(record.tests) !== JSON.stringify(request.tests))
    throw new Error('验证结果与原始请求、修改副本或公开测试不一致。');
}

export class VerificationService {
  constructor({root, revisionStore, core, image, bridge, runner = verifyPublic, platform = process.platform,
    probeExecutor = runNative, containerFactory = options => new SandboxContainer(options)} = {}) {
    this.root = resolve(root || process.cwd());
    this.revisionStore = revisionStore || new RevisionStore(this.root);
    this.core = core; this.image = image; this.bridge = bridge;
    // These functions are process configuration for deterministic tests only;
    // makeServer never accepts dependency configuration in an HTTP request.
    this.runner = runner; this.platform = platform; this.probeExecutor = probeExecutor; this.containerFactory = containerFactory;
    this.active = new Set(); this.busy = false; this.cleanupBlocked = false;
    this.health = this.configurationHealth();
  }
  configurationHealth() {
    if (this.platform !== 'linux') return {available:false, code:'unsupported_platform',
      detail:'本机尚无可用的 Linux 容器验证环境；可以保存修改、查看已有报告，当前不能运行公开测试。'};
    if (!imageId(this.image) || typeof this.core !== 'string' || !this.core)
      return {available:false, code:'not_configured', detail:'尚未配置固定本地镜像 ID 和仓颉核心，修改验证未启用。'};
    return {available:false, code:'not_probed', detail:'容器验证已配置，等待检查核心、SDK 和隔离限制。'};
  }
  acquire() {
    if (this.busy || this.bridge?.busy) throw failure(409, '已有编译、检索或验证任务正在进行，请稍后再试。');
    this.busy = true;
    if (this.bridge) this.bridge.busy = true;
  }
  release() { this.busy = false; if (this.bridge) this.bridge.busy = false; }
  blockCleanup(names) {
    this.cleanupBlocked = true;
    const known = names.filter(name => typeof name === 'string' && /^doctor-[a-f0-9]{32}$/.test(name));
    this.health = {available:false, code:'cleanup_unconfirmed',
      detail:`容器清理尚未确认${known.length ? '：' + known.join('、') : '（未取得可靠编号）'}。请先人工核查并清理这些容器，再重启服务；再次检查环境不会自动恢复验证。`};
  }
  async probe() {
    if (this.cleanupBlocked) return this.health;
    const configuration = this.configurationHealth();
    if (configuration.code !== 'not_probed') { this.health = configuration; return this.health; }
    this.acquire();
    let container, problem = '', version = '', cleanup;
    try {
      const native = await this.probeExecutor(this.core, ['--version'], {cwd:this.root, timeout:8000});
      if (native.code !== 0 || native.reason || native.signal || !native.stdout?.startsWith('Cangjie Code Doctor 0.3.0'))
        throw new Error('仓颉核心未能正常启动。');
      container = this.containerFactory({image:this.image, phase:'compile', mounts:[]});
      await container.create(['/bin/sleep', '30']);
      const started = await container.start({detached:true, timeoutMs:10000});
      if (started.code !== 0 || started.reason) throw new Error('隔离检查容器未能启动。');
      const sdk = await container.exec(['/opt/doctor/with-sdk.sh', 'cjc', '--version'], {timeoutMs:10000, maxBytes:65536});
      version = sdk.stdout.toString('utf8').trim();
      if (sdk.code !== 0 || sdk.reason || !version.startsWith('Cangjie Compiler: 1.0.5 (')) throw new Error('容器 SDK 1.0.5 未就绪。');
      const inspection = await container.inspect();
      if (inspection.Image !== this.image || !inspection.State?.Running || inspection.State?.OOMKilled || inspection.State?.Error)
        throw new Error('隔离检查容器状态异常。');
    } catch (error) { problem = brief(error.message); }
    finally {
      if (container) {
        try { cleanup = await container.remove(); }
        catch (error) { cleanup = {removed:false, detail:brief(error.message)}; }
        if (!cleanup?.removed) this.blockCleanup([container.name]);
      }
      if (!this.cleanupBlocked) this.health = problem ? {available:false, code:'verification_unavailable', detail:brief(problem)}
          : {available:true, code:'ready', detail:'已核对 Linux 容器限制和 SDK 1.0.5，可验证保存后的修改副本与公开测试。',
            image:this.image, sdkVersion:'1.0.5', compilerVersion:version};
      this.release();
    }
    return this.health;
  }
  async directory(create = false) {
    const root = await realpath(this.root);
    return directory(await directory(root, 'runs', create), 'revision-verifications', create);
  }
  async get(verificationId) {
    if (!validVerificationId(verificationId)) throw failure(400, '无效的验证记录编号。');
    try {
      const folder = await directory(await this.directory(), verificationId);
      const request = await validateVerificationRecord(await readBounded(join(folder, 'request.json')));
      if (request.verificationId !== verificationId || request.state !== 'running') throw new Error('验证请求与目录编号或初始状态不一致。');
      let record;
      try { record = await readBounded(join(folder, 'verification.json')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (record) {
        await validateVerificationRecord(record);
        requestBinding(request, record);
        if (!['completed','failed'].includes(record.state)) throw new Error('已发布的验证记录缺少终态。');
        return record;
      }
      if (this.active.has(verificationId)) return request;
      return {...request, state:'unknown', detail:'仅找到已保存的请求，尚无完成记录；当前服务无法确认先前任务是否完成。'};
    } catch (error) {
      if (error.code === 'ENOENT') throw failure(404, '验证记录不存在。');
      throw failure(400, error.message);
    }
  }
  async list() {
    let entries;
    try { entries = await readdir(await this.directory(), {withFileTypes:true}); }
    catch (error) { if (error.code === 'ENOENT') return {verifications:[], unreadable:0}; throw error; }
    const verifications = []; let unreadable = 0;
    for (const entry of entries) {
      if (!validVerificationId(entry.name)) continue;
      if (!entry.isDirectory() || entry.isSymbolicLink()) { unreadable++; continue; }
      try {
        const record = await this.get(entry.name);
        verifications.push({verificationId:record.verificationId, createdAt:record.createdAt, finishedAt:record.finishedAt,
          state:record.state, active:this.active.has(record.verificationId), revisionId:record.revision.revisionId, sourceName:record.revision.source.name,
          sourceSha256:record.revision.source.sha256, status:record.report?.status ?? 'not_run',
          compileStatus:record.report?.compile.status ?? 'not_run', testStatus:record.report?.testStatus ?? 'not_run', detail:record.detail});
      } catch { unreadable++; }
    }
    verifications.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.verificationId.localeCompare(b.verificationId));
    return {verifications:verifications.slice(0,20), unreadable};
  }
  async verify(input, signal) {
    if (!exact(input, ['revisionId','tests','confirmed']) || !validRevisionId(input.revisionId) || input.confirmed !== true)
      throw failure(400, '请确认验证已保存的修改副本；只接受修改编号、公开测试和确认状态。');
    try { validatePublicTests(input.tests); } catch (error) { throw failure(400, error.message); }
    const tests = structuredClone(input.tests), revisionId = input.revisionId;
    if (!this.health.available) throw failure(503, this.health.detail);
    this.acquire(); // Hold the shared service lock before loading the revision.
    const verificationId = randomBytes(16).toString('hex');
    this.active.add(verificationId);
    try {
      const revision = structuredClone(await this.revisionStore.get(revisionId));
      if (revision.revisionId !== revisionId) throw failure(400, '修改记录编号不匹配。');
      const request = {schemaVersion:1, kind:'doctor-revision-verification', verificationId,
        createdAt:new Date().toISOString(), finishedAt:null, state:'running', revision, tests, report:null, detail:'正在验证已保存的修改副本。'};
      await validateVerificationRecord(request);
      const parent = await this.directory(true), folder = join(parent, verificationId);
      await mkdir(folder, {mode:0o700});
      await directory(parent, verificationId);
      await writeFile(join(folder, 'request.json'), JSON.stringify(request), {flag:'wx', mode:0o600});
      let record = {...request};
      try {
        if (signal?.aborted) throw new Error('验证请求已取消，未启动新的容器。');
        const report = await this.runner({source:{name:revision.source.name, text:revision.source.text}, tests:structuredClone(tests)},
          {root:this.root, image:this.image, core:this.core, signal});
        if (Array.isArray(report?.containers) && report.containers.some(container => container?.cleanup?.removed === false))
          this.blockCleanup(report.containers.filter(container => container?.cleanup?.removed === false).map(container => container.name));
        if (report?.image !== this.image || report?.source?.name !== revision.source.name
            || report?.source?.text !== revision.source.text || report?.source?.sha256 !== revision.source.sha256)
          throw new Error('验证结果与已确认源码或固定镜像不一致。');
        record = {...request, state:'completed', finishedAt:new Date().toISOString(), report,
          detail:report.status === 'passed' ? '公开测试验证通过；此结果不包含保留测试，也不是修复成功率或 A/B 结论。'
            : '验证已产生报告，请查看编译、公开测试和容器清理的具体结果。'};
        await validateVerificationRecord(record);
      } catch (error) {
        record = {...request, state:'failed', finishedAt:new Date().toISOString(), report:null,
          detail:`验证未生成有效报告：${brief(error.message)}`};
        await validateVerificationRecord(record);
      }
      try {
        // Completion includes publishing the terminal record. A pending write is
        // never advertised as a successful verification after a storage failure.
        await directory(parent, verificationId);
        await writeFile(join(folder, 'verification.pending.json'), JSON.stringify(record), {flag:'wx', mode:0o600});
        await rename(join(folder, 'verification.pending.json'), join(folder, 'verification.json'));
      } catch {
        throw failure(500, '验证状态保存失败；请求已保留，请刷新记录核查，不能据此确认验证成功。', {verificationId, verificationState:'unknown'});
      }
      return record;
    } finally { this.active.delete(verificationId); this.release(); }
  }
}
