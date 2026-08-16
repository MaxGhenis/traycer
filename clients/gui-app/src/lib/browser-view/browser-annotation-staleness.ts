import type { BrowserSessionInfo } from "@traycer/protocol/host/browser/contracts";

import type { BrowserAnnotationRecord } from "@/lib/browser-view/browser-annotation-record";

export type AnnotationStalenessHint = "navigated" | "closed" | null;

export const ANNOTATION_STALENESS_COPY = {
  navigated: "page has navigated",
  closed: "source tab closed",
} as const;

/**
 * Cosmetic composer hint only. Host tab status at send time is ticket 05.
 */
export function annotationStalenessHint(
  record: BrowserAnnotationRecord,
  sessions: ReadonlyArray<BrowserSessionInfo> | null,
): AnnotationStalenessHint {
  if (sessions === null) return null;
  for (const session of sessions) {
    if (session.sessionId !== record.sessionId) continue;
    for (const tab of session.tabs) {
      if (tab.tabId !== record.tabId) continue;
      return tab.url === record.pageUrl ? null : "navigated";
    }
    return "closed";
  }
  return "closed";
}
