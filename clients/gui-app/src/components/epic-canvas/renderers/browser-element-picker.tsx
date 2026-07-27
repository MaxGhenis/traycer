import type { ReactNode } from "react";
import { Frame, Send, SquareDashedMousePointer, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import type { BrowserViewElementCapture } from "@/lib/browser-view/desktop-browser-view";
import { cn } from "@/lib/utils";
import type { BrowserElementPickerController } from "@/components/epic-canvas/renderers/use-browser-element-picker";

export function BrowserElementPickerToggle(props: {
  readonly controller: BrowserElementPickerController;
}) {
  const { controller } = props;
  return (
    <TooltipWrapper
      label={
        controller.isPicking ? "Cancel element picker" : "Inspect an element"
      }
      side="top"
      sideOffset={6}
      align="center"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Inspect an element"
        aria-pressed={controller.isPicking}
        disabled={!controller.canPick && !controller.isPicking}
        onClick={controller.toggle}
        className={cn(controller.isPicking && "bg-primary/15 text-primary")}
      >
        <SquareDashedMousePointer />
      </Button>
    </TooltipWrapper>
  );
}

export function BrowserElementPickerResultPanel(props: {
  readonly controller: BrowserElementPickerController;
}) {
  const { controller } = props;
  if (controller.isPicking) {
    return <PickingHint onCancel={controller.cancel} />;
  }
  const result = controller.result;
  if (result === null) return null;
  if (result.outcome === "iframe-not-inspectable") {
    return (
      <IframeNotInspectableCard
        frameLabel={result.frameLabel}
        onClear={controller.clearResult}
      />
    );
  }
  return (
    <PickedElementCard
      element={result.element}
      sending={controller.sending}
      onSend={controller.sendToAgent}
      onClear={controller.clearResult}
    />
  );
}

function PickingHint(props: { readonly onCancel: () => void }) {
  return (
    <div
      role="status"
      data-testid="browser-element-picker-hint"
      className="flex min-h-0 shrink-0 items-center justify-between gap-2 border-t border-border bg-primary/5 px-3 py-1.5 text-ui-xs text-muted-foreground"
    >
      <span className="flex min-w-0 items-center gap-2">
        <SquareDashedMousePointer
          className="size-3.5 shrink-0 text-primary"
          aria-hidden
        />
        <span className="truncate">
          Click an element to inspect · press Esc to cancel
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 text-ui-xs"
        onClick={props.onCancel}
      >
        Cancel
      </Button>
    </div>
  );
}

function PickedElementCard(props: {
  readonly element: BrowserViewElementCapture;
  readonly sending: boolean;
  readonly onSend: () => void;
  readonly onClear: () => void;
}) {
  const { element } = props;
  const box = element.boundingBox;
  return (
    <div
      data-testid="browser-element-picker-result"
      className="flex max-h-[min(40dvh,20rem)] min-h-0 shrink-0 flex-col border-t border-border bg-canvas"
    >
      <div className="flex min-h-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <SquareDashedMousePointer
            className="size-3.5 shrink-0 text-primary"
            aria-hidden
          />
          <span className="truncate font-mono text-ui-xs text-foreground">
            {element.tagName || "element"}
          </span>
          {element.ariaRole === null ? null : (
            <span className="shrink-0 rounded-sm bg-muted px-1 font-mono text-[0.625rem] text-muted-foreground">
              {element.ariaRole}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <TooltipWrapper
            label="Send element to agent"
            side="top"
            sideOffset={6}
            align="end"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Send element to agent"
              disabled={props.sending}
              onClick={props.onSend}
            >
              <Send />
            </Button>
          </TooltipWrapper>
          <TooltipWrapper
            label="Clear element"
            side="top"
            sideOffset={6}
            align="end"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Clear element"
              onClick={props.onClear}
            >
              <X />
            </Button>
          </TooltipWrapper>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-ui-xs">
        <ElementField label="Selector">
          <span className="break-all font-mono text-foreground">
            {element.selector || "(unavailable)"}
          </span>
        </ElementField>
        {element.accessibleName === null ? null : (
          <ElementField label="Name">
            <span className="break-words text-foreground">
              {element.accessibleName}
            </span>
          </ElementField>
        )}
        {element.textPreview === null ? null : (
          <ElementField label="Text">
            <span className="break-words text-foreground">
              {element.textPreview}
            </span>
          </ElementField>
        )}
        <ElementField label="Box">
          <span className="font-mono text-foreground">
            {box.width}×{box.height} at ({box.x}, {box.y})
          </span>
        </ElementField>
        {element.computedStyles.length === 0 ? null : (
          <ElementField label="Styles">
            <div className="min-w-0">
              {element.computedStyles.slice(0, 12).map((style) => (
                <div
                  key={style.property}
                  className="flex min-w-0 gap-1 font-mono"
                >
                  <span className="shrink-0 text-muted-foreground">
                    {style.property}:
                  </span>
                  <span className="min-w-0 truncate text-foreground">
                    {style.value}
                  </span>
                </div>
              ))}
            </div>
          </ElementField>
        )}
        <ElementField label="HTML">
          <pre className="max-h-[min(20vh,10rem)] overflow-auto whitespace-pre-wrap break-all rounded-sm bg-muted/60 px-2 py-1 font-mono text-[0.6875rem] text-foreground">
            {element.outerHtml}
            {element.outerHtmlTruncated ? "\n… (truncated)" : ""}
          </pre>
        </ElementField>
      </div>
    </div>
  );
}

function ElementField(props: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="mb-1.5 grid grid-cols-[4rem_minmax(0,1fr)] gap-2 last:mb-0">
      <span className="shrink-0 pt-0.5 text-ui-xs font-medium text-muted-foreground">
        {props.label}
      </span>
      <div className="min-w-0">{props.children}</div>
    </div>
  );
}

function IframeNotInspectableCard(props: {
  readonly frameLabel: string | null;
  readonly onClear: () => void;
}) {
  return (
    <div
      role="status"
      data-testid="browser-element-picker-iframe"
      className="flex min-h-0 shrink-0 items-start gap-2 border-t border-amber-500/30 bg-amber-50 px-3 py-2 text-ui-xs text-amber-950 dark:bg-amber-950/35 dark:text-amber-100"
    >
      <Frame
        className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium">iframe not inspectable</div>
        <div className="text-amber-900/80 dark:text-amber-100/80">
          This element is inside a cross-origin iframe. The top-frame picker
          can&apos;t read its contents.
        </div>
        {props.frameLabel === null ? null : (
          <div className="mt-0.5 truncate font-mono text-amber-900/80 dark:text-amber-100/80">
            {props.frameLabel}
          </div>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Clear element"
        className="shrink-0 text-amber-900 hover:bg-amber-500/15 dark:text-amber-100"
        onClick={props.onClear}
      >
        <X />
      </Button>
    </div>
  );
}
