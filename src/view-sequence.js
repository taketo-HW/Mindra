// シーケンス図（view: sequence）。書き方は docs/図の種類.md。
// 「- 送信者 -> 受信者: 内容」の行を、書いた順に上から下へ並べる。戻りは「-->」（点線）。
(function (global) {
  'use strict';

  // 送信者、矢印、受信者、内容（内容は無くてもよい）。
  const MESSAGE = /^(.+?)\s*(-->|->)\s*(.+?)\s*(?:[:：]\s*(.*))?$/;

  // MD → { title, participants: [名前], messages: [{ from, to, text, dashed }] }（from と to は番号）
  function parse(text, fileName) {
    const M = global.Mindra;
    const participants = [];
    const indexOf = (name) => {
      let i = participants.indexOf(name);
      if (i === -1) i = participants.push(name) - 1;
      return i;
    };
    const messages = [];
    for (const { text: line } of M.documentLines(text).lines) {
      const item = /^-\s+(.*)$/.exec(line);
      if (!item) continue;
      const m = MESSAGE.exec(item[1]);
      if (!m) continue;
      const from = M.plainText(m[1]);
      const to = M.plainText(m[3]);
      if (!from || !to) continue;
      messages.push({ from: indexOf(from), to: indexOf(to), text: M.plainText(m[4] || ''), dashed: m[2] === '-->' });
    }
    return { title: M.documentTitle(text, fileName), participants, messages };
  }

  const PAD = 20;
  const BOX_H = 34;
  const GAP = 40; // 登場人物の箱どうしの、最低の間隔
  const ROW = 46; // メッセージ 1 本の高さ
  const SELF_ROW = 62; // 自分あてのメッセージの高さ

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.messages.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No messages yet. Write lines like: - A -> B: hello'));
      return f.done();
    }
    const a = K.area(f.wrap);
    const probe = K.el('span', 'vw-seq-probe'); // 文字の幅を測るため（ラベルと同じ文字の大きさ）
    a.box.appendChild(probe);
    const n = model.participants.length;
    const widths = model.participants.map((p) => K.textWidth(p, a.box) + 28);

    // 箱の中心どうしの間隔。ラベルが入るように広げる。
    const gaps = [];
    for (let i = 0; i < n - 1; i++) gaps[i] = widths[i] / 2 + widths[i + 1] / 2 + GAP;
    let extraRight = 0;
    for (const msg of model.messages) {
      const need = K.textWidth(msg.text, probe) + 24;
      const lo = Math.min(msg.from, msg.to);
      const hi = Math.max(msg.from, msg.to);
      if (lo === hi) {
        if (hi < n - 1) gaps[hi] = Math.max(gaps[hi], need + 50);
        else extraRight = Math.max(extraRight, need + 50);
        continue;
      }
      let span = 0;
      for (let i = lo; i < hi; i++) span += gaps[i];
      if (span < need) gaps[hi - 1] += need - span;
    }
    const cx = [PAD + widths[0] / 2];
    for (let i = 1; i < n; i++) cx[i] = cx[i - 1] + gaps[i - 1];

    // 縦の位置。
    const ys = [];
    let y = PAD + BOX_H + 36;
    for (const msg of model.messages) {
      ys.push(y);
      y += msg.from === msg.to ? SELF_ROW : ROW;
    }
    const width = cx[n - 1] + widths[n - 1] / 2 + PAD + extraRight;
    const height = y - ROW + 30 + PAD;
    a.size(width, height);
    const arrow = K.arrowMarker(a.lines, 'vw-seq-arrow');

    // 登場人物と、縦の点線。
    model.participants.forEach((name, i) => {
      a.lines.appendChild(
        K.svg('line', { x1: cx[i], y1: PAD + BOX_H, x2: cx[i], y2: height - PAD, class: 'vw-lifeline' }),
      );
      const box = K.el('div', 'vw-seq-actor', name);
      box.style.left = `${cx[i] - widths[i] / 2}px`;
      box.style.top = `${PAD}px`;
      box.style.width = `${widths[i]}px`;
      box.style.height = `${BOX_H}px`;
      a.box.appendChild(box);
    });

    // メッセージ（矢印とラベル）。
    model.messages.forEach((msg, k) => {
      const yy = ys[k];
      const cls = `vw-edge${msg.dashed ? ' is-dashed' : ''}`;
      if (msg.from === msg.to) {
        const x = cx[msg.from];
        a.lines.appendChild(
          K.svg('path', { d: `M ${x} ${yy} H ${x + 34} V ${yy + 22} H ${x + 2}`, class: cls, 'marker-end': arrow }),
        );
        if (msg.text) {
          const label = K.svg('text', { x: x + 42, y: yy + 15, class: 'vw-label-text' });
          label.textContent = msg.text;
          a.lines.appendChild(label);
        }
        return;
      }
      const x1 = cx[msg.from];
      const x2 = cx[msg.to];
      a.lines.appendChild(K.svg('line', { x1, y1: yy, x2, y2: yy, class: cls, 'marker-end': arrow }));
      if (msg.text) {
        const label = K.svg('text', { x: (x1 + x2) / 2, y: yy - 7, 'text-anchor': 'middle', class: 'vw-label-text' });
        label.textContent = msg.text;
        a.lines.appendChild(label);
      }
    });
    return f.done();
  }

  global.Mindra.views.sequence = { parse, render };
})(globalThis);
