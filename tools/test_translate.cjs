const fs = require("fs");
const path = require("path");

const dir = path.resolve(__dirname, "..");
global.window = {};
eval(fs.readFileSync(path.join(dir, "dict.js"), "utf8"));
eval(fs.readFileSync(path.join(dir, "translate.js"), "utf8"));

const T = window.DSTranslate;

const cases = [
  ["4-х проводная, Pt100", "4-wire, Pt100"],
  ["2-х проводная, Pt100", "2-wire, Pt100"],
  ["3-х проводная, Pt100", "3-wire, Pt100"],
  ["3-х проводная, pt100", "3-wire, Pt100"],
  ["3-проводная, Pt100", "3-wire, Pt100"],
  ["3-х проводной, Pt100", "3-wire, Pt100"],
  ["5-и проводная, Pt100", "5-wire, Pt100"],
  ["3-х проводная, Pt1000", "3-wire, Pt1000"],
  ["мембрана 316L", "Diaphragm 316L"],
  ["Монтажная длина штока L, мм", "Probe mounting length L, mm"],
  ["Температура измеряемой среды", "Temperature of the measured medium"],
  ["температуры измеряемой среды", "Temperature of the measured medium"],
  ["Диапазон измерения, °С", "Measurement range, °С"],
  ["диапазона измерения, °С", "Measurement range, °С"],
  ["Отсутствует", "Not available"],
  ["отсутствуют", "Not available"],
  ["Технические характеристики датчика представлены в таблице 1.", "Technical characteristics of the transmitter are presented in table 1."],
  ["Технические характеристики датчика представлены в таблице 2.", "Technical characteristics of the transmitter are presented in table 2."],
  ["Номинальное давление, МПа", "Nominal pressure, MPa"],
  ["номинального давления, МПа", "Nominal pressure, MPa"],
  ["Класс точности", "Accuracy class"],
  ["Класс точности 0,5", "Accuracy class 0,5"],
  ["М20х1,5 наружная резьба", "M20x1.5 external thread"],
  ["м20х1,5 наружной резьбы", "M20x1.5 external thread"],
  ["3-х проводная, Pt100, длина 2 м", "3-wire, Pt100, Length 2 m"],
  ["погрешность измерения относительной влажности", "Relative humidity measurement accuracy"],
  ["Материал корпуса — нержавеющая сталь", "Housing material — Stainless steel"],
  ["", ""],
  ["Pt100", "Pt100"],
  ["EMIS-BAR 143", "EMIS-BAR 143"]
];

let failed = 0;
cases.forEach(([ru, expect]) => {
  const got = T.translate(ru);
  const ok = expect === null ? true : got.text === expect;
  if (!ok) failed += 1;
  console.log(`${ok ? "OK  " : "FAIL"}  ${JSON.stringify(ru)}`);
  if (!ok) {
    console.log(`      ожидалось: ${JSON.stringify(expect)}`);
    console.log(`      получено : ${JSON.stringify(got.text)}  (без перевода: ${JSON.stringify(got.words)})`);
  }
});

const show = [
  "3-х проводная, Pt100",
  "Термопреобразователь сопротивления ТСПТ-101, 3-х проводная, Pt100",
  "Класс точности 0,5, степень защиты IP65",
  "Схема подключения 2-х проводная, Pt1000"
];
console.log("\nПримеры:");
show.forEach((s) => {
  const r = T.translate(s);
  console.log(`${s}\n  → ${r.text}${r.words.length ? `   [нет перевода: ${r.words.join(", ")}]` : ""}`);
});

console.log(`\nПар в словаре: ${T.size()}, шаблонов: ${T.templates()}`);
if (failed) {
  console.error(`\nПровалено: ${failed}`);
  process.exit(1);
}
console.log("Все проверки пройдены");
