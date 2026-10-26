// 棒グラフ（view: bar）。書き方は docs/図の種類.md。
// 「- 名前: 数」の行を、横向きの棒で比べる。一番大きい数を、最大の長さにする。
(function (global) {
  'use strict';

  const TRACK = 320; // 棒の最大の長さ（px）

  // MD → { title, rows: [{ label, value }] }
  function parse(text, fileName) {
    const M = global.Mindra;
    return { title: M.documentTitle(text, fileName), rows: M.numberRows(text) };
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.rows.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No numbers yet. Write lines like: - Tokyo: 120'));
      return f.done();
    }
    const max = Math.max(...model.rows.map((row) => row.value));
    const chart = K.el('div', 'vw-bar');
    model.rows.forEach((row, i) => {
      chart.appendChild(K.el('span', 'vw-bar-label', row.label));
      const track = K.el('span', 'vw-bar-track');
      track.style.width = `${TRACK}px`;
      const fill = K.el('span', 'vw-bar-fill');
      fill.style.width = `${max ? (row.value / max) * TRACK : 0}px`;
      fill.style.background = K.CHART_COLORS[i % K.CHART_COLORS.length];
      track.appendChild(fill);
      chart.appendChild(track);
      chart.appendChild(K.el('span', 'vw-bar-value', row.value.toLocaleString()));
    });
    f.wrap.appendChild(chart);
    return f.done();
  }

  global.Mindra.views.bar = { parse, render };
})(globalThis);
