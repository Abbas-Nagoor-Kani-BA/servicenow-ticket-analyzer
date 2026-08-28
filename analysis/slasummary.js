import { buildReport, deriveType, slaPriority, hmsToHours } from "./report.js";

const RESOLVE_TIERS = {
  1: [
    { sla: "Within 1 hour", target: 0.85, kind: "flagMin" },
    { sla: "Within 2 hours", target: 0.95, kind: "dur", hours: 2 },
    { sla: "Within 4 hours", target: 1, kind: "flagMax" }
  ],
  2: [
    { sla: "Within 2 hours", target: 0.85, kind: "flagMin" },
    { sla: "Within 6 hours", target: 0.95, kind: "dur", hours: 6 },
    { sla: "Within 8 hours", target: 1, kind: "flagMax" }
  ],
  3: [
    { sla: "Within 1 working day", target: 0.6, kind: "flagMin" },
    { sla: "Within 5 working days", target: 1, kind: "flagMax" }
  ],
  4: [
    { sla: "Within 10 working days", target: 0.8, kind: "flagMin" },
    { sla: "Within 15 working days", target: 1, kind: "flagMax" }
  ]
};

const RESPOND_TIERS = {
  1: { sla: "Within 15 minutes", target: 1, kind: "dur", hours: 0.25 },
  2: { sla: "Within 30 minutes", target: 1, kind: "dur", hours: 0.5 },
  3: { sla: "Within 2 business hours", target: 1, kind: "flagResp" },
  4: { sla: "Within 3 business hours", target: 1, kind: "flagResp" }
};

const PROBLEM_ROWS = [
  {
    metric: "Known Error Logging",
    ticketType: "Problem",
    category: "High/High",
    sla: "Plan of action detailing options, dependencies, risks and timescales for fixing the problem to be available within 5 working days",
    target: 1,
    tiers: [1, 2]
  },
  {
    metric: "Known Error Logging",
    ticketType: "Problem",
    category: "All other priorities except High",
    sla: "Plan of action detailing options, dependencies, risks and timescales for fixing the problem to be available within 20 working days",
    target: 1,
    tiers: [3, 4]
  },
  {
    metric: "Reoccuring Incident - Problem creation",
    ticketType: "Problem",
    category: "All",
    sla: "Problem creation for reoccuring problems ",
    target: 1,
    tiers: [1, 2, 3, 4]
  }
];

const SEVERITY_LABELS = { 1: "Severity 1 Incidents", 2: "Severity 2 Incidents", 3: "Severity 3 Incidents", 4: "Severity 4 Incidents" };

function statusFor(target, total, actual, redOnBreach) {
  if (redOnBreach) return total > 0 && actual >= 1 ? "GREEN" : "RED";
  return total === 0 ? "GREEN" : (actual >= target ? "GREEN" : "AMBER");
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function countResolve(tier, reps) {
  let n = 0;
  for (const rep of reps) {
    if (tier.kind === "flagMin") {
      if (rep.metMinResolutionSLA === "YES") n++;
      continue;
    }
    if (tier.kind === "flagMax") {
      if (rep.metMaxResolutionSLA === "YES") n++;
      continue;
    }
    if (rep.incidentHours) {
      const h = hmsToHours(rep.incidentHours);
      if (Number.isFinite(h) && h < tier.hours) n++;
    }
  }
  return n;
}

function countRespond(tier, reps) {
  let n = 0;
  for (const rep of reps) {
    if (tier.kind === "flagResp") {
      if (rep.metResponseSLA === "YES") n++;
      continue;
    }
    if (rep.responseSLA) {
      const h = hmsToHours(rep.responseSLA);
      if (Number.isFinite(h) && h < tier.hours) n++;
    }
  }
  return n;
}

function buildSlaSummary(rows, fmt) {
  const incidentReps = { 1: [], 2: [], 3: [], 4: [] };
  const problemReps = { 1: [], 2: [], 3: [], 4: [] };
  for (const row of rows || []) {
    const p = slaPriority(row.priority);
    if (!p) continue;
    const rep = buildReport(row, fmt);
    if (deriveType(row.number) === "Incident") incidentReps[p].push(rep);
    else if (deriveType(row.number) === "Problem") problemReps[p].push(rep);
  }
  const incidentTotals = {};
  for (let sev = 1; sev <= 4; sev++) {
    incidentTotals[sev] = incidentReps[sev].length;
  }
  const items = [];
  for (let sev = 1; sev <= 4; sev++) {
    const reps = incidentReps[sev];
    const total = incidentTotals[sev];
    const category = SEVERITY_LABELS[sev];
    for (const tier of RESOLVE_TIERS[sev]) {
      const count = total ? countResolve(tier, reps) : 0;
      const actual = total ? round2(count / total) : 0;
      items.push({
        metric: "Time to Resolve",
        ticketType: "Incident",
        category,
        sla: tier.sla,
        target: tier.target,
        count,
        total,
        actual,
        status: statusFor(tier.target, total, actual, false),
        writeStatus: true
      });
    }
  }
  for (let sev = 1; sev <= 4; sev++) {
    const reps = incidentReps[sev];
    const total = incidentTotals[sev];
    const category = SEVERITY_LABELS[sev];
    const rTier = RESPOND_TIERS[sev];
    const count = total ? countRespond(rTier, reps) : 0;
    const actual = total ? round2(count / total) : 0;
    items.push({
      metric: "Time to Respond",
      ticketType: "Incident",
      category,
      sla: rTier.sla,
      target: rTier.target,
      count,
      total,
      actual,
      status: statusFor(rTier.target, total, actual, true),
      writeStatus: true
    });
  }
  for (const def of PROBLEM_ROWS) {
    const reps = def.tiers.flatMap(t => problemReps[t]);
    const total = reps.length;
    const count = reps.filter(rep => rep.metMaxResolutionSLA === "YES").length;
    const actual = total ? round2(count / total) : 0;
    items.push({
      metric: def.metric,
      ticketType: def.ticketType,
      category: def.category,
      sla: def.sla,
      target: def.target,
      count,
      total,
      actual,
      status: statusFor(def.target, total, actual, false),
      writeStatus: false
    });
  }
  return {
    computedAt: new Date().toISOString(),
    incidentTotals,
    items
  };
}

function buildSlaSummaryRows(rows, fmt) {
  return buildSlaSummary(rows, fmt).items;
}

export { RESOLVE_TIERS, RESPOND_TIERS, PROBLEM_ROWS, buildSlaSummary, buildSlaSummaryRows };