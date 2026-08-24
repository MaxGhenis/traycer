import { useCallback } from "react";
import type { EpicArtifactKind } from "@traycer/protocol/common/registry";
import { useEpicCreateArtifact } from "@/hooks/epic/use-epic-node-mutations";
import { openProjectedSidebarNodeInTabWhenAvailable } from "@/components/epic-canvas/sidebar/open-projected-sidebar-node";
import { useOpenEpicHandle } from "@/providers/use-open-epic-handle";
import { useEpicNestedFocusNavigation } from "@/hooks/epic/use-epic-nested-focus-navigation";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";
import { useEpicSessionHostId } from "@/hooks/epic/use-epic-session-host-id";
import { UNKNOWN_HOST_PLACEHOLDER } from "@/lib/host/constants";
import { DEFAULT_EPIC_NODE_NAMES } from "@/lib/artifacts/node-display";
import type { EpicNodeRef } from "@/stores/epics/canvas/types";

export interface SwitcherCreateArtifact {
  readonly create: (type: EpicArtifactKind, parentId: string | null) => void;
  readonly isPending: boolean;
}

/**
 * One-shot artifact creation from the switcher, reusing the exact desktop
 * `addRoot` functions: `useEpicCreateArtifact` then the shared
 * `openProjectedSidebarNodeInTabWhenAvailable` seam, which opens the artifact
 * once it projects. That open lands it as the visible mobile tile, which trips
 * the sheet's active-tile watcher to close. The desktop's inline
 * pending-create staging (a left-panel-only UI) is intentionally omitted; the
 * create + open functions are identical.
 *
 * `parentId` names the artifact the new one nests under - `null` for the
 * category's root "+", a node id for a row's "add child". The desktop
 * add-child path also requests editor focus on the opened tile; the switcher
 * omits that, matching the app's other phone surfaces, which never autofocus a
 * field the user did not tap.
 */
export function useSwitcherCreateArtifact(
  epicId: string,
  tabId: string,
  onOpened: () => void,
): SwitcherCreateArtifact {
  const createArtifact = useEpicCreateArtifact();
  const epicHandle = useOpenEpicHandle();
  const navigateNested = useEpicNestedFocusNavigation();
  const prepareOpenTileInTabFocusTarget = useEpicCanvasStore(
    (s) => s.prepareOpenTileInTabFocusTarget,
  );
  const activeHostId = useEpicSessionHostId() ?? UNKNOWN_HOST_PLACEHOLDER;

  const create = useCallback(
    (type: EpicArtifactKind, parentId: string | null) => {
      createArtifact.mutate(
        {
          epicId,
          parentId,
          artifactType: type,
          title: DEFAULT_EPIC_NODE_NAMES[type],
        },
        {
          onSuccess: (result) => {
            openProjectedSidebarNodeInTabWhenAvailable({
              epicHandle,
              tabId,
              nodeId: result.artifactId,
              fallbackHostId: activeHostId,
              openTileInTab: (targetTabId, nodeRef: EpicNodeRef) => {
                navigateNested(epicId, targetTabId, () =>
                  prepareOpenTileInTabFocusTarget(targetTabId, nodeRef),
                );
              },
              onBeforeOpen: null,
              // The artifact tile is not embed-originated, so the sheet's
              // watcher won't close on it; close here when it actually opens so
              // the new artifact lands as the visible tile.
              onOpened,
              onUnavailable: () => undefined,
              onCleanup: null,
            });
          },
        },
      );
    },
    [
      activeHostId,
      createArtifact,
      epicHandle,
      epicId,
      navigateNested,
      onOpened,
      prepareOpenTileInTabFocusTarget,
      tabId,
    ],
  );

  return { create, isPending: createArtifact.isPending };
}
