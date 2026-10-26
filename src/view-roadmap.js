// ロードマップ（view: roadmap）。書き方は docs/図の種類.md。
// 区切り（## の見出し）を時期として左から右へ並べ、その下にやることを並べる。
(function (global) {
  'use strict';

  // MD → { title, phases: [{ title, items: [文字] }] }
  function parse(text, fileName) {
    const M = global.Mindra;
    const phases = M.documentSections(text).map((section) => ({
      title: section.title,
      items: section.items
        .filter((item) => item.indent === 0)
        .map((item) => M.plainText(item.text))
        .filter(Boolean),
    }));
    return { title: M.documentTitle(text, fileName), phases };
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.phases.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No phases yet. Write: ## Q1 / - task'));
      return f.done();
    }
    const road = K.el('div', 'vw-rm');
    model.phases.forEach((phase, i) => {
      const col = K.el('section', 'vw-rm-phase');
      const head = K.el('header', 'vw-rm-head', phase.title || '—');
      head.style.background = K.CHART_COLORS[i % K.CHART_COLORS.length];
      col.appendChild(head);
      const list = K.el('ul', 'vw-rm-items');
      for (const item of phase.items) list.appendChild(K.el('li', null, item));
      col.appendChild(list);
      road.appendChild(col);
    });
    f.wrap.appendChild(road);
    return f.done();
  }

  global.Mindra.views.roadmap = { parse, render };
})(globalThis);
