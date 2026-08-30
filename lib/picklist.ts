// Shared mechanics for the MSR/option pickers used by the grid editors
// (70-editors.js) and the ticket popup (50-ticketpop.js). Both had an
// identical copy of the label/filter/paint/scroll logic; the shared
// helpers below keep a single definition.

export function pickCurNotInOptions(options: string[], cur: string | undefined): boolean {
  return !options.some(x => String(x).toLowerCase() === String(cur || "").toLowerCase());
}

export function pickLabelOf(v: string, cur: string | undefined, curNotInOptions: boolean): string {
  return v === "" ? "— clear —"
    : v + (cur && v === cur && curNotInOptions ? " · current" : "");
}

export function pickBaseLabel(v: string): string {
  return v === "" ? "— clear —" : v;
}

export function pickAcronymOf(s: string): string {
  return s.split(/[\s\-\/_,]+/).filter(Boolean).map(w => w[0]).join("").toLowerCase();
}

/**
 * Apply the shared search filter. `q` is the trimmed lowercase query;
 * `refVal` is the value whose position should seed the active item.
 * Returns the filtered items (acronym matches first) plus the active index.
 */
export function applyPickFilter(
  entries: string[],
  q: string,
  refVal: unknown,
  cur: string | undefined
): { items: string[]; activeIdx: number } {
  const notIn = pickCurNotInOptions(entries, cur);
  let items: string[];
  if (!q) {
    items = entries.slice();
  } else {
    const acros: string[] = [];
    const subs: string[] = [];
    for (const v of entries) {
      const hay = pickLabelOf(v, cur, notIn).toLowerCase();
      if (q.length >= 2 && pickAcronymOf(pickBaseLabel(v)).startsWith(q)) acros.push(v);
      else if (hay.includes(q)) subs.push(v);
    }
    items = [...acros, ...subs];
  }
  const ref = String(refVal).trim().toLowerCase();
  const exact = items.findIndex(v => String(v).toLowerCase() === ref);
  return { items, activeIdx: exact >= 0 ? exact : 0 };
}

/**
 * Render the filtered items into the popup. `renderItem(v)` returns a DOM
 * node whose inner text is the display label; the shared active highlight +
 * scroll-to-active is applied here. Returns nothing.
 */
export function paintPickItems(
  listEl: HTMLElement,
  foot: HTMLElement,
  items: string[],
  activeIdx: number,
  renderItem: (v: string, i: number) => HTMLElement
): void {
  listEl.innerHTML = "";
  foot.textContent = `${items.length} option${items.length === 1 ? "" : "s"} \xB7 \u2191\u2193 \xB7 Enter \xB7 Esc`;
  if (!items.length) {
    const d = document.createElement("div");
    d.className = "msrPickItem none";
    d.textContent = "No matching option";
    listEl.appendChild(d);
    return;
  }
  items.forEach((v, i) => {
    const d = renderItem(v, i);
    d.className = "msrPickItem" + (i === activeIdx ? " active" : "");
    listEl.appendChild(d);
  });
  scrollActiveIntoView(listEl, activeIdx);
}

export function scrollActiveIntoView(listEl: HTMLElement, activeIdx: number): void {
  const act = listEl.children[activeIdx] as HTMLElement | undefined;
  if (!act) return;
  const top = act.offsetTop, view = listEl.clientHeight;
  if (top < listEl.scrollTop || top + act.offsetHeight > listEl.scrollTop + view) {
    listEl.scrollTop = Math.max(0, top - view / 2);
  }
}