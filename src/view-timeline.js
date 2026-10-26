// タイムライン（view: timeline）。書き方は docs/図の種類.md。
// 「- 日付: 出来事」の行を、書いた順に、上から下へ並べる。入れ子の行は使わない。
(function (global) {
  'use strict';

  // MD → { title, items: [{ date, text }] }
  function parse(text, fileName) {
    const M = global.Mindra;
    const items = [];
    for (const { text: line } of M.documentLines(text).lines) {
      const item = /^-\s+(.*)$/.exec(line); // 入れ子（行頭が空白）は使わない
      if (!item) continue;
      const m = /^(.*?)\s*[:：]\s+(.*)$/.exec(item[1]) || /^(.*?)\s*：\s*(.*)$/.exec(item[1]);
      const date = m ? M.plainText(m[1]) : '';
      const event = M.plainText(m ? m[2] : item[1]);
      if (event || date) items.push({ date, text: event });
    }
    return { title: M.documentTitle(text, fileName), items };
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.items.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No events yet. Write lines like: - 2026-01: event'));
      return f.done();
    }
    const list = K.el('ol', 'vw-tl');
    for (const item of model.items) {
      const li = K.el('li', 'vw-tl-item');
      li.appendChild(K.el('span', 'vw-tl-date', item.date));
      li.appendChild(K.el('span', 'vw-tl-mark'));
      li.appendChild(K.el('span', 'vw-tl-text', item.text));
      list.appendChild(li);
    }
    f.wrap.appendChild(list);
    return f.done();
  }

  global.Mindra.views.timeline = { parse, render };
})(globalThis);
