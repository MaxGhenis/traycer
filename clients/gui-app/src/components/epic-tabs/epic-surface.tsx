import { useMatch } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { EpicRouteSessionBody } from "@/components/epic-canvas/epic-route-session-body";
import { EpicSidebarColumn } from "@/components/epic-canvas/sidebar/epic-sidebar-column";
import {
  PaneSurfaceActivityContext,
  PaneVisibilityContext,
} from "@/components/epic-tabs/pane-visibility-context";
import { EpicViewTabContext } from "@/components/epic-canvas/view-tab-context";
import { useTabSurfaceActivity } from "@/components/layout/tab-surface-activity-hooks";
import { EpicSessionProvider } from "@/providers/epic-session-provider";
import { AgentBrowserPip } from "@/components/epic-canvas/pip/agent-browser-pip";
import { PipEpicSessionsFeed } from "@/lib/browser-view/use-pip-epic-sessions";
import { BrowserSessionsProvider } from "@/components/epic-canvas/renderers/browser-session-dock";
import {
  BrowserSessionsContext,
  type BrowserSessionsState,
} from "@/components/epic-canvas/renderers/browser-sessions-context";
import { useEpicChatRecords } from "@/lib/epic-selectors";
import { useMaybeOpenEpicHandle } from "@/providers/use-open-epic-handle";

export interface EpicSurfaceProps {
  readonly epicId: string;
  readonly tabId: string;
}

/** One independently retained Epic pane: sidebar and canvas share its session. */
export function EpicSurface(props: EpicSurfaceProps) {
  const activity = useTabSurfaceActivity();
  const activeRoute = useMatch({
    from: "/epics/$epicId/$tabId",
    shouldThrow: false,
    select: (match) => ({
      epicId: match.params.epicId,
      tabId: match.params.tabId,
      search: match.search,
    }),
    structuralSharing: true,
  });
  const route = activeRoute ?? null;
  const activeSearch =
    route !== null &&
    route.epicId === props.epicId &&
    route.tabId === props.tabId
      ? route.search
      : null;
  const routeMatches = activeSearch !== null;
  return (
    <PaneSurfaceActivityContext.Provider value={activity}>
      <PaneVisibilityContext.Provider value={activity.visible}>
        <EpicSessionProvider epicId={props.epicId} tabId={props.tabId}>
          <EpicBrowserSessionsScope epicId={props.epicId}>
            <EpicViewTabContext.Provider value={props.tabId}>
              <div
                className="flex min-h-0 min-w-0 flex-1 flex-row"
                data-epic-surface={props.tabId}
              >
                <EpicSidebarColumn epicId={props.epicId} tabId={props.tabId} />
                <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                  <EpicRouteSessionBody
                    epicId={props.epicId}
                    tabId={props.tabId}
                    active={Boolean(activity.focused && routeMatches)}
                    focusedAt={activeSearch?.focusedAt}
                    focusArtifactId={activeSearch?.focusArtifactId}
                    focusThreadId={activeSearch?.focusThreadId}
                    focusPaneId={activeSearch?.focusPaneId}
                    focusTileInstanceId={activeSearch?.focusTileInstanceId}
                  />
                  <AgentBrowserPip
                    epicId={props.epicId}
                    viewTabId={props.tabId}
                    surfaceVisible={activity.visible}
                  />
                </div>
              </div>
            </EpicViewTabContext.Provider>
          </EpicBrowserSessionsScope>
        </EpicSessionProvider>
      </PaneVisibilityContext.Provider>
    </PaneSurfaceActivityContext.Provider>
  );
}

const COLD_BROWSER_SESSIONS: BrowserSessionsState = {
  lifecycle: "connecting",
  items: [],
  errorMessage: null,
  routingChatId: null,
  closeSession: () => undefined,
  requestPromoteState: () =>
    Promise.reject(new Error("Browser sessions are not ready.")),
  requestLendStorage: () =>
    Promise.reject(new Error("Browser sessions are not ready.")),
};

function EpicBrowserSessionsScope(props: {
  readonly epicId: string;
  readonly children: ReactNode;
}) {
  const epicHandle = useMaybeOpenEpicHandle();
  if (epicHandle === null) {
    return (
      <BrowserSessionsContext.Provider value={COLD_BROWSER_SESSIONS}>
        {props.children}
      </BrowserSessionsContext.Provider>
    );
  }
  return <ReadyEpicBrowserSessionsScope {...props} />;
}

function ReadyEpicBrowserSessionsScope(props: {
  readonly epicId: string;
  readonly children: ReactNode;
}) {
  const chats = useEpicChatRecords();
  // The stream's chat id is transport routing metadata, not authorization.
  // Lexicographic selection makes reconnects deterministic; if the chosen chat
  // disappears, the next render reopens the one epic stream and Electron tabs
  // re-register against the replacement route.
  const routingChatId =
    chats
      .map((chat) => chat.id)
      .toSorted((left, right) => left.localeCompare(right))[0] ?? null;
  // Residual seam: a zero-chat epic cannot open browser.sessions because its
  // current request schema requires chatId. The future fix is a nullable open
  // chatId plus subscriber-id-based delivery for every routed response.
  return (
    <BrowserSessionsProvider
      epicId={props.epicId}
      routingChatId={routingChatId}
    >
      <PipEpicSessionsFeed epicId={props.epicId} />
      {props.children}
    </BrowserSessionsProvider>
  );
}
