import { test } from "node:test";
import assert from "node:assert/strict";
import { installSkeleton } from "./helpers/dom-env.mjs";

installSkeleton();

const { buildCiGroups, setCiSplit, getCiSplit, ciSplitDiagnostics } = await import("../surfaces/viewer/toolbar.ts");

function rows(...cis) {
  return cis.map(configItem => ({ configItem }));
}

test("one item collapses environment-suffixed config items into a single group", () => {
  setCiSplit({ enabled: true, groups: [{ name: "Payments", items: ["Payment Gateway"] }] });
  const r = rows(
    "Payment Gateway PRD",
    "Payment Gateway-PRE",
    "  Payment Gateway.PRE  ",
    "Payment Gateway TEST"
  );
  const out = buildCiGroups(r);
  assert.deepEqual(out, [{ name: "Payments", rows: r }]);
});

test("exact match beats prefix via longest-item rule", () => {
  setCiSplit({
    enabled: true,
    groups: [
      { name: "Broad", items: ["Pay"] },
      { name: "Exact", items: ["Payment Gateway PRD"] }
    ]
  });
  const r = rows("Payment Gateway PRD");
  const out = buildCiGroups(r);
  assert.deepEqual(out, [{ name: "Exact", rows: r }]);
});

test("longest matching prefix wins across groups", () => {
  setCiSplit({
    enabled: true,
    groups: [
      { name: "Logs", items: ["Payment"] },
      { name: "Gateways", items: ["Payment Gateway"] }
    ]
  });
  const r = rows("Payment Gateway DEV", "Payment App PRD");
  const out = buildCiGroups(r);
  assert.deepEqual(out, [
    { name: "Logs", rows: [r[1]] },
    { name: "Gateways", rows: [r[0]] }
  ]);
});

test("same-length item in two groups ties to the first-configured group", () => {
  setCiSplit({
    enabled: true,
    groups: [
      { name: "A", items: ["Payment Gateway"] },
      { name: "B", items: ["payment gateway"] }
    ]
  });
  const r = rows("PAYMENT GATEWAY PRD");
  assert.deepEqual(buildCiGroups(r), [{ name: "A", rows: r }]);
});

test("case and whitespace are ignored when matching", () => {
  setCiSplit({ enabled: true, groups: [{ name: "CRM", items: ["  crm  "] }] });
  const r = rows("CRM PROD", "Crm-live", "crmTest");
  const out = buildCiGroups(r);
  assert.deepEqual(out, [{ name: "CRM", rows: r }]);
});

test("unmatched and empty config items go to Others", () => {
  setCiSplit({ enabled: true, groups: [{ name: "Payments", items: ["Payment Gateway"] }] });
  const r = rows("", "Other App PRD", "Payment Gateway DEV");
  assert.deepEqual(buildCiGroups(r), [
    { name: "Payments", rows: [r[2]] },
    { name: "Others", rows: [r[0], r[1]] }
  ]);
});

test("Others omitted when every ticket matches a group", () => {
  setCiSplit({ enabled: true, groups: [{ name: "Payments", items: ["Payment Gateway"] }] });
  assert.equal(buildCiGroups(rows("Payment Gateway PRD")).some(g => g.name === "Others"), false);
});

test("empty groups route everything to Others", () => {
  setCiSplit({ enabled: false, groups: [] });
  assert.deepEqual(buildCiGroups(rows("Anything", "")), [{ name: "Others", rows: rows("Anything", "") }]);
});

test("legacy flat items config still prefixes", () => {
  setCiSplit({ enabled: true, groups: [{ name: "Biz", items: ["BIZ.NZ"] }] });
  assert.deepEqual(buildCiGroups(rows("biz.nz-prelive")), [{ name: "Biz", rows: rows("biz.nz-prelive") }]);
});

test("disabled split keeps groups usable after Disable button shape", () => {
  setCiSplit({ enabled: false, items: [] });
  assert.deepEqual(getCiSplit(), { enabled: false, groups: [] });
  assert.deepEqual(buildCiGroups(rows("Anything", "")), [{ name: "Others", rows: rows("Anything", "") }]);
});

test("setCiSplit normalizes group entries", () => {
  setCiSplit({ enabled: true, groups: [{ name: "G", items: ["A"] }, { name: "H", items: [42, "  "] }] });
  assert.equal(getCiSplit().groups.length, 2);
  assert.deepEqual(getCiSplit().groups[1], { name: "H", items: [] });
});

test("diagnostics flag a configured group that matched zero rows", () => {
  setCiSplit({
    enabled: true,
    groups: [
      { name: "Payments", items: ["Payment Gateway"] },
      { name: "Nobody", items: ["A Different App"] }
    ]
  });
  const r = rows("Payment Gateway PRD");
  const groups = buildCiGroups(r);
  const diag = ciSplitDiagnostics(groups, r);
  assert.deepEqual(diag.emptyGroups, ["Nobody"], "group with no matching rows reported");
  assert.equal(diag.others, 0, "no unmatched rows");
  assert.equal(diag.total, 1);
});

test("diagnostics count unmatched rows routed to Others", () => {
  setCiSplit({ enabled: true, groups: [{ name: "Payments", items: ["Payment Gateway"] }] });
  const r = rows("Payment Gateway PRD", "Totally Unrelated", "Another Unrelated");
  const groups = buildCiGroups(r);
  const diag = ciSplitDiagnostics(groups, r);
  assert.deepEqual(diag.emptyGroups, [], "single group matched something");
  assert.equal(diag.others, 2, "two rows fell to Others");
  assert.equal(diag.total, 3);
});

test("diagnostics are clean when everything matches", () => {
  setCiSplit({
    enabled: true,
    groups: [
      { name: "Payments", items: ["Payment Gateway"] },
      { name: "Identity", items: ["Identity Platform"] }
    ]
  });
  const r = rows("Payment Gateway PRD", "Identity Platform");
  const groups = buildCiGroups(r);
  const diag = ciSplitDiagnostics(groups, r);
  assert.deepEqual(diag.emptyGroups, []);
  assert.equal(diag.others, 0);
  assert.equal(diag.total, 2);
});