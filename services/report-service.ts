import { buildReport, type WalkedRow, type MessageFormatter } from "../core/report.ts";
import { buildSlaSummary, buildSlaSummaryRows, type SlaSummaryItem } from "../core/slasummary.ts";

/*
 * Report and SLA computation for the viewer (core/report.ts + core/slasummary.ts
 * hold the pure work; this service adapts the viewer's two-arg instance-clock
 * formatter to the core one-arg MessageFormatter).
 *
 * The coupling is intentional and load-bearing: fmt normalises dates before the
 * SLA derivation runs, so a non-identity formatter changes derived results (not
 * just displayed text). Keep the cast in exactly this one place.
 */

export type ReportRow = Record<string, any>;
export type ReportFmt = (utcIso: string, row: ReportRow) => string;

export type SlaSummaryResult = ReturnType<typeof buildSlaSummary>;

export class ReportService {
  rep(row: ReportRow, fmt: ReportFmt): Record<string, any> {
    return buildReport(
      row as WalkedRow,
      fmt as unknown as MessageFormatter
    ) as Record<string, any>;
  }

  slaSummary(rows: ReportRow[] | null | undefined, fmt: ReportFmt): SlaSummaryResult {
    return buildSlaSummary(
      (rows || null) as WalkedRow[] | null,
      fmt as unknown as MessageFormatter
    );
  }

  slaSummaryRows(rows: ReportRow[] | null | undefined, fmt: ReportFmt): SlaSummaryItem[] {
    return buildSlaSummaryRows(
      (rows || null) as WalkedRow[] | null,
      fmt as unknown as MessageFormatter
    );
  }
}