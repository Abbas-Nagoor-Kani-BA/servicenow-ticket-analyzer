/**
 * Queue scoping shared by the preview count and the pull.
 *
 * Both must scope identically: a preview that counts something different from
 * what the pull fetches is worse than no preview at all. Hence one
 * implementation rather than two that agree by coincidence.
 */
export function scopeGroups(groups: unknown): string[] {
  const list = Array.isArray(groups) ? groups : [];
  const unique = [
    ...new Set(
      list
        .map((g) => String((typeof g === "string" ? g : (g as { name?: unknown })?.name) || "").trim())
        .filter(Boolean)
    )
  ];

  if (!unique.length) {
    throw new Error(
      "No queues configured \u2014 open Settings and add assignment group names, one per line"
    );
  }

  const badComma = unique.find((g) => g.includes(","));
  if (badComma) {
    throw new Error(
      `Queue name "${badComma}" contains a comma \u2014 commas cannot be used in queue scope (assignment_group.nameIN list). Rename the queue in Settings`
    );
  }

  return unique;
}

export function groupScopeOf(groupNames: string[]): { groupNames: string[] } {
  return { groupNames };
}
