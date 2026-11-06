/* Data_Sheet_Editor — выгрузка книги Excel по правилам эталона.
   Своя сборка OOXML + ZIP (без внешних библиотек). */
(() => {
  "use strict";

  const COLS = { E: 5, F: 6, L: 12, M: 13, X: 24, Y: 25, Z: 26 };
  const ROWS_PER_PAGE = 60;
  const FRAME_ROWS = 58;
  const ROW_H = 15.75;
  const PX_PER_ROW = 21;
  const EMU = 9525;
  const AREA_W = 627;

  const S = {
    text: 1,
    center: 2,
    thinLeft: 3,
    thinCenter: 4,
    leftLine: 5,
    sign: 14,
    frameTop: 6,
    frameBottom: 7,
    frameLeft: 8,
    frameRight: 9,
    frameTopLeft: 10,
    frameTopRight: 11,
    frameBottomLeft: 12,
    frameBottomRight: 13,
    capBottom: 15,
    marking: 16,
    capBottomWrap: 17,
    capBottomCenter: 18
  };

  const BOTTOM_STYLE = (s) => {
    if (s === S.thinCenter) return S.capBottomCenter;
    if (s === S.center || s === S.marking) return S.capBottom;
    return S.capBottomWrap;
  };

  const colLetter = (n) => {
    let s = "";
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };

  const esc = (v) => String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
    .replace(/\r/g, "")
    .replace(/\n/g, "&#10;");

  const clean = (v) => String(v == null ? "" : v).replace(/\u00a0/g, " ").trim();
  const indent = (v) => `        ${clean(v)}`;

  function textLines(text, width) {
    if (typeof window !== "undefined" && window.DS && typeof window.DS.measure === "function") {
      return window.DS.measure(text, width);
    }
    const value = String(text == null ? "" : text);
    return Math.max(1, value.split("\n").reduce((n, p) => n + Math.max(1, Math.ceil(p.length / Math.max(8, width / 7.2))), 0));
  }

  function b64ToBytes(dataUrl) {
    const b64 = String(dataUrl || "").split(",")[1] || "";
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  function imageInfo(dataUrl) {
    const bytes = b64ToBytes(dataUrl);
    const type = /^data:image\/png/i.test(dataUrl) ? "png" : "jpeg";
    let w = 500;
    let h = 350;
    try {
      if (type === "png" && bytes[0] === 0x89) {
        w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
        h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
      } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        let i = 2;
        while (i < bytes.length - 9) {
          if (bytes[i] !== 0xff) { i += 1; continue; }
          const marker = bytes[i + 1];
          const len = (bytes[i + 2] << 8) | bytes[i + 3];
          if (marker >= 0xc0 && marker <= 0xc3) {
            h = (bytes[i + 5] << 8) | bytes[i + 6];
            w = (bytes[i + 7] << 8) | bytes[i + 8];
            break;
          }
          i += 2 + len;
        }
      }
    } catch (err) { /* ignore */ }
    return { bytes, type, w, h };
  }

  /* ---------------- zip ---------------- */

  let CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const u16 = (v) => [v & 255, (v >> 8) & 255];
    const u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255];

    files.forEach((f) => {
      const name = enc.encode(f.name);
      const data = f.data instanceof Uint8Array ? f.data : enc.encode(f.data);
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length);
      let p = 0;
      [0x50, 0x4b, 0x03, 0x04].forEach((b) => { local[p++] = b; });
      u16(20).forEach((b) => { local[p++] = b; });
      u16(0x0800).forEach((b) => { local[p++] = b; });
      u16(0).forEach((b) => { local[p++] = b; });
      u16(0).forEach((b) => { local[p++] = b; });
      u16(0x21).forEach((b) => { local[p++] = b; });
      u32(crc).forEach((b) => { local[p++] = b; });
      u32(data.length).forEach((b) => { local[p++] = b; });
      u32(data.length).forEach((b) => { local[p++] = b; });
      u16(name.length).forEach((b) => { local[p++] = b; });
      u16(0).forEach((b) => { local[p++] = b; });
      local.set(name, p);
      chunks.push(local, data);

      const c = new Uint8Array(46 + name.length);
      p = 0;
      [0x50, 0x4b, 0x01, 0x02].forEach((b) => { c[p++] = b; });
      u16(20).forEach((b) => { c[p++] = b; });
      u16(20).forEach((b) => { c[p++] = b; });
      u16(0x0800).forEach((b) => { c[p++] = b; });
      u16(0).forEach((b) => { c[p++] = b; });
      u16(0).forEach((b) => { c[p++] = b; });
      u16(0x21).forEach((b) => { c[p++] = b; });
      u32(crc).forEach((b) => { c[p++] = b; });
      u32(data.length).forEach((b) => { c[p++] = b; });
      u32(data.length).forEach((b) => { c[p++] = b; });
      u16(name.length).forEach((b) => { c[p++] = b; });
      u16(0).forEach((b) => { c[p++] = b; });
      u16(0).forEach((b) => { c[p++] = b; });
      u16(0).forEach((b) => { c[p++] = b; });
      u16(0).forEach((b) => { c[p++] = b; });
      u32(0).forEach((b) => { c[p++] = b; });
      u32(offset).forEach((b) => { c[p++] = b; });
      c.set(name, p);
      central.push(c);
      offset += local.length + data.length;
    });

    const centralSize = central.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22);
    let p = 0;
    [0x50, 0x4b, 0x05, 0x06].forEach((b) => { end[p++] = b; });
    u16(0).forEach((b) => { end[p++] = b; });
    u16(0).forEach((b) => { end[p++] = b; });
    u16(files.length).forEach((b) => { end[p++] = b; });
    u16(files.length).forEach((b) => { end[p++] = b; });
    u32(centralSize).forEach((b) => { end[p++] = b; });
    u32(offset).forEach((b) => { end[p++] = b; });
    u16(0).forEach((b) => { end[p++] = b; });

    const total = chunks.reduce((n, c) => n + c.length, 0) + centralSize + 22;
    const out = new Uint8Array(total);
    let at = 0;
    chunks.forEach((c) => { out.set(c, at); at += c.length; });
    central.forEach((c) => { out.set(c, at); at += c.length; });
    out.set(end, at);
    return out;
  }

  /* ---------------- doc ---------------- */

  class Doc {
    constructor() {
      this.cells = new Map();
      this.rows = new Map();
      this.merges = [];
      this.images = [];
      this.pageCount = 0;
      this.lastRow = 1;
    }

    key(r, c) { return `${r}:${c}`; }

    cell(r, c, v, s) {
      const k = this.key(r, c);
      const cur = this.cells.get(k) || { v: "", s: 0 };
      if (v !== undefined && v !== null && v !== "") cur.v = String(v);
      if (s) cur.s = s;
      this.cells.set(k, cur);
      if (r > this.lastRow) this.lastRow = r;
      return cur;
    }

    formula(r, c, expr, cached, s) {
      const cell = this.cell(r, c, cached, s);
      cell.f = expr;
      return cell;
    }

    styleRange(r1, c1, r2, c2, s) {
      for (let r = r1; r <= r2; r += 1) {
        for (let c = c1; c <= c2; c += 1) this.cell(r, c, "", s);
      }
    }

    merge(r1, c1, r2, c2, v, s) {
      this.merges.push(`${colLetter(c1)}${r1}:${colLetter(c2)}${r2}`);
      this.styleRange(r1, c1, r2, c2, s);
      if (v !== undefined && v !== null && v !== "") this.cell(r1, c1, v, s);
    }

    frame(pageTop) {
      const t = pageTop + 1;
      const b = pageTop + FRAME_ROWS;
      for (let c = COLS.E; c <= COLS.Y; c += 1) {
        let top = S.frameTop;
        let bottom = S.frameBottom;
        if (c === COLS.E) { top = S.frameTopLeft; bottom = S.frameBottomLeft; }
        if (c === COLS.Y) { top = S.frameTopRight; bottom = S.frameBottomRight; }
        this.cell(t, c, "", top);
        this.cell(b, c, "", bottom);
      }
      for (let r = t + 1; r < b; r += 1) {
        this.cell(r, COLS.E, "", S.frameLeft);
        this.cell(r, COLS.Y, "", S.frameRight);
      }
    }

    /* Повторно проставляет границы рамки после раскладки содержимого:
       содержимое, попавшее на строку нижней границы (подпись рисунка),
       иначе затирает medium собственным стилем. */
    protectFrame(pageTop) {
      const t = pageTop + 1;
      const b = pageTop + FRAME_ROWS;
      for (let c = COLS.E; c <= COLS.Y; c += 1) {
        let top = S.frameTop;
        let bottom = S.frameBottom;
        if (c === COLS.E) { top = S.frameTopLeft; bottom = S.frameBottomLeft; }
        if (c === COLS.Y) { top = S.frameTopRight; bottom = S.frameBottomRight; }
        const topCell = this.cells.get(this.key(t, c));
        if (!topCell || !String(topCell.v == null ? "" : topCell.v).trim()) this.cell(t, c, "", top);
        const cell = this.cells.get(this.key(b, c));
        const hasText = cell && String(cell.v == null ? "" : cell.v).trim();
        if (hasText && c !== COLS.E && c !== COLS.Y) {
          bottom = BOTTOM_STYLE(cell.s);
        }
        this.cell(b, c, "", bottom);
      }
      for (let r = t + 1; r < b; r += 1) {
        this.cell(r, COLS.E, "", S.frameLeft);
        this.cell(r, COLS.Y, "", S.frameRight);
      }
    }

    number(pageTop, text) {
      this.cell(pageTop, COLS.E, text, S.sign);
      this.rows.set(pageTop, 16.5);
    }

    newPage() {
      const top = 1 + ROWS_PER_PAGE * this.pageCount;
      this.pageCount += 1;
      this.frame(top);
      this.rows.set(top, ROW_H);
      return top;
    }

    addImage(im) {
      const info = imageInfo(im.dataUrl);
      this.images.push({
        row: im.row, col: im.col,
        xoff: im.xoff || 0, yoff: im.yoff || 0,
        cx: im.cx || 0, cy: im.cy || 0,
        to: im.to || null, rot: im.rot || 0,
        bytes: info.bytes, type: info.type
      });
    }
  }

  /* ---------------- layout ---------------- */

  const EMPTY_TEXT = (v) => String(v == null ? "" : v);

  function pageNumber(base, total, index) {
    const value = String(base || "1.1");
    return total <= 1 ? value : `${value}.${index + 1}`;
  }

  class SheetPage {
    constructor(doc, device, page, lang, num) {
      this.doc = doc;
      this.device = device;
      this.page = page || {};
      this.lang = lang;
      this.num = num;
      this.ru = lang === "ru";
      this.pages = [];
    }

    pick(ru, en) {
      const value = this.ru ? ru : (EMPTY_TEXT(en).trim() ? en : ru);
      return EMPTY_TEXT(value);
    }

    render() {
      const doc = this.doc;
      const page = this.page;
      const kind = page.kind || "main";
      const top = doc.newPage();
      this.pages.push(top);
      if (this.num) {
        doc.number(top, this.ru ? `Лист технических данных №${this.num}` : `Technical Data Sheet №${this.num}`);
      }

      const cols = Math.max(1, (page.columns || []).length || Number(page._ncols) || 1);
      const unit = 12 / cols;
      let row = top + (Number(page.lead) || 3);

      if (kind !== "figs") {
        const titleRow = row;
        const title = this.pick(page.titleRu, page.titleEn);
        if (title.trim()) doc.merge(row, COLS.F, row, COLS.X, title.trim(), S.center);
        row += 1;

        const scope = this.pick(page.scopeRu, page.scopeEn);
        if (scope.trim()) {
          doc.merge(row, COLS.F, row + 1, COLS.X, indent((this.ru ? "Область применения: " : "Application area: ") + scope), S.text);
          row += 2;
        }

        const intro = this.pick(page.introRu, page.introEn);
        if (intro.trim()) {
          doc.merge(row, COLS.F, row, COLS.X, indent(intro), S.leftLine);
          row += 1;
        }

        let name = this.pick(page.nameRu, page.nameEn);
        if (!name.trim()) {
          const tableTitle = this.pick(page.titleRu, page.titleEn).trim();
          name = kind === "kit"
            ? (this.ru ? "Таблица 1 – Технические характеристики гильзы" : "Table 1 - Technical characteristics of the protective sleeve")
            : (this.ru
              ? `Таблица 1 – Технические характеристики датчика ${tableTitle}`
              : `Table 1 - Technical characteristics of the transmitter ${tableTitle}`);
        }
        if (name.trim()) {
          const titleText = this.pick(page.titleRu, page.titleEn).trim();
          const tail = titleText && name.trim().endsWith(titleText) ? titleText : "";
          if (tail) {
            const prefix = name.trim().slice(0, name.trim().length - tail.length);
            for (let c = COLS.F; c <= COLS.X; c += 1) doc.cell(row, c, "", S.leftLine);
            doc.merge(row, COLS.F, row, COLS.X, "", S.leftLine);
            const literal = `        ${prefix}`;
            doc.formula(row, COLS.F, `"${literal.replace(/"/g, '""')}"&F${titleRow}`, indent(name), S.leftLine);
          } else {
            doc.merge(row, COLS.F, row, COLS.X, indent(name), S.leftLine);
          }
          row += 1;
        }

        const rows = page.rows || [];
        if (rows.length) {
          for (let c = COLS.F; c <= COLS.X; c += 1) doc.cell(row, c, "", S.thinCenter);
          doc.merge(row, COLS.F, row, COLS.L, this.ru ? "Параметр" : "Parameter", S.thinCenter);
          doc.merge(row, COLS.M, row, COLS.X, this.ru ? "Значение" : "Value", S.thinCenter);
          row += 1;

          rows.forEach((item) => {
            const span = Math.max(1, Number(item.rowSpan) || 1);
            const end = row + span - 1;
            for (let r = row; r <= end; r += 1) {
              for (let c = COLS.F; c <= COLS.X; c += 1) doc.cell(r, c, "", S.thinCenter);
            }
            const label = this.pick(item.labelRu, item.labelEn).trim();
            const sub = this.pick(item.subRu, item.subEn).trim();
            if (sub) {
              if (item.labelMerge !== false) doc.merge(row, COLS.F, end, COLS.F, label, S.thinLeft);
              else doc.cell(row, COLS.F, label, S.thinLeft);
              doc.merge(row, COLS.F + 1, end, COLS.L, sub, S.thinLeft);
            } else {
              doc.merge(row, COLS.F, end, COLS.L, label, S.thinLeft);
            }
            let at = 0;
            (item.cells || []).forEach((cell) => {
              const from = COLS.M + Math.round(at * unit);
              at += Math.max(1, Number(cell.span) || 1);
              const to = Math.min(COLS.X, COLS.M + Math.round(at * unit) - 1);
              doc.merge(row, from, end, Math.max(from, to), this.pick(cell.ru, cell.en).trim(), S.thinCenter);
            });
            row = end + 1;
          });
        }
      }

      const figs = page.figures || [];
      if (figs.length) {
        if (kind !== "figs") row += 1;
        figs.forEach((fig) => {
          const note = this.pick(fig.noteRu, fig.noteEn);
          const noteRows = Math.max(0, Number(fig.noteRows) || 0);
          if (note.trim() && noteRows) {
            doc.merge(row, COLS.F, row + noteRows - 1, COLS.X, indent(note), S.text);
          }
          row += noteRows;

          const cellRows = Math.max(1, Number(fig.cellRows) || 1);
          doc.merge(row, COLS.F, row + cellRows - 1, COLS.X, "", S.center);
          const geom = fig.geom || {};
          if (fig.image) {
            const natural = imageInfo(fig.image);
            const blockH = cellRows * PX_PER_ROW;
            const maxH = Math.max(PX_PER_ROW, blockH - PX_PER_ROW);
            let w = Math.min(natural.w || 500, 620);
            let h = (natural.h || 350) * (w / (natural.w || 500));
            if (h > maxH) {
              h = maxH;
              w = (natural.w || 500) * (h / (natural.h || 350));
            }
            const xoffPx = Math.max(0, (AREA_W - w) / 2);
            doc.addImage({
              dataUrl: fig.image,
              row,
              col: COLS.F,
              xoff: Math.round(xoffPx * EMU),
              yoff: 0,
              cx: Math.round(w * EMU),
              cy: Math.round(h * EMU),
              to: null,
              rot: 0
            });
          }
          row += cellRows;

          const cap = this.pick(fig.captionRu, fig.captionEn);
          if (cap.trim()) {
            doc.merge(row, COLS.F, row, COLS.X, cap.trim(), S.center);
            doc.rows.set(row, 16.5);
            row += 1;
          }
        });
      }

      doc.protectFrame(top);
      return this.pages;
    }
  }

  /* ---------------- tags page ---------------- */

  function tagsPage(doc, device) {
    const marks = device.markings || [];
    const groups = device.tagGroups || [];
    const texts = (list) => (Array.isArray(list) ? list : []).map((t) => String(t == null ? "" : t).trim());
    const count = Math.max(marks.length, groups.length);

    const top = doc.newPage();
    doc.number(top, `TAG №${device.no}`);
    if (!count) { doc.protectFrame(top); return; }
    let row = top + 3;
    const bottom = top + FRAME_ROWS;

    for (let i = 0; i < count; i += 1) {
      const mark = marks[i] || {};
      const group = groups[i] || {};
      const code = clean(mark.code || "");
      const scopeRu = clean(group.scopeRu || mark.note || "");
      const scopeEn = clean(group.scopeEn || "");
      const scope = scopeRu && scopeEn ? `${scopeRu} /\n${scopeEn}` : (scopeRu || scopeEn);
      const ownTags = texts(group.tags);
      const refTags = texts(mark.tags);
      const tags = ownTags.some(Boolean) ? ownTags : refTags;
      const rows = tags.length || Math.max(0, Number(mark.rows) || 0) || (code ? 22 : 0);
      if (!code && !scope && !rows) continue;
      const need = (code ? 2 : 0) + 3 + rows;
      if (row + need - 1 > bottom) break;
      if (code) {
        doc.merge(row, COLS.F, row + 1, COLS.X, code, S.marking);
        row += 2;
      }
      for (let r = row; r <= row + 2; r += 1) {
        for (let c = COLS.F; c <= 22; c += 1) doc.cell(r, c, "", S.thinCenter);
      }
      doc.merge(row, COLS.F, row + 2, COLS.F, "№", S.thinCenter);
      doc.merge(row, 7, row + 2, 22, scope, S.thinCenter);
      row += 3;
      for (let i2 = 0; i2 < rows; i2 += 1) {
        for (let c = COLS.F; c <= 22; c += 1) doc.cell(row, c, "", S.thinCenter);
        doc.cell(row, COLS.F, String(i2 + 1), S.thinCenter);
        doc.merge(row, 7, row, 22, tags[i2] || "", S.thinCenter);
        row += 1;
      }
    }
    doc.protectFrame(top);
  }

  /* ---------------- xml ---------------- */

  function borderXML(left, right, top, bottom) {
    const side = (name, style) => (style ? `<${name} style="${style}"><color auto="1"/></${name}>` : `<${name}/>`);
    return `<border>${side("left", left)}${side("right", right)}${side("top", top)}${side("bottom", bottom)}<diagonal/></border>`;
  }

  function stylesXML() {
    const borders = [
      borderXML("", "", "", ""),
      borderXML("thin", "thin", "thin", "thin"),
      borderXML("", "", "medium", ""),
      borderXML("", "", "", "medium"),
      borderXML("medium", "", "", ""),
      borderXML("", "medium", "", ""),
      borderXML("medium", "", "medium", ""),
      borderXML("", "medium", "medium", ""),
      borderXML("medium", "", "", "medium"),
      borderXML("", "medium", "", "medium")
    ].join("");

    const xf = (font, border, align, extra = "") => `<xf numFmtId="0" fontId="${font}" fillId="0" borderId="${border}" applyFont="1" applyBorder="1" applyAlignment="1" xfId="0"><alignment ${align}/></xf>`;
    const para = 'horizontal="left" wrapText="1"';
    const line = 'horizontal="left" wrapText="0"';
    const centre = 'horizontal="center" wrapText="0"';
    const centreWrap = 'horizontal="center" wrapText="1"';
    const empty = 'vertical="center"';

    const xfs = [
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
      xf(1, 0, para),
      xf(1, 0, centre),
      xf(1, 1, para),
      xf(1, 1, centreWrap),
      xf(1, 0, line),
      xf(1, 2, empty),
      xf(1, 3, empty),
      xf(1, 4, empty),
      xf(1, 5, empty),
      xf(1, 6, empty),
      xf(1, 7, empty),
      xf(1, 8, empty),
      xf(1, 9, empty),
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1" xfId="0"/>',
      xf(1, 3, centre),
      xf(1, 0, centreWrap),
      xf(1, 3, para),
      xf(1, 3, centreWrap)
    ].join("");

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><sz val="12"/><name val="Times New Roman"/><family val="1"/><charset val="204"/></font>
</fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="10">${borders}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="19">${xfs}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  }

  function sheetXML(doc, index, drawing) {
    const byRow = new Map();
    doc.cells.forEach((cell, key) => {
      const [r, c] = key.split(":").map(Number);
      if (!byRow.has(r)) byRow.set(r, []);
      byRow.get(r).push({ c, cell });
    });

    const rows = [];
    for (let r = 1; r <= doc.lastRow; r += 1) {
      const h = doc.rows.get(r) || ROW_H;
      const list = (byRow.get(r) || []).sort((a, b) => a.c - b.c).map(({ c, cell }) => {
        const ref = `${colLetter(c)}${r}`;
        if (cell.f) return `<c r="${ref}" s="${cell.s}" t="str"><f>${esc(cell.f)}</f><v>${esc(cell.v)}</v></c>`;
        if (!cell.v) return `<c r="${ref}" s="${cell.s}"/>`;
        return `<c r="${ref}" s="${cell.s}" t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`;
      }).join("");
      rows.push(`<row r="${r}" ht="${h}" customHeight="1">${list}</row>`);
    }

    const merges = doc.merges.length
      ? `<mergeCells count="${doc.merges.length}">${doc.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
      : "";

    const breaks = [];
    for (let r = ROWS_PER_PAGE; r < doc.lastRow; r += ROWS_PER_PAGE) breaks.push(r);
    const rowBreaks = breaks.length
      ? `<rowBreaks count="${breaks.length}" manualBreakCount="${breaks.length}">${breaks.map((r) => `<brk id="${r}" max="25" man="1"/>`).join("")}</rowBreaks>`
      : "";
    const colBreaks = `<colBreaks count="1" manualBreakCount="1"><brk id="26" max="${doc.lastRow}" man="1"/></colBreaks>`;
    const draw = drawing ? '<drawing r:id="rId1"/>' : "";

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr/>
<dimension ref="A1:Z${doc.lastRow}"/>
<sheetViews><sheetView${index === 0 ? ' tabSelected="1"' : ""} view="pageBreakPreview" workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15.75"/>
<cols>
<col min="1" max="4" width="3.140625" customWidth="1"/>
<col min="5" max="25" width="4.7109375" customWidth="1"/>
<col min="26" max="26" width="3" customWidth="1"/>
</cols>
<sheetData>${rows.join("")}</sheetData>
${merges}
<printOptions horizontalCentered="0" verticalCentered="0"/>
<pageMargins left="0" right="0" top="0" bottom="0" header="0" footer="0"/>
<pageSetup paperSize="9" scale="89" pageOrder="overThenDown" orientation="portrait" horizontalDpi="300" verticalDpi="300"/>
${rowBreaks}
${colBreaks}
${draw}
</worksheet>`;
  }

  function drawingXML(doc) {
    const anchor = (im) => {
      const rot = im.rot ? ` rot="${Math.round(im.rot)}"` : "";
      const from = `<xdr:from><xdr:col>${im.col - 1}</xdr:col><xdr:colOff>${im.xoff}</xdr:colOff><xdr:row>${im.row - 1}</xdr:row><xdr:rowOff>${im.yoff}</xdr:rowOff></xdr:from>`;
      const ext = im.cx && im.cy ? `<a:ext cx="${im.cx}" cy="${im.cy}"/>` : "";
      const spPr = `<xdr:spPr><a:xfrm${rot}><a:off x="0" y="0"/>${ext}</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>`;
      const pic = `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${doc.images.indexOf(im) + 1}" name="Picture ${doc.images.indexOf(im) + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${doc.images.indexOf(im) + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>${spPr}</xdr:pic><xdr:clientData/>`;
      if (im.to && im.to.length === 4) {
        const to = `<xdr:to><xdr:col>${(im.col - 1) + im.to[1]}</xdr:col><xdr:colOff>${im.to[2]}</xdr:colOff><xdr:row>${(im.row - 1) + im.to[0]}</xdr:row><xdr:rowOff>${im.to[3]}</xdr:rowOff></xdr:to>`;
        return `<xdr:twoCellAnchor editAs="oneCell">${from}${to}${pic}</xdr:twoCellAnchor>`;
      }
      return `<xdr:oneCellAnchor>${from}<xdr:ext cx="${im.cx}" cy="${im.cy}"/>${pic}</xdr:oneCellAnchor>`;
    };

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${doc.images.map(anchor).join("")}
</xdr:wsDr>`;
  }

  /* ---------------- build ---------------- */

  function build(state, opts = {}) {
    const projects = (state.projects || []).filter((p) => (p.devices || []).length);
    if (!projects.length) throw new Error("В книге нет ни одного листа");

    const sheets = [];
    projects.forEach((project) => {
      const doc = new Doc();
      project.devices.forEach((device) => {
        const base = String(device.no);
        const legacyMain = { kind: device.kind || "main", lead: device.lead, titleRu: device.titleRu, titleEn: device.titleEn, scopeRu: device.scopeRu, scopeEn: device.scopeEn, introRu: device.introRu, introEn: device.introEn, nameRu: device.nameRu, nameEn: device.nameEn, columns: device.columns, rows: device.rows, figures: device.figures };
        const main = (device.pages && device.pages[0]) || legacyMain;
        const extras = (device.kits && device.kits.length) ? device.kits : (device.pages || []).slice(1);
        const pages = [main].concat(extras);

        const total = pages.length;
        pages.forEach((page, i) => {
          new SheetPage(doc, device, page, "ru", pageNumber(base, total, i)).render();
        });
        pages.forEach((page, i) => {
          new SheetPage(doc, device, page, "en", pageNumber(base, total, i)).render();
        });
        tagsPage(doc, device);
      });
      sheets.push({ name: safeName(project.name), doc });
    });

    const files = [];
    const images = [];
    let mediaCount = 0;
    let drawingCount = 0;

    sheets.forEach((sheet, i) => {
      if (sheet.doc.images.length) {
        sheet.drawing = ++drawingCount;
        sheet.doc.images.forEach((im) => {
          mediaCount += 1;
          im.media = mediaCount;
          images.push(im);
        });
      }
      files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXML(sheet.doc, i, Boolean(sheet.doc.images.length)) });
    });

    files.push({ name: "[Content_Types].xml", data: contentTypes(sheets, mediaCount) });
    files.push({ name: "_rels/.rels", data: rootRels() });
    files.push({ name: "xl/workbook.xml", data: workbookXML(sheets) });
    files.push({ name: "xl/_rels/workbook.xml.rels", data: workbookRels(sheets.length) });
    files.push({ name: "xl/styles.xml", data: stylesXML() });

    sheets.forEach((sheet, i) => {
      if (!sheet.doc.images.length) return;
      files.push({
        name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${sheet.drawing}.xml"/></Relationships>`
      });
      files.push({ name: `xl/drawings/drawing${sheet.drawing}.xml`, data: drawingXML(sheet.doc) });
      files.push({
        name: `xl/drawings/_rels/drawing${sheet.drawing}.xml.rels`,
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheet.doc.images.map((im) => `<Relationship Id="rId${sheet.doc.images.indexOf(im) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${im.media}.${im.type}"/>`).join("")}</Relationships>`
      });
    });

    images.forEach((im) => files.push({ name: `xl/media/image${im.media}.${im.type}`, data: im.bytes }));

    const data = zip(files);
    const totalPages = sheets.reduce((n, s) => n + s.doc.pageCount, 0);
    const name = `Data_Sheet_${safeName(projects[0].name)}.xlsx`;
    const blob = new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    return { data, blob, filename: name, sheets: sheets.length, pages: totalPages };
  }

  function contentTypes(sheets, mediaCount) {
    const exts = new Set();
    sheets.forEach((s) => s.doc.images.forEach((im) => exts.add(im.type)));
    const defaults = Array.from(exts).map((x) => `<Default Extension="${x}" ContentType="image/${x === "png" ? "png" : "jpeg"}"/>`).join("");
    const overrides = sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
    const drawings = sheets.filter((s) => s.doc.images.length).map((s) => `<Override PartName="/xl/drawings/drawing${s.drawing}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${defaults}
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${overrides}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${drawings}
</Types>`;
  }

  function rootRels() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  }

  function workbookXML(sheets) {
    const list = sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
    const names = sheets.map((s, i) => {
      const nm = s.name.replace(/'/g, "''");
      return `<definedName name="_xlnm.Print_Area" localSheetId="${i}">'${esc(nm)}'!$A$1:$Z$${s.doc.lastRow}</definedName>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<workbookPr/>
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets>${list}</sheets>
<definedNames>${names}</definedNames>
<calcPr calcId="0" fullCalcOnLoad="1"/>
</workbook>`;
  }

  function workbookRels(count) {
    const list = [];
    for (let i = 0; i < count; i += 1) list.push(`<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`);
    list.push(`<Relationship Id="rId${count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.join("")}</Relationships>`;
  }

  function safeName(name) {
    return String(name || "Листы").replace(/[\\/*?:[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Листы";
  }

  window.DSXlsx = { build };
})();
