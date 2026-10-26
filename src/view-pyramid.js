// ピラミッド（view: pyramid）。書き方は docs/図の種類.md。
// 箇条書きを、上から順に、狭い段から広い段へ積む。
(function (global) {
  'use strict';

  const ROW = 52; // 1 段の高さ（px）
  const TOP = 0.18; // 一番上の幅（一番下の幅に対する割合）
  const MIN_WIDTH = 320; // 一番下の幅の最小（px）
  const PAD = 24; // 文字の左右の余白（合計、px）

  // MD → { title, levels: [名前] }（字下げのない箇条書きだけ）
  function parse(text, fileName) {
    const M = global.Mindra;
    const levels = [];
    for (const { text: line } of M.documentLines(text).lines) {
      const item = /^[-*+]\s+(.*)$/.exec(line);
      if (!item) continue;
      const label = M.plainText(item[1]);
      if (label) levels.push(label);
    }
    return { title: M.documentTitle(text, fileName), levels };
  }

  // 高さ y（0〜全体）での幅の割合。
  const ratioAt = (y, total) => TOP + (1 - TOP) * (y / total);

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    const n = model.levels.length;
    if (!n) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No levels yet. Write lines like: - Top level'));
      return f.done();
    }
    const total = n * ROW;
    const probe = K.el('div', 'vw-py-probe');
    f.wrap.appendChild(probe);
    // 各段の真ん中の幅に、名前が収まるように、一番下の幅を決める。
    let width = MIN_WIDTH;
    model.levels.forEach((label, i) => {
      const need = K.textWidth(label, probe) + PAD;
      width = Math.max(width, need / ratioAt((i + 0.5) * ROW, total));
    });
    width = Math.ceil(width);
    probe.remove();
    const chart = K.svg('svg', { width, height: total + 2, class: 'vw-py' });
    const cx = width / 2;
    model.levels.forEach((label, i) => {
      const y0 = i * ROW;
      const y1 = y0 + ROW;
      const w0 = (width * ratioAt(y0, total)) / 2;
      const w1 = (width * ratioAt(y1, total)) / 2;
      const color = K.CHART_COLORS[i % K.CHART_COLORS.length];
      const pts = [
        [cx - w0, y0 + 1],
        [cx + w0, y0 + 1],
        [cx + w1, y1 - 1],
        [cx - w1, y1 - 1],
      ];
      chart.appendChild(
        K.svg('polygon', {
          points: pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' '),
          class: 'vw-py-step',
          fill: color,
          stroke: color,
        }),
      );
      const t = K.svg('text', { x: cx, y: y0 + ROW / 2, class: 'vw-py-label' });
      t.textContent = label;
      chart.appendChild(t);
    });
    f.wrap.appendChild(chart);
    return f.done();
  }

  global.Mindra.views.pyramid = { parse, render };
})(globalThis);
