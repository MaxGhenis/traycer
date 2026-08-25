import type { HistoryItem } from "@/components/home/data/home-page.data";

/**
 * Pin availability for a history row, kept OUT of `epics-list-shared.tsx`.
 *
 * These are pure functions, and a module that exports both components and
 * plain values loses Fast Refresh for every component in it
 * (`react-refresh/only-export-components`) - the desktop panel and both mobile
 * surfaces import from here, so that file is one of the most-edited in the
 * package and the one where losing HMR costs the most.
 *
 * The split is also the honest boundary: the rule below is what every
 * responsive surface must agree on, and it has no rendering in it.
 */

/** The reason a history row cannot dispatch the cloud-only pin mutation. */
export type HistoryPinUnavailableReason =
  "phase" | "local-home" | "preserved-orphan";

/**
 * The pin mutation targets a cloud task. Keep its admission rule independent
 * of the desktop/mobile row implementations so each responsive surface, plus
 * other task affordances, makes the same decision.
 */
export function historyPinUnavailableReason(
  item: HistoryItem,
): HistoryPinUnavailableReason | null {
  if (item.taskType === "phase") return "phase";
  if (item.isPreservedOrphan === true) return "preserved-orphan";
  if (item.isLocalHome === true) return "local-home";
  return null;
}

export function historyPinControlLabel(input: {
  readonly displayTitle: string;
  readonly unavailableReason: HistoryPinUnavailableReason | null;
  readonly isPinned: boolean;
}): string {
  if (input.unavailableReason === "preserved-orphan") {
    return `Pinning ${input.displayTitle} is unavailable; its cloud copy was deleted and only this device's edits remain`;
  }
  if (input.unavailableReason === "local-home") {
    return `Pinning ${input.displayTitle} needs cloud sync; it is stored on this device`;
  }
  if (input.unavailableReason === "phase") {
    return `Pinning ${input.displayTitle} is unavailable for phases`;
  }
  return input.isPinned
    ? `Unpin ${input.displayTitle} from top`
    : `Pin ${input.displayTitle} to top`;
}

export function historyPinUnavailableTooltip(
  reason: HistoryPinUnavailableReason,
): string {
  if (reason === "preserved-orphan") {
    return "This epic's cloud copy was deleted. Only this device's edits remain, so it can't be pinned.";
  }
  if (reason === "local-home") {
    return "This epic is stored on this device. Pinning needs cloud sync.";
  }
  return "Phases cannot be pinned.";
}
