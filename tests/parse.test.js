import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// src/parse.js はブラウザ用の通常スクリプトなので、vm で読み込む。
const src = fileURLToPath(new URL('../src/parse.js', import.meta.url));
const sandbox = {};
vm.runInNewContext(readFileSync(src, 'utf8'), sandbox);
// vm 側で作られた配列・オブジェクトを、テスト側の realm に戻して比べる。
const parse = (text, name) => JSON.parse(JSON.stringify(sandbox.Mindra.parseMarkdown(text, name)));

// 木を「テキストの入れ子」だけに縮めて比べやすくする。
const shape = (node) => ({
  text: node.text,
  children: node.children.map(shape),
});

test('見出しの階層がそのままノードの階層になる', () => {
  const { root } = parse('# 旅行\n\n## 持ち物\n- パスポート\n- 充電器\n  - 変換プラグ\n\n## 予定\n- 1 日目\n', 'x');
  assert.deepEqual(shape(root), {
    text: '旅行',
    children: [
      {
        text: '持ち物',
        children: [
          { text: 'パスポート', children: [] },
          { text: '充電器', children: [{ text: '変換プラグ', children: [] }] },
        ],
      },
      { text: '予定', children: [{ text: '1 日目', children: [] }] },
    ],
  });
});

test('見出しの下の箇条書きは、その見出しの子になる', () => {
  const { root } = parse('# A\n## B\n- c\n- d\n', 'x');
  assert.deepEqual(shape(root.children[0]).children.map((c) => c.text), ['c', 'd']);
});

test('浅い見出しが来ると、深い見出しと箇条書きが閉じる', () => {
  const { root } = parse('# R\n## A\n- a1\n### A1\n- x\n## B\n- b1\n', 'x');
  assert.deepEqual(shape(root), {
    text: 'R',
    children: [
      { text: 'A', children: [{ text: 'a1', children: [] }, { text: 'A1', children: [{ text: 'x', children: [] }] }] },
      { text: 'B', children: [{ text: 'b1', children: [] }] },
    ],
  });
});

test('見出しの階層が飛んでも、浅い直近の見出しの子になる', () => {
  const { root } = parse('# R\n### deep\n', 'x');
  assert.deepEqual(shape(root), { text: 'R', children: [{ text: 'deep', children: [] }] });
});

test('# 見出しが無ければ、ファイル名がルートになる', () => {
  const { root } = parse('## A\n- a\n', 'memo');
  assert.equal(root.text, 'memo');
  assert.deepEqual(shape(root).children.map((c) => c.text), ['A']);
});

test('# 見出しは、どれも別の一番上の題目になる。最初の # より前の内容は、ファイル名の題目にまとめる', () => {
  const { roots } = parse('## 先頭\n# 一つ目\n## 子\n# 二つ目\n- x\n', 'f');
  assert.deepEqual(roots.map((r) => r.text), ['f', '一つ目', '二つ目']);
  assert.deepEqual(shape(roots[0]).children.map((c) => c.text), ['先頭']);
  assert.deepEqual(shape(roots[1]).children.map((c) => c.text), ['子']);
  assert.deepEqual(shape(roots[2]).children.map((c) => c.text), ['x']);
});

test('段落・表・引用は無視される', () => {
  const { root } = parse('# R\n\n段落です。\n\n| a | b |\n|---|---|\n> 引用\n- 項目\n', 'x');
  assert.deepEqual(shape(root), { text: 'R', children: [{ text: '項目', children: [] }] });
});

test('コードブロックの中の # や - は図にしない', () => {
  const { root } = parse('# R\n```\n# not heading\n- not item\n```\n- ok\n', 'x');
  assert.deepEqual(shape(root), { text: 'R', children: [{ text: 'ok', children: [] }] });
});

test('front matter は本文から外し、view を返す', () => {
  const result = parse('---\nview: mindmap\n---\n# R\n- a\n', 'x');
  assert.equal(result.view, 'mindmap');
  assert.equal(result.warning, null);
  assert.deepEqual(shape(result.root), { text: 'R', children: [{ text: 'a', children: [] }] });
});

test('front matter が無ければ mindmap として扱う', () => {
  assert.equal(parse('# R\n', 'x').view, 'mindmap');
});

test('未知の view はマインドマップとして表示し、注意を返す', () => {
  const result = parse('---\nview: flowchart\n---\n# R\n', 'x');
  assert.equal(result.view, 'flowchart');
  assert.match(result.warning, /flowchart/);
  assert.equal(result.root.text, 'R');
});

test('インライン記法は記号を取り除いて文字だけにする', () => {
  const { root } = parse('# **太字** と `コード`\n- [リンク](https://example.com)\n', 'x');
  assert.equal(root.text, '太字 と コード');
  assert.equal(root.children[0].text, 'リンク');
});

test('空のラベルの見出しと箇条書きは無視する', () => {
  const { root } = parse('# R\n## \n- \n- a\n', 'x');
  assert.deepEqual(shape(root), { text: 'R', children: [{ text: 'a', children: [] }] });
});

test('新規ファイルの初期内容は、view を持ち、題名がルートになる', () => {
  const text = sandbox.Mindra.newDocumentText('mindmap', '新しい計画');
  const result = parse(text, 'x');
  assert.equal(result.view, 'mindmap');
  assert.equal(result.warning, null);
  assert.equal(result.root.text, '新しい計画');
});

test('先頭の BOM があっても front matter を読める', () => {
  const result = parse('﻿---\nview: mindmap\n---\n# R\n', 'x');
  assert.equal(result.view, 'mindmap');
  assert.equal(result.root.text, 'R');
});

test('ノードの直下の引用は、そのノードのコメントになり、木の要素にはならない', () => {
  const result = parse('# R\n- a\n  > note one\n  > note two\n- b\n', 'x');
  assert.deepEqual(shape(result.root), {
    text: 'R',
    children: [
      { text: 'a', children: [] },
      { text: 'b', children: [] },
    ],
  });
  assert.deepEqual(result.root.children[0].comment, ['note one', 'note two']);
});

test('空行で切れた引用は、コメントにならない', () => {
  const result = parse('# R\n- a\n\n> loose\n', 'x');
  assert.equal(result.root.children[0].comment, undefined);
});

test('行末の色の指定は名前から外して、色として返す', () => {
  const result = parse('# R\n- a {color:#ff8800}\n- b\n', 'x');
  assert.equal(result.root.children[0].text, 'a');
  assert.equal(result.root.children[0].color, '#ff8800');
  assert.equal(result.root.children[1].color, null);
});
