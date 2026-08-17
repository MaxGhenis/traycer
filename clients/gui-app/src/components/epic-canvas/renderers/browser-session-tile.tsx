import { useCallback, useEffect, useRef, useState } from "react";
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
  const [terminalBindingRegistrationId, setTerminalBindingRegistrationId] =
    useState<string | null>(null);
  const latestMigrationRevisionRef = useRef(0);
  const terminalMigrationRevisionRef = useRef(0);
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

  useHeadlessCastReset({
    castMigrated,
    migration: session?.migration,
    terminalMigrationRevisionRef,
    setCastMigrated,
    setCastGeneration,
  });

  const renderHeadless = shouldRenderHeadless({
    activatedHeadless,
    tab,
    session,
    binding,
    castMigrated,
    terminalBindingRegistrationId,
  });
  const swapHoldReason = swapHoldReasonFor({
    renderHeadless,
    activatedHeadless,
    bindingMissing: binding === null,
  });
  useRuntimeSwapDecisionLog({
    sessionId: props.node.sessionId,
    tabId: props.node.tabId,
    binding,
    castMigrated,
    terminalBindingRegistrationId,
    session,
    renderHeadless,
    swapHoldReason,
  });

  if (session === undefined || tab === undefined) {
    return (
      <div className="flex h-full w-full items-center justify-center px-4 text-ui-sm text-muted-foreground">
        Browser tab is no longer available.
      </div>
    );
  }

  if (renderHeadless) {
    return (
      <BrowserPeekTile
        key={castGeneration}
        epicId={props.epicId}
        node={peekNodeFromSession({
          node: props.node,
          tab,
          routingChatId: sessions.routingChatId ?? session.createdBy.chatId,
        })}
        onMigrated={handleMigrated}
      />
    );
  }

  return (
    <AgentBrowserTile
      node={nativeNodeFromSession({
        node: props.node,
        tab,
        binding,
      })}
      viewTabId={props.viewTabId}
      paneId={props.paneId}
      requestedTabId={props.node.tabId}
      activateBeforeNativeView
      usePrimaryProfileRuntime={binding?.background === true}
      onActivatedHeadless={handleActivatedHeadless}
    />
  );
}

function shouldRenderHeadless(input: {
  readonly activatedHeadless: boolean;
  readonly tab: { readonly status: string } | undefined;
  readonly session:
    | { readonly migration: { readonly runtime: string } | undefined }
    | undefined;
  readonly binding: ElectronBrowserTabRegistration | null;
  readonly castMigrated: boolean;
  readonly terminalBindingRegistrationId: string | null;
}): boolean {
  if (input.activatedHeadless) return true;
  if (input.tab?.status === "dormant") return false;
  if (input.session?.migration?.runtime === "headless") return true;
  if (input.binding === null) return true;
  return (
    input.castMigrated &&
    input.binding.registrationId === input.terminalBindingRegistrationId
  );
}

function useHeadlessCastReset(input: {
  readonly castMigrated: boolean;
  readonly migration:
    | { readonly runtime: string; readonly revision: number }
    | undefined;
  readonly terminalMigrationRevisionRef: {
    readonly current: number;
  };
  readonly setCastMigrated: (value: boolean) => void;
  readonly setCastGeneration: (value: (current: number) => number) => void;
}): void {
  const {
    castMigrated,
    migration,
    terminalMigrationRevisionRef,
    setCastMigrated,
    setCastGeneration,
  } = input;
  useEffect(() => {
    if (
      !castMigrated ||
      migration?.runtime !== "headless" ||
      migration.revision <= terminalMigrationRevisionRef.current
    ) {
      return;
    }
    setCastMigrated(false);
    setCastGeneration((current) => current + 1);
  }, [
    castMigrated,
    migration,
    setCastGeneration,
    setCastMigrated,
    terminalMigrationRevisionRef,
  ]);
}

function useRuntimeSwapDecisionLog(input: {
  readonly sessionId: string;
  readonly tabId: string;
  readonly binding: ElectronBrowserTabRegistration | null;
  readonly castMigrated: boolean;
  readonly terminalBindingRegistrationId: string | null;
  readonly session:
    | { readonly migration: { readonly revision: number } | undefined }
    | undefined;
  readonly renderHeadless: boolean;
  readonly swapHoldReason:
    | "activated-headless"
    | "binding-missing"
    | "registration-unchanged"
    | null;
}): void {
  const swapDecisionSignatureRef = useRef<string | null>(null);
  const bindingRegistrationId = input.binding?.registrationId ?? null;
  const settlementRevision = input.session?.migration?.revision ?? 0;
  useEffect(() => {
    if (!input.castMigrated) {
      swapDecisionSignatureRef.current = null;
      return;
    }
    const verdict = input.renderHeadless ? "hold" : "swap";
    const signature = [
      input.terminalBindingRegistrationId,
      bindingRegistrationId,
      settlementRevision,
      verdict,
      input.swapHoldReason,
    ].join("|");
    if (swapDecisionSignatureRef.current === signature) return;
    swapDecisionSignatureRef.current = signature;
    appLogger.info("Browser runtime swap decision", {
      event: "browser_runtime_swap_decision",
      sessionId: input.sessionId,
      tabId: input.tabId,
      terminalRegistrationId: input.terminalBindingRegistrationId,
      candidateRegistrationId: bindingRegistrationId,
      settlementRevision,
      verdict,
      holdReason: input.swapHoldReason,
    });
  }, [
    bindingRegistrationId,
    input.castMigrated,
    input.renderHeadless,
    input.sessionId,
    input.swapHoldReason,
    input.tabId,
    input.terminalBindingRegistrationId,
    settlementRevision,
  ]);
}

function peekNodeFromSession(input: {
  readonly node: BrowserSessionTileRef;
  readonly tab: { readonly title: string | null; readonly url: string };
  readonly routingChatId: string;
}): BrowserPeekTileRef {
  return {
    id: input.node.id,
    instanceId: input.node.instanceId,
    type: "browser-peek",
    name: input.tab.title ?? input.node.name,
    hostId: input.node.hostId,
    chatId: input.routingChatId,
    sessionId: input.node.sessionId,
    tabId: input.node.tabId,
    initialUrl: input.tab.url,
  };
}

function nativeNodeFromSession(input: {
  readonly node: BrowserSessionTileRef;
  readonly tab: { readonly title: string | null; readonly url: string };
  readonly binding: ElectronBrowserTabRegistration | null;
}): AgentBrowserTileRef {
  return {
    id: input.binding?.registrationId ?? input.node.id,
    sessionId: input.node.sessionId,
    instanceId: input.node.instanceId,
    type: "agent-browser",
    name: input.tab.title ?? input.node.name,
    hostId: input.node.hostId,
    url: input.tab.url,
    viewportPreset: "responsive",
    runtime: input.binding?.background === true ? "primary" : "isolated",
  };
}

function swapHoldReasonFor(input: {
  readonly renderHeadless: boolean;
  readonly activatedHeadless: boolean;
  readonly bindingMissing: boolean;
}): "activated-headless" | "binding-missing" | "registration-unchanged" | null {
  if (!input.renderHeadless) return null;
  if (input.activatedHeadless) return "activated-headless";
  if (input.bindingMissing) return "binding-missing";
  return "registration-unchanged";
}
