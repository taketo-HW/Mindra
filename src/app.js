// 画面の配線。ファイルを開き・作り、MD → 木 → 図 をつなぐ。
// 図の上の操作（選ぶ・名前を変える・追加）は、MD の書き換えに変えて保存する。
(function (global) {
  'use strict';

  const M = global.Mindra;
  const $ = (id) => document.getElementById(id);
  const DEFAULT_LABEL = 'New item';
  const DEFAULT_PARENT_LABEL = 'New parent';
  // 項目の色: 7 色のパステル。既定の色で、設定から変えられる（MD には #rrggbb で書く）。
  const PALETTE_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Gray'];
  const DEFAULT_PALETTE = ['#ffb3ba', '#ffd3a5', '#fff1a8', '#c4f0c2', '#b5d8f7', '#d7c4f2', '#dcdfe4'];
  const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  const LINE_DEFAULT = '#8a96a3';

  const state = {
    tree: null,
    collapsed: new Set(),
    zoom: 1,
    watcher: null,
    saving: false, // 書き戻し中
    open: false, // ファイルを開いているか
    selected: null, // 選んでいるノードの id
    editing: null, // 名前を編集中のノードの id
    commenting: null, // コメントを編集中のノードの id
    editingNode: null, // 編集中のノードの行番号と中身（id が指す先が変わっても追えるように）
  };

  function setStatus(message) {
    $('status').textContent = message;
  }

  // マウスを押している間は描き直さない。名前の編集欄のフォーカスが外れると描き直しが起き、
  // 押したノードが消えて、離したときの click が別の要素に届いて失われるため。離した後に描き直す。
  let pointerHeld = false;
  let redrawWaiting = false;
  function redraw() {
    if (pointerHeld) redrawWaiting = true;
    else draw();
  }
  const releasePointer = () => {
    pointerHeld = false;
    if (redrawWaiting) {
      setTimeout(() => {
        if (!pointerHeld && redrawWaiting) {
          redrawWaiting = false;
          draw();
        }
      }, 0); // click は離した直後の同じ操作の中で届くので、その後に描く
    }
  };
  document.addEventListener('pointerdown', () => { pointerHeld = true; }, true);
  document.addEventListener('pointerup', releasePointer, true);
  document.addEventListener('pointercancel', releasePointer, true);

  // 名前の編集を始める。編集中のノードは、パス（"0.1.2"）ではなく、行番号と中身で覚える。
  // パスは、外から行が増えると別のノードを指してしまうため。
  function beginEdit(id) {
    const node = id && M.nodeAt(state.tree, id);
    state.commenting = null;
    state.editing = node ? id : null;
    state.editingNode = node ? { line: node.line, raw: node.raw } : null;
  }

  // コメントの編集を始める。名前の編集と同じく、ノードの行番号と中身で覚える。
  function beginComment(id) {
    const node = id && M.nodeAt(state.tree, id);
    state.editing = null;
    state.commenting = node ? id : null;
    state.editingNode = node ? { line: node.line, raw: node.raw } : null;
  }

  function draw() {
    if (!state.tree) return;
    M.renderMindmap(state.tree, $('view'), {
      collapsed: state.collapsed,
      selected: state.selected,
      editing: state.editing,
      commenting: state.commenting,
      zoom: state.zoom,
      onSelect(id) {
        state.selected = id;
        state.editing = null;
        state.commenting = null;
        draw();
      },
      onEdit(id) {
        state.selected = id;
        beginEdit(id);
        draw();
      },
      onToggle(id) {
        if (state.collapsed.has(id)) state.collapsed.delete(id);
        else state.collapsed.add(id);
        draw();
      },
      onRename: rename,
      onComment(id) {
        state.selected = id;
        beginComment(id);
        draw();
      },
      onSaveComment: saveComment,
      onCancelEdit() {
        state.editing = null;
        state.commenting = null;
        draw();
      },
      onAddChild: addChild,
    });
    updateSwatches();
  }

  // ファイルを開いていないときは、ファイルに対する操作を使えないようにする。
  // 「Settings」「New」「Open MD file」は、いつでも使える。
  const FILE_CONTROLS = ['add-child', 'add-parent', 'add-many', 'rename', 'zoom-in', 'zoom-out'];
  function setFileControls(enabled) {
    state.open = enabled;
    for (const id of FILE_CONTROLS) $(id).disabled = !enabled;
    updateSwatches();
  }

  // 項目の色の見本。項目を選んでいるときだけ使える。
  function updateSwatches() {
    const node = state.selected && state.tree && M.nodeAt(state.tree, state.selected);
    const usable = Boolean(state.open && node && node.line !== undefined);
    for (const button of document.querySelectorAll('.swatch')) button.disabled = !usable;
  }

  // 選んだ項目の色を変える（null なら色を消す）。
  async function setNodeColor(color) {
    const id = state.selected;
    const node = id && M.nodeAt(state.tree, id);
    if (!node) {
      setStatus('Select a node first');
      return;
    }
    await commit((text) => M.setColor(text, node, color));
    redraw();
  }

  function buildSwatches() {
    const box = $('item-swatches');
    box.replaceChildren();
    const none = document.createElement('button');
    none.type = 'button';
    none.className = 'swatch swatch-none';
    none.textContent = '×';
    none.title = 'No color';
    none.addEventListener('click', () => setNodeColor(null));
    box.appendChild(none);
    settings.palette.forEach((hex, i) => {
      const name = PALETTE_NAMES[i];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.style.background = hex;
      button.title = name;
      button.addEventListener('click', () => setNodeColor(hex));
      box.appendChild(button);
    });
  }

  // 設定。ブラウザに保存する（MD には書かない）。null は「テーマの既定」。
  const THEMES = ['system', 'light', 'dark', 'black', 'pink', 'blue', 'green'];
  const FONTS = {
    system: 'system-ui, -apple-system, "Hiragino Sans", "Yu Gothic", sans-serif',
    mincho: '"Hiragino Mincho ProN", "Yu Mincho", serif',
    rounded: '"Hiragino Maru Gothic ProN", "Rounded Mplus 1c", "Arial Rounded MT Bold", sans-serif',
    mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  };
  const defaultSettings = () => ({
    theme: 'light',
    font: 'system',
    line: null,
    text: null,
    comment: null,
    palette: DEFAULT_PALETTE.slice(),
  });
  let settings = defaultSettings();

  function loadSettings() {
    const base = defaultSettings();
    try {
      const saved = JSON.parse(localStorage.getItem('mindra.settings') || '{}');
      const theme = THEMES.includes(saved.theme) ? saved.theme : base.theme;
      const palette =
        Array.isArray(saved.palette) && saved.palette.length === 7 && saved.palette.every(isHex)
          ? saved.palette
          : base.palette;
      return { ...base, ...saved, theme, palette };
    } catch {
      return base;
    }
  }

  function saveSettings() {
    localStorage.setItem('mindra.settings', JSON.stringify(settings));
  }

  // System は、OS の設定に従って明るい / 暗いを選ぶ。
  function resolvedTheme() {
    if (settings.theme === 'system') {
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return settings.theme;
  }

  function setOverride(name, value) {
    const root = document.documentElement;
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }

  // 設定を画面に反映し、ダイアログの値も合わせる。
  function applySettings() {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme();
    root.style.setProperty('--font', FONTS[settings.font] || FONTS.system);
    setOverride('--line', settings.line);
    setOverride('--fg', settings.text);
    setOverride('--comment-fg', settings.comment);
    const shown = (name) => getComputedStyle(root).getPropertyValue(name).trim();
    $('set-theme').value = settings.theme;
    $('set-font').value = settings.font;
    $('set-line').value = shown('--line');
    $('set-text').value = shown('--fg');
    $('set-comment').value = shown('--comment-fg');
    settings.palette.forEach((hex, i) => {
      document.querySelectorAll('.palette-input')[i].value = hex;
    });
  }

  // 設定ダイアログに、項目の 7 色の入力欄を並べる。
  function buildPaletteInputs() {
    const box = $('set-palette');
    PALETTE_NAMES.forEach((name, i) => {
      const label = document.createElement('label');
      label.textContent = `${name} item`;
      const input = document.createElement('input');
      input.type = 'color';
      input.className = 'palette-input';
      input.addEventListener('input', () => {
        settings.palette[i] = input.value;
        saveSettings();
        buildSwatches();
        updateSwatches();
      });
      label.appendChild(input);
      box.appendChild(label);
    });
  }

  function changeSetting(key, value) {
    settings[key] = value;
    saveSettings();
    applySettings();
  }

  // 設定は開いたままのパネル（モーダルではない）。開いたままでも、マップの項目を選べる。
  function openSettings() {
    applySettings();
    $('settings-dialog').show();
  }

  function resetSettings() {
    settings = defaultSettings();
    saveSettings();
    applySettings();
    buildSwatches(); // 項目の色の見本も、既定の色に戻す
    updateSwatches();
  }

  function onText(text, fileName) {
    const name = fileName.replace(/\.md$/i, '');
    const { warning, root } = M.parseMarkdown(text, name);
    state.tree = root;
    if (!state.selected || !M.nodeAt(root, state.selected)) state.selected = '0';
    // 編集中に外から書き換わった場合: 同じノードを追えたら編集を続け、追えなければ取り消す。
    let notice = null;
    if (state.editing || state.commenting) {
      const key = state.editingNode;
      const id = key && key.line !== undefined ? M.findPathByLine(root, key.line) : null;
      const node = id && M.nodeAt(root, id);
      if (node && node.raw === key.raw) {
        if (state.editing) state.editing = id;
        if (state.commenting) state.commenting = id;
        state.editingNode = { line: node.line, raw: node.raw };
      } else {
        state.editing = null;
        state.commenting = null;
        state.editingNode = null;
        notice = 'The file changed while you were editing, so the edit was cancelled.';
      }
    }
    redraw();
    setStatus(notice || warning || `Showing ${fileName} (changes apply automatically)`);
  }

  function onError(err) {
    setStatus(`Failed to read the file: ${err.message}`);
  }

  // 既存のファイルや新規ファイルの監視を入れ替える。
  // 新しいファイルが決まるまでは、今の監視を続ける（キャンセルしても表示は変わらない）。
  async function startWatching(start) {
    let next;
    try {
      next = await start(onText, onError);
    } catch (err) {
      if (err.name !== 'AbortError') setStatus(`Could not open the file: ${err.message}`);
      return;
    }
    if (state.watcher) state.watcher.stop();
    state.watcher = next;
    setFileControls(true);
    state.collapsed = new Set();
    state.selected = null;
    state.editing = null;
    state.commenting = null;
  }

  function onOpen() {
    return startWatching((onChange, onErr) => M.watchFile(onChange, onErr));
  }

  // 新規作成: 図の種類を選んでから、保存先を聞く。
  function onNew() {
    $('new-dialog').showModal();
  }

  function onNewConfirm(event) {
    event.preventDefault();
    const view = document.querySelector('input[name="view"]:checked').value;
    $('new-dialog').close();
    return startWatching((onChange, onErr) => M.createFile(view, onChange, onErr));
  }

  // MD を書き換えて保存する。失敗したら理由を出し、null を返す。
  // 保存の途中は次の操作を受け付けない（古い木を基にした操作が混ざるのを防ぐ）。
  async function commit(fn) {
    if (!state.watcher) {
      setStatus('Open a file first');
      return null;
    }
    if (state.saving) {
      // 前の保存が終わるまで待ってもらう（操作は捨てるので、やり直してもらう）。
      setStatus('Still saving the previous change. Please try again.');
      return null;
    }
    state.saving = true;
    setStatus('Saving…');
    let result;
    try {
      result = await state.watcher.edit(fn);
    } catch (err) {
      setStatus(`Failed to save: ${err.message}`);
      return null;
    } finally {
      state.saving = false;
    }
    if (result.error) {
      setStatus(result.error);
      return null;
    }
    setStatus('Saved');
    return result;
  }

  // コメントを保存する。内容が変わっていなければ書かない。空にすると、コメントは消える。
  async function saveComment(id, value) {
    if (state.commenting !== id) return;
    state.commenting = null;
    const node = M.nodeAt(state.tree, id);
    const before = node && (node.comment || []).join('\n');
    if (!node || value.replace(/\s+$/, '') === before) {
      draw();
      return;
    }
    await commit((text) => M.setComment(text, node, value));
    draw();
  }

  async function rename(id, label) {
    // 編集がすでに取り消されていれば（外からの変更で止めた後など）、古いパスで書き換えない。
    if (state.editing !== id) return;
    state.editing = null;
    const node = M.nodeAt(state.tree, id);
    // 変えていなければ書かない（マークダウン記号を消さないため）。
    if (!node || label.trim() === node.text) {
      redraw();
      return;
    }
    await commit((text) => M.renameNode(text, node, label));
    redraw();
  }

  // 指定したノードに子を足す。足した子の名前を、すぐ編集できる状態にする。
  async function addChild(id) {
    const node = id && M.nodeAt(state.tree, id);
    if (!node) {
      setStatus('Select a node first');
      return;
    }
    state.editing = null;
    const result = await commit((text) => M.addChild(text, node, DEFAULT_LABEL));
    if (result) {
      // 足した子が見えるように、その祖先（畳まれている所）をすべて開く。
      const newId = M.findPathByLine(state.tree, result.line);
      if (newId) {
        const parts = newId.split('.');
        for (let i = 1; i < parts.length; i++) state.collapsed.delete(parts.slice(0, i).join('.'));
        state.selected = newId;
        beginEdit(newId);
      }
    }
    redraw();
  }

  // 選んだノードの上に親を足す。親の名前を、すぐ編集できる状態にする。
  async function addParent(id) {
    const node = id && M.nodeAt(state.tree, id);
    if (!node) {
      setStatus('Select a node first');
      return;
    }
    state.editing = null;
    const result = await commit((text) => M.addParent(text, node, DEFAULT_PARENT_LABEL));
    if (result) {
      const newId = M.findPathByLine(state.tree, result.line);
      if (newId) {
        state.selected = newId;
        beginEdit(newId);
      }
    }
    redraw();
  }

  // 複数の子をまとめて足す。入力欄は、1 行に 1 件。
  function openMultiAdd() {
    if (!state.selected) {
      setStatus('Select a node first');
      return;
    }
    $('multi-dialog').showModal();
    $('multi-text').focus();
  }

  async function confirmMultiAdd() {
    const id = state.selected;
    const node = id && M.nodeAt(state.tree, id);
    const labels = $('multi-text').value.split('\n').map((l) => l.trim()).filter(Boolean);
    $('multi-dialog').close();
    if (!node || !labels.length) return;
    state.editing = null;
    const result = await commit((text) => M.addChildren(text, node, labels));
    if (result) {
      state.collapsed.delete(id);
      $('multi-text').value = '';
      const newId = M.findPathByLine(state.tree, result.line);
      if (newId) state.selected = newId;
    }
    redraw();
  }

  function startRename() {
    if (!state.selected) {
      setStatus('Select a node first');
      return;
    }
    beginEdit(state.selected);
    draw();
  }

  // キーボード: Tab で子を追加、Enter で名前を編集（名前の編集中は無効）。
  // 図の上（本体か図の領域）にフォーカスがあるときだけ働く。ツールバーやダイアログのボタンは、普通に使えるようにする。
  function onKeyDown(event) {
    const t = event.target;
    const onCanvas = t === document.body || (t.closest && t.closest('#view'));
    if (!onCanvas || state.editing || state.commenting || !state.selected || t.tagName === 'INPUT') return;
    if (event.key === 'Enter') {
      event.preventDefault();
      startRename();
    } else if (event.key === 'Tab' && t === document.body) {
      // 図の中のボタンにフォーカスがあるときは、Tab でボタンを移動する（子は足さない）。
      event.preventDefault();
      addChild(state.selected);
    }
  }

  function setZoom(next) {
    state.zoom = Math.min(2, Math.max(0.4, next));
    draw();
  }

  function init() {
    if (typeof global.showOpenFilePicker !== 'function') {
      $('open').disabled = true;
      $('new').disabled = true;
      setStatus('This browser is not supported. Please use Chrome or Edge.');
      return;
    }
    $('open').addEventListener('click', onOpen);
    $('new').addEventListener('click', onNew);
    $('new-confirm').addEventListener('click', onNewConfirm);
    $('new-cancel').addEventListener('click', () => $('new-dialog').close());
    $('add-child').addEventListener('click', () => addChild(state.selected));
    $('add-parent').addEventListener('click', () => addParent(state.selected));
    $('add-many').addEventListener('click', openMultiAdd);
    $('multi-confirm').addEventListener('click', (event) => {
      event.preventDefault();
      confirmMultiAdd();
    });
    $('multi-cancel').addEventListener('click', () => $('multi-dialog').close());
    $('rename').addEventListener('click', startRename);
    settings = loadSettings();
    buildPaletteInputs();
    buildSwatches();
    applySettings();
    setFileControls(false);
    $('settings').addEventListener('click', openSettings);
    $('set-theme').addEventListener('change', (e) => changeSetting('theme', e.target.value));
    $('set-font').addEventListener('change', (e) => changeSetting('font', e.target.value));
    $('set-line').addEventListener('input', (e) => changeSetting('line', e.target.value));
    $('set-text').addEventListener('input', (e) => changeSetting('text', e.target.value));
    $('set-comment').addEventListener('input', (e) => changeSetting('comment', e.target.value));
    $('set-reset').addEventListener('click', resetSettings);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (settings.theme === 'system') applySettings();
    });
    $('zoom-in').addEventListener('click', () => setZoom(state.zoom + 0.1));
    $('zoom-out').addEventListener('click', () => setZoom(state.zoom - 0.1));
    document.addEventListener('keydown', onKeyDown);
  }

  init();
})(globalThis);
