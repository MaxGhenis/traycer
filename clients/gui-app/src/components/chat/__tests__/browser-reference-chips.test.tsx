import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { BrowserContextAttachmentRecord } from "@traycer/protocol/persistence/epic/schemas";
import type {
  BrowserSessionInfo,
  BrowserTabInfo,
} from "@traycer/protocol/host/browser/contracts";
import { BrowserReferenceChips } from "@/components/chat/browser-reference-chips";
import {
  BrowserSessionsContext,
  type BrowserSessionsState,
} from "@/components/epic-canvas/renderers/browser-sessions-context";
import { TooltipProvider } from "@/components/ui/tooltip";

const BASE: Omit<BrowserContextAttachmentRecord, "sessionId" | "tabId"> = {
  kind: "browser-console-entry",
  origin: "https://app.example",
  pageUrl: "https://app.example/page",
  composerText: "see this tab",
};

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
    Pick<BrowserSessionInfo, "sessionId" | "tabs">,
): BrowserSessionInfo {
  return {
    epicId: "epic-1",
    hostId: "host-1",
    profile: "primary",
    name: "Agent browser",
    createdBy: { chatId: "chat-1", agentRunId: null },
    createdAt: 1,
    lastActivityAt: 2,
    ...overrides,
  };
}

function sessionsState(
  items: ReadonlyArray<BrowserSessionInfo>,
): BrowserSessionsState {
  return {
    lifecycle: "live",
    items,
    errorMessage: null,
    routingChatId: null,
    closeSession: vi.fn(),
    requestPromoteState: vi.fn(),
    requestLendStorage: vi.fn(),
  };
}

function renderChips(
  references: ReadonlyArray<BrowserContextAttachmentRecord>,
  items: ReadonlyArray<BrowserSessionInfo>,
): HTMLElement {
  return render(
    <TooltipProvider delayDuration={0}>
      <BrowserSessionsContext.Provider value={sessionsState(items)}>
        <BrowserReferenceChips references={references} />
      </BrowserSessionsContext.Provider>
    </TooltipProvider>,
  ).container;
}

function wrapper(node: ReactNode): ReactNode {
  return <TooltipProvider delayDuration={0}>{node}</TooltipProvider>;
}

afterEach(() => {
  cleanup();
});

describe("BrowserReferenceChips (ticket 08 disambiguation)", () => {
  it("renders nothing without references, and does not require BrowserSessionsProvider to do so", () => {
    const { container } = render(
      wrapper(<BrowserReferenceChips references={[]} />),
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the referenced tab's title, not the raw sessionId/tabId pair", async () => {
    const user = userEvent.setup();
    const references: BrowserContextAttachmentRecord[] = [
      { ...BASE, sessionId: "sess-a", tabId: "tab-1" },
      { ...BASE, sessionId: "sess-a", tabId: "tab-2" },
      { ...BASE, sessionId: "sess-b", tabId: "tab-1" },
    ];

    renderChips(references, [
      session({
        sessionId: "sess-a",
        tabs: [
          tab({
            tabId: "tab-1",
            url: "https://checkout.example/cart",
            title: "Checkout",
          }),
          tab({
            tabId: "tab-2",
            url: "https://docs.example/guide",
            title: "Docs",
          }),
        ],
      }),
      session({
        sessionId: "sess-b",
        tabs: [
          tab({
            tabId: "tab-1",
            url: "https://status.example",
            title: "Status",
          }),
        ],
      }),
    ]);

    // Titles are the visible label - the old raw "sess-a / tab-1" pairing is gone.
    expect(screen.getByText("Checkout")).toBeTruthy();
    expect(screen.getByText("Docs")).toBeTruthy();
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.queryByText("sess-a / tab-1")).toBeNull();

    // The raw ids are still available, just demoted to the tooltip.
    await user.hover(screen.getByText("Checkout"));
    await waitFor(() => {
      expect(
        screen.getByText("Browser session sess-a, tab tab-1"),
      ).toBeTruthy();
    });
  });

  it("falls back to the tab's host when it has no title, and to 'Browser' when the reference matches no known tab", () => {
    renderChips(
      [
        { ...BASE, sessionId: "sess-a", tabId: "tab-1" },
        { ...BASE, sessionId: "unknown-session", tabId: "unknown-tab" },
      ],
      [
        session({
          sessionId: "sess-a",
          tabs: [
            tab({ tabId: "tab-1", url: "https://app.example/dashboard" }),
          ],
        }),
      ],
    );

    expect(screen.getByText("app.example")).toBeTruthy();
    expect(screen.getByText("Browser")).toBeTruthy();
  });

  it("renders the resolved tab favicon when one is available", () => {
    const container = renderChips(
      [{ ...BASE, sessionId: "sess-a", tabId: "tab-1" }],
      [
        session({
          sessionId: "sess-a",
          tabs: [
            tab({
              tabId: "tab-1",
              url: "https://app.example/dashboard",
              title: "Dashboard",
            }),
          ],
        }),
      ],
    );

    const favicon = container.querySelector("img");
    expect(favicon).not.toBeNull();
    expect(favicon?.getAttribute("src")).toBe(
      "https://app.example/favicon.ico",
    );
  });

  it("disambiguates same session different tabs without collapsing labels", () => {
    renderChips(
      [
        { ...BASE, sessionId: "shared", tabId: "left" },
        { ...BASE, sessionId: "shared", tabId: "right" },
      ],
      [
        session({
          sessionId: "shared",
          tabs: [
            tab({
              tabId: "left",
              url: "https://left.example",
              title: "Left tab",
            }),
            tab({
              tabId: "right",
              url: "https://right.example",
              title: "Right tab",
            }),
          ],
        }),
      ],
    );

    expect(screen.getByText("Left tab")).toBeTruthy();
    expect(screen.getByText("Right tab")).toBeTruthy();
  });
});
