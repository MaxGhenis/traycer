import { useDraggable } from "@dnd-kit/core";
import {
  Bot,
  Globe2,
  ListFilter,
  Moon,
  Plus,
  RotateCcw,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type {
  BrowserSessionInfo,
  BrowserTabDriver,
  BrowserTabInfo,
} from "@traycer/protocol/host/browser/contracts";
import { AgentSpinningDots } from "@/components/ui/agent-spinning-dots";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
} from "@/components/ui/sidebar";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import {
  BROWSER_TILE_DND_TYPE,
  getBrowserTileDragId,
  getPaneScopedDndId,
  type EpicCanvasBrowserTileDragData,
} from "@/components/epic-canvas/dnd/dnd";
import type { LeftPanelSlotProps } from "@/components/epic-canvas/sidebar/left-panel-registry";
import { useBrowserSessionsContext } from "@/components/epic-canvas/renderers/browser-sessions-context";
import { BrowserSessionsHostProvider } from "@/components/epic-canvas/renderers/browser-session-dock";
import { HostOptionRow } from "@/components/settings/host-scope/host-option-row";
import {
  AVAILABLE_HOST_ROW_SURFACE_STATE,
  isHostOptionSelectable,
} from "@/components/settings/host-scope/host-option-model";
import { useHostOptions } from "@/components/settings/host-scope/use-host-options";
import { useEpicNestedFocusNavigation } from "@/hooks/epic/use-epic-nested-focus-navigation";
import { useCanvasHostId } from "@/components/epic-canvas/hooks/use-canvas-host-id";
import {
  useSurfaceHostClient,
  useSurfaceHostPin,
  useTabSurfaceKey,
} from "@/hooks/host/use-surface-host-pin";
import { useHostDirectoryEntryForHostId } from "@/hooks/host/use-host-client-for-host-id";
import {
  browserTabFaviconUrl,
  browserTabHostname,
  resolveTabTitle,
} from "@/lib/browser-view/browser-tab-display";
import { findElectronBrowserTabBindingOnHost } from "@/lib/browser-view/electron-browser-tab-store";
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
  findOpenTileInTab,
  useEpicCanvasStore,
} from "@/stores/epics/canvas/store";
import { findPaneById } from "@/stores/epics/canvas/tile-tree";
import { makeOpenableNodeRef } from "@/stores/epics/canvas/types";
import {
  useEpicLeftPanelStore,
  useLeftPanelSectionCollapsed,
} from "@/stores/epics/left-panel-store";
import {
  usePanelHeaderSearchOpen,
  usePanelHeaderSearchQuery,
  usePanelHeaderSearchSlot,
  usePanelHeaderSearchStore,
} from "@/stores/epics/panel-header-search-store";
import {
  usePanelHeaderMenuOpen,
  usePanelHeaderMenuStore,
} from "@/stores/epics/panel-header-menu-store";

const BROWSERS_PANEL_ID = "browsers";
const FOLLOW_ACTIVE_HOST_VALUE = "browser-follow-active-host";

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
 * genuinely distinct title and need nothing else; when several tabs
 * resolve to the same title (e.g. several tabs with no page title, all
 * falling back to the same bare host), the origin (host:port) disambiguates;
 * if even that collides, the tab id is the one value guaranteed unique
 * per row - a last resort, not the common case.
 */
function resolveCloseAriaLabel(
  tab: BrowserTabInfo,
  title: string,
  isDuplicateTitle: boolean,
): string {
  if (!isDuplicateTitle) return `Close ${title}`;
  const origin = tabOriginLabel(tab.url);
  if (origin !== null && origin !== title) return `Close ${title} (${origin})`;
  return `Close ${title} (${tab.tabId})`;
}

function browserTabProgressLabel(
  status: BrowserTabInfo["status"],
): string | null {
  if (status === "provisioning") return "starting";
  if (status === "navigating") return "navigating";
  return null;
}

/**
 * Shared open-a-new-browser-tile action behind both the panel header's "Add
 * browser" button and the empty-state's own button - the same tile-open path
 * the pane opener's "New browser" command uses.
 */
function useAddBrowserAction(epicId: string, tabId: string): () => void {
  const surfaceKey = useTabSurfaceKey("browsers", tabId);
  const hostId =
    useSurfaceHostPin(surfaceKey).resolvedHostId ?? UNKNOWN_HOST_PLACEHOLDER;
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
  const searchOpen = usePanelHeaderSearchOpen(props.tabId, BROWSERS_PANEL_ID);
  const setPanelSectionCollapsed = useEpicLeftPanelStore(
    (state) => state.setPanelSectionCollapsed,
  );
  const openSearch = usePanelHeaderSearchStore((state) => state.openSearch);
  const surfaceKey = useTabSurfaceKey("browsers", props.tabId);
  const hostPin = useSurfaceHostPin(surfaceKey);
  const filterOpen = usePanelHeaderMenuOpen(
    props.tabId,
    BROWSERS_PANEL_ID,
    "filter",
  );
  const setMenuOpen = usePanelHeaderMenuStore((state) => state.setMenuOpen);
  const [hostMenuOpen, setHostMenuOpen] = useState(false);
  const resolvedHost = useHostDirectoryEntryForHostId(hostPin.resolvedHostId);
  const addBrowser = useAddBrowserAction(props.epicId, props.tabId);
  const handleAdd = useCallback(() => {
    if (collapsed) setPanelSectionCollapsed("browsers", false);
    addBrowser();
  }, [addBrowser, collapsed, setPanelSectionCollapsed]);
  const handleSearch = useCallback(() => {
    if (collapsed) setPanelSectionCollapsed("browsers", false);
    openSearch(props.tabId, BROWSERS_PANEL_ID, "");
  }, [collapsed, openSearch, props.tabId, setPanelSectionCollapsed]);
  const handleFilterOpenChange = useCallback(
    (open: boolean) => {
      if (open && collapsed) setPanelSectionCollapsed("browsers", false);
      if (!open) setHostMenuOpen(false);
      setMenuOpen(props.tabId, BROWSERS_PANEL_ID, "filter", open);
    },
    [collapsed, props.tabId, setMenuOpen, setPanelSectionCollapsed],
  );
  const filterLabel = hostPin.isPinned
    ? "Filter browsers by host, 1 filter active"
    : "Filter browsers by host";
  const hostSummary =
    resolvedHost?.label ?? (hostPin.isPinned ? "Selected host" : "Active host");
  return (
    <>
      {searchOpen ? null : (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Search browsers"
          data-testid="epic-browsers-panel-search"
          className="text-muted-foreground hover:text-foreground"
          onClick={handleSearch}
        >
          <Search className="size-4" aria-hidden />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Add browser"
        data-testid="epic-browsers-panel-add"
        className="text-muted-foreground hover:text-foreground"
        onClick={handleAdd}
      >
        <Plus className="size-4" aria-hidden />
      </Button>
      <DropdownMenu open={filterOpen} onOpenChange={handleFilterOpenChange}>
        <TooltipWrapper
          label={filterLabel}
          side="top"
          sideOffset={undefined}
          align={undefined}
        >
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={filterLabel}
              data-testid="epic-browsers-panel-filter"
              className={cn(
                "relative text-muted-foreground transition-colors hover:text-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground",
                hostPin.isPinned && "bg-accent text-accent-foreground",
              )}
            >
              <ListFilter className="size-4" aria-hidden />
              {hostPin.isPinned ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-foreground text-[9px] leading-none font-semibold text-background ring-1 ring-background"
                >
                  1
                </span>
              ) : null}
            </Button>
          </DropdownMenuTrigger>
        </TooltipWrapper>
        <DropdownMenuContent
          side="right"
          align="start"
          sideOffset={8}
          avoidCollisions={false}
          className="w-[var(--radix-dropdown-menu-content-available-width)] min-w-0 max-w-64 overflow-y-auto"
          data-testid="epic-browsers-panel-filter-menu"
        >
          <DropdownMenuLabel className="mt-1 text-overline uppercase tracking-wide">
            Filters
          </DropdownMenuLabel>
          <DropdownMenuSub open={hostMenuOpen} onOpenChange={setHostMenuOpen}>
            <DropdownMenuSubTrigger
              aria-label={`Host, ${hostSummary}`}
              className="grid grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-1.5 [&>svg:last-child]:ml-0 [&>svg:last-child]:justify-self-end"
              onClick={() => setHostMenuOpen(true)}
            >
              <span className="min-w-0 truncate">Host</span>
              <span className="min-w-0 truncate text-right text-ui-xs text-muted-foreground group-data-open:text-accent-foreground">
                {hostSummary}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              sideOffset={8}
              alignOffset={-4}
              avoidCollisions={false}
              className="w-[min(90vw,20rem)]"
              data-testid="epic-browsers-panel-host-menu"
            >
              <BrowserHostFilterChoices surfaceKey={surfaceKey} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function BrowserHostFilterChoices(props: { readonly surfaceKey: string }) {
  const options = useHostOptions();
  const hostPin = useSurfaceHostPin(props.surfaceKey);
  const value = hostPin.selection ?? FOLLOW_ACTIVE_HOST_VALUE;
  const activeHostName =
    options.hosts.find((host) => host.hostId === options.activeHostId)?.name ??
    "Active host";
  return (
    <>
      <DropdownMenuLabel>Show browsers from</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value}>
        <DropdownMenuRadioItem
          value={FOLLOW_ACTIVE_HOST_VALUE}
          onSelect={(event) => {
            event.preventDefault();
            hostPin.setSelection(null);
          }}
        >
          <span className="min-w-0 flex-1 truncate">Follow active host</span>
          <DropdownMenuShortcut>{activeHostName}</DropdownMenuShortcut>
        </DropdownMenuRadioItem>
        {options.hosts.length > 0 ? <DropdownMenuSeparator /> : null}
        {options.hosts.map((host) => (
          <DropdownMenuRadioItem
            key={host.hostId}
            value={host.hostId}
            disabled={
              !isHostOptionSelectable(
                host,
                "pin",
                AVAILABLE_HOST_ROW_SURFACE_STATE,
              )
            }
            onSelect={(event) => {
              event.preventDefault();
              hostPin.setSelection(host.hostId);
            }}
          >
            <HostOptionRow
              host={host}
              picked={hostPin.selection === host.hostId}
              active={host.hostId === options.activeHostId}
              intent="pin"
              surfaceState={AVAILABLE_HOST_ROW_SURFACE_STATE}
            />
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      {options.isLoading ? (
        <DropdownMenuItem disabled>
          <AgentSpinningDots
            className="text-muted-foreground"
            testId={undefined}
            variant={undefined}
          />
          {options.hosts.length === 0
            ? "Loading hosts…"
            : "Loading more hosts…"}
        </DropdownMenuItem>
      ) : null}
      {!options.isLoading &&
      options.hosts.length === 0 &&
      !options.listsFailed ? (
        <DropdownMenuItem disabled>No hosts available</DropdownMenuItem>
      ) : null}
      {options.listsFailed && !options.isLoading ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              options.retryLists();
            }}
          >
            <RotateCcw className="size-4" aria-hidden />
            {options.hosts.length === 0
              ? "Try loading hosts again"
              : "Some hosts may be missing"}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

export function BrowsersPanelBody(props: LeftPanelSlotProps) {
  const currentSessions = useBrowserSessionsContext();
  const canvasHostId = useCanvasHostId();
  const surfaceKey = useTabSurfaceKey("browsers", props.tabId);
  const hostPin = useSurfaceHostPin(surfaceKey);
  const hostClient = useSurfaceHostClient(hostPin.resolvedHostId);
  const body = (
    <BrowsersPanelBodyFrame epicId={props.epicId} tabId={props.tabId} />
  );
  if (hostPin.resolvedHostId === canvasHostId) return body;
  return (
    <BrowserSessionsHostProvider
      hostId={hostPin.resolvedHostId}
      hostClient={hostClient}
      epicId={props.epicId}
      routingChatId={currentSessions.routingChatId}
    >
      {body}
    </BrowserSessionsHostProvider>
  );
}

function BrowsersPanelBodyFrame(props: LeftPanelSlotProps) {
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
  const searchQuery = usePanelHeaderSearchQuery(props.tabId, BROWSERS_PANEL_ID);
  const chats = useEpicChatRecords();
  const chatById = useMemo(
    () => new Map(chats.map((chat) => [chat.id, chat])),
    [chats],
  );
  const duplicateTitles = useMemo(() => {
    const counts = new Map<string, number>();
    sessions.items.forEach((session) => {
      session.tabs.forEach((tab) => {
        const title = resolveTabTitle(tab);
        counts.set(title, (counts.get(title) ?? 0) + 1);
      });
    });
    const duplicates = new Set<string>();
    counts.forEach((count, title) => {
      if (count > 1) duplicates.add(title);
    });
    return duplicates;
  }, [sessions.items]);
  const tabs = useMemo(
    () =>
      sessions.items.flatMap((session) =>
        session.tabs.map((tab) => ({ session, tab })),
      ),
    [sessions.items],
  );
  const filteredTabs = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (query.length === 0) return tabs;
    return tabs.filter(({ tab }) =>
      `${resolveTabTitle(tab)} ${browserTabHostname(tab.url) ?? ""} ${tab.url}`
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [searchQuery, tabs]);
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
      const binding = findElectronBrowserTabBindingOnHost(
        session.sessionId,
        tab.tabId,
        session.hostId,
      );
      const existingNative =
        binding === null
          ? null
          : findOpenTileInTab(props.tabId, {
              id: binding.registrationId,
              hostId: session.hostId,
            });
      const tile = makeBrowserSessionTileRef({
        name: tab.title ?? session.name,
        hostId: session.hostId,
        sessionId: session.sessionId,
        tabId: tab.tabId,
      });
      const existingPointer = findOpenTileInTab(props.tabId, tile);
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
    (driver: BrowserTabDriver, hostId: string) => {
      const chat = chatById.get(driver.chatId);
      if (chat === undefined) return;
      const chatTile = makeOpenableNodeRef({
        id: chat.id,
        instanceId: crypto.randomUUID(),
        type: "chat",
        name: chat.title,
        hostId,
      });
      const existing = findOpenTileInTab(props.tabId, chatTile);
      navigateNested(props.epicId, props.tabId, () =>
        existing === null
          ? prepareOpen(props.tabId, chatTile)
          : prepareFocus(props.tabId, existing.paneId, existing.instanceId),
      );
    },
    [
      chatById,
      navigateNested,
      prepareFocus,
      prepareOpen,
      props.epicId,
      props.tabId,
    ],
  );
  const isUnavailable =
    sessions.lifecycle === "failed" || sessions.lifecycle === "closed";
  const isLoading =
    (sessions.lifecycle === "connecting" ||
      sessions.lifecycle === "reconnecting") &&
    tabs.length === 0;
  const isEmpty = !isLoading && !isUnavailable && tabs.length === 0;
  const hasNoResults = tabs.length > 0 && filteredTabs.length === 0;
  const hasResults = filteredTabs.length > 0;

  return (
    <>
      <BrowserSearchHeaderInput
        tabId={props.tabId}
        resultCount={filteredTabs.length}
      />
      {isLoading ? <BrowsersPanelLoadingState /> : null}
      {isUnavailable ? (
        <BrowsersPanelUnavailableState
          message={sessions.errorMessage}
          onRetry={sessions.retry}
        />
      ) : null}
      {isEmpty ? <BrowsersPanelEmptyState onAddBrowser={addBrowser} /> : null}
      {hasNoResults ? <BrowsersPanelNoResultsState /> : null}
      {hasResults ? (
        <ul
          aria-label="Browser tabs"
          className="space-y-0.5"
          data-testid="epic-browsers-panel-list"
        >
          {filteredTabs.map(({ session, tab }) => (
            <BrowserTabRow
              key={`${session.sessionId}:${tab.tabId}`}
              epicId={props.epicId}
              viewTabId={props.tabId}
              session={session}
              tab={tab}
              chatById={chatById}
              duplicateTitles={duplicateTitles}
              onOpenTab={openTab}
              onOpenDrivingChat={openDrivingChat}
              onClose={sessions.closeSession}
            />
          ))}
        </ul>
      ) : null}
    </>
  );
}

function BrowserSearchHeaderInput(props: {
  readonly tabId: string;
  readonly resultCount: number;
}) {
  const query = usePanelHeaderSearchQuery(props.tabId, BROWSERS_PANEL_ID);
  const headerSlot = usePanelHeaderSearchSlot(props.tabId, BROWSERS_PANEL_ID);
  const setSearchQuery = usePanelHeaderSearchStore(
    (state) => state.setSearchQuery,
  );
  const closeSearch = usePanelHeaderSearchStore((state) => state.closeSearch);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (headerSlot !== null) inputRef.current?.focus();
  }, [headerSlot]);

  const exitSearch = useCallback(
    () => closeSearch(props.tabId, BROWSERS_PANEL_ID),
    [closeSearch, props.tabId],
  );
  const clearSearch = useCallback(() => {
    setSearchQuery(props.tabId, BROWSERS_PANEL_ID, "");
    inputRef.current?.focus();
  }, [props.tabId, setSearchQuery]);
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      exitSearch();
    },
    [exitSearch],
  );
  const input = (
    <InputGroup className="h-7 w-full">
      <InputGroupAddon align="inline-start">
        <Search className="size-3.5" aria-hidden />
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) =>
          setSearchQuery(props.tabId, BROWSERS_PANEL_ID, event.target.value)
        }
        onKeyDown={handleKeyDown}
        placeholder="Search browsers…"
        aria-label="Search browsers"
        autoComplete="off"
        spellCheck={false}
        className="text-ui-sm"
        data-testid="epic-browser-search-input"
      />
      <InputGroupAddon align="inline-end">
        {query.length === 0 ? null : (
          <InputGroupButton
            type="button"
            size="icon-xs"
            aria-label="Clear browser search"
            onClick={clearSearch}
          >
            <X className="size-3.5" aria-hidden />
          </InputGroupButton>
        )}
        <InputGroupButton
          type="button"
          size="icon-xs"
          aria-label="Close browser search"
          onClick={exitSearch}
        >
          <span aria-hidden className="text-overline uppercase">
            esc
          </span>
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
  const trimmed = query.trim();
  let status = "";
  if (trimmed.length > 0 && props.resultCount === 0) {
    status = "No browsers match your search.";
  } else if (trimmed.length > 0) {
    const noun = props.resultCount === 1 ? "result" : "results";
    status = `${props.resultCount} browser ${noun}.`;
  }
  return (
    <>
      {headerSlot === null ? null : createPortal(input, headerSlot)}
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
    </>
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

function BrowsersPanelNoResultsState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center text-muted-foreground">
      <Search className="size-6 text-muted-foreground/45" aria-hidden />
      <p className="text-ui-sm text-muted-foreground/60">
        No matching browsers.
      </p>
    </div>
  );
}

function BrowsersPanelUnavailableState(props: {
  readonly message: string | null;
  readonly onRetry: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center text-muted-foreground">
      <TriangleAlert className="size-7 text-destructive/70" aria-hidden />
      <div className="space-y-1">
        <p className="text-ui-sm text-foreground/75">Browsers unavailable.</p>
        {props.message === null ? null : (
          <p className="text-ui-xs text-muted-foreground">
            {props.message}
          </p>
        )}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={props.onRetry}>
        <RotateCcw className="size-3.5" aria-hidden />
        Retry
      </Button>
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={props.onAddBrowser}
      >
        <Plus className="size-3.5" aria-hidden />
        Add browser
      </Button>
    </div>
  );
}

interface BrowserTabRowProps {
  readonly epicId: string;
  readonly viewTabId: string;
  readonly session: BrowserSessionInfo;
  readonly tab: BrowserTabInfo;
  readonly chatById: ReadonlyMap<
    string,
    { readonly id: string; readonly title: string }
  >;
  readonly duplicateTitles: ReadonlySet<string>;
  readonly onOpenTab: (
    session: BrowserSessionInfo,
    tab: BrowserTabInfo,
  ) => void;
  readonly onOpenDrivingChat: (
    driver: BrowserTabDriver,
    hostId: string,
  ) => void;
  readonly onClose: (sessionId: string) => void;
}

function BrowserTabRow(props: BrowserTabRowProps) {
  const {
    epicId,
    viewTabId,
    session,
    tab,
    chatById,
    duplicateTitles,
    onOpenTab,
    onOpenDrivingChat,
    onClose,
  } = props;
  const title = resolveTabTitle(tab);
  const host = browserTabHostname(tab.url);
  const isDormant = tab.status === "dormant";
  const isFailed = tab.status === "crashed";
  const progressLabel = browserTabProgressLabel(tab.status);
  const closeAriaLabel = resolveCloseAriaLabel(
    tab,
    title,
    duplicateTitles.has(title),
  );
  const tile = useMemo(
    () =>
      makeBrowserSessionTileRef({
        name: tab.title ?? session.name,
        hostId: session.hostId,
        sessionId: session.sessionId,
        tabId: tab.tabId,
      }),
    [session.hostId, session.name, session.sessionId, tab.tabId, tab.title],
  );
  const binding = findElectronBrowserTabBindingOnHost(
    session.sessionId,
    tab.tabId,
    session.hostId,
  );
  const nativeRegistrationId = binding?.registrationId ?? null;
  const nativeTile = useEpicCanvasStore((state) => {
    if (nativeRegistrationId === null) return null;
    const canvas = state.canvasByTabId[viewTabId];
    if (canvas === undefined) return null;
    for (const candidate of Object.values(canvas.tilesByInstanceId)) {
      if (
        candidate?.id === nativeRegistrationId &&
        candidate.type === "agent-browser" &&
        candidate.hostId === session.hostId
      ) {
        return candidate;
      }
    }
    return null;
  });
  const isActive = useEpicCanvasStore((state) => {
    const canvas = state.canvasByTabId[viewTabId];
    if (canvas === undefined || canvas.activePaneId === null) return false;
    const activeInstanceId = findPaneById(canvas.root, canvas.activePaneId)?.activeTabId ?? null;
    if (activeInstanceId === null) return false;
    const active = canvas.tilesByInstanceId[activeInstanceId];
    if (active?.hostId !== session.hostId) return false;
    return active.id === tile.id || active.id === nativeRegistrationId;
  });
  const dragTile = nativeTile ?? tile;
  const dragData = useMemo<EpicCanvasBrowserTileDragData>(
    () => ({
      kind: BROWSER_TILE_DND_TYPE,
      epicId,
      viewTabId,
      tile: dragTile,
    }),
    [dragTile, epicId, viewTabId],
  );
  const {
    attributes,
    listeners,
    setNodeRef: dragRef,
    isDragging,
  } = useDraggable({
    id: getPaneScopedDndId(
      viewTabId,
      getBrowserTileDragId(session.sessionId, tab.tabId),
    ),
    data: dragData,
  });

  return (
    <li>
      <div
        data-active={isActive}
        data-testid={`epic-browser-sidebar-row-${tab.tabId}`}
        className={cn(
          "group/browser-row relative flex h-8 min-w-0 cursor-pointer items-center rounded-md transition-colors",
          isActive
            ? "bg-accent font-medium text-accent-foreground"
            : "text-foreground/75 hover:bg-accent/70 hover:text-accent-foreground",
          isDormant && "opacity-60",
          isFailed && "text-destructive",
          isDragging && "cursor-grabbing opacity-60",
        )}
      >
        <TooltipWrapper
          label={tab.url}
          side="top"
          sideOffset={undefined}
          align={undefined}
        >
          <button
            ref={dragRef}
            {...attributes}
            {...listeners}
            type="button"
            aria-label={`${title}, ${tab.url}`}
            className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 pr-1 text-left text-ui-sm outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            onClick={() => onOpenTab(session, tab)}
          >
            <BrowserFavicon tab={tab} />
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden whitespace-nowrap">
              <span className="min-w-0 flex-1 truncate">{title}</span>
              {host === null ? null : (
                <span className="max-w-[45%] shrink truncate text-ui-xs font-normal text-muted-foreground">
                  {host}
                </span>
              )}
            </span>
          </button>
        </TooltipWrapper>
        <div className="flex shrink-0 items-center gap-0.5">
          {session.profile === "isolated" ? (
            <span className="shrink-0 rounded-sm border border-amber-500/30 bg-amber-500/10 px-1 py-0.5 text-[0.625rem] leading-none text-amber-700 dark:text-amber-300">
              isolated
            </span>
          ) : null}
          {tab.drivenBy.map((driver) => {
            const chatTitle =
              chatById.get(driver.chatId)?.title ?? driver.chatId;
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
                  className="flex h-6 max-w-24 items-center gap-1 rounded-sm px-1 text-ui-xs font-normal text-blue-500 outline-none hover:bg-blue-500/10 focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onOpenDrivingChat(driver, session.hostId)}
                >
                  <Bot className="size-3" aria-hidden />
                  <span className="truncate">{chatTitle}</span>
                </button>
              </TooltipWrapper>
            );
          })}
          {tab.status === "dormant" ? (
            <span className="flex h-6 items-center gap-1 px-1 text-ui-xs font-normal text-muted-foreground">
              <Moon className="size-3" aria-hidden />
              asleep
            </span>
          ) : null}
          {tab.status === "crashed" ? (
            <span className="flex h-6 items-center gap-1 px-1 text-ui-xs font-normal text-destructive">
              <TriangleAlert className="size-3" aria-hidden />
              failed
            </span>
          ) : null}
          {progressLabel === null ? null : (
            <span className="flex h-6 items-center gap-1 px-1 text-ui-xs font-normal text-muted-foreground">
              <AgentSpinningDots
                className="shrink-0"
                testId={undefined}
                variant={undefined}
              />
              {progressLabel}
            </span>
          )}
          {tab.status === "closing" ? (
            <span className="px-1 text-ui-xs font-normal text-muted-foreground">
              closing
            </span>
          ) : null}
          {session.tabs.length === 1 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground opacity-0 transition-opacity group-focus-within/browser-row:opacity-100 group-hover/browser-row:opacity-100 group-data-[active=true]/browser-row:opacity-100"
              aria-label={closeAriaLabel}
              data-testid={`epic-browser-sidebar-close-${tab.tabId}`}
              onClick={() => onClose(session.sessionId)}
            >
              <X className="size-3.5" aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>
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
      className="size-3.5 shrink-0 rounded-sm ring-1 ring-black/10 dark:ring-white/10"
      onError={(event) => {
        event.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}
