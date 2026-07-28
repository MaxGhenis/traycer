import { ipcRenderer } from "electron";
import {
  RunnerHostEvent,
  RunnerHostInvoke,
} from "../ipc-contracts/ipc-channels";
import type {
  AgentBrowserViewCdpDispatch,
  AgentBrowserViewCdpInteractionObservedChange,
  AgentBrowserViewCdpResult,
  AgentBrowserViewCdpSessionEndedChange,
  AgentBrowserViewCdpTargetAttachedChange,
  AgentBrowserViewTileHandoffChange,
  BrowserViewBoundsUpdate,
  BrowserViewStatusChange,
  BrowserViewTileKey,
  BrowserViewTileUpsert,
} from "../ipc-contracts/browser-view-types";
import { subscribe, type Disposable, type Listener } from "./subscribe";

export interface AgentBrowserViewBridgeSurface {
  agentBrowserView: {
    upsertTile(input: BrowserViewTileUpsert): Promise<void>;
    updateBounds(input: BrowserViewBoundsUpdate): Promise<void>;
    releaseTile(input: BrowserViewTileKey): Promise<void>;
    onStatusChange(handler: Listener<BrowserViewStatusChange>): Disposable;
    dispatchCdp(
      input: AgentBrowserViewCdpDispatch,
    ): Promise<AgentBrowserViewCdpResult>;
    onCdpSessionEnded(
      handler: Listener<AgentBrowserViewCdpSessionEndedChange>,
    ): Disposable;
    onCdpTargetAttached(
      handler: Listener<AgentBrowserViewCdpTargetAttachedChange>,
    ): Disposable;
    onCdpInteractionObserved(
      handler: Listener<AgentBrowserViewCdpInteractionObservedChange>,
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
      onCdpInteractionObserved: (handler) =>
        subscribe<AgentBrowserViewCdpInteractionObservedChange>(
          RunnerHostEvent.agentBrowserViewCdpInteractionObserved,
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
