import { useState } from "react";
import { useMatch } from "@tanstack/react-router";
import { EpicsListPanel } from "@/components/epics/epics-list-panel";
import { parseHistorySearch } from "@/lib/history-search";
import "@/components/home/home-touch-targets.css";

/** Route-independent History body retained by the top-level surface host. */
export function HistorySurface() {
  const route = useMatch({
    from: "/epics/",
    shouldThrow: false,
    select: (match) => ({
      routeSearch: parseHistorySearch(match.search),
      historyNowMs: match.loaderData?.historyNowMs ?? null,
    }),
    structuralSharing: true,
  });
  const [lastRoute, setLastRoute] = useState(route ?? null);

  if (route !== undefined && route !== lastRoute) {
    setLastRoute(route);
  }

  const history = route ?? lastRoute;
  const routeSearch = history?.routeSearch ?? parseHistorySearch({});

  return (
    <div
      // The list chrome (sort, filter, select, refresh, clear) is the same
      // `Button` set the system-tab modal renders, and the modal's host carries
      // this scope. On a phone History is only ever the routed `/epics` page —
      // never the modal — so without the scope here the one path a phone takes
      // is the one path with no hit-area slop.
      data-home-touch-scope=""
      className="flex min-h-0 flex-1 flex-col"
      data-testid="history-surface"
    >
      <EpicsListPanel
        variant="page"
        className={undefined}
        onSelectEpic={null}
        onOpenItem={null}
        routeSearch={routeSearch}
        historyNowMs={history?.historyNowMs ?? null}
        autoFocusSearch={false}
      />
    </div>
  );
}
