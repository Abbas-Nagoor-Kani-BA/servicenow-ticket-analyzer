import fs from "fs";
import path from "path";
import esbuild from "esbuild";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const WATCH = process.argv.includes("--watch");
const MINIFY = process.argv.includes("--minify");

/*
 * `npm run build` emits a release bundle to dist/.
 * `npm run watch` emits an unminified, unbundled-equivalent build to dev/ for
 * "load unpacked" development, and rebuilds on change.
 *
 * Watch must never write into ROOT: the entries are also the sources, so
 * bundling to ROOT would overwrite panel/panel.js et al with their own output.
 */
const OUT = WATCH ? path.join(ROOT, "dev") : path.join(ROOT, "dist");

const ENTRIES = [
  "platform/background.ts",
  "surfaces/viewer/index.ts",
  "panel/panel.ts",
  "settings/settings.ts",
  "content/content.js",
  "worker/classifier-worker.ts"
].map(p => path.join(ROOT, p));

const STATIC_COPY = [
  "manifest.json",
  "viewer/viewer.html",
  "panel/panel.html",
  "settings/settings.html",
  "styles/output.css",
  ["lib/vendor/fflate.min.js", "lib/vendor/fflate.min.js"],
  ["node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm", "worker/ml-wasm/ort-wasm-simd-threaded.asyncify.wasm"],
  ["node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs", "worker/ml-wasm/ort-wasm-simd-threaded.asyncify.mjs"]
];

function copyStatic(outDir) {
  for (const entry of STATIC_COPY) {
    const [relFrom, relTo] = Array.isArray(entry) ? entry : [entry, entry];
    const from = path.join(ROOT, relFrom);
    const to = path.join(outDir, relTo);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

function copyDirRel(rel, outDir) {
  const from = path.join(ROOT, rel);
  if (!fs.existsSync(from)) return;
  cpRecursive(from, path.join(outDir, rel));
}

function cpRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    e.isDirectory() ? cpRecursive(s, d) : fs.copyFileSync(s, d);
  }
}

/** Re-copies HTML/CSS/icons after every rebuild so dev/ stays loadable. */
const copyPlugin = {
  name: "copy-static",
  setup(build) {
    build.onEnd(() => {
      copyStatic(OUT);
      copyDirRel("icons", OUT);
    });
  }
};

const OPTIONS = {
  entryPoints: ENTRIES,
  outdir: OUT,
  outbase: ROOT,
  allowOverwrite: true,
  bundle: true,
  splitting: false,
  format: "esm",
  platform: "browser",
  target: ["chrome120"],
  minify: MINIFY,
  sourcemap: WATCH ? "inline" : false,
  logLevel: "silent",
  legalComments: "none",
  plugins: [copyPlugin]
};

if (path.resolve(OUT) === path.resolve(ROOT)) {
  console.error("refusing to build into repo root");
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

if (WATCH) {
  const ctx = await esbuild.context(OPTIONS);
  await ctx.watch();
  console.log(`watching for changes… -> ${path.relative(ROOT, OUT)}/`);
  console.log("load this folder unpacked at chrome://extensions");
} else {
  await esbuild.build(OPTIONS);

  const walk = dir => {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else out.push({ file: path.relative(OUT, p), size: fs.statSync(p).size });
    }
    return out;
  };

  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  const required = [
    manifest.background.service_worker,
    ...manifest.content_scripts?.flatMap(cs => cs.js) || [],
    manifest.action?.default_popup,
    manifest.options_page
  ].filter(Boolean);

  const missing = required.filter(rel => !fs.existsSync(path.join(OUT, rel)));
  if (missing.length) {
    console.error("BUILD INCOMPLETE — missing:", missing.join(", "));
    process.exit(1);
  }

  const files = walk(OUT);
  const kb = (files.reduce((s, f) => s + f.size, 0) / 1024).toFixed(1);
  console.log(`${path.relative(ROOT, OUT)} built: ${files.length} files, ${kb} KB${MINIFY ? " (minified)" : ""}`);
  for (const f of files.sort((a, b) => a.file.localeCompare(b.file)))
    console.log("  ", f.file, `(${f.size} B)`);
}
