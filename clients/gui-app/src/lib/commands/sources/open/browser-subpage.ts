/**
 * Opener "Browser" sub-page: pinned "New browser" creates a fresh page
 * session in the target pane. The ref is minted inside `run` so repeated
 * invocations never reuse the browser page-session id.
 */
import { useMemo } from "react";
import { useReactiveActiveHostId } from "@/hooks/host/use-reactive-active-host-id";
import { UNKNOWN_HOST_PLACEHOLDER } from "@/lib/host/constants";
import { openTileIntoTargetGroup } from "@/lib/commands/actions";
import {
  DEFAULT_BROWSER_TILE_NAME,
  DEFAULT_BROWSER_TILE_URL,
  DEFAULT_BROWSER_VIEWPORT_PRESET,
  makeBrowserTileRef,
} from "@/stores/epics/canvas/tile-schema/browser-tile";
import { openerActionLeaf } from "@/lib/commands/sources/open/open-leaf";
import type { CommandContext, CommandItem } from "@/lib/commands/types";

export function useBrowserOpenerItems(
  ctx: CommandContext,
): ReadonlyArray<CommandItem> {
  const hostId = useReactiveActiveHostId() ?? UNKNOWN_HOST_PLACEHOLDER;

  return useMemo<ReadonlyArray<CommandItem>>(
    () => [
      openerActionLeaf({
        id: "open:browser:new",
        label: "New browser",
        keywords: ["new", "browser", "web", "page"],
        run: () =>
          openTileIntoTargetGroup({
            tabId: ctx.activeTabId,
            groupId: ctx.targetGroupId,
            navigateNestedFocus: ctx.router.navigateNestedFocus,
            ref: makeBrowserTileRef({
              name: DEFAULT_BROWSER_TILE_NAME,
              hostId,
              url: DEFAULT_BROWSER_TILE_URL,
              viewportPreset: DEFAULT_BROWSER_VIEWPORT_PRESET,
            }),
          }),
      }),
    ],
    [
      ctx.activeTabId,
      ctx.router.navigateNestedFocus,
      ctx.targetGroupId,
      hostId,
    ],
  );
}
