/* Проверка расчёта высоты строк таблицы и вёрстки страницы.

   - показывает, где посчитанная высота расходится с полем rowSpan из данных;
   - повторяет раскладку выгрузки (таблица, подводка, рисунок, подпись) и
     предупреждает, если содержимое выходит за рамку страницы (строка 58).

   multitool-node tools\test_rows.cjs
*/
const fs = require("fs");
const path = require("path");

global.window = {};
global.atob = (s) => Buffer.from(s, "base64").toString("binary");
global.Blob = class Blob {
  constructor(parts) { this.parts = parts; }
};

const base = path.resolve(__dirname, "..");
require(path.join(base, "seed.js"));
require(path.join(base, "metrics.js"));
require(path.join(base, "xlsx.js"));

const { autoRowSpan } = window.DSXlsx;
const seed = JSON.parse(JSON.stringify(window.DS_SEED));
const FRAME_BOTTOM = 58;
const CELL_PAD = 0;
const AREA_W = 627;

const lines = [];
const diffs = [];
const warns = [];
let totalStored = 0;
let totalCalc = 0;

const textLines = (text, width) => window.DSFont.lines(text, width);

/* Раскладка одной страницы — как в SheetPage.render, в относительных строках. */
function layout(page, ru) {
  const kind = page.kind || "main";
  const cols = Math.max(1, (page.columns || []).length || 1);
  let row = Number(page.lead) || 3;
  let tableRows = 0;
  const pick = (a, b) => {
    const first = String(a || "").trim();
    const second = String(b || "").trim();
    return ru ? (first || second) : (second || first);
  };

  if (kind !== "figs") {
    if (pick(page.titleRu, page.titleEn)) row += 1;
    const scope = pick(page.scopeRu, page.scopeEn);
    if (scope) {
      const text = `        ${ru ? "Область применения: " : "Application area: "}${scope}`;
      row += Math.max(2, textLines(text, AREA_W));
    }
    if (pick(page.introRu, page.introEn)) row += 1;
    if (pick(page.nameRu, page.nameEn)) row += 1;
    const rows = page.rows || [];
    if (rows.length) {
      row += 1; // шапка таблицы
      rows.forEach((item) => {
        const need = autoRowSpan(item, cols, ru);
        tableRows += need;
        row += need;
      });
    }
  }

  const figs = page.figures || [];
  if (figs.length) {
    if (kind !== "figs") row += 1;
    figs.forEach((fig) => {
      const note = pick(fig.noteRu, fig.noteEn);
      let noteRows = Math.max(0, Number(fig.noteRows) || 0);
      if (note) noteRows = Math.max(noteRows, textLines(`        ${note}`, AREA_W));
      row += noteRows;
      let cellRows = Math.max(0, Number(fig.cellRows) || 0) || 3;
      const cap = pick(fig.captionRu, fig.captionEn);
      const room = FRAME_BOTTOM - row - (cap ? 1 : 0);
      if (room >= 2 && cellRows > room) cellRows = room;
      row += Math.max(1, cellRows);
      if (cap) row += 1;
    });
  }
  return { end: row, tableRows };
}

seed.projects.forEach((project) => {
  project.devices.forEach((device) => {
    (device.pages || []).forEach((page, pi) => {
      const cols = Math.max(1, (page.columns || []).length || 1);
      (page.rows || []).forEach((item) => {
        const ru = autoRowSpan(item, cols, true);
        const en = autoRowSpan(item, cols, false);
        const was = Math.max(1, Number(item.rowSpan) || 1);
        totalStored += was;
        totalCalc += Math.max(ru, en);
        if (Math.max(ru, en) !== was) {
          diffs.push(`№${device.no} ${String(page.id || pi).padEnd(6)} «${String(item.labelRu || item.labelEn).slice(0, 44)}» rowSpan ${was} → ${Math.max(ru, en)} (RU ${ru}, EN ${en})`);
        }
      });
      ["ru", "en"].forEach((lang) => {
        const { end } = layout(page, lang === "ru");
        if (end > FRAME_BOTTOM) {
          warns.push(`! №${device.no} ${page.id || pi} ${lang.toUpperCase()}: содержимое до строки ${end}, рамка до ${FRAME_BOTTOM}`);
        }
      });
    });
  });
});

console.log(warns.join("\n"));
if (warns.length) console.log("");
console.log(diffs.join("\n"));
console.log(`\nстрок таблиц: было ${totalStored}, посчитано ${totalCalc}; расхождений ${diffs.length}; предупреждений ${warns.length}`);
