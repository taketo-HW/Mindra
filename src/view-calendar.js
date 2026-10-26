// カレンダー（view: calendar）。書き方は docs/図の種類.md。
// 「- YYYY-MM-DD: 予定」を、予定のある月ごとに、月曜始まりの表で表示する。
// 日付の計算は UTC で行い、時間帯に左右されないようにする。
(function (global) {
  'use strict';

  // その月の、1 日の曜日（0=月〜6=日）と、日数。UTC で計算する。
  function monthGrid(year, month) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const firstWeekday = (first.getUTCDay() + 6) % 7; // 日曜=0 を、月曜=0 にずらす
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { firstWeekday, days };
  }

  // MD → { title, months: [{ year, month, events: { 日 → [予定] } }] }（月は日付順）
  function parse(text, fileName) {
    const M = global.Mindra;
    const byMonth = new Map();
    for (const { text: line } of M.documentLines(text).lines) {
      const item = /^-\s+(.*)$/.exec(line);
      if (!item) continue;
      const m = /^(\d{4})-(\d{2})-(\d{2})\s*[:：]\s*(.*)$/.exec(item[1]);
      if (!m) continue;
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      // 実在する日付か確かめる（2 月 31 日などは捨てる）。UTC で確認する。
      const probe = new Date(Date.UTC(year, month - 1, day));
      if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) continue;
      const event = M.plainText(m[4]);
      if (!event) continue;
      const key = `${year}-${month}`;
      if (!byMonth.has(key)) byMonth.set(key, { year, month, events: {} });
      const events = byMonth.get(key).events;
      (events[day] = events[day] || []).push(event);
    }
    const months = [...byMonth.values()].sort((a, b) => a.year - b.year || a.month - b.month);
    return { title: M.documentTitle(text, fileName), months };
  }

  const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];

  function render(model, container, options) {
    const K = global.Mindra.viewKit;
    const f = K.frame(container, options && options.zoom, model.title);
    if (!model.months.length) {
      f.wrap.appendChild(K.el('p', 'vw-empty', 'No events yet. Write lines like: - 2026-01-05: event'));
      return f.done();
    }
    for (const m of model.months) {
      const block = K.el('section', 'vw-cal-month');
      block.appendChild(K.el('header', 'vw-cal-title', `${m.year}-${String(m.month).padStart(2, '0')}`));
      const table = K.el('table', 'vw-cal-table');
      const head = K.el('tr');
      for (const w of WEEKDAYS) head.appendChild(K.el('th', 'vw-cal-wd', w));
      table.appendChild(head);
      const { firstWeekday, days } = monthGrid(m.year, m.month);
      let day = 1;
      for (let row = 0; day <= days; row++) {
        const tr = K.el('tr');
        for (let col = 0; col < 7; col++) {
          const td = K.el('td', 'vw-cal-cell');
          if ((row > 0 || col >= firstWeekday) && day <= days) {
            td.classList.add('is-day');
            if (col >= 5) td.classList.add('is-weekend');
            td.appendChild(K.el('div', 'vw-cal-num', String(day)));
            for (const ev of m.events[day] || []) td.appendChild(K.el('div', 'vw-cal-event', ev));
            day++;
          }
          tr.appendChild(td);
        }
        table.appendChild(tr);
      }
      block.appendChild(table);
      f.wrap.appendChild(block);
    }
    return f.done();
  }

  global.Mindra.views.calendar = { parse, render, monthGrid };
})(globalThis);
