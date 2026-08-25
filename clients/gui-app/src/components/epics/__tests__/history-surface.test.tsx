import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

interface HistoryRouteMatch {
  readonly search: { readonly historyQuery: string };
  readonly loaderData: { readonly historyNowMs: number };
}

const testState = vi.hoisted<{ match: HistoryRouteMatch | null }>(() => ({
  match: {
    search: { historyQuery: "api" },
    loaderData: { historyNowMs: 123 },
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useMatch: ({ select }: { select: (match: HistoryRouteMatch) => unknown }) =>
    testState.match === null ? undefined : select(testState.match),
}));

vi.mock("@/components/epics/epics-list-panel", () => ({
  EpicsListPanel: (props: {
    readonly historyNowMs: number | null;
    readonly routeSearch: { readonly query: string } | null;
  }) => (
    <div
      data-history-now={String(props.historyNowMs)}
      data-history-query={props.routeSearch?.query ?? ""}
      data-testid="history-list-probe"
    />
  ),
}));

import { HistorySurface } from "@/components/epics/history-surface";

describe("<HistorySurface />", () => {
  afterEach(() => {
    // `globals: false`, so Testing Library registers no automatic teardown and
    // a second render would find the first test's tree still mounted.
    cleanup();
    testState.match = {
      search: { historyQuery: "api" },
      loaderData: { historyNowMs: 123 },
    };
  });

  it("preserves the canonical History route filters and loader clock", () => {
    const view = render(<HistorySurface />);

    const probe = screen.getByTestId("history-list-probe");
    expect(probe.dataset.historyQuery).toBe("api");
    expect(probe.dataset.historyNow).toBe("123");

    testState.match = null;
    view.rerender(<HistorySurface />);

    expect(probe.dataset.historyQuery).toBe("api");
    expect(probe.dataset.historyNow).toBe("123");
  });

  it("puts the list chrome inside the home touch scope", () => {
    // On a phone History is only ever this routed page - never the system-tab
    // modal, whose host is the other place that carries this scope. The
    // coarse-pointer hit-slop rules are DESCENDANT selectors rooted at the
    // attribute, so the list has to sit under it, not merely beside it: the
    // page's chrome (sort, filter, select, refresh) is the same `Button` set
    // the modal renders, and without the scope those are the one History path
    // a finger takes with no enlarged hit area at all.
    render(<HistorySurface />);

    const scope = screen
      .getByTestId("history-surface")
      .closest("[data-home-touch-scope]");

    expect(scope).not.toBeNull();
    expect(scope?.contains(screen.getByTestId("history-list-probe"))).toBe(
      true,
    );
  });
});
