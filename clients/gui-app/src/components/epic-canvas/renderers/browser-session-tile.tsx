import { useCallback, useEffect, useRef, useState } from "react";
import { AgentBrowserTile } from "./agent-browser-tile";
import { BrowserPeekTile } from "./browser-peek-tile";
import { useBrowserSessionsContext } from "./browser-sessions-context";
import { useElectronBrowserTabBinding } from "@/lib/browser-view/electron-browser-tab-store";
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
  const bindingRegistrationIdRef = useRef<string | null>(null);
  const terminalBindingRegistrationIdRef = useRef<string | null>(null);
  const latestMigrationRevisionRef = useRef(0);
  const terminalMigrationRevisionRef = useRef(0);
  const swapDecisionSignatureRef = useRef<string | null>(null);
  bindingRegistrationIdRef.current = binding?.registrationId ?? null;
  latestMigrationRevisionRef.current = session?.migration?.revision ?? 0;
  const handleActivatedHeadless = useCallback(() => {
    setActivatedHeadless(true);
  }, []);
  const handleMigrated = useCallback(() => {
    setActivatedHeadless(false);
    terminalBindingRegistrationIdRef.current =
      bindingRegistrationIdRef.current;
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

  const renderHeadless =
    activatedHeadless ||
    (tab?.status !== "dormant" &&
      (session?.migration?.runtime === "headless" ||
        binding === null ||
        (castMigrated &&
          binding.registrationId ===
            terminalBindingRegistrationIdRef.current)));
  const swapHoldReason = !renderHeadless
    ? null
    : activatedHeadless
      ? "activated-headless"
      : binding === null
        ? "binding-missing"
        : "registration-unchanged";

  useEffect(() => {
    if (!castMigrated) {
      swapDecisionSignatureRef.current = null;
      return;
    }
    const candidateRegistrationId = binding?.registrationId ?? null;
    const terminalRegistrationId =
      terminalBindingRegistrationIdRef.current;
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
  ]);

  if (session === undefined || tab === undefined) {
    return (
      <div className="flex h-full w-full items-center justify-center px-4 text-ui-sm text-muted-foreground">
        Browser tab is no longer available.
      </div>
    );
  }

  if (renderHeadless) {
    const peek: BrowserPeekTileRef = {
      id: props.node.id,
      instanceId: props.node.instanceId,
      type: "browser-peek",
      name: tab.title ?? props.node.name,
      hostId: props.node.hostId,
      chatId: sessions.routingChatId ?? session.createdBy.chatId,
      sessionId: props.node.sessionId,
      tabId: props.node.tabId,
      initialUrl: tab.url,
    };
    return (
      <BrowserPeekTile
        key={castGeneration}
        epicId={props.epicId}
        node={peek}
        onMigrated={handleMigrated}
      />
    );
  }

  const native: AgentBrowserTileRef = {
    id: binding?.registrationId ?? props.node.id,
    sessionId: props.node.sessionId,
    instanceId: props.node.instanceId,
    type: "agent-browser",
    name: tab.title ?? props.node.name,
    hostId: props.node.hostId,
    url: tab.url,
    viewportPreset: "responsive",
    runtime: binding?.background === true ? "primary" : "isolated",
  };
  return (
    <AgentBrowserTile
      node={native}
      viewTabId={props.viewTabId}
      paneId={props.paneId}
      requestedTabId={props.node.tabId}
      activateBeforeNativeView
      usePrimaryProfileRuntime={binding?.background === true}
      onActivatedHeadless={handleActivatedHeadless}
    />
  );
}
