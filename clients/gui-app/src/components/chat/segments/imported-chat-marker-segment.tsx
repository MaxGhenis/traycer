import type { GuiHarnessId } from "@traycer/protocol/host/index";
import { HarnessIcon } from "@/components/home/pickers/harness-icon";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { harnessDisplayName } from "@/components/session-import/session-import-model";
import { formatAbsoluteDateTime } from "@/lib/relative-time";

interface ImportedChatMarkerSegmentProps {
  readonly sourceProvider: GuiHarnessId;
  readonly importedAt: number;
  readonly sourceCwd: string;
}

/**
 * Provenance for a chat materialized from a CLI session the user ran before
 * Traycer saw it (spec T6, closing D14).
 *
 * This row is the ONLY place an imported chat is marked. A badge in the task
 * list or on a tile would compete with the several other reasons a row gets an
 * ornament, and would keep competing forever for a fact that stops mattering
 * the moment the user continues the conversation here. Inside the transcript
 * it sits exactly where the history it describes begins.
 */
export function ImportedChatMarkerSegment(
  props: ImportedChatMarkerSegmentProps,
) {
  const { sourceProvider, importedAt, sourceCwd } = props;
  return (
    <div
      data-testid="imported-chat-marker"
      className="flex w-full items-center gap-3 py-4 text-ui-sm text-muted-foreground"
    >
      <div className="h-px min-w-0 flex-1 bg-border" aria-hidden />
      <TooltipWrapper
        label={sourceCwd}
        side="top"
        sideOffset={undefined}
        align={undefined}
      >
        <span
          data-find-include="true"
          className="inline-flex min-w-0 items-center gap-1.5"
        >
          <HarnessIcon harnessId={sourceProvider} className="size-3.5" />
          <span className="truncate">
            Imported from {harnessDisplayName(sourceProvider)} ·{" "}
            {formatAbsoluteDateTime(importedAt)}
          </span>
        </span>
      </TooltipWrapper>
      <div className="h-px min-w-0 flex-1 bg-border" aria-hidden />
    </div>
  );
}
