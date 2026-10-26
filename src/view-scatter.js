// 散布図（view: scatter）。書き方は docs/図の種類.md。
// 「- 名前: 横, 縦」の行を点にする。範囲は 0 から最大値まで（少し余白）。目盛りを付け、分けの線は引かない。
(function (global) {
  'use strict';

  const PLOT_W = 420;
  const PLOT_H = 300;
  const LEFT = 56;
  const RIGHT = 24;
  const TOP = 16;
  const BOTTOM = 48;
  const TICKS = 5; // 目盛りの数（おおよそ）

  // 点の行と軸の名前を読む（4 象限と同じ書き方）。
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

  // 目盛りの間隔: 1, 2, 5 × 10 のべき乗から、きりのよい数を選ぶ。
  function niceStep(max) {
    const raw = max / TICKS;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
    return 10 * pow;
  }

  function axisRange(values) {
    const max = Math.max(0, ...values) * 1.1 || 1; // 少し余白
    const step = niceStep(max);
    return { max: Math.ceil(max / step) * step, step };
  }

  function text(K, x, y, value, cls, anchor) {
    const t = K.svg('text', { x, y, class: cls, 'text-anchor': anchor || 'middle' });
    t.textContent = value;
    return t;
  }

  const fmt = (v) => Number(v.toFixed(6)).toLocaleString();

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.points.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No points yet. Write lines like: - Plan A: 8, 7'));
      return f.done();
    }
    const xr = axisRange(model.points.map((p) => p.x));
    const yr = axisRange(model.points.map((p) => p.y));
    const probe = K.el('span', 'vw-sc-probe');
    f.wrap.appendChild(probe);
    const labelW = Math.max(...model.points.map((p) => K.textWidth(p.label, probe)));
    probe.remove();
    const right = Math.max(RIGHT, labelW + 18); // 名前は点の右に置く
    const width = LEFT + PLOT_W + right;
    const height = TOP + PLOT_H + BOTTOM;
    const chart = K.svg('svg', { width, height, class: 'vw-sc-chart' });
    const xOf = (v) => LEFT + (Math.max(0, v) / xr.max) * PLOT_W;
    const yOf = (v) => TOP + PLOT_H - (Math.max(0, v) / yr.max) * PLOT_H;
    // 目盛りと格子。
    for (let v = 0; v <= yr.max + 1e-9; v += yr.step) {
      chart.appendChild(K.svg('line', { x1: LEFT, y1: yOf(v), x2: LEFT + PLOT_W, y2: yOf(v), class: 'vw-sc-grid' }));
      chart.appendChild(text(K, LEFT - 8, yOf(v) + 4, fmt(v), 'vw-sc-axis', 'end'));
    }
    for (let v = 0; v <= xr.max + 1e-9; v += xr.step) {
      chart.appendChild(K.svg('line', { x1: xOf(v), y1: TOP, x2: xOf(v), y2: TOP + PLOT_H, class: 'vw-sc-grid' }));
      chart.appendChild(text(K, xOf(v), TOP + PLOT_H + 16, fmt(v), 'vw-sc-axis'));
    }
    chart.appendChild(K.svg('path', { d: `M ${LEFT} ${TOP} V ${TOP + PLOT_H} H ${LEFT + PLOT_W}`, class: 'vw-sc-frame' }));
    if (model.xLabel) chart.appendChild(text(K, LEFT + PLOT_W / 2, TOP + PLOT_H + 38, model.xLabel, 'vw-sc-name'));
    if (model.yLabel) {
      const t = text(K, 0, 0, model.yLabel, 'vw-sc-name');
      t.setAttribute('transform', `translate(14 ${TOP + PLOT_H / 2}) rotate(-90)`);
      chart.appendChild(t);
    }
    model.points.forEach((p, i) => {
      const color = K.CHART_COLORS[i % K.CHART_COLORS.length];
      const cx = xOf(p.x);
      const cy = yOf(p.y);
      chart.appendChild(K.svg('circle', { cx, cy, r: 5, fill: color, class: 'vw-sc-dot' }));
      chart.appendChild(text(K, cx + 9, cy + 4, p.label, 'vw-sc-label', 'start'));
    });
    f.wrap.appendChild(chart);
    return f.done();
  }

  global.Mindra.views.scatter = { parse, render };
})(globalThis);
