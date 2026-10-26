import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// 画面と同じ順で、すべての描画スクリプトを 1 つの context に読み込む（index.html の一覧から）。
const ctx = vm.createContext({});
const page = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const scripts = [...page.matchAll(/<script src="(src\/[a-z0-9-]+\.js)"><\/script>/g)]
  .map((m) => m[1])
  .filter((file) => !['src/watch.js', 'src/edit.js', 'src/app.js'].includes(file));
for (const file of scripts) {
  vm.runInContext(readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8'), ctx);
}
const M = ctx.Mindra;
const j = (x) => JSON.parse(JSON.stringify(x));
const doc = (view, body) => `---\nview: ${view}\n---\n${body}`;

test('状態遷移図: * は、出てくるたびに別の開始・終了になる', () => {
  const model = j(M.views.state.parse(doc('state', '# S\n- * -> 受付\n- 受付 -> 完了: 済\n- 完了 -> *\n'), 's'));
  const starts = model.nodes.filter((n) => n.kind === 'start' || n.start);
  const ends = model.nodes.filter((n) => n.kind === 'end' || n.end);
  assert.ok(starts.length >= 1, '開始がある');
  assert.ok(ends.length >= 1, '終了がある');
  const labels = model.nodes.map((n) => n.name || n.text).filter(Boolean);
  assert.ok(labels.includes('受付') && labels.includes('完了'));
});

test('特性要因図: 分類と原因、1 段の細かい原因を読む', () => {
  const model = j(M.views.fishbone.parse(doc('fishbone', '# 不良\n## 人\n- 経験不足\n  - 教育不足\n## 機械\n- 古い\n'), 'f'));
  assert.equal(model.title, '不良');
  assert.equal(model.categories.length, 2);
  assert.equal(model.categories[0].title ?? model.categories[0].name, '人');
});

test('ER 図: 列の型と PK/FK、表どうしの関係を読む', () => {
  const model = j(
    M.views.er.parse(doc('er', '# ER\n## 顧客\n- id: int PK\n- 名前: text\n## 注文\n- 顧客id: int FK\n\n- 注文 -> 顧客: 多対1\n'), 'e'),
  );
  assert.equal(model.tables.length, 2);
  assert.equal(model.relations.length, 1);
  const cust = model.tables.find((t) => (t.name || t.title) === '顧客');
  assert.ok(cust, '顧客の表がある');
  const id = cust.columns.find((c) => c.name === 'id');
  assert.ok(String(id.key || id.keys || '').toUpperCase().includes('PK') || id.pk);
});

test('関係図: -- は向きなし、-> は向きあり。名前だけの行は点', () => {
  const model = j(M.views.network.parse(doc('network', '# N\n- 太郎 -- 花子: 友人\n- 太郎 -> 会社\n- 三郎\n'), 'n'));
  const names = model.nodes.map((x) => x.name || x.text || x.id);
  assert.ok(names.includes('太郎') && names.includes('花子') && names.includes('会社') && names.includes('三郎'));
  assert.equal(model.edges.length, 2);
  const dir = model.edges.map((e) => Boolean(e.directed ?? e.arrow ?? e.dir));
  assert.deepEqual(dir.sort(), [false, true]);
});

test('スイムレーン: 同じ名前のレーンはまとまり、手順は書いた順', () => {
  const model = j(
    M.views.swimlane.parse(doc('swimlane', '# Sw\n## 社員\n- 申請\n## 上司\n- 承認\n## 社員\n- 受取\n'), 'sw'),
  );
  const laneNames = model.lanes.map((l) => (typeof l === 'string' ? l : l.title || l.name));
  assert.deepEqual([...new Set(laneNames)], laneNames, 'レーン名は重複しない');
  assert.ok(laneNames.includes('社員') && laneNames.includes('上司'));
  assert.equal(model.steps.length, 3);
});

test('ピラミッド: 箇条書きを、上から順に段にする', () => {
  const model = j(M.views.pyramid.parse(doc('pyramid', '# P\n- 上\n- 中\n- 下\n'), 'p'));
  const labels = model.levels.map((x) => x.text || x.label || x.name || x);
  assert.deepEqual(labels, ['上', '中', '下']);
});

test('ファネル: 数の行と、前の段からの割合', () => {
  const model = j(M.views.funnel.parse(doc('funnel', '# F\n- 訪問: 1000\n- 購入: 250\n'), 'f'));
  assert.equal(model.steps.length, 2);
  assert.equal(model.steps[0].value, 1000);
  assert.equal(model.steps[1].value, 250);
  assert.equal(model.steps[1].ofPrev, 25);
});

test('ゲージ: %、x / 目標、100% 超えも読む', () => {
  const model = j(M.views.gauge.parse(doc('gauge', '# Ga\n- 売上: 72%\n- 新規: 45 / 60\n- 超過: 7 / 5\n'), 'g'));
  assert.equal(model.rows.length, 3);
  assert.equal(model.rows[0].percent, 72);
  assert.equal(model.rows[1].percent, 75);
  assert.equal(model.rows[2].percent, 140);
});

test('ヒートマップ: 表を読み、数の最小・最大を返す', () => {
  const model = j(
    M.views.heatmap.parse(doc('heatmap', '# H\n| 行 | 月 | 火 |\n| :-- | --: | --: |\n| 朝 | 12 | 8 |\n| 昼 | 40 | 35 |\n'), 'h'),
  );
  assert.equal(model.min, 8);
  assert.equal(model.max, 40);
});

test('カレンダー: 月ごとに分け、同じ日の予定は並べる。月は日付順', () => {
  const model = j(
    M.views.calendar.parse(doc('calendar', '# C\n- 2026-02-10: B\n- 2026-01-05: A\n- 2026-01-05: A2\n- bad: x\n'), 'c'),
  );
  assert.deepEqual(model.months.map((m) => [m.year, m.month]), [[2026, 1], [2026, 2]]);
  assert.deepEqual(model.months[0].events[5], ['A', 'A2']);
});

test('カレンダー: 月の表（1 日の曜日と日数）を、UTC で正しく計算する', () => {
  // 2026-01-01 は木曜（月曜=0 で 3）、31 日。うるう年 2024-02 は 29 日。
  assert.deepEqual(j(M.views.calendar.monthGrid(2026, 1)), { firstWeekday: 3, days: 31 });
  assert.deepEqual(M.views.calendar.monthGrid(2024, 2).days, 29);
  assert.deepEqual(M.views.calendar.monthGrid(2026, 2).days, 28);
});

test('新規作成のひな形は、15 種類すべて、それぞれの図として中身が読める', () => {
  const pick = {
    gantt: (m) => m.sections,
    radar: (m) => m.series,
    quadrant: (m) => m.points,
    scatter: (m) => m.points,
    orgchart: (m) => m.roots,
    state: (m) => m.nodes,
    fishbone: (m) => m.categories,
    er: (m) => m.tables,
    network: (m) => m.nodes,
    swimlane: (m) => m.lanes,
    pyramid: (m) => m.levels,
    funnel: (m) => m.steps,
    gauge: (m) => m.rows,
    heatmap: (m) => m.tables,
    calendar: (m) => m.months,
  };
  for (const [view, get] of Object.entries(pick)) {
    const model = j(M.views[view].parse(M.newDocumentText(view, '題'), 'x'));
    assert.ok(get(model) && get(model).length > 0, `${view} のひな形が空`);
  }
});

test('カレンダー: 実在しない日付（2 月 31 日など）は捨てる', () => {
  const model = j(M.views.calendar.parse(doc('calendar', '# C\n- 2026-02-31: 無効\n- 2026-02-28: 有効\n'), 'c'));
  assert.equal(model.months.length, 1);
  assert.deepEqual(Object.keys(model.months[0].events), ['28']);
});

test('ゲージ: 負の値は 0 にする', () => {
  const model = j(M.views.gauge.parse(doc('gauge', '# G\n- A: -5%\n- B: -3 / 10\n'), 'g'));
  assert.equal(model.rows[0].percent, 0);
  assert.equal(model.rows[1].percent, 0);
});

test('ER 図: 箇条書きでない -> の行（段落）は、関係にしない', () => {
  const model = j(M.views.er.parse(doc('er', '# E\n## 表A\n- id: int PK\n\n普通 -> 文\n'), 'e'));
  assert.equal(model.tables.length, 1);
  assert.equal(model.relations.length, 0);
});

test('4象限・散布図: 入れ子（字下げ）の行は、点にしない', () => {
  for (const view of ['quadrant', 'scatter']) {
    const model = j(M.views[view].parse(doc(view, '# Q\n- A: 3, 4\n  - 入れ子: 1, 2\n'), 'q'));
    assert.deepEqual(model.points.map((p) => p.label || p.name), ['A'], view);
  }
});
