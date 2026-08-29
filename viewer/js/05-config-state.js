import { STORAGE } from "../../lib/keys.js";
import { $ } from "./00-core.js";

let ciSplit = { enabled: false, groups: [] };
let savedMapPresent = false;
let onConfigChange = () => {};

const getCiSplit = () => ciSplit;

function setCiSplit(v) {
  ciSplit = {
    enabled: !!(v && v.enabled),
    groups: Array.isArray(v && v.groups)
      ? v.groups
          .filter(g => g && typeof g === "object")
          .map(g => ({
            name: String(g.name ?? ""),
            items: Array.isArray(g.items) ? g.items.filter(x => typeof x === "string" && x.trim()) : []
          }))
      : []
  };
}

const getSavedMapPresent = () => savedMapPresent;
const setSavedMapPresent = (v) => { savedMapPresent = !!v; };

const setOnConfigChange = (fn) => { onConfigChange = fn || (() => {}); };
const notifyConfigChange = () => onConfigChange();

function syncSplitRadio() {
  const active = ciSplit.enabled && ciSplit.groups.length;
  $("radSingle").checked = !active;
  $("radSplit").checked = !!active;
  notifyConfigChange();
}

function closeConfigDialog() {
  $("configModal").classList.add("hidden");
}

const updateExportDots = () => notifyConfigChange();
const updateCiBtn = () => notifyConfigChange();

chrome.storage.local.get([STORAGE.ciSplit], ({ ciSplit: cs }) => {
  if (cs && typeof cs === "object") {
    if (Array.isArray(cs.groups)) {
      ciSplit = {
        enabled: !!cs.enabled,
        groups: cs.groups
          .filter(g => g && typeof g === "object")
          .map(g => ({
            name: String(g.name ?? ""),
            items: Array.isArray(g.items) ? g.items.filter(x => typeof x === "string" && x.trim()) : []
          }))
      };
    } else if (Array.isArray(cs.items)) {
      ciSplit = {
        enabled: !!cs.enabled,
        groups: cs.items
          .filter(x => typeof x === "string" && x.trim())
          .map(ci => ({ name: ci, items: [ci] }))
      };
    }
    syncSplitRadio();
  }
});

chrome.storage.local.get([STORAGE.exportColMap], ({ exportColMap }) => {
  savedMapPresent = !!(exportColMap && Object.keys(exportColMap).length);
  notifyConfigChange();
});

export {
  getCiSplit,
  setCiSplit,
  getSavedMapPresent,
  setSavedMapPresent,
  setOnConfigChange,
  syncSplitRadio,
  closeConfigDialog,
  updateCiBtn,
  updateExportDots
};
