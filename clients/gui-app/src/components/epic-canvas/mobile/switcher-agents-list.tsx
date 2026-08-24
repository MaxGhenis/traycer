import { createContext, useCallback, useContext, useMemo } from "react";
import { Users } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { SwitcherAgentIcon } from "@/components/epic-canvas/mobile/switcher-agent-icon";
import {
  SwitcherListEmpty,
  SwitcherListRow,
} from "@/components/epic-canvas/mobile/switcher-list-row";
import {
  SwitcherAgentRowActions,
  type SwitcherAgentKind,
} from "@/components/epic-canvas/mobile/switcher-agent-row-actions";
import { SwitcherNewChatRow } from "@/components/epic-canvas/mobile/switcher-create-actions";
import { useSwitcherActivate } from "@/components/epic-canvas/mobile/use-switcher-activate";
import {
  ArchivedTitlePrefix,
  ChatRowIdleTime,
  ChatRowMenuFactsProvider,
} from "@/components/epic-canvas/sidebar/chat-row-chrome";
import { useChatRowSharing } from "@/components/epic-canvas/sidebar/chat-row-menu";
import {
  CHATS_TREE_FILTER,
  sidebarTreeRootIds,
} from "@/components/epic-canvas/sidebar/epic-sidebar-selection";
import { useFilteredPanelChildIds } from "@/components/epic-canvas/sidebar/epic-sidebar-filter";
import {
  useAncestorIds,
  useEpicNodeArchived,
  useEpicNodeHostId,
  useEpicNodeUpdatedAt,
  useEpicPermissionRole,
  useEpicTreeIndex,
  useEpicTreeNode,
  type EpicTreeIndex,
} from "@/lib/epic-selectors";
import { isEditableRole } from "@/lib/epic-permissions";
import { UNKNOWN_HOST_PLACEHOLDER } from "@/lib/host/constants";
import {
  computeDescendantCountsFromTree,
  formatCascadeSummary,
} from "@/lib/epic-tree-cascade";
import {
  useActiveEpicArtifactId,
  useIsActiveEpicArtifact,
} from "@/stores/epics/canvas/store";
import {
  useEpicSidebarEffectiveExpanded,
  useEpicSidebarExpansionStore,
} from "@/stores/epics/epic-sidebar-expansion-store";
import {
  isOpenableEpicNodeKind,
  makeOpenableNodeRef,
} from "@/stores/epics/canvas/types";
import { NotificationIndicatorsProvider } from "@/components/notifications/notification-indicators-provider";
import { useNotificationIndicators } from "@/hooks/notifications/use-notification-indicators-query";
import { useEpicSessionHostId } from "@/hooks/epic/use-epic-session-host-id";

interface SwitcherListProps {
  readonly epicId: string;
  readonly tabId: string;
  readonly onClose: () => void;
}

/** The panel scope the expansion store keys this tree by - the same one the
 *  desktop chats panel uses, so a subtree the user opened on one surface is
 *  open on the other for as long as the tab lives. */
const AGENTS_PANEL_ID = "chats";

interface SwitcherAgentTreeValue {
  readonly epicId: string;
  readonly tabId: string;
  readonly onClose: () => void;
  /**
   * The tree index, for a row's delete-cascade copy. NOT the flat record array:
   * `useEpicArtifactRecords()` returns fresh records on every store tick, so
   * during chat streaming it churns identity each token and would re-render
   * every row in this tree through this very context. The index carries the
   * same structure and does not change on chat tokens.
   */
  readonly tree: EpicTreeIndex;
  /**
   * The Epic session's host: the fallback for a row whose projection carries no
   * owner of its own, exactly as the desktop chat tree resolves it.
   */
  readonly sessionHostId: string | null;
  readonly expandedIds: ReadonlySet<string>;
  readonly canMutate: boolean;
}

/**
 * List-scoped values every node in the recursion needs. A context rather than
 * six props threaded through each level: nothing here varies per node, and the
 * recursion is otherwise a plain `nodeId` + `depth` walk.
 */
const SwitcherAgentTreeContext = createContext<SwitcherAgentTreeValue | null>(
  null,
);

function useSwitcherAgentTree(): SwitcherAgentTreeValue {
  const value = useContext(SwitcherAgentTreeContext);
  if (value === null) {
    throw new Error("SwitcherAgentNode rendered outside its tree provider");
  }
  return value;
}

/**
 * Agents category: GUI chats and TUI agents as the TREE they are, walked from
 * the same projector index and through the same child-id hook the desktop
 * sidebar walks - `rootIds` then `useFilteredPanelChildIds` per level, so a
 * child sits under its parent and siblings order by recency WITHIN their
 * bucket. A flat recency list put a child anywhere but next to its parent, and
 * nesting is how this product expresses which agent spawned which.
 *
 * What differs from the sidebar is the row, not the walk: 44px touch rows, a
 * real chevron button instead of a hover glyph, and none of the desktop tree's
 * dnd, bulk selection or rename-in-place machinery.
 *
 * Archived agents are listed here, marked, rather than hidden: the sheet has no
 * archive filter to reveal them again, so hiding them would make an archived
 * agent unreachable from a phone.
 */
export function SwitcherAgentsList(props: SwitcherListProps) {
  const { epicId, tabId, onClose } = props;
  const tree = useEpicTreeIndex();
  const canMutate = isEditableRole(useEpicPermissionRole());

  // Projector order (`comparator: null`) is last-updated desc, which is the
  // desktop panel's default sort - applied per sibling bucket by construction.
  const rootIds = useMemo(
    () =>
      sidebarTreeRootIds({
        tree,
        treeFilter: CHATS_TREE_FILTER,
        comparator: null,
      }),
    [tree],
  );
  const activeArtifactId = useActiveEpicArtifactId(tabId);
  const ancestorIds = useAncestorIds(activeArtifactId);
  // Roots and the open tile's ancestors are expanded implicitly, so the tree
  // opens on the levels the user is actually working in and the rest stays
  // collapsed behind its chevron.
  const expandedIds = useEpicSidebarEffectiveExpanded(
    tabId,
    AGENTS_PANEL_ID,
    rootIds,
    ancestorIds,
  );

  // Sorted for a stable query key: an order-sensitive key would refetch on
  // every turn without the set having changed. Taken from the whole tree index
  // rather than the rendered rows - a collapsed subtree's agents still own the
  // status their ancestor has to be able to stand for.
  const indicatorChatIds = useMemo(
    () =>
      Object.keys(tree.nodeById)
        .filter((id) => CHATS_TREE_FILTER(tree.nodeById[id].type))
        .sort(),
    [tree],
  );
  // The rows' status glyphs read notification state out of this context. Scoped
  // to the EPIC SESSION host for the same reason the desktop chat tree is:
  // these agents are this session's, `chatId` is host-minted, and the app-wide
  // active host would answer about agents it does not own.
  const epicSessionHostId = useEpicSessionHostId();
  const indicators = useNotificationIndicators({
    hostId: epicSessionHostId,
    epicIds: [],
    chatIds: indicatorChatIds,
    enabled: indicatorChatIds.length > 0,
  });

  const value = useMemo<SwitcherAgentTreeValue>(
    () => ({
      epicId,
      tabId,
      onClose,
      tree,
      sessionHostId: epicSessionHostId,
      expandedIds,
      canMutate,
    }),
    [epicId, tabId, onClose, tree, epicSessionHostId, expandedIds, canMutate],
  );

  return (
    <NotificationIndicatorsProvider indicators={indicators}>
      <ChatRowMenuFactsProvider epicId={epicId}>
        <SwitcherAgentTreeContext.Provider value={value}>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto overscroll-contain p-1 pb-safe-bottom">
            {/* Editor-gated: a viewer's create is server-rejected, so an
                ungated row would only lead to a dead end. Inside the scroll
                region and above the items, so it is the first thing in the list
                either way. */}
            {canMutate ? (
              <SwitcherNewChatRow
                epicId={epicId}
                tabId={tabId}
                onClose={onClose}
              />
            ) : null}
            {rootIds.length === 0 ? (
              <SwitcherListEmpty message="No agents yet." />
            ) : (
              rootIds.map((nodeId) => (
                <SwitcherAgentNode key={nodeId} nodeId={nodeId} depth={0} />
              ))
            )}
          </div>
        </SwitcherAgentTreeContext.Provider>
      </ChatRowMenuFactsProvider>
    </NotificationIndicatorsProvider>
  );
}

/** One node and, while expanded, its children - the whole recursion. */
function SwitcherAgentNode(props: {
  readonly nodeId: string;
  readonly depth: number;
}) {
  const { nodeId, depth } = props;
  const { tabId, expandedIds } = useSwitcherAgentTree();
  const node = useEpicTreeNode(nodeId);
  const childIds = useFilteredPanelChildIds(nodeId, CHATS_TREE_FILTER);
  const expand = useEpicSidebarExpansionStore((s) => s.expand);
  const collapse = useEpicSidebarExpansionStore((s) => s.collapse);
  const expanded = expandedIds.has(nodeId);
  const onToggle = useCallback(() => {
    if (expanded) collapse(tabId, AGENTS_PANEL_ID, nodeId);
    else expand(tabId, AGENTS_PANEL_ID, nodeId);
  }, [collapse, expand, expanded, nodeId, tabId]);

  // A node the projection dropped between the parent's child list and this
  // render has nothing to draw and no children left to reach.
  if (node === null) return null;

  return (
    <>
      <SwitcherAgentRow
        nodeId={nodeId}
        name={node.title}
        type={node.type === "terminal-agent" ? "terminal-agent" : "chat"}
        depth={depth}
        hasChildren={childIds.length > 0}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded
        ? childIds.map((childId) => (
            <SwitcherAgentNode
              key={childId}
              nodeId={childId}
              depth={depth + 1}
            />
          ))
        : null}
    </>
  );
}

function SwitcherAgentRow(props: {
  readonly nodeId: string;
  readonly name: string;
  readonly type: SwitcherAgentKind;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const { nodeId, name, type, depth, hasChildren, expanded, onToggle } = props;
  const { epicId, tabId, onClose, tree, sessionHostId, canMutate } =
    useSwitcherAgentTree();
  const activate = useSwitcherActivate(epicId, tabId, onClose);
  const isActive = useIsActiveEpicArtifact(tabId, nodeId);
  const isArchived = useEpicNodeArchived(nodeId);
  // Read from the PROJECTION, not the tree node - the tree node's `updatedAt`
  // is a lagging copy, and using it made the desktop row disagree with its own
  // hover card.
  const updatedAt = useEpicNodeUpdatedAt(nodeId);
  const sharing = useChatRowSharing(epicId, nodeId, type, canMutate);

  // The host the opened tile BINDS TO, and a tab's host binding is for life -
  // so this has to be the row's owner, exactly as the desktop row resolves it.
  // The chat projection carries one once it has been re-pointed; only TUI rows
  // carry one from the start.
  //
  // The fallback covers a legacy chat with no projected host of its own: the
  // Epic SESSION's host, the machine that projected the row, never the app-wide
  // addressable one - which during an A->B re-point is a different machine from
  // the one these rows came from. That is the desktop chat tree's rule verbatim,
  // and it is also what the flat projection would have stamped on such a record,
  // since `useEpicArtifactRecords` seeds them from the same
  // `getEpicSessionHandleHostId(handle)`. The placeholder is the last resort for
  // a node with neither; it is not dialable, and neither is anything else that
  // could stand in for it.
  const ownerHostId = useEpicNodeHostId(nodeId);
  const openHostId = ownerHostId ?? sessionHostId ?? UNKNOWN_HOST_PLACEHOLDER;

  // Walked from the tree index, memoized on it: the counts are only read when
  // the row's delete confirm opens, and an un-memoized walk here would be
  // O(rows x nodes) on every render of the list.
  const cascadeSummary = useMemo(
    () => formatCascadeSummary(computeDescendantCountsFromTree(tree, nodeId)),
    [tree, nodeId],
  );

  const onSelect = useCallback(() => {
    if (!isOpenableEpicNodeKind(type)) return;
    activate(nodeId, () =>
      makeOpenableNodeRef({
        id: nodeId,
        instanceId: uuidv4(),
        type,
        name,
        hostId: openHostId,
      }),
    );
  }, [activate, name, nodeId, openHostId, type]);

  return (
    <SwitcherListRow
      icon={
        // No host prop: the icon resolves the row's owner host itself, from the
        // same selector `ownerHostId` above uses.
        <SwitcherAgentIcon epicId={epicId} nodeId={nodeId} type={type} />
      }
      label={name}
      labelPrefix={isArchived ? <ArchivedTitlePrefix /> : null}
      secondaryLabel={null}
      badge={null}
      trailing={
        <span className="flex flex-none items-center gap-1.5">
          {sharing.showIndicator ? (
            // The desktop glyph carries a hover tooltip; a phone row has no
            // hover, so the meaning rides its accessible name instead.
            <Users
              className="size-3 shrink-0 text-muted-foreground"
              data-testid={`switcher-shared-${nodeId}`}
              // `role` is explicit: lucide drops its default `aria-hidden` once
              // any a11y prop is passed, and a bare labelled <svg> maps to
              // `graphics-document` rather than an image, so the label reaches
              // assistive technology inconsistently without it.
              role="img"
              aria-label="Shared with task"
            />
          ) : null}
          <ChatRowIdleTime updatedAt={updatedAt} />
        </span>
      }
      nesting={{ depth, hasChildren, expanded, onToggle }}
      active={isActive}
      onSelect={onSelect}
      selectTestId={`switcher-agent-row-${nodeId}`}
      actions={
        <SwitcherAgentRowActions
          epicId={epicId}
          tabId={tabId}
          nodeId={nodeId}
          name={name}
          artifactType={type}
          ownerHostId={ownerHostId}
          cascadeSummary={cascadeSummary}
          onClose={onClose}
        />
      }
    />
  );
}
