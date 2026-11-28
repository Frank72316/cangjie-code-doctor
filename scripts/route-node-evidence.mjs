// Route the two pinned node/Option cards on single-function LinkedList programs.
// Example calls in main, quoted text and comments provide no evidence here.
export function routeNodeEvidence(source, task) {
  const clean = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
  const target = clean.split(/\bmain\s*\(/, 1)[0];
  const hasNode = /\bLinkedListNode\b|\.\s*(?:firstNode|lastNode|nodeAt)\b/.test(target);
  const ignoresPosition = /忽略(?:当前)?(?:位置|光标|游标|标记)|(?:不依赖|不使用|无关).{0,5}(?:位置|光标|游标)|(?:整表|全表)统计/.test(task);
  const mentionsPosition = /光标|游标|邻项|相邻节点|书签|前驱|后继|匹配.{0,5}节点|该节点/.test(task);
  return {sourceOnly:hasNode, combined:!ignoresPosition && (mentionsPosition || hasNode)};
}
