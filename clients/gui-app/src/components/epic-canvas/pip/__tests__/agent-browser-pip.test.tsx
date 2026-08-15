import "../../../../../__tests__/test-browser-apis";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserScreencastServerFrame } from "@traycer/protocol/host/browser/contracts";
import type {
  BrowserSessionInfo,
  BrowserTabInfo,
} from "@traycer/protocol/host/browser/contracts";
import type { BrowserSessionsState } from "@/components/epic-canvas/renderers/browser-sessions-context";
import { AgentBrowserPip } from "@/components/epic-canvas/pip/agent-browser-pip";
import type { BrowserViewTileKey } from "@/lib/browser-view/desktop-browser-view";
import {
  applyPipBurstEnded,
  applyPipBurstStarted,
  applyPipCaption,
  getPipSnapshot,
  PIP_CAPTION_FADE_MS,
  PIP_CAPTION_HOLD_MS,
  PIP_LINGER_MS,
  resetPipStoreForTests,
  setPipActiveHostId,
  setPipNowForTests,
} from "@/lib/browser-view/pip-store";
import {
  getPipEpicSessionItems,
  resetPipEpicSessionsForTests,
  setPipEpicSessionItemsForTests,
} from "@/lib/browser-view/pip-epic-sessions";
import { resetVisibleBrowserTileRegistryForTests } from "@/lib/browser-view/visible-tile-registry";
import {
  findOpenArtifactInTab,
  useEpicCanvasStore,
} from "@/stores/epics/canvas/store";
import { makeBrowserSessionTileRef } from "@/stores/epics/canvas/tile-schema/browser-tile";

const EPIC = "epic-1";
const VIEW_TAB = "view-tab-1";

const TILE_KEY: BrowserViewTileKey = {
  viewTabId: VIEW_TAB,
  paneId: "pane-1",
  tileInstanceId: "tile-1",
  pageSessionId: "page-1",
};

const sessionsState = vi.hoisted<{ value: BrowserSessionsState }>(() => ({
  value: {
    lifecycle: "live",
    items: [],
    errorMessage: null,
    routingChatId: "chat-1",
    closeSession: () => undefined,
    requestPromoteState: vi.fn(),
    requestLendStorage: vi.fn(),
  },
}));

const chatsState = vi.hoisted(() => ({
  value: [{ id: "chat-1", title: "fix-billing" }],
}));

const navigateNested = vi.hoisted(() =>
  vi.fn((_epicId: string, _tabId: string, prepare: () => unknown) => prepare()),
);

const bindingState = vi.hoisted(() => ({
  value: null as { readonly tileKey: BrowserViewTileKey } | null,
}));

const pipCaptureState = vi.hoisted(() => {
  const handlers: Array<
    (frame: BrowserScreencastServerFrame, jpegBytes: Uint8Array | null) => void
  > = [];
  return {
    start: vi.fn(),
    stop: vi.fn(),
    onFrame: vi.fn(
      (
        handler: (
          frame: BrowserScreencastServerFrame,
          jpegBytes: Uint8Array | null,
        ) => void,
      ) => {
        handlers.push(handler);
        return {
          dispose: () => {
            const index = handlers.indexOf(handler);
            if (index >= 0) handlers.splice(index, 1);
          },
        };
      },
    ),
    handlers,
    emit(
      frame: BrowserScreencastServerFrame,
      jpegBytes: Uint8Array | null,
    ): void {
      for (const handler of handlers) handler(frame, jpegBytes);
    },
    reset(): void {
      handlers.length = 0;
      pipCaptureState.start.mockClear();
      pipCaptureState.stop.mockClear();
      pipCaptureState.onFrame.mockClear();
    },
  };
});

vi.mock("@/components/epic-canvas/renderers/browser-sessions-context", () => ({
  useBrowserSessionsContext: () => sessionsState.value,
}));

vi.mock("@/lib/epic-selectors", () => ({
  useEpicChatRecords: () => chatsState.value,
}));

vi.mock("@/hooks/host/use-reactive-active-host-id", () => ({
  useReactiveActiveHostId: () => "host-a",
}));

vi.mock("@/hooks/epic/use-epic-nested-focus-navigation", () => ({
  useEpicNestedFocusNavigation: () => navigateNested,
}));

vi.mock("@/hooks/host/use-host-directory-entry", () => ({
  useHostDirectoryEntry: () => ({ hostId: "host-b", label: "devbox" }),
}));

vi.mock("@/lib/host/stream-auth-revalidator", () => ({
  useStreamAuthRevalidator: () => null,
}));

vi.mock("@/hooks/host/use-host-stream-client-for", () => ({
  useHostStreamClientFor: () => null,
}));

vi.mock("@/providers/use-runner-host", () => ({
  useRunnerHostOrNull: () => ({ pipCapture: pipCaptureState }),
}));

vi.mock("@/lib/browser-view/electron-browser-tab-store", () => ({
  findElectronBrowserTabBinding: () => bindingState.value,
}));

function tab(
  overrides: Partial<BrowserTabInfo> & Pick<BrowserTabInfo, "tabId" | "url">,
): BrowserTabInfo {
  return {
    originTier: "dev",
    status: "ready",
    title: null,
    viewed: false,
    drivenBy: [],
    ...overrides,
  };
}

function session(
  overrides: Partial<BrowserSessionInfo> &
    Pick<BrowserSessionInfo, "sessionId" | "name" | "tabs">,
): BrowserSessionInfo {
  return {
    epicId: EPIC,
    hostId: "host-a",
    profile: "primary",
    createdBy: { chatId: "chat-1", agentRunId: "run-1" },
    createdAt: 1,
    lastActivityAt: 2,
    ...overrides,
  };
}

function seedSessions(): void {
  const items = [
    session({
      sessionId: "s1",
      name: "Main",
      tabs: [
        tab({
          tabId: "t1",
          url: "https://checkout.stripe.com/pay",
          title: "Checkout - Stripe",
        }),
      ],
    }),
    session({
      sessionId: "s2",
      name: "Other",
      tabs: [
        tab({
          tabId: "t2",
          url: "https://app.example/other",
          title: "Other tab",
        }),
      ],
    }),
    session({
      sessionId: "s3",
      name: "Third",
      tabs: [
        tab({
          tabId: "t3",
          url: "https://app.example/third",
          title: "Third tab",
        }),
      ],
    }),
  ];
  sessionsState.value = {
    ...sessionsState.value,
    items,
  };
  setPipEpicSessionItemsForTests(EPIC, items);
}

function startBurst(input: {
  readonly burstId: string;
  readonly sessionId: string;
  readonly tabId: string;
  readonly startedAt: number;
}): void {
  applyPipBurstStarted({
    epicId: EPIC,
    hostId: "host-a",
    sessionId: input.sessionId,
    tabId: input.tabId,
    burstId: input.burstId,
    chatId: "chat-1",
    startedAt: input.startedAt,
  });
}

function endBurst(
  burstId: string,
  outcome: "finished" | "closed" | "crashed" | "suspended",
  endedAt: number,
): void {
  applyPipBurstEnded({
    epicId: EPIC,
    burstId,
    outcome,
    endedAt,
  });
}

function seedCanvasTab(): void {
  useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
  useEpicCanvasStore.setState({
    tabsById: {
      [VIEW_TAB]: {
        tabId: VIEW_TAB,
        epicId: EPIC,
        name: "Epic 1",
      },
    },
  });
}

function renderPip(): void {
  render(<AgentBrowserPip epicId={EPIC} viewTabId={VIEW_TAB} surfaceVisible />);
}

describe("AgentBrowserPip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPipStoreForTests();
    resetPipEpicSessionsForTests();
    resetVisibleBrowserTileRegistryForTests();
    setPipNowForTests(() => Date.now());
    setPipActiveHostId("host-a");
    seedCanvasTab();
    seedSessions();
    bindingState.value = null;
    pipCaptureState.reset();
    navigateNested.mockClear();
    URL.createObjectURL = vi.fn(() => "blob:pip-frame");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
    resetPipStoreForTests();
    resetPipEpicSessionsForTests();
    resetVisibleBrowserTileRegistryForTests();
    useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
    vi.useRealTimers();
  });

  it("renders live header copy, overlay marker, and dataset attributes", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    renderPip();

    const root = screen.getByTestId("agent-browser-pip");
    expect(root.getAttribute("data-browser-overlay")).toBe("pip");
    expect(root.getAttribute("data-pip-phase")).toBe("live");
    expect(root.getAttribute("data-pip-burst-id")).toBe("b1");
    expect(root.getAttribute("data-pip-outcome")).toBe("");
    expect(root.getAttribute("data-pip-health")).toBe("live");
    expect(root.getAttribute("data-pip-open-enabled")).toBe("true");
    expect(screen.getByText("Checkout - Stripe")).toBeTruthy();
    expect(screen.getByText("fix-billing")).toBeTruthy();
    expect(
      screen
        .getByTestId("agent-browser-pip-pulse")
        .getAttribute("data-pip-pulse"),
    ).toBe("live");
  });

  it("shows the finished outcome line after the burst ends", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    endBurst("b1", "finished", 2);
    renderPip();

    const root = screen.getByTestId("agent-browser-pip");
    expect(root.getAttribute("data-pip-phase")).toBe("finished");
    expect(root.getAttribute("data-pip-outcome")).toBe("finished");
    expect(screen.getByTestId("agent-browser-pip-finished").textContent).toBe(
      "Agent finished on checkout.stripe.com",
    );
    expect(
      screen
        .getByTestId("agent-browser-pip-pulse")
        .getAttribute("data-pip-pulse"),
    ).toBe("off");
  });

  it("shows chip copy after linger and re-expands on chip click", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    endBurst("b1", "finished", 2);
    act(() => {
      vi.advanceTimersByTime(PIP_LINGER_MS);
    });
    renderPip();

    const root = screen.getByTestId("agent-browser-pip");
    expect(root.getAttribute("data-pip-phase")).toBe("chip");
    expect(screen.getByTestId("agent-browser-pip-chip").textContent).toContain(
      "Agent finished on checkout.stripe.com",
    );

    fireEvent.click(screen.getByTestId("agent-browser-pip-chip"));
    expect(getPipSnapshot(EPIC).phase).toBe("finished");
    expect(
      screen.getByTestId("agent-browser-pip").getAttribute("data-pip-phase"),
    ).toBe("finished");
  });

  it("dismisses the chip", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    endBurst("b1", "finished", 2);
    act(() => {
      vi.advanceTimersByTime(PIP_LINGER_MS);
    });
    renderPip();

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss finished browser" }),
    );
    expect(getPipSnapshot(EPIC).phase).toBe("hidden");
    expect(screen.queryByTestId("agent-browser-pip")).toBeNull();
  });

  it("disables open-tile for a closed tab and shows gone copy", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    endBurst("b1", "closed", 2);
    renderPip();

    const root = screen.getByTestId("agent-browser-pip");
    expect(root.getAttribute("data-pip-outcome")).toBe("closed");
    expect(root.getAttribute("data-pip-open-enabled")).toBe("false");
    const open = screen.getByTestId("agent-browser-pip-open");
    expect(open).toHaveProperty("disabled", true);
    expect(open.getAttribute("aria-label")).toBe("This tab is gone");
    expect(screen.getByTestId("agent-browser-pip-gone").textContent).toBe(
      "This tab is gone",
    );
  });

  it("shows the more-active badge for other live bursts", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: 2,
    });
    startBurst({
      burstId: "b3",
      sessionId: "s3",
      tabId: "t3",
      startedAt: 3,
    });
    renderPip();

    expect(screen.getByTestId("agent-browser-pip-more").textContent).toBe(
      "2 more active",
    );
  });

  it("close dismisses the live PiP", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    renderPip();

    fireEvent.click(screen.getByTestId("agent-browser-pip-close"));
    expect(getPipSnapshot(EPIC).phase).toBe("dismissed-burst");
    expect(screen.queryByTestId("agent-browser-pip")).toBeNull();
  });

  it("does not render when the surface is hidden", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    render(
      <AgentBrowserPip
        epicId={EPIC}
        viewTabId={VIEW_TAB}
        surfaceVisible={false}
      />,
    );
    expect(screen.queryByTestId("agent-browser-pip")).toBeNull();
  });

  it("paints a fake pipCapture frame when a native binding exists", () => {
    bindingState.value = { tileKey: TILE_KEY };
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    renderPip();

    act(() => {
      pipCaptureState.emit(
        {
          kind: "frame",
          hasBinaryPayload: true,
          sequence: 1,
          metadata: {
            offsetTop: 0,
            pageScaleFactor: 1,
            deviceWidth: 320,
            deviceHeight: 200,
            scrollOffsetX: 0,
            scrollOffsetY: 0,
            timestamp: 1,
          },
        },
        new Uint8Array([1, 2, 3]),
      );
    });

    const frame = screen.getByTestId("agent-browser-pip-frame");
    const image = frame.querySelector("img");
    expect(image?.getAttribute("src")).toBe("blob:pip-frame");
    expect(pipCaptureState.start).toHaveBeenCalled();
  });

  it("shows the host label when the displayed burst is not on the active host", () => {
    const hostB = session({
      sessionId: "s-b",
      name: "Remote",
      hostId: "host-b",
      tabs: [
        tab({
          tabId: "t-b",
          url: "https://devbox.example/pay",
          title: "Remote checkout",
        }),
      ],
    });
    setPipEpicSessionItemsForTests(EPIC, [
      ...getPipEpicSessionItems(EPIC),
      hostB,
    ]);
    applyPipBurstStarted({
      epicId: EPIC,
      hostId: "host-b",
      sessionId: "s-b",
      tabId: "t-b",
      burstId: "burst-b",
      chatId: "chat-1",
      startedAt: 1,
    });
    renderPip();

    const root = screen.getByTestId("agent-browser-pip");
    expect(root.getAttribute("data-pip-host-id")).toBe("host-b");
    expect(screen.getByText("Remote checkout")).toBeTruthy();
    expect(screen.getByText("fix-billing · devbox")).toBeTruthy();
  });

  it("does not show a host label for an active-host burst", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    renderPip();

    expect(
      screen.getByTestId("agent-browser-pip").getAttribute("data-pip-host-id"),
    ).toBe("host-a");
    expect(screen.getByText("fix-billing")).toBeTruthy();
    expect(screen.queryByText(/devbox/)).toBeNull();
  });

  it("opens a canvas tile bound to the burst host on click-through", () => {
    const hostB = session({
      sessionId: "s-b",
      name: "Remote",
      hostId: "host-b",
      tabs: [
        tab({
          tabId: "t-b",
          url: "https://devbox.example/pay",
          title: "Remote checkout",
        }),
      ],
    });
    setPipEpicSessionItemsForTests(EPIC, [
      ...getPipEpicSessionItems(EPIC),
      hostB,
    ]);
    applyPipBurstStarted({
      epicId: EPIC,
      hostId: "host-b",
      sessionId: "s-b",
      tabId: "t-b",
      burstId: "burst-b",
      chatId: "chat-1",
      startedAt: 1,
    });
    renderPip();

    fireEvent.click(screen.getByTestId("agent-browser-pip-open"));

    expect(navigateNested).toHaveBeenCalledWith(
      EPIC,
      VIEW_TAB,
      expect.any(Function),
    );
    const expected = makeBrowserSessionTileRef({
      name: "Remote checkout",
      hostId: "host-b",
      sessionId: "s-b",
      tabId: "t-b",
    });
    const opened = findOpenArtifactInTab(VIEW_TAB, expected.id);
    expect(opened).not.toBeNull();
    if (opened === null) throw new Error("expected open browser pointer");
    const tile =
      useEpicCanvasStore.getState().canvasByTabId[VIEW_TAB]?.tilesByInstanceId[
        opened.instanceId
      ];
    expect(tile).toMatchObject({
      type: "browser-session",
      hostId: "host-b",
      sessionId: "s-b",
      tabId: "t-b",
      id: expected.id,
    });
  });
});

describe("AgentBrowserPip captions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPipStoreForTests();
    resetPipEpicSessionsForTests();
    resetVisibleBrowserTileRegistryForTests();
    setPipNowForTests(() => Date.now());
    setPipActiveHostId("host-a");
    seedCanvasTab();
    seedSessions();
    bindingState.value = null;
    pipCaptureState.reset();
    navigateNested.mockClear();
    URL.createObjectURL = vi.fn(() => "blob:pip-frame");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
    resetPipStoreForTests();
    resetPipEpicSessionsForTests();
    resetVisibleBrowserTileRegistryForTests();
    useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
    vi.useRealTimers();
  });

  it("fades the caption in when one arrives for the displayed tab", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    applyPipCaption({
      epicId: EPIC,
      sessionId: "s1",
      tabId: "t1",
      burstId: "b1",
      cellTitle: "Filling checkout form",
    });
    renderPip();

    const caption = screen.getByTestId("agent-browser-pip-caption");
    expect(caption.textContent).toBe("Filling checkout form");
    expect(caption.getAttribute("data-pip-caption-visible")).toBe("true");
  });

  it("fades the caption out after HOLD and unmounts after HOLD+FADE", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    applyPipCaption({
      epicId: EPIC,
      sessionId: "s1",
      tabId: "t1",
      burstId: "b1",
      cellTitle: "Filling checkout form",
    });
    renderPip();
    expect(
      screen
        .getByTestId("agent-browser-pip-caption")
        .getAttribute("data-pip-caption-visible"),
    ).toBe("true");

    act(() => {
      vi.advanceTimersByTime(PIP_CAPTION_HOLD_MS);
    });
    const fading = screen.getByTestId("agent-browser-pip-caption");
    expect(fading.textContent).toBe("Filling checkout form");
    expect(fading.getAttribute("data-pip-caption-visible")).toBe("false");

    act(() => {
      vi.advanceTimersByTime(PIP_CAPTION_FADE_MS);
    });
    expect(screen.queryByTestId("agent-browser-pip-caption")).toBeNull();
  });

  it("swaps the visible caption when a new one is applied", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    applyPipCaption({
      epicId: EPIC,
      sessionId: "s1",
      tabId: "t1",
      burstId: "b1",
      cellTitle: "Filling checkout form",
    });
    renderPip();
    expect(screen.getByTestId("agent-browser-pip-caption").textContent).toBe(
      "Filling checkout form",
    );

    act(() => {
      applyPipCaption({
        epicId: EPIC,
        sessionId: "s1",
        tabId: "t1",
        burstId: "b1",
        cellTitle: "Submitting payment",
      });
    });

    const caption = screen.getByTestId("agent-browser-pip-caption");
    expect(caption.textContent).toBe("Submitting payment");
    expect(caption.getAttribute("data-pip-caption-visible")).toBe("true");
    expect(screen.queryByText("Filling checkout form")).toBeNull();
  });

  it("clears the caption immediately when the burst ends", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    applyPipCaption({
      epicId: EPIC,
      sessionId: "s1",
      tabId: "t1",
      burstId: "b1",
      cellTitle: "Filling checkout form",
    });
    renderPip();
    expect(screen.getByTestId("agent-browser-pip-caption")).toBeTruthy();

    act(() => {
      endBurst("b1", "finished", 2);
    });
    expect(screen.queryByTestId("agent-browser-pip-caption")).toBeNull();
  });

  it("shows no caption when none has been applied", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    renderPip();

    expect(screen.getByTestId("agent-browser-pip")).toBeTruthy();
    expect(screen.queryByTestId("agent-browser-pip-caption")).toBeNull();
  });
});
