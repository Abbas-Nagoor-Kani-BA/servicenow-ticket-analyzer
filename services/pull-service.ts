import { RUN_SCOPE_FACTORY, DATASET_REPO, RUN_STATE_REPO, SETTINGS_REPO } from "../di/tokens.ts";
import type { RunScope, RunScopeFactory } from "../di/tokens.ts";
import type { DatasetRepository, Dataset, RunEntry } from "../data/repositories/dataset-repository.ts";
import type { RunStateRepository } from "../data/repositories/run-state-repository.ts";
import type { SettingsRepository } from "../data/repositories/settings-repository.ts";
import type { TicketRepository } from "../data/repositories/ticket-repository.ts";
import type { TimelineRepository } from "../data/repositories/timeline-repository.ts";
import type { TicketRow } from "../data/repositories/dataset-repository.ts";

import { buildEncodedQuery } from "../lib/querybuilder.js";
import { snStateMap, snTableLabel } from "../lib/statechoices.js";
import { normalizeNames } from "../lib/names.js";
import { mergeRows } from "../lib/rowmerge.js";
import { analyzeAll } from "../analysis/phase2.js";
import { groupScopeOf, scopeGroups } from "./queue-scope.ts";

export type ProgressFn = (stage: string, detail: string, extra?: Record<string, unknown>) => void;

export type RunFilterSet = {
  table?: string;
  conditions?: unknown[];
  memberSysIds?: unknown;
  [key: string]: unknown;
};

export type PullRequest = {
  instanceUrl: string;
  groups: string[];
  filterSets?: RunFilterSet[];
  filters?: Record<string, unknown>;
  fields?: string[];
  signal?: AbortSignal;
  onProgress?: ProgressFn;
  onDiagnostic?: (d: any) => void;
};

export type PullResult = {
  pulled: number;
  total: number;
  missingAudit: number;
  skipped: { matched: number }[];
};

export const DEFAULT_FIELDS = [
  "sys_id",
  "number",
  "state",
  "priority",
  "assignment_group",
  "assigned_to",
  "opened_at",
  "closed_at",
  "short_description",
  "caller_id",
  "category",
  "sys_updated_on",
  "sys_updated_by",
  "cmdb_ci",
  "sys_created_on",
  "incident_state",
  "resolved_at",
  "close_code",
  "close_notes",
  "work_notes",
  "comments"
];

const noProgress: ProgressFn = () => {};

const tableLabel = snTableLabel;

function clampNum(value: unknown, lo: number, hi: number): number | null {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
}

/**
 * The pull pipeline: resolve settings, fetch per filter set, read timelines,
 * apply the four timeline rules, merge and persist.
 *
 * Everything that makes this a "pull" rather than a handful of API calls lives
 * here: queue scoping, the max-tickets guard, the per-table sys_id union, and
 * the merge with whatever is already in the dataset.
 */
export class PullService {
  static readonly deps = [RUN_SCOPE_FACTORY, SETTINGS_REPO, DATASET_REPO, RUN_STATE_REPO] as const;

  private readonly scopeFactory: RunScopeFactory;
  private readonly settings: SettingsRepository;
  private readonly dataset: DatasetRepository;
  private readonly runState: RunStateRepository;

  constructor(
    scopeFactory: RunScopeFactory,
    settings: SettingsRepository,
    dataset: DatasetRepository,
    runState: RunStateRepository
  ) {
    this.scopeFactory = scopeFactory;
    this.settings = settings;
    this.dataset = dataset;
    this.runState = runState;
  }

  async run(req: PullRequest): Promise<PullResult> {
    const progress = req.onProgress ?? noProgress;
    const scope = await this.scopeFactory(req.instanceUrl, req.onDiagnostic);
    const configured = await this.#resolveSettings(req, progress, scope.tickets);

    const sets = Array.isArray(req.filterSets) && req.filterSets.length ? req.filterSets : [req.filters || {}];
    const bundle = await this.#pullFilterSets(scope.tickets, sets, configured, req, progress);

    const analysed = await this.#fetchAllTimelines(scope.timelines, bundle.byTable, configured, req, progress);
    if (!analysed.rows.length) throw new Error("No tickets match this filter list");

    const merged = await this.#persist(analysed, bundle.runEntries, bundle.plannedSum, req, configured, progress);

    return {
      pulled: analysed.rows.length,
      total: merged.length,
      missingAudit: analysed.missingAudit,
      skipped: bundle.runEntries.filter((e) => e.skippedLimit).map((e) => ({ matched: e.matched ?? 0 }))
    };
  }

  async #resolveSettings(req: PullRequest, progress: ProgressFn, tickets: TicketRepository) {
    const settings = await this.settings.load();
    const groups = scopeGroups(req.groups);
    const groupScope = groupScopeOf(groups);

    progress("resolve", `Queues (from settings): ${groups.join(", ")}`);

    const teamNames = normalizeNames(settings?.defaults?.teamMembers || []);
    if (!teamNames.length) {
      progress("resolve", "No team members configured \u2014 acknowledgement dates will stay empty");
    } else {
      progress("resolve", `${teamNames.length} team member(s) configured for acknowledgement detection`);
    }

    const membersByQueue = Object.fromEntries(groups.map((g) => [g, teamNames]));
    const maxTickets = clampNum(settings?.params?.maxTicketsPerPull, 0, 1e5) ?? 0;
    const cacheTtl = clampNum(settings?.params?.cacheTtlMinutes, 0, 1e5);
    if (cacheTtl !== null) tickets.setQueryTtlMinutes(cacheTtl);
    if (maxTickets > 0) progress("resolve", `Max tickets per filter set: ${maxTickets}`);

    return { groups, groupScope, teamNames, membersByQueue, maxTickets };
  }

  async #pullFilterSets(
    tickets: TicketRepository,
    sets: RunFilterSet[],
    configured: { groupScope: { groupNames: string[] }; maxTickets: number },
    req: PullRequest,
    progress: ProgressFn
  ) {
    const byTable = new Map<string, Map<string, TicketRow>>();
    const runEntries: RunEntry[] = [];
    let plannedSum = 0;
    let pulledDone = 0;

    for (let i = 0; i < sets.length; i++) {
      const table = sets[i].table || "incident";
      const label = `Filter ${i + 1}/${sets.length}`;
      const { memberSysIds: _drop, ...rest } = sets[i];
      const encodedQuery = buildEncodedQuery({ ...rest, ...configured.groupScope });

      progress("count", `${label}: counting...`);
      const total = await tickets.count(table, encodedQuery);
      progress("count", `${label}: ${total} tickets matched`);

      if (configured.maxTickets > 0 && total > configured.maxTickets) {
        progress(
          "limit",
          `${label}: LIMIT \u2014 ${total} tickets match but the maximum is ${configured.maxTickets} (Settings). Set skipped \u2014 narrow the filter or raise the limit`
        );
        runEntries.push({
          at: "",
          table,
          group: "",
          query: encodedQuery,
          pulled: 0,
          skippedLimit: true,
          matched: total
        });
        continue;
      }

      if (total === 0) {
        runEntries.push({ at: "", table, group: "", query: encodedQuery, pulled: 0 });
        continue;
      }

      progress("phase1", `${label}: pulling ${total} tickets...`);
      const { records, source, cachedAt } = await tickets.list({
        table,
        encodedQuery,
        fields: req.fields || DEFAULT_FIELDS,
        signal: req.signal,
        onProgress: (p) => progress("phase1", `${label}: phase1 ${p.fetched}/${total} tickets`)
      });

      if (source === "cache") {
        const ageMin = Math.max(1, Math.round((Date.now() - (cachedAt || Date.now())) / 6e4));
        progress("phase1", `${label}: CACHE HIT \u2014 reused ${records.length} tickets from ${ageMin} min ago (no API calls)`);
      }

      pulledDone += records.length;
      plannedSum += total;
      progress("phase1", `${label}: ${records.length} tickets`, { pulled: pulledDone, planned: plannedSum });

      if (!byTable.has(table)) byTable.set(table, new Map());
      const bucket = byTable.get(table) as Map<string, TicketRow>;
      let fresh = 0;
      for (const record of records) {
        const id = String(record.sys_id?.value || record.sys_id || "");
        if (id && !bucket.has(id)) {
          bucket.set(id, record);
          fresh++;
        }
      }

      runEntries.push({
        at: "",
        table,
        group: "",
        query: encodedQuery,
        pulled: records.length,
        new: fresh,
        cached: source === "cache",
        cacheAt: cachedAt || null
      });
    }

    return { byTable, runEntries, plannedSum };
  }

  async #fetchAllTimelines(
    timelines: TimelineRepository,
    byTable: Map<string, Map<string, TicketRow>>,
    configured: { membersByQueue: Record<string, string[]>; teamNames: string[] },
    req: PullRequest,
    progress: ProgressFn
  ) {
    const rows: TicketRow[] = [];
    const auditCounts: Record<string, number> = {};
    const sampleAuditRows: { sysId: string; rows: number }[] = [];
    let missingAuditTotal = 0;
    let sampleRecord: TicketRow | null = null;

    for (const [table, bucket] of byTable) {
      const records = [...bucket.values()];
      if (!records.length) continue;

      const tLabel = tableLabel(table);
      const sysIds = records.map((r) => String(r.sys_id?.value || r.sys_id || "")).filter(Boolean);
      progress("phase2", `Phase 2 (${tLabel}): activity feed for ${sysIds.length} tickets...`);

      const { events: eventsByTicket, reused } = await timelines.getMany({
        table,
        tickets: records.map((r) => ({
          sysId: String(r.sys_id?.value || r.sys_id || ""),
          updatedOn: String(r.sys_updated_on?.value || r.sys_updated_on || "")
        })),
        signal: req.signal,
        onProgress: (p) => progress("phase2", `Phase 2 (${tLabel}): activity ticket ${p.ticketsDone}/${p.total}`)
      });

      if (reused) {
        progress("phase2", `Phase 2 (${tLabel}): ${reused}/${sysIds.length} timelines reused from cache`);
      }

      const eventsObject: Record<string, unknown[]> = {};
      for (const [sysId, events] of eventsByTicket) eventsObject[sysId] = events;

      progress("analyze", `Applying timeline rules (${tLabel})...`);
      const { rows: tableRows, missingAudit } = analyzeAll(records, eventsObject, snStateMap(table), {
        membersByQueue: configured.membersByQueue,
        fallbackMembers: configured.teamNames,
        tableName: table
      });

      auditCounts[table] = Object.keys(eventsObject).length;
      if (!sampleRecord) sampleRecord = records[0] || null;
      if (!sampleAuditRows.length) {
        sampleAuditRows.push(
          ...Object.entries(eventsObject)
            .slice(0, 3)
            .map(([k, v]) => ({ sysId: k.slice(0, 8), rows: v.length }))
        );
      }
      rows.push(...tableRows);
      missingAuditTotal += missingAudit;
    }

    return { rows, missingAudit: missingAuditTotal, auditCounts, sampleAuditRows, sampleRecord };
  }

  async #persist(
    analysed: {
      rows: TicketRow[];
      missingAudit: number;
      auditCounts: Record<string, number>;
      sampleAuditRows: { sysId: string; rows: number }[];
      sampleRecord: TicketRow | null;
    },
    runEntries: RunEntry[],
    plannedSum: number,
    req: PullRequest,
    configured: { groups: string[] },
    progress: ProgressFn
  ): Promise<TicketRow[]> {
    const previous = await this.dataset.load();
    const merged = mergeRows(previous?.rows || [], analysed.rows);
    const at = new Date().toISOString();
    const group = configured.groups.join(", ");

    const runs = [
      ...(previous?.runs || []),
      ...runEntries.map((e) => ({ ...e, at, group }))
    ];

    const dataset: Dataset = {
      at,
      instance: req.instanceUrl,
      missingAudit: (previous?.missingAudit || 0) + analysed.missingAudit,
      totalPulled: merged.length,
      debug: {
        sampleRecord: analysed.sampleRecord,
        ticketsWithAudit: Object.values(analysed.auditCounts).reduce((a, b) => a + b, 0),
        auditCountsByTable: analysed.auditCounts,
        sampleAuditRowCounts: analysed.sampleAuditRows,
        sampleTimelines: analysed.rows
          .filter(
            (r) =>
              r.assignTimeUtcIso || r.acknTimeUtcIso || r.suspendTimeUtcIso || r.resumeTimeUtcIso
          )
          .slice(0, 3)
          .map((r) => ({
            number: r.number,
            assign: r.assignTimeUtcIso,
            ackn: r.acknTimeUtcIso,
            suspend: r.suspendTimeUtcIso,
            resume: r.resumeTimeUtcIso
          }))
      },
      runs,
      rows: merged
    };

    await this.dataset.save(dataset);
    await this.runState.save({
      at,
      instance: req.instanceUrl,
      query: runEntries.map((e) => `[${tableLabel(e.table)}] ${e.query}`).join(" | "),
      group,
      tickets: analysed.rows.length
    });
    await this.dataset.broadcastChanged();

    const skipped = runEntries.filter((e) => e.skippedLimit);
    progress(
      "done",
      `Run complete: ${analysed.rows.length} pulled \xB7 ${merged.length} total in view` +
        (analysed.missingAudit ? ` \xB7 ${analysed.missingAudit} had no audit data` : "") +
        (skipped.length
          ? ` \xB7 ${skipped.length} filter set(s) SKIPPED by max-tickets limit (${skipped
              .map((e) => e.matched)
              .join(", ")} matched) \u2014 raise the limit in Settings to include them`
          : ""),
      { pulled: analysed.rows.length, planned: plannedSum }
    );

    return merged;
  }
}

export type { RunScope };
