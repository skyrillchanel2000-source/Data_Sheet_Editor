/* Data_Sheet_Editor — ширины символов Times New Roman 12 pt (16 px).
   Файл собран автоматически: python tools\make_metrics.py
   Нужен, чтобы число строк в ячейке считалось по реальной ширине текста. */
(function (root) {
  "use strict";
  const DATA = {"font":"times.ttf","size":16,"scale":64,"space":256,"ranges":[{"from":32,"to":126,"w":"1001401c02002003403000c01401402002401001401001002002002002002002002002002002001001002402402401c03c03002c02c03002802403003001401803002803803003002403002c02402803003003c03003002801401001402002001401c02001c02001c01402002001001002001003002002002002001401801002002003002002001c02000c0200240"},{"from":160,"to":255,"w":"1001402002002002000c02001403001002002401403002001802401401401402401c01401401401402003003003001c03003003003003003003802c02802802802801401401401403003003003003003003002403003003003003003002402001c01c01c01c01c01c02c01c01c01c01c01c0100100100100200200200200200200200240200200200200200200200200"},{"from":1024,"to":1119,"w":"2802803002402c02401401401803803803002c03002c03003002402c02402c02803802003003002c02c03803003003002402c02802c03403003002804004002c03802402c04002c01c02002001c02001c02c01802402402002002802402002402001c01c02002802002402003003002002c01c01c03001c01c01c02001c01c0180100100100300300200200240200240"},{"from":1168,"to":1169,"w":"1c0180"},{"from":8208,"to":8213,"w":"140140200200400400"},{"from":8216,"to":8222,"w":"1401401401401c01c01c0"},{"from":8224,"to":8230,"w":"2002001801801402c0400"},{"from":8240,"to":8240,"w":"400"},{"from":8242,"to":8243,"w":"1001c0"},{"from":8249,"to":8250,"w":"140140"},{"from":8304,"to":8313,"w":"1400c0300300140140140140140140"},{"from":8320,"to":8329,"w":"140140140140140140140140140140"},{"from":8364,"to":8364,"w":"200"},{"from":8470,"to":8470,"w":"3c0"},{"from":8482,"to":8482,"w":"400"},{"from":8592,"to":8595,"w":"400200400200"},{"from":8722,"to":8722,"w":"240"},{"from":8804,"to":8805,"w":"240240"},{"from":8800,"to":8800,"w":"240"},{"from":216,"to":216,"w":"300"},{"from":937,"to":937,"w":"300"},{"from":956,"to":956,"w":"240"}]};
  const SCALE = DATA.scale;
  const SPACE = DATA.space / SCALE;
  const W = new Float32Array(0x3000).fill(-1);
  DATA.ranges.forEach((r) => {
    for (let code = r.from; code <= r.to; code += 1) {
      const i = (code - r.from) * 3;
      W[code] = parseInt(r.w.slice(i, i + 3), 16) / SCALE;
    }
  });

  function charWidth(ch) {
    const code = ch.codePointAt(0);
    const w = code < W.length ? W[code] : -1;
    return w > 0 ? w : SPACE;
  }

  /* Ширина строки в px. Табуляция и NBSP считаются как пробел. */
  function measure(text) {
    const value = String(text == null ? "" : text).replace(/[\t\u00a0]/g, " ");
    let total = 0;
    for (const ch of value) total += charWidth(ch);
    return total;
  }

  /* Перенос по словам, как в Excel: пробелы (в том числе красная строка из
     восьми пробелов) занимают место в строке, пробел на месте переноса — нет,
     слово длиннее строки рвётся по символам. Пустой абзац — одна строка.

     Допуска нет (было 2 %): он разрешал строке быть шире ячейки, и Excel,
     который меряет текст чуть иначе, переносил её позже — на листе строка
     вылезала за границу и «не влезала». Теперь строка обязана влезть в ширину
     ячейки, поэтому такие места получают лишнюю строку высоты. */
  const TOLERANCE = 1;
  function wrapLines(text, widthPx) {
    const width = Math.max(8, Number(widthPx) || 8) * TOLERANCE;
    const value = String(text == null ? "" : text).replace(/\r/g, "");
    let total = 0;
    value.split("\n").forEach((paragraph) => {
      let lines = 1;
      let used = 0;    // занято на текущей строке
      let spaces = 0;  // пробелы после последнего слова
      let word = "";

      /* Поставить слово: если не влезает — перенос перед ним, пробелы на
         месте переноса не учитываются; слово шире строки рвётся по символам.
         Если на строке пока ничего нет (первое слово и без отступа), строка
         не тратится: слово начинает её и рвётся по символам. */
      const put = (text) => {
        let rest = text;
        let w = measure(rest);
        if (used + spaces + w <= width) {
          used += spaces + w;
          spaces = 0;
          return;
        }
        if (used || spaces) lines += 1;
        used = 0;
        spaces = 0;
        while (w > width) {
          let cut = 0;
          let acc = 0;
          for (const ch of rest) {
            const cw = charWidth(ch);
            if (acc + cw > width) break;
            acc += cw;
            cut += ch.length;
          }
          if (!cut) break;
          rest = rest.slice(cut);
          w = measure(rest);
          if (rest) { lines += 1; used = 0; }
        }
        used = w;
      };

      for (const ch of paragraph) {
        if (ch === " " || ch === "\t" || ch === "\u00a0") {
          if (word) { put(word); word = ""; }
          spaces += SPACE;
        } else {
          word += ch;
        }
      }
      if (word) put(word);
      total += lines;
    });
    return Math.max(1, total);
  }

  root.DSFont = { measure, lines: wrapLines, space: SPACE };
})(typeof window !== "undefined" ? window : globalThis);
