import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTabList } from '../tools/orca.mjs';

test('タブの一覧の出力を、番号・ID・題名・URL に分ける', () => {
  const text = [
    '  [0] 6c5902ad-10dc-47d1-b5c5-5c6cc631667d  カレーの作り方 — file:///home/taketo/x/mindmap-d30f8f.html',
    '* [1] 42710c2f-5509-4eaa-98cb-2b23a5d928d4  Mindra — http://127.0.0.1:7777/?file=%2Fwork%2FMindra%2Fa.md&dir=%2Fwork%2FMindra',
    '',
  ].join('\n');
  const tabs = parseTabList(text);
  assert.equal(tabs.length, 2);
  assert.deepEqual(tabs[0], {
    current: false,
    index: 0,
    pageId: '6c5902ad-10dc-47d1-b5c5-5c6cc631667d',
    title: 'カレーの作り方',
    url: 'file:///home/taketo/x/mindmap-d30f8f.html',
  });
  assert.equal(tabs[1].current, true);
  assert.equal(tabs[1].index, 1);
  assert.equal(tabs[1].title, 'Mindra');
});

test('一覧が空、または読めない行は無視する', () => {
  assert.deepEqual(parseTabList(''), []);
  assert.deepEqual(parseTabList(undefined), []);
  assert.deepEqual(parseTabList('something else'), []);
});
