// ファネル（view: funnel）。書き方は docs/図の種類.md。
// 「- 段階: 数」の行を、上から順に、数に比例した幅の段で並べる。前の段からの割合（%）を添える。
(function (global) {
  'use strict';

  const TRACK = 360; // 一番大きい段の幅（px）

  // 割合（%）を小数 1 桁に丸める。分母が 0 なら null。
  const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

  // MD → { title, steps: [{ label, value, ofPrev }] }（ofPrev は前の段に対する %。最初の段は null）
  function parse(text, fileName) {
    const M = global.Mindra;
    const steps = M.numberRows(text).map((row, i, all) => ({
      label: row.label,
      value: row.value,
      ofPrev: i === 0 ? null : percent(row.value, all[i - 1].value),
    }));
    return { title: M.documentTitle(text, fileName), steps };
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.steps.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No steps yet. Write lines like: - Visit: 1000'));
      return f.done();
    }
    const max = Math.max(...model.steps.map((s) => s.value));
    const chart = K.el('div', 'vw-fn');
    model.steps.forEach((step, i) => {
      chart.appendChild(K.el('span', 'vw-fn-label', step.label));
      const track = K.el('span', 'vw-fn-track');
      track.style.width = `${TRACK}px`;
      const bar = K.el('span', 'vw-fn-bar');
      const color = K.CHART_COLORS[i % K.CHART_COLORS.length];
      bar.style.width = `${max ? Math.max(2, (step.value / max) * TRACK) : 2}px`;
      bar.style.background = color;
      bar.style.borderColor = color;
      track.appendChild(bar);
      chart.appendChild(track);
      chart.appendChild(K.el('span', 'vw-fn-value', step.value.toLocaleString()));
      const pct = step.ofPrev === null ? '' : `${step.ofPrev}% of previous`;
      chart.appendChild(K.el('span', 'vw-fn-pct', i === 0 ? '' : step.ofPrev === null ? '–' : pct));
    });
    f.wrap.appendChild(chart);
    return f.done();
  }

  global.Mindra.views.funnel = { parse, render, percent };
})(globalThis);
