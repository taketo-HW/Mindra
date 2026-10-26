// 円グラフ（view: pie）。書き方は docs/図の種類.md。
// 「- 名前: 数」の行の、合計に対する割合を、円と凡例で表示する。
(function (global) {
  'use strict';

  const R = 100; // 円の半径
  const SIZE = 2 * R + 20;

  // MD → { title, rows: [{ label, value }], total }
  function parse(text, fileName) {
    const M = global.Mindra;
    const rows = M.numberRows(text);
    return { title: M.documentTitle(text, fileName), rows, total: rows.reduce((sum, row) => sum + row.value, 0) };
  }

  // 円の一切れ（角度はラジアン。上から時計回り）。
  function slicePath(cx, cy, r, a0, a1) {
    const x0 = cx + r * Math.sin(a0);
    const y0 = cy - r * Math.cos(a0);
    const x1 = cx + r * Math.sin(a1);
    const y1 = cy - r * Math.cos(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.total) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No numbers yet. Write lines like: - Rent: 40'));
      return f.done();
    }
    const body = K.el('div', 'vw-pie');
    const chart = K.svg('svg', { width: SIZE, height: SIZE, class: 'vw-pie-chart' });
    const legend = K.el('ul', 'vw-pie-legend');
    const c = SIZE / 2;
    let angle = 0;
    model.rows.forEach((row, i) => {
      const color = K.CHART_COLORS[i % K.CHART_COLORS.length];
      const share = row.value / model.total;
      if (share >= 0.9999) {
        chart.appendChild(K.svg('circle', { cx: c, cy: c, r: R, fill: color, class: 'vw-pie-slice' }));
      } else if (share > 0) {
        const next = angle + share * 2 * Math.PI;
        chart.appendChild(K.svg('path', { d: slicePath(c, c, R, angle, next), fill: color, class: 'vw-pie-slice' }));
        angle = next;
      }
      const li = K.el('li');
      const swatch = K.el('span', 'vw-pie-swatch');
      swatch.style.background = color;
      li.appendChild(swatch);
      li.appendChild(K.el('span', 'vw-pie-label', row.label));
      li.appendChild(K.el('span', 'vw-pie-value', `${row.value.toLocaleString()}（${(share * 100).toFixed(1)}%）`));
      legend.appendChild(li);
    });
    body.appendChild(chart);
    body.appendChild(legend);
    f.wrap.appendChild(body);
    return f.done();
  }

  global.Mindra.views.pie = { parse, render, slicePath };
})(globalThis);
