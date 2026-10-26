// 状態遷移図（view: state）。書き方は docs/図の種類.md。
// 書き方はフローチャートと同じ（「- A -> B: 条件」）。「*」は、矢印の元なら開始（黒丸）、先なら終了（二重丸）。
// 「*」は出てくるたびに別の点にする（1 つにまとめない）。並べ方はフローチャートの layout を使う。
(function (global) {
  'use strict';

  // MD → { title, nodes: [{ name, kind }], edges: [{ from, to, label }] }
  // kind は 'state'（状態）、'start'（開始）、'end'（終了）。from と to は番号。
  function parse(text, fileName) {
    const M = global.Mindra;
    const nodes = [];
    const ids = new Map();
    const stateId = (name) => {
      if (!ids.has(name)) {
        ids.set(name, nodes.length);
        nodes.push({ name, kind: 'state' });
      }
      return ids.get(name);
    };
    const pointId = (kind) => {
      nodes.push({ name: '', kind });
      return nodes.length - 1;
    };
    const edges = [];
    for (const { text: line } of M.documentLines(text).lines) {
      const item = /^\s*-\s+(.*)$/.exec(line);
      if (!item) continue;
      const content = item[1];
      if (!/-{1,2}>/.test(content)) {
        const name = M.plainText(content);
        if (name && name !== '*') stateId(name);
        continue;
      }
      const parts = content.split(/\s*-{1,2}>\s*/);
      // 条件（「: 入金」）は、最後の矢印に付ける。
      let label = '';
      const last = /^(.*?)\s*[:：]\s*(.*)$/.exec(parts[parts.length - 1]);
      if (last) {
        parts[parts.length - 1] = last[1];
        label = M.plainText(last[2]);
      }
      // 「*」は plainText で強調の記号として消えないよう、先に見分ける。
      const names = parts.map((p) => (p.trim() === '*' ? '*' : M.plainText(p)));
      if (names.some((name) => !name)) continue;
      for (let i = 0; i < names.length - 1; i++) {
        const from = names[i] === '*' ? pointId('start') : stateId(names[i]);
        const to = names[i + 1] === '*' ? pointId('end') : stateId(names[i + 1]);
        edges.push({ from, to, label: i === names.length - 2 ? label : '' });
      }
    }
    return { title: M.documentTitle(text, fileName), nodes, edges };
  }

  const PAD = 20;
  const START = 18; // 開始の黒丸の直径
  const END = 24; // 終了の二重丸の直径

  // 点をなめらかにつなぐ（横向きに出て、横向きに入る）。フローチャートと同じ。
  function smoothPath(points) {
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1];
      const b = points[k];
      const mid = (a.x + b.x) / 2;
      d += ` C ${mid} ${a.y}, ${mid} ${b.y}, ${b.x} ${b.y}`;
    }
    return d;
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const F = global.Mindra.views.flowchart;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.nodes.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No states yet. Write lines like: - * -> Waiting'));
      return f.done();
    }
    const a = K.area(f.wrap);

    // 状態の箱を置いて、大きさを測る。開始・終了は決まった大きさの丸。
    const labels = model.nodes.map((node) => {
      if (node.kind !== 'state') return null;
      const div = K.el('div', 'vw-st-node', node.name);
      a.box.appendChild(div);
      return div;
    });
    const size = (node, i, measure) => {
      if (node.kind === 'start') return START;
      if (node.kind === 'end') return END;
      return measure(labels[i]);
    };
    const bw = model.nodes.map((node, i) => size(node, i, (d) => d.offsetWidth));
    const bh = model.nodes.map((node, i) => size(node, i, (d) => d.offsetHeight));

    const L = F.layout(model, bw, bh);
    const B = L.boxes;
    const loopRoom = L.back.size ? 50 : 0;
    const width = L.right + PAD + (model.edges.some((e) => e.from === e.to) ? 50 : 0);
    const height = L.bottom + loopRoom + PAD;
    a.size(width, height);
    const arrow = K.arrowMarker(a.lines, 'vw-st-arrow');

    labels.forEach((div, i) => {
      if (!div) return;
      div.style.left = `${B[i].x}px`;
      div.style.top = `${B[i].y}px`;
    });

    const addLabel = (text, lx, ly) => {
      if (!text) return;
      const label = K.svg('text', { x: lx, y: ly, 'text-anchor': 'middle', class: 'vw-label-text' });
      label.textContent = text;
      a.lines.appendChild(label);
    };

    // 矢印。前へ進む矢印は右の辺から左の辺へ。戻る矢印は下を回る点線。自分へ戻る矢印は右に輪を描く。
    model.edges.forEach((e, i) => {
      const u = B[e.from];
      const v = B[e.to];
      if (e.from === e.to) {
        const sx = u.x + u.w;
        const sy = u.y + u.h / 2;
        a.lines.appendChild(
          K.svg('path', {
            d: `M ${sx} ${sy - 6} C ${sx + 44} ${sy - 36}, ${sx + 44} ${sy + 36}, ${sx} ${sy + 6}`,
            class: 'vw-edge',
            'marker-end': arrow,
          }),
        );
        addLabel(e.label, sx + 40, sy - 26);
        return;
      }
      if (L.back.has(i)) {
        const x1 = u.x + u.w / 2;
        const y1 = u.y + u.h;
        const x2 = v.x + v.w / 2;
        const y2 = v.y + v.h;
        const yc = L.bottom + loopRoom - 10;
        a.lines.appendChild(
          K.svg('path', { d: `M ${x1} ${y1} C ${x1} ${yc}, ${x2} ${yc}, ${x2} ${y2}`, class: 'vw-edge is-back', 'marker-end': arrow }),
        );
        addLabel(e.label, (x1 + x2) / 2, yc - 4);
        return;
      }
      const points = [{ x: u.x + u.w, y: u.y + u.h / 2 }];
      for (const p of L.via.get(i) || []) points.push({ x: p.x, y: p.y + p.h / 2 });
      points.push({ x: v.x, y: v.y + v.h / 2 });
      a.lines.appendChild(K.svg('path', { d: smoothPath(points), class: 'vw-edge', 'marker-end': arrow }));
      addLabel(e.label, (points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2 - 6);
    });

    // 開始（黒丸）と終了（二重丸）。矢印の上に描く。
    model.nodes.forEach((node, i) => {
      if (node.kind === 'state') return;
      const b = B[i];
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      if (node.kind === 'start') {
        a.lines.appendChild(K.svg('circle', { cx, cy, r: START / 2, class: 'vw-st-start' }));
      } else {
        a.lines.appendChild(K.svg('circle', { cx, cy, r: END / 2 - 1, class: 'vw-st-end-ring' }));
        a.lines.appendChild(K.svg('circle', { cx, cy, r: END / 2 - 6, class: 'vw-st-end-dot' }));
      }
    });
    return f.done();
  }

  global.Mindra.views.state = { parse, render };
})(globalThis);
