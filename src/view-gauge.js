// 進み具合（view: gauge）。書き方は docs/図の種類.md。
// 「- 名前: 数%」は割合、「- 名前: 数 / 目標」は目標に対する割合。半円のメーターと数で表示する。
(function (global) {
  'use strict';

  const R = 64; // 半円の半径
  const STROKE = 14; // メーターの太さ
  const W = 2 * R + STROKE + 8;
  const H = R + STROKE / 2 + 8;

  const NUM = '(-?\\d[\\d,]*(?:\\.\\d+)?)';
  const toNumber = (s) => Number(s.replace(/,/g, ''));

  // 値の文字 → { value, target, percent }。読めなければ null。
  // percent は小数 1 桁。目標が 0 のときは null。
  function readValue(s) {
    const ratio = new RegExp(`^${NUM}\\s*[/／]\\s*${NUM}`).exec(s);
    if (ratio) {
      const value = toNumber(ratio[1]);
      const target = toNumber(ratio[2]);
      return { value, target, percent: target > 0 ? Math.max(0, Math.round((value / target) * 1000) / 10) : null };
    }
    const pct = new RegExp(`^${NUM}\\s*[%％]`).exec(s);
    if (pct) {
      const value = toNumber(pct[1]);
      return { value, target: null, percent: Math.max(0, value) };
    }
    return null;
  }

  // MD → { title, rows: [{ label, value, target, percent }] }
  function parse(text, fileName) {
    const M = global.Mindra;
    const rows = [];
    for (const { text: line } of M.documentLines(text).lines) {
      const item = /^-\s+(.*)$/.exec(line);
      if (!item) continue;
      const m = /^(.*?)\s*(?::\s|：)\s*(.*)$/.exec(item[1]);
      if (!m) continue;
      const label = M.plainText(m[1]);
      const read = readValue(M.plainText(m[2]));
      if (label && read) rows.push(Object.assign({ label }, read));
    }
    return { title: M.documentTitle(text, fileName), rows };
  }

  // 半円の弧（左端から、割合 t まで。t は 0〜1）。
  function arcPath(cx, cy, r, t) {
    const a = Math.PI * (1 - t);
    const x = cx + r * Math.cos(a);
    const y = cy - r * Math.sin(a);
    return `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.rows.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No values yet. Write lines like: - Sales: 72% or - Users: 45 / 60'));
      return f.done();
    }
    const grid = K.el('div', 'vw-ga');
    model.rows.forEach((row, i) => {
      const card = K.el('div', 'vw-ga-card');
      const meter = K.svg('svg', { width: W, height: H, class: 'vw-ga-meter' });
      const cx = W / 2;
      const cy = R + STROKE / 2 + 4;
      meter.appendChild(K.svg('path', { d: arcPath(cx, cy, R, 1), class: 'vw-ga-track', 'stroke-width': STROKE }));
      const t = row.percent === null ? 0 : Math.min(1, Math.max(0, row.percent / 100));
      if (t > 0) {
        meter.appendChild(
          K.svg('path', {
            d: arcPath(cx, cy, R, t),
            class: 'vw-ga-fill',
            stroke: K.CHART_COLORS[i % K.CHART_COLORS.length],
            'stroke-width': STROKE,
          }),
        );
      }
      const num = K.svg('text', { x: cx, y: cy - 4, class: 'vw-ga-percent' });
      num.textContent = row.percent === null ? 'n/a' : `${row.percent}%`;
      meter.appendChild(num);
      card.appendChild(meter);
      card.appendChild(K.el('div', 'vw-ga-label', row.label));
      const detail =
        row.target === null ? '' : `${row.value.toLocaleString()} / ${row.target.toLocaleString()}`;
      card.appendChild(K.el('div', 'vw-ga-detail', detail || ' '));
      if (row.percent !== null && row.percent > 100) card.classList.add('vw-ga-over');
      grid.appendChild(card);
    });
    f.wrap.appendChild(grid);
    return f.done();
  }

  global.Mindra.views.gauge = { parse, render, readValue, arcPath };
})(globalThis);
