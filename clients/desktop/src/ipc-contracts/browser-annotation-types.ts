import type {
  BrowserViewElementCapture,
  BrowserViewTileKey,
} from "./browser-view-types";

/**
 * Guest overlay mode. Select is the session default (annotate button).
 * Keys: V/R/D/E, page-canvas focus only.
 */
export type BrowserAnnotationMode = "select" | "region" | "draw" | "erase";

export type BrowserAnnotationMarkKind = "element" | "region" | "stroke";

/**
 * CSS-pixel rectangle in the current viewport.
 * Ticket 03 maps this through `capturedImage.width / viewport CSS width`.
 */
export interface BrowserAnnotationCssRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * One mark on the ordered stack at attach time.
 * Ticket 02 fills this; raw stroke points must never appear here.
 */
export interface BrowserAnnotationMarkSnapshot {
  readonly id: string;
  readonly kind: BrowserAnnotationMarkKind;
  readonly bounds: BrowserAnnotationCssRect;
  /** Element marks only; null for region/stroke. */
  readonly selector: string | null;
}

/**
 * Guest -> main attach envelope (ticket 01 defines, ticket 02 emits, ticket 03 consumes).
 *
 * `annotationId` is minted by main on a successful crop (ticket 03) - the guest
 * must not supply ids or pixels. A guest-supplied `screenshot` / `annotationId`
 * field is rejected at the sanitizer.
 */
export interface BrowserAnnotationAttachRequest {
  readonly marks: readonly BrowserAnnotationMarkSnapshot[];
  readonly elements: readonly BrowserViewElementCapture[];
  readonly comment: string;
  readonly unionRect: BrowserAnnotationCssRect;
}

/**
 * `elements` is the number delivered after byte-budget trim, not the number
 * of element marks. Regions and strokes stay mark-derived.
 */
export interface BrowserAnnotationCounts {
  readonly elements: number;
  readonly regions: number;
  readonly strokes: number;
}

/**
 * Main-owned attach payload after a successful crop. `annotationId` is minted
 * here; the guest never supplies ids or pixels.
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
  /**
   * Element marks that did not survive guest `applyByteBudget` or main
   * `trimToByteBudget` / the element cap. 0 when every marked element was
   * delivered.
   */
  readonly droppedElementCount: number;
  readonly elements: readonly BrowserViewElementCapture[];
}

/**
 * IPC event for a successful attach. Failure never emits this (bundle stays
 * open; guest `captureFailed()` notice only).
 */
export interface BrowserAnnotationAttachedIpcEvent extends BrowserViewTileKey {
  readonly payload: BrowserAnnotationAttachPayload;
  readonly pngBytes: Uint8Array;
}

export interface BrowserAnnotationSetTargetChatLabelInput
  extends BrowserViewTileKey {
  readonly label: string;
  readonly canAttach: boolean;
}

export type BrowserAnnotationEndReason =
  | "cancelled"
  | "navigation"
  | "reload"
  | "crash"
  | "tile-close"
  | "replaced";

export type BrowserAnnotationStartFailureReason =
  | "tile-not-found"
  | "page-not-ready"
  | "debugger-not-attached"
  | "no-main-frame"
  | "no-isolated-world"
  | "inject-failed";

export type BrowserAnnotationStartResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: BrowserAnnotationStartFailureReason;
    };

/**
 * Guest events on `__traycerAnnotation`, plus main-owned `ended`.
 * `cancelled` is the guest/user-cancel path; `ended` covers teardown the
 * guest did not initiate (nav, crash, tile close, second start).
 */
export type BrowserAnnotationSessionEvent =
  | {
      readonly type: "stateChanged";
      readonly mode: BrowserAnnotationMode;
      readonly markCount: number;
    }
  | { readonly type: "cancelled" }
  | {
      readonly type: "attachRequested";
      readonly payload: BrowserAnnotationAttachRequest;
    }
  | {
      readonly type: "ended";
      readonly reason: Exclude<BrowserAnnotationEndReason, "cancelled">;
    };

export interface BrowserAnnotationSessionIpcEvent extends BrowserViewTileKey {
  readonly event: BrowserAnnotationSessionEvent;
}
