// 折れ線グラフ（view: line）。書き方は docs/図の種類.md。
// 「- 名前: 数」の行を、書いた順に左から右へ点を結ぶ。縦軸は 0 から最大値まで。
(function (global) {
  'use strict';

  const LEFT = 48;
  const RIGHT = 24;
  const TOP = 24;
  const BOTTOM = 40;
  const STEP = 80; // 点どうしの間隔
  const PLOT_H = 180;

  // MD → { title, rows: [{ label, value }] }
  function parse(text, fileName) {
    const M = global.Mindra;
    return { title: M.documentTitle(text, fileName), rows: M.numberRows(text) };
  }

  function text(K, x, y, value, cls, anchor) {
    const t = K.svg('text', { x, y, class: cls, 'text-anchor': anchor || 'middle' });
    t.textContent = value;
    return t;
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.rows.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No numbers yet. Write lines like: - Jan: 10'));
      return f.done();
    }
    const n = model.rows.length;
    const plotW = Math.max(240, (n - 1) * STEP);
    const width = LEFT + plotW + RIGHT;
    const height = TOP + PLOT_H + BOTTOM;
    const max = Math.max(...model.rows.map((row) => row.value)) || 1;
    const chart = K.svg('svg', { width, height, class: 'vw-line-chart' });
    const yOf = (v) => TOP + PLOT_H - (v / max) * PLOT_H;
    // 点は、軸の目盛りの文字と重ならないように、左右を少し内側に寄せる。
    const INSET = 24;
    const xOf = (i) => (n === 1 ? LEFT + plotW / 2 : LEFT + INSET + (i * (plotW - 2 * INSET)) / (n - 1));

    // 目盛り（0、半分、最大）と軸。
    for (const v of [0, max / 2, max]) {
      chart.appendChild(K.svg('line', { x1: LEFT, y1: yOf(v), x2: LEFT + plotW, y2: yOf(v), class: 'vw-line-grid' }));
      chart.appendChild(text(K, LEFT - 8, yOf(v) + 4, Number(v.toFixed(2)).toLocaleString(), 'vw-line-axis', 'end'));
    }
    // 折れ線と点、値と名前。
    const points = model.rows.map((row, i) => `${xOf(i)},${yOf(row.value)}`).join(' ');
    chart.appendChild(K.svg('polyline', { points, class: 'vw-line-path', stroke: K.CHART_COLORS[0] }));
    model.rows.forEach((row, i) => {
      chart.appendChild(K.svg('circle', { cx: xOf(i), cy: yOf(row.value), r: 4, fill: K.CHART_COLORS[0] }));
      chart.appendChild(text(K, xOf(i), yOf(row.value) - 10, row.value.toLocaleString(), 'vw-line-value'));
      chart.appendChild(text(K, xOf(i), TOP + PLOT_H + 22, row.label, 'vw-line-axis'));
    });
    f.wrap.appendChild(chart);
    return f.done();
  }

  global.Mindra.views.line = { parse, render };
})(globalThis);
