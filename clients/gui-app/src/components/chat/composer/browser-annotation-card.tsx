import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMaybeBrowserSessionsContext } from "@/components/epic-canvas/renderers/browser-sessions-context";
import { type ImageBytesFetcher } from "@/lib/attachments/image-blob-cache";
import { useImageBlobUrl } from "@/lib/attachments/use-image-blob-url";
import {
  annotationTagLabels,
  formatAnnotationCounts,
  type BrowserAnnotationRecord,
} from "@/lib/browser-view/browser-annotation-record";
import {
  ANNOTATION_STALENESS_COPY,
  annotationStalenessHint,
} from "@/lib/browser-view/browser-annotation-staleness";
import { cn } from "@/lib/utils";

const VISIBLE_TAG_COUNT = 2;

export function BrowserAnnotationCard(props: {
  readonly record: BrowserAnnotationRecord;
  readonly onRemove: ((annotationId: string) => void) | null;
  readonly imageFetcher: ImageBytesFetcher;
  readonly sessionObjectUrl: (hash: string) => string | null;
}) {
  const { record, onRemove, imageFetcher } = props;
  const sessions = useMaybeBrowserSessionsContext();
  const sessionUrl = props.sessionObjectUrl(record.imageHash);
  const blobUrl = useImageBlobUrl(record.imageHash, "image/png", imageFetcher);
  const src = sessionUrl ?? blobUrl;
  const tags = annotationTagLabels(record.elements);
  const visibleElements = record.elements.slice(0, VISIBLE_TAG_COUNT);
  const overflow = tags.length - visibleElements.length;
  const counts = formatAnnotationCounts(record.counts);
  const staleness = annotationStalenessHint(record, sessions?.items ?? null);
  const comment =
    record.comment.trim().length > 0 ? record.comment.trim() : "No comment";

  return (
    <div
      data-testid="browser-annotation-card"
      data-annotation-id={record.annotationId}
      data-annotation-tab={record.tabId}
      className="flex min-w-0 items-center gap-2.5 rounded-[10px] border border-border bg-card p-2"
    >
      <div
        className={cn(
          "relative h-12 w-16 shrink-0 overflow-hidden rounded-md border border-border",
          src === null && "bg-foreground/8",
        )}
      >
        {src === null ? (
          <div
            className="size-full animate-pulse bg-foreground/10"
            aria-hidden
          />
        ) : (
          <img
            src={src}
            alt=""
            className="size-full object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui-sm text-foreground">{comment}</p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          {visibleElements.map((element) => (
            <Badge
              key={element.selector}
              variant="default"
              className="h-4 px-1.5 text-[0.625rem]"
            >
              {element.tagName.length > 0 ? element.tagName : "element"}
            </Badge>
          ))}
          {overflow > 0 ? (
            <span className="text-ui-xs text-muted-foreground">
              +{overflow}
            </span>
          ) : null}
          {counts.length > 0 ? (
            <span className="text-ui-xs text-muted-foreground">{counts}</span>
          ) : null}
          {staleness !== null ? (
            <span className="text-ui-xs text-amber-600 dark:text-amber-400">
              · {ANNOTATION_STALENESS_COPY[staleness]}
            </span>
          ) : null}
        </div>
      </div>
      {onRemove === null ? null : (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Remove annotation"
          className="shrink-0 text-muted-foreground"
          onClick={() => onRemove(record.annotationId)}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
