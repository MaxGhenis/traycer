import { Globe2 } from "lucide-react";
import type { BrowserContextAttachmentRecord } from "@traycer/protocol/persistence/epic/schemas";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";

export function BrowserReferenceChips(props: {
  readonly references: ReadonlyArray<BrowserContextAttachmentRecord>;
}) {
  if (props.references.length === 0) return null;
  return (
    <div className="mb-2 flex max-w-full flex-wrap justify-start gap-1.5">
      {props.references.map((reference) => (
        <TooltipWrapper
          key={`${reference.kind}:${reference.sessionId}:${reference.tabId}`}
          label={`Browser session ${reference.sessionId}, tab ${reference.tabId}`}
          side="top"
          sideOffset={undefined}
          align={undefined}
        >
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-background/70 px-2 py-1 font-mono text-ui-xs text-muted-foreground">
            <Globe2 className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {reference.sessionId} / {reference.tabId}
            </span>
          </span>
        </TooltipWrapper>
      ))}
    </div>
  );
}
