import {
  browserAnnotationImageFileName,
  type BrowserAnnotationCounts,
  type BrowserAnnotationRecord,
} from "@/lib/browser-view/browser-annotation-record";
import type { AnnotationRoute } from "@/lib/browser-view/browser-annotation-router";
import type { BrowserViewElementCapture } from "@/lib/browser-view/desktop-browser-view";
import { deleteImage, putImage } from "@/lib/composer/landing-image-store";
import { useComposerDraftStore } from "@/stores/composer/composer-draft-store";

type ImageBytes = Uint8Array<ArrayBuffer>;

/**
 * Incoming attach payload (IPC in ticket 06; stub in this ticket). Crop bytes
 * are stored separately; this object never carries pixels.
 */
export interface BrowserAnnotationAttachPayload {
  readonly annotationId: string;
  readonly tabId: string;
  readonly sessionId: string;
  readonly origin: string;
  readonly pageUrl: string;
  readonly pageTitle: string;
  readonly capturedAt: number;
  readonly comment: string;
  readonly counts: BrowserAnnotationCounts;
  readonly elements: ReadonlyArray<BrowserViewElementCapture>;
}

export type AttachBrowserAnnotationResult =
  | {
      readonly status: "attached";
      readonly chatId: string;
      readonly record: BrowserAnnotationRecord;
    }
  | { readonly status: "none"; readonly hint: string }
  | { readonly status: "store-failed"; readonly error: unknown };

/**
 * Store crop bytes in the existing hash-backed composer image store, mint the
 * record (hash + filename only), and append it to the target chat's draft.
 * A card is never created without its crop.
 */
export async function attachBrowserAnnotation(input: {
  readonly chatId: string;
  readonly payload: BrowserAnnotationAttachPayload;
  readonly png: ImageBytes;
}): Promise<AttachBrowserAnnotationResult> {
  let imageHash: string;
  try {
    imageHash = await putImage(input.png);
  } catch (error) {
    return { status: "store-failed", error };
  }
  const record: BrowserAnnotationRecord = {
    annotationId: input.payload.annotationId,
    tabId: input.payload.tabId,
    sessionId: input.payload.sessionId,
    origin: input.payload.origin,
    pageUrl: input.payload.pageUrl,
    pageTitle: input.payload.pageTitle,
    capturedAt: input.payload.capturedAt,
    comment: input.payload.comment,
    counts: input.payload.counts,
    elements: input.payload.elements,
    imageFileName: browserAnnotationImageFileName(input.payload.annotationId),
    imageHash,
  };
  useComposerDraftStore.getState().addBrowserAnnotation(input.chatId, record);
  return { status: "attached", chatId: input.chatId, record };
}

export async function attachRoutedBrowserAnnotation(input: {
  readonly route: AnnotationRoute;
  readonly payload: BrowserAnnotationAttachPayload;
  readonly png: ImageBytes;
}): Promise<AttachBrowserAnnotationResult> {
  if (input.route.kind === "none") {
    return { status: "none", hint: input.route.hint };
  }
  return attachBrowserAnnotation({
    chatId: input.route.chatId,
    payload: input.payload,
    png: input.png,
  });
}

/**
 * X on the card: drop the record and its stored image together. A hash still
 * referenced by another card on any draft is left in the store.
 */
export function removeAttachedBrowserAnnotation(
  taskId: string,
  annotationId: string,
): void {
  const drafts = useComposerDraftStore.getState().drafts;
  const current = drafts[taskId];
  const record = current?.browserAnnotations.find(
    (entry) => entry.annotationId === annotationId,
  );
  useComposerDraftStore
    .getState()
    .removeBrowserAnnotation(taskId, annotationId);
  if (record === undefined) return;
  if (
    annotationImageStillReferenced(
      drafts,
      taskId,
      record.imageHash,
      annotationId,
    )
  ) {
    return;
  }
  void deleteImage(record.imageHash);
}

export function restoreAttachedBrowserAnnotations(
  taskId: string,
  records: ReadonlyArray<BrowserAnnotationRecord>,
): void {
  useComposerDraftStore.getState().restoreBrowserAnnotations(taskId, records);
}

function annotationImageStillReferenced(
  drafts: Partial<
    Record<
      string,
      { readonly browserAnnotations: ReadonlyArray<BrowserAnnotationRecord> }
    >
  >,
  removedTaskId: string,
  imageHash: string,
  removedAnnotationId: string,
): boolean {
  for (const [taskId, draft] of Object.entries(drafts)) {
    if (draft === undefined) continue;
    for (const record of draft.browserAnnotations) {
      if (record.imageHash !== imageHash) continue;
      if (
        taskId === removedTaskId &&
        record.annotationId === removedAnnotationId
      ) {
        continue;
      }
      return true;
    }
  }
  return false;
}
