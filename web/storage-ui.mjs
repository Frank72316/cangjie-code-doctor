import { validateEvidenceBundle, MAX_EVIDENCE_BUNDLE_BYTES } from './evidence-bundle.mjs';

const $ = id => document.getElementById(id);
const groupNames = {tasks:'编译任务记录',native:'编译诊断与产物',retrieval:'文档检索过程',revisions:'已保存修改','revision-verifications':'独立验证记录',other:'其他运行文件'};
const encoder = new TextEncoder();
const integer = value => Number.isSafeInteger(value) && value >= 0;
const node = (tag,text) => { const item = document.createElement(tag); item.textContent = text; return item; };
function bytesLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
function exportDate(value) {
  const parts = new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(new Date(value));
  return ['year','month','day'].map(type => parts.find(part => part.type === type).value).join('-');
}
function validateSummary(data) {
  if (data?.schemaVersion !== 1 || data.kind !== 'doctor-storage-summary' || typeof data.complete !== 'boolean'
    || !integer(data.files) || !integer(data.bytes) || typeof data.scannedAt !== 'string' || !Number.isFinite(Date.parse(data.scannedAt))
    || !Array.isArray(data.groups) || data.groups.length > 6 || !Array.isArray(data.issues) || data.issues.length > 100
    || !data.issues.every(item => typeof item === 'string' && item.length <= 2000)
    || !integer(data.limits?.maxEntries) || !integer(data.limits?.maxDepth)) throw new Error('存储概况格式无效，请重新读取。');
  const seen = new Set(); let files = 0, bytes = 0;
  for (const group of data.groups) {
    if (!Object.hasOwn(groupNames,group.name) || seen.has(group.name) || !integer(group.files) || !integer(group.bytes))
      throw new Error('存储分组信息无效，请重新读取。');
    seen.add(group.name); files += group.files; bytes += group.bytes;
  }
  if (files !== data.files || bytes !== data.bytes) throw new Error('存储合计与分组不一致，请重新读取。');
  return data;
}

export function initStorageUI({getHealth,download}) {
  let loading = false, exporting = false, loaded = false;
  const setStatus = (message,error=false) => {
    $('storage-status').textContent = message; $('storage-status').dataset.state = error ? 'error' : 'idle';
  };
  const controls = () => {
    $('storage-refresh').disabled = loading || exporting;
    $('storage-export').disabled = loading || exporting;
    $('storage-export').textContent = exporting ? '正在核验材料…' : '下载修改与验证材料 JSON';
  };
  const api = async (path,options={},limit=256 * 1024) => {
    const token = getHealth().token;
    if (!token) throw new Error('尚未连接本机服务。请到编译诊断页检查环境后重试。');
    const response = await fetch(path,{...options,headers:{'X-Doctor-Token':token,...options.headers}});
    const raw = await response.text();
    if (encoder.encode(raw).length > limit) throw new Error('返回材料超过大小限制，未下载。');
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error('本机返回内容无法读取，请重试。'); }
    if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : '本机材料读取失败。');
    return data;
  };
  const refresh = async () => {
    if (!$('storage-panel').open || loading || exporting) return;
    loading = true; controls(); setStatus('正在统计本机运行文件…');
    try {
      const data = validateSummary(await api('/api/storage'));
      $('storage-groups').replaceChildren(); $('storage-issues').replaceChildren();
      for (const group of data.groups) {
        const row = node('div','');
        row.append(node('dt',groupNames[group.name]),node('dd',`${bytesLabel(group.bytes)} · ${group.files} 个文件`));
        $('storage-groups').append(row);
      }
      for (const issue of data.issues) $('storage-issues').append(node('li',issue));
      $('storage-issues').hidden = !data.issues.length;
      $('storage-total').textContent = `${data.complete ? '已扫描运行文件' : '仅已扫描部分'}：${bytesLabel(data.bytes)} · ${data.files} 个文件`;
      $('storage-scan-time').textContent = `统计时间：${new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'medium',hour12:false}).format(new Date(data.scannedAt))}（北京时间）`;
      $('storage-results').hidden = false;
      setStatus(data.complete ? '统计完成。这是文件逻辑大小，不是磁盘剩余空间；没有删除或移动任何记录。' : '统计未完整完成，以上只是已扫描部分，不能视为总占用。请查看下方说明。', !data.complete);
      loaded = true;
    } catch (error) { $('storage-results').hidden = true; setStatus(`${error.message} 可点击“刷新存储概况”重试。`,true); }
    finally { loading = false; controls(); }
  };
  $('storage-panel').addEventListener('toggle',() => { if ($('storage-panel').open && !loaded) return refresh(); });
  $('storage-refresh').addEventListener('click',refresh);
  $('storage-export').addEventListener('click',async () => {
    if (loading || exporting) return;
    exporting = true; controls(); setStatus('正在读取并核验全部已保存修改与独立验证记录…');
    try {
      const data = await validateEvidenceBundle(await api('/api/evidence-export',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true})
      },MAX_EVIDENCE_BUNDLE_BYTES));
      // Keep compact serialization so the actual downloaded file retains the 32 MiB bound.
      const json = JSON.stringify(data);
      download(`doctor-evidence-${exportDate(data.exportedAt)}.json`,json,'application/json');
      const unknown = data.verifications.filter(item => item.state === 'unknown').length;
      setStatus(`已核验并下载 ${data.counts.revisions} 份修改、${data.counts.verifications} 份独立验证记录${unknown ? `，其中 ${unknown} 份验证仍待确认` : ''}。导出不改变原记录或验证结论。`);
    } catch (error) { setStatus(`${error.message} 本次没有下载材料，也没有删除本机记录。`,true); }
    finally { exporting = false; controls(); }
  });
  controls();
  return {refresh};
}
