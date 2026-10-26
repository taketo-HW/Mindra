import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// ブラウザ用の通常スクリプトを、vm の中で読み込む（読み取りの部分だけを試す）。
const ctx = vm.createContext({});
for (const file of ['src/parse.js', 'src/view-kit.js', 'src/view-radar.js']) {
  vm.runInContext(readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8'), ctx);
}
const M = ctx.Mindra;
const j = (x) => JSON.parse(JSON.stringify(x));
const doc = (body) => `---\nview: radar\n---\n${body}`;
const parse = (body) => j(M.views.radar.parse(doc(body), 'file'));

test('レーダー: 仕様の例を、区切りごとの系列にする', () => {
  const model = parse('# 性能の比較\n\n## 案A\n- 速さ: 4\n- 安さ: 3\n- 使いやすさ: 5\n## 案B\n- 速さ: 2\n- 安さ: 5\n- 使いやすさ: 3\n');
  assert.deepEqual(model, {
    title: '性能の比較',
    axes: ['速さ', '安さ', '使いやすさ'],
    series: [
      { name: '案A', values: [4, 3, 5] },
      { name: '案B', values: [2, 5, 3] },
    ],
    max: 5,
  });
});

test('レーダー: 区切りが無ければ 1 つの系列（名前なし）', () => {
  const model = parse('# 自己評価\n- 体力: 3\n- 知識: 1,200\n- 気力: 2.5\n');
  assert.deepEqual(model.series, [{ name: '', values: [3, 1200, 2.5] }]);
  assert.equal(model.max, 1200);
});

test('レーダー: 軸は最初に出た順、系列に無い項目は 0、負の数は 0', () => {
  const model = parse('## A\n- x: 1\n- y: -3\n## B\n- z: 2\n- x: 4\n');
  assert.deepEqual(model.axes, ['x', 'y', 'z']);
  assert.deepEqual(model.series, [
    { name: 'A', values: [1, 0, 0] },
    { name: 'B', values: [4, 0, 2] },
  ]);
});

test('レーダー: 数の無い行と、数の無い区切りは使わない', () => {
  const model = parse('## 空\n- メモ\n## A\n- a: 1\n- b: なし\n- c: 3\n');
  assert.deepEqual(model.axes, ['a', 'c']);
  assert.deepEqual(model.series, [{ name: 'A', values: [1, 3] }]);
});

test('レーダー: 何も無ければ空、題名はファイル名', () => {
  assert.deepEqual(parse('文だけ\n'), { title: 'file', axes: [], series: [], max: 0 });
});
