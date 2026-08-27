import fs from "fs";
import path from "path";
import fflate from "../lib/vendor/fflate.cjs";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.join(ROOT, "..", "dist");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "..", "package.json"), "utf8"));

if (!fs.existsSync(DIST)) {
  console.error("dist/ missing — run `npm run build` first");
  process.exit(1);
}

const files = {};
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files[path.relative(DIST, p).split(path.sep).join("/")] = new Uint8Array(fs.readFileSync(p));
  }
})(DIST);

const zipped = fflate.zipSync(files, { level: 9 });
const outName = `${pkg.name}-${pkg.version}.zip`;
const outPath = path.join(ROOT, "..", outName);
fs.writeFileSync(outPath, Buffer.from(zipped));
console.log(`${outName}: ${(zipped.length / 1024).toFixed(1)} KB, ${Object.keys(files).length} files`);
