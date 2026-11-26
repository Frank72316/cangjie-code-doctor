import {harnessSource} from './pilot-holdout.mjs';

// The public examples in the frozen task are the oracle, even if the answer edits main().
export function formalPublicSource(code, problem) {
  const entry = problem.source.text.match(/\nmain\(\)\s*\{([\s\S]*)\}\s*$/);
  if (!entry) throw Error('Missing frozen public main');
  return harnessSource(code, entry[1]);
}
