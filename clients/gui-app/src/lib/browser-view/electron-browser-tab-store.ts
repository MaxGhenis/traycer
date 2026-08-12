import type {
  BrowserSessionInfo,
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
  DesktopBrowserViewBridge,
  BrowserViewDurableTabRegistration,
  BrowserViewStatusChange,
  BrowserViewTileKey,
} from "./desktop-browser-view";

interface ElectronBrowserTabBridge {
  createBackgroundTab?: DesktopBrowserViewBridge["createBackgroundTab"];
  registerDurableTab(input: BrowserViewDurableTabRegistration): Promise<void>;
  releaseDurableTab?(input: BrowserViewDurableTabRegistration): Promise<void>;
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
  setBackgroundThrottling?: DesktopBrowserViewBridge["setBackgroundThrottling"];
  applyStorageState?: DesktopBrowserViewBridge["applyStorageState"];
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
  readonly background?: boolean;
}

interface ElectronBrowserTabRecord extends ElectronBrowserTabRegistration {
  tabId: string | null;
  lastState: BrowserViewStatusChange | null;
  visible: boolean;
  focused: boolean;
  focusOrder: number;
  cleanup: () => void;
}

type SendFrame = (frame: BrowserSessionsClientFrame) => void;

const recordsByRegistrationKey = new Map<string, ElectronBrowserTabRecord>();
const sendFrameByEpicHost = new Map<string, SendFrame>();
const backgroundBridgeByEpicHost = new Map<string, DesktopBrowserViewBridge>();
const createRequestIdByRegistrationKey = new Map<string, string>();
const pendingHandoffAcks = new Map<
  string,
  { readonly promise: Promise<void>; readonly resolve: () => void }
>();
let focusOrder = 0;

export async function drainElectronBrowserHandoffs(): Promise<void> {
  await Promise.all(
    Array.from(pendingHandoffAcks.values(), (pending) => pending.promise),
  );
}

export function registerElectronBrowserTab(
  input: ElectronBrowserTabRegistration,
): void {
  const key = registrationKey(input.sessionId, input.registrationId);
  const existing = recordsByRegistrationKey.get(key);
  if (existing !== undefined) {
    const tileKeyChanged = !isChangeForTile(input.tileKey, existing.tileKey);
    const bridge =
      existing.background === true && input.background === true
        ? existing.bridge
        : input.bridge;
    const forwardingChanged = tileKeyChanged || bridge !== existing.bridge;
    Object.assign(existing, input, { bridge });
    if (forwardingChanged) {
      existing.cleanup();
      existing.cleanup = installDesktopForwarding(existing);
    }
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
    cleanup: () => {},
  };
  recordsByRegistrationKey.set(key, record);
  record.cleanup = installDesktopForwarding(record);
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

export function attachElectronBrowserBackgroundTabRoute(
  epicId: string,
  hostId: string,
  bridge: DesktopBrowserViewBridge,
): () => void {
  const key = epicHostKey(epicId, hostId);
  backgroundBridgeByEpicHost.set(key, bridge);
  return () => {
    if (backgroundBridgeByEpicHost.get(key) === bridge) {
      backgroundBridgeByEpicHost.delete(key);
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
  if (frame.kind === "actionAck") {
    const pending = pendingHandoffAcks.get(frame.requestId);
    if (pending === undefined) return false;
    pendingHandoffAcks.delete(frame.requestId);
    pending.resolve();
    return true;
  }
  if (frame.kind === "createElectronTab") {
    if (frame.background === true) {
      return handleBackgroundElectronTabCreate(frame);
    }
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
  if (frame.kind === "releaseElectronTab") {
    releaseElectronTab(frame);
    return true;
  }
  if (frame.kind === "electronTabRegistrationFailed") {
    handleElectronTabRegistrationFailed(frame);
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

function releaseElectronTab(
  frame: Extract<BrowserSessionsServerFrame, { kind: "releaseElectronTab" }>,
): void {
  const record = findElectronBrowserTabRecord(frame.sessionId, frame.tabId);
  if (record === undefined) return;
  deleteRecord(record);
  if (record.bridge.releaseDurableTab === undefined) return;
  void record.bridge
    .releaseDurableTab({
      ...record.tileKey,
      sessionId: frame.sessionId,
      tabId: frame.tabId,
    })
    .catch(ignoreRegistrationError);
}

function handleElectronTabRegistrationFailed(
  frame: Extract<
    BrowserSessionsServerFrame,
    { kind: "electronTabRegistrationFailed" }
  >,
): void {
  const record = recordsByRegistrationKey.get(
    registrationKey(frame.sessionId, frame.registrationId),
  );
  if (record?.background === true) {
    deleteRecord(record);
    if (record.bridge.releaseDurableTab !== undefined) {
      void record.bridge
        .releaseDurableTab({
          ...record.tileKey,
          sessionId: frame.sessionId,
          tabId: frame.tabId,
        })
        .catch(ignoreRegistrationError);
    }
  }
  record?.onActivatedHeadless?.(frame.tabId);
}

function handleBackgroundElectronTabCreate(
  frame: Extract<BrowserSessionsServerFrame, { kind: "createElectronTab" }>,
): boolean {
  const epicId = frame.epicId;
  const hostId = frame.hostId;
  if (epicId === undefined || hostId === undefined) return false;
  const bridge = backgroundBridgeByEpicHost.get(epicHostKey(epicId, hostId));
  if (bridge?.createBackgroundTab === undefined) return false;
  const createBackgroundTab = bridge.createBackgroundTab.bind(bridge);
  const registrationId = crypto.randomUUID();
  const tileKey: BrowserViewTileKey = {
    viewTabId: "background",
    paneId: "background",
    tileInstanceId: crypto.randomUUID(),
    pageSessionId: registrationId,
  };
  createRequestIdByRegistrationKey.set(
    registrationKey(frame.sessionId, registrationId),
    frame.requestId,
  );
  const seed =
    frame.seedStorageState === undefined || frame.seedStorageState === null
      ? Promise.resolve()
      : bridge.applyStorageState({
          storageState: frame.seedStorageState,
        });
  void seed
    .then(() =>
      createBackgroundTab({
        ...tileKey,
        sessionId: frame.sessionId,
        tabId: frame.sourceTabId,
        url: frame.url,
      }),
    )
    .then(() => {
      registerElectronBrowserTab({
        epicId,
        hostId,
        chatId: null,
        registrationId,
        sessionId: frame.sessionId,
        requestedTabId: frame.sourceTabId,
        initialUrl: frame.url,
        title: null,
        tileKey,
        bridge,
        onRegistered: null,
        background: true,
      });
    })
    .catch((error: unknown) => {
      createRequestIdByRegistrationKey.delete(
        registrationKey(frame.sessionId, registrationId),
      );
      sendFrameByEpicHost.get(epicHostKey(epicId, hostId))?.({
        kind: "electronTabCreated",
        hasBinaryPayload: false,
        requestId: frame.requestId,
        sessionId: frame.sessionId,
        tabId: null,
        reason: error instanceof Error ? error.message : String(error),
      });
    });
  return true;
}

export function syncElectronBrowserTabDrivers(
  session: BrowserSessionInfo,
): void {
  for (const tab of session.tabs) {
    const record = findElectronBrowserTabBinding(session.sessionId, tab.tabId);
    const setBackgroundThrottling = record?.bridge.setBackgroundThrottling;
    if (record === null || setBackgroundThrottling === undefined) continue;
    void setBackgroundThrottling({
      ...record.tileKey,
      enabled: tab.drivenBy.length === 0,
    }).catch(ignoreRegistrationError);
  }
}

function installDesktopForwarding(
  record: ElectronBrowserTabRecord,
): () => void {
  const disposeCdp = installCdpForwarder(record);
  const status = record.bridge.onStatusChange((change) => {
    const current = currentRecord(record);
    if (current === undefined || !isChangeForTile(change, current.tileKey)) {
      return;
    }
    current.lastState = change;
    publishState(current);
  });
  const cdpSessionEnded = record.bridge.onCdpSessionEnded((change) => {
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
  const cdpTargetAttached = record.bridge.onCdpTargetAttached((change) => {
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
  const tileHandoff = record.bridge.onTileHandoff((change) => {
    const current = currentRecord(record);
    if (current === undefined || !isChangeForTile(change, current.tileKey)) {
      return;
    }
    const requestId = crypto.randomUUID();
    let resolveAck: (() => void) | null = null;
    const promise = new Promise<void>((resolve) => {
      resolveAck = resolve;
    });
    pendingHandoffAcks.set(requestId, {
      promise,
      resolve: () => resolveAck?.(),
    });
    sendForRecord(current, {
      kind: "tileHandoff",
      hasBinaryPayload: false,
      requestId,
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
  return () => {
    disposeCdp();
    status.dispose();
    cdpSessionEnded.dispose();
    cdpTargetAttached.dispose();
    tileHandoff.dispose();
  };
}

function installCdpForwarder(record: ElectronBrowserTabRecord): () => void {
  return registerAgentBrowserCdpHandler(
    record.tileKey.tileInstanceId,
    (request) => {
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
    },
  );
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
  return findElectronBrowserTabRecord(sessionId, tabId) ?? null;
}

function findElectronBrowserTabRecord(
  sessionId: string,
  tabId: string,
): ElectronBrowserTabRecord | undefined {
  for (const record of recordsByRegistrationKey.values()) {
    if (record.sessionId === sessionId && record.tabId === tabId) return record;
  }
  return undefined;
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
  for (const record of recordsByRegistrationKey.values()) record.cleanup();
  recordsByRegistrationKey.clear();
  sendFrameByEpicHost.clear();
  backgroundBridgeByEpicHost.clear();
  for (const pending of pendingHandoffAcks.values()) pending.resolve();
  pendingHandoffAcks.clear();
  createRequestIdByRegistrationKey.clear();
  focusOrder = 0;
}

function deleteRecord(record: ElectronBrowserTabRecord): void {
  record.cleanup();
  recordsByRegistrationKey.delete(
    registrationKey(record.sessionId, record.registrationId),
  );
}
