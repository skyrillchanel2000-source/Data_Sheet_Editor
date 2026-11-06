/* Офлайн-перевод RU → EN по словарю dict.js (пары из эталона + глоссарий).
   Никаких внешних запросов: всё считается в браузере. */
(function () {
  "use strict";

  const CYR_RE = /[А-Яа-яЁё]/;
  const PART_RE = /[А-Яа-яЁёA-Za-z0-9°№%]+(?:[.,][0-9]+)?|\s+|[^\sА-Яа-яЁёA-Za-z0-9]+/g;
  const hasLetters = (part) => /^[А-Яа-яЁёA-Za-z]/.test(part);

  function normKey(text) {
    return String(text == null ? "" : text).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function normalizePairs(source) {
    const out = {};
    Object.keys(source || {}).forEach((ru) => {
      const key = normKey(ru);
      const value = String(source[ru] == null ? "" : source[ru]).replace(/\s+/g, " ").trim();
      if (key && value) out[key] = value;
    });
    return out;
  }

  const BASE = normalizePairs(window.DSDICT && window.DSDICT.pairs);
  let userPairs = {};
  let DICT = Object.assign({}, BASE);

  function setUser(source) {
    userPairs = normalizePairs(source);
    DICT = Object.assign({}, BASE, userPairs);
  }

  function translateLine(line, countMissing) {
    const whole = DICT[normKey(line)];
    if (whole) return whole;
    const parts = line.match(PART_RE) || [];
    let out = "";
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (!hasLetters(part) || !CYR_RE.test(part)) { out += part; continue; }
      let hit = "";
      let used = 0;
      for (let n = Math.min(5, 1 + Math.floor((parts.length - i - 1) / 2)); n >= 1; n -= 1) {
        const slice = parts.slice(i, i + n * 2 - 1);
        if (slice.length !== n * 2 - 1) break;
        const words = slice.filter((p, idx) => idx % 2 === 0);
        const gaps = slice.filter((p, idx) => idx % 2 === 1);
        if (words.length !== n || !gaps.every((gap) => /^\s+$/.test(gap))) break;
        const found = DICT[normKey(words.join(" "))];
        if (found) { hit = found; used = slice.length; break; }
      }
      if (hit) {
        out += hit;
        i += used - 1;
      } else {
        out += part;
        countMissing(1);
      }
    }
    return out;
  }

  function translate(text) {
    const src = String(text == null ? "" : text);
    if (!src.trim() || !CYR_RE.test(src)) return { text: src, missing: 0 };
    let missing = 0;
    const out = src.split("\n").map((line) => translateLine(line, (n) => { missing += n; })).join("\n");
    return { text: out, missing };
  }

  function phrase(text) {
    return DICT[normKey(text)] || "";
  }

  window.DSTranslate = {
    translate,
    phrase,
    setUser,
    user: () => Object.assign({}, userPairs),
    base: () => BASE,
    size: () => Object.keys(DICT).length,
    source: (window.DSDICT && window.DSDICT.source) || "",
    normKey
  };
})();
