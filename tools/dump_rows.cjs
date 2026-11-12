/* Выгрузка всех случаев «текст + ширина» для сверки с живым Excel.

   Пишет tools/_rows_cases.json: для каждой строки каждой страницы — подпись
   (F:L или F + G:L) и значения (своя объединённая ячейка M:X), посчитанное
   число строк и ширина в пикселях. Проверка: tools\check_rows_excel.ps1.

   multitool-node tools\dump_rows.cjs
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

const COL_PX = 33;
const COLS_F = 6;
const COLS_L = 12;
const COLS_M = 13;
const COLS_X = 24;
const FONT = window.DSFont;

const seed = JSON.parse(JSON.stringify(window.DS_SEED));
const cases = [];

function push(kind, text, width, need, tag) {
  const value = String(text || "").trim();
  if (!value) return;
  cases.push({ kind, text: value, width, need, tag });
}

seed.projects.forEach((project) => {
  project.devices.forEach((device) => {
    (device.pages || []).forEach((page) => {
      const cols = Math.max(1, (page.columns || []).length || 1);
      const unit = 12 / cols;
      (page.rows || []).forEach((item) => {
        const tag = `№${device.no} ${page.id} ${String(item.labelRu || "").slice(0, 24)}`;
        const labelW = (COLS_L - COLS_F + 1) * COL_PX;
        const subW = (COLS_L - COLS_F) * COL_PX;
        const labelRu = String(item.labelRu || "").trim();
        const labelEn = String(item.labelEn || "").trim();
        const subRu = String(item.subRu || "").trim();
        const subEn = String(item.subEn || "").trim();
        if (subRu || subEn) {
          push("label", labelRu, COL_PX, FONT.lines(labelRu, COL_PX * 1.02), tag);
          push("label", labelEn, COL_PX, FONT.lines(labelEn, COL_PX * 1.02), tag);
          push("sub", subRu, subW, FONT.lines(subRu, subW * 1.02), tag);
          push("sub", subEn, subW, FONT.lines(subEn, subW * 1.02), tag);
        } else {
          push("label", labelRu, labelW, FONT.lines(labelRu, labelW * 1.02), tag);
          push("label", labelEn, labelW, FONT.lines(labelEn, labelW * 1.02), tag);
        }
        let at = 0;
        (item.cells || []).forEach((cell) => {
          const from = Math.round(at * unit);
          at += Math.max(1, Number(cell.span) || 1);
          const to = Math.round(at * unit);
          const width = Math.max(COL_PX, (to - from) * COL_PX);
          push("value", cell.ru, width, FONT.lines(cell.ru, width * 1.02), tag);
          push("value", cell.en, width, FONT.lines(cell.en, width * 1.02), tag);
        });
      });
    });
  });
});

const out = path.join(__dirname, "_rows_cases.json");
fs.writeFileSync(out, JSON.stringify(cases, null, 1), "utf8");
console.log(`${cases.length} случаев → ${out}`);
