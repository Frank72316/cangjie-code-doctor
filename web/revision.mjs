// Offline manual edits are evidence of a user decision, never a compiler result.
import { readRecord, sha256, validateSource, MAX_REPORT_BYTES, MAX_SOURCE_BYTES } from './report.mjs';

export const MAX_REVISION_BYTES = MAX_REPORT_BYTES + MAX_SOURCE_BYTES * 6 + 4096;
const encoder = new TextEncoder();
export const validRevisionId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function candidateSource(source, hashed = false) {
  if (!exactKeys(source, hashed ? ['name','text','sha256'] : ['name','text']) ||
      typeof source.name !== 'string' || typeof source.text !== 'string' ||
      source.name.length > 128 || /[\x00-\x1f\x7f/\\:*?"<>|]/.test(source.name) || source.name.includes('..'))
    throw new Error('修改副本需要有效的 .cj 文件名和源码，不接受路径或其他字段。');
  validateSource(source.name, source.text);
}
async function validateBaseAndSource(baseRecord, source) {
  await readRecord(JSON.stringify(baseRecord));
  if (baseRecord.source.name === source.name && baseRecord.source.text === source.text)
    throw new Error('修改副本与原诊断记录相同，无需保存。');
}
export async function validateRevisionInput(input) {
  if (!exactKeys(input, ['baseRecord','source','confirmed']) || input.confirmed !== true)
    throw new Error('请核对差异并明确确认保存；只接受原记录、修改副本和确认状态。');
  candidateSource(input.source);
  await validateBaseAndSource(input.baseRecord, input.source);
  return input;
}
export async function validateRevision(data) {
  if (!exactKeys(data, ['schemaVersion','kind','revisionId','createdAt','baseRecord','recordSha256',
    'source','origin','compileStatus','testStatus','execution']) || data.schemaVersion !== 1 ||
      data.kind !== 'doctor-manual-revision' || !validRevisionId(data.revisionId) ||
      typeof data.createdAt !== 'string' || !Number.isFinite(Date.parse(data.createdAt)) ||
      new Date(data.createdAt).toISOString() !== data.createdAt || data.origin !== 'manual' ||
      data.compileStatus !== 'not_run' || data.testStatus !== 'not_run' ||
      !exactKeys(data.execution, ['attempted']) || data.execution.attempted !== false)
    throw new Error('不支持的手动修改记录或状态；修改副本不能声明编译或测试通过。');
  if (encoder.encode(JSON.stringify(data)).length > MAX_REVISION_BYTES) throw new Error('修改记录超过大小限制。');
  candidateSource(data.source, true);
  await validateBaseAndSource(data.baseRecord, data.source);
  if (data.recordSha256 !== await sha256(JSON.stringify(data.baseRecord)) ||
      data.source.sha256 !== await sha256(data.source.text)) throw new Error('修改记录 SHA-256 不匹配。');
  return data;
}

// A bounded LCS preserves repeated lines and the final empty line (a final LF).
export function lineDiff(before, after) {
  if (typeof before !== 'string' || typeof after !== 'string') throw new Error('差异输入必须是源码文本。');
  validateSource('before.cj', before); validateSource('after.cj', after);
  const oldLines = before.split('\n'), newLines = after.split('\n');
  const lengths = Array.from({length:oldLines.length + 1}, () => new Uint16Array(newLines.length + 1));
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      lengths[i][j] = oldLines[i] === newLines[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const rows = []; let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      rows.push({kind:'equal',beforeLine:i + 1,afterLine:j + 1,text:oldLines[i]}); i++; j++;
    } else if (i < oldLines.length && (j === newLines.length || lengths[i + 1][j] >= lengths[i][j + 1])) {
      rows.push({kind:'remove',beforeLine:i + 1,afterLine:null,text:oldLines[i++]});
    } else { rows.push({kind:'add',beforeLine:null,afterLine:j + 1,text:newLines[j++]}); }
  }
  return rows;
}
