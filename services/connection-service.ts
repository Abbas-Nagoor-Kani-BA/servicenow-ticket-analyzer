import { RUN_SCOPE_FACTORY, SETTINGS_REPO } from "../di/tokens.ts";
import type { RunScopeFactory } from "../di/tokens.ts";
import type { SettingsRepository } from "../data/repositories/settings-repository.ts";

import { buildEncodedQuery } from "../lib/querybuilder.js";
import { groupScopeOf, scopeGroups } from "./queue-scope.ts";

export type CountRequest = {
  instanceUrl: string;
  groups: string[];
  filters?: Record<string, unknown>;
  filterSets?: { table?: string; conditions?: unknown[]; memberSysIds?: unknown }[];
  onDiagnostic?: (d: any) => void;
};

export type CountResult = {
  total: number;
  encodedQuery: string;
  limit: number;
};

const MAX_LIMIT = 1e5;

/**
 * Preview count for the panel's Run button.
 *
 * Mirrors the pull's queue scoping exactly — the same `groupScopeOf` shape, the
 * same encoded-query ordering — because a preview that counts something
 * different from what the pull fetches is worse than no preview at all.
 */
export class ConnectionService {
  static readonly deps = [RUN_SCOPE_FACTORY, SETTINGS_REPO] as const;

  private readonly scopeFactory: RunScopeFactory;
  private readonly settings: SettingsRepository;

  constructor(scopeFactory: RunScopeFactory, settings: SettingsRepository) {
    this.scopeFactory = scopeFactory;
    this.settings = settings;
  }

  async count(req: CountRequest): Promise<CountResult> {
    const scope = await this.scopeFactory(req.instanceUrl, req.onDiagnostic);
    const table = String(req.filters?.table || "incident");
    const groups = scopeGroups(req.groups);
    const { memberSysIds: _drop, ...filters } = req.filters || {};
    const encodedQuery = buildEncodedQuery({ ...filters, ...groupScopeOf(groups) });

    const total = await scope.tickets.count(table, encodedQuery);
    const settings = await this.settings.load();
    const limit = clampLimit(settings?.params?.maxTicketsPerPull);

    return { total, encodedQuery, limit };
  }
}

function clampLimit(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_LIMIT, Math.max(0, n));
}
