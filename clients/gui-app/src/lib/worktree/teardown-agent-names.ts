import { useMemo, useSyncExternalStore } from "react";
import type { WorktreeBusyHolder } from "@traycer/protocol/framework/worktree-busy-holders";
import { getOpenEpicRegistry } from "@/lib/registries/epic-session-registry";

const EMPTY_NAMES: ReadonlyMap<string, string> = new Map();

/**
 * Resolves holder `ownerRef`s to the live chat / terminal-agent titles the
 * GUI already shows in the tab strip. Open epic sessions are the source;
 * unnamed owners stay absent so the formatter falls back to "This agent"
 * instead of a hold-kind label.
 */
export function useTeardownAgentNames(
  holders: readonly WorktreeBusyHolder[],
): ReadonlyMap<string, string> {
  const registry = getOpenEpicRegistry();
  const registryGeneration = useSyncExternalStore(
    (listener) => registry.subscribe(listener),
    () => registry.size(),
  );
  return useMemo(() => {
    void registryGeneration;
    return collectTeardownAgentNames(holders);
  }, [holders, registryGeneration]);
}

export function collectTeardownAgentNames(
  holders: readonly WorktreeBusyHolder[],
): ReadonlyMap<string, string> {
  if (holders.length === 0) return EMPTY_NAMES;
  const names = new Map<string, string>();
  const registry = getOpenEpicRegistry();
  const seenEpics = new Set<string>();
  for (const holder of holders) {
    const epicId = holder.ownerRef.epicId;
    if (seenEpics.has(epicId)) continue;
    seenEpics.add(epicId);
    const handle = registry.peek(epicId);
    if (handle === null) continue;
    const state = handle.store.getState();
    for (const chatId of state.chats.allIds) {
      const chat = Object.hasOwn(state.chats.byId, chatId)
        ? state.chats.byId[chatId]
        : undefined;
      if (chat === undefined || chat.title.length === 0) continue;
      names.set(`chat:${chat.id}`, chat.title);
    }
    for (const agentId of state.tuiAgents.allIds) {
      const agent = Object.hasOwn(state.tuiAgents.byId, agentId)
        ? state.tuiAgents.byId[agentId]
        : undefined;
      if (agent === undefined || agent.title.length === 0) continue;
      names.set(`terminal-agent:${agent.id}`, agent.title);
    }
  }
  return names.size === 0 ? EMPTY_NAMES : names;
}
