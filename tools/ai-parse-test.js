#!/usr/bin/env node
import { extractHeuristic } from "../core/aiextract.js";

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok ? "" : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}

const HIGH = { solutionType: "high", rootCause: "high" };
const MED_S = { solutionType: "medium", rootCause: "" };

console.log("== extractHeuristic (regex + fuzzy sections) ==");
check("labeled permanent note fully resolved",
  extractHeuristic(`the issue: Users could not log in.
steps taken to resolve: Replaced the expired SAML certificate.
is it permanent solution: Yes
root cause: Expired SAML signing certificate`),
  { solutionType: "Permanent solution", rootCause: "Expired SAML signing certificate", confidence: { solutionType: "medium", rootCause: "high" } });

check("labeled No resolves to workaround",
  extractHeuristic(`the issue: Report page timed out.
steps taken to resolve: Restarted the reporting worker.
is it permanent solution: No - monitoring for now
root cause: Memory leak in worker`),
  { solutionType: "Workaround solution", rootCause: "Memory leak in worker", confidence: { solutionType: "medium", rootCause: "high" } });

check("prose permanent fix + labeled root cause",
  extractHeuristic(`Search returned no results. Rebuilt the index and verified. This is a permanent fix.
Root cause: index rebuild step missing from upgrade runbook.`),
  { solutionType: "Permanent solution", rootCause: "index rebuild step missing from upgrade runbook", confidence: { solutionType: "medium", rootCause: "high" } });

check("root cause was/is sentence form (fallback => medium)",
  extractHeuristic("Permanent solution applied at root cause level. Root cause was unbounded connection growth from misconfigured cron."),
  { solutionType: "Permanent solution", rootCause: "unbounded connection growth from misconfigured cron", confidence: { solutionType: "medium", rootCause: "medium" } });

check("vague restart note yields nothing",
  extractHeuristic("Restarted the server, everything is working fine now."),
  { solutionType: "", rootCause: "", confidence: MED_S === null ? {} : { solutionType: "", rootCause: "" } });

check("temporary keyword partial (no root cause)",
  extractHeuristic("Cleared paper jam and reinstalled driver as temporary measure."),
  { solutionType: "Workaround solution", rootCause: "", confidence: { solutionType: "medium", rootCause: "" } });

check("vendor deferral wording detected",
  extractHeuristic(`Disabled the failing integration until vendor provides a patch.
root cause: Vendor API returns 500 on batch payloads larger than 100 records`),
  { solutionType: "Workaround solution", rootCause: "Vendor API returns 500 on batch payloads larger than 100 records", confidence: { solutionType: "medium", rootCause: "high" } });

console.log("\n== real-world resolution note formats ==");
check("content.txt style: Analysis (Root Cause) multi-line + Resolution Type inline",
  extractHeuristic(`Issue: User is unable to see the latest enhancements made to the application.

Impact: User is unable to fully utilize the new changes.

Analysis (Root Cause): The UI changes deployed on Monday were not reflecting for all users due to browser caching. When the application was redeployed, static assets retained the same filenames so browsers served cached versions.

Steps Taken to Resolve: Requested user to do a hard refresh (Ctrl+Shift+R) to clear the browser cache.

Resolution Type: Permanent Fix

Preventive Actions: NA
Problem Ticket Required?: No
Resolved by Supplier?: No`),
  { solutionType: "Permanent solution", rootCause: "The UI changes deployed on Monday were not reflecting for all users due to browser caching. When the application was redeployed, static assets retained the same filenames so browsers served cached versions", confidence: HIGH });

check("numbered sections with value on next line",
  extractHeuristic(`1. Issue:
Arrival tasks were not created for flights BA292, BA188 and BA280.

3. Analysis (Root Cause):
Health checks confirmed all services were running normally. A conclusive RCA could not be completed.

4. Steps Taken to Resolve:
Engaged RTO to validate MQ message flow.

5. Resolution Type:
Workaround / Monitoring Completed

6. Preventive Actions:
Raise a Problem Ticket.`),
  { solutionType: "Workaround solution", rootCause: "Health checks confirmed all services were running normally. A conclusive RCA could not be completed", confidence: HIGH });

check("colon-less labels and CRLF line endings",
  extractHeuristic(`Issue:\r\nUser could not access the Alert application.\r\n\r\nAnalysis (Root Cause)\r\nAccess automatically revoked after a year of inactivity.\r\n\r\nResolution Type\r\nPermanent\r\n`),
  { solutionType: "Permanent solution", rootCause: "Access automatically revoked after a year of inactivity", confidence: HIGH });

console.log("\n== fuzzy matching ==");
check("typo'd section label 'Resoultion Type' still matched",
  extractHeuristic(`Analysis (Root Cause): Cache was stale on the replica nodes.
Resoultion Type: Permanent Fix`),
  { solutionType: "Permanent solution", rootCause: "Cache was stale on the replica nodes", confidence: HIGH });

check("typo'd label + typo'd value 'Permanant'",
  extractHeuristic(`Root Cause Analysed: DNS TTL too low.
Resoultion Type:
Permanant fix`),
  { solutionType: "Permanent solution", rootCause: "DNS TTL too low", confidence: HIGH });

check("'RCA' shorthand header recognized",
  extractHeuristic(`RCA:
Index fragmentation caused slow scans.
Steps Taken: Rebuilt indexes.`),
  { solutionType: "", rootCause: "Index fragmentation caused slow scans", confidence: { solutionType: "", rootCause: "high" } });

check("body sentence starting with 'Impact' not mistaken for header",
  extractHeuristic(`Analysis (Root Cause): We confirmed there was no impact because impact assessment found all services healthy and running normally throughout the window. Monitoring stayed green.
Resolution Type: Workaround`),
  { solutionType: "Workaround solution", rootCause: "We confirmed there was no impact because impact assessment found all services healthy and running normally throughout the window. Monitoring stayed green", confidence: HIGH });

check("unknown resolution type 'education' maps to Workaround bucket",
  extractHeuristic(`Analysis (Root Cause): User educated on correct procedure.
Resolution Type: User education provided`),
  { solutionType: "Workaround solution", rootCause: "User educated on correct procedure", confidence: HIGH });

check("genuinely unknown resolution type passed through verbatim",
  extractHeuristic(`Analysis (Root Cause): Vendor applied hotfix build 4721.
Resolution Type: Vendor hotfix applied`),
  { solutionType: "Vendor hotfix applied", rootCause: "Vendor applied hotfix build 4721", confidence: HIGH });

check("empty notes", extractHeuristic(""), { solutionType: "", rootCause: "", confidence: { solutionType: "", rootCause: "" } });

console.log(`\nai-extract: ${failed ? failed + " FAILED" : "all passed"}`);
process.exit(failed ? 1 : 0);
