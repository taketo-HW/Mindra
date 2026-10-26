// レーダーチャート（view: radar）。書き方は docs/図の種類.md。
// 「- 項目: 数」の行を、軸ごとの点にして結ぶ。## があれば、区切りごとに 1 つの系列。
(function (global) {
  'use strict';

  const R = 130; // 半径
  const RINGS = 4; // 目盛りの輪の数

  // 1 行を読む（数の行の規則と同じ）。読めなければ null。
  function numberRow(text) {
    const M = global.Mindra;
    const m = /^(.*?)\s*(?::\s|：)\s*(.*)$/.exec(text);
    if (!m) return null;
    const num = /-?\d[\d,]*(?:\.\d+)?/.exec(m[2]);
    const label = M.plainText(m[1]);
    if (!num || !label) return null;
    return { label, value: Math.max(0, Number(num[0].replace(/,/g, ''))) };
  }

  // MD → { title, axes: [項目名], series: [{ name, values: [軸の順の数] }], max }
  function parse(text, fileName) {
    const M = global.Mindra;
    const axes = [];
    const raw = [];
    for (const section of M.documentSections(text)) {
      const values = {};
      let any = false;
      for (const item of section.items) {
        if (item.indent > 0) continue; // 入れ子は使わない
        const row = numberRow(item.text);
        if (!row) continue;
        if (!axes.includes(row.label)) axes.push(row.label);
        if (!(row.label in values)) values[row.label] = row.value; // 同じ項目は最初の行を使う
        any = true;
      }
      if (any) raw.push({ name: section.title, values });
    }
    const series = raw.map((s) => ({ name: s.name, values: axes.map((a) => (a in s.values ? s.values[a] : 0)) }));
    let max = 0;
    for (const s of series) for (const v of s.values) max = Math.max(max, v);
    return { title: M.documentTitle(text, fileName), axes, series, max };
  }

  function svgText(K, x, y, value, cls, anchor) {
    const t = K.svg('text', { x, y, class: cls, 'text-anchor': anchor || 'middle' });
    t.textContent = value;
    return t;
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.series.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No numbers yet. Write lines like: - Speed: 4'));
      return f.done();
    }
    if (model.axes.length < 3) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'A radar chart needs at least 3 items. Add lines like: - Speed: 4'));
      return f.done();
    }
    const n = model.axes.length;
    const max = model.max || 1;

    // 軸の名前の幅を測って、左右の余白を決める（文字が切れないように）。
    const probe = K.el('span', 'vw-radar-measure');
    f.wrap.appendChild(probe);
    let labelW = 0;
    for (const a of model.axes) labelW = Math.max(labelW, K.textWidth(a, probe));
    probe.remove();
    const sideW = Math.ceil(labelW) + 20;
    const cx = sideW + R;
    const cy = R + 36;
    const width = cx * 2;
    const point0 = (i, r) => cy + r * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / n);
    // 下の余白は、いちばん下の軸の名前までにする（三角形などで、下が空きすぎないように）。
    let bottom = cy;
    for (let i = 0; i < n; i++) bottom = Math.max(bottom, point0(i, R + 14));
    const height = Math.ceil(bottom) + 24;
    const chart = K.svg('svg', { width, height, class: 'vw-radar-chart' });
    // i 番目の軸の角度（真上から時計回り）。
    const point = (i, r) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
    };

    // 目盛りの輪と軸。
    for (let k = 1; k <= RINGS; k++) {
      const pts = model.axes.map((_, i) => point(i, (R * k) / RINGS).join(',')).join(' ');
      chart.appendChild(K.svg('polygon', { points: pts, class: 'vw-radar-ring' }));
    }
    model.axes.forEach((axis, i) => {
      const [x, y] = point(i, R);
      chart.appendChild(K.svg('line', { x1: cx, y1: cy, x2: x, y2: y, class: 'vw-radar-axis' }));
      const [lx, ly] = point(i, R + 14);
      const anchor = Math.abs(lx - cx) < 1 ? 'middle' : lx > cx ? 'start' : 'end';
      const dy = ly < cy - R / 2 ? -2 : ly > cy + R / 2 ? 12 : 5;
      chart.appendChild(svgText(K, lx, ly + dy, axis, 'vw-radar-label', anchor));
    });
    // 目盛りの数（真上の軸の右に、0 と最大値の間を RINGS 等分）。
    for (let k = 1; k <= RINGS; k++) {
      const v = (max * k) / RINGS;
      // 目盛りの数は、縦軸の左側に出す（軸の線と重ならないように）。
      chart.appendChild(svgText(K, cx - 6, cy - (R * k) / RINGS + 4, Number(v.toFixed(2)).toLocaleString(), 'vw-radar-tick', 'end'));
    }
    // 系列。
    model.series.forEach((s, si) => {
      const color = K.CHART_COLORS[si % K.CHART_COLORS.length];
      const pts = s.values.map((v, i) => point(i, (v / max) * R));
      chart.appendChild(
        K.svg('polygon', { points: pts.map((p) => p.join(',')).join(' '), class: 'vw-radar-area', fill: color, stroke: color }),
      );
      pts.forEach(([x, y], i) => {
        const dot = K.svg('circle', { cx: x, cy: y, r: 3.5, fill: color });
        const tip = K.svg('title');
        tip.textContent = `${s.name ? `${s.name} / ` : ''}${model.axes[i]}: ${s.values[i].toLocaleString()}`;
        dot.appendChild(tip);
        chart.appendChild(dot);
      });
    });
    f.wrap.appendChild(chart);

    // 凡例（名前のある系列があるときだけ）。
    if (model.series.some((s) => s.name)) {
      const legend = K.el('div', 'vw-radar-legend');
      model.series.forEach((s, si) => {
        const item = K.el('span', 'vw-radar-legend-item');
        const swatch = K.el('span', 'vw-radar-swatch');
        swatch.style.background = K.CHART_COLORS[si % K.CHART_COLORS.length];
        item.append(swatch, document.createTextNode(s.name || '(no name)'));
        legend.appendChild(item);
      });
      f.wrap.appendChild(legend);
    }
    return f.done();
  }

  global.Mindra.views.radar = { parse, render };
})(globalThis);
