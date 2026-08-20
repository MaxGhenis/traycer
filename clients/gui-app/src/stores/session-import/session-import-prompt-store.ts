import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { basePersistOptions, persistKey, STORE_KEYS } from "@/lib/persist";

/**
 * Whether the user has dismissed the quiet "you can bring your CLI sessions
 * over" row above the task list.
 *
 * Persisted per machine and never re-armed: the row is an offer, and an offer
 * declined once should not come back. The row's other conditions (nothing
 * imported on this host yet, onboarding done) already retire it on their own.
 */
interface SessionImportPromptState {
  readonly dismissedAt: number | null;
  readonly dismiss: () => void;
  readonly reset: () => void;
}

const SESSION_IMPORT_PROMPT_PERSIST_KEY = persistKey(
  STORE_KEYS.sessionImportPrompt,
);

export const useSessionImportPromptStore = create<SessionImportPromptState>()(
  persist(
    (set) => ({
      dismissedAt: null,
      dismiss: () => set({ dismissedAt: Date.now() }),
      reset: () => set({ dismissedAt: null }),
    }),
    {
      ...basePersistOptions(SESSION_IMPORT_PROMPT_PERSIST_KEY),
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ dismissedAt: state.dismissedAt }),
    },
  ),
);
