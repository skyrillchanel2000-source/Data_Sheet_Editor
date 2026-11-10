const fs = require("fs");
const path = require("path");

global.window = {};
global.atob = (s) => Buffer.from(s, "base64").toString("binary");
global.Blob = class Blob {
  constructor(parts) { this.parts = parts; }
};

const base = path.resolve(__dirname, "..");
require(path.join(base, "seed.js"));

window.DS = {
  measure(text, width) {
    const value = String(text == null ? "" : text);
    return Math.max(1, value.split("\n").reduce((n, p) => n + Math.max(1, Math.ceil(p.length / Math.max(8, width / 7.2))), 0));
  }
};

require(path.join(base, "xlsx.js"));

const state = JSON.parse(JSON.stringify(window.DS_SEED));
const project = process.argv[2] || "p-all";
if (project !== "p-all") {
  state.projects = state.projects.filter((p) => p.id === project);
  state.active = project;
}
const result = window.DSXlsx.build(state);
const out = process.argv[3] || path.join(base, "test-out.xlsx");
fs.writeFileSync(out, Buffer.from(result.data));
console.log(JSON.stringify({ out, sheets: result.sheets, pages: result.pages, bytes: result.data.length }));
