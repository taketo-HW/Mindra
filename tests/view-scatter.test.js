import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// ブラウザ用の通常スクリプトを、vm の中で読み込む（読み取りの部分だけを試す）。
const ctx = vm.createContext({});
for (const file of ['src/parse.js', 'src/view-kit.js', 'src/view-scatter.js']) {
  vm.runInContext(readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8'), ctx);
}
const M = ctx.Mindra;
const j = (x) => JSON.parse(JSON.stringify(x));
const doc = (view, body) => `---\nview: ${view}\n---\n${body}`;

const parse = (body) => j(M.views.scatter.parse(doc('scatter', body), 'x.md'));

test('scatter: 仕様の例を、軸の名前と点に分ける', () => {
  assert.deepEqual(parse('# 施策の優先度\n\n- 横軸: 効果\n- 縦軸: 手軽さ\n- 案A: 8, 7\n- 案B: 3, 9\n- 案C: 6, 2\n'), {
    title: '施策の優先度',
    xLabel: '効果',
    yLabel: '手軽さ',
    points: [
      { label: '案A', x: 8, y: 7 },
      { label: '案B', x: 3, y: 9 },
      { label: '案C', x: 6, y: 2 },
    ],
  });
});

test('scatter: 区切りは「、」や全角のコロンでもよい。小数と 10 を超える値もそのまま', () => {
  assert.deepEqual(parse('- 案A：1.5、2\n- 案B: 12, 30\n').points, [
    { label: '案A', x: 1.5, y: 2 },
    { label: '案B', x: 12, y: 30 },
  ]);
});

test('scatter: 軸の名前を省けば空。数を含む軸の行や、数が 1 つの行は使わない', () => {
  const model = parse('# 図\n\n- 横軸: 2026年\n- 案A: 5\n- 案B: 1, 2, 3\n- ただのメモ\n- 案C: 4, 4\n');
  assert.equal(model.xLabel, '');
  assert.equal(model.yLabel, '');
  assert.deepEqual(model.points, [{ label: '案C', x: 4, y: 4 }]);
});

test('scatter: 見出しが無ければ題名はファイル名。点が無ければ空の並び', () => {
  assert.deepEqual(parse('メモだけ\n'), { title: 'x.md', xLabel: '', yLabel: '', points: [] });
});

test('scatter: コードブロックの中は読まない', () => {
  assert.deepEqual(parse('```\n- 案A: 1, 2\n```\n- 案B: 3, 4\n').points, [{ label: '案B', x: 3, y: 4 }]);
});
