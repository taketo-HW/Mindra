// ヒートマップ（view: heatmap）。書き方は docs/図の種類.md。
// 書き方は表と同じ。最初の列は名前。数のセルを、表全体の最小〜最大に合わせて色の濃さで塗る。
(function (global) {
  'use strict';

  const BASE = '#2f6fe0'; // 塗る色（濃いほど、この色に近づく）

  // セルの文字 → 数。数でなければ null（「1,200」「-3.5」「80%」は数）。
  function cellNumber(s) {
    const t = String(s).trim().replace(/,/g, '').replace(/[%％]$/, '');
    return /^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(t) ? Number(t) : null;
  }

  // MD → { title, tables: [{ caption, header, align, rows, values }], min, max }
  // values は rows と同じ形で、数のセルは数、それ以外（最初の列を含む）は null。数が無ければ min と max は null。
  function parse(text, fileName) {
    const base = global.Mindra.views.table.parse(text, fileName);
    let min = null;
    let max = null;
    const tables = base.tables.map((t) => {
      const values = t.rows.map((row) =>
        row.map((cell, c) => {
          if (c === 0) return null;
          const v = cellNumber(cell);
          if (v !== null) {
            min = min === null ? v : Math.min(min, v);
            max = max === null ? v : Math.max(max, v);
          }
          return v;
        }),
      );
      return Object.assign({}, t, { values });
    });
    return { title: base.title, tables, min, max };
  }

  // 色の濃さ（0〜1）。全部同じ数なら 0.5。
  function level(value, min, max) {
    if (max === min) return 0.5;
    return (value - min) / (max - min);
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.tables.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No table yet. Write a Markdown table: | name | a | b |'));
      return f.done();
    }
    for (const t of model.tables) {
      const table = K.el('table', 'vw-table vw-hm');
      if (t.caption && t.caption !== model.title) table.appendChild(K.el('caption', null, t.caption));
      const head = K.el('thead');
      const headRow = K.el('tr');
      t.header.forEach((text, c) => {
        const th = K.el('th', null, text);
        th.style.textAlign = t.align[c] || 'left';
        headRow.appendChild(th);
      });
      head.appendChild(headRow);
      table.appendChild(head);
      const body = K.el('tbody');
      t.rows.forEach((row, r) => {
        const tr = K.el('tr');
        row.forEach((text, c) => {
          const td = K.el(c === 0 ? 'th' : 'td', null, text);
          td.style.textAlign = t.align[c] || 'left';
          const v = t.values[r][c];
          if (v !== null) {
            const x = level(v, model.min, model.max);
            // 背景に混ぜる割合を 8〜92% にする。濃いセルは白い文字にする（どのテーマでも読める）。
            td.style.background = `color-mix(in srgb, ${BASE} ${Math.round(8 + 84 * x)}%, var(--node-bg))`;
            td.className = x >= 0.55 ? 'vw-hm-cell vw-hm-dark' : 'vw-hm-cell';
          }
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
      table.appendChild(body);
      f.wrap.appendChild(table);
    }
    return f.done();
  }

  global.Mindra.views.heatmap = { parse, render, cellNumber, level };
})(globalThis);
