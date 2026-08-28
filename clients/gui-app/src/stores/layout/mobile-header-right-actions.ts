import { type ReactNode } from "react";
import { useTabsStore } from "@/stores/tabs/store";
import { selectHostFocusedRef } from "@/stores/tabs/selectors";
import type { TabRef } from "@/stores/tabs/types";
import {
  LANDING_TERMINAL_RIGHT_ACTIONS_KEY,
  epicTabRightActionsKey,
  useMobileHeaderStore,
} from "@/stores/layout/mobile-header-store";

/**
 * Which registry entry the presented surface is entitled to, or `null` where
 * the header carries no surface actions at all.
 *
 * Resolved from the tab layout's focused ref - the same authority the header
 * titles from - because the layout is the one presentation fact that survives
 * a phone cold restore, where the router still sits on the landing route while
 * the restored tab fills the screen. A `null` focus and a draft both present
 * the composer surface, which is where the landing terminal panel's controls
 * belong; History and Settings present nothing, so a registered entry from a
 * surface merely retained behind them can never leak into their header.
 */
export function resolveMobileHeaderRightActionsKey(
  focused: TabRef | null,
): string | null {
  if (focused === null) return LANDING_TERMINAL_RIGHT_ACTIONS_KEY;
  switch (focused.kind) {
    case "draft":
      return LANDING_TERMINAL_RIGHT_ACTIONS_KEY;
    case "epic":
      return epicTabRightActionsKey(focused.id);
    case "history":
    case "settings":
      return null;
  }
}

/**
 * The right-actions node the mobile header should render right now: the
 * presented surface's registered entry, or nothing.
 *
 * A pure read over (tab layout, registry), so a presentation change lands in
 * the same commit for every surface that is already registered - no writer has
 * to observe the change, and a surface presented again after being
 * backgrounded shows its controls with no re-publish. That is why writers
 * register while RETAINED, not on focus: an entry that only appeared on focus
 * would trail the focus commit by its own effect flush. A surface whose first
 * mount IS the transition still registers an effect-flush later - there is
 * nothing to resolve before it exists. An entry whose surface is not presented
 * resolves to nothing, however its teardown is ordered.
 */
export function useMobileHeaderRightActions(): ReactNode | null {
  const key = useTabsStore((state) =>
    resolveMobileHeaderRightActionsKey(selectHostFocusedRef(state)),
  );
  return useMobileHeaderStore((state) =>
    key === null ? null : (state.rightActionEntries.get(key) ?? null),
  );
}
