import fs from "fs";
import path from "path";
import esbuild from "esbuild";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.join(ROOT, "dist");
const WATCH = process.argv.includes("--watch");
const MINIFY = process.argv.includes("--minify");

const ENTRIES = [
  "background.js",
  "viewer/js/viewer.js",
  "panel/panel.js",
  "settings/settings.js",
  "content/content.js"
].map(p => path.join(ROOT, p));

const STATIC_COPY = [
  "manifest.json",
  "viewer/viewer.html",
  "panel/panel.html",
  "panel/panel.css",
  "settings/settings.html",
  "styles/base.css",
  ["lib/vendor/fflate.min.js", "lib/vendor/fflate.min.js"]
];

function copyStatic() {
  for (const entry of STATIC_COPY) {
    const [relFrom, relTo] = Array.isArray(entry) ? entry : [entry, entry];
    const from = path.join(ROOT, relFrom);
    const to = path.join(DIST, relTo);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

function copyDirRel(rel) {
  const from = path.join(ROOT, rel);
  if (!fs.existsSync(from)) return;
  cpRecursive(from, path.join(DIST, rel));
}
function cpRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    e.isDirectory() ? cpRecursive(s, d) : fs.copyFileSync(s, d);
  }
}

if (path.resolve(DIST) === path.resolve(ROOT)) {
  console.error("refusing to build into repo root");
  process.exit(1);
}
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const result = await esbuild.build({
  entryPoints: ENTRIES,
  outdir: DIST,
  outbase: ROOT,
  allowOverwrite: true,
  bundle: true,
  splitting: false,
  format: "esm",
  platform: "browser",
  target: ["chrome120"],
  minify: MINIFY,
  sourcemap: false,
  logLevel: "silent",
  legalComments: "none"
});

copyStatic();
copyDirRel("icons");

const walk = dir => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push({ file: path.relative(DIST, p), size: fs.statSync(p).size });
  }
  return out;
};
const manifest = JSON.parse(fs.readFileSync(path.join(DIST, "manifest.json"), "utf8"));
const required = [
  manifest.background.service_worker,
  ...manifest.content_scripts?.flatMap(cs => cs.js) || [],
  manifest.action?.default_popup,
  manifest.options_page
].filter(Boolean);

const missing = required.filter(rel => !fs.existsSync(path.join(DIST, rel)));
if (missing.length) {
  console.error("BUILD INCOMPLETE — missing:", missing.join(", "));
  process.exit(1);
}

const files = walk(DIST);
const kb = (files.reduce((s, f) => s + f.size, 0) / 1024).toFixed(1);
console.log(`dist built: ${files.length} files, ${kb} KB${MINIFY ? " (minified)" : ""}`);
for (const f of files.sort((a, b) => a.file.localeCompare(b.file)))
  console.log("  ", f.file, `(${f.size} B)`);

if (WATCH) {
  console.log("watching for changes…");
  const ctx = await esbuild.context({
    entryPoints: ENTRIES, outdir: ROOT, outbase: ROOT, bundle: true,
    splitting: false, format: "esm", platform: "browser",
    target: ["chrome120"], minify: false, logLevel: "silent"
  });
  await ctx.watch();
}
