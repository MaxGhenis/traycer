import { randomUUID } from "node:crypto";
import type {
  BrowserAnnotationAttachPayload,
  BrowserAnnotationCounts,
  BrowserAnnotationCssRect,
  BrowserAnnotationMarkSnapshot,
} from "../../ipc-contracts/browser-annotation-types";
import type { BrowserViewElementCapture } from "../../ipc-contracts/browser-view-types";

export interface AnnotationCropRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AnnotationCapturedImage {
  getSize(): { readonly width: number; readonly height: number };
  isEmpty(): boolean;
  crop(rect: AnnotationCropRect): AnnotationCapturedImage;
  toPNG(): Uint8Array;
}

/** Product default: union of marks + 20 CSS px, clamped to the viewport. */
export const ANNOTATION_CROP_PAD_CSS_PX = 20;

export interface AnnotationCropViewport {
  readonly width: number;
  readonly height: number;
}

export interface AnnotationCropImageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Map a CSS-pixel union rect onto the captured image.
 *
 * `scale = image.width / viewport CSS width` covers both devicePixelRatio and
 * browser zoom. Scroll lock is what makes the viewport stable between mark
 * and capture. One ratio is applied to both axes.
 */
export function computeAnnotationCropRect(input: {
  readonly unionRect: BrowserAnnotationCssRect;
  readonly viewport: AnnotationCropViewport;
  readonly imageSize: AnnotationCropImageSize;
}): AnnotationCropRect | null {
  if (input.viewport.width <= 0 || input.viewport.height <= 0) return null;
  if (input.imageSize.width <= 0 || input.imageSize.height <= 0) return null;
  const scale = input.imageSize.width / input.viewport.width;
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const paddedLeft = input.unionRect.x - ANNOTATION_CROP_PAD_CSS_PX;
  const paddedTop = input.unionRect.y - ANNOTATION_CROP_PAD_CSS_PX;
  const paddedRight =
    input.unionRect.x + input.unionRect.width + ANNOTATION_CROP_PAD_CSS_PX;
  const paddedBottom =
    input.unionRect.y + input.unionRect.height + ANNOTATION_CROP_PAD_CSS_PX;

  const left = clamp(paddedLeft, 0, input.viewport.width);
  const top = clamp(paddedTop, 0, input.viewport.height);
  const right = clamp(paddedRight, 0, input.viewport.width);
  const bottom = clamp(paddedBottom, 0, input.viewport.height);
  const cssWidth = right - left;
  const cssHeight = bottom - top;
  if (cssWidth <= 0 || cssHeight <= 0) return null;

  const x = clamp(Math.round(left * scale), 0, input.imageSize.width);
  const y = clamp(Math.round(top * scale), 0, input.imageSize.height);
  const width = clamp(
    Math.round(cssWidth * scale),
    0,
    input.imageSize.width - x,
  );
  const height = clamp(
    Math.round(cssHeight * scale),
    0,
    input.imageSize.height - y,
  );
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export function cropAnnotationPng(
  image: AnnotationCapturedImage,
  unionRect: BrowserAnnotationCssRect,
  viewport: AnnotationCropViewport,
): Uint8Array | null {
  if (image.isEmpty()) return null;
  const imageSize = image.getSize();
  const rect = computeAnnotationCropRect({
    unionRect,
    viewport,
    imageSize,
  });
  if (rect === null) return null;
  const cropped = image.crop(rect);
  if (cropped.isEmpty()) return null;
  const png = cropped.toPNG();
  if (png.byteLength === 0) return null;
  return png;
}

export function mintAnnotationId(): string {
  return `ann-${randomUUID()}`;
}

export function countAnnotationMarks(
  marks: readonly BrowserAnnotationMarkSnapshot[],
): BrowserAnnotationCounts {
  let elements = 0;
  let regions = 0;
  let strokes = 0;
  for (const mark of marks) {
    if (mark.kind === "element") {
      elements += 1;
    } else if (mark.kind === "region") {
      regions += 1;
    } else {
      strokes += 1;
    }
  }
  return { elements, regions, strokes };
}

export function originFromPageUrl(pageUrl: string): string {
  try {
    return new URL(pageUrl).origin;
  } catch {
    return "";
  }
}

export function buildAnnotationAttachPayload(input: {
  readonly annotationId: string;
  readonly tabId: string;
  readonly sessionId: string;
  readonly pageUrl: string;
  readonly pageTitle: string;
  readonly capturedAt: number;
  readonly comment: string;
  readonly marks: readonly BrowserAnnotationMarkSnapshot[];
  readonly elements: readonly BrowserViewElementCapture[];
}): BrowserAnnotationAttachPayload {
  return {
    annotationId: input.annotationId,
    tabId: input.tabId,
    sessionId: input.sessionId,
    origin: originFromPageUrl(input.pageUrl),
    pageUrl: input.pageUrl,
    pageTitle: input.pageTitle,
    capturedAt: input.capturedAt,
    comment: input.comment,
    counts: countAnnotationMarks(input.marks),
    elements: input.elements,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
