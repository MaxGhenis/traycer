import "../../../../../__tests__/test-browser-apis";
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserScreencastServerFrame } from "@traycer/protocol/host/browser/contracts";
import type {
  BrowserSessionInfo,
  BrowserTabInfo,
} from "@traycer/protocol/host/browser/contracts";
import type { BrowserSessionsState } from "@/components/epic-canvas/renderers/browser-sessions-context";
import { AgentBrowserPip } from "@/components/epic-canvas/pip/agent-browser-pip";
import {
  getPipHeadlessArmRunsForTests,
  resetPipCaptureArmCountsForTests,
} from "@/lib/browser-view/pip-capture-arm-counts";
import type { BrowserViewTileKey } from "@/lib/browser-view/desktop-browser-view";
import { PIP_MIN_HEIGHT } from "@/lib/browser-view/pip-geometry";
import {
  applyPipBurstEnded,
  applyPipBurstStarted,
  applyPipCaption,
  getPipDismissalsForTests,
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
  findOpenTileInTab,
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

const revokeObjectURL = vi.hoisted(() => vi.fn<(url: string) => void>());

const bindingState = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  type TestBinding = {
    readonly hostId: string;
    readonly registrationId: string;
    readonly tileKey: BrowserViewTileKey;
  };
  return {
    value: null as TestBinding | null,
    set(next: TestBinding | null): void {
      bindingState.value = next;
      listeners.forEach((listener) => {
        listener();
      });
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

const clientState = vi.hoisted(() => {
  const defaultClient = { instanceId: "pip-test-headless-client" };
  const listeners = new Set<() => void>();
  const state: {
    readonly defaultClient: { readonly instanceId: string };
    value: { readonly instanceId: string } | null;
    set(next: { readonly instanceId: string } | null): void;
    subscribe(listener: () => void): () => void;
    reset(): void;
  } = {
    defaultClient,
    value: defaultClient,
    set(next) {
      state.value = next;
      listeners.forEach((listener) => {
        listener();
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset() {
      state.value = defaultClient;
    },
  };
  return state;
});

const headlessStreamState = vi.hoisted(() => ({
  openCount: 0,
  closeCount: 0,
  open: vi.fn(() => {
    headlessStreamState.openCount += 1;
    return {
      close: () => {
        headlessStreamState.closeCount += 1;
      },
    };
  }),
  reset(): void {
    headlessStreamState.openCount = 0;
    headlessStreamState.closeCount = 0;
    headlessStreamState.open.mockClear();
  },
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

vi.mock("@/providers/use-open-epic-handle", () => ({
  useMaybeOpenEpicHandle: () => ({ epicId: "epic-1" }),
}));

vi.mock("@/lib/host/stream-auth-revalidator", () => ({
  useStreamAuthRevalidator: () => null,
}));

vi.mock("@/hooks/host/use-host-stream-client-for", () => ({
  useHostStreamClientFor: () =>
    useSyncExternalStore(
      (listener) => clientState.subscribe(listener),
      () => clientState.value,
      () => clientState.value,
    ),
}));

vi.mock("@/lib/browser-view/pip-headless-stream", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/browser-view/pip-headless-stream")
    >();
  return {
    ...actual,
    openPipHeadlessStream: () => headlessStreamState.open(),
  };
});

vi.mock("@/providers/use-runner-host", () => ({
  useRunnerHostOrNull: () => ({ pipCapture: pipCaptureState }),
}));

vi.mock("@/lib/browser-view/electron-browser-tab-store", () => ({
  findElectronBrowserTabBinding: () => bindingState.value,
  useElectronBrowserTabBinding: () =>
    useSyncExternalStore(
      (listener) => bindingState.subscribe(listener),
      () => bindingState.value,
      () => bindingState.value,
    ),
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
  startBurstOnHost("host-a", input);
}

function startBurstOnHost(
  hostId: string,
  input: {
    readonly burstId: string;
    readonly sessionId: string;
    readonly tabId: string;
    readonly startedAt: number;
  },
): void {
  applyPipBurstStarted({
    epicId: EPIC,
    hostId,
    sessionId: input.sessionId,
    tabId: input.tabId,
    burstId: input.burstId,
    chatId: "chat-1",
    startedAt: input.startedAt,
  });
}

function testBinding(
  hostId: string,
  registrationId: string,
): {
  readonly hostId: string;
  readonly registrationId: string;
  readonly tileKey: BrowserViewTileKey;
} {
  return { hostId, registrationId, tileKey: TILE_KEY };
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

function setViewport(width: number, height: number): () => void {
  const previousWidth = window.innerWidth;
  const previousHeight = window.innerHeight;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
  return () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: previousWidth,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: previousHeight,
    });
  };
}

async function flushMacrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
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
    bindingState.set(null);
    clientState.reset();
    resetPipCaptureArmCountsForTests();
    headlessStreamState.reset();
    pipCaptureState.reset();
    navigateNested.mockClear();
    URL.createObjectURL = vi.fn(() => "blob:pip-frame");
    revokeObjectURL.mockReset();
    URL.revokeObjectURL = revokeObjectURL;
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

  it("shows an outcome card after a frame-less burst ends", () => {
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
    expect(
      screen.getByTestId("agent-browser-pip-outcome-only").textContent,
    ).toBe("Agent finished on checkout.stripe.com");
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

  it("disables open-tile for a closed tab and shows its outcome card", () => {
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
    expect(
      screen.getByTestId("agent-browser-pip-outcome-only").textContent,
    ).toBe("Tab closed on checkout.stripe.com");
  });

  it("renders live rows with metadata and hover/focus actions", () => {
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
    applyPipCaption({
      epicId: EPIC,
      hostId: "host-a",
      sessionId: "s2",
      tabId: "t2",
      burstId: "b2",
      cellTitle: "Searching hotels",
    });
    renderPip();

    const row = screen.getByTestId("agent-browser-pip-row-b2");
    expect(row.getAttribute("data-pip-row-kind")).toBe("live");
    expect(
      screen
        .getByTestId("agent-browser-pip-row-b3")
        .getAttribute("data-pip-row-kind"),
    ).toBe("live");
    expect(screen.getByText("Other tab")).toBeTruthy();
    expect(screen.getByText("Searching hotels")).toBeTruthy();
    const actions = row.querySelector("div.opacity-0");
    expect(actions?.className).toContain("group-hover:opacity-100");
    expect(actions?.className).toContain("group-focus-within:opacity-100");

    fireEvent.mouseEnter(row);
    const open = screen.getByRole("button", { name: "Open Other tab" });
    expect(
      screen.getByRole("button", {
        name: "Hide Other tab from picture in picture",
      }),
    ).toBeTruthy();
    open.focus();
    expect(document.activeElement).toBe(open);
  });

  it("renders lingering rows without a live-row button", () => {
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
    endBurst("b2", "finished", Date.now());
    renderPip();

    const row = screen.getByTestId("agent-browser-pip-row-b2");
    expect(row.getAttribute("data-pip-row-kind")).toBe("lingering");
    expect(row.getAttribute("role")).toBeNull();
    expect(row.getAttribute("tabindex")).toBeNull();
    expect(row.querySelector('button[aria-label^="Show "]')).toBeNull();
    expect(row.textContent).toContain("Agent finished on app.example");
  });

  it("clicking a live row switches the preview and pins that burst", () => {
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
    renderPip();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Show Other tab in picture in picture",
      }),
    );

    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b2");
    expect(getPipSnapshot(EPIC).pinned).toBe(true);
    expect(screen.getByText("Other tab")).toBeTruthy();
  });

  it("shows an outcome-only preview for a terminal row that never streamed", () => {
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
    endBurst("b1", "finished", 3);
    endBurst("b2", "finished", 4);
    renderPip();

    const snapshot = getPipSnapshot(EPIC);
    expect(snapshot.target?.burstId).toBe("b2");
    expect(
      screen.getByTestId("agent-browser-pip-outcome-only").textContent,
    ).toBe("Agent finished on app.example");
    expect(
      screen
        .getByTestId("agent-browser-pip-frame")
        .querySelector("img.object-cover"),
    ).toBeNull();
  });

  it("shows the overflow count for rows hidden by the viewport cap", () => {
    const restoreViewport = setViewport(1024, 300);
    try {
      for (let index = 1; index <= 6; index += 1) {
        startBurst({
          burstId: `b${String(index)}`,
          sessionId: "s1",
          tabId: "t1",
          startedAt: index,
        });
      }
      renderPip();

      const root = screen.getByTestId("agent-browser-pip");
      expect(root.style.getPropertyValue("--pip-preview-height")).toBe(
        `${String(PIP_MIN_HEIGHT)}px`,
      );
      expect(screen.getByTestId("agent-browser-pip-row-b2")).toBeTruthy();
      expect(screen.getByTestId("agent-browser-pip-row-more").textContent).toBe(
        "4 more",
      );
    } finally {
      restoreViewport();
    }
  });

  it("keeps raw preview size through row-fit, resize, and move", () => {
    const restoreViewport = setViewport(1024, 300);
    try {
      useEpicCanvasStore.getState().setPipGeometry(EPIC, {
        anchorX: 900,
        anchorY: 700,
        previewWidth: 320,
        previewHeight: 200,
      });
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
      renderPip();

      expect(
        useEpicCanvasStore.getState().pipGeometryByEpicId[EPIC]?.previewHeight,
      ).toBe(200);

      setViewport(1024, 768);
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(
        useEpicCanvasStore.getState().pipGeometryByEpicId[EPIC]?.previewHeight,
      ).toBe(200);

      const root = screen.getByTestId("agent-browser-pip");
      const toolbar = screen.getByRole("toolbar", {
        name: "Agent browser picture in picture",
      });
      fireEvent.pointerDown(toolbar, {
        button: 0,
        pointerId: 1,
        clientX: 100,
        clientY: 100,
      });
      fireEvent.pointerMove(root, {
        pointerId: 1,
        clientX: 110,
        clientY: 110,
      });
      fireEvent.pointerUp(root, {
        pointerId: 1,
        clientX: 110,
        clientY: 110,
      });
      expect(
        useEpicCanvasStore.getState().pipGeometryByEpicId[EPIC]?.previewHeight,
      ).toBe(200);

      const resize = screen.getByTestId("agent-browser-pip-resize");
      fireEvent.pointerDown(resize, {
        button: 0,
        pointerId: 2,
        clientX: 200,
        clientY: 200,
      });
      fireEvent.pointerMove(root, {
        pointerId: 2,
        clientX: 220,
        clientY: 220,
      });
      fireEvent.pointerUp(root, {
        pointerId: 2,
        clientX: 220,
        clientY: 220,
      });
      expect(
        useEpicCanvasStore.getState().pipGeometryByEpicId[EPIC],
      ).toMatchObject({
        previewWidth: 340,
        previewHeight: 220,
      });
    } finally {
      restoreViewport();
    }
  });

  it("moves the bottom-right resize handle with the pointer", () => {
    useEpicCanvasStore.getState().setPipGeometry(EPIC, {
      anchorX: 500,
      anchorY: 500,
      previewWidth: 320,
      previewHeight: 200,
    });
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    renderPip();

    const root = screen.getByTestId("agent-browser-pip");
    const resize = screen.getByTestId("agent-browser-pip-resize");
    fireEvent.pointerDown(resize, {
      button: 0,
      pointerId: 3,
      clientX: 400,
      clientY: 400,
    });
    fireEvent.pointerMove(root, {
      pointerId: 3,
      clientX: 430,
      clientY: 450,
    });
    expect(root.style.left).toBe("180px");
    expect(root.style.top).toBe("300px");
    fireEvent.pointerUp(root, {
      pointerId: 3,
      clientX: 430,
      clientY: 450,
    });

    expect(useEpicCanvasStore.getState().pipGeometryByEpicId[EPIC]).toEqual({
      anchorX: 530,
      anchorY: 550,
      previewWidth: 350,
      previewHeight: 250,
    });
  });

  it("positions a legacy-migrated chip from its bottom-right anchor", () => {
    useEpicCanvasStore.getState().setPipGeometry(EPIC, {
      anchorX: 420,
      anchorY: 320,
      previewWidth: 320,
      previewHeight: 200,
    });
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
    expect(root.style.left).toBe("100px");
    expect(root.style.top).toBe("120px");
  });

  it("uses anchor minus preview size for a live migrated-geometry drag", () => {
    useEpicCanvasStore.getState().setPipGeometry(EPIC, {
      anchorX: 420,
      anchorY: 320,
      previewWidth: 320,
      previewHeight: 200,
    });
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    renderPip();

    const root = screen.getByTestId("agent-browser-pip");
    const toolbar = screen.getByRole("toolbar", {
      name: "Agent browser picture in picture",
    });
    fireEvent.pointerDown(toolbar, {
      button: 0,
      pointerId: 4,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(root, {
      pointerId: 4,
      clientX: 110,
      clientY: 120,
    });

    expect(root.style.left).toBe("110px");
    expect(root.style.top).toBe("140px");
  });

  it("header X dismisses the displayed target and every rendered row", () => {
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

    fireEvent.click(screen.getByTestId("agent-browser-pip-close"));

    expect([...getPipDismissalsForTests(EPIC)].sort()).toEqual([
      "b1",
      "b2",
      "b3",
    ]);
    expect(getPipSnapshot(EPIC).phase).toBe("dismissed-burst");
  });

  it("Escape uses the same whole-stack dismissal as header X", () => {
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

    fireEvent.keyDown(
      screen.getByRole("toolbar", {
        name: "Agent browser picture in picture",
      }),
      { key: "Escape" },
    );

    expect([...getPipDismissalsForTests(EPIC)].sort()).toEqual([
      "b1",
      "b2",
      "b3",
    ]);
    expect(getPipSnapshot(EPIC).phase).toBe("dismissed-burst");
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

  it("pointerdown on chrome buttons is not captured as a drag", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    renderPip();

    const open = screen.getByTestId("agent-browser-pip-open");
    const openDown = createEvent.pointerDown(open, { button: 0 });
    fireEvent(open, openDown);
    expect(openDown.defaultPrevented).toBe(false);
    fireEvent.click(open);
    expect(navigateNested).toHaveBeenCalled();

    const close = screen.getByTestId("agent-browser-pip-close");
    const closeDown = createEvent.pointerDown(close, { button: 0 });
    fireEvent(close, closeDown);
    expect(closeDown.defaultPrevented).toBe(false);
    fireEvent.click(close);
    expect(getPipSnapshot(EPIC).phase).toBe("dismissed-burst");
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
    bindingState.set(testBinding("host-a", "native-registration"));
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

  it("keeps the keyed live frame through finished, chip, and re-expand", () => {
    let nextFrame = 0;
    URL.createObjectURL = vi.fn(() => {
      nextFrame += 1;
      return `blob:pip-frame-${String(nextFrame)}`;
    });
    bindingState.set(testBinding("host-a", "native-registration"));
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
    expect(
      screen
        .getByTestId("agent-browser-pip-frame")
        .querySelector("img")
        ?.getAttribute("src"),
    ).toBe("blob:pip-frame-1");

    act(() => {
      endBurst("b1", "finished", 2);
    });
    expect(
      screen
        .getByTestId("agent-browser-pip-frame")
        .querySelector("img")
        ?.getAttribute("src"),
    ).toBe("blob:pip-frame-1");

    act(() => {
      pipCaptureState.emit(
        {
          kind: "frame",
          hasBinaryPayload: true,
          sequence: 2,
          metadata: {
            offsetTop: 0,
            pageScaleFactor: 1,
            deviceWidth: 320,
            deviceHeight: 200,
            scrollOffsetX: 0,
            scrollOffsetY: 0,
            timestamp: 2,
          },
        },
        new Uint8Array([4, 5, 6]),
      );
    });
    expect(
      screen
        .getByTestId("agent-browser-pip-frame")
        .querySelector("img")
        ?.getAttribute("src"),
    ).toBe("blob:pip-frame-1");
    expect(
      revokeObjectURL.mock.calls.some((call) => call[0] === "blob:pip-frame-1"),
    ).toBe(false);

    act(() => {
      vi.advanceTimersByTime(PIP_LINGER_MS);
    });
    expect(
      screen.getByTestId("agent-browser-pip").getAttribute("data-pip-phase"),
    ).toBe("chip");
    expect(
      revokeObjectURL.mock.calls.some((call) => call[0] === "blob:pip-frame-1"),
    ).toBe(false);

    fireEvent.click(screen.getByTestId("agent-browser-pip-chip"));
    expect(
      screen.getByTestId("agent-browser-pip").getAttribute("data-pip-phase"),
    ).toBe("finished");
    expect(
      screen
        .getByTestId("agent-browser-pip-frame")
        .querySelector("img")
        ?.getAttribute("src"),
    ).toBe("blob:pip-frame-1");
  });

  it("closes the headless source when a native binding appears mid-open", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    renderPip();
    expect(headlessStreamState.openCount).toBe(1);
    expect(pipCaptureState.start).not.toHaveBeenCalled();

    act(() => {
      bindingState.set(testBinding("host-a", "native-registration"));
    });
    expect(headlessStreamState.closeCount).toBe(1);
    expect(pipCaptureState.start).toHaveBeenCalled();
  });

  it("keeps native capture at one start when a new host client instance appears", async () => {
    vi.useRealTimers();
    clientState.set(null);
    bindingState.set(testBinding("host-a", "native-registration"));
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    renderPip();
    expect(pipCaptureState.start).toHaveBeenCalledTimes(1);
    expect(pipCaptureState.stop).not.toHaveBeenCalled();

    clientState.set({ instanceId: "host-client-cold-mount" });
    await flushMacrotasks();
    expect(pipCaptureState.start).toHaveBeenCalledTimes(1);
    expect(pipCaptureState.stop).not.toHaveBeenCalled();
    expect(headlessStreamState.openCount).toBe(0);
  });

  it("waits for the headless client inside one arm run and reconnects on instance replace", async () => {
    vi.useRealTimers();
    clientState.set(null);
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    renderPip();
    await flushMacrotasks();
    expect(headlessStreamState.openCount).toBe(0);
    expect(getPipHeadlessArmRunsForTests()).toBe(1);

    clientState.set({ instanceId: "headless-a" });
    await flushMacrotasks();
    expect(headlessStreamState.openCount).toBe(1);
    expect(headlessStreamState.closeCount).toBe(0);
    expect(getPipHeadlessArmRunsForTests()).toBe(1);

    clientState.set({ instanceId: "headless-b" });
    await flushMacrotasks();
    expect(headlessStreamState.openCount).toBe(2);
    expect(headlessStreamState.closeCount).toBe(1);
    expect(getPipHeadlessArmRunsForTests()).toBe(1);
  });

  it("switches sources once per native/headless branch flip", async () => {
    vi.useRealTimers();
    bindingState.set(testBinding("host-a", "native-registration"));
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    renderPip();
    await flushMacrotasks();
    expect(pipCaptureState.start).toHaveBeenCalledTimes(1);
    expect(pipCaptureState.stop).not.toHaveBeenCalled();
    expect(headlessStreamState.openCount).toBe(0);

    bindingState.set(null);
    await flushMacrotasks();
    expect(pipCaptureState.stop).toHaveBeenCalledTimes(1);
    expect(headlessStreamState.openCount).toBe(1);
    expect(headlessStreamState.closeCount).toBe(0);

    bindingState.set(testBinding("host-a", "native-registration"));
    await flushMacrotasks();
    expect(pipCaptureState.start).toHaveBeenCalledTimes(2);
    expect(pipCaptureState.stop).toHaveBeenCalledTimes(1);
    expect(headlessStreamState.closeCount).toBe(1);
    expect(headlessStreamState.openCount).toBe(1);
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

  it("opens a row against its host when session and tab ids collide", () => {
    const sharedHostA = session({
      sessionId: "shared-session",
      name: "Host A",
      hostId: "host-a",
      tabs: [
        tab({
          tabId: "shared-tab",
          url: "https://host-a.example/shared",
          title: "Host A page",
        }),
      ],
    });
    const sharedHostB = session({
      sessionId: "shared-session",
      name: "Host B",
      hostId: "host-b",
      tabs: [
        tab({
          tabId: "shared-tab",
          url: "https://host-b.example/shared",
          title: "Host B page",
        }),
      ],
    });
    const items = [...getPipEpicSessionItems(EPIC), sharedHostA, sharedHostB];
    sessionsState.value = { ...sessionsState.value, items };
    setPipEpicSessionItemsForTests(EPIC, items);

    const hostATile = makeBrowserSessionTileRef({
      name: "Host A page",
      hostId: "host-a",
      sessionId: "shared-session",
      tabId: "shared-tab",
    });
    const hostBTile = makeBrowserSessionTileRef({
      name: "Host B page",
      hostId: "host-b",
      sessionId: "shared-session",
      tabId: "shared-tab",
    });
    useEpicCanvasStore.getState().openTileInTab(VIEW_TAB, hostATile);
    useEpicCanvasStore.getState().openTileInTab(VIEW_TAB, hostBTile);
    bindingState.set(testBinding("host-a", hostATile.id));
    startBurst({
      burstId: "shared-a",
      sessionId: "shared-session",
      tabId: "shared-tab",
      startedAt: 1,
    });
    startBurstOnHost("host-b", {
      burstId: "shared-b",
      sessionId: "shared-session",
      tabId: "shared-tab",
      startedAt: 2,
    });
    renderPip();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Show Host B page in picture in picture",
      }),
    );

    expect(
      findOpenTileInTab(VIEW_TAB, {
        id: hostATile.id,
        hostId: "host-a",
      })?.instanceId,
    ).toBe(hostATile.instanceId);
    expect(
      findOpenTileInTab(VIEW_TAB, {
        id: hostBTile.id,
        hostId: "host-b",
      })?.instanceId,
    ).toBe(hostBTile.instanceId);
    const root = useEpicCanvasStore.getState().canvasByTabId[VIEW_TAB]?.root;
    expect(root?.kind).toBe("pane");
    if (root?.kind !== "pane") throw new Error("expected a canvas pane");
    expect(root.activeTabId).toBe(hostBTile.instanceId);
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
    bindingState.set(null);
    clientState.reset();
    resetPipCaptureArmCountsForTests();
    headlessStreamState.reset();
    pipCaptureState.reset();
    navigateNested.mockClear();
    URL.createObjectURL = vi.fn(() => "blob:pip-frame");
    revokeObjectURL.mockReset();
    URL.revokeObjectURL = revokeObjectURL;
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
      hostId: "host-a",
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

  it("falls back to the chat title when a row caption ages out", async () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 2,
    });
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: 1,
    });
    applyPipCaption({
      epicId: EPIC,
      hostId: "host-a",
      sessionId: "s2",
      tabId: "t2",
      burstId: "b2",
      cellTitle: "Searching hotels",
    });
    renderPip();

    const row = screen.getByTestId("agent-browser-pip-row-b2");
    expect(row.textContent).toContain("Searching hotels");
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        PIP_CAPTION_HOLD_MS + PIP_CAPTION_FADE_MS + 1_000,
      );
    });
    await Promise.resolve();

    expect(row.textContent).not.toContain("Searching hotels");
    expect(row.textContent).toContain("fix-billing");
    expect(vi.getTimerCount()).toBe(0);
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
      hostId: "host-a",
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
      hostId: "host-a",
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
        hostId: "host-a",
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
      hostId: "host-a",
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

  it("does not revive a caption that expired while the PiP was hidden", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
    });
    applyPipCaption({
      epicId: EPIC,
      hostId: "host-a",
      sessionId: "s1",
      tabId: "t1",
      burstId: "b1",
      cellTitle: "Filling checkout form",
    });
    act(() => {
      vi.advanceTimersByTime(PIP_CAPTION_HOLD_MS + PIP_CAPTION_FADE_MS);
    });
    renderPip();
    expect(screen.getByTestId("agent-browser-pip")).toBeTruthy();
    expect(screen.queryByTestId("agent-browser-pip-caption")).toBeNull();
  });
});
