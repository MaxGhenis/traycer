import { FileDown, Pencil, Trash2 } from "lucide-react";
import { AgentSpinningDots } from "@/components/ui/agent-spinning-dots";
import type { SidebarRowMenuEntry } from "@/components/epic-canvas/sidebar/sidebar-row-menu-items";
import { SwitcherRowMenu } from "@/components/epic-canvas/mobile/switcher-row-menu";
import { useSwitcherRowActions } from "@/components/epic-canvas/mobile/use-switcher-row-actions";
import { useEpicPermissionRole } from "@/lib/epic-selectors";
import { isEditableRole } from "@/lib/epic-permissions";
import { useEpicExportArtifacts } from "@/hooks/epic/use-epic-export-artifacts-mutation";

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
  const exportArtifacts = useEpicExportArtifacts();

  const exportOne = (format: "markdown" | "pdf"): void => {
    exportArtifacts.mutate({
      artifacts: [{ id: nodeId, title: name }],
      format,
      archive: false,
      archiveTitle: null,
    });
  };
  const exportIcon = exportArtifacts.isPending ? (
    <AgentSpinningDots
      className={undefined}
      testId={undefined}
      variant={undefined}
    />
  ) : (
    <FileDown className="size-3.5" />
  );
  const exportEntries: ReadonlyArray<SidebarRowMenuEntry> = [
    {
      kind: "item",
      id: "export-markdown",
      label: "Export as Markdown",
      icon: exportIcon,
      disabled: exportArtifacts.isPending,
      disabledTooltip: null,
      variant: "default",
      testIds: {
        dropdown: `switcher-export-markdown-${nodeId}`,
        context: `switcher-export-markdown-ctx-${nodeId}`,
      },
      onSelect: () => exportOne("markdown"),
    },
    {
      kind: "item",
      id: "export-pdf",
      label: "Export as PDF",
      icon: exportIcon,
      disabled: exportArtifacts.isPending,
      disabledTooltip: null,
      variant: "default",
      testIds: {
        dropdown: `switcher-export-pdf-${nodeId}`,
        context: `switcher-export-pdf-ctx-${nodeId}`,
      },
      onSelect: () => exportOne("pdf"),
    },
  ];

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
