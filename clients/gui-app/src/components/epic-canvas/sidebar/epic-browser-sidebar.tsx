import { Bot, Globe2, X } from "lucide-react";
import { useMemo } from "react";
import type {
  BrowserSessionInfo,
  BrowserTabDriver,
  BrowserTabInfo,
} from "@traycer/protocol/host/browser/contracts";
import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { useBrowserSessionsContext } from "@/components/epic-canvas/renderers/browser-sessions-context";
import { useEpicNestedFocusNavigation } from "@/hooks/epic/use-epic-nested-focus-navigation";
import { useReactiveActiveHostId } from "@/hooks/host/use-reactive-active-host-id";
import { findElectronBrowserTabBinding } from "@/lib/browser-view/electron-browser-tab-store";
import { UNKNOWN_HOST_PLACEHOLDER } from "@/lib/host/constants";
import { cn } from "@/lib/utils";
import { useEpicChatRecords } from "@/lib/epic-selectors";
import { makeBrowserSessionTileRef } from "@/stores/epics/canvas/tile-schema/browser-tile";
import {
  findOpenArtifactInTab,
  useEpicCanvasStore,
} from "@/stores/epics/canvas/store";
import { makeOpenableNodeRef } from "@/stores/epics/canvas/types";

export function EpicBrowserSidebar(props: {
  readonly epicId: string;
  readonly tabId: string;
}) {
  const sessions = useBrowserSessionsContext();
  const chats = useEpicChatRecords();
  const chatById = useMemo(
    () => new Map(chats.map((chat) => [chat.id, chat])),
    [chats],
  );
  const hostId = useReactiveActiveHostId() ?? UNKNOWN_HOST_PLACEHOLDER;
  const navigateNested = useEpicNestedFocusNavigation();
  const prepareOpen = useEpicCanvasStore(
    (state) => state.prepareOpenTileInTabFocusTarget,
  );
  const prepareFocus = useEpicCanvasStore(
    (state) => state.prepareSetActiveTileTabFocusTarget,
  );

  const openBrowserTab = (session: BrowserSessionInfo, tab: BrowserTabInfo) => {
    const binding = findElectronBrowserTabBinding(session.sessionId, tab.tabId);
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
  };

  const openDrivingChat = (driver: BrowserTabDriver) => {
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
  };

  return (
    <section className="shrink-0 border-b border-border/70 px-2 py-2">
      <div className="mb-1 flex items-center justify-between px-1 text-ui-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>Browsers</span>
        <span className="tabular-nums">{sessions.items.length}</span>
      </div>
      <div className="space-y-2">
        {sessions.items.map((session) => (
          <div key={session.sessionId} className="min-w-0">
            <div className="flex min-w-0 items-center gap-2 px-1 py-0.5 text-ui-xs text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">{session.name}</span>
              <span
                className={cn(
                  "shrink-0 rounded-sm border px-1 py-0.5 text-[0.625rem] leading-none",
                  session.profile === "primary"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                )}
              >
                {session.profile}
              </span>
            </div>
            <div className="space-y-0.5">
              {session.tabs.map((tab) => (
                <div
                  key={tab.tabId}
                  className={cn(
                    "group flex min-w-0 items-center gap-1 rounded-md hover:bg-sidebar-accent",
                    tab.status === "dormant" && "opacity-60",
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left text-ui-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => openBrowserTab(session, tab)}
                  >
                    <BrowserFavicon tab={tab} />
                    <span className="min-w-0 flex-1 truncate">
                      {tab.title ?? browserTabLabel(tab.url)}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5">
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
                            className="flex size-5 items-center justify-center rounded-sm text-blue-500 outline-none hover:bg-blue-500/10 focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => openDrivingChat(driver)}
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
                      aria-label={`Close browser session ${session.name}`}
                      onClick={() => sessions.closeSession(session.sessionId)}
                    >
                      <X className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BrowserFavicon(props: { readonly tab: BrowserTabInfo }) {
  const favicon = faviconUrl(props.tab.url);
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

function faviconUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    return new URL("/favicon.ico", parsed.origin).toString();
  } catch {
    return null;
  }
}

function browserTabLabel(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}
