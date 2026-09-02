import { buildEncodedQuery, encodeConditions } from "../core/querybuilder.ts";

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) console.log("  ok ", name);
  else { failures++; console.log("  FAIL", name, "\n       got:     " + actual + "\n       expect:  " + expected); }
}
function checkTrue(name, cond, detail) {
  if (cond) console.log("  ok ", name);
  else { failures++; console.log("  FAIL", name, detail === undefined ? "" : "\n       got: " + detail); }
}

console.log("== encodeConditions ==");

// Reference is-empty must pass through natively (sys_id column, not a checkbox).
check("ref isEmpty",
  encodeConditions([{ field: "parent_incident", oper: "isEmpty", value: "" }]),
  "parent_incidentISEMPTY");
check("ref isNotEmpty",
  encodeConditions([{ field: "parent_incident", oper: "isNotEmpty", value: "" }]),
  "parent_incidentISNOTEMPTY");
check("assigned_to isEmpty",
  encodeConditions([{ field: "assigned_to", oper: "isEmpty" }]),
  "assigned_toISEMPTY");

// Value operators.
check("eq", encodeConditions([{ field: "state", oper: "eq", value: "2" }]), "state=2");
check("neq strips quotes", encodeConditions([{ field: "number", oper: "neq", value: "INC'001" }]), "number!=INC001");
check("contains", encodeConditions([{ field: "short_description", oper: "contains", value: "printer" }]),
  "short_descriptionLIKEprinter");
check("startsWith", encodeConditions([{ field: "number", oper: "startsWith", value: "INC" }]),
  "numberSTARTSWITHINC");

// Date operators use gs.dateGenerate with day boundaries.
check("before date",
  encodeConditions([{ field: "closed_at", oper: "before", value: "2026-08-10" }]),
  "closed_at<=javascript:gs.dateGenerate('2026-08-10','00:00:00')");
check("after date",
  encodeConditions([{ field: "sys_created_on", oper: "after", value: "2026-01-01" }]),
  "sys_created_on>=javascript:gs.dateGenerate('2026-01-01','23:59:59')");

// Joins: first condition has no join operator, later ones carry AND/OR.
check("AND chain",
  encodeConditions([
    { field: "priority", oper: "eq", value: "1", join: "AND" },
    { field: "state", oper: "neq", value: "7", join: "OR" }
  ]),
  "priority=1^ORstate!=7");

// Dot-walked reference field (cmdb_ci.name) passes through string operators correctly.
check("ci.name contains",
  encodeConditions([{ field: "cmdb_ci.name", oper: "contains", value: "printer" }]),
  "cmdb_ci.nameLIKEprinter");
check("ci.name isEmpty",
  encodeConditions([{ field: "cmdb_ci.name", oper: "isEmpty" }]),
  "cmdb_ci.nameISEMPTY");

// If first condition in array produces empty body, second must not get a leading join prefix.
check("skip empty first no leading ^OR",
  encodeConditions([
    { field: "x", oper: "fakeOp", value: "" },
    { field: "state", oper: "eq", value: "2", join: "OR" }
  ]),
  "state=2");

console.log("== buildEncodedQuery ==");

// Conditions fragment MUST come first so ^OR cannot leak past queue scoping.
const q = buildEncodedQuery({
  conditions: [
    { field: "assigned_to", oper: "isEmpty" },
    { field: "state", oper: "eq", value: "2" }
  ],
  groupNames: ["Queue A", "Queue B"]
});
checkTrue("conditions before queue scope",
  q.startsWith("assigned_toISEMPTY^state=2^assignment_group.nameIN"), q);
check("queue IN list encoded", q, "assigned_toISEMPTY^state=2^assignment_group.nameINQueue A,Queue B");

// No conditions -> queue scope only.
check("scope only",
  buildEncodedQuery({ conditions: [], groupNames: ["Solo"] }),
  "assignment_group.nameINSolo");

console.log(failures ? `QUERYBUILDER-TESTS-FAILED (${failures})` : "ALL-QUERYBUILDER-TESTS-PASS");
process.exit(failures ? 1 : 0);
