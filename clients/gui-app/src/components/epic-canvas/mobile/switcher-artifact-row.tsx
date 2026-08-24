import { useCallback, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import type { EpicArtifactKind } from "@traycer/protocol/common/registry";
import { AgentSpinningDots } from "@/components/ui/agent-spinning-dots";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SwitcherListRow } from "@/components/epic-canvas/mobile/switcher-list-row";
import type { SwitcherRowNesting } from "@/components/epic-canvas/mobile/switcher-row-nesting";
import { SwitcherArtifactKindItems } from "@/components/epic-canvas/mobile/switcher-create-actions";
import { SwitcherArtifactRowActions } from "@/components/epic-canvas/mobile/switcher-artifact-row-actions";
import { useSwitcherActivate } from "@/components/epic-canvas/mobile/use-switcher-activate";
import { useSwitcherCreateArtifact } from "@/components/epic-canvas/mobile/use-switcher-create-artifact";
import { ArtifactUnreadMarker } from "@/components/epic-canvas/sidebar/epic-sidebar-artifact-tree";
import {
  ARTIFACTS_TREE_FILTER,
  useArtifactUnreadMarkerVariant,
} from "@/components/epic-canvas/sidebar/epic-sidebar-artifact-shared";
import { useFilteredPanelChildIds } from "@/components/epic-canvas/sidebar/epic-sidebar-filter";
import {
  STATUS_DOT_CLASSES,
  STATUS_LABELS,
  computeArtifactNodeStatusDot,
} from "@/components/epic-canvas/sidebar/epic-sidebar-tree-shared";
import {
  EPIC_NODE_ICONS,
  isEpicArtifactKind,
  type EpicNodeKind,
} from "@/lib/artifacts/node-display";
import {
  computeDescendantCountsFromTree,
  formatCascadeSummary,
} from "@/lib/epic-tree-cascade";
import {
  useEpicArtifactStatus,
  useEpicTreeIndex,
  useEpicTreeNode,
} from "@/lib/epic-selectors";
import { useEpicSessionHostId } from "@/hooks/epic/use-epic-session-host-id";
import { UNKNOWN_HOST_PLACEHOLDER } from "@/lib/host/constants";
import { useIsActiveEpicArtifact } from "@/stores/epics/canvas/canvas-selectors";
import {
  isOpenableEpicNodeKind,
  makeOpenableNodeRef,
} from "@/stores/epics/canvas/types";
import { cn } from "@/lib/utils";

/**
 * Expansion wiring handed down the tree, so every level toggles through the one
 * store scope the desktop panel uses (`tabId` + `artifacts`) instead of holding
 * per-row local state that a re-mounted sheet would forget.
 */
export interface SwitcherExpansionController {
  readonly expandedIds: ReadonlySet<string>;
  readonly toggleExpanded: (id: string) => void;
  readonly ensureExpanded: (id: string) => void;
}

interface SwitcherArtifactNodeProps {
  readonly epicId: string;
  readonly tabId: string;
  readonly nodeId: string;
  readonly depth: number;
  readonly expansion: SwitcherExpansionController;
  readonly canMutate: boolean;
  readonly onClose: () => void;
}

/**
 * One artifact in the switcher's tree, plus its expanded children.
 *
 * The desktop `ArtifactNode` is not mountable here - it is welded to dnd-kit
 * dragging, hover-reveal controls and 28px rows, none of which survive a touch
 * surface. What IS shared is everything above presentation: the same tree
 * selectors (`useEpicTreeNode` + `useFilteredPanelChildIds`), the same
 * per-sibling ordering and visibility filtering through the sidebar filter
 * contexts, the same unread-marker derivation, the same status-dot rule, and
 * the same create/rename/delete/export mutations.
 *
 * The touch geometry - 44px rows, the indent step, a chevron with a tap target
 * of its own - is `SwitcherListRow`'s, shared with every other category, so the
 * artifacts tree cannot drift from the agents tree it sits beside.
 */
export function SwitcherArtifactNode(props: SwitcherArtifactNodeProps) {
  const { epicId, tabId, nodeId, depth, expansion, canMutate, onClose } = props;
  const node = useEpicTreeNode(nodeId);
  const childIds = useFilteredPanelChildIds(nodeId, ARTIFACTS_TREE_FILTER);
  const tree = useEpicTreeIndex();
  const statusValue = useEpicArtifactStatus(nodeId);
  const isActive = useIsActiveEpicArtifact(tabId, nodeId);
  const activate = useSwitcherActivate(epicId, tabId, onClose);
  const activeHostId = useEpicSessionHostId() ?? UNKNOWN_HOST_PLACEHOLDER;

  const expanded = expansion.expandedIds.has(nodeId);
  const hasChildren = childIds.length > 0;
  const artifactType: EpicNodeKind = node?.type ?? "spec";
  const nodeName = node?.title ?? "";

  const unreadMarkerVariant = useArtifactUnreadMarkerVariant({
    epicId,
    nodeId,
    isArtifactKind: isEpicArtifactKind(artifactType),
    expanded,
    selfUpdatedAt: node?.updatedAt ?? 0,
    tree,
  });

  const onSelect = useCallback(() => {
    if (!isOpenableEpicNodeKind(artifactType)) return;
    activate(nodeId, () =>
      makeOpenableNodeRef({
        id: nodeId,
        instanceId: uuidv4(),
        type: artifactType,
        name: nodeName,
        hostId: activeHostId,
      }),
    );
  }, [activate, activeHostId, artifactType, nodeId, nodeName]);

  const onToggle = useCallback(() => {
    expansion.toggleExpanded(nodeId);
  }, [expansion, nodeId]);

  const cascadeSummary = useMemo(
    () => formatCascadeSummary(computeDescendantCountsFromTree(tree, nodeId)),
    [tree, nodeId],
  );
  const nesting = useMemo<SwitcherRowNesting>(
    () => ({ depth, hasChildren, expanded, onToggle }),
    [depth, hasChildren, expanded, onToggle],
  );

  if (node === null) return null;
  if (!ARTIFACTS_TREE_FILTER(node.type)) return null;

  return (
    <li
      role="treeitem"
      aria-selected={isActive}
      aria-expanded={hasChildren ? expanded : undefined}
    >
      <SwitcherListRow
        labelPrefix={
          <ArtifactUnreadMarker nodeId={nodeId} variant={unreadMarkerVariant} />
        }
        secondaryLabel={null}
        badge={null}
        trailing={null}
        nesting={nesting}
        icon={<SwitcherArtifactIcon type={artifactType} status={statusValue} />}
        label={nodeName}
        active={isActive}
        onSelect={onSelect}
        selectTestId={`switcher-artifact-row-${nodeId}`}
        actions={
          <>
            {canMutate ? (
              <SwitcherArtifactAddChildMenu
                epicId={epicId}
                tabId={tabId}
                parentId={nodeId}
                parentName={nodeName}
                onExpandParent={expansion.ensureExpanded}
                onClose={onClose}
              />
            ) : null}
            <SwitcherArtifactRowActions
              epicId={epicId}
              tabId={tabId}
              nodeId={nodeId}
              name={nodeName}
              cascadeSummary={cascadeSummary}
            />
          </>
        }
      />
      {hasChildren && expanded ? (
        <ul role="group">
          {childIds.map((childId) => (
            <SwitcherArtifactNode
              key={childId}
              epicId={epicId}
              tabId={tabId}
              nodeId={childId}
              depth={depth + 1}
              expansion={expansion}
              canMutate={canMutate}
              onClose={onClose}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Type glyph with the desktop status dot overlaid. The dot carries its status
 * as an accessible name rather than desktop's hover tooltip, which a touch
 * surface can never open - so the row announces "Ticket One, In Progress" and
 * colour stops being the only carrier of the signal.
 */
export function SwitcherArtifactIcon(props: {
  readonly type: EpicNodeKind;
  readonly status: number | null;
}) {
  const { type, status } = props;
  const Icon = EPIC_NODE_ICONS[type];
  const showDot = computeArtifactNodeStatusDot(type, status);
  return (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
      <Icon aria-hidden className="size-4 text-muted-foreground" />
      {showDot && status !== null ? (
        <span
          role="img"
          aria-label={STATUS_LABELS[status] ?? "Unknown"}
          className={cn(
            "absolute -right-1 -bottom-1 size-1.5 rounded-full ring-1 ring-popover",
            STATUS_DOT_CLASSES[status],
          )}
        />
      ) : null}
    </span>
  );
}

/**
 * The row's "add child artifact" menu - desktop's hover-revealed "+" as a
 * permanent control, since a phone row has no rest state to reveal from. Any
 * artifact can parent any kind, so the menu is the same four entries the
 * category's own "+" offers; creating expands the parent first so the new child
 * is not filed somewhere the user cannot see.
 */
function SwitcherArtifactAddChildMenu(props: {
  readonly epicId: string;
  readonly tabId: string;
  readonly parentId: string;
  readonly parentName: string;
  readonly onExpandParent: (id: string) => void;
  readonly onClose: () => void;
}) {
  const { epicId, tabId, parentId, parentName, onExpandParent, onClose } =
    props;
  const [open, setOpen] = useState(false);
  const { create, isPending } = useSwitcherCreateArtifact(
    epicId,
    tabId,
    onClose,
  );
  const addChild = useCallback(
    (kind: EpicArtifactKind) => {
      onExpandParent(parentId);
      create(kind, parentId);
    },
    [create, onExpandParent, parentId],
  );
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Add child artifact to ${parentName}`}
          data-testid={`switcher-add-child-${parentId}`}
          disabled={isPending}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {isPending ? (
            <AgentSpinningDots
              className="size-4"
              testId={undefined}
              variant="dots2"
            />
          ) : (
            <Plus className="size-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <SwitcherArtifactKindItems
          testIdPrefix={`switcher-add-child-${parentId}`}
          onSelect={addChild}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
