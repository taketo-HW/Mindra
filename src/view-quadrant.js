// 4 象限マトリクス（view: quadrant）。書き方は docs/図の種類.md。
// 「- 名前: 横, 縦」の行を点にする。範囲は 0 から 10（10 を超える値があれば最大値まで）。真ん中で 4 つに分ける。
(function (global) {
  'use strict';

  const PLOT = 360; // 描く場所の一辺
  const LEFT = 44;
  const RIGHT = 24;
  const TOP = 16;
  const BOTTOM = 44;

  // 点の行と軸の名前を読む（散布図と同じ書き方）。
  // → { title, xLabel, yLabel, points: [{ label, x, y }] }
  function parse(text, fileName) {
    const M = global.Mindra;
    const model = { title: M.documentTitle(text, fileName), xLabel: '', yLabel: '', points: [] };
    for (const { text: line } of M.documentLines(text).lines) {
      const item = /^-\s+(.*)$/.exec(line); // 入れ子（字下げ）の行は使わない
      if (!item) continue;
      const m = /^(.*?)\s*(?::\s|：)\s*(.*)$/.exec(item[1]);
      if (!m) continue;
      const label = M.plainText(m[1]);
      const rest = M.plainText(m[2]);
      if (!label) continue;
      if (label === '横軸' || label === '縦軸') {
        if (/\d/.test(rest)) continue; // 軸の名前は、数を含まない行だけ
        model[label === '横軸' ? 'xLabel' : 'yLabel'] = rest;
        continue;
      }
      const nums = /^(-?\d+(?:\.\d+)?)\s*[,、，]\s*(-?\d+(?:\.\d+)?)$/.exec(rest);
      if (!nums) continue;
      model.points.push({ label, x: Number(nums[1]), y: Number(nums[2]) });
    }
    return model;
  }

  function text(K, x, y, value, cls, anchor) {
    const t = K.svg('text', { x, y, class: cls, 'text-anchor': anchor || 'middle' });
    t.textContent = value;
    return t;
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.points.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No points yet. Write lines like: - Plan A: 8, 7'));
      return f.done();
    }
    const max = Math.max(10, ...model.points.map((p) => Math.max(p.x, p.y)));
    // 名前が右にはみ出すぶん、右の余白を広げる。
    const probe = K.el('span', 'vw-qd-probe');
    f.wrap.appendChild(probe);
    const labelW = Math.max(...model.points.map((p) => K.textWidth(p.label, probe)));
    probe.remove();
    const right = Math.max(RIGHT, labelW + 18); // 名前は点の右に置く
    const width = LEFT + PLOT + right;
    const height = TOP + PLOT + BOTTOM;
    const chart = K.svg('svg', { width, height, class: 'vw-qd-chart' });
    const xOf = (v) => LEFT + (Math.max(0, v) / max) * PLOT;
    const yOf = (v) => TOP + PLOT - (Math.max(0, v) / max) * PLOT;
    const half = PLOT / 2;
    // 4 つのマス（右上を強調）。
    [
      [0, 0, 'is-tl'],
      [half, 0, 'is-tr'],
      [0, half, 'is-bl'],
      [half, half, 'is-br'],
    ].forEach(([dx, dy, cls]) => {
      chart.appendChild(K.svg('rect', { x: LEFT + dx, y: TOP + dy, width: half, height: half, class: `vw-qd-cell ${cls}` }));
    });
    chart.appendChild(K.svg('rect', { x: LEFT, y: TOP, width: PLOT, height: PLOT, class: 'vw-qd-frame' }));
    chart.appendChild(K.svg('line', { x1: LEFT + half, y1: TOP, x2: LEFT + half, y2: TOP + PLOT, class: 'vw-qd-mid' }));
    chart.appendChild(K.svg('line', { x1: LEFT, y1: TOP + half, x2: LEFT + PLOT, y2: TOP + half, class: 'vw-qd-mid' }));
    // 端の目盛り（0 と最大値）と、軸の名前。
    chart.appendChild(text(K, LEFT, TOP + PLOT + 16, '0', 'vw-qd-axis'));
    chart.appendChild(text(K, LEFT + PLOT, TOP + PLOT + 16, String(max), 'vw-qd-axis'));
    chart.appendChild(text(K, LEFT - 6, TOP + 10, String(max), 'vw-qd-axis', 'end'));
    if (model.xLabel) chart.appendChild(text(K, LEFT + half, TOP + PLOT + 36, `${model.xLabel} →`, 'vw-qd-name'));
    if (model.yLabel) {
      const t = text(K, 0, 0, `${model.yLabel} →`, 'vw-qd-name');
      t.setAttribute('transform', `translate(${LEFT - 14} ${TOP + half}) rotate(-90)`);
      chart.appendChild(t);
    }
    // 点と名前。
    model.points.forEach((p, i) => {
      const color = K.CHART_COLORS[i % K.CHART_COLORS.length];
      const cx = xOf(p.x);
      const cy = yOf(p.y);
      chart.appendChild(K.svg('circle', { cx, cy, r: 6, fill: color, class: 'vw-qd-dot' }));
      chart.appendChild(text(K, cx + 10, cy + 4, p.label, 'vw-qd-label', 'start'));
    });
    f.wrap.appendChild(chart);
    return f.done();
  }

  global.Mindra.views.quadrant = { parse, render };
})(globalThis);
