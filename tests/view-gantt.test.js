import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// ブラウザ用の通常スクリプトを、vm の中で読み込む（読み取りの部分だけを試す）。
const ctx = vm.createContext({});
for (const file of ['src/parse.js', 'src/view-kit.js', 'src/view-gantt.js']) {
  vm.runInContext(readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8'), ctx);
}
const M = ctx.Mindra;
const j = (x) => JSON.parse(JSON.stringify(x));
const doc = (body) => `---\nview: gantt\n---\n${body}`;
const parse = (body) => j(M.views.gantt.parse(doc(body), 'file'));

test('ガント: 仕様の例を、まとまりと作業に分ける', () => {
  const model = parse(
    '# 開発の予定\n\n## 設計\n- 要件定義: 2026-01-05 ~ 2026-01-16\n- 画面設計: 2026-01-12 ~ 2026-01-23\n## 実装\n- 実装: 2026-01-26 ~ 2026-02-27\n- テスト: 2026-02-23 ~ 2026-03-06\n',
  );
  assert.deepEqual(model, {
    title: '開発の予定',
    start: '2026-01-05',
    end: '2026-03-06',
    sections: [
      {
        title: '設計',
        tasks: [
          { name: '要件定義', start: '2026-01-05', end: '2026-01-16' },
          { name: '画面設計', start: '2026-01-12', end: '2026-01-23' },
        ],
      },
      {
        title: '実装',
        tasks: [
          { name: '実装', start: '2026-01-26', end: '2026-02-27' },
          { name: 'テスト', start: '2026-02-23', end: '2026-03-06' },
        ],
      },
    ],
  });
});

test('ガント: 終了日を省くと 1 日、〜 も使える、全角コロンも可', () => {
  const model = parse('# 予定\n- 公開: 2026-03-10\n- 準備：2026-03-01〜2026-03-05\n');
  assert.deepEqual(model.sections, [
    {
      title: '',
      tasks: [
        { name: '公開', start: '2026-03-10', end: '2026-03-10' },
        { name: '準備', start: '2026-03-01', end: '2026-03-05' },
      ],
    },
  ]);
  assert.equal(model.start, '2026-03-01');
  assert.equal(model.end, '2026-03-10');
});

test('ガント: 終了日が開始日より前なら入れ替える', () => {
  const model = parse('- 作業: 2026-02-10 ~ 2026-02-01\n');
  assert.deepEqual(model.sections[0].tasks, [{ name: '作業', start: '2026-02-01', end: '2026-02-10' }]);
});

test('ガント: 日付の読めない行と、作業の無いまとまりは使わない', () => {
  const model = parse('# 題\n## A\n- メモ\n- 変: 2026-02-30\n- 形: 2026/01/01\n- 名前なし\n## B\n- 作業: 2026-01-05 ~ 2026-01-06\n');
  assert.deepEqual(model.sections, [{ title: 'B', tasks: [{ name: '作業', start: '2026-01-05', end: '2026-01-06' }] }]);
});

test('ガント: 作業が無ければ空、題名はファイル名', () => {
  const model = parse('ただの文\n');
  assert.deepEqual(model, { title: 'file', start: null, end: null, sections: [] });
});
