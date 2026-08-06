import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  type RenderResult,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { DndContext } from "@dnd-kit/core";
import type { BackgroundItem } from "@traycer/protocol/host/agent/gui/subscribe";
import type { AutonomousResumeTrigger } from "@traycer/protocol/persistence/epic/content-blocks";
import type { ManagedCommand } from "@traycer/protocol/host/managed-command/unary-schemas";
import type { ManagedCommandListStreamCallbacks } from "@traycer-clients/shared/host-transport/managed-command-list-stream-client";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * The chat's own managed-command surfaces: the chip and the resume divider are
 * doors into the output window, both kind-explicit; the Background panel lists
 * what this chat has running right now; and the monitors menu is the home for
 * the chat's commands in every state.
 */

const streamSupport = vi.hoisted<{ value: string }>(() => ({
  value: "supported",
}));

vi.mock("@/lib/host/stream-runtime-context", () => ({
  useWsStreamClient: () => null,
  useStreamMethodSupport: () => streamSupport.value,
  useStreamMethodSchemaVersion: () => null,
}));

// The one faked boundary: the lifecycle RPCs behind a managed row's hover
// actions. Everything the surfaces do with them - which rows offer them, what
// they are called with - is real. The aggregated stop-all has its own suite
// over a real host client.
const stopMutate = vi.fn();
const stopAllMutate = vi.fn();
const stopAllFlight = { isPending: false };
vi.mock(
  "@/hooks/managed-command/use-managed-command-lifecycle-mutations",
  () => ({
    useManagedCommandStart: () => ({ mutate: vi.fn(), isPending: false }),
    useManagedCommandStop: () => ({ mutate: stopMutate, isPending: false }),
    useManagedCommandStopAll: () => ({
      mutate: stopAllMutate,
      isPending: stopAllFlight.isPending,
    }),
    useManagedCommandDelete: () => ({ mutate: vi.fn(), isPending: false }),
  }),
);

import { TabHostProvider } from "@/components/epic-canvas/tab-host-provider";
import { EpicSessionContext } from "@/lib/registries/epic-session-registry";
import {
  createOpenEpicStore,
  type EpicStreamClientFactory,
  type OpenEpicStoreHandle,
} from "@/stores/epics/open-epic/store";
import { ManagedCommandListStreamMount } from "@/providers/managed-command-list-stream-mount";
import { __setManagedCommandListStreamClientFactoryForTests } from "@/providers/managed-command-list-stream-factory-override";
import { managedCommandListRegistry } from "@/stores/managed-commands/managed-command-list-registry";
import {
  DEFAULT_CHAT_TURN_MINIMAP_SIDE,
  useSettingsStore,
} from "@/stores/settings/settings-store";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";
import { findOpenArtifactInTab } from "@/stores/epics/canvas/canvas-selectors";
import { ManagedCommandBadge } from "@/components/chat/queued-message-surface";
import { AutonomousResumeSegment } from "@/components/chat/segments/autonomous-resume-segment";
import { BackgroundItemsPanel } from "@/components/chat/chat-background-items-panel";
import {
  ManagedCommandChatMenu,
  ManagedCommandChatMenuOverlay,
} from "@/components/managed-commands/managed-command-chat-menu";
import { useManagedCommandAttentionStore } from "@/stores/managed-commands/managed-command-attention-store";

const EPIC_ID = "epic-1";
const TAB_ID = "tab-1";
const CHAT_ID = "chat-1";

/** One harness-owned background row, so the panel is never managed-only. */
const HARNESS_ITEM: BackgroundItem = {
  taskId: "harness-task",
  kind: "command",
  title: "bun run compile",
  blockId: "harness-task-tool",
  parentTaskId: null,
  scheduledFor: null,
};

function command(over: Partial<ManagedCommand>): ManagedCommand {
  return {
    id: "cmd-1",
    kind: "monitor",
    description: "deploy watcher",
    status: { state: "running", pid: 4410, startedAtMs: 10 },
    chatId: CHAT_ID,
    createdAtMs: 10,
    updatedAtMs: 10,
    ...over,
  };
}

function trigger(
  over: Partial<AutonomousResumeTrigger>,
): AutonomousResumeTrigger {
  return {
    kind: "monitor",
    blockId: "block-1",
    title: "deploy watcher",
    status: "completed",
    summary: "",
    live: false,
    outputFile: null,
    mcp: null,
    managedCommand: null,
    ...over,
  };
}

function installListStub(): { emit: () => ManagedCommandListStreamCallbacks } {
  let captured: ManagedCommandListStreamCallbacks | null = null;
  __setManagedCommandListStreamClientFactoryForTests((_epicId, callbacks) => {
    captured = callbacks;
    return { close: () => undefined };
  });
  return {
    emit: () => {
      if (captured === null) throw new Error("list callbacks not wired");
      return captured;
    },
  };
}

function chatTileTree(node: ReactNode): ReactNode {
  return (
    <EpicSessionContext.Provider value={epicHandle}>
      <TabHostProvider hostId="host-1">
        <TooltipProvider>{node}</TooltipProvider>
      </TabHostProvider>
    </EpicSessionContext.Provider>
  );
}

function renderInChatTile(node: ReactNode): RenderResult {
  return render(chatTileTree(node));
}

const noopStreamClientFactory: EpicStreamClientFactory = () => ({
  applyUpdate: () => undefined,
  awareness: () => undefined,
  applyArtifactRoomUpdate: () => undefined,
  artifactRoomAwareness: () => undefined,
  retryMigration: () => undefined,
  close: () => undefined,
});

let epicHandle: OpenEpicStoreHandle;

beforeEach(() => {
  stopMutate.mockClear();
  stopAllMutate.mockClear();
  stopAllFlight.isPending = false;
  streamSupport.value = "supported";
  useManagedCommandAttentionStore.setState(
    useManagedCommandAttentionStore.getInitialState(),
    true,
  );
  useSettingsStore.setState({
    chatTurnMinimapSide: DEFAULT_CHAT_TURN_MINIMAP_SIDE,
  });
  epicHandle = createOpenEpicStore({
    epicId: EPIC_ID,
    streamClientFactory: noopStreamClientFactory,
    userId: null,
    onAuthError: null,
  });
  useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
  useEpicCanvasStore.setState({
    tabsById: { [TAB_ID]: { tabId: TAB_ID, epicId: EPIC_ID, name: "Epic 1" } },
    openTabOrder: [TAB_ID],
    activeTabId: TAB_ID,
  });
});

afterEach(() => {
  cleanup();
  epicHandle.dispose();
  __setManagedCommandListStreamClientFactoryForTests(null);
  managedCommandListRegistry.disposeAll();
  useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
});

describe("queued-delivery chip", () => {
  it("names the kind of command whose output is waiting", () => {
    renderInChatTile(
      <ManagedCommandBadge commandId="cmd-1" commandKind="shell" />,
    );

    expect(screen.getByTestId("queued-managed-command-badge").textContent).toBe(
      "Shell output",
    );
  });

  it("falls back to a kind-free label when the host did not say", () => {
    renderInChatTile(
      <ManagedCommandBadge commandId="cmd-1" commandKind={null} />,
    );

    expect(screen.getByTestId("queued-managed-command-badge").textContent).toBe(
      "Command output",
    );
  });

  it("shows the kind's own glyph rather than a terminal one", () => {
    renderInChatTile(
      <ManagedCommandBadge commandId="cmd-1" commandKind="shell" />,
    );

    const badge = screen.getByTestId("queued-managed-command-badge");
    expect(badge.querySelector("[data-kind-icon='shell']")).not.toBeNull();
  });

  it("describes what is waiting in monitor/shell words, not 'background command'", () => {
    renderInChatTile(
      <ManagedCommandBadge commandId="cmd-1" commandKind="monitor" />,
    );

    fireEvent.focus(screen.getByTestId("queued-managed-command-badge"));

    const tip = screen.getAllByRole("tooltip")[0];
    expect(tip.textContent).toContain("monitor");
    expect(tip.textContent).not.toContain("background command");
  });

  it("is a door into the command's output window", () => {
    renderInChatTile(
      <ManagedCommandBadge commandId="cmd-1" commandKind="monitor" />,
    );

    fireEvent.click(screen.getByTestId("queued-managed-command-badge"));

    expect(findOpenArtifactInTab(TAB_ID, "cmd-1")).not.toBeNull();
  });
});

describe("resume divider", () => {
  it("names the real kind while the command is still running", () => {
    renderInChatTile(
      <AutonomousResumeSegment
        triggers={[
          trigger({
            blockId: "block-live-monitor",
            live: true,
            managedCommand: { commandId: "cmd-1", kind: "monitor" },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Monitor still running")).not.toBeNull();
  });

  it("says Shell, not Command, for a backgrounded shell's mid-run output", () => {
    renderInChatTile(
      <AutonomousResumeSegment
        triggers={[
          trigger({
            blockId: "block-live-shell",
            live: true,
            managedCommand: { commandId: "cmd-2", kind: "shell" },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Shell still running")).not.toBeNull();
  });

  it("keeps the kind-free copy for a legacy trigger that names no kind", () => {
    // Written before the trigger carried `managedCommand`, so the divider has
    // nothing to be specific about and must not guess.
    renderInChatTile(
      <AutonomousResumeSegment
        triggers={[
          trigger({
            blockId: "block-live-legacy",
            live: true,
            managedCommand: null,
          }),
        ]}
      />,
    );

    expect(screen.getByText("Command still running")).not.toBeNull();
  });

  it("names the real kind in its terminal copy", () => {
    renderInChatTile(
      <AutonomousResumeSegment
        triggers={[
          trigger({
            status: "completed",
            managedCommand: { commandId: "cmd-1", kind: "shell" },
          }),
        ]}
      />,
    );

    // The persisted trigger kind is frozen at "monitor" for both; the real
    // kind rides `trigger.managedCommand`.
    expect(screen.getByText("Shell completed")).not.toBeNull();
  });

  it("keeps the generic copy and offers no door for an old trigger", () => {
    renderInChatTile(
      <AutonomousResumeSegment
        triggers={[trigger({ status: "failed", managedCommand: null })]}
      />,
    );

    expect(screen.getByText("Monitor failed")).not.toBeNull();
    expect(
      screen.queryByTestId("resume-managed-command-door-block-1"),
    ).toBeNull();
  });

  it("opens the command's output window when it carries one", () => {
    renderInChatTile(
      <AutonomousResumeSegment
        triggers={[
          trigger({
            managedCommand: { commandId: "cmd-1", kind: "monitor" },
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId("resume-managed-command-door-block-1"));

    expect(findOpenArtifactInTab(TAB_ID, "cmd-1")).not.toBeNull();
  });
});

describe("running commands in the Background panel", () => {
  function renderPanel(items: ReadonlyArray<BackgroundItem>): {
    emit: () => ManagedCommandListStreamCallbacks;
    onStopAll: Mock<() => string | null>;
  } {
    return renderPanelWith(items, true);
  }

  /** `canAct` is "this chat's stream is open" - a harness-side capability. */
  function renderPanelWith(
    items: ReadonlyArray<BackgroundItem>,
    canAct: boolean,
  ): {
    emit: () => ManagedCommandListStreamCallbacks;
    onStopAll: Mock<() => string | null>;
  } {
    const stub = installListStub();
    const onStopAll: Mock<() => string | null> = vi.fn(() => null);
    renderInChatTile(
      <>
        <ManagedCommandListStreamMount epicId={EPIC_ID} />
        <BackgroundItemsPanel
          items={items}
          epicId={EPIC_ID}
          chatId={CHAT_ID}
          canAct={canAct}
          readOnly={false}
          pendingStopTaskIds={new Set()}
          stopAllPending={false}
          scrollRegionMaxHeightClass="max-h-96"
          separated={false}
          onItemClick={() => undefined}
          onStopItem={() => null}
          onStopAll={onStopAll}
        />
      </>,
    );
    return { emit: stub.emit, onStopAll };
  }

  function expandPanel(): void {
    fireEvent.click(screen.getByRole("button", { name: /Background/ }));
  }

  it("lists only this chat's running commands, kind-explicit", () => {
    const stub = renderPanel([]);
    act(() => {
      stub.emit().onSnapshot([
        command({ id: "mine-running" }),
        command({
          id: "mine-exited",
          status: { state: "exited", exitCode: 0, signal: null, exitedAtMs: 5 },
        }),
        command({ id: "other-chat", chatId: "chat-2" }),
      ]);
    });
    expandPanel();

    const rows = screen.getAllByTestId(/^managed-command-background-row-/);
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "managed-command-background-row-mine-running",
    ]);
    expect(rows[0].textContent).toContain("Monitor · deploy watcher");
  });

  it("drops a row the moment its command reaches a terminal state", () => {
    const stub = renderPanel([]);
    act(() => {
      stub.emit().onSnapshot([command({ id: "mine-running" })]);
    });
    expandPanel();

    act(() => {
      stub.emit().onChanged(
        command({
          id: "mine-running",
          status: { state: "exited", exitCode: 0, signal: null, exitedAtMs: 5 },
        }),
      );
    });

    expect(
      screen.queryByTestId("managed-command-background-row-mine-running"),
    ).toBeNull();
  });

  it("opens the output window from a row", () => {
    const stub = renderPanel([]);
    act(() => {
      stub.emit().onSnapshot([command({ id: "mine-running" })]);
    });
    expandPanel();

    fireEvent.click(
      screen.getByTestId("managed-command-background-row-mine-running"),
    );

    expect(findOpenArtifactInTab(TAB_ID, "mine-running")).not.toBeNull();
  });

  it("reads in the panel's own row grammar: kind glyph, uppercase kind pill, elapsed, hover stop", () => {
    const stub = renderPanel([]);
    act(() => {
      stub.emit().onSnapshot([
        command({
          id: "mine-running",
          kind: "shell",
          status: {
            state: "running",
            pid: 4410,
            startedAtMs: Date.now() - 65_000,
          },
        }),
      ]);
    });
    expandPanel();

    const row = screen.getByTestId(
      "managed-command-background-row-mine-running",
    );
    // The glyph is what keeps a supervised shell apart from the harness's own
    // background kinds; the pill names it in the panel's existing grammar.
    expect(row.querySelector("[data-kind-icon='shell']")).not.toBeNull();
    expect(row.textContent).toContain("Shell");
    // Same clock format the harness rows use, so two rows side by side read
    // as one list rather than two conventions.
    expect(row.textContent).toContain("1m 5s");

    fireEvent.click(screen.getByTestId("managed-command-stop-mine-running"));
    expect(stopMutate).toHaveBeenCalledWith({
      hostId: "host-1",
      epicId: EPIC_ID,
      commandId: "mine-running",
    });
  });

  it("offers stop and nothing destructive: this is a status, not the object", () => {
    const stub = renderPanel([]);
    act(() => {
      stub.emit().onSnapshot([command({ id: "mine-running" })]);
    });
    expandPanel();

    expect(
      screen.getByTestId("managed-command-stop-mine-running"),
    ).not.toBeNull();
    // Delete destroys the command's whole output history. It belongs to the
    // chat's monitors menu and the output window, where a command is a durable
    // object - not to a row that exists only while the process does.
    expect(
      screen.queryByTestId("managed-command-delete-mine-running"),
    ).toBeNull();
    expect(
      screen.queryByTestId("managed-command-start-mine-running"),
    ).toBeNull();
  });

  it("counts managed commands into the one running total the button can keep", () => {
    const stub = renderPanel([HARNESS_ITEM]);
    act(() => {
      stub
        .emit()
        .onSnapshot([
          command({ id: "m1", kind: "monitor" }),
          command({ id: "m2", kind: "monitor" }),
          command({ id: "s1", kind: "shell" }),
        ]);
    });

    // One press of Stop all now reaches all four, so one summed total is a
    // promise the button keeps.
    expect(screen.getByTestId("background-header-summary").textContent).toBe(
      "4 running",
    );
  });

  it("keeps the plain summary when the chat has no managed commands", () => {
    const stub = renderPanel([HARNESS_ITEM]);
    act(() => {
      stub.emit().onSnapshot([]);
    });

    expect(screen.getByTestId("background-header-summary").textContent).toBe(
      "1 running",
    );
  });

  it("stops the managed rows too when Stop all is pressed, as one action", () => {
    const stub = renderPanel([HARNESS_ITEM]);
    act(() => {
      stub
        .emit()
        .onSnapshot([
          command({ id: "m1" }),
          command({ id: "m2", kind: "shell" }),
        ]);
    });
    expandPanel();

    fireEvent.click(screen.getByTestId("background-stop-all"));

    // The harness stop-all cannot reach host-supervised commands, so those go
    // through their own stop alongside it - one button, two mechanisms. The
    // managed half is ONE call over the whole set, not one per row: a host
    // that has gone away fails them all for the same reason, and per-row
    // mutations reported that reason once per row.
    expect(stub.onStopAll).toHaveBeenCalledTimes(1);
    expect(stopAllMutate).toHaveBeenCalledTimes(1);
    expect(stopAllMutate).toHaveBeenCalledWith({
      hostId: "host-1",
      epicId: EPIC_ID,
      commandIds: ["m1", "m2"],
    });
    expect(stopMutate).not.toHaveBeenCalled();
  });

  it("never re-sends the managed set while its stop is in flight", () => {
    stopAllFlight.isPending = true;
    const stub = renderPanel([HARNESS_ITEM]);
    act(() => {
      stub.emit().onSnapshot([command({ id: "m1" })]);
    });
    expandPanel();

    // The harness half is still ready, so the button stays live - but a press
    // during the managed fan-out must reach only the harness half, never
    // re-send the managed set.
    const stopAllButton = screen.getByRole<HTMLButtonElement>("button", {
      name: "Stop all",
    });
    expect(stopAllButton.disabled).toBe(false);
    fireEvent.click(stopAllButton);
    expect(stub.onStopAll).toHaveBeenCalledTimes(1);
    expect(stopAllMutate).not.toHaveBeenCalled();
  });

  it("disables Stop all only when neither half can act", () => {
    stopAllFlight.isPending = true;
    const stub = renderPanelWith([HARNESS_ITEM], false);
    act(() => {
      stub.emit().onSnapshot([command({ id: "m1" })]);
    });

    // Harness half gated by the closed stream, managed half in flight: with
    // nothing left for a press to do, the button finally disables.
    const stopAllButton = screen.getByRole<HTMLButtonElement>("button", {
      name: "Stop all",
    });
    expect(stopAllButton.disabled).toBe(true);
    fireEvent.click(stopAllButton);
    expect(stub.onStopAll).not.toHaveBeenCalled();
  });

  it("keeps a managed row stoppable while the chat stream is reconnecting", () => {
    const stub = renderPanelWith([HARNESS_ITEM], false);
    act(() => {
      stub.emit().onSnapshot([command({ id: "m1" })]);
    });
    expandPanel();

    // Stopping a managed command is an RPC to its host; the chat's own stream
    // has no part in it. Gating it on `canAct` left a reconnecting chat with
    // no way to stop a runaway monitor from anywhere in the panel.
    expect(screen.getByTestId("managed-command-stop-m1")).not.toBeNull();
    // The harness row's stop DOES ride the chat stream, so it stays gated.
    expect(
      screen
        .getByRole("button", { name: "Stop Command" })
        .getAttribute("disabled"),
    ).not.toBeNull();

    // And the aggregate follows the same split: the button stays live for the
    // managed half, and a press skips the unreachable harness half rather
    // than dying with it - a reconnect is exactly when a runaway monitor
    // needs the one-click stop.
    const stopAllButton = screen.getByRole<HTMLButtonElement>("button", {
      name: "Stop all",
    });
    expect(stopAllButton.disabled).toBe(false);
    fireEvent.click(stopAllButton);
    expect(stub.onStopAll).not.toHaveBeenCalled();
    expect(stopAllMutate).toHaveBeenCalledTimes(1);
    expect(stopAllMutate).toHaveBeenCalledWith({
      hostId: "host-1",
      epicId: EPIC_ID,
      commandIds: ["m1"],
    });
  });

  it("no longer disclaims a subset Stop all cannot reach", () => {
    const stub = renderPanel([HARNESS_ITEM]);
    act(() => {
      stub.emit().onSnapshot([command({ id: "m1" })]);
    });
    expandPanel();

    expect(screen.queryByText("Not stopped by Stop all")).toBeNull();
    expect(screen.queryByText("Monitors and shells")).toBeNull();
  });
});

describe("the chat's monitors menu", () => {
  function renderMenu(): { emit: () => ManagedCommandListStreamCallbacks } {
    const stub = installListStub();
    renderInChatTile(
      <DndContext>
        <ManagedCommandListStreamMount epicId={EPIC_ID} />
        <ManagedCommandChatMenu
          epicId={EPIC_ID}
          chatId={CHAT_ID}
          hostId="host-1"
          viewTabId={TAB_ID}
        />
      </DndContext>,
    );
    return stub;
  }

  function trigger$(): HTMLElement | null {
    return screen.queryByTestId("managed-command-chat-menu-trigger");
  }

  function openMenu(): void {
    fireEvent.click(screen.getByTestId("managed-command-chat-menu-trigger"));
  }

  function exited(over: Partial<ManagedCommand>): ManagedCommand {
    return command({
      status: { state: "exited", exitCode: 1, signal: null, exitedAtMs: 20 },
      updatedAtMs: 20,
      ...over,
    });
  }

  it("is absent until this chat owns a command, and present for any state", () => {
    const stub = renderMenu();
    act(() => {
      stub.emit().onSnapshot([command({ id: "other", chatId: "chat-2" })]);
    });
    expect(trigger$()).toBeNull();

    act(() => {
      stub.emit().onChanged(
        command({
          id: "mine-done",
          status: { state: "stopped", stoppedAtMs: 30 },
        }),
      );
    });
    // A finished command still belongs to the chat, so the door to it stays.
    expect(trigger$()).not.toBeNull();
  });

  it("counts what is running, and says nothing when nothing is", () => {
    const stub = renderMenu();
    act(() => {
      stub.emit().onSnapshot([
        command({ id: "r1" }),
        command({ id: "r2", kind: "shell" }),
        command({
          id: "done",
          status: { state: "stopped", stoppedAtMs: 30 },
        }),
      ]);
    });

    expect(
      screen.getByTestId("managed-command-chat-menu-running").textContent,
    ).toBe("2");

    act(() => {
      stub
        .emit()
        .onChanged(
          command({ id: "r1", status: { state: "stopped", stoppedAtMs: 31 } }),
        );
      stub.emit().onChanged(
        command({
          id: "r2",
          kind: "shell",
          status: { state: "stopped", stoppedAtMs: 31 },
        }),
      );
    });

    expect(
      screen.queryByTestId("managed-command-chat-menu-running"),
    ).toBeNull();
    expect(
      screen.queryByTestId("managed-command-chat-menu-attention"),
    ).toBeNull();
  });

  it("lights attention for a failed shell and a monitor that exited on its own, never for a stop", () => {
    const stub = renderMenu();
    act(() => {
      stub.emit().onSnapshot([
        // A shell that failed: its ending is not the one it promised.
        exited({ id: "shell-failed", kind: "shell" }),
        // A monitor that exited cleanly is still a watcher that stopped
        // watching, which is exactly the thing worth being told.
        exited({
          id: "monitor-clean-exit",
          kind: "monitor",
          status: {
            state: "exited",
            exitCode: 0,
            signal: null,
            exitedAtMs: 20,
          },
        }),
        // Asked for by a human or an agent: never news.
        command({
          id: "stopped-by-someone",
          status: { state: "stopped", stoppedAtMs: 20 },
        }),
        // A clean shell run ended the way it said it would.
        exited({
          id: "shell-clean",
          kind: "shell",
          status: {
            state: "exited",
            exitCode: 0,
            signal: null,
            exitedAtMs: 20,
          },
        }),
      ]);
    });

    expect(
      screen.getByTestId("managed-command-chat-menu-attention").textContent,
    ).toBe("2");
  });

  it("lets attention beat running, then clears it once the menu has been opened", () => {
    const stub = renderMenu();
    act(() => {
      stub
        .emit()
        .onSnapshot([
          command({ id: "live" }),
          exited({ id: "failed", kind: "shell" }),
        ]);
    });

    // Both apply; the failure is the thing to say.
    expect(
      screen.getByTestId("managed-command-chat-menu-attention").textContent,
    ).toBe("1");
    expect(
      screen.queryByTestId("managed-command-chat-menu-running"),
    ).toBeNull();

    openMenu();
    // The row spells the outcome out, so the badge has nothing left to report.
    expect(
      screen.getByTestId("managed-command-menu-row-failed").textContent,
    ).toContain("Exited · code 1");
    expect(
      screen.queryByTestId("managed-command-chat-menu-attention"),
    ).toBeNull();
    expect(
      screen.getByTestId("managed-command-chat-menu-running").textContent,
    ).toBe("1");
  });

  it("does not re-arm another chat's acknowledged failures", () => {
    const stub = installListStub();
    renderInChatTile(
      <DndContext>
        <ManagedCommandListStreamMount epicId={EPIC_ID} />
        <ManagedCommandChatMenu
          epicId={EPIC_ID}
          chatId={CHAT_ID}
          hostId="host-1"
          viewTabId={TAB_ID}
        />
        <ManagedCommandChatMenu
          epicId={EPIC_ID}
          chatId="chat-2"
          hostId="host-1"
          viewTabId={TAB_ID}
        />
      </DndContext>,
    );
    act(() => {
      stub
        .emit()
        .onSnapshot([
          exited({ id: "a-failed", kind: "shell" }),
          exited({ id: "b-failed", kind: "shell", chatId: "chat-2" }),
        ]);
    });

    const [menuA, menuB] = screen.getAllByTestId(
      "managed-command-chat-menu-trigger",
    );
    fireEvent.click(menuA);
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.click(menuB);

    // Acknowledgement is one map across every chat, and each menu only ever
    // knows its own commands - so opening chat B must MERGE rather than
    // rebuild, or chat A's already-seen failure lights up again.
    const attention = screen.queryAllByTestId(
      "managed-command-chat-menu-attention",
    );
    expect(attention).toHaveLength(0);
  });

  it("re-arms when an acknowledged command fails again", () => {
    const stub = renderMenu();
    act(() => {
      stub.emit().onSnapshot([exited({ id: "flaky", kind: "shell" })]);
    });
    openMenu();
    expect(
      screen.queryByTestId("managed-command-chat-menu-attention"),
    ).toBeNull();

    act(() => {
      stub.emit().onChanged(
        exited({
          id: "flaky",
          kind: "shell",
          status: {
            state: "exited",
            exitCode: 2,
            signal: null,
            exitedAtMs: 99,
          },
          updatedAtMs: 99,
        }),
      );
    });

    expect(
      screen.getByTestId("managed-command-chat-menu-attention").textContent,
    ).toBe("1");
  });

  it("stays put with an empty state when its last command is deleted while open", () => {
    const stub = renderMenu();
    act(() => {
      stub.emit().onSnapshot([command({ id: "only" })]);
    });
    openMenu();

    act(() => {
      stub.emit().onRemoved("only");
    });

    // Removing the button under the pointer that just pressed Delete would
    // take the popover with it.
    expect(trigger$()).not.toBeNull();
    expect(
      screen.getByTestId("managed-command-chat-menu-empty").textContent,
    ).toBe("No monitors or shells left");
  });

  it("opens the command's output window from a row", () => {
    const stub = renderMenu();
    act(() => {
      stub.emit().onSnapshot([command({ id: "door" })]);
    });
    openMenu();

    fireEvent.click(screen.getByTestId("managed-command-menu-row-door"));

    expect(findOpenArtifactInTab(TAB_ID, "door")).not.toBeNull();
  });

  it("sits at the transcript's top-right corner whatever the minimap is doing", () => {
    const stub = installListStub();
    renderInChatTile(
      <DndContext>
        <ManagedCommandListStreamMount epicId={EPIC_ID} />
        <ManagedCommandChatMenuOverlay
          epicId={EPIC_ID}
          chatId={CHAT_ID}
          hostId="host-1"
          viewTabId={TAB_ID}
        />
      </DndContext>,
    );
    act(() => {
      stub.emit().onSnapshot([command({ id: "only" })]);
    });

    // The badge used to step inboard by the minimap lane's width to dodge the
    // first-turn hover preview. That card is far wider than the lane, so the
    // offset landed deeper inside it rather than clear of it - and the lane is
    // pointer-inert anyway, so the overlap costs nothing but a moment's
    // occlusion. One placement, no special case.
    const overlay = screen.getByTestId("managed-command-chat-menu-overlay");
    expect(overlay.className).toContain("right-2");

    act(() => {
      useSettingsStore.setState({ chatTurnMinimapSide: "left" });
    });
    expect(
      screen.getByTestId("managed-command-chat-menu-overlay").className,
    ).toContain("right-2");

    act(() => {
      useSettingsStore.setState({ chatTurnMinimapSide: "hide" });
    });
    expect(
      screen.getByTestId("managed-command-chat-menu-overlay").className,
    ).toContain("right-2");
  });

  it("flags a lost host while keeping the last known rows", () => {
    const stub = renderMenu();
    act(() => {
      stub.emit().onSnapshot([command({ id: "frozen" })]);
    });
    openMenu();

    act(() => {
      stub.emit().onConnectionStatus("reconnecting", null);
    });

    // A dropped stream freezes the menu on its last snapshot. Without a word
    // for it, a stale list is indistinguishable from a quiet one.
    expect(
      screen.getByTestId("managed-command-chat-menu-disconnected"),
    ).not.toBeNull();
    expect(
      screen.getByTestId("managed-command-menu-row-frozen"),
    ).not.toBeNull();
  });

  it("reads as unavailable rather than empty on a host too old to answer", () => {
    const stub = installListStub();
    const menu = renderInChatTile(
      <DndContext>
        <ManagedCommandListStreamMount epicId={EPIC_ID} />
        <ManagedCommandChatMenu
          epicId={EPIC_ID}
          chatId={CHAT_ID}
          hostId="host-1"
          viewTabId={TAB_ID}
        />
      </DndContext>,
    );
    act(() => {
      stub.emit().onSnapshot([command({ id: "only" })]);
    });
    openMenu();

    // Held open across a swap to a host that does not serve the method: the
    // list goes away with the stream.
    streamSupport.value = "unsupported";
    act(() => {
      menu.rerender(
        chatTileTree(
          <DndContext>
            <ManagedCommandListStreamMount epicId={EPIC_ID} />
            <ManagedCommandChatMenu
              epicId={EPIC_ID}
              chatId={CHAT_ID}
              hostId="host-1"
              viewTabId={TAB_ID}
            />
          </DndContext>,
        ),
      );
    });

    // "No monitors or shells left" would be a lie about a chat whose monitors
    // this host simply cannot report.
    expect(
      screen.getByTestId("managed-command-chat-menu-unavailable"),
    ).not.toBeNull();
    expect(screen.queryByTestId("managed-command-chat-menu-empty")).toBeNull();
  });

  it("offers restart and delete on a finished command, stop on a live one", () => {
    const stub = renderMenu();
    act(() => {
      stub
        .emit()
        .onSnapshot([
          command({ id: "live" }),
          exited({ id: "over", kind: "shell" }),
        ]);
    });
    openMenu();

    expect(screen.getByTestId("managed-command-stop-live")).not.toBeNull();
    expect(screen.queryByTestId("managed-command-start-live")).toBeNull();
    expect(screen.getByTestId("managed-command-start-over")).not.toBeNull();
    expect(screen.getByTestId("managed-command-delete-over")).not.toBeNull();
  });
});
