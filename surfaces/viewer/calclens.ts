/**
 * Calclens — viewer wiring.
 *
 * Owns the toolbar toggle button and the right-side drawer, and routes the
 * currently-selected grid cell to the pure explainer in core/calclens.ts. The
 * grid body is always read-only; the drawer also edits the derivation columns.
 */
import { $, columnOptionList, visibleCols } from "./core.ts";
import { findRowBySysId, fmtInstant, parseLocalInput, render, reportCellFocus, scheduleSave, setOnCellFocus } from "./grid.ts";
import { setSelPoint } from "./selection.ts";
import { getMsrLists } from "./store.ts";
import { getCalclensMode, setCalclensMode } from "./calclens-state.ts";
import { explainCell } from "../../core/calclens.ts";
import { CalclensPanel } from "../../components/calclens-panel.ts";
import { activityPaneEl } from "./activity.ts";
import { showToast } from "../../lib/toast.ts";
import { iconize } from "../../lib/icons.ts";

let panel: CalclensPanel;

function colClass(key: string): string {
  return visibleCols().find((c) => c[0] === key)?.[2] ?? "";
}

export function initCalclens(): void {
  const btn = $("calclensBtn");
  const host = $("calclensPanel");
  iconize(btn, "info");

  panel = new CalclensPanel(host, {}, {
    optionsFor: (key, row) => columnOptionList(key, row),
    displayFor: (key, row, cls) => (cls === "inst" ? fmtInstant(String(row[key] ?? ""), row) : String(row[key] ?? "")),
    parseValue: (v) => parseLocalInput(v),
    activityFor: (row) => activityPaneEl(row),
    onCommit: (key, value, row) => {
      row[key] = value;
      scheduleSave();
      render();
      showToast("Saved");
      // Re-show so the freshly-edited derivation re-marks the picked timeline
      // step as `selected` and the Timeline strip reflects the new value.
      try {
        const ex = explainCell(row, key, { fmtInstant, msrLists: getMsrLists() });
        panel.show(ex, { row, key, cls: colClass(key) });
      } catch { /* keep the drawer as-is */ }
    },
    onJumpToCell: (sysId, key) => {
      setSelPoint(sysId, key, false);
      reportCellFocus({ sysId, key });
    }
  });

  btn.addEventListener("click", () => {
    const next = !getCalclensMode();
    setCalclensMode(next);
    btn.classList.toggle("calclens-on", next);
    render();
    if (!next) panel.close();
  });

  setOnCellFocus((info) => {
    if (!getCalclensMode()) return;
    const row = info ? findRowBySysId(info.sysId) : undefined;
    if (!info || !row) {
      panel.show(null);
      return;
    }
    try {
      const ex = explainCell(row, info.key, { fmtInstant, msrLists: getMsrLists() });
      panel.show(ex, { row, key: info.key, cls: colClass(info.key) });
    } catch {
      panel.show(null);
    }
  });

  // Reflect the persisted mode on boot.
  btn.classList.toggle("calclens-on", getCalclensMode());
}
