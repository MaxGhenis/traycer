import type { PipBurstOutcome } from "./pip-store";

export function pipOutcomeLine(
  outcome: PipBurstOutcome | null,
  site: string | null,
): string {
  const where = site !== null && site.length > 0 ? ` on ${site}` : "";
  if (outcome === "closed") return `Tab closed${where}`;
  if (outcome === "crashed") return `Tab crashed${where}`;
  if (outcome === "suspended") return `Tab suspended${where}`;
  return `Agent finished${where}`;
}

export function pipGoneTabCopy(): string {
  return "This tab is gone";
}
