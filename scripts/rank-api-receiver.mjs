import {rankApiSections} from './rank-api-sections.mjs';

// Conservative extraction for the single-function repairs in this experiment.
export function receiverOwner(corpus, source) {
  const code = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
  const first = /\bfunc\s+\w+\s*\(([^()]*)\)\s*(?::[^{]+)?\{/.exec(code);
  if (!first) return null;
  const tail = code.slice(first.index + first[0].length);
  let depth = 1, end = 0;
  while (depth && end < tail.length) {
    if (tail[end] === '{') depth++;
    if (tail[end] === '}') depth--;
    end++;
  }
  if (depth) return null;
  const body = tail.slice(0, end - 1);
  const owners = new Set(corpus.documents.map(doc => doc.title));
  const variables = new Map();
  function bind(name, type) {
    const previous = variables.get(name);
    variables.set(name, previous === undefined || previous === type ? type : null);
  }
  for (const m of first[1].matchAll(/(?:^|,)\s*(\w+)\s*:\s*(\w+)/g)) bind(m[1], m[2]);
  for (const m of body.matchAll(/\b(?:let|var)\s+(\w+)\s*(?::\s*(\w+)|=\s*(\w+)(?=\s*[<(]))/g)) bind(m[1], m[2] ?? m[3]);
  const used = new Set();
  for (const m of body.matchAll(/(?<![\w.])(\w+)\s*\./g)) {
    const type = variables.get(m[1]);
    if (owners.has(type)) used.add(type);
    else return null;
  }
  return used.size === 1 ? [...used][0] : null;
}

export function rankWithReceiver(corpus, task, source) {
  const field = rankApiSections(corpus, task, source);
  const owner = receiverOwner(corpus, source);
  if (!owner) return {owner, ranks:field};
  const compatible = new Set(corpus.documents.filter(d => d.title === owner).map(d => d.id));
  return {owner, ranks:[...field.filter(d => compatible.has(d.id)), ...field.filter(d => !compatible.has(d.id))]};
}
