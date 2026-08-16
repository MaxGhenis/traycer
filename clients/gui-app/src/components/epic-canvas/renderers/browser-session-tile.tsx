import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserSessionInfo } from "@traycer/protocol/host/browser/contracts";
import { AgentBrowserTile } from "./agent-browser-tile";
import { BrowserPeekTile } from "./browser-peek-tile";
import { useBrowserSessionsContext } from "./browser-sessions-context";
import {
  useElectronBrowserTabBinding,
  type ElectronBrowserTabRegistration,
} from "@/lib/browser-view/electron-browser-tab-store";
import { appLogger } from "@/lib/logger";
import type {
  AgentBrowserTileRef,
  BrowserPeekTileRef,
  BrowserSessionTileRef,
} from "@/stores/epics/canvas/types";

export interface BrowserSessionTileProps {
  readonly node: BrowserSessionTileRef;
  readonly viewTabId: string;
  readonly paneId: string;
  readonly epicId: string;
}

function resolveSwapState(args: {
  readonly activatedHeadless: boolean;
  readonly tabStatus: string | undefined;
  readonly migrationRuntime: string | undefined;
  readonly bindingRegistrationId: string | null;
  readonly terminalBindingRegistrationId: string | null;
  readonly castMigrated: boolean;
}): { readonly renderHeadless: boolean; readonly holdReason: string | null } {
  const renderHeadless =
    args.activatedHeadless ||
    (args.tabStatus !== "dormant" &&
      (args.migrationRuntime === "headless" ||
        args.bindingRegistrationId === null ||
        (args.castMigrated &&
          args.bindingRegistrationId ===
            args.terminalBindingRegistrationId)));
  if (!renderHeadless) return { renderHeadless, holdReason: null };
  if (args.activatedHeadless) {
    return { renderHeadless, holdReason: "activated-headless" };
  }
  return {
    renderHeadless,
    holdReason:
      args.bindingRegistrationId === null
        ? "binding-missing"
        : "registration-unchanged",
  };
}

interface BrowserSessionTileBodyProps extends BrowserSessionTileProps {
  readonly session: BrowserSessionInfo | undefined;
  readonly tab: BrowserSessionInfo["tabs"][number] | undefined;
  readonly binding: ElectronBrowserTabRegistration | null;
  readonly routingChatId: string | null;
  readonly renderHeadless: boolean;
  readonly castGeneration: number;
  readonly onMigrated: () => void;
  readonly onActivatedHeadless: () => void;
}

function BrowserSessionTileBody(props: BrowserSessionTileBodyProps) {
  if (props.session === undefined || props.tab === undefined) {
    return (
      <div className="flex h-full w-full items-center justify-center px-4 text-ui-sm text-muted-foreground">
        Browser tab is no longer available.
      </div>
    );
  }

  if (props.renderHeadless) {
    const peek: BrowserPeekTileRef = {
      id: props.node.id,
      instanceId: props.node.instanceId,
      type: "browser-peek",
      name: props.tab.title ?? props.node.name,
      hostId: props.node.hostId,
      chatId: props.routingChatId ?? props.session.createdBy.chatId,
      sessionId: props.node.sessionId,
      tabId: props.node.tabId,
      initialUrl: props.tab.url,
    };
    return (
      <BrowserPeekTile
        key={props.castGeneration}
        epicId={props.epicId}
        node={peek}
        onMigrated={props.onMigrated}
      />
    );
  }

  const native: AgentBrowserTileRef = {
    id: props.binding?.registrationId ?? props.node.id,
    sessionId: props.node.sessionId,
    instanceId: props.node.instanceId,
    type: "agent-browser",
    name: props.tab.title ?? props.node.name,
    hostId: props.node.hostId,
    url: props.tab.url,
    viewportPreset: "responsive",
    runtime: props.binding?.background === true ? "primary" : "isolated",
  };
  return (
    <AgentBrowserTile
      node={native}
      viewTabId={props.viewTabId}
      paneId={props.paneId}
      requestedTabId={props.node.tabId}
      activateBeforeNativeView
      usePrimaryProfileRuntime={props.binding?.background === true}
      onActivatedHeadless={props.onActivatedHeadless}
    />
  );
}

export function BrowserSessionTile(props: BrowserSessionTileProps) {
  const sessions = useBrowserSessionsContext();
  const session = sessions.items.find(
    (item) => item.sessionId === props.node.sessionId,
  );
  const tab = session?.tabs.find((item) => item.tabId === props.node.tabId);
  const binding = useElectronBrowserTabBinding(
    props.node.sessionId,
    props.node.tabId,
  );
  const [activatedHeadless, setActivatedHeadless] = useState(false);
  const [castMigrated, setCastMigrated] = useState(false);
  const [castGeneration, setCastGeneration] = useState(0);
  const [terminalBindingRegistrationId, setTerminalBindingRegistrationId] =
    useState<string | null>(null);
  const bindingRegistrationIdRef = useRef<string | null>(null);
  const latestMigrationRevisionRef = useRef(0);
  const terminalMigrationRevisionRef = useRef(0);
  const swapDecisionSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    bindingRegistrationIdRef.current = binding?.registrationId ?? null;
    latestMigrationRevisionRef.current = session?.migration?.revision ?? 0;
  }, [binding?.registrationId, session?.migration?.revision]);
  const handleActivatedHeadless = useCallback(() => {
    setActivatedHeadless(true);
  }, []);
  const handleMigrated = useCallback(() => {
    setActivatedHeadless(false);
    setTerminalBindingRegistrationId(bindingRegistrationIdRef.current);
    terminalMigrationRevisionRef.current = latestMigrationRevisionRef.current;
    setCastMigrated(true);
  }, []);

  useEffect(() => {
    if (
      !castMigrated ||
      session?.migration?.runtime !== "headless" ||
      session.migration.revision <= terminalMigrationRevisionRef.current
    ) {
      return;
    }
    setCastMigrated(false);
    setCastGeneration((current) => current + 1);
  }, [castMigrated, session?.migration]);

  const { renderHeadless, holdReason: swapHoldReason } = resolveSwapState({
    activatedHeadless,
    tabStatus: tab?.status,
    migrationRuntime: session?.migration?.runtime,
    bindingRegistrationId: binding?.registrationId ?? null,
    terminalBindingRegistrationId,
    castMigrated,
  });

  useEffect(() => {
    if (!castMigrated) {
      swapDecisionSignatureRef.current = null;
      return;
    }
    const candidateRegistrationId = binding?.registrationId ?? null;
    const terminalRegistrationId = terminalBindingRegistrationId;
    const settlementRevision = session?.migration?.revision ?? 0;
    const verdict = renderHeadless ? "hold" : "swap";
    const signature = [
      terminalRegistrationId,
      candidateRegistrationId,
      settlementRevision,
      verdict,
      swapHoldReason,
    ].join("|");
    if (swapDecisionSignatureRef.current === signature) return;
    swapDecisionSignatureRef.current = signature;
    appLogger.info("Browser runtime swap decision", {
      event: "browser_runtime_swap_decision",
      sessionId: props.node.sessionId,
      tabId: props.node.tabId,
      terminalRegistrationId,
      candidateRegistrationId,
      settlementRevision,
      verdict,
      holdReason: swapHoldReason,
    });
  }, [
    binding?.registrationId,
    castMigrated,
    props.node.sessionId,
    props.node.tabId,
    renderHeadless,
    session?.migration?.revision,
    swapHoldReason,
    terminalBindingRegistrationId,
  ]);

  return (
    <BrowserSessionTileBody
      {...props}
      session={session}
      tab={tab}
      binding={binding}
      routingChatId={sessions.routingChatId}
      renderHeadless={renderHeadless}
      castGeneration={castGeneration}
      onMigrated={handleMigrated}
      onActivatedHeadless={handleActivatedHeadless}
    />
  );
}
