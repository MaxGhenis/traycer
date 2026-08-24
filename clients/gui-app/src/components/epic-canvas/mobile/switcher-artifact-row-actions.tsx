import { Pencil, Trash2 } from "lucide-react";
import type { SidebarRowMenuEntry } from "@/components/epic-canvas/sidebar/sidebar-row-menu-items";
import { useArtifactExportMenuEntries } from "@/components/epic-canvas/sidebar/artifact-export-menu-entries";
import { SwitcherRowMenu } from "@/components/epic-canvas/mobile/switcher-row-menu";
import { useSwitcherRowActions } from "@/components/epic-canvas/mobile/use-switcher-row-actions";
import { useEpicPermissionRole } from "@/lib/epic-selectors";
import { isEditableRole } from "@/lib/epic-permissions";

/**
 * The per-row "…" actions for the switcher's artifact tree: the two desktop
 * export entries, then Rename and a confirmed Delete. Reuses the exact desktop
 * mutation hooks and the shared row-menu item renderer.
 *
 * The mutations are editor-gated, so a viewer sees no dead-end rename/delete.
 * The exports are NOT - they read, exactly as the desktop artifact row's menu
 * offers them to a viewer - so an artifact row keeps its menu for a viewer with
 * the two export entries alone. The separator that joins the two groups belongs
 * to neither: it exists only when the gated group does, so that export-only
 * menu has no dangling rule.
 *
 * Delete also closes the artifact's open canvas tile so the mobile view never
 * lands on a dead tile.
 *
 * Agent and terminal rows carry their own menus - see `SwitcherAgentRowActions`
 * and `SwitcherTerminalRowActions`.
 */
export function SwitcherArtifactRowActions(props: {
  readonly epicId: string;
  readonly tabId: string;
  /** The artifact's node id. */
  readonly nodeId: string;
  readonly name: string;
  /** "… and N nested" summary for a cascading delete; null when none. */
  readonly cascadeSummary: string | null;
}) {
  const { epicId, tabId, nodeId, name, cascadeSummary } = props;
  const canMutate = isEditableRole(useEpicPermissionRole());
  const state = useSwitcherRowActions({
    epicId,
    tabId,
    kind: "artifact",
    nodeId,
  });
  const exportEntries = useArtifactExportMenuEntries({
    nodeId,
    nodeName: name,
    testIdPrefix: "switcher",
  });

  const mutateEntries: ReadonlyArray<SidebarRowMenuEntry> = canMutate
    ? [
        { kind: "separator", id: "after-export" },
        {
          kind: "item",
          id: "rename",
          label: "Rename",
          icon: <Pencil className="size-3.5" />,
          disabled: false,
          disabledTooltip: null,
          variant: "default",
          testIds: {
            dropdown: `switcher-rename-${nodeId}`,
            context: `switcher-rename-ctx-${nodeId}`,
          },
          onSelect: state.openRename,
        },
        { kind: "separator", id: "before-delete" },
        {
          kind: "item",
          id: "delete",
          label: "Delete",
          icon: <Trash2 className="size-3.5" />,
          disabled: false,
          disabledTooltip: null,
          variant: "destructive",
          testIds: {
            dropdown: `switcher-delete-${nodeId}`,
            context: `switcher-delete-ctx-${nodeId}`,
          },
          onSelect: state.requestDelete,
        },
      ]
    : [];

  return (
    <SwitcherRowMenu
      nodeId={nodeId}
      name={name}
      renameTitle="Rename artifact"
      entries={[...exportEntries, ...mutateEntries]}
      state={state}
      confirmDescription="This permanently deletes the artifact."
      cascadeSummary={cascadeSummary}
    />
  );
}
