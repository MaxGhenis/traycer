import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { ChatExpansionTestProviders } from "@/components/chat/__tests__/chat-expansion-test-providers";
import { WakeStreakHeader } from "@/components/chat/chat-wake-streak-header";
import type { WakeStreakModel } from "@/components/chat/chat-wake-streaks";
import { TooltipProvider } from "@/components/ui/tooltip";
import { scopedChatOpenId } from "@/stores/chats/open-store-scope";
import { useWakeStreakOpenStore } from "@/stores/chats/wake-streak-open-store";

const TILE_INSTANCE_ID = "wake-streak-header-test-tile";

function render(ui: ReactNode) {
  return rtlRender(
    <TooltipProvider delayDuration={0}>
      <ChatExpansionTestProviders tileInstanceId={TILE_INSTANCE_ID}>
        {ui}
      </ChatExpansionTestProviders>
    </TooltipProvider>,
  );
}

function makeStreak(overrides: Partial<WakeStreakModel>): WakeStreakModel {
  return {
    id: "wake-streak:a0",
    memberRowIds: ["a0", "a1"],
    liveTail: false,
    sources: [{ title: "build watch", updateCount: 2 }],
    startedAt: Date.parse("2026-01-01T18:40:00Z"),
    endedAt: Date.parse("2026-01-01T18:58:00Z"),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  // The open store is a module-global zustand singleton (namespaced by scope
  // internally), so it must be reset explicitly between tests the same way
  // any other global-state store in this suite is.
  useWakeStreakOpenStore.setState({ openIds: new Set() });
});

describe("<WakeStreakHeader />", () => {
  it("renders collapsed by default", () => {
    render(<WakeStreakHeader streak={makeStreak({})} />);

    const header = screen.getByTestId("wake-streak-header");
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("toggles the wake-streak open store on click", () => {
    const streak = makeStreak({});
    render(<WakeStreakHeader streak={streak} />);

    const header = screen.getByTestId("wake-streak-header");
    const scopedId = scopedChatOpenId(TILE_INSTANCE_ID, streak.id);
    expect(useWakeStreakOpenStore.getState().openIds.has(scopedId)).toBe(false);

    fireEvent.click(header);

    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(useWakeStreakOpenStore.getState().openIds.has(scopedId)).toBe(true);

    fireEvent.click(header);

    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(useWakeStreakOpenStore.getState().openIds.has(scopedId)).toBe(false);
  });

  it('labels a liveTail streak "N earlier updates"', () => {
    render(
      <WakeStreakHeader
        streak={makeStreak({
          liveTail: true,
          memberRowIds: ["a0", "a1", "a2"],
        })}
      />,
    );

    expect(screen.getByText("3 earlier updates")).toBeTruthy();
    expect(screen.queryByText("3 updates")).toBeNull();
  });

  it('labels a closed streak "N updates"', () => {
    render(
      <WakeStreakHeader
        streak={makeStreak({
          liveTail: false,
          memberRowIds: ["a0", "a1", "a2"],
        })}
      />,
    );

    expect(screen.getByText("3 updates")).toBeTruthy();
    expect(screen.queryByText("3 earlier updates")).toBeNull();
  });

  it("uses the singular noun for a one-row streak, still respecting liveTail", () => {
    render(
      <WakeStreakHeader
        streak={makeStreak({ liveTail: true, memberRowIds: ["a0"] })}
      />,
    );

    expect(screen.getByText("1 earlier update")).toBeTruthy();
  });

  it('shows "+N more" once the source count exceeds the two-name cap', () => {
    render(
      <WakeStreakHeader
        streak={makeStreak({
          sources: [
            { title: "build watch", updateCount: 1 },
            { title: "deploy watch", updateCount: 1 },
            { title: "lint watch", updateCount: 1 },
            { title: "test watch", updateCount: 1 },
          ],
        })}
      />,
    );

    expect(screen.getByText("+2 more")).toBeTruthy();
    expect(screen.getByText(/build watch/)).toBeTruthy();
    expect(screen.getByText(/deploy watch/)).toBeTruthy();
    // Only the first two sources are named outside the tooltip.
    expect(screen.queryByText(/lint watch/)).toBeNull();
  });

  it('names sources with no "+N more" when there are two or fewer', () => {
    render(
      <WakeStreakHeader
        streak={makeStreak({
          sources: [
            { title: "build watch", updateCount: 1 },
            { title: "deploy watch", updateCount: 1 },
          ],
        })}
      />,
    );

    expect(screen.queryByText(/\+\d+ more/)).toBeNull();
  });
});
