// Offline experiment: index the same versioned API entries as the native BM25 baseline.
const vocabulary = [
  [/码点|unicode|万国码/i, ['rune']],
  [/字节|utf.?8/i, ['byte','utf8']],
  [/分割|分段|分隔/, ['split']],
  [/最多|上限|至多/, ['max']],
  [/前缀|开头匹配/, ['prefix']],
  [/后缀|末尾匹配|末尾.*整个/, ['suffix']],
  [/修剪|修整/, ['trim']],
  [/起始|左端|开头/, ['start']],
  [/末尾|尾部|右端/, ['end']],
  [/删[去除]|移除/, ['remove']],
  [/复制|副本|拷贝/, ['clone','copy']],
  [/小写/, ['lower']],
  [/大写/, ['upper']],
  [/解析|十进制/, ['parse']],
  [/集合/, ['set','collection']],
];

function tokens(text) {
  const words = new Set();
  const clean = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  for (const run of clean.match(/[a-zA-Z][a-zA-Z0-9]*|[\p{Script=Han}]+/gu) ?? []) {
    if (/^[A-Za-z]/.test(run)) {
      words.add(run.toLowerCase());
      for (const word of run.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(' ')) words.add(word);
    } else {
      const chars = [...run];
      if (chars.length === 1) words.add(run);
      for (let i = 1; i < chars.length; i++) words.add(chars[i-1] + chars[i]);
    }
  }
  return words;
}

export function rankApiSections(corpus, task, source) {
  const intent = task.split(/保留所有公开函数|保留函数签名/)[0];
  const query = tokens(intent);
  const concepts = new Set(vocabulary.flatMap(([pattern, terms]) => pattern.test(intent) ? terms : []));
  // Identify receiver types from the function declaration, omitting the return annotation.
  const params = (source.match(/\bfunc\s+\w+\s*\(([^)]*)\)/) ?? [,''])[1];
  const types = new Set(params.match(/\b(?:ArrayList|Array|HashSet|HashMap|String|Option|Duration|Int64)\b/g) ?? []);
  const entries = corpus.documents.map(doc => {
    const signature = doc.text.match(/```cangjie\s*\n([^\n]+)/)?.[1] ?? doc.section;
    const name = doc.section.replace(/^(?:static |operator )?(?:func |prop |const )?/, '').split(/[(<\\]/)[0];
    const description = doc.text.split(/```\s*\n\s*功能：/).at(-1).split(/\n(?:参数|返回值|异常)：/)[0];
    return {doc, name:tokens(name), signature:tokens(signature), description:tokens(description)};
  });
  const df = new Map();
  for (const e of entries) {
    for (const t of new Set([...e.name,...e.signature,...e.description])) df.set(t, (df.get(t) ?? 0)+1);
  }
  const scored = entries.map(e => {
    let score = types.has(e.doc.title) ? 2 : 0;
    for (const t of new Set([...query,...concepts])) {
      const idf = Math.log(1+(entries.length-(df.get(t)??0)+0.5)/((df.get(t)??0)+0.5));
      const field = (e.name.has(t)?4:0)+(e.signature.has(t)?1.5:0)+(e.description.has(t)?1:0);
      score += idf * field * (concepts.has(t)?1.5:1);
    }
    return {id:e.doc.id,score};
  });
  return scored.sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id,'en'));
}
