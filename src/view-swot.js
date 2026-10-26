// SWOT（4 マス）（view: swot）。書き方は docs/図の種類.md。
// 区切り（## の見出し）を、書いた順に 2 列のマスに並べる。名前は自由。
(function (global) {
  'use strict';

  // MD → { title, boxes: [{ title, items: [文字] }] }
  function parse(text, fileName) {
    const M = global.Mindra;
    const boxes = M.documentSections(text).map((section) => ({
      title: section.title,
      items: section.items
        .filter((item) => item.indent === 0)
        .map((item) => M.plainText(item.text))
        .filter(Boolean),
    }));
    return { title: M.documentTitle(text, fileName), boxes };
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.boxes.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No boxes yet. Write: ## Strengths / - item'));
      return f.done();
    }
    const grid = K.el('div', 'vw-sw');
    model.boxes.forEach((box, i) => {
      const cell = K.el('section', 'vw-sw-box');
      cell.style.borderTopColor = K.CHART_COLORS[i % K.CHART_COLORS.length];
      cell.appendChild(K.el('header', 'vw-sw-head', box.title || '—'));
      const list = K.el('ul', 'vw-sw-items');
      for (const item of box.items) list.appendChild(K.el('li', null, item));
      cell.appendChild(list);
      grid.appendChild(cell);
    });
    f.wrap.appendChild(grid);
    return f.done();
  }

  global.Mindra.views.swot = { parse, render };
})(globalThis);
