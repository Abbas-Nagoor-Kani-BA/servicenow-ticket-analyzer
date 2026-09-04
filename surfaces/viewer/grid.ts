import { detectSnOffsetMs, rowOffsetMs } from "../../core/sntime.ts";
import { STORAGE } from "../../lib/keys.ts";
import { MSG } from "../../lib/keys.ts";
import { broadcast } from "../../lib/storage.ts";
import { pad2 } from "../../lib/format.ts";
import { showToast } from "../../lib/toast.ts";
import { normalizeNames } from "../../core/names.ts";
import { computeAttention } from "../../core/attention.ts";
import { $, columnOptionList, migrateLegacyResolutions, setColumnVisible, setStatus, visibleCols } from "./core.ts";
import type { ViewerData, ViewerRow } from "./core.ts";
import type { InstantFn } from "./core.ts";
import { DataGrid } from "../../components/data-grid.ts";
import type { DataGridState } from "../../components/data-grid.ts";
import { currentRows, hasDataRows, parseLocalInput } from "./grid-data.ts";
import { dataStore, getColWidths, getMsrLists, saveColWidths, setColWidths, setSelfPush } from "./store.ts";
import { attachSummaryToData, renderSummary, setRowsProvider } from "./summary.ts";
import { ExtractService } from "../../services/extract-service.ts";
import { classifyRows, classificationListsFp, hasValidRootCause, hasValidSolutionType } from "./classify.ts";
import type { ClassifyStats } from "./classify.ts";
import { MlModelStore, modelById, modelByRepoId } from "../../data/ml-model-repository.ts";
import { getCalclensMode } from "./calclens-state.ts";
import { isHighlightEnabled, loadHighlightPrefs } from "./calclens-highlights.ts";

const extract = new ExtractService();

let classifying = false;
let lastClassifiedFingerprint = "";

function st() { return dataStore.getState(); }

type SelHooks = {
  highlight: () => void;
  clearUndo: () => void;
  restorePending: () => void;
  ensureDefault: () => void;
};

let selHooks: SelHooks = {
  highlight: () => {},
  clearUndo: () => {},
  restorePending: () => {},
  ensureDefault: () => {}
};

function setSelectionHooks(h: Partial<SelHooks>) { selHooks = { ...selHooks, ...h }; }

let onCellFocus: (info: { sysId: string; key: string } | null) => void = () => {};
function setOnCellFocus(fn: (info: { sysId: string; key: string } | null) => void) { onCellFocus = fn; }
function reportCellFocus(info: { sysId: string; key: string } | null) { onCellFocus(info); }

function load(d: ViewerData | null | undefined) {
  selHooks.clearUndo();
  const data = d && Array.isArray(d.rows) ? d : null;
  dataStore.setState({ data, sortKey: null, sortDir: 1, snOffsetMs: data ? detectSnOffsetMs(data.rows) : 0 });
  let migrated = 0;
  if (data) {
    autoParse();
    migrated = migrateLegacyResolutions(data.rows);
    if (migrated) persistEdits();
    classifyGrid();
  }
  if (!data || !data.rows.length) {
    $("wrap").classList.add("hidden");
    const toolbar = document.querySelector<HTMLElement>(".toolbar");
    if (toolbar) toolbar.classList.add("hidden");
    $("tabs").classList.add("hidden");
    $("summaryWrap").classList.add("hidden");
    $("empty").classList.remove("hidden");
    return;
  }
  $("tabs").classList.remove("hidden");
  if (data.debug && data.debug.ticketsWithAudit === 0) {
    const warn = document.createElement("div");
    warn.style.cssText = "padding:6px 18px;color:#fab387;font-size:12px;";
    warn.textContent =
      "No timeline events found for any pulled ticket. Common causes: (1) the activity feed returned nothing - open a ticket's form in this instance's tab and check its Activity section renders field changes; (2) tickets were never updated through the platform; (3) list_history.do is blocked on this release. Timeline columns stay empty without feed events.";
    $("tabs").before(warn);
  }
  render();
  selHooks.restorePending();
  selHooks.ensureDefault();
  if (attachSummaryToData(data)) scheduleSave();
  renderSummary();
}

function formatWallClock(d: Date): string {
  return `${pad2(d.getUTCDate())}-${pad2(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

const fmtInstant: InstantFn = (utcIso, row) => {
  if (!utcIso) return "";
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return String(utcIso);
  const offsetMs = rowOffsetMs(row, st().snOffsetMs);
  const local = new Date(d.getTime() + offsetMs);
  return formatWallClock(local);
};

let grid: DataGrid | null = null;

// Lazily-loaded Calclens attention context (Settings teamMembers + queues),
// cached once so gridState() stays synchronous.
let attentionTeam: string[] = [];
let attentionGroups: string[] = [];
let attentionLoaded = false;

function loadAttentionCtx(): void {
  chrome.storage.local.get(STORAGE.pluginSettings).then((res: Record<string, unknown>) => {
    const defaults = (res?.[STORAGE.pluginSettings] as any)?.defaults;
    attentionTeam = normalizeNames(defaults?.teamMembers || []);
    attentionGroups = normalizeNames(defaults?.queues || []);
    attentionLoaded = true;
  }).catch(() => { attentionLoaded = true; });
}

function attentionCtx(): { teamMembers: string[]; groupScope: string[] } {
  if (!attentionLoaded) loadAttentionCtx();
  return { teamMembers: attentionTeam, groupScope: attentionGroups };
}

export function initGrid() {
  setRowsProvider(() => currentRows());
  // Load persisted Calclens highlight toggles, then re-render so any disabled
  // rule stops painting its mark without waiting for the next state change.
  loadHighlightPrefs().then(() => render()).catch(() => undefined);
  grid = new DataGrid($("wrap"), {}, {
    table: $("tbl"),
    count: $("count"),
    slaBar: $("slaBar"),
    fmtInstant: fmtInstant as InstantFn,
    legendEnabled: () => getCalclensMode(),
    columnOptions: (key: string, row: ViewerRow) => columnOptionList(key, row),
    onSort: (key) => {
      const { sortKey, sortDir } = st();
      if (sortKey === key) dataStore.setState({ sortDir: -sortDir });
      else dataStore.setState({ sortKey: key, sortDir: 1 });
      render();
    },
    onSortExplicit: (key, dir) => {
      dataStore.setState({ sortKey: key, sortDir: dir });
      render();
    },
    onHideColumn: (key) => {
      if (!setColumnVisible(key, false)) {
        setStatus("At least one column must stay visible", true);
        return;
      }
      render();
    },
    onCellFocus: (info) => onCellFocus(info),
    onWidthsChange: (widths) => {
      setColWidths(widths);
      saveColWidths();
    },
    afterRender: () => {
      selHooks.highlight();
      renderSummary();
      currentModelLabel().then(writeModelLabel).catch(() => undefined);
    }
  });
}

function gridState(rows: ViewerRow[]): DataGridState {
  const { data, sortKey, sortDir } = st();
  const state: DataGridState = {
    cols: visibleCols() as DataGridState["cols"],
    rows,
    total: data ? data.rows.length : 0,
    sortKey,
    sortDir,
    colWidths: getColWidths(),
    // Always present so the Component.setState spread ({...prev, ...state})
    // drops the previous resolver when Calclens is turned off.
    attention: undefined,
    enabledAttention: undefined
  };
  if (getCalclensMode()) {
    const { teamMembers, groupScope } = attentionCtx();
    state.attention = (row) => computeAttention(row, { teamMembers, groupScope });
    state.enabledAttention = (id) => isHighlightEnabled(id);
  }
  return state;
}

/** Rebuilds only the header. render() does this too; this is for callers that
 *  change column visibility and then render separately. */
function buildHead() {
  if (grid) grid.refreshHead(getColWidths());
}

function resetColWidths() {
  setColWidths({});
  saveColWidths();
  render();
}

function render() {
  if (grid) grid.render(gridState(currentRows()));
}

function scheduleSave() {
  const t = st().saveTimer;
  if (t !== null) clearTimeout(t);
  dataStore.setState({ saveTimer: setTimeout(saveData, 350) });
}

async function saveData() {
  const { data, saveTimer } = st();
  if (saveTimer !== null) { clearTimeout(saveTimer); dataStore.setState({ saveTimer: null }); }
  if (!data) return;
  attachSummaryToData(data);
  setSelfPush(true);
  await chrome.storage.local.set({ [STORAGE.lastData]: data });
  setTimeout(() => setSelfPush(false), 300);
  renderSummary();
}

async function persistEdits() {
  const { data } = st();
  if (!data) return;
  attachSummaryToData(data);
  setSelfPush(true);
  try {
    await chrome.storage.local.set({ [STORAGE.lastData]: data });
  } catch (err) {
    setStatus(`Save failed: ${(err as Error).message}`, true);
  }
  setTimeout(() => setSelfPush(false), 300);
  renderSummary();
}

function getData(): ViewerData | null {
  return st().data;
}

function getTotalRows(): number {
  const data = st().data;
  return data ? data.rows.length : 0;
}

function findRowBySysId(sysId: unknown): ViewerRow | undefined {
  const data = st().data;
  return data ? data.rows.find(r => String(r.sysId ?? "") === String(sysId ?? "")) : undefined;
}

function displayedValue(row: ViewerRow, key: string, cls?: string): string {
  const v = row[key];
  if (cls === "inst") return fmtInstant(v as string, row);
  return v === null || v === undefined ? "" : String(v);
}

function autoParse(): number {
  const data = st().data;
  if (!data || !Array.isArray(data.rows)) return 0;
  const stats = extract.applyExtraction(data.rows);
  if (data.rows.length && !stats.withNotes) {
    setStatus("No close notes / work notes / comments found on these tickets", true);
  } else if (stats.filled) {
    showToast(`Extracted resolution details from ${stats.filled} ticket${stats.filled === 1 ? "" : "s"}`);
  }
  return stats.filled;
}

function clsProgressShow(done: number, total: number, notClassified = 0): void {
  const el = $("clsProgress");
  const fill = $("clsFill");
  if (!el || !fill) return;
  el.classList.remove("hidden");
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  fill.style.width = `${pct}%`;
  // Live status text only while running; the completion summary lives in the
  // status bar (legend + classification counts), so we stop writing it here.
  const remaining = Math.max(0, total - done);
  const skipped = notClassified > 0 ? ` · ${notClassified} not able to process` : "";
  $("status").textContent = done < total
    ? `Classifying ticket ${done}/${total} (${remaining} left)${skipped}`
    : "";
}

function clsProgressHide(): void {
  const el = $("clsProgress");
  if (el) el.classList.add("hidden");
  const fill = $("clsFill");
  if (fill) fill.style.width = "0%";
}

function clsUpdateRow(row: ViewerRow, solutionType: string | null, rootCause: string | null): void {
  if (solutionType) row.solutionType = solutionType;
  if (rootCause) row.rootCause = rootCause;
}

function dataFingerprint(data: ViewerData | null | undefined): string {
  const rows = data && Array.isArray(data.rows) ? data.rows : [];
  if (!rows.length) return "";
  const first = rows[0];
  return `${rows.length}:${String(first.sysId ?? "")}:${String(first.number ?? "")}`;
}

/** The id of the model selected in Settings (used to re-run classification when
 *  the user switches models on already-loaded data). */
async function currentModelId(): Promise<string> {
  try {
    const st = await chrome.storage.local.get(STORAGE.pluginSettings);
    const ml = (st?.[STORAGE.pluginSettings] as any)?.ml;
    return typeof ml?.modelId === "string" ? ml.modelId : "mobilebert";
  } catch {
    return "mobilebert";
  }
}

async function currentModelLabel(): Promise<string> {
  try {
    const st = await chrome.storage.local.get(STORAGE.pluginSettings);
    const ml = (st?.[STORAGE.pluginSettings] as any)?.ml;
    const id = typeof ml?.modelId === "string" ? ml.modelId : "mobilebert";
    const opt = modelById(id);
    if (opt) return opt.label;
    // Fallback: show whatever is actually cached.
    const meta = await new MlModelStore().getMeta();
    if (meta?.repoId) {
      const byRepo = modelByRepoId(meta.repoId);
      return byRepo ? byRepo.label : meta.repoId;
    }
    return "offline scorer";
  } catch {
    return "offline scorer";
  }
}

/** Puts the active model name into the legend without touching the counts. */
function writeModelLabel(label: string): void {
  const bar = $("slaBar");
  if (!bar) return;
  let cls = bar.querySelector(".cls") as HTMLElement | null;
  if (!cls) {
    cls = document.createElement("span");
    cls.className = "cls";
    bar.appendChild(cls);
  }
  // Update the model marker in place if present, else prepend it; never append
  // a second copy (this runs on every grid render).
  const modelSpan = cls.querySelector(".model") as HTMLElement | null;
  if (modelSpan) {
    modelSpan.innerHTML = `Model <b>${label}</b>`;
  } else {
    cls.insertAdjacentHTML("afterbegin", `<span class="stat model">Model <b>${label}</b></span>`);
  }
}

function clsStatsShow(stats: ClassifyStats): void {
  const bar = $("slaBar");
  if (!bar) return;
  let cls = bar.querySelector(".cls") as HTMLElement | null;
  if (!cls) {
    cls = document.createElement("span");
    cls.className = "cls";
    bar.appendChild(cls);
  }

  // Count solution types / root causes from the committed rows (deduped by
  // sysId), so the two stay consistent even when a row is refined by both the
  // deterministic and ML passes in fallback mode.
  const { stTotal, rcTotal } = tallyCommittedRows();

  // The model label is owned by writeModelLabel (rendered on every grid render);
  // preserve any existing model span rather than duplicating it here.
  const modelHTML = cls.querySelector(".model")?.outerHTML ?? "";
  const parts: string[] = [];
  if (modelHTML) parts.push(modelHTML);
  parts.push(`<span class="stat">Classified <b>${stats.done}/${stats.total}</b></span>`);
  if (stats.notClassified > 0) {
    parts.push(`<span class="stat nap">Not able to process <b>${stats.notClassified}</b></span>`);
  }
  if (stTotal > 0) parts.push(`<span class="stat">Solution type <b>${stTotal}</b></span>`);
  if (rcTotal > 0) parts.push(`<span class="stat rc">Root cause <b>${rcTotal}</b></span>`);

  cls.innerHTML = parts.join(" ");
}

/** Counts rows that have a valid solution type / root cause, deduped by sysId. */
function tallyCommittedRows(): { stTotal: number; rcTotal: number } {
  const rows = st().data?.rows || [];
  const seen = new Set<string>();
  let stTotal = 0;
  let rcTotal = 0;
  for (const row of rows) {
    const sysId = String(row.sysId ?? "");
    if (seen.has(sysId)) continue;
    seen.add(sysId);
    if (hasValidSolutionType(row)) stTotal++;
    if (hasValidRootCause(row)) rcTotal++;
  }
  return { stTotal, rcTotal };
}

function clsStatsHide(): void {
  const bar = $("slaBar");
  const cls = bar?.querySelector(".cls");
  if (cls) cls.innerHTML = "";
}

async function classifyGrid(): Promise<void> {
  const data = st().data;
  const fingerprint = dataFingerprint(data);
  if (!fingerprint) return;
  // Run classification once per dataset per model; repeat load()/save() echoes
  // of the same data must not re-trigger it, but switching the model in
  // Settings DOES re-run classification on the already-loaded rows with the new
  // model (the run guard includes the model id).
  const modelId = await currentModelId();
  // The run guard must also account for the MSR label lists: editing them while
  // keeping the same model would otherwise skip re-classification and leave the
  // previous run's (now stale) values on screen.
  const runKey = `${fingerprint}::${modelId}::${classificationListsFp(getMsrLists())}`;
  if (classifying || lastClassifiedFingerprint === runKey) return;
  // A brand-new dataset, a model switch, or a list edit: reset the previous run's
  // bar before starting.
  if (lastClassifiedFingerprint !== runKey) { clsProgressHide(); clsStatsHide(); }
  classifying = true;
  try {
    const modelLabel = await currentModelLabel();
    // Let the side panel log know which model this classification run is using.
    broadcast({ type: MSG.progress, stage: "diag", detail: `Classifying with ${modelLabel}` });
    const run = await classifyRows({
      onProgress: clsProgressShow,
      onStats: (stats) => clsStatsShow(stats),
      updateRow: (row, st, rc) => {
        clsUpdateRow(row, st, rc);
        if (grid) grid.updateRows([String(row.sysId ?? "")]);
      }
    });
    await persistEdits();
    if (run.changed) {
      showToast(`Classified ${run.changed} ticket${run.changed === 1 ? "" : "s"} (${run.withNotes} with notes)`);
    }
    if (run.notice) showToast(run.notice, "info");
    lastClassifiedFingerprint = runKey;
  } catch (err) {
    setStatus(`Classification failed: ${(err as Error).message}`, true);
  } finally {
    classifying = false;
  }
}

export {
  load,
  buildHead,
  currentRows,
  fmtInstant,
  render,
  scheduleSave,
  persistEdits,
  saveData,
  parseLocalInput,
  getData,
  getTotalRows,
  hasDataRows,
  findRowBySysId,
  displayedValue,
  autoParse,
  resetColWidths,
  setSelectionHooks,
  setOnCellFocus,
  reportCellFocus
};