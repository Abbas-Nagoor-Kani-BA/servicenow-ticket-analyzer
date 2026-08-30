import { STORAGE } from "../../lib/keys.ts";
import { $, setStatus } from "./00-core.js";
import { Modal, hasOpenModal } from "../../components/modal.ts";
import { CiDialog } from "../../components/ci-dialog.ts";
import { MapDialog } from "../../components/map-dialog.ts";
import { DEFAULT_EXPORT_MAP, EXPORT_FIELD_BY_ID, EXPORT_GROUPS } from "./10-exporter.js";
import { getCiSplit, setCiSplit, setSavedMapPresent, syncSplitRadio, updateCiBtn, updateExportDots, closeConfigDialog } from "./05-config-state.js";
import { clearSelection, hasSelection } from "./40-selection.js";

/*
 * Composition root for the viewer's dialogs.
 *
 * Each overlay is a Modal so Escape closes them innermost-first via the shared
 * stack; the dialog components own their contents and their drafts.
 */

// Escape used to be a hand-written if-chain over each overlay
// (letterPop -> ciModal -> mapModal -> configModal -> clearSelection). An
// if-chain can lose a branch and nothing notices; the stack cannot.
const mapModal = new Modal($("mapModal"), {}, {
  // A cell editor inside the grid must keep its own Escape.
  escapeGuard: () => !!document.querySelector("td.edit-input input")
});

const letterPop = new Modal($("letterPop"), {}, { backdropClose: false });

const ciModal = new Modal($("ciModal"), {}, {
  onClosed: () => syncSplitRadio()
});

const configModal = new Modal($("configModal"), {}, {
  onClosed: () => closeConfigDialog()
});

const mapEditor = new MapDialog($("mapModal"), {}, {
  search: $("mapSearch"),
  list: $("mapList"),
  letterPop,
  letterSearch: $("letterSearch"),
  letterList: $("letterList"),
  groups: EXPORT_GROUPS,
  fieldLabel: (fid) => EXPORT_FIELD_BY_ID.get(fid)?.label ?? "",
  status: (message, isError) => setStatus(message, isError),
  onSave: async (mapping) => {
    try {
      await chrome.storage.local.set({ [STORAGE.exportColMap]: mapping });
    } catch (err) {
      setStatus(`Save failed: ${err.message}`, true);
      throw err;
    }
    setSavedMapPresent(true);
    updateExportDots();
    mapModal.close();
  },
  onReset: async () => {
    try {
      await chrome.storage.local.remove(STORAGE.exportColMap);
    } catch {}
    setSavedMapPresent(false);
    updateExportDots();
  }
});

const ciEditor = new CiDialog($("ciModal"), {}, {
  status: (message, isError) => setStatus(message, isError),
  onClosed: () => {},
  onSave: async (value) => {
    setCiSplit(value);
    await chrome.storage.local.set({ [STORAGE.ciSplit]: getCiSplit() });
    ciModal.close();
    updateCiBtn();
  },
  onDisable: async () => {
    setCiSplit({ enabled: false, groups: [] });
    try {
      await chrome.storage.local.remove(STORAGE.ciSplit);
    } catch {}
    ciModal.close();
    updateCiBtn();
  }
});

async function openMapDialog() {
  let stored = null;
  try {
    ({ exportColMap: stored } = await chrome.storage.local.get(STORAGE.exportColMap));
  } catch {}
  setSavedMapPresent(!!(stored && Object.keys(stored).length));
  updateExportDots();
  mapEditor.show(stored, DEFAULT_EXPORT_MAP);
  mapModal.open();
}

function openCiDialog() {
  ciEditor.show(getCiSplit());
  ciModal.open();
}

function hideLetterPop() {
  letterPop.close();
}

$("mapSave").addEventListener("click", () => {
  void mapEditor.save();
});
$("mapCancel").addEventListener("click", () => mapModal.close());
$("mapClose").addEventListener("click", () => mapModal.close());
$("mapReset").addEventListener("click", async () => {
  await mapEditor.reset(DEFAULT_EXPORT_MAP);
  setStatus("Mapping reset — exports use the template's default layout until saved again");
});

// Close and cancel are plain dismissals; Save and Disable close themselves only
// after their own persistence succeeds.
for (const id of ["ciClose", "ciCancel"]) {
  $(id).addEventListener("click", () => ciModal.close());
}

document.addEventListener("keydown", e => {
  // Modals handle Escape themselves, innermost first. This only runs when none
  // of them did.
  if (e.key !== "Escape") return;
  if (hasOpenModal()) return;
  if (hasSelection() && !document.querySelector("td.edit-input") &&
      !document.querySelector(".msrPick")) {
    clearSelection();
  }
});

export {
  openMapDialog,
  openCiDialog,
  hideLetterPop,
  mapModal,
  letterPop,
  ciModal,
  configModal
};
