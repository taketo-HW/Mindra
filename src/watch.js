// MD ファイルを開く・作る・監視する。読み書きの相手は 2 種類:
//   - ブラウザが選んだファイル（File System Access API。Chrome / Edge）
//   - パス指定（補助プログラム経由。mindmap <パス> で開いたとき）
// どちらも、同じ監視と書き戻しの仕組みを使う。
(function (global) {
  'use strict';

  const INTERVAL_MS = 1000;
  const MD_TYPES = [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }];
  // 補助プログラムの場所（このページを補助プログラムから開いているなら、その場所）。
  const BRIDGE = global.location && global.location.protocol === 'http:'
    ? global.location.origin
    : 'http://127.0.0.1:7777';

  // ファイルを文字列で読む。file.text() は先頭の BOM を消すので、BOM を残すために自分で復号する。
  async function readText(file) {
    return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await file.arrayBuffer());
  }

  // ブラウザが選んだファイル。
  function handleSource(handle) {
    return {
      name: handle.name,
      read: async () => readText(await handle.getFile()),
      write: async (text) => {
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
      },
    };
  }

  // パスで指定したファイル（補助プログラム経由）。書くときは、読んだ内容と同じかを補助プログラムが確かめる。
  function pathSource(path) {
    const query = `/file?path=${encodeURIComponent(path)}`;
    return {
      name: path.split(/[\\/]/).pop(),
      read: async () => {
        const res = await fetch(BRIDGE + query);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        return data.text;
      },
      write: async (text, expected) => {
        const res = await fetch(BRIDGE + query, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expected, text }),
        });
        if (res.status === 409) throw Object.assign(new Error('changed'), { stale: true });
        if (!res.ok) throw new Error((await res.json()).error);
      },
    };
  }

  // 読み書きの相手を監視する。
  // onChange(text, fileName) は、内容が変わったときに呼ばれる。戻り値の stop() で監視を止める。
  async function watchSource(source, onChange, onError) {
    let lastText = null;
    let timer = null;
    let stopped = false;

    const check = async () => {
      try {
        const text = await source.read();
        if (!stopped && text !== lastText) {
          lastText = text;
          onChange(text, source.name);
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
      const current = await source.read();
      // 画面に表示したあとに、ファイルが外から変わっていたら書かない。
      if (current !== lastText) return { error: global.Mindra.STALE_MESSAGE };
      const result = fn(current);
      if (result.error) return result;
      try {
        await source.write(result.text, current);
      } catch (err) {
        if (err.stale) return { error: global.Mindra.STALE_MESSAGE };
        throw err;
      }
      lastText = result.text;
      onChange(result.text, source.name);
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
    return watchSource(handleSource(handle), onChange, onError);
  }

  // パスで指定した .md を監視する（mindmap <パス>）。
  function watchPath(path, onChange, onError) {
    return watchSource(pathSource(path), onChange, onError);
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
    return watchSource(handleSource(handle), onChange, onError);
  }

  global.Mindra = Object.assign(global.Mindra || {}, { watchFile, watchPath, createFile });
})(globalThis);
