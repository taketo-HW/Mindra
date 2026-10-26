// チェックリスト（view: checklist）。書き方は docs/図の種類.md。
// 「- [x]」は済み、「- [ ]」はまだ。区切りごとと全体の進み具合を、棒で表示する。
(function (global) {
  'use strict';

  // MD → { title, groups: [{ title, items: [{ text, done, level }], done, total }], done, total }
  // done は true / false。[ ] の無い行は null（数えない）。level は字下げ（2 スペースで 1）。
  function parse(text, fileName) {
    const M = global.Mindra;
    let done = 0;
    let total = 0;
    const groups = M.documentSections(text).map((section) => {
      const items = section.items
        .map((item) => {
          const box = /^\[([ xX])\]\s*(.*)$/.exec(item.text);
          return {
            text: M.plainText(box ? box[2] : item.text),
            done: box ? box[1] !== ' ' : null,
            level: Math.floor(item.indent / 2),
          };
        })
        .filter((item) => item.text);
      const counted = items.filter((item) => item.done !== null);
      const groupDone = counted.filter((item) => item.done).length;
      done += groupDone;
      total += counted.length;
      return { title: section.title, items, done: groupDone, total: counted.length };
    });
    return { title: M.documentTitle(text, fileName), groups, done, total };
  }

  function progress(K, done, total) {
    const box = K.el('div', 'vw-ck-progress');
    const bar = K.el('div', 'vw-ck-bar');
    const fill = K.el('div', 'vw-ck-fill');
    fill.style.width = `${total ? (done / total) * 100 : 0}%`;
    bar.appendChild(fill);
    box.appendChild(bar);
    box.appendChild(K.el('span', 'vw-ck-count', `${done} / ${total}`));
    return box;
  }

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.groups.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No items yet. Write: - [ ] task'));
      return f.done();
    }
    f.wrap.appendChild(progress(K, model.done, model.total));
    for (const group of model.groups) {
      const section = K.el('section', 'vw-ck-group');
      if (group.title) {
        const head = K.el('header', 'vw-ck-head');
        head.appendChild(K.el('span', null, group.title));
        head.appendChild(progress(K, group.done, group.total));
        section.appendChild(head);
      }
      const list = K.el('ul', 'vw-ck-list');
      for (const item of group.items) {
        const li = K.el('li', `vw-ck-item${item.done ? ' is-done' : ''}`);
        li.style.paddingLeft = `${item.level * 22}px`;
        const mark = item.done === null ? '•' : item.done ? '☑' : '☐';
        li.appendChild(K.el('span', 'vw-ck-mark', mark));
        li.appendChild(K.el('span', null, item.text));
        list.appendChild(li);
      }
      section.appendChild(list);
      f.wrap.appendChild(section);
    }
    return f.done();
  }

  global.Mindra.views.checklist = { parse, render };
})(globalThis);
