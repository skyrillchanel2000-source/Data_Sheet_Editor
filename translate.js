/* Офлайн-перевод RU → EN по словарю dict.js (пары из эталона + глоссарий).
   Движок адаптивный: одну и ту же фразу понимает с другими числами, падежами
   и окончаниями, а если точной пары нет — режет текст на куски и переводит
   те, что есть в словаре. Никаких внешних запросов: всё считается в браузере. */
(function () {
  "use strict";

  const CYR_RE = /[А-Яа-яЁё]/;
  const CYR_WORD_RE = /^[А-Яа-яЁё]+$/;
  const NUM_RE = /^\d+(?:[.,]\d+)?$/;
  const NUM_ALL_RE = /\d+(?:[.,]\d+)?/g;
  const TOKEN_RE = /[A-Za-zА-Яа-яЁё0-9°№%]+(?:[.,]\d+)?|\s+|[^\s]/g;

  /* Окончания, которые можно отрезать, чтобы найти слово в словаре.
     Длинные — первыми: «измеряемой» → измеряем, а не измеряемо. */
  const ENDINGS = [
    "иями", "ями", "ами", "ыми", "ими", "ого", "его", "ому", "ему", "ее", "ие",
    "ые", "ой", "ей", "ый", "ий", "ым", "им", "ом", "ем", "ых", "их", "ую", "юю",
    "ою", "ею", "ая", "яя", "ое", "ья", "ье", "ьи", "ов", "ев", "ия", "ии", "ию",
    "ью", "ах", "ях", "ам", "ям", "а", "я", "ы", "и", "е", "у", "ю", "о", "ь"
  ].sort((a, b) => b.length - a.length);

  function norm(text) {
    return String(text == null ? "" : text)
      .replace(/\u00a0/g, " ")
      .replace(/[‐‑‒–—−]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  /* Грубая основа слова: «датчика», «датчиком» → «датчик». */
  function stemWord(word) {
    const w = norm(word);
    if (w.length < 4) return w;
    for (let i = 0; i < ENDINGS.length; i += 1) {
      const end = ENDINGS[i];
      if (w.length - end.length >= 3 && w.endsWith(end)) return w.slice(0, -end.length);
    }
    return w;
  }

  /* Основа всей фразы: пробелы и знаки остаются, русские слова стригутся. */
  function stemPhrase(text) {
    const parts = norm(text).match(TOKEN_RE) || [];
    return parts.map((p) => (CYR_WORD_RE.test(p) ? stemWord(p) : p)).join("");
  }

  function escapeRe(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizePairs(source) {
    const out = {};
    Object.keys(source || {}).forEach((ru) => {
      const key = norm(ru);
      const value = String(source[ru] == null ? "" : source[ru]).replace(/\s+/g, " ").trim();
      if (key && value) out[key] = value;
    });
    return out;
  }

  const BASE = normalizePairs(window.DSDICT && window.DSDICT.pairs);
  let userPairs = {};

  /* ---------- индексы словаря ---------- */

  const NUMBERS = (text) => String(text).match(NUM_ALL_RE) || [];

  function splitSegments(text) {
    const src = String(text == null ? "" : text);
    const out = [];
    let start = 0;
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      if (ch !== "," && ch !== ";") continue;
      let prev = i - 1;
      while (prev >= start && /\s/.test(src[prev])) prev -= 1;
      let next = i + 1;
      while (next < src.length && /\s/.test(src[next])) next += 1;
      const prevDigit = prev >= start && /\d/.test(src[prev]);
      const nextDigit = next < src.length && /\d/.test(src[next]);
      if (prevDigit && nextDigit) continue;
      out.push(src.slice(start, i).trim());
      start = i + 1;
    }
    out.push(src.slice(start).trim());
    return out.filter((s) => s !== "");
  }

  function makeTemplate(ruKey, en) {
    if (!CYR_RE.test(ruKey) || !/\d/.test(ruKey)) return null;
    const enTpl = buildEnTemplate(en);
    const enSlots = (enTpl.match(/\u0000/g) || []).length;

    const toks = ruKey.match(TOKEN_RE) || [];
    const chunks = [];
    toks.forEach((tok) => {
      if (NUM_RE.test(tok)) { chunks.push({ kind: "num" }); return; }
      if (CYR_WORD_RE.test(tok)) {
        if (tok.length === 1 && /^[хия]$/.test(tok)) {
          let k = chunks.length - 1;
          while (k >= 0 && chunks[k].kind === "sep") k -= 1;
          if (k >= 0 && chunks[k].kind === "num") {
            chunks.length = k + 1;
            chunks.push({ kind: "connector" });
            return;
          }
        }
        chunks.push({ kind: "word", text: stemWord(tok) });
        return;
      }
      if (/[A-Za-z]/.test(tok)) { chunks.push({ kind: "latin", text: tok }); return; }
      chunks.push({ kind: "sep", text: tok });
    });

    const captures = chunks.filter((c) => c.kind === "num").length;
    if (!captures || captures !== enSlots) return null;

    const literal = chunks.filter((c) => c.kind !== "num" && c.kind !== "sep").map((c) => c.text || "").join("");
    if (literal.replace(/[^A-Za-zА-Яа-яЁё]/g, "").length < 4) return null;

    let pattern = "^";
    chunks.forEach((c) => {
      if (c.kind === "num") pattern += "(\\d+(?:[.,]\\d+)?)";
      else if (c.kind === "connector") pattern += "(?:[-\\s]*(?:х|и|я))?[-\\s]*";
      else if (c.kind === "word") pattern += escapeRe(c.text) + "[а-яё]*";
      else if (c.kind === "latin") pattern += escapeRe(c.text);
      else pattern += sepPattern(c.text);
    });
    pattern += "$";

    let re;
    try { re = new RegExp(pattern, "i"); } catch (err) { return null; }
    return { re, en: buildEnTemplate(en), weight: literal.length };
  }

  /* Английский шаблон: числа, стоящие отдельными словами, становятся
     подстановками, а числа внутри обозначений (Pt100, 316L) остаются как есть. */
  function buildEnTemplate(en) {
    const toks = String(en).match(TOKEN_RE) || [];
    let out = "";
    toks.forEach((tok) => {
      out += NUM_RE.test(tok) ? "\u0000" : tok;
    });
    return out;
  }

  function sepPattern(text) {
    const src = String(text);
    if (/^\s+$/.test(src)) return "\\s*";
    if (/^[-‐‑‒–—−]+$/.test(src)) return "[-\\s]*";
    let out = "";
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      if (/\s/.test(ch)) { out += "\\s*"; continue; }
      if (/[-‐‑‒–—−]/.test(ch)) { out += "[-\\s]*"; continue; }
      out += escapeRe(ch) + "\\s*";
    }
    return out;
  }

  function fillTemplate(en, nums) {
    let i = 0;
    return String(en).replace(/\u0000/g, () => (i < nums.length ? nums[i++] : ""));
  }

  function buildIndexes(pairs) {
    const exact = {};
    const stem = {};
    let templates = [];

    const addStem = (map, key, value) => {
      if (key && !(key in map)) map[key] = value;
    };

    Object.keys(pairs).forEach((ruKey) => {
      const en = pairs[ruKey];
      exact[ruKey] = en;
      addStem(stem, stemPhrase(ruKey), en);
      stem[ruKey] = en;

      const tpl = makeTemplate(ruKey, en);
      if (tpl) templates.push(tpl);

      const ruSegs = splitSegments(ruKey);
      const enSegs = splitSegments(en);
      if (ruSegs.length > 1 && ruSegs.length === enSegs.length) {
        for (let i = 0; i < ruSegs.length; i += 1) {
          const ruSeg = ruSegs[i];
          const enSeg = enSegs[i];
          if (!CYR_RE.test(ruSeg) || !enSeg) continue;
          const segTpl = makeTemplate(norm(ruSeg), enSeg);
          if (segTpl) templates.push(segTpl);
        }
      }
    });

    templates = templates.sort((a, b) => b.weight - a.weight);
    return { exact, stem, templates };
  }

  let INDEX = buildIndexes(BASE);

  function setUser(source) {
    userPairs = normalizePairs(source);
    INDEX = buildIndexes(Object.assign({}, BASE, userPairs));
  }

  /* ---------- поиск перевода ---------- */

  function lookupTemplate(text) {
    const key = norm(text);
    for (let i = 0; i < INDEX.templates.length; i += 1) {
      const t = INDEX.templates[i];
      const m = key.match(t.re);
      if (m) return fillTemplate(t.en, m.slice(1));
    }
    return "";
  }

  function lookupSpan(text) {
    const key = norm(text);
    if (INDEX.exact[key]) return INDEX.exact[key];
    const sk = stemPhrase(text);
    if (INDEX.stem[sk]) return INDEX.stem[sk];
    const tpl = lookupTemplate(text);
    if (tpl) return tpl;
    return "";
  }

  function translateLine(line, addMissing) {
    const src = String(line);
    if (!CYR_RE.test(src)) return src;

    const whole = lookupSpan(src);
    if (whole) return whole;

    const parts = src.match(TOKEN_RE) || [];
    const content = [];
    parts.forEach((p, idx) => { if (/[A-Za-zА-Яа-яЁё0-9]/.test(p)) content.push(idx); });

    let out = "";
    let cur = 0;
    let ci = 0;
    while (ci < content.length) {
      const startTok = content[ci];
      out += parts.slice(cur, startTok).join("");
      let hit = "";
      let nextCi = ci + 1;
      let nextTok = startTok + 1;
      const maxL = Math.min(12, content.length - ci);
      for (let len = maxL; len >= 1; len -= 1) {
        const endTok = content[ci + len - 1];
        const text = parts.slice(startTok, endTok + 1).join("");
        const found = lookupSpan(text);
        if (found) {
          hit = found;
          nextCi = ci + len;
          nextTok = endTok + 1;
          break;
        }
      }
      if (hit) {
        out += hit;
        ci = nextCi;
        cur = nextTok;
      } else {
        const word = parts[startTok];
        out += word;
        if (CYR_RE.test(word)) addMissing(word);
        ci += 1;
        cur = startTok + 1;
      }
    }
    out += parts.slice(cur).join("");
    return out;
  }

  function translate(text) {
    const src = String(text == null ? "" : text);
    if (!src.trim() || !CYR_RE.test(src)) return { text: src, missing: 0, words: [] };
    const words = [];
    const seen = new Set();
    const addMissing = (word) => {
      const key = norm(word);
      if (!key || seen.has(key)) return;
      seen.add(key);
      words.push(word);
    };
    const out = src.split("\n").map((line) => translateLine(line, addMissing)).join("\n");
    return { text: out, missing: words.length, words };
  }

  function phrase(text) {
    return INDEX.exact[norm(text)] || "";
  }

  window.DSTranslate = {
    translate,
    phrase,
    setUser,
    user: () => Object.assign({}, userPairs),
    base: () => BASE,
    size: () => Object.keys(INDEX.exact).length,
    templates: () => INDEX.templates.length,
    source: (window.DSDICT && window.DSDICT.source) || "",
    normKey: norm,
    stem: stemWord
  };
})();
