import { Bot, Globe2, Plus, X } from "lucide-react";
import { useCallback, useMemo } from "react";
import type {
  BrowserSessionInfo,
  BrowserTabDriver,
  BrowserTabInfo,
} from "@traycer/protocol/host/browser/contracts";
import { AgentSpinningDots } from "@/components/ui/agent-spinning-dots";
import { Button } from "@/components/ui/button";
import { SidebarContent, SidebarGroup, SidebarGroupContent } from "@/components/ui/sidebar";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import type { LeftPanelSlotProps } from "@/components/epic-canvas/sidebar/left-panel-registry";
import { useBrowserSessionsContext } from "@/components/epic-canvas/renderers/browser-sessions-context";
import { useEpicNestedFocusNavigation } from "@/hooks/epic/use-epic-nested-focus-navigation";
import { useReactiveActiveHostId } from "@/hooks/host/use-reactive-active-host-id";
import {
  browserTabFaviconUrl,
  browserTabHostname,
  resolveTabTitle,
} from "@/lib/browser-view/browser-tab-display";
import { findElectronBrowserTabBinding } from "@/lib/browser-view/electron-browser-tab-store";
import { UNKNOWN_HOST_PLACEHOLDER } from "@/lib/host/constants";
import { cn } from "@/lib/utils";
import { useEpicChatRecords } from "@/lib/epic-selectors";
import {
  DEFAULT_BROWSER_TILE_NAME,
  DEFAULT_BROWSER_TILE_URL,
  DEFAULT_BROWSER_VIEWPORT_PRESET,
  makeBrowserSessionTileRef,
  makeBrowserTileRef,
} from "@/stores/epics/canvas/tile-schema/browser-tile";
import {
  findOpenArtifactInTab,
  useEpicCanvasStore,
} from "@/stores/epics/canvas/store";
import { makeOpenableNodeRef } from "@/stores/epics/canvas/types";
import {
  useEpicLeftPanelStore,
  useLeftPanelSectionCollapsed,
} from "@/stores/epics/left-panel-store";

/** Session's viewed tab, else its first - same rule the row itself uses. */
function resolveSessionActiveTab(
  session: BrowserSessionInfo,
): BrowserTabInfo | undefined {
  return session.tabs.find((tab) => tab.viewed) ?? session.tabs[0];
}

/**
 * host:port (not bare hostname) so two localhost dev servers on different
 * ports - the exact case that produced duplicate "127.0.0.1" close labels -
 * read as different origins.
 */
function tabOriginLabel(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    return parsed.host.length > 0 ? parsed.host : null;
  } catch {
    return null;
  }
}

/**
 * Unique accessible name for a row's close control. Most rows have a
 * genuinely distinct title and need nothing else; when several sessions
 * resolve to the same title (e.g. several tabs with no page title, all
 * falling back to the same bare host), the origin (host:port) disambiguates;
 * if even that collides, the session id is the one value guaranteed unique
 * per row - a last resort, not the common case.
 */
function resolveCloseAriaLabel(
  session: BrowserSessionInfo,
  activeTab: BrowserTabInfo,
  title: string,
  isDuplicateTitle: boolean,
): string {
  if (!isDuplicateTitle) return `Close ${title}`;
  const origin = tabOriginLabel(activeTab.url);
  if (origin !== null && origin !== title) return `Close ${title} (${origin})`;
  return `Close ${title} (${session.sessionId})`;
}

/**
 * Shared open-a-new-browser-tile action behind both the panel header's "Add
 * browser" button and the empty-state's own button - the same tile-open path
 * the pane opener's "New browser" command uses.
 */
function useAddBrowserAction(epicId: string, tabId: string): () => void {
  const hostId = useReactiveActiveHostId() ?? UNKNOWN_HOST_PLACEHOLDER;
  const navigateNested = useEpicNestedFocusNavigation();
  const prepareOpen = useEpicCanvasStore(
    (state) => state.prepareOpenTileInTabFocusTarget,
  );
  return useCallback(() => {
    navigateNested(epicId, tabId, () =>
      prepareOpen(
        tabId,
        makeBrowserTileRef({
          name: DEFAULT_BROWSER_TILE_NAME,
          hostId,
          url: DEFAULT_BROWSER_TILE_URL,
          viewportPreset: DEFAULT_BROWSER_VIEWPORT_PRESET,
        }),
      ),
    );
  }, [epicId, hostId, navigateNested, prepareOpen, tabId]);
}

export function BrowsersPanelActions(props: LeftPanelSlotProps) {
  const collapsed = useLeftPanelSectionCollapsed("browsers");
  const setPanelSectionCollapsed = useEpicLeftPanelStore(
    (state) => state.setPanelSectionCollapsed,
  );
  const addBrowser = useAddBrowserAction(props.epicId, props.tabId);
  const handleClick = useCallback(() => {
    if (collapsed) setPanelSectionCollapsed("browsers", false);
    addBrowser();
  }, [addBrowser, collapsed, setPanelSectionCollapsed]);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Add browser"
      data-testid="epic-browsers-panel-add"
      className="text-muted-foreground hover:text-foreground"
      onClick={handleClick}
    >
      <Plus className="size-4" />
    </Button>
  );
}

export function BrowsersPanelBody(props: LeftPanelSlotProps) {
  return (
    <SidebarContent className="min-h-0">
      <SidebarGroup className="min-h-0 flex-1 px-2 py-1">
        <SidebarGroupContent className="flex min-h-0 flex-1 flex-col">
          <BrowsersPanelBodyLive epicId={props.epicId} tabId={props.tabId} />
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
  );
}

function BrowsersPanelBodyLive(props: {
  readonly epicId: string;
  readonly tabId: string;
}) {
  const sessions = useBrowserSessionsContext();
  const chats = useEpicChatRecords();
  const chatById = useMemo(
    () => new Map(chats.map((chat) => [chat.id, chat])),
    [chats],
  );
  const duplicateTitles = useMemo(() => {
    const counts = new Map<string, number>();
    sessions.items.forEach((session) => {
      const activeTab = resolveSessionActiveTab(session);
      if (activeTab === undefined) return;
      const title = resolveTabTitle(activeTab);
      counts.set(title, (counts.get(title) ?? 0) + 1);
    });
    const duplicates = new Set<string>();
    counts.forEach((count, title) => {
      if (count > 1) duplicates.add(title);
    });
    return duplicates;
  }, [sessions.items]);
  const hostId = useReactiveActiveHostId() ?? UNKNOWN_HOST_PLACEHOLDER;
  const navigateNested = useEpicNestedFocusNavigation();
  const prepareOpen = useEpicCanvasStore(
    (state) => state.prepareOpenTileInTabFocusTarget,
  );
  const prepareFocus = useEpicCanvasStore(
    (state) => state.prepareSetActiveTileTabFocusTarget,
  );
  const addBrowser = useAddBrowserAction(props.epicId, props.tabId);

  const openTab = useCallback(
    (session: BrowserSessionInfo, tab: BrowserTabInfo) => {
      const binding = findElectronBrowserTabBinding(
        session.sessionId,
        tab.tabId,
      );
      const existingNative =
        binding === null
          ? null
          : findOpenArtifactInTab(props.tabId, binding.registrationId);
      const tile = makeBrowserSessionTileRef({
        name: tab.title ?? session.name,
        hostId: session.hostId,
        sessionId: session.sessionId,
        tabId: tab.tabId,
      });
      const existingPointer = findOpenArtifactInTab(props.tabId, tile.id);
      const existing = existingNative ?? existingPointer;
      navigateNested(props.epicId, props.tabId, () =>
        existing === null
          ? prepareOpen(props.tabId, tile)
          : prepareFocus(props.tabId, existing.paneId, existing.instanceId),
      );
    },
    [navigateNested, prepareFocus, prepareOpen, props.epicId, props.tabId],
  );

  const openDrivingChat = useCallback(
    (driver: BrowserTabDriver) => {
      const chat = chatById.get(driver.chatId);
      if (chat === undefined) return;
      const existing = findOpenArtifactInTab(props.tabId, chat.id);
      navigateNested(props.epicId, props.tabId, () =>
        existing === null
          ? prepareOpen(
              props.tabId,
              makeOpenableNodeRef({
                id: chat.id,
                instanceId: crypto.randomUUID(),
                type: "chat",
                name: chat.title,
                hostId,
              }),
            )
          : prepareFocus(props.tabId, existing.paneId, existing.instanceId),
      );
    },
    [chatById, hostId, navigateNested, prepareFocus, prepareOpen, props.epicId, props.tabId],
  );

  if (sessions.lifecycle === "connecting" && sessions.items.length === 0) {
    return <BrowsersPanelLoadingState />;
  }
  if (sessions.items.length === 0) {
    return <BrowsersPanelEmptyState onAddBrowser={addBrowser} />;
  }
  return (
    <ul
      aria-label="Browser sessions"
      className="space-y-0.5"
      data-testid="epic-browsers-panel-list"
    >
      {sessions.items.map((session) => (
        <BrowserSessionRow
          key={session.sessionId}
          session={session}
          chatById={chatById}
          duplicateTitles={duplicateTitles}
          onOpenTab={openTab}
          onOpenDrivingChat={openDrivingChat}
          onClose={sessions.closeSession}
        />
      ))}
    </ul>
  );
}

function BrowsersPanelLoadingState() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-ui-sm text-muted-foreground">
      <AgentSpinningDots
        className="shrink-0 text-muted-foreground/70"
        testId={undefined}
        variant={undefined}
      />
      <span>Loading browsers…</span>
    </div>
  );
}

function BrowsersPanelEmptyState(props: { readonly onAddBrowser: () => void }) {
  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center text-muted-foreground"
      data-testid="epic-browsers-panel-empty"
    >
      <Globe2 className="size-8 text-muted-foreground/45" aria-hidden />
      <div className="space-y-1">
        <p className="text-ui-sm text-muted-foreground/60">No browsers yet.</p>
        <p className="text-ui-xs text-muted-foreground/50">
          Agents open theirs here too.
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={props.onAddBrowser}>
        <Plus className="size-3.5" aria-hidden />
        Add browser
      </Button>
    </div>
  );
}

interface BrowserSessionRowProps {
  readonly session: BrowserSessionInfo;
  readonly chatById: ReadonlyMap<string, { readonly id: string; readonly title: string }>;
  readonly duplicateTitles: ReadonlySet<string>;
  readonly onOpenTab: (session: BrowserSessionInfo, tab: BrowserTabInfo) => void;
  readonly onOpenDrivingChat: (driver: BrowserTabDriver) => void;
  readonly onClose: (sessionId: string) => void;
}

function BrowserSessionRow(props: BrowserSessionRowProps) {
  const { session, chatById, duplicateTitles, onOpenTab, onOpenDrivingChat, onClose } =
    props;
  if (session.tabs.length === 0) return null;
  const primaryTab = session.tabs[0];
  const activeTab = session.tabs.find((tab) => tab.viewed) ?? primaryTab;
  const otherTabs = session.tabs.filter((tab) => tab.tabId !== activeTab.tabId);
  const title = resolveTabTitle(activeTab);
  const host = browserTabHostname(activeTab.url);
  const isDormant = activeTab.status === "dormant";
  const closeAriaLabel = resolveCloseAriaLabel(
    session,
    activeTab,
    title,
    duplicateTitles.has(title),
  );

  return (
    <li>
      <div
        className={cn(
          "group flex min-h-9 min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-sidebar-accent",
          isDormant && "opacity-60",
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-ui-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onOpenTab(session, activeTab)}
        >
          <BrowserFavicon tab={activeTab} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              {isDormant ? (
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                />
              ) : null}
              <span className="truncate">{title}</span>
            </span>
            {host === null ? null : (
              <span className="truncate text-ui-xs text-muted-foreground">
                {host}
              </span>
            )}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {session.profile === "isolated" ? (
            <span className="shrink-0 rounded-sm border border-amber-500/30 bg-amber-500/10 px-1 py-0.5 text-[0.625rem] leading-none text-amber-700 dark:text-amber-300">
              isolated
            </span>
          ) : null}
          {activeTab.drivenBy.map((driver) => {
            const chatTitle = chatById.get(driver.chatId)?.title ?? driver.chatId;
            return (
              <TooltipWrapper
                key={driver.requestId}
                label={`Driven by ${chatTitle}`}
                side="top"
                sideOffset={undefined}
                align={undefined}
              >
                <button
                  type="button"
                  aria-label={`Open driving chat ${chatTitle}`}
                  className="flex size-5 items-center justify-center rounded-sm text-blue-500 outline-none hover:bg-blue-500/10 focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onOpenDrivingChat(driver)}
                >
                  <Bot className="size-3" aria-hidden />
                </button>
              </TooltipWrapper>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={closeAriaLabel}
            onClick={() => onClose(session.sessionId)}
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>
      {otherTabs.length === 0 ? null : (
        <ul className="ml-7 space-y-0.5">
          {otherTabs.map((tab) => {
            const tabTitle = resolveTabTitle(tab);
            return (
              <li key={tab.tabId}>
                <button
                  type="button"
                  aria-label={`Open ${tabTitle}`}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-ui-xs text-muted-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring",
                    tab.status === "dormant" && "opacity-60",
                  )}
                  onClick={() => onOpenTab(session, tab)}
                >
                  <BrowserFavicon tab={tab} />
                  <span className="truncate">{tabTitle}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function BrowserFavicon(props: { readonly tab: BrowserTabInfo }) {
  const favicon = browserTabFaviconUrl(props.tab.url);
  if (favicon === null) {
    return <Globe2 className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  return (
    <img
      src={favicon}
      alt=""
      className="size-3.5 shrink-0 rounded-sm"
      onError={(event) => {
        event.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}
