// ローカルの MD ファイルを開く・作る・監視する。
// File System Access API（Chrome / Edge など）を使う。サーバーは要らない。
(function (global) {
  'use strict';

  const INTERVAL_MS = 1000;
  const MD_TYPES = [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }];

  // ファイルを文字列で読む。file.text() は先頭の BOM を消すので、BOM を残すために自分で復号する。
  async function readText(file) {
    return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await file.arrayBuffer());
  }

  // 取得済みのファイルハンドルの内容を監視する。
  // onChange(text, fileName) は、内容が変わったときに呼ばれる。戻り値の stop() で監視を止める。
  async function watchHandle(handle, onChange, onError) {
    let lastText = null;
    let timer = null;
    let stopped = false;

    const check = async () => {
      try {
        const file = await handle.getFile();
        const text = await readText(file);
        if (!stopped && text !== lastText) {
          lastText = text;
          onChange(text, handle.name);
        }
      } catch (err) {
        // 次に読めたとき、内容が同じでも表示を戻せるように覚えない。
        lastText = null;
        if (onError) onError(err);
      }
      if (!stopped) timer = setTimeout(check, INTERVAL_MS);
    };

    await check();

    let queue = Promise.resolve();

    async function applyEdit(fn) {
      const file = await handle.getFile();
      const current = await readText(file);
      // 画面に表示したあとに、ファイルが外から変わっていたら書かない。
      if (current !== lastText) return { error: global.Mindra.STALE_MESSAGE };
      const result = fn(current);
      if (result.error) return result;
      const writable = await handle.createWritable();
      await writable.write(result.text);
      await writable.close();
      lastText = result.text;
      onChange(result.text, handle.name);
      return result;
    }

    return {
      stop() {
        stopped = true;
        clearTimeout(timer);
      },
      // 今のファイルを読み、fn（内容 → { text, line } か { error }）で書き換えて保存する。
      // 書き換えるのは、fn が text を返したときだけ。
      // 連続した操作は 1 件ずつ順に実行する（同時に読むと、先の変更が消えるため）。
      edit(fn) {
        const run = queue.then(() => applyEdit(fn));
        queue = run.catch(() => {});
        return run;
      },
    };
  }

  // 既存の .md を選んで監視する。キャンセルすると AbortError で失敗する。
  async function watchFile(onChange, onError) {
    const [handle] = await global.showOpenFilePicker({ multiple: false, types: MD_TYPES });
    return watchHandle(handle, onChange, onError);
  }

  // 保存先を選び、図の種類を書いた空のファイルを作って監視する。
  async function createFile(view, onChange, onError) {
    const handle = await global.showSaveFilePicker({
      suggestedName: 'untitled.md',
      types: MD_TYPES,
    });
    const title = handle.name.replace(/\.md$/i, '');
    const writable = await handle.createWritable();
    await writable.write(global.Mindra.newDocumentText(view, title));
    await writable.close();
    return watchHandle(handle, onChange, onError);
  }

  global.Mindra = Object.assign(global.Mindra || {}, { watchFile, createFile });
})(globalThis);
