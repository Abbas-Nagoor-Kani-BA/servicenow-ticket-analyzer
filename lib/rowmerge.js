
function mergeRows(oldRows, newRows) {
  const byKey = new Map();
  for (const r of oldRows || []) byKey.set(r.sysId || r.number, r);
  for (const r of newRows || []) byKey.set(r.sysId || r.number, r);
  return [...byKey.values()];
}

export {
  mergeRows
};
