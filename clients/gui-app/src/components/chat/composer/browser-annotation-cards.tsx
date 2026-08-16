import { useCallback } from "react";

import { useLandingImageFetcher } from "@/hooks/composer/use-landing-image-fetcher";
import { removeAttachedBrowserAnnotation } from "@/lib/browser-view/browser-annotation-attach";
import { sessionObjectUrl } from "@/lib/composer/landing-image-store";
import { useComposerDraftStore } from "@/stores/composer/composer-draft-store";

import { BrowserAnnotationCard } from "./browser-annotation-card";

export function BrowserAnnotationCards(props: { readonly taskId: string }) {
  const records = useComposerDraftStore(
    (state) => state.drafts[props.taskId]?.browserAnnotations ?? EMPTY_RECORDS,
  );
  const onRemove = useCallback(
    (annotationId: string) => {
      removeAttachedBrowserAnnotation(props.taskId, annotationId);
    },
    [props.taskId],
  );
  const imageFetcher = useLandingImageFetcher();
  if (records.length === 0) return null;
  return (
    <div
      data-testid="browser-annotation-cards"
      className="flex min-w-0 flex-col gap-2"
    >
      {records.map((record) => (
        <BrowserAnnotationCard
          key={record.annotationId}
          record={record}
          onRemove={onRemove}
          imageFetcher={imageFetcher}
          sessionObjectUrl={sessionObjectUrl}
        />
      ))}
    </div>
  );
}

const EMPTY_RECORDS: readonly never[] = [];
