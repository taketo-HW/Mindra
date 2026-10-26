import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// ブラウザ用の通常スクリプトを、同じ vm の中で読み込む（読み取りの部分だけを試す）。
const ctx = vm.createContext({});
// 画面と同じ順で読み込む（index.html の一覧から。画面の配線は DOM が要るので除く）。
const page = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const scripts = [...page.matchAll(/<script src="(src\/[a-z0-9-]+\.js)"><\/script>/g)]
  .map((m) => m[1])
  .filter((file) => !['src/watch.js', 'src/edit.js', 'src/app.js'].includes(file));
for (const file of scripts) {
  vm.runInContext(readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8'), ctx);
}
const M = ctx.Mindra;
// vm 側のオブジェクトを、テスト側で比べられる形にする。
const j = (x) => JSON.parse(JSON.stringify(x));
const doc = (view, body) => `---\nview: ${view}\n---\n${body}`;

// ---- フローチャート ----

test('フローチャート: 仕様の例を、箱と矢印に分ける（判断と条件も）', () => {
  const model = j(
    M.views.flowchart.parse(
      doc(
        'flowchart',
        '# 注文の流れ\n\n- 注文を受ける -> 在庫はある？\n- 在庫はある？ -> 発送する: はい\n- 在庫はある？ -> 取り寄せる: いいえ\n- 発送する -> 完了\n- 取り寄せる -> 発送する\n',
      ),
      'f',
    ),
  );
  assert.equal(model.title, '注文の流れ');
  assert.deepEqual(
    model.nodes.map((n) => [n.name, n.decision]),
    [
      ['注文を受ける', false],
      ['在庫はある？', true],
      ['発送する', false],
      ['取り寄せる', false],
      ['完了', false],
    ],
  );
  assert.deepEqual(model.edges, [
    { from: 0, to: 1, label: '' },
    { from: 1, to: 2, label: 'はい' },
    { from: 1, to: 3, label: 'いいえ' },
    { from: 2, to: 4, label: '' },
    { from: 3, to: 2, label: '' },
  ]);
});

test('フローチャート: 鎖の矢印は、条件を最後の矢印に付ける。矢印のない行は箱だけ', () => {
  const model = j(M.views.flowchart.parse(doc('flowchart', '- A -> B -> C: ok\n- D\n- E?\n'), 'f'));
  assert.deepEqual(model.nodes.map((n) => n.name), ['A', 'B', 'C', 'D', 'E?']);
  assert.equal(model.nodes[4].decision, true);
  assert.deepEqual(model.edges, [
    { from: 0, to: 1, label: '' },
    { from: 1, to: 2, label: 'ok' },
  ]);
});

test('フローチャート: 列（段）は矢印の順。戻る矢印は段の計算に使わない', () => {
  const model = M.views.flowchart.parse(doc('flowchart', '- A -> B\n- B -> C\n- C -> A\n- B -> D\n'), 'f');
  const { rank, back } = M.views.flowchart.ranks(model);
  assert.deepEqual(j(rank), [0, 1, 2, 2]);
  assert.deepEqual([...back], [2]); // C -> A は戻る矢印
});

test('フローチャート: 色や AI の印、インラインの記号は名前から外す', () => {
  const model = j(M.views.flowchart.parse(doc('flowchart', '- **A** {color:#ff0000} -> `B`\n'), 'f'));
  assert.deepEqual(model.nodes.map((n) => n.name), ['A', 'B']);
});

// ---- 表 ----

test('表: 仕様の例を、見出し・揃え・行に分ける', () => {
  const model = j(
    M.views.table.parse(doc('table', '# 材料\n\n| 名前 | 量 |\n| :--- | :--- |\n| 玉ねぎ | 2個 |\n| にんじん | 1本 |\n'), 't'),
  );
  assert.equal(model.title, '材料');
  assert.deepEqual(model.tables, [
    {
      caption: '材料',
      header: ['名前', '量'],
      align: ['left', 'left'],
      rows: [
        ['玉ねぎ', '2個'],
        ['にんじん', '1本'],
      ],
    },
  ]);
});

test('表: 揃え（中央・右）と、\\| の文字。直前の見出しを、その表の見出しにする', () => {
  const model = j(
    M.views.table.parse(doc('table', '# 全体\n## 価格\n| 品 | 値 | 備考 |\n| :-: | --: | --- |\n| a \\| b | 10 |\n'), 't'),
  );
  const t = model.tables[0];
  assert.equal(t.caption, '価格');
  assert.deepEqual(t.align, ['center', 'right', 'left']);
  assert.deepEqual(t.rows, [['a | b', '10', '']]);
});

test('表: 区切りの行がないものは、表として扱わない', () => {
  const model = j(M.views.table.parse(doc('table', '| a | b |\n| c | d |\n'), 't'));
  assert.deepEqual(model.tables, []);
});

// ---- シーケンス図 ----

test('シーケンス図: 仕様の例を、登場人物とメッセージに分ける（戻りは点線）', () => {
  const model = j(
    M.views.sequence.parse(
      doc(
        'sequence',
        '# ログイン\n\n- 利用者 -> サーバ: ID とパスワード\n- サーバ -> 認証: 照合\n- 認証 --> サーバ: 結果\n- サーバ --> 利用者: ログイン完了\n',
      ),
      's',
    ),
  );
  assert.equal(model.title, 'ログイン');
  assert.deepEqual(model.participants, ['利用者', 'サーバ', '認証']);
  assert.deepEqual(model.messages, [
    { from: 0, to: 1, text: 'ID とパスワード', dashed: false },
    { from: 1, to: 2, text: '照合', dashed: false },
    { from: 2, to: 1, text: '結果', dashed: true },
    { from: 1, to: 0, text: 'ログイン完了', dashed: true },
  ]);
});

test('シーケンス図: 内容なし、自分あて、全角の「：」、時刻の「:」', () => {
  const model = j(M.views.sequence.parse(doc('sequence', '- A -> B\n- A -> A: 考える\n- B -> A：はい\n- A -> B: 10:30 に集合\n'), 's'));
  assert.deepEqual(model.messages, [
    { from: 0, to: 1, text: '', dashed: false },
    { from: 0, to: 0, text: '考える', dashed: false },
    { from: 1, to: 0, text: 'はい', dashed: false },
    { from: 0, to: 1, text: '10:30 に集合', dashed: false },
  ]);
});

// ---- タイムライン ----

test('タイムライン: 仕様の例を、日付と出来事に分ける', () => {
  const model = j(M.views.timeline.parse(doc('timeline', '# 製品の歩み\n\n- 2026-01: 企画\n- 2026-03: 試作\n- 2026-06: 公開\n'), 'x'));
  assert.equal(model.title, '製品の歩み');
  assert.deepEqual(model.items, [
    { date: '2026-01', text: '企画' },
    { date: '2026-03', text: '試作' },
    { date: '2026-06', text: '公開' },
  ]);
});

test('タイムライン: 「: 」が無い行は日付なし。入れ子と、コードブロックの中は使わない', () => {
  const model = j(
    M.views.timeline.parse(doc('timeline', '- 10:30: 集合\n- 準備する\n  - 入れ子\n```\n- 2026: コードの中\n```\n- 夏：旅行\n'), 'x'),
  );
  assert.deepEqual(model.items, [
    { date: '10:30', text: '集合' },
    { date: '', text: '準備する' },
    { date: '夏', text: '旅行' },
  ]);
});

// ---- 共通 ----

test('新規作成のひな形は、それぞれの図として読める', () => {
  for (const view of ['flowchart', 'table', 'sequence', 'timeline']) {
    const text = M.newDocumentText(view, '題');
    const model = j(M.views[view].parse(text, 'x'));
    assert.equal(model.title, '題', view);
    const size = { flowchart: model.nodes, table: model.tables, sequence: model.messages, timeline: model.items }[view];
    assert.ok(size && size.length > 0, `${view} のひな形が空`);
  }
  assert.equal(M.newDocumentText('mindmap', '題'), '---\nview: mindmap\n---\n\n# 題\n');
});

test('題名は最初の # 見出し。無ければファイル名', () => {
  assert.equal(M.documentTitle('---\nview: table\n---\n## 小見出し\n# 本題\n', 'file'), '本題');
  assert.equal(M.documentTitle('- a\n', 'file'), 'file');
});

test('フローチャート: 2 列以上またぐ矢印は、間の列の箱と重ならない通り道を通る', () => {
  const model = M.views.flowchart.parse(
    doc('flowchart', '- 注文を受ける -> 在庫はある？\n- 在庫はある？ -> 発送する: はい\n- 在庫はある？ -> 取り寄せる: いいえ\n- 発送する -> 完了\n- 取り寄せる -> 発送する\n'),
    'f',
  );
  const n = model.nodes.length;
  const L = M.views.flowchart.layout(model, new Array(n).fill(100), new Array(n).fill(30));
  const points = L.via.get(1); // 在庫はある？ -> 発送する（1 列またぐ）
  assert.equal(points.length, 1);
  const box = L.boxes[3]; // 取り寄せる（同じ列にある箱）
  const p = points[0];
  const overlap = p.y < box.y + box.h && box.y < p.y + p.h;
  assert.equal(overlap, false);
  // 箱どうしも重ならない
  for (let i = 0; i < n; i++)
    for (let k = i + 1; k < n; k++) {
      const a = L.boxes[i];
      const b = L.boxes[k];
      const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.equal(hit, false, `${i} と ${k} が重なっている`);
    }
});

// ---- やさしい図 ----

test('カンバン: 区切りごとに列、箇条書きをカードにする（入れ子は使わない）', () => {
  const model = j(M.views.kanban.parse(doc('kanban', '# 開発\n\n## 未着手\n- 画面を作る\n  - 細かい作業\n## 作業中\n- 仕様を書く\n## 完了\n'), 'k'));
  assert.equal(model.title, '開発');
  assert.deepEqual(model.columns, [
    { title: '未着手', cards: ['画面を作る'] },
    { title: '作業中', cards: ['仕様を書く'] },
    { title: '完了', cards: [] },
  ]);
});

test('カンバン: 最初の ## より前の箇条書きは、名前なしの列に入る', () => {
  const model = j(M.views.kanban.parse(doc('kanban', '- 先頭\n## A\n- a\n'), 'k'));
  assert.deepEqual(model.columns, [
    { title: '', cards: ['先頭'] },
    { title: 'A', cards: ['a'] },
  ]);
});

test('ロードマップ: 区切りを時期、箇条書きをやることにする', () => {
  const model = j(M.views.roadmap.parse(doc('roadmap', '# 計画\n## Q1\n- 企画\n## Q2\n- 試作\n- 調査\n'), 'r'));
  assert.deepEqual(model.phases, [
    { title: 'Q1', items: ['企画'] },
    { title: 'Q2', items: ['試作', '調査'] },
  ]);
});

test('チェックリスト: 済み・まだ・字下げ、区切りと全体の数', () => {
  const model = j(
    M.views.checklist.parse(
      doc('checklist', '# 準備\n## 持ち物\n- [x] パスポート\n- [ ] 充電器\n  - [ ] 変換プラグ\n- メモ\n## 予約\n- [X] 飛行機\n'),
      'c',
    ),
  );
  assert.equal(model.done, 2);
  assert.equal(model.total, 4);
  assert.deepEqual(model.groups[0], {
    title: '持ち物',
    items: [
      { text: 'パスポート', done: true, level: 0 },
      { text: '充電器', done: false, level: 0 },
      { text: '変換プラグ', done: false, level: 1 },
      { text: 'メモ', done: null, level: 0 },
    ],
    done: 1,
    total: 3,
  });
  assert.deepEqual(model.groups[1].items, [{ text: '飛行機', done: true, level: 0 }]);
});

test('数の行: 1,200 や 3.5、単位、全角の「：」。数の無い行は使わず、負の数は 0', () => {
  const rows = j(M.numberRows(doc('bar', '- 東京: 1,200 円\n- 大阪：3.5\n- 福岡: なし\n- 札幌: -5\n- メモ\n')));
  assert.deepEqual(rows, [
    { label: '東京', value: 1200 },
    { label: '大阪', value: 3.5 },
    { label: '札幌', value: 0 },
  ]);
});

test('棒・円・折れ線: 同じ書き方を読む。円は合計も返す', () => {
  const body = '# 売上\n- 東京: 120\n- 大阪: 80\n';
  for (const view of ['bar', 'line']) {
    assert.deepEqual(j(M.views[view].parse(doc(view, body), 'x')).rows, [
      { label: '東京', value: 120 },
      { label: '大阪', value: 80 },
    ]);
  }
  const pie = j(M.views.pie.parse(doc('pie', body), 'x'));
  assert.equal(pie.total, 200);
  assert.equal(pie.title, '売上');
});

test('円グラフ: 半分より大きい一切れは、大きい弧で描く', () => {
  assert.match(M.views.pie.slicePath(0, 0, 10, 0, Math.PI * 1.5), / 0 1 1 /);
  assert.match(M.views.pie.slicePath(0, 0, 10, 0, Math.PI * 0.5), / 0 0 1 /);
});

test('SWOT: 区切りを、書いた順にマスにする', () => {
  const model = j(M.views.swot.parse(doc('swot', '# 分析\n## 強み\n- 速い\n## 弱み\n- 高い\n## 機会\n## 脅威\n- 競合\n'), 's'));
  assert.deepEqual(model.boxes.map((b) => [b.title, b.items]), [
    ['強み', ['速い']],
    ['弱み', ['高い']],
    ['機会', []],
    ['脅威', ['競合']],
  ]);
});

test('ロジックツリー: マインドマップと同じ階層で読む', () => {
  const model = j(M.views.logictree.parse(doc('logictree', '# 売上を上げる\n## 客数\n- 広告\n- 紹介\n## 客単価\n- セット販売\n'), 'l'));
  assert.deepEqual(model.roots, [
    {
      text: '売上を上げる',
      children: [
        { text: '客数', children: [{ text: '広告', children: [] }, { text: '紹介', children: [] }] },
        { text: '客単価', children: [{ text: 'セット販売', children: [] }] },
      ],
    },
  ]);
});

test('やさしい図の新規作成のひな形は、それぞれの図として読める', () => {
  const size = {
    kanban: (m) => m.columns,
    roadmap: (m) => m.phases,
    checklist: (m) => m.groups,
    bar: (m) => m.rows,
    pie: (m) => m.rows,
    line: (m) => m.rows,
    swot: (m) => m.boxes,
    logictree: (m) => m.roots[0].children,
  };
  for (const [view, pick] of Object.entries(size)) {
    const model = j(M.views[view].parse(M.newDocumentText(view, '題'), 'x'));
    assert.ok(pick(model).length > 0, `${view} のひな形が空`);
  }
});

test('すべての図の種類に、描き方が登録されている', () => {
  for (const view of M.VIEWS.filter((v) => v !== 'mindmap')) {
    assert.equal(typeof M.views[view]?.parse, 'function', view);
    assert.equal(typeof M.views[view]?.render, 'function', view);
  }
});
