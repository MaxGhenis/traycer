import type {
  BrowserSessionsClientFrame,
  BrowserSessionsServerFrame,
} from "@traycer/protocol/host/browser/contracts";
import {
  buildCdpResultFrame,
  registerAgentBrowserCdpHandler,
} from "./agent-browser-cdp-store";
import { openFreshAgentBrowserTileFromBrowserPage } from "./browser-link-routing-core";
import type {
  AgentBrowserViewCdpDispatch,
  AgentBrowserViewCdpResult,
  AgentBrowserViewCdpSessionEndedChange,
  AgentBrowserViewCdpTargetAttachedChange,
  AgentBrowserViewTileHandoffChange,
} from "./desktop-agent-browser-view";
import type {
  BrowserViewDurableTabRegistration,
  BrowserViewStatusChange,
  BrowserViewTileKey,
} from "./desktop-browser-view";

interface ElectronBrowserTabBridge {
  registerDurableTab(input: BrowserViewDurableTabRegistration): Promise<void>;
  dispatchCdp(
    input: AgentBrowserViewCdpDispatch,
  ): Promise<AgentBrowserViewCdpResult>;
  onStatusChange(handler: (change: BrowserViewStatusChange) => void): {
    dispose: () => void;
  };
  onCdpSessionEnded(
    handler: (change: AgentBrowserViewCdpSessionEndedChange) => void,
  ): { dispose: () => void };
  onCdpTargetAttached(
    handler: (change: AgentBrowserViewCdpTargetAttachedChange) => void,
  ): { dispose: () => void };
  onTileHandoff(handler: (change: AgentBrowserViewTileHandoffChange) => void): {
    dispose: () => void;
  };
}

export interface ElectronBrowserTabRegistration {
  readonly epicId: string;
  readonly hostId: string;
  readonly chatId: string | null;
  readonly registrationId: string;
  readonly sessionId: string;
  readonly requestedTabId?: string | null;
  readonly initialUrl: string;
  readonly title: string | null;
  readonly tileKey: BrowserViewTileKey;
  readonly bridge: ElectronBrowserTabBridge;
  readonly onRegistered: ((tabId: string) => void) | null;
  readonly onActivatedHeadless?: ((tabId: string) => void) | null;
}

interface ElectronBrowserTabRecord extends ElectronBrowserTabRegistration {
  tabId: string | null;
  lastState: BrowserViewStatusChange | null;
  visible: boolean;
  focused: boolean;
  focusOrder: number;
}

type SendFrame = (frame: BrowserSessionsClientFrame) => void;

const recordsByRegistrationKey = new Map<string, ElectronBrowserTabRecord>();
const sendFrameByEpicHost = new Map<string, SendFrame>();
const createRequestIdByRegistrationKey = new Map<string, string>();
let focusOrder = 0;

export function registerElectronBrowserTab(
  input: ElectronBrowserTabRegistration,
): void {
  const key = registrationKey(input.sessionId, input.registrationId);
  const existing = recordsByRegistrationKey.get(key);
  if (existing !== undefined) {
    const tileInstanceChanged =
      existing.tileKey.tileInstanceId !== input.tileKey.tileInstanceId;
    Object.assign(existing, input);
    if (tileInstanceChanged) installCdpForwarder(existing);
    if (existing.tabId !== null) existing.onRegistered?.(existing.tabId);
    publishRegistration(existing);
    return;
  }

  const record: ElectronBrowserTabRecord = {
    ...input,
    tabId: null,
    lastState: null,
    visible: false,
    focused: false,
    focusOrder: 0,
  };
  recordsByRegistrationKey.set(key, record);
  installDesktopForwarding(record);
  publishRegistration(record);
}

export function updateElectronBrowserTabView(input: {
  readonly sessionId: string;
  readonly registrationId: string;
  readonly visible: boolean;
  readonly focused: boolean;
}): void {
  const record = recordsByRegistrationKey.get(
    registrationKey(input.sessionId, input.registrationId),
  );
  if (record === undefined) return;
  const records = recordsForEpicHost(record.epicId, record.hostId);
  const previousViewed = mostRecentlyFocusedVisibleRecord(records);
  const focused = input.visible && input.focused;
  if (focused && !record.focused) {
    focusOrder += 1;
    record.focusOrder = focusOrder;
  } else if (
    input.visible &&
    previousViewed === null &&
    record.focusOrder === 0
  ) {
    focusOrder += 1;
    record.focusOrder = focusOrder;
  }
  record.visible = input.visible;
  record.focused = focused;
  const nextViewed = mostRecentlyFocusedVisibleRecord(records);
  if (previousViewed === nextViewed) return;
  if (previousViewed !== null) publishState(previousViewed);
  if (nextViewed !== null) publishState(nextViewed);
}

/**
 * One sender belongs to each mounted epic stream. Records route by epic rather
 * than their optional sibling chat, so artifact-only canvases still register
 * while simultaneous epics cannot ingest each other's durable tabs.
 */
export function attachElectronBrowserTabStream(
  epicId: string,
  hostId: string,
  sendFrame: SendFrame,
): () => void {
  const key = epicHostKey(epicId, hostId);
  sendFrameByEpicHost.set(key, sendFrame);
  replayElectronBrowserTabRegistrations(epicId, hostId);
  return () => {
    if (sendFrameByEpicHost.get(key) === sendFrame) {
      sendFrameByEpicHost.delete(key);
    }
  };
}

export function replayElectronBrowserTabRegistrations(
  epicId: string,
  hostId: string,
): void {
  for (const record of recordsByRegistrationKey.values()) {
    if (record.epicId === epicId && record.hostId === hostId) {
      publishRegistration(record);
    }
  }
}

export function handleElectronBrowserTabFrame(
  frame: BrowserSessionsServerFrame,
): boolean {
  if (frame.kind === "createElectronTab") {
    const source = findElectronBrowserTabBinding(
      frame.sessionId,
      frame.sourceTabId,
    );
    if (source === null) return false;
    const tile = openFreshAgentBrowserTileFromBrowserPage({
      viewTabId: source.tileKey.viewTabId,
      paneId: source.tileKey.paneId,
      hostId: source.hostId,
      sessionId: frame.sessionId,
      url: frame.url,
    });
    if (tile === null) {
      sendForRecord(source, {
        kind: "electronTabCreated",
        hasBinaryPayload: false,
        requestId: frame.requestId,
        sessionId: frame.sessionId,
        tabId: null,
        reason: "The source browser tile is no longer available.",
      });
      return true;
    }
    createRequestIdByRegistrationKey.set(
      registrationKey(frame.sessionId, tile.id),
      frame.requestId,
    );
    return true;
  }
  if (frame.kind === "electronTabRegistrationFailed") {
    const record = recordsByRegistrationKey.get(
      registrationKey(frame.sessionId, frame.registrationId),
    );
    record?.onActivatedHeadless?.(frame.tabId);
    return true;
  }
  if (frame.kind !== "electronTabRegistered") return false;
  const record = recordsByRegistrationKey.get(
    registrationKey(frame.sessionId, frame.registrationId),
  );
  if (record === undefined) return true;
  record.tabId = frame.tabId;
  void record.bridge
    .registerDurableTab({
      ...record.tileKey,
      sessionId: frame.sessionId,
      tabId: frame.tabId,
    })
    .catch(ignoreRegistrationError);
  record.onRegistered?.(frame.tabId);
  publishState(record);
  const key = registrationKey(frame.sessionId, frame.registrationId);
  const createRequestId = createRequestIdByRegistrationKey.get(key);
  if (createRequestId !== undefined) {
    createRequestIdByRegistrationKey.delete(key);
    sendForRecord(record, {
      kind: "electronTabCreated",
      hasBinaryPayload: false,
      requestId: createRequestId,
      sessionId: frame.sessionId,
      tabId: frame.tabId,
      reason: null,
    });
  }
  return true;
}

function installDesktopForwarding(record: ElectronBrowserTabRecord): void {
  installCdpForwarder(record);

  record.bridge.onStatusChange((change) => {
    const current = currentRecord(record);
    if (current === undefined || !isChangeForTile(change, current.tileKey)) {
      return;
    }
    current.lastState = change;
    publishState(current);
  });
  record.bridge.onCdpSessionEnded((change) => {
    const current = currentRecord(record);
    if (current === undefined || !isChangeForTile(change, current.tileKey)) {
      return;
    }
    sendForRecord(current, {
      kind: "cdpSessionEnded",
      hasBinaryPayload: false,
      requestId: crypto.randomUUID(),
      tileInstanceId: change.tileInstanceId,
      reason: change.reason,
    });
  });
  record.bridge.onCdpTargetAttached((change) => {
    const current = currentRecord(record);
    if (current === undefined || !isChangeForTile(change, current.tileKey)) {
      return;
    }
    sendForRecord(current, {
      kind: "cdpTargetAttached",
      hasBinaryPayload: false,
      requestId: crypto.randomUUID(),
      tileInstanceId: change.tileInstanceId,
      sessionId: change.sessionId,
      targetId: change.targetId,
      targetType: change.targetType,
      url: change.url,
      waitingForDebugger: change.waitingForDebugger,
    });
  });
  record.bridge.onTileHandoff((change) => {
    const current = currentRecord(record);
    if (current === undefined || !isChangeForTile(change, current.tileKey)) {
      return;
    }
    sendForRecord(current, {
      kind: "tileHandoff",
      hasBinaryPayload: false,
      requestId: crypto.randomUUID(),
      tileInstanceId: change.tileInstanceId,
      capturedUrl: change.capturedUrl,
      capturedStorageState: jsonPayload(change.capturedStorageState),
      siblingTabs: change.siblingTabs.map((sibling) => ({
        tabId: sibling.tabId,
        url: sibling.url,
        capturedStorageState: jsonPayload(sibling.capturedStorageState),
      })),
      reason: change.reason,
    });
  });
}

function installCdpForwarder(record: ElectronBrowserTabRecord): void {
  registerAgentBrowserCdpHandler(record.tileKey.tileInstanceId, (request) => {
    const current = currentRecord(record);
    if (current === undefined) return;
    void current.bridge
      .dispatchCdp({
        ...current.tileKey,
        sessionId: request.sessionId,
        command: request.command,
      })
      .then((result) => {
        request.sendFrame(
          buildCdpResultFrame(
            request.requestId,
            request.tileInstanceId,
            result,
          ),
        );
      })
      .catch((error: unknown) => {
        request.sendFrame(
          buildCdpResultFrame(request.requestId, request.tileInstanceId, {
            kind: request.command.kind,
            ok: false,
            error: {
              kind: "cdp_error",
              message: error instanceof Error ? error.message : String(error),
              code: null,
            },
          }),
        );
      });
  });
}

function publishRegistration(record: ElectronBrowserTabRecord): void {
  sendForRecord(record, {
    kind: "registerElectronTab",
    hasBinaryPayload: false,
    requestId: crypto.randomUUID(),
    registrationId: record.registrationId,
    sessionId: record.sessionId,
    requestedTabId: record.requestedTabId ?? null,
    tileInstanceId: record.tileKey.tileInstanceId,
    initialUrl: record.initialUrl,
    title: record.title,
  });
}

function publishState(record: ElectronBrowserTabRecord): void {
  if (record.tabId === null || record.lastState === null) return;
  sendForRecord(record, {
    kind: "electronTabState",
    hasBinaryPayload: false,
    requestId: crypto.randomUUID(),
    registrationId: record.registrationId,
    sessionId: record.sessionId,
    tabId: record.tabId,
    url: record.lastState.url,
    title: record.lastState.title.length > 0 ? record.lastState.title : null,
    status: sessionStatus(record.lastState),
    viewed: isViewed(record),
  });
}

function recordsForEpicHost(
  epicId: string,
  hostId: string,
): ElectronBrowserTabRecord[] {
  return [...recordsByRegistrationKey.values()].filter(
    (record) => record.epicId === epicId && record.hostId === hostId,
  );
}

function isViewed(record: ElectronBrowserTabRecord): boolean {
  return (
    mostRecentlyFocusedVisibleRecord(
      recordsForEpicHost(record.epicId, record.hostId),
    ) === record
  );
}

function mostRecentlyFocusedVisibleRecord(
  records: readonly ElectronBrowserTabRecord[],
): ElectronBrowserTabRecord | null {
  let mostRecent: ElectronBrowserTabRecord | null = null;
  for (const candidate of records) {
    if (!candidate.visible || candidate.focusOrder === 0) continue;
    if (mostRecent === null || candidate.focusOrder > mostRecent.focusOrder) {
      mostRecent = candidate;
    }
  }
  return mostRecent;
}

function sendForRecord(
  record: ElectronBrowserTabRegistration,
  frame: BrowserSessionsClientFrame,
): void {
  sendFrameByEpicHost.get(epicHostKey(record.epicId, record.hostId))?.(frame);
}

export function findElectronBrowserTabBinding(
  sessionId: string,
  tabId: string,
): ElectronBrowserTabRegistration | null {
  for (const record of recordsByRegistrationKey.values()) {
    if (record.sessionId === sessionId && record.tabId === tabId) return record;
  }
  return null;
}

function isChangeForTile(
  change: BrowserViewTileKey,
  key: BrowserViewTileKey,
): boolean {
  return (
    change.viewTabId === key.viewTabId &&
    change.paneId === key.paneId &&
    change.tileInstanceId === key.tileInstanceId &&
    change.pageSessionId === key.pageSessionId
  );
}

function jsonPayload(
  value: unknown,
): Extract<
  BrowserSessionsClientFrame,
  { readonly kind: "tileHandoff" }
>["capturedStorageState"] {
  return value as Extract<
    BrowserSessionsClientFrame,
    { readonly kind: "tileHandoff" }
  >["capturedStorageState"];
}

function ignoreRegistrationError(_error: unknown): void {}

function sessionStatus(
  change: BrowserViewStatusChange,
): "ready" | "navigating" | "crashed" {
  if (change.status === "dead") return "crashed";
  if (change.status === "loading") return "navigating";
  return "ready";
}

function currentRecord(
  record: ElectronBrowserTabRecord,
): ElectronBrowserTabRecord | undefined {
  return recordsByRegistrationKey.get(
    registrationKey(record.sessionId, record.registrationId),
  );
}

function registrationKey(sessionId: string, registrationId: string): string {
  return [sessionId, registrationId].join("\u001f");
}

function epicHostKey(epicId: string, hostId: string): string {
  return `${epicId}\u0000${hostId}`;
}

export function resetElectronBrowserTabStoreForTests(): void {
  recordsByRegistrationKey.clear();
  sendFrameByEpicHost.clear();
  createRequestIdByRegistrationKey.clear();
  focusOrder = 0;
}
