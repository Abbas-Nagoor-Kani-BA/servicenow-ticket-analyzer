#!/usr/bin/env node
import { createStore } from "../lib/store.ts";
import { loadOnce, saveValue, removeValue, persistSlice } from "../lib/storage.ts";

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok ? "" : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}

console.log("== createStore ==");
const store = createStore({ count: 0, label: "x" });
check("initial state", store.getState(), { count: 0, label: "x" });
store.setState({ count: 1 });
check("object patch", store.getState().count, 1);
store.setState((s) => ({ count: s.count + 1 }));
check("function patch", store.getState().count, 2);
store.setState(null);
check("null patch ignored", store.getState().count, 2);

let seen = null;
const unsub = store.subscribe((s) => { seen = s.count; });
store.setState({ count: 5 });
check("subscriber notified", seen, 5);
unsub();
store.setState({ count: 6 });
check("unsub no longer notified", seen, 5);
check("use selector", store.use((s) => s.label), "x");

console.log("== persistSlice (mock storage) ==");
const fake = { store: {} };
globalThis.chrome = {
  storage: {
    local: {
      async set(obj) { Object.assign(fake.store, obj); },
      async get(keys) { const out = {}; for (const k of keys) if (k in fake.store) out[k] = fake.store[k]; return out; },
      async remove(keys) { for (const k of keys) delete fake.store[k]; }
    }
  }
};
const pstore = createStore({ theme: "dark", n: 1 });
const pp = persistSlice(pstore, "theme", "kTheme", 10);
pp.save();
await new Promise((r) => setTimeout(r, 25));
check("debounced save writes slice", fake.store.kTheme, "dark");
pstore.setState({ theme: "light" });
await new Promise((r) => setTimeout(r, 15));
pp.flush();
check("flush writes latest", fake.store.kTheme, "light");

console.log("== loadOnce ==");
check("reads stored value", await loadOnce("kTheme", "fallback"), "light");
check("falls back when missing", await loadOnce("noneKey", "fb"), "fb");

console.log("== saveValue/removeValue ==");
await saveValue("tmpA", 42);
check("saveValue writes", fake.store.tmpA, 42);
await removeValue("tmpA");
check("removeValue deletes", "tmpA" in fake.store, false);

delete globalThis.chrome;

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
