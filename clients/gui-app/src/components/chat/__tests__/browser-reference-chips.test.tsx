import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { BrowserContextAttachmentRecord } from "@traycer/protocol/persistence/epic/schemas";
import { BrowserReferenceChips } from "@/components/chat/browser-reference-chips";
import { TooltipProvider } from "@/components/ui/tooltip";

const BASE: Omit<BrowserContextAttachmentRecord, "sessionId" | "tabId"> = {
  kind: "browser-console-entry",
  origin: "https://app.example",
  pageUrl: "https://app.example/page",
  composerText: "see this tab",
};

function renderChips(
  references: ReadonlyArray<BrowserContextAttachmentRecord>,
): void {
  render(
    <TooltipProvider delayDuration={0}>
      <BrowserReferenceChips references={references} />
    </TooltipProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("BrowserReferenceChips (ticket 08 disambiguation)", () => {
  it("renders nothing without references", () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <BrowserReferenceChips references={[]} />
      </TooltipProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders exact {sessionId, tabId} for each reference", async () => {
    const user = userEvent.setup();
    const references: BrowserContextAttachmentRecord[] = [
      { ...BASE, sessionId: "sess-a", tabId: "tab-1" },
      { ...BASE, sessionId: "sess-a", tabId: "tab-2" },
      { ...BASE, sessionId: "sess-b", tabId: "tab-1" },
    ];

    renderChips(references);

    expect(screen.getByText("sess-a / tab-1")).toBeTruthy();
    expect(screen.getByText("sess-a / tab-2")).toBeTruthy();
    expect(screen.getByText("sess-b / tab-1")).toBeTruthy();

    await user.hover(screen.getByText("sess-a / tab-1"));
    await waitFor(() => {
      expect(
        screen.getByText("Browser session sess-a, tab tab-1"),
      ).toBeTruthy();
    });
  });

  it("disambiguates same session different tabs without collapsing labels", () => {
    renderChips([
      { ...BASE, sessionId: "shared", tabId: "left" },
      { ...BASE, sessionId: "shared", tabId: "right" },
    ]);

    expect(screen.getByText("shared / left")).toBeTruthy();
    expect(screen.getByText("shared / right")).toBeTruthy();
    expect(screen.queryByText("shared / left / right")).toBeNull();
  });
});
