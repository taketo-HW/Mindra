// カンバン（view: kanban）。書き方は docs/図の種類.md。
// 区切り（## の見出し）ごとに列を作り、箇条書きをカードにする。
(function (global) {
  'use strict';

  // MD → { title, columns: [{ title, cards: [文字] }] }
  function parse(text, fileName) {
    const M = global.Mindra;
    const columns = M.documentSections(text).map((section) => ({
      title: section.title,
      cards: section.items
        .filter((item) => item.indent === 0)
        .map((item) => M.plainText(item.text))
        .filter(Boolean),
    }));
    return { title: M.documentTitle(text, fileName), columns };
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.columns.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No columns yet. Write: ## To do / - card'));
      return f.done();
    }
    const board = K.el('div', 'vw-kb');
    for (const column of model.columns) {
      const col = K.el('section', 'vw-kb-col');
      const head = K.el('header', 'vw-kb-head');
      head.appendChild(K.el('span', null, column.title || '—'));
      head.appendChild(K.el('span', 'vw-kb-count', String(column.cards.length)));
      col.appendChild(head);
      for (const card of column.cards) col.appendChild(K.el('div', 'vw-kb-card', card));
      board.appendChild(col);
    }
    f.wrap.appendChild(board);
    return f.done();
  }

  global.Mindra.views.kanban = { parse, render };
})(globalThis);
