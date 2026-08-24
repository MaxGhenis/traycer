import { Pencil, Trash2 } from "lucide-react";
import type { SidebarRowMenuEntry } from "@/components/epic-canvas/sidebar/sidebar-row-menu-items";
import { SwitcherRowMenu } from "@/components/epic-canvas/mobile/switcher-row-menu";
import { useSwitcherRowActions } from "@/components/epic-canvas/mobile/use-switcher-row-actions";
import type { SwitcherRowKind } from "@/components/epic-canvas/mobile/use-switcher-rename";
import { useEpicPermissionRole } from "@/lib/epic-selectors";
import { isEditableRole } from "@/lib/epic-permissions";

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

/**
 * The per-row "…" actions for the switcher's artifact and terminal lists:
 * Rename + Delete for artifacts (delete confirmed), Rename + Close for PTY
 * terminals (Close is immediate, matching desktop parity). Agent rows carry the
 * full chat-row menu instead - see `SwitcherAgentRowActions`.
 *
 * Reuses the exact desktop mutation hooks and the shared row-menu item
 * renderer; the whole affordance is editor-gated (a viewer gets no menu at all,
 * so no dead-end mutations). Delete also closes the item's open canvas tile so
 * the mobile view never lands on a dead tile.
 */
export function SwitcherRowActions(props: SwitcherRowActionsProps) {
  const { epicId, tabId, kind, nodeId, name, cascadeSummary } = props;
  const canMutate = isEditableRole(useEpicPermissionRole());
  const state = useSwitcherRowActions({ epicId, tabId, kind, nodeId });

  if (!canMutate) return null;

  const isTerminal = kind === "terminal";
  const entries: ReadonlyArray<SidebarRowMenuEntry> = [
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
  ];

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
