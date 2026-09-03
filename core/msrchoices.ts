import { parseSnDisplayMs } from "./sntime.ts";

export type RootCauseLists = { Incident: string[]; RFS: string[]; P_Ticket: string[] };
export type MsrListSet = {
  opCo: string[];
  domain: string[];
  type: string[];
  queue: string[];
  status: string[];
  resolution: string[];
  duplicate: string[];
  subCategory: string[];
  rootCause: RootCauseLists;
  /** Keyword / hint phrases the classifier matches per category label. */
  hints: Record<string, string[]>;
};
export type MsrListOverrides = Partial<Omit<MsrListSet, "rootCause" | "hints">>
  & { rootCause?: Partial<RootCauseLists>; hints?: Record<string, string[]> };

/** Keyword / hint phrases the classifier matches per category label (keys are
 *  the normalised label). Shipped as defaults; users may extend them in Settings. */
export const DEFAULT_HINTS: Record<string, string[]> = {
  "application bug": ["application bug", "code defect", "code bug", "software defect", "defect", "bug", "coding error", "compilation error"],
  "application performance": ["application performance", "slow application", "app slow", "performance issue", "slowness", "response time"],
  "database performance": ["database performance", "db performance", "slow database", "db slow", "sql performance", "query performance", "db slowness"],
  "server performance": ["server performance", "server slow", "high cpu", "cpu usage", "memory leak", "out of memory", "server slowness"],
  hardware: ["hardware", "hard drive", "disk failure", "disk", "memory module", "power supply", "motherboard", "processor", "ram", "ssd", "barcode scanner", "kiosk"],
  environment: ["environment", "environmental", "power issue", "datacenter", "data centre", "air conditioning", "temperature"],
  "interface data error": ["interface data", "data error", "stream issue", "feed failure", "iif", "mapping error", "data mismatch"],
  "interfacing application error": ["interfacing application", "interface error", "upstream application", "downstream application", "connected application", "peer application"],
  "network issue": ["network", "connectivity", "latency", "packet loss", "bandwidth", "dns", "routing", "vpn", "lan", "wan", "connection issue"],
  firewall: ["firewall", "blocked port", "port blocked", "proxy"],
  "certificate expiry": ["certificate expiry", "certificate expired", "cert expiry", "certificate", "ssl", "tls", "expired certificate"],
  "user error data": ["incorrect data", "wrong data", "bad data", "user typo", "mistyped", "misentered", "data entry error"],
  "user error procedure": ["user procedure", "wrong procedure", "incorrect process", "process gap", "step missed", "procedure", "user error", "manual error", "human error", "business process", "wrong process"],
  "false alert": ["false alert", "false positive", "spurious alert", "false alarm", "alert was false"],
  "user query": ["user query", "clarification", "how to", "how do", "usage question", "user question", "query"],
  "information request": ["information request", "info request", "request for information", "please provide", "information required", "need details"],
  "user access issue": ["access issue", "access denied", "cannot access", "can't access", "permission denied", "no access", "access problem", "suddenly stopped"],
  "password reset": ["password reset", "reset password", "forgot password", "password"],
  "job schedule scheduler error": ["job failed", "scheduler", "scheduled job", "batch job", "job error", "cron", "job schedule"],
  "external 3rd party": ["third party", "3rd party", "external", "sap", "oracle", "aurea", "amadeus", "sita", "vendor", "supplier"],
  "duplicate incident": ["duplicate incident", "duplicate ticket", "already reported", "existing incident", "duplicate"],
  "not an issue": ["not an issue", "no issue", "not a problem", "working as designed", "works as expected", "no problem found", "everything works"],
  "invalid issue": ["invalid issue", "not ours", "wrongly assigned", "misassigned", "invalid ticket", "incorrectly assigned", "mistakenly assigned", "reassign"],
  "dependent application failure": ["dependent application", "dependency failure", "dependent app", "caml", "cirrus", "fico", "loreto", "iag"],
  "configuration issue": ["configuration issue", "misconfiguration", "config issue", "wrong parameter", "config change", "incorrectly configured", "missing config", "config"],
  "workaround solution": ["workaround", "temporary fix", "temp fix", "interim", "until vendor", "until patch", "restart", "reboot", "monitoring", "temporary"],
  "permanent solution": ["permanent", "code change", "root", "fixed", "replaced", "corrected", "patched", "permanent fix", "reconfigured", "implemented"],
  "verification only": ["verification only", "verify", "confirmed working", "verification", "checked", "tested", "validation"],
  "not applicable": ["not applicable", "n/a", "na", "not apply", "not applicable"]
};

const MSR_DEFAULT_LISTS: MsrListSet = {
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
  },
  hints: { ...DEFAULT_HINTS }
};

function normList(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
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

function mergeMsrLists(overrides: MsrListOverrides | null | undefined): MsrListSet {
  const base: MsrListSet = {
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
    },
    hints: { ...MSR_DEFAULT_LISTS.hints }
  };
  if (!overrides || typeof overrides !== "object") return base;
  for (const key of ["opCo", "domain", "type", "queue", "status", "resolution", "duplicate", "subCategory"] as const) {
    const v = (overrides as Record<string, unknown>)[key];
    if (Array.isArray(v)) base[key] = normList(v);
  }
  const rc = overrides.rootCause;
  if (rc && typeof rc === "object") {
    for (const t of ["Incident", "RFS", "P_Ticket"] as const) {
      const v = (rc as Record<string, unknown>)[t];
      if (Array.isArray(v)) base.rootCause[t] = normList(v);
    }
  }
  const hints = (overrides as { hints?: Record<string, unknown> }).hints;
  if (hints && typeof hints === "object") {
    for (const [label, arr] of Object.entries(hints)) {
      if (Array.isArray(arr)) base.hints[label] = normList(arr);
    }
  }
  return base;
}

function normResolution(v: unknown): string {
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

const STATUS_MAP: Array<[RegExp, string]> = [
 [/^(closed|resolved|cancelled|canceled|closed complete|closed incomplete|closed skipped)/i, "Closed"],
 [/^on hold|^suspended|^awaiting|^pending (vendor|supplier|user)/i, "Suspended"],
 [/^triage/i, "Triaged"],
 [/^(new|open|in progress|work in progress|in progress$)/i, "In Progress"]
];

function msrStatus(snStateLabel: unknown): string {
  const s = String(snStateLabel ?? "").trim();
  if (!s) return "";
  for (const [re, label] of STATUS_MAP) {
    if (re.test(s)) return label;
  }
  return "In Progress";
}

function msrType(refNumber: unknown): string {
  const s = String(refNumber || "");
  if (s.startsWith("INC")) return "Incident";
  if (s.startsWith("REQ")) return "RFS";
  if (s.startsWith("SCTASK")) return "RFS";
  if (s.startsWith("PRB")) return "P_Ticket";
  if (s.startsWith("PTASK")) return "P_Ticket";
  return "";
}

/**
 * Solution type / root cause are only classified for closed Incident or RFS
 * tickets: the number resolves to msrType "Incident" (INC) or "RFS"
 * (REQ / SCTASK), and the state has reached a terminal ("close"/"resolv") label.
 * Problem (PRB/PTASK) and change (CHG) tickets are never auto-classified.
 */
function isClassifyEligible(row: { number?: unknown; state?: unknown } | null | undefined): boolean {
  if (!row) return false;
  const t = msrType(row.number);
  if (t !== "Incident" && t !== "RFS") return false;
  const state = String(row.state ?? "").trim().toLowerCase();
  return state.startsWith("close") || state.startsWith("resolv");
}

function rootCauseFor(rootCauseLists: RootCauseLists | null | undefined, typeLabel: unknown): string[] {
  const t = String(typeLabel || "");
  if (t === "Incident") return rootCauseLists?.Incident || [];
  if (t === "RFS") return rootCauseLists?.RFS || [];
  if (t === "P_Ticket") return rootCauseLists?.P_Ticket || [];
  return [];
}

function parseDisplayMs(s: string | null | undefined): number | null {
  return parseSnDisplayMs(s ?? "");
}

const EXCEL_EPOCH_SERIAL = 25569;

function excelSerialFromMs(ms: number | null | undefined): number | null {
  if (ms === null || ms === undefined || isNaN(ms)) return null;
  return Math.round(((ms / 86400000) + EXCEL_EPOCH_SERIAL) * 1e10) / 1e10;
}

function displayToSerial(text: unknown): number | null {
  return excelSerialFromMs(parseDisplayMs(String(text ?? "")));
}

function hmsToHours(v: unknown): number {
  if (v === "" || v === null || v === undefined) return NaN;
  const parts = String(v).split(":");
  if (parts.length < 2) return parseFloat(String(v)) || 0;
  return parseInt(parts[0], 10) + parseInt(parts[1], 10) / 60 + (parseInt(parts[2], 10) || 0) / 3600;
}

function hmsToDays(v: unknown): string | number {
  const h = hmsToHours(v);
  if (!Number.isFinite(h)) return "";
  return Math.round((h / 24) * 1e10) / 1e10;
}

export {
  MSR_DEFAULT_LISTS, mergeMsrLists, normResolution, msrStatus, msrType,
  isClassifyEligible,
  rootCauseFor, parseDisplayMs, excelSerialFromMs, displayToSerial,
  hmsToHours, hmsToDays
};