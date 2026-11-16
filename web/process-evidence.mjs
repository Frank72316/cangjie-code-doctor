// Shared byte-level evidence checks, usable in Node and browsers.
// Digests bind content, not the identity or honesty of its author.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {ignoreBOM:true});
const requireThat = (ok,message) => { if (!ok) throw new Error(message); };
export function verificationRequestText(source,tests) {
  return JSON.stringify({source:{name:source.name,text:source.text},tests:tests.map(t=>({id:t.id,stdin:t.stdin,expectedStdout:t.expectedStdout}))});
}
export async function bytesSha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function validateProcessBytes(process, maximum, rawRequired) {
  const streams = {};
  for (const stream of ['stdout','stderr']) {
    const displayed=process[stream], length=process[`${stream}Bytes`], hash=process[`${stream}Sha256`];
    const encoded=process[`${stream}Base64`];
    if (rawRequired || encoded !== undefined) {
      requireThat(typeof encoded==='string' && encoded.length<=4*Math.ceil(maximum/3)
        && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded), '原始输出 Base64 缺失、超限或格式无效。');
      const binary=atob(encoded);
      requireThat(btoa(binary)===encoded,'原始输出 Base64 不是规范编码。');
      const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
      requireThat(bytes.length===length && await bytesSha256(bytes)===hash,'原始输出字节数或 SHA-256 不一致。');
      requireThat(decoder.decode(bytes)===displayed,'显示输出与原始字节不一致。');
      streams[stream]=bytes;
    } else if (!displayed.includes('\uFFFD')) {
      // A replacement-free legacy display can be checked by UTF-8 round-trip.
      // Never manufacture original bytes when a replacement marker is present.
      const bytes=encoder.encode(displayed);
      requireThat(bytes.length===length && await bytesSha256(bytes)===hash,'旧版输出文本、字节数或 SHA-256 不一致。');
      streams[stream]=bytes;
    } else streams[stream]=null;
  }
  return streams;
}
export function verificationIntegrity(data) {
  const report=data?.report;
  if (!report) return {state:'absent',label:'未产生输出证据',detail:'没有完整验证报告，不能核对执行输出或补出测试结论。'};
  if (report.schemaVersion!==2) return {state:'legacy',label:'旧版报告 · 原始字节核验受限',detail:'可还原的 UTF-8 文本已核对长度与摘要；旧格式未完整内嵌原始字节，含替换字符的输出无法完整核验。原结论仅作历史记录，不是重新执行。'};
  const processes=[report.compile?.process,...(report.tests || []).map(t=>t.process)].filter(Boolean);
  if (!processes.length) return {state:'absent',label:'未采集到进程输出',detail:'输入已绑定，但没有进程输出可核对；不表示编译或测试通过。'};
  return {state:'verified',label:'已采集输出字节核验通过',detail:'已核对原始字节、显示文本、长度、摘要与测试输入绑定。异常时只核验已采集部分，不代表输出完整；哈希不是来源认证，也不改变测试结论。'};
}
