import { useMemo } from "react";
import { create } from "zustand";
import { deriveWakeStreakCollapsibleKey } from "@/components/chat/chat-collapsible-key";
import {
  useChatOpenStoreScope,
  scopedChatOpenId,
} from "@/stores/chats/open-store-scope";
import {
  useChatCollapsibleTileInstanceId,
  useChatFindForcedOpen,
} from "@/stores/chats/chat-find-force-store-context";

/**
 * Expanded/collapsed state for wake-streak sections (see
 * `components/chat/chat-wake-streaks.ts`), namespaced by tile instance id the
 * same way the tool/subagent open stores are. Collapsed is the default -
 * absence from the set - and the store records only explicit opens, so a
 * fresh chat always loads with its streaks folded. Deliberately no durable
 * chat-key mirror: a reopened chat re-collapsing its streaks is the desired
 * reading posture, not lost state.
 */
interface WakeStreakOpenState {
  readonly openIds: ReadonlySet<string>;
  setOpen: (scope: string, streakId: string, open: boolean) => void;
  reset: (scope: string) => void;
}

export const useWakeStreakOpenStore = create<WakeStreakOpenState>((set) => ({
  openIds: new Set(),
  setOpen: (scope, streakId, open) =>
    set((state) => {
      const scopedId = scopedChatOpenId(scope, streakId);
      const wasOpen = state.openIds.has(scopedId);
      if (wasOpen === open) return state;
      const next = new Set(state.openIds);
      if (open) {
        next.add(scopedId);
      } else {
        next.delete(scopedId);
      }
      return { openIds: next };
    }),
  reset: (scope) =>
    set((state) => {
      const prefix = `${scope}\0`;
      const next = new Set(
        Array.from(state.openIds).filter((id) => !id.startsWith(prefix)),
      );
      return next.size === state.openIds.size ? state : { openIds: next };
    }),
}));

export function useWakeStreakOpen(scope: string, streakId: string): boolean {
  return useWakeStreakOpenStore((state) =>
    state.openIds.has(scopedChatOpenId(scope, streakId)),
  );
}

/**
 * Whether a wake streak's folded members are shown: the user's own toggle OR
 * find forcing the section open to paint a match inside it. Shared by the
 * fold header (which toggles it) and each folded member row (which renders or
 * hides its content by it) so the two can never disagree.
 */
export function useWakeStreakSectionOpen(streakId: string): boolean {
  const scope = useChatOpenStoreScope();
  const tileInstanceId = useChatCollapsibleTileInstanceId();
  const collapsibleKey = useMemo(
    () => deriveWakeStreakCollapsibleKey(tileInstanceId, streakId),
    [streakId, tileInstanceId],
  );
  const userOpen = useWakeStreakOpen(scope, streakId);
  const findForcedOpen = useChatFindForcedOpen(collapsibleKey);
  return userOpen || findForcedOpen;
}
