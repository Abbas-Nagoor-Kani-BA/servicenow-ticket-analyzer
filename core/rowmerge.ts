type KeyedRow = { sysId?: string; number?: string };

function mergeRows<T extends KeyedRow>(oldRows: T[] | null | undefined, newRows: T[] | null | undefined): T[] {
  const byKey = new Map<string | undefined, T>();
  for (const r of oldRows || []) byKey.set(r.sysId || r.number, r);
  for (const r of newRows || []) byKey.set(r.sysId || r.number, r);
  return [...byKey.values()];
}

export {
  mergeRows
};