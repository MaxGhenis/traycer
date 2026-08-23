import type { BrowserSessionInfo } from "@traycer/protocol/host/browser/contracts";
import { Analytics, AnalyticsEvent } from "@/lib/analytics";
import { collectPanes, findPaneById } from "@/stores/epics/canvas/tile-tree";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";
import {
  isAgentBrowserTileRef,
  isBrowserSessionTileRef,
  type AgentBrowserTileRef,
  type EpicCanvasState,
  type EpicCanvasTileRef,
} from "@/stores/epics/canvas/types";
import {
  DEFAULT_AGENT_BROWSER_VIEWPORT_PRESET,
  makeAgentBrowserTileRef,
} from "@/stores/epics/canvas/tile-schema/agent-browser-tile";
import { makeBrowserSessionTileRef } from "@/stores/epics/canvas/tile-schema/browser-tile";
import { browserTileNameForUrl } from "./browser-link-routing-core";
import { convertBrowserTabToPip, getPipSnapshot } from "./pip-store";
import {
  useSettingsStore,
  type AgentTabSurfacingMode,
} from "@/stores/settings/settings-store";

/**
 * What the GUI does when the agent opens a browser tab (REPL `openTab`).
 * The host pushes either a foreground `createElectronTab` frame (electron
 * runtime, routed to the window that owns the source tab's route) or — for
 * headless-runtime sessions — nothing but `sessionUpdated` broadcasts; this
 * module is the single disposition authority for both shapes.
 */
type AgentTabSurfacableAction = "float" | "tile" | "suppress";

type AgentTabSuppressReason =
  | "mode-off"
  | "manual-pip-active"
  | "pip-epic-hidden";

export interface AgentTabDisposition {
  readonly action: AgentTabSurfacableAction;
  readonly suppressReason: AgentTabSuppressReason | null;
}

/**
 * Pure decision table. Contract:
 * - `off` always suppresses visual surfacing; the caller still has to keep
 *   the agent's open working (hidden view + ack) on electron foreground
 *   creates.
 * - `pip` floats the tab unless the user converted a PiP manually (never
 *   stomp explicit user intent) or the epic surface is hidden (a floating
 *   overlay nobody can see arms nothing); both fall back to suppression.
 *   An existing AGENT-origin PiP is replaced latest-wins.
 * - `tile` always places a canvas tile, even in a hidden epic: layout
 *   mutations are fine where an overlay would be invisible.
 */
export function decideAgentTabDisposition(input: {
  readonly mode: AgentTabSurfacingMode;
  readonly epicVisible: boolean;
  readonly manualPipActive: boolean;
}): AgentTabDisposition {
  if (input.mode === "off") {
    return { action: "suppress", suppressReason: "mode-off" };
  }
  if (input.mode === "tile") return { action: "tile", suppressReason: null };
  if (input.manualPipActive) {
    return { action: "suppress", suppressReason: "manual-pip-active" };
  }
  if (!input.epicVisible) {
    return { action: "suppress", suppressReason: "pip-epic-hidden" };
  }
  return { action: "float", suppressReason: null };
}

/**
 * Per-window registry of which epic surfaces are currently visible. Epic
 * surfaces stay mounted (retained) while their route is inactive, so mount
 * state alone cannot answer visibility; `EpicSurface` reports its
 * `activity.visible` here instead.
 */
const visibleEpicSurfaces = new Set<string>();

export function setEpicSurfaceVisibility(
  epicId: string,
  visible: boolean,
): void {
  if (visible) visibleEpicSurfaces.add(epicId);
  else visibleEpicSurfaces.delete(epicId);
}

export function isEpicSurfaceVisible(epicId: string): boolean {
  return visibleEpicSurfaces.has(epicId);
}

/** A manual (user-initiated) conversion must never be stomped by the agent. */
export function isManualPipActive(epicId: string): boolean {
  const snapshot = getPipSnapshot(epicId);
  return (
    snapshot.target?.origin === "manual" ||
    snapshot.pendingTarget?.origin === "manual"
  );
}

export function trackAgentTabSurfaced(
  disposition: AgentTabDisposition,
  origin: "electron-create" | "headless-session",
): void {
  Analytics.getInstance().track(AnalyticsEvent.AgentTabSurfaced, {
    disposition: disposition.action,
    disposition_reason: disposition.suppressReason,
    origin,
  });
}

/**
 * Programmatic PiP entry for agent-opened tabs. Silent on failure by design:
 * a failed auto-PiP leaves the tab reachable via the sidebar instead of
 * toasting about background automation.
 */
export function openAgentTabInPip(input: {
  readonly epicId: string;
  readonly hostId: string;
  readonly sessionId: string;
  readonly tabId: string;
}): void {
  convertBrowserTabToPip({
    ...input,
    origin: "agent",
    onReady: () => {},
    onError: () => {},
  });
}

// ---------------------------------------------------------------------------
// Canvas placement
// ---------------------------------------------------------------------------

/**
 * The pane that already hosts a canvas tile of `sessionId`, if any. Used for
 * smart grouping: consecutive agent opens of one session become tabs of that
 * session's pane instead of spawning a fresh split per open.
 */
export function findPaneIdHostingSessionTile(
  canvas: EpicCanvasState,
  sessionId: string,
): string | null {
  if (canvas.root === null) return null;
  const paneIdByInstanceId = new Map<string, string>();
  for (const pane of collectPanes(canvas.root)) {
    for (const instanceId of pane.tabInstanceIds) {
      paneIdByInstanceId.set(instanceId, pane.id);
    }
  }
  for (const tile of Object.values(canvas.tilesByInstanceId)) {
    if (tile === undefined) continue;
    const matchesSession =
      (isAgentBrowserTileRef(tile) && tile.sessionId === sessionId) ||
      (isBrowserSessionTileRef(tile) && tile.sessionId === sessionId);
    if (!matchesSession) continue;
    const paneId = paneIdByInstanceId.get(tile.instanceId);
    if (paneId !== undefined) return paneId;
  }
  return null;
}

function firstViewTabIdForEpic(epicId: string): string | null {
  for (const [tabId, tab] of Object.entries(
    useEpicCanvasStore.getState().tabsById,
  )) {
    if (tab !== undefined && tab.epicId === epicId) return tabId;
  }
  return null;
}

/**
 * Shared split-mode canvas placement: when a pane already hosts a tile of
 * `sessionId`, the new tile becomes a focused tab there (smart grouping);
 * otherwise it splits in right of `anchorPaneId` — or of the active pane
 * when the caller has no source anchor (headless opens). Returns false only
 * when no anchor resolves.
 */
function placeTileGroupedBySession(args: {
  readonly viewTabId: string;
  readonly canvas: EpicCanvasState;
  readonly tile: EpicCanvasTileRef;
  readonly sessionId: string;
  readonly anchorPaneId: string | null;
}): boolean {
  const store = useEpicCanvasStore.getState();
  const groupedPaneId = findPaneIdHostingSessionTile(
    args.canvas,
    args.sessionId,
  );
  if (groupedPaneId !== null) {
    store.openTileInPane(args.viewTabId, groupedPaneId, args.tile);
    return true;
  }
  let anchorPaneId = args.anchorPaneId;
  if (anchorPaneId === null) {
    anchorPaneId =
      args.canvas.activePaneId ?? collectPanes(args.canvas.root)[0]?.id ?? null;
  }
  if (
    anchorPaneId === null ||
    findPaneById(args.canvas.root, anchorPaneId) === null
  ) {
    return false;
  }
  store.splitPaneWithNode(args.viewTabId, anchorPaneId, "right", args.tile);
  // Depth cap exceeded or lost race: fill into the anchor pane instead of
  // dropping the tab entirely.
  const nextCanvas =
    useEpicCanvasStore.getState().canvasByTabId[args.viewTabId];
  if (nextCanvas?.tilesByInstanceId[args.tile.instanceId] === undefined) {
    store.openTileInPane(args.viewTabId, anchorPaneId, args.tile);
  }
  return true;
}

/**
 * Split-mode placement for an AGENT-opened electron tab. Groups by session:
 * a pane already hosting that session's tile receives the new tab (focused),
 * otherwise the tile splits in to the right of the anchor pane — the pane
 * that hosts the source tab the agent derived from. Returns the placed tile
 * ref so the caller can bind pending-create request keys to its `id`.
 */
export function placeAgentElectronTile(request: {
  readonly viewTabId: string;
  readonly anchorPaneId: string;
  readonly hostId: string;
  readonly sessionId: string;
  readonly url: string;
  readonly runtime: "primary" | "isolated";
}): AgentBrowserTileRef | null {
  const store = useEpicCanvasStore.getState();
  const canvas = store.canvasByTabId[request.viewTabId];
  if (canvas === undefined || canvas.root === null) return null;
  const tile = makeAgentBrowserTileRef({
    name: browserTileNameForUrl(request.url),
    hostId: request.hostId,
    url: request.url,
    sessionId: request.sessionId,
    viewportPreset: DEFAULT_AGENT_BROWSER_VIEWPORT_PRESET,
    runtime: request.runtime,
  });
  return placeTileGroupedBySession({
    viewTabId: request.viewTabId,
    canvas,
    tile,
    sessionId: request.sessionId,
    anchorPaneId: request.anchorPaneId,
  })
    ? tile
    : null;
}

/**
 * Split-mode placement for a headless-origin agent tab: a read-only
 * screencast tile (`browser-session`), grouped by session like the electron
 * path; headless tabs have no source tile to anchor to, so an inaugural open
 * splits right of the canvas's active pane.
 */
export function placeHeadlessAgentSessionTile(input: {
  readonly epicId: string;
  readonly hostId: string;
  readonly sessionId: string;
  readonly tabId: string;
  readonly url: string;
}): boolean {
  const viewTabId = firstViewTabIdForEpic(input.epicId);
  if (viewTabId === null) return false;
  const store = useEpicCanvasStore.getState();
  const canvas = store.canvasByTabId[viewTabId];
  if (canvas === undefined || canvas.root === null) return false;
  return placeTileGroupedBySession({
    viewTabId,
    canvas,
    tile: makeBrowserSessionTileRef({
      name: browserTileNameForUrl(input.url),
      hostId: input.hostId,
      sessionId: input.sessionId,
      tabId: input.tabId,
    }),
    sessionId: input.sessionId,
    anchorPaneId: null,
  });
}

// ---------------------------------------------------------------------------
// Headless-origin watcher
// ---------------------------------------------------------------------------

/**
 * Tabs already seen per session, so only genuinely NEW tabs are surfaced.
 * Seeded from every frame kind (including `snapshot`) WITHOUT acting, which
 * keeps surfacing ephemeral across renderer reloads: the reload's first full
 * listing re-seeds the map instead of resurrecting old tabs.
 */
const seenTabIdsBySession = new Map<string, Set<string>>();

/**
 * Feed every `browser.sessions` lifecycle frame through here. Returns the
 * newly appeared agent-created tabs (empty for snapshots/seeds), so callers
 * can apply the current surfacing mode to each.
 */
export function collectNewAgentTabsFromSessionFrame(
  session: BrowserSessionInfo,
): Array<{ readonly tabId: string; readonly url: string }> {
  const seen = seenTabIdsBySession.get(session.sessionId);
  if (seen === undefined) {
    seenTabIdsBySession.set(
      session.sessionId,
      new Set(session.tabs.map((tab) => tab.tabId)),
    );
    return [];
  }
  const agentSession = isAgentCreatedSession(session);
  const fresh: Array<{ readonly tabId: string; readonly url: string }> = [];
  for (const tab of session.tabs) {
    if (seen.has(tab.tabId)) continue;
    seen.add(tab.tabId);
    if (!agentSession) continue;
    fresh.push({ tabId: tab.tabId, url: tab.url });
  }
  return fresh;
}

export function forgetSeenAgentTabsForSession(sessionId: string): void {
  seenTabIdsBySession.delete(sessionId);
}

/**
 * Attribution on the wire: REPL-created sessions carry
 * `createdBy.agentRunId`; a tab opened INTO another session only accrues
 * `drivenBy` after the agent acts, so at creation time the session-level
 * signal is all there is (foreground electron creates don't need it — that
 * frame only originates from the agent).
 */
function isAgentCreatedSession(session: BrowserSessionInfo): boolean {
  return (
    session.createdBy.agentRunId !== null ||
    session.tabs.some((tab) => tab.drivenBy.length > 0)
  );
}

/**
 * Full pipeline for headless-origin tabs arriving via lifecycle frames:
 * diff → attribute → dispose per current settings. Electron foreground
 * creates bypass this (targeted frame delivery through the tab store).
 */
export function surfaceAgentTabsFromSessionFrame(
  session: BrowserSessionInfo,
): void {
  const fresh = collectNewAgentTabsFromSessionFrame(session);
  if (fresh.length === 0) return;
  const disposition = decideAgentTabDisposition({
    mode: useSettingsStore.getState().agentTabSurfacingMode,
    epicVisible: isEpicSurfaceVisible(session.epicId),
    manualPipActive: isManualPipActive(session.epicId),
  });
  for (const tab of fresh) {
    trackAgentTabSurfaced(disposition, "headless-session");
    if (disposition.action === "suppress") continue;
    if (disposition.action === "tile") {
      placeHeadlessAgentSessionTile({
        epicId: session.epicId,
        hostId: session.hostId,
        sessionId: session.sessionId,
        tabId: tab.tabId,
        url: tab.url,
      });
      continue;
    }
    openAgentTabInPip({
      epicId: session.epicId,
      hostId: session.hostId,
      sessionId: session.sessionId,
      tabId: tab.tabId,
    });
  }
}

/** Test hook: clear the seen-tab seeds between suites. */
export function resetAgentTabSurfacingForTests(): void {
  seenTabIdsBySession.clear();
}
