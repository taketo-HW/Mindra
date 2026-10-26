// 特性要因図（view: fishbone）。書き方は docs/図の種類.md。
// 題名（#）が結果（魚の頭）。区切り（##）が大きな骨（分類）。箇条書きが原因、入れ子（1 段）が細かい原因。
(function (global) {
  'use strict';

  // MD → { title, categories: [{ name, causes: [{ name, subs: [名前] }] }] }
  function parse(text, fileName) {
    const M = global.Mindra;
    const categories = [];
    for (const section of M.documentSections(text)) {
      const causes = [];
      let base = null; // 原因の字下げ（区切りの中で最初の箇条書き）
      for (const item of section.items) {
        const name = M.plainText(item.text);
        if (!name) continue;
        if (base === null || item.indent <= base || !causes.length) {
          if (base === null || item.indent < base) base = item.indent;
          causes.push({ name, subs: [] });
        } else {
          // 2 段より深い入れ子も、細かい原因として同じ段に並べる。
          causes[causes.length - 1].subs.push(name);
        }
      }
      if (!section.title && !causes.length) continue;
      categories.push({ name: section.title, causes });
    }
    return { title: M.documentTitle(text, fileName), categories };
  }

  const PAD = 20;
  const SLOPE = 0.55; // 骨の傾き（縦 1 に対する横の量）
  const CAUSE_ROW = 30; // 原因 1 つの高さ
  const SUB_ROW = 18; // 細かい原因 1 つの高さ
  const BONE_TOP = 26; // 骨の先（分類の名前）と最初の原因の間
  const BONE_BOTTOM = 22; // 最後の原因と背骨の間
  const COL_GAP = 36;

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.categories.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No causes yet. Write "## Category" headings with "- cause" items.'));
      return f.done();
    }
    const a = K.area(f.wrap);
    const put = (cls, text) => {
      const div = K.el('div', cls, text);
      a.box.appendChild(div);
      return div;
    };

    // 文字を置いて、大きさを測る。
    const bones = model.categories.map((cat, i) => {
      const label = put('vw-fb-cat', cat.name || '-');
      const causes = cat.causes.map((c) => ({
        div: put('vw-fb-cause', c.name),
        subs: c.subs.map((s) => put('vw-fb-sub', s)),
      }));
      // 骨の縦の長さ（背骨から先まで）。
      let len = BONE_TOP;
      for (const c of causes) len += CAUSE_ROW + c.subs.length * SUB_ROW;
      len += BONE_BOTTOM;
      return { up: i % 2 === 0, label, causes, len, lw: label.offsetWidth, lh: label.offsetHeight };
    });
    const head = put('vw-fb-head', model.title || '');

    // 骨の中の位置（背骨からの縦の距離 d）。画面の上から順に並べ、d に直す。
    // 上の骨は先（上）から、下の骨は背骨の近く（上）から、書いた順に並ぶ。
    for (const b of bones) {
      let t = b.up ? BONE_TOP : BONE_BOTTOM; // 骨の上の端からの距離
      const toD = (off) => (b.up ? b.len - off : off);
      for (const c of b.causes) {
        const lineT = t + CAUSE_ROW - 8; // 原因の線（文字は線の上）
        c.d = toD(lineT);
        c.w = c.div.offsetWidth;
        c.h = c.div.offsetHeight;
        c.subD = c.subs.map((s, k) => toD(lineT + (k + 1) * SUB_ROW));
        t += CAUSE_ROW + c.subs.length * SUB_ROW;
      }
      // 背骨との交点から、左にどれだけ場所が要るか。
      let need = b.len * SLOPE + b.lw / 2;
      for (const c of b.causes) {
        need = Math.max(need, c.d * SLOPE + c.w + 12);
        c.subs.forEach((s, k) => {
          need = Math.max(need, c.subD[k] * SLOPE + s.offsetWidth + 22);
        });
      }
      b.need = need;
    }

    // 上下の組（列）ごとに、交点の x を決める（左から右へ）。
    const upH = Math.max(0, ...bones.filter((b) => b.up).map((b) => b.len + b.lh + 4));
    const downH = Math.max(0, ...bones.filter((b) => !b.up).map((b) => b.len + b.lh + 4));
    const spineY = PAD + upH;
    let x = PAD;
    for (let i = 0; i < bones.length; i += 2) {
      const pair = bones.slice(i, i + 2);
      x += Math.max(...pair.map((b) => b.need));
      pair.forEach((b) => (b.x = x));
      x += COL_GAP;
    }
    const spineEnd = x + 10;
    const hw = head.offsetWidth;
    const hh = head.offsetHeight;
    const width = spineEnd + hw + PAD;
    const height = spineY + Math.max(downH, hh / 2) + PAD;
    a.size(width, height);
    const arrow = K.arrowMarker(a.lines, 'vw-fb-arrow');

    const line = (x1, y1, x2, y2, cls, marker) => {
      const attrs = { x1, y1, x2, y2, class: cls };
      if (marker) attrs['marker-end'] = marker;
      a.lines.appendChild(K.svg('line', attrs));
    };
    const place = (div, left, top) => {
      div.style.left = `${left}px`;
      div.style.top = `${top}px`;
    };

    // 背骨と頭。
    line(PAD, spineY, spineEnd, spineY, 'vw-fb-spine', arrow);
    place(head, spineEnd, spineY - hh / 2);

    for (const b of bones) {
      const s = b.up ? -1 : 1; // 上は -1、下は +1
      const yAt = (d) => spineY + s * d;
      const xAt = (d) => b.x - d * SLOPE;
      line(xAt(b.len), yAt(b.len), b.x, spineY, 'vw-fb-bone');
      // 分類の名前は骨の先に。
      place(b.label, xAt(b.len) - b.lw / 2, b.up ? yAt(b.len) - b.lh - 2 : yAt(b.len) + 2);
      for (const c of b.causes) {
        const bx = xAt(c.d);
        const y = yAt(c.d);
        line(bx - c.w - 6, y, bx, y, 'vw-fb-tick');
        place(c.div, bx - c.w - 4, y - c.h);
        c.subs.forEach((sub, k) => {
          const d = c.subD[k];
          const sy = yAt(d);
          const sx = xAt(d);
          const sw = sub.offsetWidth;
          const sh = sub.offsetHeight;
          line(sx - sw - 16, sy, sx - 8, sy, 'vw-fb-subtick');
          place(sub, sx - sw - 14, sy - sh);
        });
      }
    }
    return f.done();
  }

  global.Mindra.views.fishbone = { parse, render };
})(globalThis);
