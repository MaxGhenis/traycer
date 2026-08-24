import { useCallback, useMemo } from "react";
import { FileText } from "lucide-react";
import { SwitcherListHeader } from "@/components/epic-canvas/mobile/switcher-list-row";
import { SwitcherNewArtifactMenu } from "@/components/epic-canvas/mobile/switcher-create-actions";
import {
  SwitcherArtifactNode,
  type SwitcherExpansionController,
} from "@/components/epic-canvas/mobile/switcher-artifact-row";
import {
  applyVisibleFilter,
  mergeForcedExpanded,
  SidebarFilterVisibilityContext,
  SidebarSortContext,
} from "@/components/epic-canvas/sidebar/epic-sidebar-filter";
import { ArtifactFilterMenu } from "@/components/epic-canvas/sidebar/epic-sidebar-filter-menu";
import {
  useArtifactPanelRootIds,
  useArtifactVisibleIds,
  useUnreadArtifactReadTargets,
} from "@/components/epic-canvas/sidebar/epic-sidebar-artifact-shared";
import { SidebarPanelEmptyState } from "@/components/epic-canvas/sidebar/sidebar-panel-empty-state";
import { useAncestorIds, useEpicPermissionRole } from "@/lib/epic-selectors";
import { isEditableRole } from "@/lib/epic-permissions";
import {
  isDefaultSort,
  makeNodeComparator,
  type NodeComparator,
} from "@/lib/epic-sort";
import { useArtifactSort } from "@/stores/epics/left-panel-store";
import { useActiveEpicArtifactId } from "@/stores/epics/canvas/canvas-selectors";
import {
  useEpicSidebarEffectiveExpanded,
  useEpicSidebarExpansionStore,
} from "@/stores/epics/epic-sidebar-expansion-store";
import { useArtifactReadStateStore } from "@/stores/epics/artifact-read-state-store";

interface SwitcherListProps {
  readonly epicId: string;
  readonly tabId: string;
  readonly onClose: () => void;
}

/** The desktop left panel this list stands in for; keys its shared state. */
const PANEL_ID = "artifacts";

/**
 * Artifacts category: spec / ticket / story / review as the same TREE the
 * desktop sidebar renders, from the same projector index.
 *
 * The list used to filter the flat `useEpicArtifactRecords()` array and sort
 * the whole slice by recency, which dropped hierarchy entirely and could leave
 * a child nowhere near its parent. It now walks `rootIds` -> `childIds` through
 * the shared sidebar selectors, so ordering is per-sibling exactly as it is on
 * desktop, and the panel's status / type / read filters, sort mode and
 * expansion state are the SAME per-tab state - change either surface and the
 * other agrees.
 *
 * The two contexts are what make that sharing work: `useFilteredPanelChildIds`
 * and the unread rollup read the active filter and comparator from them at
 * every level, so this body publishes them once instead of threading props
 * through the recursion.
 */
export function SwitcherArtifactsList(props: SwitcherListProps) {
  const { epicId, tabId, onClose } = props;
  const canMutate = isEditableRole(useEpicPermissionRole());

  const sort = useArtifactSort(epicId);
  const comparator = useMemo<NodeComparator | null>(
    () => (isDefaultSort(sort) ? null : makeNodeComparator(sort)),
    [sort],
  );
  const allRootIds = useArtifactPanelRootIds(comparator);
  const visibleIds = useArtifactVisibleIds(epicId);
  const rootIds = useMemo(
    () => applyVisibleFilter(allRootIds, visibleIds),
    [allRootIds, visibleIds],
  );

  const activeArtifactId = useActiveEpicArtifactId(tabId);
  const ancestorIdsOfActive = useAncestorIds(activeArtifactId);
  const forcedExpandedIds = useMemo(
    () => mergeForcedExpanded(ancestorIdsOfActive, visibleIds),
    [ancestorIdsOfActive, visibleIds],
  );
  const expandedIds = useEpicSidebarEffectiveExpanded(
    tabId,
    PANEL_ID,
    rootIds,
    forcedExpandedIds,
  );
  const expandAction = useEpicSidebarExpansionStore((s) => s.expand);
  const collapseAction = useEpicSidebarExpansionStore((s) => s.collapse);
  const toggleExpanded = useCallback(
    (id: string) => {
      if (expandedIds.has(id)) collapseAction(tabId, PANEL_ID, id);
      else expandAction(tabId, PANEL_ID, id);
    },
    [tabId, expandedIds, expandAction, collapseAction],
  );
  const ensureExpanded = useCallback(
    (id: string) => {
      expandAction(tabId, PANEL_ID, id);
    },
    [tabId, expandAction],
  );
  const expansion = useMemo<SwitcherExpansionController>(
    () => ({ expandedIds, toggleExpanded, ensureExpanded }),
    [expandedIds, toggleExpanded, ensureExpanded],
  );
  const unreadArtifacts = useUnreadArtifactReadTargets(epicId);
  const markRead = useArtifactReadStateStore((state) => state.markRead);
  const markAllRead = useCallback(() => {
    unreadArtifacts.forEach((artifact) => {
      markRead(epicId, artifact.id, artifact.updatedAt);
    });
  }, [epicId, markRead, unreadArtifacts]);

  // "Nothing here" and "nothing MATCHES" are different answers, and the second
  // one has to name the filters as the cause - otherwise a phone user who left
  // a status filter on reads an epic full of artifacts as empty, with the
  // control that hid them one tap away and no reason to look at it.
  const showEmptyState = visibleIds === null && allRootIds.length === 0;
  const showFilteredEmptyState = visibleIds !== null && rootIds.length === 0;

  return (
    <SidebarSortContext.Provider value={comparator}>
      <SidebarFilterVisibilityContext.Provider value={visibleIds}>
        <div className="flex min-h-0 flex-1 flex-col">
          <SwitcherListHeader
            action={
              <>
                {canMutate ? (
                  <SwitcherNewArtifactMenu
                    epicId={epicId}
                    tabId={tabId}
                    onClose={onClose}
                  />
                ) : null}
                <ArtifactFilterMenu
                  epicId={epicId}
                  tabId={tabId}
                  collapsed={false}
                  onMarkAllRead={markAllRead}
                  markAllReadDisabled={unreadArtifacts.length === 0}
                />
              </>
            }
          />
          {showEmptyState || showFilteredEmptyState ? (
            <SidebarPanelEmptyState
              icon={FileText}
              title={
                showEmptyState
                  ? "No artifacts yet."
                  : "No matches for the current filters."
              }
              description={
                showEmptyState
                  ? null
                  : "Status, Type, or Read state may be hiding artifacts."
              }
              testId={
                showEmptyState
                  ? "switcher-artifacts-empty"
                  : "switcher-artifacts-filter-empty"
              }
            />
          ) : (
            <ul
              role="tree"
              aria-label="Epic artifacts tree"
              className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto overscroll-contain p-1 pb-safe-bottom"
            >
              {rootIds.map((nodeId) => (
                <SwitcherArtifactNode
                  key={nodeId}
                  epicId={epicId}
                  tabId={tabId}
                  nodeId={nodeId}
                  depth={0}
                  expansion={expansion}
                  canMutate={canMutate}
                  onClose={onClose}
                />
              ))}
            </ul>
          )}
        </div>
      </SidebarFilterVisibilityContext.Provider>
    </SidebarSortContext.Provider>
  );
}
