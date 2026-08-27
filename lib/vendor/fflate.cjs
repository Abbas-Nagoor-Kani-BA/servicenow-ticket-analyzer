const fs = require("fs");
const path = require("path");
const vm = require("vm");

const code = fs.readFileSync(path.join(__dirname, "fflate.min.js"), "utf8");
const shimModule = { exports: {} };
const fn = new Function("module", "exports", "define", code);
fn(shimModule, shimModule.exports, undefined);

module.exports = shimModule.exports;
