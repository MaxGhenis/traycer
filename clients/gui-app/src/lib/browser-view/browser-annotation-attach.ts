import {
  browserAnnotationImageFileName,
  type BrowserAnnotationCounts,
  type BrowserAnnotationRecord,
} from "@/lib/browser-view/browser-annotation-record";
import type { AnnotationRoute } from "@/lib/browser-view/browser-annotation-router";
import { scheduleLandingImageReconcile } from "@/lib/composer/landing-image-gc";
import { putImage } from "@/lib/composer/landing-image-store";
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
  readonly elements: BrowserAnnotationRecord["elements"];
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
 * X on the card: drop the record. Canonical landing-image reconciliation
 * (live roots + two-pass session release) decides whether the crop bytes
 * leave the store.
 */
export function removeAttachedBrowserAnnotation(
  taskId: string,
  annotationId: string,
): void {
  useComposerDraftStore
    .getState()
    .removeBrowserAnnotation(taskId, annotationId);
  scheduleLandingImageReconcile();
}

export function restoreAttachedBrowserAnnotations(
  taskId: string,
  records: ReadonlyArray<BrowserAnnotationRecord>,
): void {
  useComposerDraftStore.getState().restoreBrowserAnnotations(taskId, records);
}
