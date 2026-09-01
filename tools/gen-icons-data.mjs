import fs from "fs";
import path from "path";
const DIR = "lib/vendor/lucide";
const names = fs.readdirSync(DIR).filter(f => f.endsWith(".svg")).map(f => f.replace(/\.svg$/, "")).sort();
const out = {};
for (const n of names) {
  let s = fs.readFileSync(path.join(DIR, n + ".svg"), "utf8");
  // strip the license comment
  s = s.replace(/<!--[\s\S]*?-->/g, "").trim();
  // extract inner children (everything between the svg open and close tags)
  const inner = s.replace(/<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").trim();
  out[n] = inner;
}
const lines = [
  "/* Generated from lib/vendor/lucide/*.svg via tools/gen-icons-data.mjs. */",
  "/* Lucide icons — ISC license. Do not edit by hand; regenerate instead. */",
  "",
  "export const ICON_DATA: Record<string, string> = " + JSON.stringify(out, null, 2) + ";"
];
fs.writeFileSync("lib/icons-data.ts", lines.join("\n") + "\n");
console.log("wrote lib/icons-data.ts with", Object.keys(out).length, "icons");
