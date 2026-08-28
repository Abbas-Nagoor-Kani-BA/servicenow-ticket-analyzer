const SOLUTION_PERMANENT = "Permanent solution";
const SOLUTION_WORKAROUND = "Workaround solution";

function tidyRootCause(v) {
  let s = String(v ?? "").replace(/\s+/g, " ").trim();
  s = s.replace(/^root\s*ca?us?e\s*(is)?\s*[::-]?\s*/i, "").replace(/[\s.;]+$/, "");
  if (!s || /^(unknown|n\/?a|none|not specified|not mentioned|not provided)$/i.test(s)) return "";
  return s.slice(0, 600);
}

/* ------------------------------------------------------------------ */
/* Fuzzy section-label matching                                        */
/* ------------------------------------------------------------------ */

function normLabel(s) {
  return String(s).toLowerCase().replace(/[^a-z]+/g, " ").replace(/\s+/g, " ").trim();
}

// Strip list bullets / numbering: "-", "* ", "3.", "1)", "(2" ...
function stripPrefix(s) {
  return String(s).replace(/^[ \t]*(?:[-*\u2022]|\d{1,2}[.):-])[ \t]*/, "");
}

// Classic DP edit distance with an early bail-out threshold.
function editDistanceWithin(a, b, max) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > max) return false;
  const m = a.length, n = b.length;
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

// Known section headers. Variants include common typos and rewordings;
// matching itself is fuzzy (distance 1-2 depending on label length).
const SECTION_LABELS = [
  { key: "rootCause", variants: ["analysis root cause", "analysis rca", "rca analysis", "root cause analysis", "root cause summary", "root cause", "rootcause", "root caus", "rca"] },
  { key: "resolutionType", variants: ["resolution type", "resoultion type", "resolution types", "solution type", "resolved type", "resolution status"] },
  { key: "impact", variants: ["impact", "business impact", "customer impact"] },
  { key: "steps", variants: ["steps taken to resolve", "steps taken", "resolution steps", "actions taken", "action taken", "troubleshooting steps"] },
  { key: "preventive", variants: ["preventive actions", "preventive action", "preventative actions", "preventative action", "prevention"] },
  { key: "problemTicket", variants: ["problem ticket required", "problem ticket"] },
  { key: "resolvedBy", variants: ["resolved by supplier", "resolved by"] },
  { key: "closure", variants: ["closure", "closure notes"] },
  { key: "issue", variants: ["issue", "issue summary", "description"] }
];

function maxDistFor(variant) {
  return variant.replace(/ /g, "").length >= 10 ? 2 : 1;
}

// A line "looks like" a header when it has an early colon ("Analysis (Root
// Cause): text...") or is short — this stops body sentences that merely begin
// with words like "Impact" from being mistaken for section headers.
function looksLikeHeader(line) {
  const t = line.trim();
  const colon = t.indexOf(":");
  return (colon >= 0 && colon <= 45) || t.length <= 60;
}

// Returns the SECTION_LABELS key for a header-looking line, else null.
function lineSectionKey(line) {
  if (!looksLikeHeader(line)) return null;
  const words = normLabel(stripPrefix(line)).split(" ").filter(Boolean);
  if (!words.length) return null;
  for (const sec of SECTION_LABELS) {
    for (const variant of sec.variants) {
      const n = variant.split(" ").length;
      const cand = words.slice(0, n).join(" ");
      if (!cand) continue;
      if (cand === variant || editDistanceWithin(cand, variant, maxDistFor(variant))) {
        return sec.key;
      }
    }
  }
  return null;
}

function findLine(lines, keys) {
  for (let i = 0; i < lines.length; i++) {
    if (keys.includes(lineSectionKey(lines[i]))) return i;
  }
  return -1;
}

// Capture the value belonging to a section header line: the remainder of the
// header line after its colon, plus following lines until the next header.
function captureFrom(lines, startIdx) {
  const head = stripPrefix(lines[startIdx]);
  const colon = head.indexOf(":");
  const kept = [];
  const first = colon >= 0 ? head.slice(colon + 1) : "";
  if (first.trim()) kept.push(first.trim());
  for (let j = startIdx + 1; j < lines.length; j++) {
    if (lineSectionKey(lines[j])) break;
    kept.push(stripPrefix(lines[j]));
  }
  return kept.join(" ").trim();
}

/* ------------------------------------------------------------------ */
/* Solution type classification                                        */
/* ------------------------------------------------------------------ */

// Token-level fuzzy check so misspellings still map onto a known bucket
// ("Permanant fix" -> permanent, "Work arount" -> workaround).
function tokensInclude(list, target, maxDist) {
  return list.some(t => t === target || editDistanceWithin(t, target, maxDist));
}

function classifySolution(raw) {
  let s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  s = s.replace(/^[:\-)\]]+\s*/, "");
  const tokens = normLabel(s).split(" ").filter(Boolean);
  if (tokensInclude(tokens, "permanent", 1) || tokensInclude(tokens, "permanently", 1)) {
    return SOLUTION_PERMANENT;
  }
  if (
    tokensInclude(tokens, "workaround", 2) ||
    tokensInclude(tokens, "temporary", 1) ||
    tokensInclude(tokens, "monitoring", 1) ||
    tokensInclude(tokens, "education", 1) ||
    tokensInclude(tokens, "cancelled", 1) ||
    normLabel(s).includes("no issue found")
  ) {
    return SOLUTION_WORKAROUND;
  }
  // Unrecognized wording — pass it through untouched so no information is lost.
  return s;
}

/* ------------------------------------------------------------------ */
/* Main entry point                                                    */
/* ------------------------------------------------------------------ */

/**
 * @param {string} notes
 * @returns {{ solutionType: string, rootCause: string, confidence: { solutionType: string, rootCause: string }, parseReview?: boolean }}
 */
function extractHeuristic(notes) {
  const text = String(notes ?? "");
  const out = { solutionType: "", rootCause: "", confidence: { solutionType: "", rootCause: "" } };
  if (!text.trim()) return out;
  const lines = text.split(/\r?\n/);

  // --- Solution type -------------------------------------------------
  // Preferred: explicit "Resolution Type:" section (fuzzy-matched).
  const rtIdx = findLine(lines, ["resolutionType"]);
  if (rtIdx >= 0) {
    const val = classifySolution(captureFrom(lines, rtIdx));
    if (val) {
      out.solutionType = val;
      out.confidence.solutionType = "high";
    }
  }

  // Fallback 1: "is it permanent: yes/no"-style lines.
  if (!out.solutionType) {
    const ynLine = text.match(/^.*\bpermanent\b[^.\n]*?\b(yes|no|true|false)\b[^0-9]*$/im);
    if (ynLine) {
      out.solutionType = /yes|true/i.test(ynLine[1]) ? SOLUTION_PERMANENT : SOLUTION_WORKAROUND;
      out.confidence.solutionType = "medium";
    }
  }

  // Fallback 2: prose keywords.
  if (!out.solutionType) {
    if (/\bpermanen(?:t|tly)\s+(?:fix|resolved|solution)|\bfixed\s+(?:at\s+)?(?:the\s+)?root\b|\bpermanent\s+solution\s+applied\b/i.test(text)) {
      out.solutionType = SOLUTION_PERMANENT;
      out.confidence.solutionType = "medium";
    } else if (/\bwork\s?-?arounds?\b|\btemporary\b|\btemp\s+fix\b|\buntil\s+(?:the\s+)?(?:vendor|patch)\b/i.test(text)) {
      out.solutionType = SOLUTION_WORKAROUND;
      out.confidence.solutionType = "medium";
    }
  }

  // --- Root cause ----------------------------------------------------
  // Preferred: "Analysis (Root Cause):"-style section (fuzzy-matched),
  // capturing the full multi-line analysis.
  const rcIdx = findLine(lines, ["rootCause"]);
  if (rcIdx >= 0) {
    const rc = tidyRootCause(captureFrom(lines, rcIdx));
    if (rc) {
      out.rootCause = rc;
      out.confidence.rootCause = "high";
    }
  }

  // Fallbacks: single-line "root cause: ..." or "root cause was ..." sentences.
  if (!out.rootCause) {
    const rm = text.match(/(?:root\s*cause|rca)\s*[:\-]\s*([^\n]+)/i)
      || text.match(/\broot\s*cause\s+(?:was|is)\s+([^\n.!]+)/i);
    if (rm) {
      out.rootCause = tidyRootCause(rm[1]);
      out.confidence.rootCause = out.rootCause ? "medium" : "";
    }
  }
  return out;
}

export { extractHeuristic };
