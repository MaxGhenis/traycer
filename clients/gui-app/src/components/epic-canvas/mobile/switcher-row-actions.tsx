import { useCallback, useState } from "react";
import { FileDown, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { AgentSpinningDots } from "@/components/ui/agent-spinning-dots";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarDropdownMenuItems,
  type SidebarRowMenuEntry,
} from "@/components/epic-canvas/sidebar/sidebar-row-menu-items";
import { ConfirmDestructiveDialog } from "@/components/ui/confirm-destructive-dialog";
import { SwitcherRenameDialog } from "@/components/epic-canvas/mobile/switcher-rename-dialog";
import {
  useSwitcherRename,
  type SwitcherRowKind,
} from "@/components/epic-canvas/mobile/use-switcher-rename";
import { useEpicPermissionRole } from "@/lib/epic-selectors";
import { isEditableRole } from "@/lib/epic-permissions";
import { useEpicDeleteChat } from "@/hooks/epic/use-epic-chat-mutations";
import { useEpicDeleteTuiAgent } from "@/hooks/epic/use-epic-tui-agent-mutations";
import { useEpicDeleteArtifact } from "@/hooks/epic/use-epic-node-mutations";
import { useEpicExportArtifacts } from "@/hooks/epic/use-epic-export-artifacts-mutation";
import { useTerminalKillFor } from "@/hooks/terminal/use-terminal-kill-for-mutation";
import { useEpicSessionHostClient } from "@/hooks/epic/use-epic-session-host-client";
import { useEpicNestedFocusNavigation } from "@/hooks/epic/use-epic-nested-focus-navigation";
import { findOpenArtifactInTab } from "@/stores/epics/canvas/canvas-selectors";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";

interface SwitcherRowActionsProps {
  readonly epicId: string;
  readonly tabId: string;
  readonly kind: SwitcherRowKind;
  /** Content id: the node id for agents/artifacts, the session id for a PTY. */
  readonly nodeId: string;
  readonly name: string;
  /** "… and N nested" summary for a cascading delete; null when none / N/A. */
  readonly cascadeSummary: string | null;
}

const RENAME_TITLE: Record<SwitcherRowKind, string> = {
  chat: "Rename agent",
  "terminal-agent": "Rename agent",
  artifact: "Rename artifact",
  terminal: "Rename terminal",
};

const NO_LEADING_ENTRIES: ReadonlyArray<SidebarRowMenuEntry> = [];

/**
 * The per-row "…" actions for the switcher's lists: Export + Rename + Delete
 * for artifacts, Rename + Delete for agents (delete confirmed), Rename + Close
 * for PTY terminals (Close is immediate, matching desktop parity). Reuses the
 * exact desktop mutation hooks and the shared row-menu item renderer.
 *
 * Mutations are editor-gated, so a viewer sees no dead-end rename/delete. The
 * artifact exports are NOT - they read, exactly as the desktop artifact row's
 * menu offers them to a viewer - so an artifact row keeps its menu for a viewer
 * with the two export entries alone, and every other row kind still drops the
 * whole affordance.
 *
 * Delete also closes the item's open canvas tile so the mobile view never lands
 * on a dead tile.
 *
 * Artifact rows go through their own component rather than a branch inside the
 * body: the export mutation is an artifact concern, and a hook called in the
 * shared body would make every agent and terminal row instantiate it too.
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
  const [renameOpen, setRenameOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const rename = useSwitcherRename(epicId);
  const deleteChat = useEpicDeleteChat();
  const deleteTuiAgent = useEpicDeleteTuiAgent();
  const deleteArtifact = useEpicDeleteArtifact();
  // The row's terminal lives on the host the switcher LISTS (the Epic
  // session's), so kill goes to that same client - never the ambient one.
  const killTerminal = useTerminalKillFor(
    useEpicSessionHostClient(),
    "Couldn't close the terminal.",
    true,
  );

  const navigateNested = useEpicNestedFocusNavigation();
  const prepareCloseCanvasTabFocusTarget = useEpicCanvasStore(
    (s) => s.prepareCloseCanvasTabFocusTarget,
  );

  // Deleting/closing an item that is open must also close its canvas tile, or
  // the single mobile tile view would keep rendering a now-dead tile.
  const closeOpenTile = useCallback(() => {
    const found = findOpenArtifactInTab(tabId, nodeId);
    if (found === null) return;
    navigateNested(epicId, tabId, () =>
      prepareCloseCanvasTabFocusTarget(tabId, found.paneId, found.instanceId),
    );
  }, [epicId, nodeId, navigateNested, prepareCloseCanvasTabFocusTarget, tabId]);

  const submitRename = useCallback(
    (title: string) => {
      rename(kind, nodeId, title);
      setRenameOpen(false);
    },
    [kind, nodeId, rename],
  );

  const confirmDelete = useCallback(() => {
    if (kind === "chat")
      deleteChat.mutate(
        { epicId, chatId: nodeId },
        { onSuccess: closeOpenTile },
      );
    else if (kind === "terminal-agent")
      deleteTuiAgent.mutate(
        { epicId, tuiAgentId: nodeId },
        { onSuccess: closeOpenTile },
      );
    else if (kind === "artifact")
      deleteArtifact.mutate(
        { epicId, artifactId: nodeId },
        { onSuccess: closeOpenTile },
      );
    setConfirmOpen(false);
  }, [
    closeOpenTile,
    deleteArtifact,
    deleteChat,
    deleteTuiAgent,
    epicId,
    kind,
    nodeId,
  ]);

  // Terminal "Close" terminates the PTY immediately (no confirm - desktop
  // parity), closing the open tile first so the action is mount-independent.
  const closeTerminal = useCallback(() => {
    if (killTerminal.isPending) return;
    closeOpenTile();
    killTerminal.mutate({ sessionId: nodeId });
  }, [closeOpenTile, killTerminal, nodeId]);

  const isTerminal = kind === "terminal";
  const deleteLabel = isTerminal ? "Close" : "Delete";
  const deletePending =
    deleteChat.isPending ||
    deleteTuiAgent.isPending ||
    deleteArtifact.isPending;

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
          onSelect: () => setRenameOpen(true),
        },
        { kind: "separator", id: "before-delete" },
        {
          kind: "item",
          id: "delete",
          label: deleteLabel,
          icon: <Trash2 className="size-3.5" />,
          disabled: isTerminal ? killTerminal.isPending : false,
          disabledTooltip: null,
          variant: "destructive",
          testIds: {
            dropdown: `switcher-delete-${nodeId}`,
            context: `switcher-delete-ctx-${nodeId}`,
          },
          onSelect: isTerminal ? closeTerminal : () => setConfirmOpen(true),
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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${name}`}
            data-testid={`switcher-more-${nodeId}`}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <SidebarDropdownMenuItems entries={entries} />
        </DropdownMenuContent>
      </DropdownMenu>
      <SwitcherRenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title={RENAME_TITLE[kind]}
        initialValue={name}
        nodeId={nodeId}
        onSubmit={submitRename}
      />
      {isTerminal ? null : (
        <ConfirmDestructiveDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={`Delete "${name}"?`}
          description={
            kind === "artifact"
              ? "This permanently deletes the artifact."
              : "This permanently deletes the agent and its history."
          }
          cascadeSummary={cascadeSummary}
          actionLabel="Delete"
          isPending={deletePending}
          onConfirm={confirmDelete}
        />
      )}
    </>
  );
}
