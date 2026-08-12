import { useCallback, useEffect, useRef, useState } from "react";
import { AgentBrowserTile } from "./agent-browser-tile";
import { BrowserPeekTile } from "./browser-peek-tile";
import { useBrowserSessionsContext } from "./browser-sessions-context";
import { useElectronBrowserTabBinding } from "@/lib/browser-view/electron-browser-tab-store";
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
  const latestMigrationRevisionRef = useRef(0);
  const terminalMigrationRevisionRef = useRef(0);
  latestMigrationRevisionRef.current = session?.migration?.revision ?? 0;
  const handleActivatedHeadless = useCallback(() => {
    setActivatedHeadless(true);
  }, []);
  const handleMigrated = useCallback(() => {
    setActivatedHeadless(false);
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

  if (session === undefined || tab === undefined) {
    return (
      <div className="flex h-full w-full items-center justify-center px-4 text-ui-sm text-muted-foreground">
        Browser tab is no longer available.
      </div>
    );
  }

  const renderHeadless =
    activatedHeadless ||
    (tab.status !== "dormant" && (binding === null || !castMigrated));
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
