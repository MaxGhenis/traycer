/**
 * The artifact panel's shared, presentation-free logic: which nodes belong to
 * the panel, which of them a filter leaves visible, how a row's unread marker
 * is derived, and what "mark all as read" would clear.
 *
 * It lives apart from `epic-sidebar-artifact-tree.tsx` because two surfaces
 * render the same artifact tree from it - the desktop sidebar panel and the
 * mobile tab-switcher's Artifacts category - and neither may fork the rules
 * that decide WHICH artifacts a user sees. Only the rows differ.
 */
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { isEpicArtifactKind } from "@/lib/artifacts/node-display";
import { sortNodeIds, type NodeComparator } from "@/lib/epic-sort";
import { useEpicTreeIndex, useRootIds } from "@/lib/epic-selectors";
import { useEpicStore } from "@/hooks/use-epic-store";
import {
  isArtifactUnread,
  useArtifactReadStateStore,
} from "@/stores/epics/artifact-read-state-store";
import {
  isArtifactFilterActive,
  useArtifactFilter,
} from "@/stores/epics/left-panel-store";
import type { TreeSlice } from "@/stores/epics/open-epic/types";
import {
  collectWithAncestors,
  useSidebarVisibleIds,
} from "@/components/epic-canvas/sidebar/epic-sidebar-filter";

export type TreeFilterFn = (type: string | null | undefined) => boolean;

export const ARTIFACTS_TREE_FILTER: TreeFilterFn = (type) =>
  type !== null &&
  type !== undefined &&
  type !== "chat" &&
  type !== "terminal" &&
  type !== "terminal-agent";

export type ArtifactUnreadMarkerVariant = "self" | "descendant";

interface ArtifactDescendantEntry {
  readonly id: string;
  readonly updatedAt: number;
}

interface ArtifactReadTarget {
  readonly id: string;
  readonly updatedAt: number;
}

const EMPTY_DESCENDANT_ENTRIES: ReadonlyArray<ArtifactDescendantEntry> = [];

export function useArtifactPanelRootIds(
  comparator: NodeComparator | null,
): ReadonlyArray<string> {
  const yDocRootIds = useRootIds();
  // Filter roots by the TREE node's type, not the projected artifact records.
  // `useEpicArtifactRecords()` rebuilds a fresh record array (and fresh record
  // objects) on every store tick, so during chat streaming the active chat's
  // record changes identity each token and `liveRecords` churns - which used to
  // recompute this memo, churn `rootIds` -> `expandedIds` -> the `expansion`
  // controller, and re-render every memoized `ArtifactNode`. The tree index
  // (`s.tree`) does NOT change on chat tokens, and its `nodeById[id].type` is
  // the same value space this `treeFilter` already uses for CHILD nodes
  // (`usePanelChildIds`), so the result is identical but identity-stable while
  // streaming.
  const tree = useEpicTreeIndex();
  return useMemo(() => {
    const treeFilter = ARTIFACTS_TREE_FILTER;
    const roots = yDocRootIds.filter(
      (rootId) =>
        Object.hasOwn(tree.nodeById, rootId) &&
        treeFilter(tree.nodeById[rootId].type),
    );
    // `yDocRootIds` is in projector (default) order; re-sort only for a
    // non-default mode (`comparator !== null`).
    return sortNodeIds(roots, tree.nodeById, comparator);
  }, [tree, yDocRootIds, comparator]);
}

/**
 * Visible-id set for an active artifact filter (status / kind / read), expanded
 * to include ancestors so a matched ticket nested under a spec stays reachable.
 * Status and read are evaluated only against artifacts that carry them; specs
 * and reviews (status `null`, never assignable) drop out whenever a status or
 * kind constraint excludes them. `null` when no filter is active.
 */
export function useArtifactVisibleIds(
  epicId: string,
): ReadonlySet<string> | null {
  const filter = useArtifactFilter(epicId);
  const artifacts = useEpicStore((s) => s.artifacts);
  const tree = useEpicTreeIndex();
  const readState = useArtifactReadStateStore(
    useShallow((s) => ({
      seedAtByEpic: s.seedAtByEpic,
      lastSeenByArtifact: s.lastSeenByArtifact,
    })),
  );
  return useMemo(() => {
    if (!isArtifactFilterActive(filter)) return null;
    const statusSet = new Set<number>(filter.statuses);
    const kindSet = new Set<string>(filter.kinds);
    const matches: string[] = [];
    for (const id of artifacts.allIds) {
      if (!Object.hasOwn(artifacts.byId, id)) continue;
      const artifact = artifacts.byId[id];
      if (kindSet.size > 0 && !kindSet.has(artifact.kind)) continue;
      if (
        statusSet.size > 0 &&
        (artifact.status === null || !statusSet.has(artifact.status))
      ) {
        continue;
      }
      if (filter.read !== "all") {
        const unread = isArtifactUnread({
          epicId,
          artifactId: artifact.id,
          updatedAt: artifact.updatedAt,
          seedAtByEpic: readState.seedAtByEpic,
          lastSeenByArtifact: readState.lastSeenByArtifact,
        });
        if (filter.read === "unread" && !unread) continue;
        if (filter.read === "read" && unread) continue;
      }
      matches.push(artifact.id);
    }
    return collectWithAncestors(matches, tree.nodeById);
  }, [filter, artifacts, tree, readState, epicId]);
}

/**
 * Collect the artifact-kind descendants of `nodeId` (id + version) so a
 * collapsed parent can roll up "contains unread artifacts" without mounting its
 * children. When a filter is active (`visibleIds !== null`), descendants hidden
 * by the filter are skipped along with their subtree - the rollup must never
 * point at a child the user cannot reach by expanding. Cycle-guarded via
 * `visited`.
 */
function collectDescendantArtifactEntries(
  nodeId: string,
  tree: TreeSlice,
  visibleIds: ReadonlySet<string> | null,
): ReadonlyArray<ArtifactDescendantEntry> {
  const rootChildren = Object.hasOwn(tree.childrenByParent, nodeId)
    ? tree.childrenByParent[nodeId]
    : null;
  if (rootChildren === null || rootChildren.length === 0) {
    return EMPTY_DESCENDANT_ENTRIES;
  }
  const entries: ArtifactDescendantEntry[] = [];
  const visited = new Set<string>([nodeId]);
  const stack = [...rootChildren];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || visited.has(id)) continue;
    visited.add(id);
    // A filtered-out node has no visible descendants (the visible set is
    // matches plus their ancestors), so skip its whole subtree.
    if (visibleIds !== null && !visibleIds.has(id)) continue;
    if (!Object.hasOwn(tree.nodeById, id)) continue;
    const node = tree.nodeById[id];
    if (isEpicArtifactKind(node.type)) {
      entries.push({ id, updatedAt: node.updatedAt });
    }
    if (Object.hasOwn(tree.childrenByParent, id)) {
      for (const childId of tree.childrenByParent[id]) stack.push(childId);
    }
  }
  return entries;
}

/**
 * Per-node unread marker variant, subscribed narrowly so marking one artifact
 * read re-renders only the affected row and its collapsed ancestors - never the
 * whole tree. The read-state selector returns a scalar variant, so Zustand
 * bails the render for any node whose variant did not flip. Returns:
 *   - "self": this artifact itself has unread changes.
 *   - "descendant": this collapsed parent hides unread artifacts.
 *   - null: nothing to show (non-artifact row, or expanded parent with no self
 *     unread).
 * This mirrors the per-entity `useIsActive...` pattern instead of threading a
 * tab-wide map through the recursive node tree.
 */
export function useArtifactUnreadMarkerVariant(args: {
  readonly epicId: string;
  readonly nodeId: string;
  readonly isArtifactKind: boolean;
  readonly expanded: boolean;
  readonly selfUpdatedAt: number;
  readonly tree: TreeSlice;
}): ArtifactUnreadMarkerVariant | null {
  const { epicId, nodeId, isArtifactKind, expanded, selfUpdatedAt, tree } =
    args;
  const visibleIds = useSidebarVisibleIds();
  const descendantEntries = useMemo(
    () =>
      !isArtifactKind || expanded
        ? EMPTY_DESCENDANT_ENTRIES
        : collectDescendantArtifactEntries(nodeId, tree, visibleIds),
    [isArtifactKind, expanded, nodeId, tree, visibleIds],
  );
  return useArtifactReadStateStore((state) => {
    if (!isArtifactKind) return null;
    if (
      isArtifactUnread({
        epicId,
        artifactId: nodeId,
        updatedAt: selfUpdatedAt,
        seedAtByEpic: state.seedAtByEpic,
        lastSeenByArtifact: state.lastSeenByArtifact,
      })
    ) {
      return "self";
    }
    for (const entry of descendantEntries) {
      if (
        isArtifactUnread({
          epicId,
          artifactId: entry.id,
          updatedAt: entry.updatedAt,
          seedAtByEpic: state.seedAtByEpic,
          lastSeenByArtifact: state.lastSeenByArtifact,
        })
      ) {
        return "descendant";
      }
    }
    return null;
  });
}

/**
 * Every artifact in the epic that currently reads as unread, with the version
 * that would mark it read - the input to a panel's "Mark all as read".
 *
 * Derived from the tree index rather than `useEpicArtifactRecords()` for the
 * reason {@link useArtifactPanelRootIds} documents: that array is rebuilt, with
 * fresh record objects, on every store tick, so a streaming chat re-ran this
 * whole scan per token. `nodeById` is built from the same artifact entries and
 * carries the same `type` and `updatedAt`, and is identity-stable while
 * streaming.
 */
export function useUnreadArtifactReadTargets(
  epicId: string,
): ReadonlyArray<ArtifactReadTarget> {
  const tree = useEpicTreeIndex();
  const readState = useArtifactReadStateStore(
    useShallow((s) => ({
      seedAtByEpic: s.seedAtByEpic,
      lastSeenByArtifact: s.lastSeenByArtifact,
    })),
  );
  return useMemo(
    () =>
      Object.values(tree.nodeById).flatMap((node) => {
        if (!isEpicArtifactKind(node.type)) return [];
        return isArtifactUnread({
          epicId,
          artifactId: node.id,
          updatedAt: node.updatedAt,
          seedAtByEpic: readState.seedAtByEpic,
          lastSeenByArtifact: readState.lastSeenByArtifact,
        })
          ? [{ id: node.id, updatedAt: node.updatedAt }]
          : [];
      }),
    [epicId, readState, tree],
  );
}
