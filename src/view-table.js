// 表（view: table）。書き方は docs/図の種類.md。
// 本文の Markdown の表を、そのまま表示する。表の直前の見出しを、その表の見出しにする。
(function (global) {
  'use strict';

  const isRow = (s) => /^\s*\|/.test(s);
  const isSeparator = (s) => isRow(s) && cells(s).every((c) => /^:?-+:?$/.test(c.trim()));

  // 行を、セルの文字に分ける（\| は文字の | として扱う）。
  function cells(row) {
    const inner = row.trim().replace(/^\|/, '').replace(/\|$/, '');
    return inner.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|'));
  }

  function alignOf(spec) {
    const s = spec.trim();
    if (s.startsWith(':') && s.endsWith(':')) return 'center';
    if (s.endsWith(':')) return 'right';
    return 'left';
  }

  // MD → { title, tables: [{ caption, header, align, rows }] }
  function parse(text, fileName) {
    const M = global.Mindra;
    const lines = M.documentLines(text).lines;
    const title = M.documentTitle(text, fileName);
    const tables = [];
    let caption = title;
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].text;
      const heading = /^#{1,6}\s+(.*)$/.exec(line);
      if (heading) {
        caption = M.plainText(heading[1]) || caption;
        i++;
        continue;
      }
      const next = lines[i + 1];
      if (isRow(line) && next && next.line === lines[i].line + 1 && isSeparator(next.text)) {
        const header = cells(line).map(M.plainText);
        const align = cells(next.text).map(alignOf);
        const rows = [];
        i += 2;
        while (i < lines.length && isRow(lines[i].text) && lines[i].line === lines[i - 1].line + 1) {
          const row = cells(lines[i].text).map(M.plainText);
          while (row.length < header.length) row.push('');
          rows.push(row.slice(0, header.length));
          i++;
        }
        tables.push({ caption, header, align, rows });
        continue;
      }
      i++;
    }
    return { title, tables };
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.tables.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No table yet. Write a Markdown table: | a | b |'));
    }
    for (const t of model.tables) {
      const table = K.el('table', 'vw-table');
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
      for (const row of t.rows) {
        const tr = K.el('tr');
        row.forEach((text, c) => {
          const td = K.el('td', null, text);
          td.style.textAlign = t.align[c] || 'left';
          tr.appendChild(td);
        });
        body.appendChild(tr);
      }
      table.appendChild(body);
      f.wrap.appendChild(table);
    }
    return f.done();
  }

  global.Mindra.views.table = { parse, render };
})(globalThis);
