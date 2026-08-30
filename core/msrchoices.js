import { parseSnDisplayMs } from "./sntime.js";

const MSR_DEFAULT_LISTS = {
  opCo: ["BA", "IB", "EI"],
  domain: ["Apex", "SharePoint", "TechTools", "Mobile", "SIP", "JFE", "AO", "MRO", "LIP", "Pathway", "QIP", "COSI RTO", "Commercial Services", "ODI"],
  type: ["Incident", "RFS", "P_Ticket"],
  queue: [
    "APPSUP_APEX", "APPSUP_SPOMGSV", "APPSUP_POWERAPPS", "APPSUP_ETL",
    "APPSUP_TRILLIUM", "APPSUP_CRT", "APPSUP_BOA", "APPSUP_ICD50",
    "APPSUP_BAENTMOBAPPS", "APPSUP_INFORM", "APPSUP_OPSDASHBOARD", "APPSUP_AIRPORTOPS",
    "APPSUP_AIMSLOUNGES", "APPSUP_OSCS", "APPSUP_BAGS", "APPSUP_RIBI",
    "APPSUP_PLUTO", "APPSUP_FUSION", "APPSUP_LIDO4D_INTEGRATION", "APPSUP_QUANTUM",
    "APPSUP_CRPDIR", "APPSUP_MGZE", "APPSUP_RTO", "APPSUP_TTPTESTLAB",
    "APPSUP_DEVICESLIVE", "APPSUP_CMJFE", "APPSUP_HDL_CORA", "APPSUP_IBIS",
    "APPSUP_IBCOM_3P", "APPSUP_ITTOOLS", "APPSUP_GROUNDOPS", "APPSUP_MRO_NOSAP",
    "APPSUP_FMJFE", "DELSUP_NOVA_INTEGRATION", "APPSUP_NOVA_L3", "DELSUP_AUAS_L3"
  ],
  status: ["In Progress", "Suspended", "Closed", "Triaged"],
  resolution: ["Workaround solution", "Permanent solution", "Verification only", "Not applicable"],
  duplicate: ["Yes", "No"],
  subCategory: [
    "Cause", "Access Issue", "Covid Reduced Operations", "Data Request", "DB Issue",
    "Dependant Application failue - CAML", "Dependant Application failue - CIRRUS",
    "Dependant Application failue - FICO", "Dependant Application failue - Loreto",
    "Expected Behaviour", "FLY code issue", "In Progress", "Insufficient Info/logs",
    "Network Issue", "No issue found / Auto resolved", "Not related to SIP",
    "SIP CID Release", "SIP Infra - Batch", "SIP Infra - Battery", "SIP Infra - Certificate",
    "SIP Infra - Components", "SIP Infra - DSMS", "SIP Infra - False alerts",
    "SIP Infra - Filesystem", "SIP Infra - Prob runner", "SIP Infra - Queue pileup",
    "SIP Infra - Topic DB", "SIP Services issue", "SIP Services Release",
    "Third Party - Amadeus", "Third Party - SITA", "Third Party - Others",
    "User Error/Business process"
  ],
  rootCause: {
    Incident: [
      "Application bug", "Application performance", "Database performance",
      "Server performance", "Hardware", "Environment", "Interface data error",
      "Interfacing application error", "Network issue", "Firewall", "Certificate expiry",
      "User error - procedure", "False alert", "User query", "Information request",
      "User access issue", "Password reset", "Job schedule/scheduler error",
      "External-3rd party", "Duplicate incident", "Not an issue", "Invalid issue",
      "Dependent Application Failure", "Configuration Issue"
    ],
    RFS: [],
    P_Ticket: [
      "Application bug", "Application performance", "Database performance",
      "Server performance", "Hardware", "Environment", "Interface data error",
      "Interfacing application error", "Network issue", "Firewall", "Certificate expiry",
      "User error - data"
    ]
  }
};

function normList(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const s = String(item ?? "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function mergeMsrLists(overrides) {
  const base = {
    opCo: [...MSR_DEFAULT_LISTS.opCo],
    domain: [...MSR_DEFAULT_LISTS.domain],
    type: [...MSR_DEFAULT_LISTS.type],
    queue: [...MSR_DEFAULT_LISTS.queue],
    status: [...MSR_DEFAULT_LISTS.status],
    resolution: [...MSR_DEFAULT_LISTS.resolution],
    duplicate: [...MSR_DEFAULT_LISTS.duplicate],
    subCategory: [...MSR_DEFAULT_LISTS.subCategory],
    rootCause: {
      Incident: [...MSR_DEFAULT_LISTS.rootCause.Incident],
      RFS: [...MSR_DEFAULT_LISTS.rootCause.RFS],
      P_Ticket: [...MSR_DEFAULT_LISTS.rootCause.P_Ticket]
    }
  };
  if (!overrides || typeof overrides !== "object") return base;
  for (const key of ["opCo", "domain", "type", "queue", "status", "resolution", "duplicate", "subCategory"]) {
    if (Array.isArray(overrides[key])) base[key] = normList(overrides[key]);
  }
  const rc = overrides.rootCause;
  if (rc && typeof rc === "object") {
    for (const t of ["Incident", "RFS", "P_Ticket"]) {
      if (Array.isArray(rc[t])) base.rootCause[t] = normList(rc[t]);
    }
  }
  return base;
}

function normResolution(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const n = s.toLowerCase().replace(/\s+/g, " ");
  if (/perman[ae]n/.test(n)) return "Permanent solution";
  if (/work\s?-?around/.test(n)) return "Workaround solution";
  if (/^temp\b|^temporary/.test(n) || /\bmonitoring\b/.test(n) || /\beducat/.test(n) || /no issue found/.test(n)) {
    return "Workaround solution";
  }
  if (/verif/.test(n)) return "Verification only";
  if (/^not applicable$/.test(n) || /^n\/?a$/.test(n)) return "Not applicable";
  return s;
}

/** @type {Array<[RegExp, string]>} */
const STATUS_MAP = [
 [/^(closed|resolved|cancelled|canceled|closed complete|closed incomplete|closed skipped)/i, "Closed"],
 [/^on hold|^suspended|^awaiting|^pending (vendor|supplier|user)/i, "Suspended"],
 [/^triage/i, "Triaged"],
 [/^(new|open|in progress|work in progress|in progress$)/i, "In Progress"]
];

function msrStatus(snStateLabel) {
  const s = String(snStateLabel ?? "").trim();
  if (!s) return "";
  for (const [re, label] of STATUS_MAP) {
    if (re.test(s)) return label;
  }
  return "In Progress";
}

function msrType(refNumber) {
  const s = String(refNumber || "");
  if (s.startsWith("INC")) return "Incident";
  if (s.startsWith("REQ")) return "RFS";
  if (s.startsWith("PTASK")) return "P_Ticket";
  return "";
}

function rootCauseFor(rootCauseLists, typeLabel) {
  const t = String(typeLabel || "");
  if (t === "Incident") return rootCauseLists?.Incident || [];
  if (t === "RFS") return rootCauseLists?.RFS || [];
  if (t === "P_Ticket") return rootCauseLists?.P_Ticket || [];
  return [];
}

function parseDisplayMs(s) {
  return parseSnDisplayMs(s);
}

const EXCEL_EPOCH_SERIAL = 25569;

function excelSerialFromMs(ms) {
  if (ms === null || ms === undefined || isNaN(ms)) return null;
  return Math.round(((ms / 86400000) + EXCEL_EPOCH_SERIAL) * 1e10) / 1e10;
}

function displayToSerial(text) {
  return excelSerialFromMs(parseDisplayMs(text));
}

function hmsToHours(v) {
  if (v === "" || v === null || v === undefined) return NaN;
  const parts = String(v).split(":");
  if (parts.length < 2) return parseFloat(v) || 0;
  return parseInt(parts[0], 10) + parseInt(parts[1], 10) / 60 + (parseInt(parts[2], 10) || 0) / 3600;
}

function hmsToDays(v) {
  const h = hmsToHours(v);
  if (!Number.isFinite(h)) return "";
  return Math.round((h / 24) * 1e10) / 1e10;
}

export {
  MSR_DEFAULT_LISTS, mergeMsrLists, normResolution, msrStatus, msrType,
  rootCauseFor, parseDisplayMs, excelSerialFromMs, displayToSerial,
  hmsToHours, hmsToDays
};
