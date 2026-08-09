import { ipcRenderer } from "electron";
import {
  RunnerHostEvent,
  RunnerHostInvoke,
} from "../ipc-contracts/ipc-channels";
import type {
  AgentBrowserViewCdpDispatch,
  AgentBrowserViewCdpResult,
  AgentBrowserViewCdpSessionEndedChange,
  AgentBrowserViewCdpTargetAttachedChange,
  AgentBrowserViewTileHandoffChange,
  BrowserViewBoundsUpdate,
  BrowserViewDurableTabRegistration,
  BrowserViewOpenTileRequest,
  BrowserViewStatusChange,
  BrowserViewTileKey,
  BrowserViewTileUpsert,
} from "../ipc-contracts/browser-view-types";
import { subscribe, type Disposable, type Listener } from "./subscribe";

export interface AgentBrowserViewBridgeSurface {
  agentBrowserView: {
    upsertTile(input: BrowserViewTileUpsert): Promise<void>;
    registerDurableTab(input: BrowserViewDurableTabRegistration): Promise<void>;
    updateBounds(input: BrowserViewBoundsUpdate): Promise<void>;
    releaseTile(input: BrowserViewTileKey): Promise<void>;
    onStatusChange(handler: Listener<BrowserViewStatusChange>): Disposable;
    onOpenTileRequest(
      handler: Listener<BrowserViewOpenTileRequest>,
    ): Disposable;
    dispatchCdp(
      input: AgentBrowserViewCdpDispatch,
    ): Promise<AgentBrowserViewCdpResult>;
    onCdpSessionEnded(
      handler: Listener<AgentBrowserViewCdpSessionEndedChange>,
    ): Disposable;
    onCdpTargetAttached(
      handler: Listener<AgentBrowserViewCdpTargetAttachedChange>,
    ): Disposable;
    onTileHandoff(
      handler: Listener<AgentBrowserViewTileHandoffChange>,
    ): Disposable;
  };
}

export function buildAgentBrowserViewBridge(): AgentBrowserViewBridgeSurface {
  return {
    agentBrowserView: {
      upsertTile: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewUpsert,
          input,
        ) as Promise<void>,
      registerDurableTab: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewRegisterDurableTab,
          input,
        ) as Promise<void>,
      updateBounds: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewUpdateBounds,
          input,
        ) as Promise<void>,
      releaseTile: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewRelease,
          input,
        ) as Promise<void>,
      onStatusChange: (handler) =>
        subscribe<BrowserViewStatusChange>(
          RunnerHostEvent.agentBrowserViewStatusChange,
          handler,
        ),
      onOpenTileRequest: (handler) =>
        subscribe<BrowserViewOpenTileRequest>(
          RunnerHostEvent.agentBrowserViewOpenTileRequest,
          handler,
        ),
      dispatchCdp: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewCdpDispatch,
          input,
        ) as Promise<AgentBrowserViewCdpResult>,
      onCdpSessionEnded: (handler) =>
        subscribe<AgentBrowserViewCdpSessionEndedChange>(
          RunnerHostEvent.agentBrowserViewCdpSessionEnded,
          handler,
        ),
      onCdpTargetAttached: (handler) =>
        subscribe<AgentBrowserViewCdpTargetAttachedChange>(
          RunnerHostEvent.agentBrowserViewCdpTargetAttached,
          handler,
        ),
      onTileHandoff: (handler) =>
        subscribe<AgentBrowserViewTileHandoffChange>(
          RunnerHostEvent.agentBrowserViewTileHandoff,
          handler,
        ),
    },
  };
}
