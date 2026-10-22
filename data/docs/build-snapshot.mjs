// Rebuild from the pinned, locally cloned official documentation repository.
// No network access and no evaluation-case or test inputs are used.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = dirname(fileURLToPath(import.meta.url));
const upstream = resolve(process.argv[2] ?? resolve(output, '../../tmp/upstream-docs-1.0.5'));
const revision = 'f8f8cd75a336e23785a4c57bd6091b2adf1e0302';
const snapshotId = 'cangjie-1.0.5-f8f8cd75a336-zh-cn-core-01';
const repository = 'https://github.com/cangjielanguage/cangjie_docs';
const sourceRoot = 'docs/dev-guide/source_zh_cn/';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const blob = path => execFileSync('git', ['-C', upstream, 'show', `${revision}:${path}`], { maxBuffer: 1024 * 1024 });
const checkedRevision = execFileSync('git', ['-C', upstream, 'rev-parse', 'v1.0.5^{commit}'], { encoding: 'utf8' }).trim();
if (checkedRevision !== revision) throw new Error('Official v1.0.5 tag does not resolve to the reviewed revision');

// Each selection is one contiguous verbatim Markdown excerpt. Only outer
// whitespace is trimmed; prose, code, relative links and comments are retained.
const selections = [
  ['variables-initialization', 'basic_programming_concepts/program_structure.md', '程序结构', '变量', '## 变量\n', '例如，下列程序定义了三个'],
  ['immutable-variable', 'basic_programming_concepts/program_structure.md', '程序结构', '变量', '如果尝试修改不可变变量', '当初始值具有明确类型时，可以省略变量类型标注，例如：'],
  ['lexical-scope', 'basic_programming_concepts/program_structure.md', '程序结构', '作用域', '## 作用域\n', '例如在以下名为 `test.cj`'],
  ['identifier-rules', 'basic_programming_concepts/identifier.md', '标识符', '普通标识符', '# 标识符\n', '例如，以下每行字符串都是合法的普通标识符：'],
  ['integer-types', 'basic_data_type/integer.md', '整数类型', '整数类型', '# 整数类型\n', '## 整数类型字面量'],
  ['integer-literals', 'basic_data_type/integer.md', '整数类型', '整数类型字面量', '## 整数类型字面量\n', '## 字符字节字面量'],
  ['string-literals', 'basic_data_type/strings.md', '字符串类型', '字符串字面量', '# 字符串类型\n', '**多行字符串字面量**'],
  ['function-definition', 'function/define_functions.md', '定义函数', '定义函数', '# 定义函数\n', '## 参数列表'],
  ['function-parameters', 'function/define_functions.md', '定义函数', '参数列表', '## 参数列表\n', '## 函数返回值类型'],
  ['function-call', 'function/call_functions.md', '调用函数', '调用函数', '# 调用函数\n', '\n命名参数调用举例：'],
  ['named-argument-defaults', 'function/call_functions.md', '调用函数', '拥有默认值的命名参数', '对于拥有默认值的命名参数，调用时如果没有传实参', null],
  ['function-return-types', 'function/define_functions.md', '定义函数', '函数返回值类型', '## 函数返回值类型\n', '## 函数体'],
  ['local-variable-scope', 'function/define_functions.md', '定义函数', '函数体', '在函数体内定义的变量属于局部变量的一种', '[函数返回值类型](./define_functions.md#函数返回值类型)中提到'],
  ['numeric-conversion', 'class_and_interface/typecast.md', '类型转换', '数值类型之间的转换', '# 类型转换\n', '## `Rune` 到 `UInt32`'],
  ['unit-type', 'basic_data_type/unit.md', 'Unit 类型', 'Unit 类型', '# Unit 类型\n', null],
];

const sources = new Map();
const excerpts = [];
const documents = selections.map(([id, path, title, section, start, end]) => {
  const sourcePath = sourceRoot + path;
  const bytes = blob(sourcePath);
  const original = bytes.toString('utf8');
  const normalized = original.replaceAll('\r\n', '\n');
  const begin = normalized.indexOf(start);
  const finish = end === null ? normalized.length : normalized.indexOf(end, begin + start.length);
  if (begin < 0 || finish < 0) throw new Error(`Missing excerpt delimiter: ${id}`);
  const text = normalized.slice(begin, finish).trim();
  if (text.length < 40 || text.length > 2500) throw new Error(`Unexpected excerpt length: ${id} (${text.length})`);
  if (!normalized.includes(text)) throw new Error(`Excerpt is not verbatim: ${id}`);
  const startLine = normalized.slice(0, begin).split('\n').length;
  const endLine = startLine + text.split('\n').length - 1;
  const url = `${repository}/blob/${revision}/${sourcePath}#L${startLine}-L${endLine}`;
  const hostedUrl = `https://docs.cangjie-lang.cn/docs/1.0.5/dev-guide/source_zh_cn/${path.replace(/\.md$/, '.html')}`;
  sources.set(sourcePath, { path: sourcePath, sha256: sha256(bytes), url: `${repository}/blob/${revision}/${sourcePath}`, hostedUrl });
  excerpts.push({ id, sourcePath, startLine, endLine, sha256: sha256(text), characters: text.length });
  return { id, title, url, section, text };
});

const corpus = { schemaVersion: 1, sdkVersion: '1.0.5', snapshotId, sourceRevision: revision, documents };
const corpusBytes = Buffer.from(JSON.stringify(corpus, null, 2) + '\n', 'utf8');
if (corpusBytes.length > 256 * 1024) throw new Error('Corpus exceeds size limit');
const license = blob('LICENSE');
const copyright = blob('COPYRIGHT');
const manifest = {
  schemaVersion: 1,
  corpusFile: 'cangjie-1.0.5.json',
  corpusSha256: sha256(corpusBytes),
  corpusBytes: corpusBytes.length,
  sdkVersion: '1.0.5',
  snapshotId,
  sourceRevision: revision,
  sourceTag: 'v1.0.5',
  sourceRepository: repository,
  sourceCommitTime: '2025-12-10T18:03:38+08:00',
  sourceVerifiedAt: '2026-10-22T20:07:40+08:00',
  versionEvidence: [
    `${repository}/releases/tag/v1.0.5`,
    'https://docs.cangjie-lang.cn/docs/1.0.5/',
  ],
  language: 'zh-CN',
  selectionRevision: 1,
  selectionNote: '15 contiguous excerpts from official v1.0.5 development-guide Markdown; outer whitespace trimmed, line endings normalized to LF. No translation, paraphrasing, added error examples, evaluation cases or holdout tests.',
  license: {
    spdx: 'CC-BY-4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    upstreamUrl: `${repository}/blob/${revision}/LICENSE`,
    localFile: 'LICENSE-CC-BY-4.0.txt',
    sha256: sha256(license),
    copyright: copyright.toString('utf8').trim(),
    copyrightFile: 'COPYRIGHT.txt',
    copyrightSha256: sha256(copyright),
  },
  sources: [...sources.values()],
  excerpts,
};
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'cangjie-1.0.5.json'), corpusBytes);
await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(resolve(output, 'LICENSE-CC-BY-4.0.txt'), license);
await writeFile(resolve(output, 'COPYRIGHT.txt'), copyright);
console.log(JSON.stringify({ snapshotId, documents: documents.length, corpusBytes: corpusBytes.length, corpusSha256: manifest.corpusSha256, maxExcerptCharacters: Math.max(...excerpts.map(item => item.characters)) }, null, 2));
