import { $, el } from "./core.ts";
import { currentRows } from "./grid-data.ts";
import { fmtInstant } from "./grid.ts";
import { buildTicketStats } from "../../core/ticketstats.ts";
import type { TicketStats, SlaTally } from "../../core/ticketstats.ts";
import { Modal } from "../../components/modal.ts";
import { iconize } from "../../lib/icons.ts";
import type { InstantFn } from "./core.ts";

let modal: Modal;

function renderStats(stats: TicketStats): void {
  const body = $("ticketStatsBody") as HTMLElement;
  body.innerHTML = "";

  // Section 1: per ticket type, a heading then its state counts.
  const statesSection = el("div", "stats-section");
  const h1 = el("h3", "stats-h");
  h1.textContent = `Tickets (${stats.total})`;
  statesSection.appendChild(h1);

  if (!stats.types.length) {
    const none = el("div", "text-dim");
    none.textContent = "No tickets in the current view";
    statesSection.appendChild(none);
  }

  for (const grp of stats.types) {
    const typeHead = el("div", "stats-type-head");
    typeHead.textContent = `${grp.type} (${grp.count})`;
    statesSection.appendChild(typeHead);

    const list = el("div", "stats-chips");
    for (const s of grp.states) {
      const chip = el("div", "stats-chip");
      const count = el("span", "stats-chip-count");
      count.textContent = String(s.count);
      const name = el("span", "stats-chip-label");
      name.textContent = s.state;
      chip.append(count, name);
      list.appendChild(chip);
    }
    statesSection.appendChild(list);
  }

  // Section 2: SLA met/breached over closed tickets only.
  const slaSection = el("div", "stats-section");
  const h2 = el("h3", "stats-h");
  h2.textContent = `SLA — closed tickets (${stats.closedTotal})`;
  slaSection.appendChild(h2);

  if (stats.closedTotal) {
    const slaTable = document.createElement("table");
    slaTable.className = "stats-table";
    const slaBody = document.createElement("tbody");
    const rows: Array<[string, SlaTally]> = [
      ["Response SLA", stats.response],
      ["Min resolution SLA", stats.minResolution],
      ["Max resolution SLA", stats.maxResolution]
    ];
    for (const [label, tally] of rows) {
      const tr = document.createElement("tr");
      const l = document.createElement("td");
      l.textContent = label;
      const v = document.createElement("td");
      v.className = "num";
      const met = el("span", "sla-met");
      met.textContent = `${tally.met} met`;
      const sep = document.createTextNode(" / ");
      const br = el("span", "sla-br");
      br.textContent = `${tally.breached} breached`;
      v.append(met, sep, br);
      tr.append(l, v);
      slaBody.appendChild(tr);
    }
    slaTable.appendChild(slaBody);
    slaSection.appendChild(slaTable);
  } else {
    const none = el("div", "text-dim");
    none.textContent = "No closed tickets in the current view";
    slaSection.appendChild(none);
  }

  body.append(statesSection, slaSection);
}

export function openTicketStats(): void {
  const stats = buildTicketStats(currentRows(), fmtInstant as InstantFn);
  renderStats(stats);
  modal.open();
}

export function initTicketStats(): void {
  modal = new Modal($("ticketStatsModal"), {}, {});
  const btn = $("ticketStatsBtn") as HTMLButtonElement;
  iconize(btn, "chart-line", { mode: "icon", tip: "Ticket stats", label: "Ticket stats" });
  btn.addEventListener("click", () => openTicketStats());
  const close = $("ticketStatsClose");
  if (close) close.addEventListener("click", () => modal.close());
}
