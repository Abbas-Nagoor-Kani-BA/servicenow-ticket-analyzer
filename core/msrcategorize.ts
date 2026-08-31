/**
 * Deterministic classifier that maps free text onto a fixed list of candidate
 * labels — used to turn parsed resolution/closure notes into MSR option-list
 * values for `rootCause` (per ticket type) and `solutionType` (resolution).
 *
 * Pure: no I/O, no DOM, no chrome.*. Standalone in plain node, like the other
 * `core/` modules. The optional ML path lives behind this same interface in a
 * service layer; here we ship the always-available, offline scorer.
 *
 * Scoring is a weighted keyword/hint match per candidate label, summed over
 * every hint that occurs in a token-normalised form of the text. Fuzzy token
 * matching (bounded edit distance) absorbs misspellings ("permanant",
 * "workarround"), and the confidence is derived from the margin between the
 * best and second-best label, so ties collapse to null rather than guessing.
 */

export type MsrScore = {
  /** Best-matching candidate label, or null when nothing clears the bar. */
  label: string | null;
  /** 0..1 confidence. 0 means "no evidence at all". */
  confidence: number;
  /** Per-label totals, for diagnostics. */
  scores: Record<string, number>;
};

export type ClassifyMsrOptions = {
  /** Minimum total score before a label can win at all. */
  minScore?: number;
  /** Minimum winning confidence (0..1). Below this, we return null. */
  minConfidence?: number;
  /** Override/augment hints per label (e.g. learned corrections). */
  hints?: Record<string, string[]>;
};

const DEFAULTS: Required<ClassifyMsrOptions> = {
  minScore: 1,
  minConfidence: 0.32,
  hints: {}
};

/** Token-normalise: lowercase, strip punctuation, collapse whitespace. */
function norm(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  const n = norm(s);
  return n ? n.split(" ") : [];
}

/**
 * Bounded edit distance that bails out early: used to accept a hint token when
 * the note only has it misspelled. The tolerated distance grows with the
 * shorter token's length so common short words never cross-match ("wan" must
 * not match "was"), while genuine misspellings ("permanant", "workarround")
 * still pass.
 */
function within(a: string, b: string): boolean {
  if (a === b) return true;
  const short = Math.min(a.length, b.length);
  let max: number;
  if (short < 5) max = 0;         // short words: exact only
  else if (short < 8) max = 1;
  else max = 2;
  if (max === 0) return false;
  if (Math.abs(a.length - b.length) > max) return false;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n] <= max;
}

/** Non-zero only when `phrase` (a full hint, possibly multi-token) is present. */
function phraseScore(textTokens: string[], phrase: string): number {
  const words = tokens(phrase);
  if (!words.length) return 0;
  for (let i = 0; i + words.length <= textTokens.length; i++) {
    let ok = true;
    for (let j = 0; j < words.length; j++) {
      if (!within(textTokens[i + j], words[j])) {
        ok = false;
        break;
      }
    }
    if (ok) return 1;
  }
  return 0;
}

/**
 * Scores `text` against the candidate labels. Each label's hint list is its
 * strongest evidence; a hint can be a single word or a short phrase, matched
 * token-adjacently so "user error" is not satisfied by "user" several words
 * away.
 */
export function classifyMsr(
  text: unknown,
  candidateLabels: string[],
  opts: ClassifyMsrOptions = {}
): MsrScore {
  const o = { ...DEFAULTS, ...opts, hints: opts.hints || {} };
  const body = String(text ?? "").trim();
  const textTokens = tokens(body);
  const scores: Record<string, number> = {};

  if (textTokens.length) {
    for (const label of candidateLabels) {
      const hints = hintPairs(label, o.hints);
      let total = 0;
      for (const hint of hints) total += phraseScore(textTokens, hint);
      scores[label] = total;
    }
  } else {
    for (const label of candidateLabels) scores[label] = 0;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [bestLabel, bestScore] = ranked[0] ?? [null, 0];
  const secondScore = ranked[1]?.[1] ?? 0;

  if (!bestLabel || bestScore < o.minScore) {
    return { label: null, confidence: 0, scores };
  }

  const margin = bestScore - secondScore;
  let confidence = Math.min(1, bestScore * 0.2 + margin * 0.18);
  confidence = Math.round(confidence * 100) / 100;

  if (confidence < o.minConfidence) {
    return { label: null, confidence: 0, scores };
  }

  return { label: bestLabel, confidence, scores };
}

/**
 * Returns the hint phrases for a label: the built-in synonyms merged with any
 * learned overrides. Built-ins live here so the core stays self-contained; the
 * MSR option list itself supplies the candidate *labels*, not their hints.
 */
function hintPairs(label: string, overrides: Record<string, string[]> | undefined): string[] {
  const key = normalizedKey(label);
  const base = BUILTIN_HINTS[key] || [];
  const extra = (overrides?.[key] || overrides?.[label] || []).filter((h) => typeof h === "string" && h.trim());
  return [...base, ...extra];
}

function normalizedKey(label: string): string {
  return norm(label);
}

/**
 * Built-in hint phrase lists, keyed by normalised label. These cover the MSR
 * root-cause option labels and the resolution (solution type) values. Phrases
 * are deliberately broader than the label itself (e.g. "network" also catches
 * "connectivity", "dns", "latency") because the notes rarely contain the exact
 * option wording.
 */
const BUILTIN_HINTS: Record<string, string[]> = {
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

export { norm, tokens };
