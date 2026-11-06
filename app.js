(() => {
  "use strict";

  const STORE = "ds-editor-v1";
  const STORE_AT = "ds-editor-v1-at";
  const REF_PROJECT_ID = "p-all";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const uid = (p) => p + Math.random().toString(36).slice(2, 8);
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

  const translateRu = (text) => window.DSTranslate.translate(text);

  const DEFAULT_ROWS = [
    ["Тип", "Type"],
    ["Производитель", "Manufacturer"],
    ["Температура эксплуатации, °С", "Operating temperature, °C"],
    ["Диапазон измерения", "Measurement range"],
    ["Материал корпуса", "Housing material"],
    ["Присоединение к процессу", "Process connection"],
    ["Степень пылевлагозащиты", "Level of dust and moisture protection"],
    ["Масса, кг", "Weight, kg"]
  ];

  const LANG_STORE = "ds-editor-lang";
  const LANGS = ["both", "ru", "en", "tag"];

  function readLang() {
    try {
      const saved = localStorage.getItem(LANG_STORE);
      return LANGS.includes(saved) ? saved : "both";
    } catch (err) {
      return "both";
    }
  }

  function saveLang(lang) {
    try { localStorage.setItem(LANG_STORE, lang); } catch (err) { /* не критично */ }
  }

  const AUTO_STORE = "ds-editor-auto";
  const SYNC_STORE = "ds-editor-sync";

  function readFlag(key, fallback) {
    try {
      const saved = localStorage.getItem(key);
      return saved == null ? fallback : saved === "1";
    } catch (err) {
      return fallback;
    }
  }

  function writeFlag(key, value) {
    try { localStorage.setItem(key, value ? "1" : "0"); } catch (err) { /* не критично */ }
  }

  let autoOn = readFlag(AUTO_STORE, true);
  let syncOn = readFlag(SYNC_STORE, true);

  let state;
  let stateAt = 0;
  let ui = { projectId: null, deviceId: null, kitId: null, lang: readLang(), search: "", rowId: null, cellId: null, col: 0, refEdit: false };
  let saveTimer = 0;
  let toastTimer = 0;
  let imageTarget = null;
  let tagTarget = null;

  /* ---------------- measurement ---------------- */

  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  measureCtx.font = '16px "Times New Roman"';

  function textLines(text, widthPx) {
    const value = String(text == null ? "" : text);
    const width = Math.max(12, widthPx);
    let total = 0;
    value.split("\n").forEach((paragraph) => {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (!words.length) { total += 1; return; }
      let line = "";
      let count = 1;
      words.forEach((word) => {
        const probe = line ? line + " " + word : word;
        if (measureCtx.measureText(probe).width <= width) {
          line = probe;
        } else if (!line) {
          line = word;
          count += measureCtx.measureText(word).width > width ? Math.ceil(measureCtx.measureText(word).width / width) - 1 : 0;
        } else {
          count += 1;
          line = word;
          if (measureCtx.measureText(word).width > width) {
            count += Math.ceil(measureCtx.measureText(word).width / width) - 1;
          }
        }
      });
      total += count;
    });
    return Math.max(1, total);
  }

  window.DS = { measure: textLines };

  /* ---------------- storage ---------------- */

  function newCell(span = 1) {
    return { id: uid("c"), span, ru: "", en: "" };
  }

  /* «Отсутствует» в английских ячейках раньше оставалось по-русски или
     превращалось в «No». Приводим к единому «Not available» на загрузке. */
  const ABSENT_EN = new Set(["отсутствует", "отсутсвует", "отсутствуют", "no"]);

  function fixAbsentCells(rows) {
    (rows || []).forEach((row) => {
      (row.cells || []).forEach((cell) => {
        const ru = String(cell.ru || "").trim().toLowerCase();
        const en = String(cell.en || "").trim();
        if (ru.startsWith("отсутс") && ABSENT_EN.has(en.toLowerCase())) cell.en = "Not available";
      });
    });
  }

  function normalizeDevice(d, index) {
    const hasPages = Array.isArray(d.pages) && d.pages.length > 0;
    const source = hasPages ? d.pages[0] : d;
    const extras = hasPages ? d.pages.slice(1) : (Array.isArray(d.kits) ? d.kits : []);
    const device = {
      id: d.id || uid("d"),
      no: num(d.no, index + 1),
      suffix: d.suffix || "",
      kind: source.kind || "main",
      lead: Math.max(0, num(source.lead, 3)),
      nameRu: source.nameRu || "",
      nameEn: source.nameEn || "",
      titleRu: source.titleRu || "",
      titleEn: source.titleEn || "",
      scopeRu: source.scopeRu || "",
      scopeEn: source.scopeEn || "",
      introRu: source.introRu || "",
      introEn: source.introEn || "",
      columns: Array.isArray(source.columns) && source.columns.length ? source.columns : [{ id: uid("k"), name: "Значение" }],
      rows: Array.isArray(source.rows) ? source.rows : [],
      figures: Array.isArray(source.figures) ? source.figures : [],
      markings: Array.isArray(d.markings) ? d.markings : [],
      tagGroups: Array.isArray(d.tagGroups) ? d.tagGroups : []
    };
    device.columns = device.columns.map((c, i) => ({ id: c.id || uid("k"), name: c.name || `Колонка ${i + 1}` }));
    device.rows = device.rows.map((r) => {
      const row = {
        id: r.id || uid("r"),
        labelRu: r.labelRu || "",
        labelEn: r.labelEn || "",
        subRu: r.subRu || "",
        subEn: r.subEn || "",
        labelMerge: r.labelMerge !== false,
        rowSpan: num(r.rowSpan, 1),
        cells: Array.isArray(r.cells) && r.cells.length ? r.cells.map((c) => ({
          id: c.id || uid("c"),
          span: Math.max(1, num(c.span, 1)),
          ru: c.ru || "",
          en: c.en || ""
        })) : [newCell(device.columns.length)]
      };
      const max = device.columns.length;
      let total = row.cells.reduce((n, c) => n + c.span, 0);
      if (total > max) {
        row.cells = row.cells.slice(0, 1);
        row.cells[0].span = max;
        total = max;
      }
      while (total < max) { row.cells.push(newCell(1)); total += 1; }
      return row;
    });
    fixAbsentCells(device.rows);
    device.figures = device.figures.map((f) => ({
      id: f.id || uid("f"),
      image: f.image || "",
      noteRu: f.noteRu || "",
      noteEn: f.noteEn || "",
      noteRows: Math.max(0, num(f.noteRows, 0)),
      cellRows: Math.max(0, num(f.cellRows, 0)),
      captionRu: f.captionRu || "",
      captionEn: f.captionEn || "",
      geom: f.geom && typeof f.geom === "object" ? { ...f.geom } : {}
    }));
    device.markings = device.markings.map((m) => ({
      id: m.id || uid("m"),
      code: String(m.code || "").replace(/^\d+\s+(?=[А-ЯЁA-Z])/, ""),
      note: m.note || ""
    }));
    device.tagGroups = device.tagGroups.map((g) => ({
      id: g.id || uid("g"),
      scopeRu: g.scopeRu || "",
      scopeEn: g.scopeEn || "",
      tags: (Array.isArray(g.tags) ? g.tags : []).map((t) => (typeof t === "string" ? t : t.text || ""))
    }));
    device.kits = extras.map((k) => {
      const kit = normalizeDevice(k, 0);
      delete kit.no;
      delete kit.suffix;
      delete kit.kits;
      delete kit.pages;
      kit.markings = [];
      kit.tagGroups = [];
      return kit;
    });
    return device;
  }

  function seedState() {
    const source = window.DS_SEED ? clone(window.DS_SEED) : { projects: [] };
    const projects = (source.projects || []).map((p) => ({
      id: p.id || uid("p"),
      name: p.name || "Проект",
      devices: (p.devices || []).map(normalizeDevice)
    }));
    return { version: 1, active: source.active || projects[0]?.id, projects };
  }

  function ensureReference(stateToFix) {
    if (stateToFix.projects.some(isReferenceProject)) return stateToFix;
    const seed = (window.DS_SEED && window.DS_SEED.projects) || [];
    const p = seed.find((x) => x.id === REF_PROJECT_ID) || seed.find(isReferenceProject) || seed[0];
    if (!p) return stateToFix;
    stateToFix.projects.unshift({
      id: REF_PROJECT_ID,
      name: p.name || "Все листы",
      devices: (p.devices || []).map(normalizeDevice)
    });
    return stateToFix;
  }

  function normalizeState(parsed) {
    if (!parsed || !Array.isArray(parsed.projects) || !parsed.projects.length) return null;
    parsed.projects.forEach((p) => { p.devices = (p.devices || []).map(normalizeDevice); });
    return ensureReference(parsed);
  }

  /* ---------------- storage: IndexedDB + localStorage + файл ---------------- */

  const DB_NAME = "ds-editor";
  const DB_STORE = "state";
  const DB_KEY = "current";
  const DB_KEY_AT = "current-at";
  const DB_KEY_FILE = "file-handle";

  let dbPromise = null;
  let storageMode = "unknown";

  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error("IndexedDB недоступен")); return; }
      let req;
      try { req = window.indexedDB.open(DB_NAME, 1); } catch (err) { reject(err); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB не открылся"));
      req.onblocked = () => reject(new Error("IndexedDB заблокирован"));
    });
  }

  function db() {
    if (!dbPromise) dbPromise = idbOpen();
    return dbPromise;
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
    ]);
  }

  function idbGet(key = DB_KEY) {
    return db().then((database) => new Promise((resolve, reject) => {
      const tx = database.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB: чтение не удалось"));
    }));
  }

  function idbPut(value, key = DB_KEY) {
    return db().then((database) => new Promise((resolve, reject) => {
      const tx = database.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error("IndexedDB: запись не удалась"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB: запись прервана"));
    }));
  }

  function idbSave(snapshot, at) {
    return db().then((database) => new Promise((resolve, reject) => {
      const tx = database.transaction(DB_STORE, "readwrite");
      const store = tx.objectStore(DB_STORE);
      store.put(snapshot, DB_KEY);
      store.put(at, DB_KEY_AT);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error("IndexedDB: запись не удалась"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB: запись прервана"));
    }));
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(STORE);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function readLocalAt() {
    try { return Number(localStorage.getItem(STORE_AT)) || 0; } catch (err) { return 0; }
  }

  async function loadState() {
    try {
      const stored = normalizeState(await withTimeout(idbGet(), 2000));
      if (stored) { storageMode = "idb"; return stored; }
    } catch (err) {
      /* IndexedDB недоступен — пробуем localStorage */
    }
    const local = normalizeState(readLocal());
    if (local) { storageMode = "local"; return local; }
    storageMode = "none";
    return ensureReference(seedState());
  }

  let bootDirty = false;

  async function idbLoad() {
    const [snapshot, at] = await withTimeout(Promise.all([idbGet(), idbGet(DB_KEY_AT)]), 2500);
    return { snapshot, at: Number(at) || 0 };
  }

  async function syncFromIdb() {
    let stored = null;
    let storedAt = 0;
    try {
      const res = await idbLoad();
      stored = normalizeState(res.snapshot);
      storedAt = res.at;
    } catch (err) {
      return;
    }
    if (!stored) return;
    if (bootDirty) return;
    if (storedAt && storedAt <= readLocalAt()) return;
    if (!storedAt && readLocal()) return;
    state = stored;
    if (storedAt) stateAt = storedAt;
    if (!state.projects.some((p) => p.id === state.active)) state.active = state.projects[0].id;
    ui.deviceId = project()?.devices[0]?.id || null;
    ui.kitId = null;
    ui.rowId = null;
    ui.cellId = null;
    storageMode = "idb";
    render();
    setSave("saved", "Сохранено");
  }

  async function askPersist() {
    try {
      if (navigator.storage && typeof navigator.storage.persist === "function") await navigator.storage.persist();
    } catch (err) { /* браузер не даёт — данные всё равно пишутся в IndexedDB */ }
  }

  function saveNow() {
    clearTimeout(saveTimer);
    const snapshot = state;
    const at = Date.now();
    stateAt = at;
    let localOk = false;
    try {
      localStorage.setItem(STORE, JSON.stringify(snapshot));
      localStorage.setItem(STORE_AT, String(at));
      localOk = true;
    } catch (err) {
      localOk = false;
    }
    idbSave(snapshot, at).then(() => {
      storageMode = "idb";
      setSave("saved", localOk ? "Сохранено" : "Сохранено в IndexedDB");
    }).catch(() => {
      storageMode = localOk ? "local" : "none";
      if (localOk) setSave("saved", "Сохранено (браузер)");
      else setSave("error", "Не сохраняется — сделайте файл");
    });
  }

  function touch() {
    bootDirty = true;
    setSave("dirty", "Есть изменения");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 600);
  }

  function setSave(kind, text) {
    const el = $("#save-state");
    if (!el) return;
    el.dataset.state = kind;
    el.innerHTML = `<span></span>${esc(text)}`;
    const hint = $("#storage-hint");
    if (hint) hint.hidden = kind !== "error";
  }

  /* ---------------- storage: файл проекта ---------------- */

  function stateFileStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function stateFileText() {
    return JSON.stringify({ format: "data-sheet-editor", version: 1, savedAt: new Date().toISOString(), ...state });
  }

  let fileHandle = null;
  const canPickFiles = () => typeof window.showSaveFilePicker === "function" && typeof window.showOpenFilePicker === "function";
  const fileTypes = [{ description: "Файл проекта", accept: { "application/json": [".json"] } }];

  function renderFileLabel() {
    const el = $("#file-label");
    if (!el) return;
    const name = fileHandle ? fileHandle.name : "";
    el.dataset.state = name ? "linked" : "none";
    el.textContent = name ? `Файл: ${name} — Ctrl+S перезаписывает его` : "Файл на диске не выбран — работа хранится в браузере";
    el.hidden = false;
  }

  async function loadFileHandle() {
    try {
      const stored = await withTimeout(idbGet(DB_KEY_FILE), 1500);
      if (stored && typeof stored.createWritable === "function") fileHandle = stored;
    } catch (err) {
      fileHandle = null;
    }
    renderFileLabel();
  }

  async function ensureWritePermission(handle) {
    if (typeof handle.queryPermission !== "function") return true;
    let perm = "granted";
    try { perm = await handle.queryPermission({ mode: "readwrite" }); } catch (err) { perm = "granted"; }
    if (perm === "granted") return true;
    if (typeof handle.requestPermission !== "function") return false;
    try { perm = await handle.requestPermission({ mode: "readwrite" }); } catch (err) { return false; }
    return perm === "granted";
  }

  function saveStateFile() {
    try {
      const blob = new Blob([stateFileText()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Data_Sheet-${stateFileStamp()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast("Файл проекта скачан");
    } catch (err) {
      console.error(err);
      toast("Не удалось сохранить файл: " + (err.message || err), true);
    }
  }

  async function saveProjectFile(forcePicker = false) {
    if (!canPickFiles()) { saveStateFile(); return; }
    try {
      if (!fileHandle || forcePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileHandle ? fileHandle.name : `Data_Sheet-${stateFileStamp()}.json`,
          types: fileTypes
        });
        fileHandle = handle;
        idbPut(handle, DB_KEY_FILE).catch(() => {});
      }
      if (!(await ensureWritePermission(fileHandle))) {
        fileHandle = null;
        idbPut(null, DB_KEY_FILE).catch(() => {});
        renderFileLabel();
        toast("Нет доступа к файлу — выберите его заново", true);
        return;
      }
      const writable = await fileHandle.createWritable();
      await writable.write(stateFileText());
      await writable.close();
      renderFileLabel();
      toast(`Сохранено в «${fileHandle.name}»`);
    } catch (err) {
      if (err && (err.name === "AbortError" || err.code === 20)) return;
      toast("Не удалось сохранить файл: " + (err.message || err), true);
    }
  }

  function pickStateFile() {
    const input = $("#file-state");
    if (!input) return;
    input.value = "";
    input.click();
  }

  async function applyProjectFile(file, handle) {
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(String(await file.text()));
    } catch (err) {
      toast("Файл не читается: это не JSON проекта", true);
      return;
    }
    const projects = parsed && Array.isArray(parsed.projects) ? parsed.projects : null;
    if (!projects || !projects.length) {
      toast("В файле нет проектов — похоже, это другой файл", true);
      return;
    }
    const count = projects.reduce((n, p) => n + ((p.devices || []).length), 0);
    const ok = await askConfirm({
      title: "Открыть файл проекта",
      text: `Загрузить «${file.name}»: проектов ${projects.length}, листов ${count}. Текущая работа в браузере будет заменена содержимым файла.`,
      ok: "Загрузить файл"
    });
    if (!ok) return;
    state = ensureReference({
      version: 1,
      active: parsed.active || projects[0]?.id,
      projects: projects.map((p) => ({
        id: p.id || uid("p"),
        name: p.name || "Проект",
        devices: (p.devices || []).map(normalizeDevice)
      }))
    });
    if (!state.projects.some((p) => p.id === state.active)) state.active = state.projects[0].id;
    ui.deviceId = project()?.devices[0]?.id || null;
    ui.kitId = null;
    ui.rowId = null;
    ui.cellId = null;
    ui.lang = readLang();
    if (handle) {
      fileHandle = handle;
      idbPut(handle, DB_KEY_FILE).catch(() => {});
    }
    bootDirty = true;
    saveNow();
    render();
    renderFileLabel();
    toast(`Файл загружен: ${count} листов`);
  }

  async function openProjectFile() {
    if (!canPickFiles()) { pickStateFile(); return; }
    try {
      const [handle] = await window.showOpenFilePicker({ types: fileTypes, multiple: false });
      await applyProjectFile(await handle.getFile(), handle);
    } catch (err) {
      if (err && (err.name === "AbortError" || err.code === 20)) return;
      toast("Не удалось открыть файл: " + (err.message || err), true);
    }
  }

  function openStateFile(file) {
    applyProjectFile(file, null);
  }

  /* ---------------- model helpers ---------------- */

  const project = () => state.projects.find((p) => p.id === state.active) || state.projects[0];
  const device = () => {
    const p = project();
    return p ? p.devices.find((d) => d.id === ui.deviceId) || p.devices[0] || null : null;
  };
  const sheet = () => {
    const d = device();
    if (!d) return null;
    if (ui.kitId) return (d.kits || []).find((k) => k.id === ui.kitId) || d;
    return d;
  };
  const numberOf = (d) => `${d.no}${d.suffix ? "." + d.suffix : ""}`;
  const colCount = (d) => d.columns.length;
  const cellTotal = (row) => row.cells.reduce((n, c) => n + c.span, 0);

  function unitStart(d, index) {
    return Math.round(index * 12 / Math.max(1, d.columns.length));
  }

  function gridSpan(d, start, span) {
    const n = d.columns.length;
    return Math.max(1, unitStart(d, Math.min(n, start + span)) - unitStart(d, start));
  }

  function cellAt(row, col) {
    let at = 0;
    for (const cell of row.cells) {
      if (col >= at && col < at + cell.span) return cell;
      at += cell.span;
    }
    return null;
  }

  function cellIndex(row, cellId) {
    return row.cells.findIndex((c) => c.id === cellId);
  }

  function focusDevice(id) {
    ui.deviceId = id;
    ui.kitId = null;
    ui.rowId = null;
    ui.cellId = null;
    ui.col = 0;
    render();
  }

  /* ---------------- reference project ---------------- */

  function isReferenceProject(p) {
    return Boolean(p) && (p.id === REF_PROJECT_ID || String(p.name || "").trim().toLowerCase() === "все листы");
  }

  function referenceProject() {
    return state.projects.find((p) => p.id === REF_PROJECT_ID) || state.projects.find(isReferenceProject) || null;
  }

  const isReference = () => isReferenceProject(project());
  const refLocked = () => isReference() && !ui.refEdit;

  let pristineCache = null;

  function pristineDevices() {
    if (pristineCache) return pristineCache;
    const seed = window.DS_SEED || { projects: [] };
    const list = Array.isArray(seed.projects) ? seed.projects : [];
    const p = list.find((x) => x.id === REF_PROJECT_ID) || list.find(isReferenceProject) || list[0];
    pristineCache = ((p && p.devices) || []).map((raw, i) => normalizeDevice(clone(raw), i));
    return pristineCache;
  }

  function reidDevice(d, keepId) {
    if (!keepId) d.id = uid("d");
    (d.columns || []).forEach((c) => { c.id = uid("k"); });
    (d.rows || []).forEach((r) => {
      r.id = uid("r");
      (r.cells || []).forEach((c) => { c.id = uid("c"); });
    });
    (d.figures || []).forEach((f) => { f.id = uid("f"); });
    (d.markings || []).forEach((m) => { m.id = uid("m"); });
    (d.tagGroups || []).forEach((g) => { g.id = uid("g"); });
    (d.kits || []).forEach((k) => reidDevice(k));
    return d;
  }

  function requireRefEdit(what) {
    if (!refLocked()) return true;
    toast(`Эталон защищён: включите «Редактировать эталон», чтобы ${what}`, true);
    return false;
  }

  const REF_FIELDS = ["kind", "lead", "nameRu", "nameEn", "titleRu", "titleEn", "scopeRu", "scopeEn", "introRu", "introEn", "columns", "rows", "figures", "markings", "tagGroups"];

  function adoptReference(target, source) {
    const copy = clone(source);
    REF_FIELDS.forEach((key) => {
      if (copy[key] === undefined) return;
      target[key] = copy[key];
    });
    target.kits = (copy.kits || []).map((k) => reidDevice(clone(k)));
    reidDevice(target, true);
    return target;
  }

  function restoreToReference() {
    const d = device();
    if (!d) return;
    const fromSeed = isReference();
    const source = fromSeed ? pristineDevices() : (referenceProject()?.devices || []);
    const src = source.find((x) => x.no === d.no);
    if (!src) {
      toast(`В эталоне нет прибора №${d.no}`, true);
      return;
    }
    const place = fromSeed ? "встроенной копии эталона" : "эталона «Все листы»";
    askConfirm({
      title: "Привести к эталону",
      text: `Лист №${numberOf(d)} «${d.titleRu || d.titleEn || "без названия"}» будет заменён версией из ${place}: таблица, колонки, рисунки, маркировка, теги и комплекты. Текущие правки этого листа пропадут.`,
      ok: "Привести к эталону"
    }).then((ok) => {
      if (!ok) return;
      adoptReference(d, src);
      ui.kitId = null;
      ui.rowId = null;
      ui.cellId = null;
      touch();
      render();
      toast(`Лист №${numberOf(d)} приведён к эталону`);
    });
  }

  const REF_OWNER = "skyrillchanel2000-source";
  const KEY_STORE = "ds-editor-ref-key";
  let refKey = null;

  function readStoredKey() {
    try { return localStorage.getItem(KEY_STORE) || ""; } catch (err) { return ""; }
  }

  function storeKey(token) {
    try { localStorage.setItem(KEY_STORE, token); } catch (err) { /* браузер не даёт — ключ живёт до перезагрузки */ }
  }

  function forgetStoredKey() {
    try { localStorage.removeItem(KEY_STORE); } catch (err) { /* нечего забывать */ }
    refKey = null;
  }

  function setKeyError(text) {
    const box = $("#key-error");
    if (!box) return;
    box.textContent = text || "";
    box.hidden = !text;
  }

  function closeKeyDialog() {
    const dlg = $("#key-dialog");
    if (dlg && typeof dlg.close === "function") dlg.close();
    else if (dlg) dlg.removeAttribute("open");
  }

  function openKeyDialog(message) {
    const dlg = $("#key-dialog");
    const input = $("#key-input");
    if (!dlg || !input) return;
    input.value = "";
    setKeyError(message || "");
    const apply = $("#key-apply");
    if (apply) { apply.disabled = false; apply.textContent = "Проверить и включить"; }
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
    setTimeout(() => input.focus(), 30);
  }

  async function checkToken(token) {
    try {
      const res = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }
      });
      if (res.status === 401) return { ok: false, error: "Токен неверный или истёк" };
      if (!res.ok) return { ok: false, error: `GitHub ответил ${res.status} — попробуйте позже` };
      const user = await res.json();
      if (!user || user.login !== REF_OWNER) {
        return { ok: false, error: `Это токен аккаунта «${user && user.login ? user.login : "неизвестно"}», а нужен ${REF_OWNER}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: "Не удалось проверить ключ: нужен интернет и доступ к api.github.com" };
    }
  }

  async function verifyRefKey() {
    const input = $("#key-input");
    const apply = $("#key-apply");
    const token = (input ? input.value : "").trim();
    if (!token) { setKeyError("Вставьте токен"); return; }
    if (apply) { apply.disabled = true; apply.textContent = "Проверяю…"; }
    setKeyError("");
    try {
      const res = await checkToken(token);
      if (!res.ok) { setKeyError(res.error); return; }
      refKey = token;
      storeKey(token);
      ui.refEdit = true;
      closeKeyDialog();
      render();
      toast("Ключ принят — правка эталона включена");
    } finally {
      if (apply) { apply.disabled = false; apply.textContent = "Проверить и включить"; }
    }
  }

  async function toggleRefEdit() {
    if (!isReference()) return;
    if (ui.refEdit) {
      ui.refEdit = false;
      render();
      toast("Правка эталона выключена — ключ остался в браузере");
      return;
    }
    const stored = readStoredKey();
    if (!stored) { openKeyDialog(); return; }
    toast("Проверяю сохранённый ключ…");
    const res = await checkToken(stored);
    if (res.ok) {
      refKey = stored;
      ui.refEdit = true;
      render();
      toast("Ключ принят — правка эталона включена");
      return;
    }
    forgetStoredKey();
    openKeyDialog(`${res.error} — введите токен заново`);
  }

  function forgetRefKey() {
    forgetStoredKey();
    ui.refEdit = false;
    render();
    toast("Ключ удалён — он больше не хранится в этом браузере");
  }

  /* ---------------- render: sidebar ---------------- */

  function renderSidebar() {
    const p = project();
    const tabs = $("#project-tabs");
    tabs.innerHTML = (state.projects || []).map((item) => {
      const active = item.id === p.id;
      const isRef = isReferenceProject(item);
      return `<button class="project-tab${active ? " active" : ""}" role="tab" aria-selected="${active}" data-act="project" data-id="${item.id}" title="${esc(item.name)} — двойной клик для переименования">
        <span class="dot" aria-hidden="true"></span><span class="pt-name">${esc(item.name)}</span>${isRef ? '<span class="pt-ref">эталон</span>' : ""}<span class="cnt">${item.devices.length}</span>
      </button>`;
    }).join("");

    const q = ui.search.trim().toLowerCase();
    const list = (p?.devices || []).filter((d) => {
      if (!q) return true;
      const hay = [d.no, numberOf(d), d.titleRu, d.titleEn, ...(d.markings || []).map((m) => m.code), ...(d.tagGroups || []).flatMap((g) => g.tags)].join(" ").toLowerCase();
      return hay.includes(q);
    });

    $("#sheet-count").textContent = `${list.length}${q && list.length !== p.devices.length ? " из " + p.devices.length : ""} листов`;
    $("#sheet-list").innerHTML = list.length
      ? list.map((d) => {
        const active = d.id === ui.deviceId;
        const ru = Boolean(d.titleRu);
        const en = Boolean(d.titleEn);
        const tag = Boolean((d.markings || []).some((m) => m.code.trim()) || (d.tagGroups || []).some((g) => g.tags.length));
        return `<button class="sheet-item${active ? " active" : ""}" role="listitem" data-act="sheet" data-id="${d.id}">
          <span class="sheet-no">№${esc(numberOf(d))}</span>
          <span class="sheet-text">
            <span class="sheet-title">${esc(d.titleRu || d.titleEn || "Без названия")}</span>
            <span class="sheet-sub">${esc(d.titleEn || "Английское название не заполнено")}</span>
          </span>
          <span class="sheet-flags" aria-label="Готовность листов">
            <span class="flag${ru ? " on" : ""}" title="Русский лист">RU</span>
            <span class="flag${en ? " on" : ""}" title="Английский лист">EN</span>
            <span class="flag tag${tag ? " on" : ""}" title="Страница тегов">T</span>
          </span>
        </button>`;
      }).join("")
      : `<div class="empty-list"><b>${q ? "Ничего не найдено" : "В проекте пока нет листов"}</b>${q ? "Измените запрос или очистите поиск." : "Создайте лист или добавьте прибор из эталона."}</div>`;
  }

  /* ---------------- render: editor ---------------- */

  function render() {
    renderSidebar();
    const d = device();
    const item = sheet();
    const host = $("#editor");
    if (!d || !item) {
      host.innerHTML = blankHTML();
      return;
    }
    const p = project();
    const lang = ui.lang;
    const isKit = item !== d;
    const numText = isKit ? `${numberOf(d)} · ${item.titleRu || "комплект"}` : numberOf(d);
    host.classList.toggle("split-mode", lang === "both");

    host.innerHTML = `
      <div class="sheet-top">
        <div class="crumbs"><span>${esc(p.name)}</span><i>/</i><b>Лист №${esc(numText)}</b></div>
        <div class="top-actions">
          <button class="btn btn-sm btn-soft" data-act="to-ref" title="${isReference() ? "Вернуть лист к встроенной эталонной копии" : "Заменить лист версией из эталона «Все листы»"}">Привести к эталону</button>
          <div class="seg" role="tablist" aria-label="Язык листа">
            <button data-act="lang" data-lang="both" class="${lang === "both" ? "active" : ""}" title="Русский и английский листы рядом">RU+EN</button>
            <button data-act="lang" data-lang="ru" class="${lang === "ru" ? "active" : ""}" title="Только русский лист">RU</button>
            <button data-act="lang" data-lang="en" class="${lang === "en" ? "active" : ""}" title="Только английский лист">EN</button>
            <button data-act="lang" data-lang="tag" class="${lang === "tag" ? "active" : ""}" title="Страница тегов">TAG</button>
          </div>
          <button class="icon-btn" data-act="dup-sheet" title="Дублировать лист" aria-label="Дублировать лист"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6.5" y="3.5" width="9" height="11" rx="1.6"/><path d="M4 6.5v9.2A1.3 1.3 0 0 0 5.3 17H13"/></svg></button>
          <button class="icon-btn danger" data-act="del-sheet" title="Удалить лист" aria-label="Удалить лист"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 5.5h13M8 5.5V4h4v1.5M5.5 5.5l.8 11h7.4l.8-11M8.5 8.5v5M11.5 8.5v5"/></svg></button>
        </div>
      </div>
      ${refBarHTML()}
      ${kitBar(d)}
      ${translateBarHTML()}
      ${bodyHTML(item, d, lang, isKit)}
    `;
  }

  function translateHint() {
    if (!autoOn && !syncOn) return "Перевод только по кнопке";
    if (autoOn && syncOn) return "EN заполняется переводом RU";
    if (autoOn) return "Автоперевод включён, синхронизация выключена — EN обновляется кнопкой";
    return "Синхронизация без перевода: EN получает текст RU";
  }

  function translateBarHTML() {
    return `<div class="tr-bar">
      <label class="switch" title="Автоматически переводить русский текст в английский по словарю">
        <input type="checkbox" id="opt-auto"${autoOn ? " checked" : ""}>
        <span class="switch-track" aria-hidden="true"></span>
        <span class="switch-text">Автоперевод</span>
      </label>
      <label class="switch" title="Переносить изменения русского текста в английский">
        <input type="checkbox" id="opt-sync"${syncOn ? " checked" : ""}>
        <span class="switch-track" aria-hidden="true"></span>
        <span class="switch-text">Синхронизация</span>
      </label>
      <span class="tr-hint" id="tr-hint">${esc(translateHint())}</span>
      <button class="btn btn-sm btn-soft" data-act="glossary" title="Что на что переводится, и свои пары">Глоссарий</button>
      <button class="btn btn-sm btn-soft" data-act="translate-page" title="Перевести русский текст листа в английский по словарю">Перевести страницу</button>
    </div>`;
  }

  function bodyHTML(item, d, lang, isKit) {
    if (lang === "tag") return tagsHTML(item, d);
    if (lang === "both") {
      return `${sharedBarHTML(d, isKit)}<div class="split">
        ${splitPaneHTML(item, d, "ru", isKit)}
        ${splitPaneHTML(item, d, "en", isKit)}
      </div>`;
    }
    return `${metaHTML(item, lang, d, isKit, false)}${tableHTML(item, lang)}`;
  }

  function sharedBarHTML(d, isKit) {
    if (isKit) {
      return `<div class="shared-bar"><span class="shared-note">Комплект печатается отдельными листами RU/EN после листов прибора.</span></div>`;
    }
    return `<div class="shared-bar">
      <label class="field"><span>Номер прибора</span><input type="number" min="1" step="1" value="${esc(d.no)}" data-model="no"></label>
      <label class="field"><span>Лист прибора</span><input value="${esc(d.suffix)}" placeholder="например 1.2" data-model="suffix"></label>
      <label class="field"><span>Название проекта</span><input value="${esc(project().name)}" data-model="projectName"></label>
    </div>`;
  }

  function splitPaneHTML(item, d, lang, isKit) {
    return `<div class="split-col" data-panel="${lang}">
      <div class="split-head"><span class="split-tag">${lang.toUpperCase()}</span><span>${lang === "ru" ? "Русский лист" : "English sheet"}</span></div>
      ${metaHTML(item, lang, d, isKit, true)}
      ${tableHTML(item, lang)}
    </div>`;
  }

  function refBarHTML() {
    if (!isReference()) return "";
    const on = ui.refEdit;
    const hasKey = Boolean(readStoredKey());
    return `<div class="ref-banner${on ? " on" : ""}" id="ref-banner">
      <span class="ref-banner-text">${on
        ? "Правка эталона включена: изменения попадут во все проекты, куда прибор добавляется из «Все листы»."
        : "Эталон «Все листы» защищён. Правка включается кнопкой «Редактировать эталон» — только после подтверждения."}</span>
      ${hasKey ? '<button class="btn btn-sm btn-soft" data-act="forget-ref-key" title="Удалить сохранённый ключ из этого браузера">Забыть ключ</button>' : ""}
      <button class="btn btn-sm${on ? " btn-pink" : ""}" data-act="toggle-ref-edit">${on ? "Выключить правку эталона" : "Редактировать эталон"}</button>
    </div>`;
  }

  function kitBar(d) {
    return `<div class="kit-bar">
      <span class="kit-label">Лист:</span>
      <button class="kit-tab${ui.kitId ? "" : " active"}" data-act="kit" data-id="">Прибор</button>
      ${(d.kits || []).map((k) => `<button class="kit-tab${ui.kitId === k.id ? " active" : ""}" data-act="kit" data-id="${k.id}">${esc(k.titleRu || "Комплект")}</button>`).join("")}
      <button class="kit-add" data-act="add-kit">+ комплект</button>
    </div>`;
  }

  function blankHTML() {
    return `<div class="blank"><div class="blank-card">
      <div class="blank-mark"><svg viewBox="0 0 32 32"><path d="M6 5h20M6 27h20M9.5 5v22M22.5 5v22M6 11h20M6 21h20"/><path d="M13 14h6v4h-6z" fill="currentColor" stroke="none" opacity=".18"/></svg></div>
      <h2>В проекте нет листов</h2>
      <p>Создайте пустой лист технических данных или добавьте готовый прибор из эталонного проекта «Все листы».</p>
      <div class="blank-actions">
        <button class="btn btn-primary" data-act="new-sheet">+ Новый лист</button>
        <button class="btn btn-soft" data-act="ref-open">Добавить из «Все листы»</button>
      </div>
    </div></div>`;
  }

  function metaHTML(d, lang, parent, isKit, split) {
    const ru = lang === "ru";
    const titleLabel = ru ? (isKit ? "Название комплекта (RU)" : "Название прибора (RU)") : (isKit ? "Kit name (EN)" : "Название прибора (EN)");
    const scopeLabel = ru ? "Область применения (RU)" : "Application area (EN)";
    const introLabel = ru ? "Подводка к таблице (RU)" : "Intro before the table (EN)";
    const secondTitle = split ? "" : `<label class="field"><span>${ru ? "Второе название (EN)" : "Второе название (RU)"}</span><input value="${esc(ru ? d.titleEn : d.titleRu)}" data-model="${ru ? "titleEn" : "titleRu"}"></label>`;
    const numRow = split
      ? ""
      : isKit
        ? `<p class="field-note" style="margin:0 0 10px">Комплект печатается отдельными листами RU/EN после листов прибора.</p>`
        : `<div class="num-row" style="margin-bottom:12px">
          <label class="field"><span>Номер прибора</span><input type="number" min="1" step="1" value="${esc(d.no)}" data-model="no"></label>
          <label class="field"><span>Лист прибора</span><input value="${esc(d.suffix)}" placeholder="например 1.2" data-model="suffix"></label>
          <label class="field"><span>Название проекта</span><input value="${esc(project().name)}" data-model="projectName"></label>
        </div>`;
    return `<section class="card">
      <div class="card-head">
        <div><h2>${isKit ? "Комплект" : "Основное"}</h2><p>${isKit ? "Отдельная таблица характеристик гильзы/манифольда к прибору." : "Номер закреплён за прибором; лист проекта можно переименовать."}</p></div>
        <div class="num-badge" data-num="device">${isKit ? "к №" + esc(numberOf(parent)) : "№" + esc(numberOf(d))}</div>
      </div>
      <div class="card-body">
        ${numRow}
        <div class="field-grid${split ? " single" : ""}">
          <label class="field"><span>${titleLabel}</span><input value="${esc(ru ? d.titleRu : d.titleEn)}" data-model="${ru ? "titleRu" : "titleEn"}" placeholder="${ru ? "ЭМИС-БАР 143" : "EMIS-BAR 143"}"></label>
          ${secondTitle}
          <label class="field full"><span>${scopeLabel}</span><textarea rows="2" data-model="${ru ? "scopeRu" : "scopeEn"}" placeholder="${ru ? "для контроля запыленности фильтра…" : "to control the filter dustiness…"}">${esc(ru ? d.scopeRu : d.scopeEn)}</textarea></label>
          <label class="field full"><span>${introLabel}</span><textarea rows="2" data-model="${ru ? "introRu" : "introEn"}">${esc(ru ? d.introRu : d.introEn)}</textarea></label>
          <label class="field full"><span>${ru ? "Подпись таблицы (RU)" : "Table caption (EN)"}</span><textarea rows="2" data-model="${ru ? "nameRu" : "nameEn"}" placeholder="${ru ? "Таблица 1 – Технические характеристики датчика …" : "Table 1 - Technical characteristics of the transmitter …"}">${esc(ru ? (d.nameRu || "") : (d.nameEn || ""))}</textarea></label>
        </div>
        <p class="field-note" style="margin:9px 0 0">Красная строка в Excel (8 пробелов) и заголовок таблицы собираются автоматически — вручную пробелы вставлять не нужно.</p>
        ${isKit ? `<div style="margin-top:12px"><button class="btn btn-sm" data-act="del-kit">Удалить комплект</button></div>` : ""}
      </div>
    </section>`;
  }

  /* ---------------- render: table ---------------- */

  function colChipHTML(d, col, i) {
    return `<span class="col-chip static" title="Колонка ${i + 1}">
      <span class="col-index">${i + 1}</span>
      <span class="col-name">${esc(col.name || `Колонка ${i + 1}`)}</span>
    </span>`;
  }

  function selectedRow(d) {
    return d.rows.find((r) => r.id === ui.rowId) || null;
  }

  function tableHTML(d, lang) {
    const ru = lang === "ru";
    const head = ru ? ["Параметр", "Значение"] : ["Parameter", "Value"];
    const rows = d.rows.map((row, ri) => rowHTML(d, row, ri, ru)).join("");
    return `<section class="card">
      <div class="card-head">
        <div><h2>Таблица 1 — технические характеристики</h2><p>«+» справа от строки задаёт число колонок в ней (1–4), кнопки ⇄ над строкой объединяют соседние ячейки.</p></div>
        <div class="num-badge">${d.rows.length} строк · ${d.columns.length} кол.</div>
      </div>
      <div class="col-head">
        <span class="hint">Колонки листа</span>
        <div class="column-strip">${d.columns.map((c, i) => colChipHTML(d, c, i)).join("")}</div>
      </div>
      <div class="table-toolbar">${toolbarHTML(d)}</div>
      <div class="sheet-table">
        <div class="tr head"><div class="td label">${head[0]}</div><div class="td value"><div class="vgrid"><div class="vcell" style="--gsp:12">${head[1]}</div></div></div></div>
        ${rows || '<div class="tr"><div class="td label" style="color:#8aa3ba;font-family:var(--ui);font-size:12px">Нет строк — добавьте первую</div><div class="td value"><div class="vgrid"><div class="vcell" style="--gsp:12"></div></div></div></div>'}
      </div>
      <button class="add-row" data-act="add-row">+ строка</button>
      <div class="table-foot">
        <span>${d.rows.length} строк · ${d.columns.length} колонок</span>
        <span>Тонкие границы и объединения переносятся в Excel автоматически</span>
      </div>
    </section>`;
  }

  function rowHTML(d, row, ri, ru) {
    let at = 0;
    const cells = row.cells.map((cell) => {
      const gs = gridSpan(d, at, cell.span);
      at += cell.span;
      const text = String((ru ? cell.ru : cell.en) || "");
      const selected = ui.rowId === row.id && ui.cellId === cell.id;
      return `<div class="vcell${cell.span > 1 ? " merged" : ""}${selected ? " selected" : ""}" style="--gsp:${gs}" contenteditable="true" spellcheck="false"
        data-edit="cell" data-r="${row.id}" data-c="${cell.id}" data-col="${at - cell.span}"
        data-ph="${ru ? "значение" : "value"}">${esc(text)}</div>`;
    }).join("");
    const label = String((ru ? row.labelRu : row.labelEn) || "");
    const total = Math.max(1, cellTotal(row));
    const mergeBar = ui.rowId === row.id && row.cells.length > 1
      ? `<div class="merge-bar">${row.cells.slice(0, -1).map((cell, i) => {
        const left = row.cells.slice(0, i + 1).reduce((n, c) => n + c.span, 0);
        return `<button class="merge-dot" style="left:${(left / total) * 100}%" data-act="merge-at" data-r="${row.id}" data-i="${i}" title="Объединить ${i + 1}-ю и ${i + 2}-ю ячейки" aria-label="Объединить ячейки">⇄</button>`;
      }).join("")}</div>`
      : "";
    return `<div class="tr${ui.rowId === row.id ? " selected" : ""}" data-row="${row.id}">
      <div class="td label" contenteditable="true" spellcheck="false" data-edit="label" data-r="${row.id}" data-ph="${ru ? "параметр" : "parameter"}">${esc(label)}</div>
      <div class="td value">${mergeBar}<div class="vgrid">${cells}</div>
        <button class="row-plus" data-act="row-cols" data-r="${row.id}" title="Сколько колонок в этой строке" aria-label="Колонки строки ${ri + 1}">+</button>
      </div>
    </div>`;
  }

  function toolbarHTML(d) {
    const row = selectedRow(d);
    const cell = row && ui.cellId ? row.cells.find((c) => c.id === ui.cellId) : null;
    const info = row
      ? `Строка ${d.rows.indexOf(row) + 1} · колонок ${row.cells.length} из ${d.columns.length}${cell ? (cell.span > 1 ? ` · объединено ${cell.span}` : "") : ""}`
      : "Нажмите на строку, затем «+» справа — выберите, сколько в ней колонок";
    return `<span class="sel-info">${esc(info)}</span>
      <button class="tool-btn" data-act="row-up" ${row ? "" : "disabled"} title="Выше">↑</button>
      <button class="tool-btn" data-act="row-down" ${row ? "" : "disabled"} title="Ниже">↓</button>
      <button class="tool-btn" data-act="add-row" ${row ? "" : "disabled"}>+ строка</button>
      <button class="tool-btn pink" data-act="del-row" ${row ? "" : "disabled"}>− строка</button>`;
  }

  function refreshToolbar() {
    const d = sheet();
    if (!d) return;
    $$(".table-toolbar", $("#editor")).forEach((box) => { box.innerHTML = toolbarHTML(d); });
  }

  function refreshSelection() {
    const d = sheet();
    if (!d) return;
    $$(".vcell.selected", $("#editor")).forEach((el) => el.classList.remove("selected"));
    $$(".tr.selected", $("#editor")).forEach((el) => el.classList.remove("selected"));
    if (ui.rowId) {
      $$(`.tr[data-row="${ui.rowId}"]`, $("#editor")).forEach((el) => el.classList.add("selected"));
    }
    if (ui.cellId) {
      $$(`.vcell[data-c="${ui.cellId}"]`, $("#editor")).forEach((el) => el.classList.add("selected"));
    }
    refreshToolbar();
  }

  /* ---------------- render: tags ---------------- */

  function tagsHTML(d) {
    const marks = d.markings.length
      ? d.markings.map((m, i) => `<div class="mark-row">
          <input value="${esc(m.code)}" data-mark="${m.id}" data-field="code" placeholder="Полная маркировка прибора ${i + 1}" aria-label="Маркировка ${i + 1}">
          <input value="${esc(m.note)}" data-mark="${m.id}" data-field="note" placeholder="Примечание" aria-label="Примечание к маркировке ${i + 1}">
          <button class="icon-btn danger" data-act="del-mark" data-id="${m.id}" aria-label="Удалить маркировку">✕</button>
        </div>`).join("")
      : '<div class="tag-empty">Маркировка не заполнена — на странице TAG будет только таблица тегов.</div>';

    const groups = d.tagGroups.length
      ? d.tagGroups.map((g, gi) => {
        const slots = g.tags.length
          ? g.tags.map((t, ti) => `<span class="tag-slot">
              <span class="tag-no">${ti + 1}</span>
              <input value="${esc(t)}" data-group="${g.id}" data-tag="${ti}" placeholder="тег" aria-label="Тег ${ti + 1} области ${gi + 1}">
              <button class="x" data-act="del-tag" data-group="${g.id}" data-tag="${ti}" aria-label="Удалить тег ${ti + 1}">×</button>
            </span>`).join("")
          : '<div class="tag-empty" style="grid-column:1/-1">Тегов пока нет — в Excel будут пустые строки №1–22 для заполнения от руки.</div>';
        return `<div class="tag-group">
          <div class="tag-group-head">
            <input value="${esc(g.scopeRu)}" data-group="${g.id}" data-field="scopeRu" placeholder="Область применения (RU)">
            <input value="${esc(g.scopeEn)}" data-group="${g.id}" data-field="scopeEn" placeholder="Application area (EN)">
            <button class="icon-btn danger" data-act="del-group" data-id="${g.id}" aria-label="Удалить область">✕</button>
          </div>
          <div class="tag-grid">${slots}</div>
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-sm btn-soft" data-act="add-tag" data-id="${g.id}">+ тег</button>
            <button class="btn btn-sm" data-act="paste-tags" data-id="${g.id}">Вставить все</button>
          </div>
        </div>`;
      }).join("")
      : '<div class="empty-soft">Добавьте область применения — под неё будет собрана таблица тегов.</div>';

    return `<section class="card">
      <div class="card-head">
        <div><h2>TAG — полная маркировка и теги</h2><p>Третья страница прибора: маркировка сверху, затем таблица «теги ↔ область применения».</p></div>
        <div class="num-badge">№${esc(numberOf(d))}</div>
      </div>
      <div class="card-body">
        <div class="tag-section">
          <div class="subhead"><h3>Маркировка прибора</h3><button class="btn btn-sm btn-soft" data-act="add-mark">+ маркировка</button></div>
          ${marks}
        </div>
        <div class="tag-section">
          <div class="subhead"><h3>Области применения и теги</h3><button class="btn btn-sm btn-pink" data-act="add-group">+ область</button></div>
          ${groups}
        </div>
      </div>
    </section>`;
  }

  /* ---------------- figures ---------------- */

  function figuresHTML(d) {
    const cards = d.figures.length
      ? d.figures.map((f) => `<article class="figure-card" data-fig="${f.id}">
          <div class="figure-thumb${f.image ? "" : " empty"}">
            ${f.image ? `<img src="${f.image}" alt="${esc(f.captionRu || "Рисунок")}">` : "Рисунок не добавлен"}
            <button class="replace" data-act="pick-image" data-id="${f.id}">${f.image ? "Заменить рисунок" : "Выбрать файл"}</button>
          </div>
          <div class="figure-fields">
            <label class="field"><span>Подпись (RU)</span><input value="${esc(f.captionRu)}" data-fig="${f.id}" data-field="captionRu" placeholder="Рисунок 1 - Внешний вид датчика"></label>
            <label class="field"><span>Caption (EN)</span><input value="${esc(f.captionEn)}" data-fig="${f.id}" data-field="captionEn" placeholder="Figure 1 - The appearance of the sensor"></label>
            <label class="field"><span>Подводка (RU)</span><input value="${esc(f.noteRu)}" data-fig="${f.id}" data-field="noteRu" placeholder="Внешний вид датчика … представлен на рисунке 1."></label>
            <label class="field"><span>Note (EN)</span><input value="${esc(f.noteEn)}" data-fig="${f.id}" data-field="noteEn" placeholder="The appearance of the sensor is shown in Figure 1."></label>
          </div>
          <button class="icon-btn danger" data-act="del-fig" data-id="${f.id}" aria-label="Удалить рисунок">✕</button>
        </article>`).join("")
      : '<div class="empty-soft">Рисунков нет. Добавьте габаритный чертёж или внешний вид прибора — он встанет под таблицей.</div>';
    return `<section class="card">
      <div class="card-head">
        <div><h2>Рисунки</h2><p>В Excel рисунок центрируется в объединённой ячейке, пропорции сохраняются.</p></div>
        <button class="btn btn-sm btn-soft" data-act="add-fig">+ рисунок</button>
      </div>
      <div class="card-body"><div class="figure-list">${cards}</div></div>
    </section>`;
  }

  /* ---------------- render all cards ---------------- */

  const originalRender = render;
  render = function () {
    originalRender();
    const d = sheet();
    if (d) {
      const host = $("#editor");
      const anchor = host.querySelector(".split") || host.querySelector(".card:last-of-type");
      if (anchor && ui.lang !== "tag") {
        anchor.insertAdjacentHTML("afterend", figuresHTML(d));
      }
    }
    applyRefState();
  };

  /* ---------------- reference lock ---------------- */

  const REF_LOCKED_ACTS = new Set([
    "dup-sheet", "del-sheet", "add-kit", "del-kit", "row-cols", "merge-at",
    "add-row", "del-row", "row-up", "row-down",
    "add-fig", "del-fig", "pick-image", "add-mark", "del-mark", "add-group", "del-group",
    "add-tag", "del-tag", "paste-tags", "translate-page"
  ]);

  const REF_FREE_ACTS = new Set(["to-ref", "toggle-ref-edit", "forget-ref-key", "lang", "kit"]);

  function applyRefState() {
    const host = $("#editor");
    if (!host) return;
    const locked = refLocked();
    host.classList.toggle("locked", locked);
    if (!locked) return;
    $$("input, textarea", host).forEach((el) => {
      el.readOnly = true;
      el.setAttribute("aria-readonly", "true");
    });
    $$("[contenteditable]", host).forEach((el) => el.setAttribute("contenteditable", "false"));
    $$("[data-act]", host).forEach((el) => {
      if (!("disabled" in el)) return;
      if (REF_FREE_ACTS.has(el.dataset.act)) return;
      if (REF_LOCKED_ACTS.has(el.dataset.act)) el.disabled = true;
    });
  }

  /* ---------------- editing: text ---------------- */

  function applyModel(el) {
    const d = sheet();
    if (!d) return;
    const key = el.dataset.model;
    if (!key) return;
    const value = el.value;
    if (key === "projectName") {
      project().name = value;
      touch();
      renderSidebar();
      return;
    }
    if (key === "no") d.no = Math.max(1, Math.round(num(value, d.no)));
    else if (key === "suffix") d.suffix = value.trim();
    else d[key] = value;
    if (EN_FIELD[key]) syncMetaField(d, key, value);
    touch();
    if (key.startsWith("title") || key === "no" || key === "suffix") {
      renderSidebar();
      const crumb = $(".crumbs b");
      if (crumb) crumb.textContent = `Лист №${numberOf(d)}`;
      $$('[data-num="device"]', $("#editor")).forEach((badge) => { badge.textContent = `№${numberOf(d)}`; });
    }
  }

  const EN_FIELD = { titleRu: "titleEn", scopeRu: "scopeEn", introRu: "introEn", nameRu: "nameEn" };

  function toEnglish(value) {
    return autoOn ? translateRu(value).text : value;
  }

  function syncMetaField(d, key, value) {
    if (!syncOn) return;
    const dst = EN_FIELD[key];
    if (!dst) return;
    const text = toEnglish(value);
    if (d[dst] === text) return;
    d[dst] = text;
    const input = $(`[data-model="${dst}"]`, $("#editor"));
    if (input && document.activeElement !== input) input.value = text;
  }

  function syncTableText(kind, id, text) {
    const root = $('.split-col[data-panel="en"]', $("#editor"));
    if (!root) return;
    const el = kind === "label"
      ? $(`.td.label[data-r="${id}"]`, root)
      : $(`.vcell[data-c="${id}"]`, root);
    if (el && document.activeElement !== el) el.textContent = text;
  }

  function applyEditable(el) {
    const d = sheet();
    if (!d) return;
    const row = d.rows.find((r) => r.id === el.dataset.r);
    if (!row) return;
    const panel = el.closest("[data-panel]");
    const ru = (panel ? panel.dataset.panel : ui.lang) === "ru";
    const value = el.innerText.replace(/\u00a0/g, " ").replace(/\n$/, "");
    if (el.dataset.edit === "label") {
      row[ru ? "labelRu" : "labelEn"] = value;
      if (ru && syncOn) {
        row.labelEn = toEnglish(value);
        syncTableText("label", row.id, row.labelEn);
      }
    } else {
      const cell = row.cells.find((c) => c.id === el.dataset.c);
      if (cell) {
        cell[ru ? "ru" : "en"] = value;
        if (ru && syncOn) {
          cell.en = toEnglish(value);
          syncTableText("cell", cell.id, cell.en);
        }
      }
    }
    touch();
  }

  /* ---------------- перевод страницы ---------------- */

  function translateList(d) {
    const jobs = [];
    const add = (ru, get, set) => { jobs.push({ ru, get, set }); };
    add(d.titleRu, () => d.titleEn, (v) => { d.titleEn = v; });
    add(d.scopeRu, () => d.scopeEn, (v) => { d.scopeEn = v; });
    add(d.introRu, () => d.introEn, (v) => { d.introEn = v; });
    add(d.nameRu, () => d.nameEn, (v) => { d.nameEn = v; });
    (d.rows || []).forEach((row) => {
      add(row.labelRu, () => row.labelEn, (v) => { row.labelEn = v; });
      (row.cells || []).forEach((cell) => add(cell.ru, () => cell.en, (v) => { cell.en = v; }));
    });
    (d.figures || []).forEach((fig) => {
      add(fig.captionRu, () => fig.captionEn, (v) => { fig.captionEn = v; });
      add(fig.noteRu, () => fig.noteEn, (v) => { fig.noteEn = v; });
    });
    (d.tagGroups || []).forEach((group) => add(group.scopeRu, () => group.scopeEn, (v) => { group.scopeEn = v; }));
    return jobs.filter((job) => String(job.ru || "").trim());
  }

  async function translatePage() {
    const d = sheet();
    if (!d) return;
    const jobs = translateList(d);
    if (!jobs.length) { toast("На русской стороне нет текста для перевода", true); return; }
    const results = jobs.map((job) => ({ ...job, translated: translateRu(job.ru) }));
    const changed = results.filter((r) => r.translated.text.trim() && r.translated.text.trim() !== String(r.ru).trim()).length;
    const missing = results.reduce((n, r) => n + r.translated.missing, 0);
    const overwrite = results.filter((r) => {
      const current = String(r.get() || "").trim();
      return current && current !== r.translated.text.trim();
    }).length;
    if (overwrite) {
      const ok = await askConfirm({
        title: "Перевести страницу",
        text: `Английский текст будет заменён переводом (в ${overwrite} полях он отличается от словарного). Продолжить?`,
        ok: "Перевести и заменить"
      });
      if (!ok) return;
    }
    results.forEach((r) => r.set(r.translated.text));
    touch();
    render();
    toast(`Переведено: ${changed} полей${missing ? `, без перевода слов — ${missing}` : ""}`);
  }

  /* ---------------- глоссарий ---------------- */

  const GLOSS_STORE = "ds-editor-gloss-v1";

  function readGloss() {
    try {
      const raw = localStorage.getItem(GLOSS_STORE);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function saveGloss(pairs) {
    try {
      localStorage.setItem(GLOSS_STORE, JSON.stringify(pairs));
    } catch (err) {
      toast("Браузер не даёт сохранить глоссарий", true);
    }
    if (window.DSTranslate) window.DSTranslate.setUser(pairs);
  }

  function glossKey(text) {
    return String(text == null ? "" : text).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function displayRu(text) {
    const value = String(text || "").trim();
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  }

  function glossRows() {
    const base = window.DSTranslate ? window.DSTranslate.base() : {};
    const mine = readGloss();
    const mineKeys = new Set(Object.keys(mine).map(glossKey));
    const rows = Object.keys(mine)
      .filter((ru) => String(mine[ru] || "").trim())
      .map((ru) => ({ ru, en: mine[ru], mine: true }));
    Object.keys(base).forEach((ru) => {
      if (mineKeys.has(glossKey(ru))) return;
      rows.push({ ru: displayRu(ru), en: base[ru], mine: false });
    });
    const rank = (row) => (row.mine ? 0 : (/^[А-Яа-яЁёA-Za-z]/.test(row.ru) ? 1 : 2));
    rows.sort((a, b) => (rank(a) - rank(b)) || a.ru.localeCompare(b.ru, "ru"));
    return rows;
  }

  function renderGlossList() {
    const list = $("#gloss-list");
    if (!list) return;
    const input = $("#gloss-search");
    const q = glossKey(input ? input.value : "");
    const all = glossRows();
    const rows = q ? all.filter((row) => glossKey(row.ru).includes(q) || glossKey(row.en).includes(q)) : all;
    const mineCount = all.filter((row) => row.mine).length;
    const count = $("#gloss-count");
    if (count) {
      count.textContent = `${rows.length} из ${all.length} пар (своих: ${mineCount}, словарь эталона: ${all.length - mineCount})`;
    }
    list.innerHTML = rows.length
      ? rows.map((row) => `<div class="gloss-row${row.mine ? " mine" : ""}" data-ru="${esc(row.ru)}" data-en="${esc(row.en)}" title="Подставить в поля">
          <span class="gloss-ru">${esc(row.ru)}</span>
          <span class="gloss-arrow" aria-hidden="true">→</span>
          <span class="gloss-en">${esc(row.en)}</span>
          ${row.mine
            ? `<button class="icon-btn danger" data-act="gloss-del" data-ru="${esc(row.ru)}" aria-label="Удалить свою пару">✕</button>`
            : '<span class="gloss-badge">словарь</span>'}
        </div>`).join("")
      : '<div class="empty-list">Ничего не найдено — добавьте свою пару в полях выше.</div>';
  }

  function openGlossary() {
    const error = $("#gloss-error");
    if (error) error.hidden = true;
    const search = $("#gloss-search");
    if (search) search.value = "";
    renderGlossList();
    const dlg = $("#glossary-dialog");
    if (dlg && typeof dlg.showModal === "function") dlg.showModal();
    else if (dlg) dlg.setAttribute("open", "");
    const ru = $("#gloss-ru");
    if (ru) setTimeout(() => ru.focus(), 30);
  }

  function glossError(message) {
    const error = $("#gloss-error");
    if (!error) return;
    error.textContent = message;
    error.hidden = !message;
  }

  function addGlossPair() {
    const ruEl = $("#gloss-ru");
    const enEl = $("#gloss-en");
    if (!ruEl || !enEl) return;
    const ru = ruEl.value.replace(/\s+/g, " ").trim();
    const en = enEl.value.replace(/\s+/g, " ").trim();
    if (!ru && !en) { glossError("Введите русский и английский термин"); return; }
    if (!ru) { glossError("Введите русский термин"); ruEl.focus(); return; }
    if (!en) { glossError("Введите перевод на английский"); enEl.focus(); return; }
    if (!/[А-Яа-яЁё]/.test(ru)) { glossError("Русский термин должен содержать русские буквы"); ruEl.focus(); return; }
    const store = readGloss();
    Object.keys(store).forEach((key) => {
      if (glossKey(key) === glossKey(ru)) delete store[key];
    });
    store[ru] = en;
    saveGloss(store);
    glossError("");
    ruEl.value = "";
    enEl.value = "";
    renderGlossList();
    toast(`Своя пара добавлена: ${ru} → ${en}`);
    ruEl.focus();
  }

  function deleteGlossPair(ru) {
    const store = readGloss();
    Object.keys(store).forEach((key) => {
      if (glossKey(key) === glossKey(ru)) delete store[key];
    });
    saveGloss(store);
    renderGlossList();
    toast("Своя пара удалена");
  }

  function focusFrom(el) {
    if (el.dataset.edit === "label") {
      ui.rowId = el.dataset.r;
      ui.cellId = null;
      ui.col = 0;
    } else {
      ui.rowId = el.dataset.r;
      ui.cellId = el.dataset.c;
      ui.col = num(el.dataset.col, 0);
    }
    refreshSelection();
  }

  /* ---------------- structural edits ---------------- */

  function addRow(afterId) {
    const d = sheet();
    const row = { id: uid("r"), labelRu: "", labelEn: "", rowSpan: 1, cells: [{ id: uid("c"), span: d.columns.length, ru: "", en: "" }] };
    const idx = afterId ? d.rows.findIndex((r) => r.id === afterId) : d.rows.length - 1;
    d.rows.splice(idx + 1, 0, row);
    ui.rowId = row.id;
    ui.cellId = row.cells[0].id;
    touch();
    render();
    const el = $(`.vcell[data-c="${row.cells[0].id}"]`, $("#editor"));
    if (el) el.focus();
  }

  function deleteRow() {
    const d = sheet();
    const row = selectedRow(d);
    if (!row) return;
    const filled = [row.labelRu, row.labelEn, ...row.cells.flatMap((c) => [c.ru, c.en])].some((v) => v.trim());
    if (filled && !confirm("Удалить строку вместе с параметром и значениями?")) return;
    d.rows = d.rows.filter((r) => r.id !== row.id);
    ui.rowId = null;
    ui.cellId = null;
    touch();
    render();
  }

  function moveRow(dir) {
    const d = sheet();
    const row = selectedRow(d);
    if (!row) return;
    const i = d.rows.indexOf(row);
    const j = i + dir;
    if (j < 0 || j >= d.rows.length) return;
    [d.rows[i], d.rows[j]] = [d.rows[j], d.rows[i]];
    touch();
    render();
  }

  function splitSpans(total, n) {
    const base = Math.floor(total / n);
    const rem = total % n;
    return Array.from({ length: n }, (_, i) => Math.max(1, base + (i < rem ? 1 : 0)));
  }

  function growColumns(d, target) {
    const from = d.columns.length;
    if (target <= from) return;
    for (let i = from; i < target; i += 1) d.columns.push({ id: uid("k"), name: `Колонка ${i + 1}` });
    d.rows.forEach((row) => {
      const total = cellTotal(row);
      if (!total) { row.cells = [newCell(target)]; return; }
      const cells = row.cells.map((cell) => ({ ...cell, span: Math.max(1, Math.round((cell.span * target) / total)) }));
      let sum = cells.reduce((n, c) => n + c.span, 0);
      let guard = 0;
      while (sum !== target && guard < 64) {
        const wide = cells.slice().reverse().find((c) => c.span > 1);
        if (sum < target) { cells[0].span += 1; sum += 1; }
        else if (wide) { wide.span -= 1; sum -= 1; }
        else break;
        guard += 1;
      }
      row.cells = cells;
    });
  }

  function setRowCells(row, n) {
    const d = sheet();
    if (!row) return;
    const want = Math.max(1, Math.min(4, Number(n) || 1));
    growColumns(d, want);
    const spans = splitSpans(d.columns.length, want);
    const texts = row.cells.map((c) => ({ ru: c.ru || "", en: c.en || "" }));
    const cells = spans.map((span, i) => ({
      id: uid("c"),
      span,
      ru: texts[i] ? texts[i].ru : "",
      en: texts[i] ? texts[i].en : ""
    }));
    if (texts.length > want) {
      const last = cells[cells.length - 1];
      const rest = texts.slice(want);
      ["ru", "en"].forEach((k) => {
        const extra = rest.map((t) => String(t[k] || "").trim()).filter(Boolean);
        if (!extra.length) return;
        const head = String(last[k] || "").trim();
        last[k] = [head, ...extra].filter(Boolean).join("\n");
      });
    }
    row.cells = cells;
    ui.rowId = row.id;
    ui.cellId = cells[0].id;
    touch();
    render();
  }

  function mergeAt(row, index) {
    if (!row || index < 0 || index >= row.cells.length - 1) return;
    ui.rowId = row.id;
    ui.cellId = row.cells[index].id;
    mergeCell();
  }

  let colsMenu = null;

  function onColsMenuDown(e) {
    if (colsMenu && !colsMenu.contains(e.target)) closeColsMenu();
  }

  function closeColsMenu() {
    if (!colsMenu) return;
    colsMenu.remove();
    colsMenu = null;
    document.removeEventListener("mousedown", onColsMenuDown, true);
  }

  function openColsMenu(anchor) {
    const d = sheet();
    const row = d && d.rows.find((r) => r.id === anchor.dataset.r);
    if (!row) return;
    closeColsMenu();
    const menu = document.createElement("div");
    menu.className = "cols-menu";
    menu.innerHTML = `<span class="cols-menu-title">Колонок в строке</span>
      <div class="cols-menu-row">${[1, 2, 3, 4].map((n) => `<button data-n="${n}"${row.cells.length === n ? ' class="on"' : ""}>${n}</button>`).join("")}</div>`;
    document.body.appendChild(menu);
    const box = anchor.getBoundingClientRect();
    const width = 172;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, box.right - width))}px`;
    menu.style.top = `${Math.min(window.innerHeight - 90, box.bottom + 6)}px`;
    colsMenu = menu;
    menu.addEventListener("click", (e) => {
      const pick = e.target.closest("button[data-n]");
      if (!pick) return;
      const n = Number(pick.dataset.n);
      closeColsMenu();
      setRowCells(row, n);
    });
    setTimeout(() => document.addEventListener("mousedown", onColsMenuDown, true), 0);
  }

  let pendingMerge = null;

  function mergeCell() {
    const d = sheet();
    const row = selectedRow(d);
    if (!row || !ui.cellId) return;
    const i = cellIndex(row, ui.cellId);
    if (i < 0 || i >= row.cells.length - 1) return;
    const a = row.cells[i];
    const b = row.cells[i + 1];
    const conflict = ["ru", "en"].some((k) => String(a[k] || "").trim() && String(b[k] || "").trim() && String(a[k]).trim() !== String(b[k]).trim());
    if (conflict) {
      pendingMerge = { rowId: row.id, cellId: a.id };
      const dlg = $("#merge-dialog");
      if (dlg && typeof dlg.showModal === "function") dlg.showModal();
      else if (dlg) dlg.setAttribute("open", "");
      return;
    }
    pendingMerge = { rowId: row.id, cellId: a.id };
    doMerge("both");
  }

  function doMerge(mode) {
    const d = sheet();
    const row = d && pendingMerge ? d.rows.find((r) => r.id === pendingMerge.rowId) : null;
    if (!row) return;
    const i = cellIndex(row, pendingMerge.cellId);
    if (i < 0 || i >= row.cells.length - 1) return;
    const a = row.cells[i];
    const b = row.cells[i + 1];
    a.span += b.span;
    ["ru", "en"].forEach((k) => {
      const left = String(a[k] || "").trim();
      const right = String(b[k] || "").trim();
      if (mode === "left") a[k] = left;
      else if (mode === "right") a[k] = right;
      else a[k] = left && right && left !== right ? `${left}\n${right}` : (left || right);
    });
    row.cells.splice(i + 1, 1);
    pendingMerge = null;
    const dlg = $("#merge-dialog");
    if (dlg && typeof dlg.close === "function") dlg.close();
    touch();
    render();
  }

  function splitCell() {
    const d = sheet();
    const row = selectedRow(d);
    if (!row || !ui.cellId) return;
    const i = cellIndex(row, ui.cellId);
    if (i < 0) return;
    const cell = row.cells[i];
    if (cell.span <= 1) return;
    const parts = [];
    for (let k = 0; k < cell.span; k += 1) {
      parts.push({ id: uid("c"), span: 1, ru: k === 0 ? cell.ru : "", en: k === 0 ? cell.en : "" });
    }
    row.cells.splice(i, 1, ...parts);
    ui.cellId = parts[0].id;
    touch();
    render();
  }

  function addFigure() {
    const d = sheet();
    const fig = { id: uid("f"), image: "", noteRu: "", noteEn: "", captionRu: `Рисунок ${d.figures.length + 1} - Внешний вид ${d.titleRu}`, captionEn: `Figure ${d.figures.length + 1} - The appearance of ${d.titleEn || d.titleRu}` };
    d.figures.push(fig);
    touch();
    render();
    pickImage(fig.id);
  }

  function pickImage(id) {
    imageTarget = id;
    const input = $("#file-image");
    input.value = "";
    input.click();
  }

  function handleImage(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const d = sheet();
      const fig = d && d.figures.find((f) => f.id === imageTarget);
      if (!fig) return;
      fig.image = reader.result;
      touch();
      render();
    };
    reader.readAsDataURL(file);
  }

  function addMark() {
    const d = sheet();
    d.markings.push({ id: uid("m"), code: "", note: "" });
    touch();
    render();
  }

  function addGroup() {
    const d = sheet();
    d.tagGroups.push({ id: uid("g"), scopeRu: d.scopeRu || "", scopeEn: d.scopeEn || "", tags: [] });
    touch();
    render();
  }

  function addKit() {
    const d = device();
    const kit = normalizeDevice({
      id: uid("kit"),
      titleRu: "Гильза",
      titleEn: "Protective sleeve",
      introRu: "Технические характеристики гильзы представлены в таблице 1.",
      introEn: "Technical characteristics of the protective sleeve are presented in table 1.",
      columns: [{ name: "Значение" }],
      rows: [
        ["Тип", "Type"],
        ["Производитель", "Manufacturer"],
        ["Материал", "Material"],
        ["Тип резьбы к прибору", "Thread type for device"],
        ["Тип резьбы к процессу", "Thread type for the process"],
        ["Номинальное давление, МПа", "Nominal pressure, MPa"],
        ["Наружный диаметр D, мм", "Outer diameter D, mm"]
      ].map(([ru, en]) => ({ labelRu: ru, labelEn: en, cells: [{ span: 1, ru: "", en: "" }] }))
    }, 0);
    delete kit.no;
    delete kit.suffix;
    delete kit.kits;
    d.kits.push(kit);
    ui.kitId = kit.id;
    ui.rowId = null;
    ui.cellId = null;
    touch();
    render();
    const input = $('[data-model="titleRu"]', $("#editor"));
    if (input) { input.focus(); input.select(); }
  }

  function delKit() {
    const d = device();
    const kit = sheet();
    if (!d || !kit || kit === d) return;
    if (!confirm(`Удалить комплект «${kit.titleRu || "без названия"}»?`)) return;
    d.kits = d.kits.filter((k) => k.id !== kit.id);
    ui.kitId = null;
    ui.rowId = null;
    ui.cellId = null;
    touch();
    render();
  }

  function addTag(groupId) {
    const d = sheet();
    const g = d.tagGroups.find((x) => x.id === groupId);
    if (!g) return;
    g.tags.push("");
    touch();
    render();
    const inputs = $$(`input[data-group="${groupId}"][data-tag]`, $("#editor"));
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  /* ---------------- project / sheet ---------------- */

  function newDevice() {
    if (!requireRefEdit("добавить лист в эталон")) return;
    const p = project();
    const no = Math.max(0, ...p.devices.map((d) => d.no)) + 1;
    const d = normalizeDevice({
      id: uid("d"), no, suffix: "", titleRu: "Новый прибор", titleEn: "",
      scopeRu: "", scopeEn: "", introRu: "Технические характеристики датчика представлены в таблице 1.",
      introEn: "Technical characteristics of the transmitter are presented in table 1.",
      columns: [{ name: "Значение" }],
      rows: DEFAULT_ROWS.map(([ru, en]) => ({ labelRu: ru, labelEn: en, cells: [{ span: 1, ru: "", en: "" }] }))
    });
    p.devices.push(d);
    ui.deviceId = d.id;
    ui.kitId = null;
    ui.lang = readLang();
    touch();
    render();
    const input = $('input[data-model="titleRu"]', $("#editor"));
    if (input) { input.focus(); input.select(); }
  }

  function duplicateDevice() {
    if (!requireRefEdit("дублировать лист эталона")) return;
    const d = device();
    const p = project();
    const copy = clone(d);
    copy.no = Math.max(0, ...p.devices.map((x) => x.no)) + 1;
    copy.suffix = "";
    reidDevice(copy);
    copy.titleRu = `${d.titleRu} (копия)`;
    p.devices.splice(p.devices.indexOf(d) + 1, 0, copy);
    ui.deviceId = copy.id;
    touch();
    render();
    toast("Лист скопирован");
  }

  function deleteDevice() {
    if (!requireRefEdit("удалить лист эталона")) return;
    const d = device();
    const p = project();
    if (!confirm(`Удалить лист «${d.titleRu || d.titleEn || "№" + numberOf(d)}» из проекта «${p.name}»?`)) return;
    const i = p.devices.indexOf(d);
    p.devices.splice(i, 1);
    const next = p.devices[Math.min(i, p.devices.length - 1)];
    ui.deviceId = next ? next.id : null;
    ui.kitId = null;
    ui.rowId = null;
    ui.cellId = null;
    touch();
    render();
  }

  function addProject() {
    const name = prompt("Название проекта", `Проект ${state.projects.length + 1}`);
    if (name == null) return;
    const clean = name.trim();
    if (!clean) return;
    const p = { id: uid("p"), name: clean, devices: [] };
    state.projects.push(p);
    state.active = p.id;
    ui.deviceId = null;
    ui.lang = readLang();
    touch();
    render();
  }

  function renameProject() {
    const p = project();
    if (!requireRefEdit("переименовать эталон")) return;
    const name = prompt("Название проекта", p.name);
    if (name == null) return;
    const clean = name.trim();
    if (!clean) return;
    p.name = clean;
    touch();
    render();
  }

  function deleteProject() {
    if (state.projects.length <= 1) { toast("Нельзя удалить единственный проект", true); return; }
    const p = project();
    if (isReferenceProject(p)) { toast("Эталон «Все листы» удалить нельзя", true); return; }
    if (!confirm(`Удалить проект «${p.name}» со всеми листами?`)) return;
    state.projects = state.projects.filter((x) => x.id !== p.id);
    state.active = state.projects[0].id;
    ui.deviceId = project().devices[0]?.id || null;
    touch();
    render();
  }

  /* ---------------- reference dialog ---------------- */

  let refSelected = new Set();

  function refSource() {
    return state.projects.find((p) => p.id === REF_PROJECT_ID) || state.projects.find((p) => p.devices.length) || { devices: [] };
  }

  function refFiltered() {
    const input = $("#ref-search");
    const q = (input ? input.value : "").trim().toLowerCase();
    return (refSource().devices || []).filter((d) => !q || [d.no, d.titleRu, d.titleEn].join(" ").toLowerCase().includes(q));
  }

  function refTaken(d) {
    const p = project();
    return Boolean(p) && p.devices.some((x) => x.no === d.no);
  }

  function updateRefUI() {
    const count = $("#ref-count");
    if (count) count.textContent = refSelected.size ? `Выбрано: ${refSelected.size}` : "Ничего не выбрано";
    const apply = $("#ref-apply");
    if (apply) {
      apply.textContent = refSelected.size ? `Добавить выбранные (${refSelected.size})` : "Добавить выбранные";
      apply.disabled = refSelected.size === 0;
    }
  }

  function renderRefList() {
    const list = $("#ref-list");
    if (!list) return;
    const items = refFiltered();
    list.innerHTML = items.length
      ? items.map((d) => {
        const taken = refTaken(d);
        const on = refSelected.has(d.id);
        return `<label class="ref-item${on ? " sel" : ""}${taken ? " off" : ""}">
          <input type="checkbox" data-ref-id="${d.id}"${on ? " checked" : ""}${taken ? " disabled" : ""} aria-label="Лист №${esc(numberOf(d))}">
          <span class="sheet-no">№${esc(numberOf(d))}</span>
          <span><b>${esc(d.titleRu || d.titleEn)}</b><small>${esc(d.titleEn || "")} · ${d.rows.length} строк · ${d.columns.length} кол.</small></span>
          <span class="plus">${taken ? "уже в проекте" : "выбрать"}</span>
        </label>`;
      }).join("")
      : '<div class="empty-list">В эталоне ничего не найдено.</div>';
    updateRefUI();
  }

  function openRef() {
    if (isReference()) {
      toast("Откройте проект — эталонные листы добавляются в проект", true);
      return;
    }
    refSelected = new Set();
    const search = $("#ref-search");
    if (search) search.value = "";
    renderRefList();
    const dlg = $("#ref-dialog");
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
  }

  function addSelectedFromReference() {
    const p = project();
    if (!p) return;
    if (isReferenceProject(p)) {
      toast("Приборы уже в эталоне — добавьте их в проект", true);
      return;
    }
    const picked = (refSource().devices || []).filter((d) => refSelected.has(d.id) && !refTaken(d));
    if (!picked.length) {
      toast("Не выбрано ни одного листа", true);
      return;
    }
    let first = null;
    picked.forEach((src) => {
      const copy = clone(src);
      reidDevice(copy);
      p.devices.push(copy);
      if (!first) first = copy;
    });
    if (first) ui.deviceId = first.id;
    ui.kitId = null;
    ui.rowId = null;
    ui.cellId = null;
    ui.lang = readLang();
    refSelected = new Set();
    const dlg = $("#ref-dialog");
    if (dlg && typeof dlg.close === "function") dlg.close();
    touch();
    render();
    toast(`Добавлено листов: ${picked.length} — в проект «${p.name}»`);
  }

  /* ---------------- confirm ---------------- */

  let confirmWaiter = null;

  function askConfirm(opts) {
    const dlg = $("#confirm-dialog");
    if (!dlg) return Promise.resolve(window.confirm(opts.text || opts.title || "Подтвердить?"));
    $("#confirm-title").textContent = opts.title || "Подтверждение";
    $("#confirm-text").textContent = opts.text || "";
    $("#confirm-ok").textContent = opts.ok || "Подтвердить";
    return new Promise((resolve) => {
      confirmWaiter = resolve;
      if (typeof dlg.showModal === "function") dlg.showModal();
      else dlg.setAttribute("open", "");
    });
  }

  function settleConfirm(value) {
    const dlg = $("#confirm-dialog");
    if (dlg && dlg.hasAttribute("open") && typeof dlg.close === "function") dlg.close();
    else if (dlg) dlg.removeAttribute("open");
    const fn = confirmWaiter;
    confirmWaiter = null;
    if (fn) fn(value);
  }

  /* ---------------- toast ---------------- */

  function toast(text, isError) {
    const el = $("#toast");
    el.textContent = text;
    el.classList.toggle("err", Boolean(isError));
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  /* ---------------- export ---------------- */

  const imageDataCache = new Map();

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error("не удалось прочитать рисунок"));
      reader.readAsDataURL(blob);
    });
  }

  async function resolveFigureImages(snapshot) {
    const paths = new Set();
    const collect = (item) => {
      (item.figures || []).forEach((f) => { if (f.image && !/^data:/i.test(f.image)) paths.add(f.image); });
      (item.kits || []).forEach(collect);
    };
    (snapshot.projects || []).forEach((p) => (p.devices || []).forEach(collect));

    let failed = 0;
    await Promise.all(Array.from(paths).map(async (path) => {
      if (imageDataCache.has(path)) return;
      try {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        imageDataCache.set(path, await blobToDataUrl(await res.blob()));
      } catch (err) {
        failed += 1;
      }
    }));

    const apply = (item) => {
      (item.figures || []).forEach((f) => {
        if (f.image && !/^data:/i.test(f.image) && imageDataCache.has(f.image)) f.image = imageDataCache.get(f.image);
      });
      (item.kits || []).forEach(apply);
    };
    (snapshot.projects || []).forEach((p) => (p.devices || []).forEach(apply));
    return failed;
  }

  async function staleTabGuard() {
    let storedAt = 0;
    try { storedAt = Number(localStorage.getItem(STORE_AT) || 0); } catch (err) { return true; }
    if (!storedAt || storedAt <= stateAt + 1500) return true;
    return askConfirm({
      title: "В другом окне данные новее",
      text: "Похоже, листы правили в другой вкладке браузера позже, чем в этом окне. Здесь выгрузится старая копия — нажмите «Отмена» и обновите страницу (F5), если правки делали там.",
      ok: "Выгрузить эту копию"
    });
  }

  async function exportBook() {
    try {
      if (!(await staleTabGuard())) return;
      const snapshot = clone(state);
      const failed = await resolveFigureImages(snapshot);
      const result = window.DSXlsx.build(snapshot, { measure: textLines });
      if (!result || !result.blob) throw new Error("Не удалось собрать книгу");
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename || "Data_Sheet.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      if (failed) toast(`Excel собран, но ${failed} рисунков не загрузилось — нужен сайт или локальный сервер`, true);
      else toast(`Excel собран: ${result.sheets} лист(ов), ${result.pages} страниц`);
    } catch (err) {
      console.error(err);
      toast("Ошибка выгрузки: " + (err.message || err), true);
    }
  }

  /* ---------------- events ---------------- */

  function bind() {
    document.addEventListener("click", (e) => {
      const mergeBtn = e.target.closest("[data-merge-mode]");
      if (mergeBtn) { doMerge(mergeBtn.dataset.mergeMode); return; }
      const el = e.target.closest("[data-act]");
      if (!el) return;
      const act = el.dataset.act;
      if (act === "to-ref") { restoreToReference(); return; }
      if (act === "toggle-ref-edit") { toggleRefEdit(); return; }
      if (act === "forget-ref-key") { forgetRefKey(); return; }
      if (refLocked() && REF_LOCKED_ACTS.has(act)) {
        toast("Эталон защищён: включите «Редактировать эталон»", true);
        return;
      }
      if (act === "project") {
        if (state.active === el.dataset.id) return;
        state.active = el.dataset.id;
        const p = project();
        ui.deviceId = p.devices[0]?.id || null;
        ui.kitId = null;
        ui.rowId = null;
        ui.cellId = null;
        touch();
        render();
        return;
      }
      if (act === "lang") {
        ui.lang = el.dataset.lang;
        saveLang(ui.lang);
        ui.rowId = null;
        ui.cellId = null;
        render();
        return;
      }
      if (act === "sheet") { focusDevice(el.dataset.id); return; }
      if (act === "new-sheet") { newDevice(); return; }
      if (act === "dup-sheet") { duplicateDevice(); return; }
      if (act === "del-sheet") { deleteDevice(); return; }
      if (act === "project-add") { addProject(); return; }
      if (act === "project-del") { deleteProject(); return; }
      if (act === "project-rename") { renameProject(); return; }
      if (act === "ref-open") { openRef(); return; }
      if (act === "translate-page") { translatePage(); return; }
      if (act === "glossary") { openGlossary(); return; }
      if (act === "gloss-del") { deleteGlossPair(el.dataset.ru); return; }
      if (act === "kit") { ui.kitId = el.dataset.id || null; ui.rowId = null; ui.cellId = null; render(); return; }
      if (act === "add-kit") { addKit(); return; }
      if (act === "del-kit") { delKit(); return; }
      if (act === "add-row") { addRow(ui.rowId); return; }
      if (act === "del-row") { deleteRow(); return; }
      if (act === "row-up") { moveRow(-1); return; }
      if (act === "row-down") { moveRow(1); return; }
      if (act === "row-cols") { openColsMenu(el); return; }
      if (act === "merge-at") {
        const d = sheet();
        const row = d && d.rows.find((r) => r.id === ui.rowId);
        mergeAt(row, Number(el.dataset.i));
        return;
      }
      if (act === "add-fig") { addFigure(); return; }
      if (act === "del-fig") {
        const d = sheet();
        if (!confirm("Удалить рисунок?")) return;
        d.figures = d.figures.filter((f) => f.id !== el.dataset.id);
        touch(); render(); return;
      }
      if (act === "pick-image") { pickImage(el.dataset.id); return; }
      if (act === "add-mark") { addMark(); return; }
      if (act === "del-mark") {
        const d = sheet();
        d.markings = d.markings.filter((m) => m.id !== el.dataset.id);
        touch(); render(); return;
      }
      if (act === "add-group") { addGroup(); return; }
      if (act === "del-group") {
        const d = sheet();
        if (!confirm("Удалить область применения вместе с тегами?")) return;
        d.tagGroups = d.tagGroups.filter((g) => g.id !== el.dataset.id);
        touch(); render(); return;
      }
      if (act === "add-tag") { addTag(el.dataset.id); return; }
      if (act === "paste-tags") {
        tagTarget = el.dataset.id;
        const area = $("#tags-area");
        if (area) area.value = "";
        const dlg = $("#tags-dialog");
        if (dlg && typeof dlg.showModal === "function") dlg.showModal();
        else if (dlg) dlg.setAttribute("open", "");
        if (area) setTimeout(() => area.focus(), 30);
        return;
      }
      if (act === "del-tag") {
        const d = sheet();
        const g = d.tagGroups.find((x) => x.id === el.dataset.group);
        if (!g) return;
        g.tags.splice(Number(el.dataset.tag), 1);
        touch(); render(); return;
      }
    });

    document.addEventListener("dblclick", (e) => {
      const tab = e.target.closest(".project-tab");
      if (tab) { e.preventDefault(); renameProject(); }
    });

    document.addEventListener("change", (e) => {
      const el = e.target;
      if (el.id === "opt-auto") {
        autoOn = el.checked;
        writeFlag(AUTO_STORE, autoOn);
        const hint = $("#tr-hint");
        if (hint) hint.textContent = translateHint();
        return;
      }
      if (el.id === "opt-sync") {
        syncOn = el.checked;
        writeFlag(SYNC_STORE, syncOn);
        const hint = $("#tr-hint");
        if (hint) hint.textContent = translateHint();
      }
    });

    document.addEventListener("input", (e) => {
      const el = e.target;
      if (refLocked() && el.closest("#editor")) return;
      if (el.matches("[data-model]")) { applyModel(el); return; }
      if (el.matches("[data-edit]")) { applyEditable(el); return; }
      if (el.matches("[data-col]")) {
        const d = sheet();
        const i = Number(el.dataset.col);
        if (d.columns[i]) { d.columns[i].name = el.value; touch(); }
        return;
      }
      if (el.matches("[data-mark]")) {
        const d = sheet();
        const m = d.markings.find((x) => x.id === el.dataset.mark);
        if (m) { m[el.dataset.field] = el.value; touch(); }
        return;
      }
      if (el.matches("[data-fig]")) {
        const d = sheet();
        const f = d.figures.find((x) => x.id === el.dataset.fig);
        if (f) {
          const field = el.dataset.field;
          f[field] = el.value;
          const dst = { captionRu: "captionEn", noteRu: "noteEn" }[field];
          if (dst && syncOn) {
            f[dst] = toEnglish(el.value);
            const twin = $(`[data-fig="${f.id}"][data-field="${dst}"]`, $("#editor"));
            if (twin && document.activeElement !== twin) twin.value = f[dst];
          }
          touch();
        }
        return;
      }
      if (el.matches("[data-group]")) {
        const d = sheet();
        const g = d.tagGroups.find((x) => x.id === el.dataset.group);
        if (!g) return;
        if (el.dataset.tag != null) { g.tags[Number(el.dataset.tag)] = el.value; touch(); }
        else if (el.dataset.field) {
          const field = el.dataset.field;
          g[field] = el.value;
          const dst = { scopeRu: "scopeEn" }[field];
          if (dst && syncOn) {
            g[dst] = toEnglish(el.value);
            const twin = $(`[data-group="${g.id}"][data-field="${dst}"]`, $("#editor"));
            if (twin && document.activeElement !== twin) twin.value = g[dst];
          }
          touch();
        }
      }
    });

    document.addEventListener("focusin", (e) => {
      const el = e.target.closest("[data-edit]");
      if (el) focusFrom(el);
    });

    document.addEventListener("keydown", (e) => {
      const el = e.target.closest("[data-edit]");
      if (!el) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const row = el.closest(".tr");
        const next = row && row.nextElementSibling;
        const target = next && (el.dataset.edit === "label" ? next.querySelector(".td.label") : next.querySelector(`.vcell[data-col="${el.dataset.col}"]`));
        if (target) target.focus();
        else addRow(el.dataset.r);
      } else if (e.key === "Tab") {
        e.preventDefault();
        const all = $$("[data-edit]", $("#editor")).filter((x) => x.offsetParent !== null);
        const i = all.indexOf(el);
        const target = all[i + (e.shiftKey ? -1 : 1)];
        if (target) target.focus();
      }
    });

    document.addEventListener("paste", (e) => {
      const el = e.target.closest("[data-edit]");
      if (!el) return;
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text");
      document.execCommand("insertText", false, text);
    });

    $("#btn-export").addEventListener("click", exportBook);
    $("#btn-save-file").addEventListener("click", () => saveProjectFile(false));
    $("#btn-save-as").addEventListener("click", () => saveProjectFile(true));
    $("#btn-open-file").addEventListener("click", openProjectFile);
    $("#file-state").addEventListener("change", (e) => openStateFile(e.target.files && e.target.files[0]));
    document.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (String(e.key).toLowerCase() !== "s") return;
      e.preventDefault();
      saveProjectFile(false);
    });
    $("#btn-new-sheet").addEventListener("click", newDevice);    $("#btn-project-add").addEventListener("click", addProject);
    $("#btn-project-rename").addEventListener("click", renameProject);
    $("#btn-project-del").addEventListener("click", deleteProject);
    $("#btn-ref-add").addEventListener("click", openRef);
    $("#ref-search").addEventListener("input", renderRefList);
    $("#ref-all").addEventListener("click", () => {
      refFiltered().forEach((d) => { if (!refTaken(d)) refSelected.add(d.id); });
      renderRefList();
    });
    $("#ref-none").addEventListener("click", () => {
      refSelected = new Set();
      renderRefList();
    });
    $("#ref-apply").addEventListener("click", addSelectedFromReference);
    $("#ref-list").addEventListener("change", (e) => {
      const box = e.target.closest("input[data-ref-id]");
      if (!box) return;
      if (box.checked) refSelected.add(box.dataset.refId);
      else refSelected.delete(box.dataset.refId);
      const item = box.closest(".ref-item");
      if (item) item.classList.toggle("sel", box.checked);
      updateRefUI();
    });
    $("#file-image").addEventListener("change", (e) => handleImage(e.target.files && e.target.files[0]));
    $("#tags-apply").addEventListener("click", () => {
      const d = sheet();
      const g = d && d.tagGroups.find((x) => x.id === tagTarget);
      const area = $("#tags-area");
      if (!g || !area) return;
      const items = area.value
        .split(/\r?\n/)
        .flatMap((line) => line.split("\t"))
        .map((v) => v.trim())
        .filter((v) => v && !/^(тег|tag|tags)$/i.test(v));
      if (!items.length) { toast("Нет тегов для вставки", true); return; }
      g.tags.push(...items);
      tagTarget = null;
      const dlg = $("#tags-dialog");
      if (dlg && typeof dlg.close === "function") dlg.close();
      touch();
      render();
      toast(`Добавлено тегов: ${items.length}`);
    });
    $$("[data-close-dialog]").forEach((b) => b.addEventListener("click", () => {
      const dlg = b.closest("dialog");
      if (dlg && typeof dlg.close === "function") dlg.close();
    }));
    $("#confirm-ok").addEventListener("click", () => settleConfirm(true));
    $("#confirm-cancel").addEventListener("click", () => settleConfirm(false));
    const confirmDlg = $("#confirm-dialog");
    if (confirmDlg) confirmDlg.addEventListener("close", () => {
      const fn = confirmWaiter;
      confirmWaiter = null;
      if (fn) fn(false);
    });
    $("#gloss-search").addEventListener("input", renderGlossList);
    $("#gloss-add-btn").addEventListener("click", addGlossPair);
    ["gloss-ru", "gloss-en"].forEach((id) => {
      const input = $(`#${id}`);
      if (!input) return;
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        addGlossPair();
      });
    });
    $("#gloss-list").addEventListener("click", (e) => {
      if (e.target.closest('[data-act="gloss-del"]')) return;
      const row = e.target.closest(".gloss-row");
      if (!row) return;
      const ru = $("#gloss-ru");
      const en = $("#gloss-en");
      if (ru) ru.value = row.dataset.ru;
      if (en) en.value = row.dataset.en;
      glossError("");
      if (ru) { ru.focus(); ru.select(); }
    });
    $("#key-apply").addEventListener("click", verifyRefKey);
    const keyInput = $("#key-input");
    if (keyInput) keyInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); verifyRefKey(); }
    });
    $("#search").addEventListener("input", (e) => { ui.search = e.target.value; renderSidebar(); });
    window.addEventListener("beforeunload", saveNow);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") saveNow();
    });
  }

  /* ---------------- boot ---------------- */

  function boot() {
    const local = normalizeState(readLocal());
    storageMode = local ? "local" : "none";
    state = local || ensureReference(seedState());
    try { stateAt = Number(localStorage.getItem(STORE_AT) || 0) || Date.now(); } catch (err) { stateAt = Date.now(); }
    if (!state.projects.some((p) => p.id === state.active)) state.active = state.projects[0]?.id;
    ui.projectId = state.active;
    ui.deviceId = project()?.devices[0]?.id || null;
    if (window.DSTranslate) window.DSTranslate.setUser(readGloss());
    bind();
    render();
    setSave("saved", "Сохранено");
    renderFileLabel();
    loadFileHandle();
    askPersist();
    syncFromIdb();
  }

  boot();
})();
