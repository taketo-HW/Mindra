// スイムレーン（view: swimlane）。書き方は docs/図の種類.md。
// 「## 担当」がレーン（同じ名前は同じレーン）。その下の「- 手順」を、書いた順に左から右へ並べ、
// 前の手順から矢印でつなぐ。「- A -> B」の行は手順ではなく、矢印を足す。
(function (global) {
  'use strict';

  // MD → { title, lanes: [名前], steps: [{ name, lane }], edges: [{ from, to, label, extra }] }
  // lane・from・to は番号。extra は「- A -> B」の行で足した矢印。
  function parse(text, fileName) {
    const M = global.Mindra;
    const lanes = [];
    const steps = [];
    const links = [];
    for (const section of M.documentSections(text)) {
      let lane = lanes.indexOf(section.title);
      for (const item of section.items) {
        if (item.indent > 0) continue; // 字下げした行は、手順の補足として無視する
        if (/-{1,2}>/.test(item.text)) {
          const parts = item.text.split(/\s*-{1,2}>\s*/);
          let label = '';
          const last = /^(.*?)\s*[:：]\s*(.*)$/.exec(parts[parts.length - 1]);
          if (last) {
            parts[parts.length - 1] = last[1];
            label = M.plainText(last[2]);
          }
          const names = parts.map(M.plainText);
          if (names.some((name) => !name)) continue;
          for (let i = 0; i < names.length - 1; i++) {
            links.push({ from: names[i], to: names[i + 1], label: i === names.length - 2 ? label : '' });
          }
          continue;
        }
        const name = M.plainText(item.text);
        if (!name) continue;
        if (lane < 0) {
          lane = lanes.length;
          lanes.push(section.title);
        }
        steps.push({ name, lane });
      }
    }
    // 書いた順の矢印。
    const edges = [];
    for (let i = 1; i < steps.length; i++) edges.push({ from: i - 1, to: i, label: '', extra: false });
    // 「- A -> B」の矢印。名前は、最初に出てきた手順を指す（後ろに書いた手順も指せる）。知らない名前は無視する。
    const indexOf = (name) => steps.findIndex((s) => s.name === name);
    for (const link of links) {
      const from = indexOf(link.from);
      const to = indexOf(link.to);
      if (from < 0 || to < 0) continue;
      const same = edges.find((e) => e.from === from && e.to === to);
      if (same) {
        if (link.label && !same.label) same.label = link.label;
        continue;
      }
      edges.push({ from, to, label: link.label, extra: true });
    }
    return { title: M.documentTitle(text, fileName), lanes, steps, edges };
  }

  const GAP_X = 48; // 手順の間
  const LANE_PAD = 16; // レーンの上下の余白
  const HEAD_PAD = 8; // レーン名の右の余り

  function smoothPath(a, b) {
    const mid = (a.x + b.x) / 2;
    return `M ${a.x} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${b.x} ${b.y}`;
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.steps.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No steps yet. Write a "## Person" heading, then lines like: - Do something'));
      return f.done();
    }
    const a = K.area(f.wrap);

    // レーンの名前と手順の箱を置いて、大きさを測る。
    const heads = model.lanes.map((name) => {
      const div = K.el('div', 'vw-sl-head', name);
      a.box.appendChild(div);
      return div;
    });
    const boxes = model.steps.map((step) => {
      const div = K.el('div', 'vw-sl-step', step.name);
      a.box.appendChild(div);
      return div;
    });
    const headW = Math.max(...heads.map((d) => d.offsetWidth)) + HEAD_PAD;
    const sw = boxes.map((d) => d.offsetWidth);
    const sh = boxes.map((d) => d.offsetHeight);

    // レーンの高さ: そのレーンで一番高い箱 + 余白。戻る矢印のために、下に少し余裕を取る。
    const laneH = model.lanes.map((_, l) => {
      const hs = model.steps.map((s, i) => (s.lane === l ? sh[i] : 0));
      return Math.max(...hs, heads[l].offsetHeight) + LANE_PAD * 2;
    });
    const laneY = [];
    let y = 0;
    laneH.forEach((h, l) => {
      laneY[l] = y;
      y += h;
    });
    const totalH = y;

    // 手順の位置: 1 列に 1 つ、左から右へ。
    const X = [];
    let x = headW + GAP_X / 2;
    model.steps.forEach((step, i) => {
      X[i] = x;
      x += sw[i] + GAP_X;
    });
    const width = x - GAP_X / 2;
    const B = model.steps.map((step, i) => ({
      x: X[i],
      y: laneY[step.lane] + (laneH[step.lane] - sh[i]) / 2,
      w: sw[i],
      h: sh[i],
    }));

    a.size(width, totalH);
    // レーンの帯（線の下に描く）。
    model.lanes.forEach((_, l) => {
      const band = K.el('div', `vw-sl-lane${l % 2 ? ' is-odd' : ''}`);
      band.style.top = `${laneY[l]}px`;
      band.style.height = `${laneH[l]}px`;
      band.style.width = `${width}px`;
      a.box.insertBefore(band, a.box.firstChild);
      const head = heads[l];
      head.style.top = `${laneY[l]}px`;
      head.style.height = `${laneH[l]}px`;
      head.style.width = `${headW}px`;
    });
    boxes.forEach((div, i) => {
      div.style.left = `${B[i].x}px`;
      div.style.top = `${B[i].y}px`;
    });

    const arrow = K.arrowMarker(a.lines, 'vw-sl-arrow');
    const addLabel = (text, lx, ly) => {
      if (!text) return;
      const label = K.svg('text', { x: lx, y: ly, 'text-anchor': 'middle', class: 'vw-label-text' });
      label.textContent = text;
      a.lines.appendChild(label);
    };
    model.edges.forEach((e) => {
      const u = B[e.from];
      const v = B[e.to];
      const cls = `vw-edge${e.extra ? ' is-dashed' : ''}`;
      if (e.to > e.from) {
        // 前へ: 右の辺から左の辺へ。
        const p = { x: u.x + u.w, y: u.y + u.h / 2 };
        const q = { x: v.x, y: v.y + v.h / 2 };
        a.lines.appendChild(K.svg('path', { d: smoothPath(p, q), class: cls, 'marker-end': arrow }));
        addLabel(e.label, (p.x + q.x) / 2, (p.y + q.y) / 2 - 6);
        return;
      }
      // 戻る（または自分へ）: 箱の下から出て、相手の箱の下へ入る。
      const x1 = u.x + u.w / 2 + (e.from === e.to ? 8 : 0);
      const x2 = v.x + v.w / 2 - (e.from === e.to ? 8 : 0);
      const y1 = u.y + u.h;
      const y2 = v.y + v.h;
      const yc = Math.max(y1, y2) + LANE_PAD + 6;
      a.lines.appendChild(
        K.svg('path', { d: `M ${x1} ${y1} C ${x1} ${yc}, ${x2} ${yc}, ${x2} ${y2}`, class: `${cls} is-back`, 'marker-end': arrow }),
      );
      addLabel(e.label, (x1 + x2) / 2, yc - 2);
    });
    return f.done();
  }

  global.Mindra.views.swimlane = { parse, render };
})(globalThis);
