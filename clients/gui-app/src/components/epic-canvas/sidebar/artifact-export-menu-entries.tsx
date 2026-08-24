import { FileDown } from "lucide-react";
import { AgentSpinningDots } from "@/components/ui/agent-spinning-dots";
import type { SidebarRowMenuEntry } from "@/components/epic-canvas/sidebar/sidebar-row-menu-items";
import { useEpicExportArtifacts } from "@/hooks/epic/use-epic-export-artifacts-mutation";

/**
 * The two export entries an artifact row's menu opens with, on every surface
 * that has one. Shared rather than written per surface so the desktop tree and
 * the mobile switcher cannot drift in what they offer, in what each entry does,
 * or in when one is refused - the same rule the chat row's menu follows.
 *
 * A hook, not a plain builder, because the export mutation belongs to the
 * entries: a caller that had to own it could hold a different one.
 *
 * Exports READ, so they are not gated on write permission. Only the test ids
 * differ per surface, and `testIdPrefix` is what carries that.
 */
export function useArtifactExportMenuEntries(args: {
  readonly nodeId: string;
  readonly nodeName: string;
  /** `epic-sidebar` or `switcher`; the surface's own test-id namespace. */
  readonly testIdPrefix: string;
}): ReadonlyArray<SidebarRowMenuEntry> {
  const { nodeId, nodeName, testIdPrefix } = args;
  const exportArtifacts = useEpicExportArtifacts();
  const exportOne = (format: "markdown" | "pdf"): void => {
    exportArtifacts.mutate({
      artifacts: [{ id: nodeId, title: nodeName }],
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
  return [
    {
      kind: "item",
      id: "export-markdown",
      label: "Export as Markdown",
      icon: exportIcon,
      disabled: exportArtifacts.isPending,
      disabledTooltip: null,
      variant: "default",
      testIds: {
        dropdown: `${testIdPrefix}-export-markdown-${nodeId}`,
        context: `${testIdPrefix}-context-export-markdown-${nodeId}`,
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
        dropdown: `${testIdPrefix}-export-pdf-${nodeId}`,
        context: `${testIdPrefix}-context-export-pdf-${nodeId}`,
      },
      onSelect: () => exportOne("pdf"),
    },
  ];
}
