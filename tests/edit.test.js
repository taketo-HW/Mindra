import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// src/*.js はブラウザ用の通常スクリプトなので、同じ vm の中で読み込む。
const ctx = vm.createContext({});
for (const file of ['../src/parse.js', '../src/edit.js']) {
  vm.runInContext(readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8'), ctx);
}
const M = ctx.Mindra;
const parse = (text, name = 'memo') => JSON.parse(JSON.stringify(M.parseMarkdown(text, name)));

// 木を、テキストの入れ子だけにする（比較用）。
const shape = (node) => ({ text: node.text, children: node.children.map(shape) });

// 木の中から、文字が一致するノードを探す（テスト用）。
const find = (tree, label) => {
  if (tree.text === label) return tree;
  for (const child of tree.children) {
    const found = find(child, label);
    if (found) return found;
  }
  return null;
};

// 解析 → 操作 → 書き戻し後の文字列、を一度に行う。
const edit = (text, label, op, arg, fileName = 'memo') => {
  const tree = parse(text, fileName).root;
  const node = find(tree, label);
  return op(text, node, arg);
};

test('名前を変えると、その行だけが変わり、記号は残る', () => {
  const text = '# 旅行\n## 持ち物\n- パスポート\n';
  const result = edit(text, 'パスポート', M.renameNode, '航空券');
  assert.equal(result.text, '# 旅行\n## 持ち物\n- 航空券\n');
  assert.equal(result.line, 2);
});

test('名前を変えても、箇条書きのインデントは残る', () => {
  const result = edit('- a\n  - b\n', 'b', M.renameNode, 'c');
  assert.equal(result.text, '- a\n  - c\n');
});

test('見出しの名前を変えても、# の数は残る', () => {
  const result = edit('# 旅行\n## 持ち物\n', '持ち物', M.renameNode, '荷物');
  assert.equal(result.text, '# 旅行\n## 荷物\n');
});

test('見出しに子を足すと、その見出しの下に入る（深い見出しとして）', () => {
  const text = '# 旅行\n## 持ち物\n- パスポート\n## 予定\n';
  const result = edit(text, '持ち物', M.addChild, '新しい項目');
  assert.equal(result.text, '# 旅行\n## 持ち物\n- パスポート\n\n### 新しい項目\n## 予定\n');
  assert.deepEqual(shape(parse(result.text).root), {
    text: '旅行',
    children: [
      {
        text: '持ち物',
        children: [
          { text: 'パスポート', children: [] },
          { text: '新しい項目', children: [] },
        ],
      },
      { text: '予定', children: [] },
    ],
  });
});

test('箇条書きに子を足すと、2 つ深いインデントの箇条書きになる', () => {
  const text = '## A\n- x\n- y\n';
  const result = edit(text, 'x', M.addChild, '新');
  assert.equal(result.text, '## A\n- x\n  - 新\n- y\n');
});

test('# ルートに子を足すと、2 つ目の深さの見出しになる', () => {
  const result = edit('# R\n- a\n', 'R', M.addChild, '新');
  assert.equal(result.text, '# R\n- a\n\n## 新\n');
});

test('ファイル名のルートに子を足すと、末尾に見出しとして足す（末尾の改行は残る）', () => {
  const result = edit('## A\n', 'memo', M.addChild, '新', 'memo');
  assert.equal(result.text, '## A\n\n## 新\n');
});

test('ファイル名のルートは名前を変えられない', () => {
  const result = edit('- a\n', 'memo', M.renameNode, '新', 'memo');
  assert.match(result.error, /file name/);
});

test('表示時と違う行なら、書き換えずに失敗する', () => {
  const tree = parse('- a\n- b\n').root;
  const node = find(tree, 'a');
  const result = M.renameNode('- z\n- b\n', node, '新');
  assert.match(result.error, /changed outside/);
});

test('空の名前や改行を含む名前は失敗する', () => {
  assert.match(edit('- a\n', 'a', M.renameNode, '  ').error, /empty/);
  assert.match(edit('- a\n', 'a', M.renameNode, '1\n2').error, /one line/);
});

test('改行コード（CRLF）は、そのまま保たれる', () => {
  const result = edit('# R\r\n- a\r\n', 'a', M.addChild, '新');
  assert.equal(result.text, '# R\r\n- a\r\n  - 新\r\n');
});

test('先頭の BOM と front matter は保たれる', () => {
  const text = '﻿---\nview: mindmap\n---\n# R\n';
  const result = edit(text, 'R', M.renameNode, 'S');
  assert.equal(result.text, '﻿---\nview: mindmap\n---\n# S\n');
});

test('追加した行は、返された line で木の中から見つかる', () => {
  const text = '# R\n- a\n- b\n';
  const result = edit(text, 'a', M.addChild, '新');
  const tree = parse(result.text).root;
  assert.equal(M.findPathByLine(tree, result.line), '0.0.0');
  assert.equal(M.nodeAt(tree, '0.0.0').text, '新');
});

test('コメントを足すと、ノードの直下に「> 」の行で入る（箇条書きは 2 つ深く）', () => {
  const result = edit('- a\n- b\n', 'a', M.setComment, 'hi');
  assert.equal(result.text, '- a\n  > hi\n- b\n');
});

test('見出しのコメントは、インデントなしで入る', () => {
  const result = edit('# R\n## A\n', 'A', M.setComment, 'c');
  assert.equal(result.text, '# R\n## A\n> c\n');
});

test('コメントを置き換えると、古い引用の行だけが変わる', () => {
  const result = edit('- a\n  > old\n- b\n', 'a', M.setComment, 'new');
  assert.equal(result.text, '- a\n  > new\n- b\n');
});

test('空のコメントにすると、引用の行が消える', () => {
  const result = edit('- a\n  > old\n- b\n', 'a', M.setComment, '');
  assert.equal(result.text, '- a\n- b\n');
});

test('複数行のコメントは、空行も含めて「>」の行になる', () => {
  const result = edit('- a\n', 'a', M.setComment, 'x\n\ny');
  assert.equal(result.text, '- a\n  > x\n  >\n  > y\n');
});

test('コメントの後ろに子を足すと、コメントの後に入る', () => {
  const result = edit('- a\n  > note\n- b\n', 'a', M.addChild, 'New item');
  assert.equal(result.text, '- a\n  > note\n  - New item\n- b\n');
});

test('子を複数まとめて足すと、同じ位置に同じ深さで並ぶ', () => {
  const tree = parse('- a\n- b\n').root;
  const result = M.addChildren('- a\n- b\n', find(tree, 'a'), ['x', 'y']);
  assert.equal(result.text, '- a\n  - x\n  - y\n- b\n');
  assert.equal(result.line, 1);
});

test('見出しに複数の子を足すと、1 段深い見出しになる', () => {
  const tree = parse('# R\n## A\n').root;
  const result = M.addChildren('# R\n## A\n', find(tree, 'A'), ['x', 'y']);
  assert.equal(result.text, '# R\n## A\n\n### x\n### y\n');
});

test('空の一覧は足さない', () => {
  const tree = parse('- a\n').root;
  assert.match(M.addChildren('- a\n', find(tree, 'a'), ['', '  ']).error, /Nothing|empty/);
});

test('LF と CRLF が混ざったファイルでも、編集できて、他の行の改行は変わらない', () => {
  const result = edit('# A\r\n- x\n- z\r\n', 'x', M.renameNode, 'y');
  assert.equal(result.text, '# A\r\n- y\n- z\r\n');
});

test('閉じていないコードブロックの後ろには、ルートの子を足せない', () => {
  const result = edit('- x\n```\n', 'memo', M.addChild, 'y', 'memo');
  assert.match(result.error, /code block/);
});

test('名前に {color:...} を書くと、色として扱われるので、エラーにする', () => {
  assert.match(edit('# A\n- x\n', 'A', M.addChild, 'z {color:#ff0000}').error, /color/);
  assert.match(edit('- x\n', 'x', M.renameNode, 'q {color:#ff0000}').error, /color/);
});

test('ルートの直下に足すと、一番上の項目と同じ深さで、ルートの子孫の後ろに入る', () => {
  const result = M.addChild('# R\n- a\n# S\n', find(parse('# R\n- a\n# S\n').root, 'R'), 'T');
  assert.equal(result.text, '# R\n- a\n\n## T\n# S\n');
});
