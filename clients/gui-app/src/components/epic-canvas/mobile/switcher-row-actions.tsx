import { FileDown, Pencil, Trash2 } from "lucide-react";
import { AgentSpinningDots } from "@/components/ui/agent-spinning-dots";
import type { SidebarRowMenuEntry } from "@/components/epic-canvas/sidebar/sidebar-row-menu-items";
import { SwitcherRowMenu } from "@/components/epic-canvas/mobile/switcher-row-menu";
import { useSwitcherRowActions } from "@/components/epic-canvas/mobile/use-switcher-row-actions";
import type { SwitcherRowKind } from "@/components/epic-canvas/mobile/use-switcher-rename";
import { useEpicPermissionRole } from "@/lib/epic-selectors";
import { isEditableRole } from "@/lib/epic-permissions";
import { useEpicExportArtifacts } from "@/hooks/epic/use-epic-export-artifacts-mutation";

interface SwitcherRowActionsProps {
  readonly epicId: string;
  readonly tabId: string;
  readonly kind: Extract<SwitcherRowKind, "artifact" | "terminal">;
  /** Content id: the node id for an artifact, the session id for a PTY. */
  readonly nodeId: string;
  readonly name: string;
  /** "… and N nested" summary for a cascading delete; null when none / N/A. */
  readonly cascadeSummary: string | null;
}

const RENAME_TITLE: Record<
  Extract<SwitcherRowKind, "artifact" | "terminal">,
  string
> = {
  artifact: "Rename artifact",
  terminal: "Rename terminal",
};

const NO_LEADING_ENTRIES: ReadonlyArray<SidebarRowMenuEntry> = [];

/**
 * The per-row "…" actions for the switcher's artifact and terminal lists:
 * Export + Rename + Delete for artifacts (delete confirmed), Rename + Close for
 * PTY terminals (Close is immediate, matching desktop parity). Agent rows carry
 * the full chat-row menu instead - see `SwitcherAgentRowActions`.
 *
 * Reuses the exact desktop mutation hooks and the shared row-menu item
 * renderer. Mutations are editor-gated, so a viewer sees no dead-end
 * rename/delete. The artifact exports are NOT - they read, exactly as the
 * desktop artifact row's menu offers them to a viewer - so an artifact row
 * keeps its menu for a viewer with the two export entries alone, and a terminal
 * row still drops the whole affordance.
 *
 * Delete also closes the item's open canvas tile so the mobile view never lands
 * on a dead tile.
 *
 * Artifact rows go through their own component rather than a branch inside the
 * body: the export mutation is an artifact concern, and a hook called in the
 * shared body would make every terminal row instantiate it too.
 */
export function SwitcherRowActions(props: SwitcherRowActionsProps) {
  if (props.kind === "artifact")
    return <SwitcherArtifactRowActions {...props} />;
  return (
    <SwitcherRowActionsMenu {...props} leadingEntries={NO_LEADING_ENTRIES} />
  );
}

/** Artifact rows, whose menu opens with the two desktop export entries. */
function SwitcherArtifactRowActions(props: SwitcherRowActionsProps) {
  const { nodeId, name } = props;
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
  const entries: ReadonlyArray<SidebarRowMenuEntry> = [
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
  return <SwitcherRowActionsMenu {...props} leadingEntries={entries} />;
}

function SwitcherRowActionsMenu(
  props: SwitcherRowActionsProps & {
    /** Read-only entries shown above the editor-gated ones. */
    readonly leadingEntries: ReadonlyArray<SidebarRowMenuEntry>;
  },
) {
  const { epicId, tabId, kind, nodeId, name, cascadeSummary, leadingEntries } =
    props;
  const canMutate = isEditableRole(useEpicPermissionRole());
  const state = useSwitcherRowActions({ epicId, tabId, kind, nodeId });

  const isTerminal = kind === "terminal";
  const mutateEntries: ReadonlyArray<SidebarRowMenuEntry> = canMutate
    ? [
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
          label: isTerminal ? "Close" : "Delete",
          icon: <Trash2 className="size-3.5" />,
          disabled: isTerminal ? state.terminalClosePending : false,
          disabledTooltip: null,
          variant: "destructive",
          testIds: {
            dropdown: `switcher-delete-${nodeId}`,
            context: `switcher-delete-ctx-${nodeId}`,
          },
          onSelect: isTerminal ? state.closeTerminal : state.requestDelete,
        },
      ]
    : [];

  // The joining separator belongs to neither group: it exists only when both
  // are present, so a viewer's export-only menu has no dangling rule.
  const entries: ReadonlyArray<SidebarRowMenuEntry> =
    leadingEntries.length > 0 && mutateEntries.length > 0
      ? [
          ...leadingEntries,
          { kind: "separator", id: "after-export" },
          ...mutateEntries,
        ]
      : [...leadingEntries, ...mutateEntries];

  if (entries.length === 0) return null;

  return (
    <SwitcherRowMenu
      nodeId={nodeId}
      name={name}
      renameTitle={RENAME_TITLE[kind]}
      entries={entries}
      state={state}
      confirmDescription={
        isTerminal ? null : "This permanently deletes the artifact."
      }
      cascadeSummary={cascadeSummary}
    />
  );
}
