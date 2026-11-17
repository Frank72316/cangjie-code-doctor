// Reading aids only: no candidate answers, corpus edits, reranking or AI calls.
// Quotes must occur verbatim in this retrieval's returned documents.
export function documentGuide(evidence, diagnostics, source) {
  if (evidence.queryOrigin !== 'diagnostics') return [];
  const lines = source.split(/\r?\n/);
  return diagnostics.filter(d => d.severity === 'error').map(d => {
    const line = d.canLocate ? d.line : null;
    const code = line ? lines[line - 1] || '' : '';
    let title = '先核对这条报错', meaning = d.message, check = '', rules = [];
    const types = d.hint.match(/^expected '([^']+)', found '([^']+)'$/);
    if (d.code === 'sema_mismatched_types' && types) {
      const display = t => t === 'Struct-String' ? 'String（字符串）' : t;
      title = `这里需要 ${display(types[1])}，实际是 ${display(types[2])}`;
      meaning = '';
      // Only apply the initialization rule to a single-line declaration whose
      // reported column is inside the RHS. Other type errors retain generic advice.
      const declaration = code.match(/^\s*(?:let|var)\s+[\p{L}_][\p{L}\p{N}_]*\s*:\s*[\w<>]+\s*=/u);
      if (declaration && d.column > declaration[0].length && !code.slice(declaration[0].length).includes(';')) {
        check = '核对等号两边：左边声明的类型，要与右边的值一致。按题目要求决定改初始值还是改类型。';
        rules.push(['variables-initialization', '如果标注了变量类型，需要保证初始值类型和变量类型一致。', '变量声明与初始值要一致']);
      } else {
        check = '检查报错位置的值，以及接收它的变量、函数参数或返回值要求的类型。先确认程序需要什么值，再决定改值还是改类型声明。';
      }
      if (types[2] === 'Struct-String') {
        rules.push(['string-literals', '**单行字符串字面量**的内容定义在一对单引号或一对双引号之内', '引号里的内容是字符串']);
      }
      if (types.includes('Struct-String')) {
        check += ' 引号里的文本不会自动变成整数，不能直接套用数值转换示例。';
      }
    } else if (d.code === 'sema_wrong_number_of_arguments') {
      const count = d.hint.match(/^expected (\d+) arguments?, found (\d+)$/);
      title = count ? `这次调用需要 ${count[1]} 个参数，实际传了 ${count[2]} 个` : '函数调用的参数数量不对';
      meaning = '把报错处的调用，与它对应的函数定义放在一起看。';
      check = '逐项核对括号里的参数数量、顺序和含义；缺少的值要按程序要求补齐。有默认值的命名参数需单独核对，不要随意填一个数。';
      rules = [['function-call', '函数调用的形式为 `f(arg1, arg2, ..., argn)`。', '按函数定义核对调用参数'],
        ['function-definition', '参数列表定义在一对圆括号内（多个参数间使用逗号分隔）', '在函数定义的括号里找参数列表']];
    } else if (d.code === 'sema_undeclared_identifier') {
      const name = d.message.match(/^undeclared identifier '([^']+)'$/)?.[1];
      title = name ? `这里找不到「${name}」的声明` : '这里使用了未声明的名字';
      meaning = '编译器在当前位置无法找到这个名字；不一定只是漏写变量。';
      check = '先检查名字是否拼错、是否已经声明，再检查声明是否在当前可见的作用域内。若它应表示计算结果，先定义并计算它，再使用。';
      rules = [['local-variable-scope', '它的作用域从其定义之后开始到函数体结束。', '局部变量必须先定义，再使用'],
        ['lexical-scope', '当前作用域中定义的程序元素与名字的绑定关系，在当前作用域和其内层作用域中是有效的，可以通过此名字直接访问对应的程序元素。', '检查这个名字是否在可见范围内定义']];
    }
    const quotes = rules.flatMap(([id, quote, label]) => {
      const result = evidence.results.find(r => r.id === id && r.text.includes(quote));
      return result ? [{id, quote, label, url: result.url, section: result.section}] : [];
    });
    return {line, code, title, meaning, check, quotes, diagnostic: `${d.code}: ${d.message}${d.hint ? '\n' + d.hint : ''}`};
  });
}

// Small text-only Markdown reader. Never interprets HTML, links or images.
// Exact original text remains in the persisted JSON and a separate disclosure.
export function appendDocumentText(parent, text, doc = document) {
  const inline = (target, value) => {
    for (const part of value.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g)) {
      const tag = part.startsWith('`') && part.endsWith('`') ? 'code'
        : part.startsWith('**') && part.endsWith('**') ? 'strong' : null;
      const el = doc.createElement(tag || 'span');
      el.textContent = tag === 'code' ? part.slice(1,-1) : tag === 'strong' ? part.slice(2,-2) : part;
      target.append(el);
    }
  };
  let code = null;
  for (const line of text.split('\n')) {
    if (/^```/.test(line)) {
      if (code) code = null;
      else { const pre = doc.createElement('pre'); code = doc.createElement('code'); pre.append(code); parent.append(pre); }
    } else if (code) code.textContent += line + '\n';
    else if (line.trim() && !/^\s*<!--.*-->\s*$/.test(line)) {
      const p = doc.createElement(/^#{1,6} /.test(line) ? 'h4' : 'p');
      inline(p, line.replace(/^#{1,6} /,'').replace(/^>\s?/,'')); parent.append(p);
    }
  }
}
