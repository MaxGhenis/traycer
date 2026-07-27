export interface BrowserViewTileKey {
  readonly viewTabId: string;
  readonly paneId: string;
  readonly tileInstanceId: string;
  readonly pageSessionId: string;
}

export interface BrowserViewTileUpsert extends BrowserViewTileKey {
  readonly url: string;
  readonly visible: boolean;
  readonly viewportPreset: BrowserViewViewportPresetId;
}

export interface BrowserViewBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BrowserViewBoundsUpdate extends BrowserViewTileKey {
  readonly bounds: BrowserViewBounds;
}

export type BrowserViewViewportPresetId =
  "responsive" | "mobile" | "tablet" | "desktop";

export interface BrowserViewViewportPresetChange extends BrowserViewTileKey {
  readonly viewportPreset: BrowserViewViewportPresetId;
}

export type BrowserViewStatus = "loading" | "ready" | "dead";

export interface BrowserViewStatusChange extends BrowserViewTileKey {
  readonly url: string;
  readonly title: string;
  readonly status: BrowserViewStatus;
  readonly reason: string | null;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly zoomPercent: number;
}

export interface BrowserViewFindRequest extends BrowserViewTileKey {
  readonly requestId: number;
  readonly query: string;
  readonly matchCase: boolean;
  readonly forward: boolean;
  readonly findNext: boolean;
}

export interface BrowserViewFindStop extends BrowserViewTileKey {
  readonly requestId: number;
}

export type BrowserViewFindStatus = "idle" | "searching" | "ready" | "error";

export interface BrowserViewFindChange extends BrowserViewTileKey {
  readonly requestId: number;
  readonly query: string;
  readonly matchCase: boolean;
  readonly status: BrowserViewFindStatus;
  readonly current: number;
  readonly total: number;
  readonly finalUpdate: boolean;
  readonly errorMessage: string | null;
}

export type BrowserViewDownloadState =
  "prompting" | "progressing" | "completed" | "cancelled" | "interrupted";

export interface BrowserViewDownloadChange extends BrowserViewTileKey {
  readonly downloadId: string;
  readonly url: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly totalBytes: number;
  readonly receivedBytes: number;
  readonly state: BrowserViewDownloadState;
  readonly savePath: string | null;
  readonly dangerType: string | null;
  readonly canCancel: boolean;
}

export interface BrowserViewDownloadCancel {
  readonly downloadId: string;
}

export interface BrowserViewCertificateErrorChange extends BrowserViewTileKey {
  readonly certificateErrorId: string;
  readonly url: string;
  readonly hostname: string;
  readonly error: string;
  readonly fingerprint: string;
  readonly subject: string;
  readonly issuer: string;
}

export interface BrowserViewCertificateTrust extends BrowserViewTileKey {
  readonly certificateErrorId: string;
}

export interface BrowserViewOpenTileRequest extends BrowserViewTileKey {
  readonly url: string;
  readonly disposition: string;
}

export interface BrowserViewOverlayOcclusion {
  readonly overlayId: string;
  readonly tiles: readonly BrowserViewTileKey[];
}

export interface BrowserViewOverlayRelease {
  readonly overlayId: string;
}

export interface BrowserViewOverlaySnapshot extends BrowserViewTileKey {
  readonly dataUrl: string | null;
  readonly stale: boolean;
}

export interface BrowserViewOverlayOcclusionResult {
  readonly snapshots: readonly BrowserViewOverlaySnapshot[];
  readonly restoredTiles: readonly BrowserViewTileKey[];
}

export interface BrowserViewOverlayReleaseResult {
  readonly restoredTiles: readonly BrowserViewTileKey[];
}

export interface BrowserViewSnapshotInvalidatedChange extends BrowserViewTileKey {
  readonly reason: string;
}

export interface BrowserViewStorageStateApply {
  readonly storageState: unknown;
}

export interface BrowserViewStorageStateCapture extends BrowserViewTileKey {
  readonly origin: string;
}

export interface BrowserViewStorageStateCaptureResult {
  readonly storageState: unknown;
  readonly cookieCount: number;
  readonly cookieDomains: readonly string[];
  readonly localStorageCount: number;
  readonly localStorageAvailable: boolean;
  readonly localStorageReason: string | null;
}

export interface BrowserViewControlGrant extends BrowserViewTileKey {
  readonly controlId: string;
  readonly chatId: string;
  readonly agentRunId: string | null;
  readonly agentLabel: string;
  readonly origin: string;
  readonly expiresAt: number;
}

export interface BrowserViewControlRevoke extends BrowserViewTileKey {
  readonly controlId: string;
  readonly reason: string;
}

export type BrowserViewControlActionCommand =
  | {
      readonly kind: "click";
      readonly selector: string;
    }
  | {
      readonly kind: "type";
      readonly selector: string;
      readonly text: string;
    }
  | {
      readonly kind: "scroll";
      readonly deltaX: number;
      readonly deltaY: number;
    }
  | {
      readonly kind: "navigate";
      readonly url: string;
    };

export interface BrowserViewControlAction extends BrowserViewTileKey {
  readonly controlId: string;
  readonly actionId: string;
  readonly sensitiveApprovalId: string | null;
  readonly action: BrowserViewControlActionCommand;
}

export interface BrowserViewControlRevokedChange extends BrowserViewTileKey {
  readonly controlId: string;
  readonly reason: string;
}

export type BrowserViewControlGrantResult =
  | { readonly status: "granted"; readonly controlId: string }
  | { readonly status: "queued"; readonly controlId: string }
  | { readonly status: "denied"; readonly reason: string };

export type BrowserViewControlActionResult =
  | { readonly status: "completed"; readonly value: unknown }
  | {
      readonly status: "needs-approval";
      readonly approvalId: string;
      readonly reason: string;
    }
  | { readonly status: "cancelled"; readonly reason: string }
  | { readonly status: "denied"; readonly reason: string };

export type BrowserViewStorageStateApplyResult =
  | {
      readonly status: "applied";
      readonly cookieCount: number;
      readonly localStorageApplied: false;
      readonly reason: "cookies-only";
    }
  | {
      readonly status: "skipped-degraded";
      readonly cookieCount: 0;
      readonly localStorageApplied: false;
      readonly reason: BrowserCookieCryptoReason;
    };

export type BrowserCookieCryptoMode = "real" | "basic" | "degraded";
export type BrowserCookiePersistence = "persistent" | "ephemeral";
export type BrowserCookieStorageBackend =
  | "basic_text"
  | "gnome_libsecret"
  | "kwallet"
  | "kwallet5"
  | "kwallet6"
  | "unknown"
  | null;
export type BrowserCookieCryptoReason =
  | "os-backed"
  | "linux-basic-text"
  | "mock-keychain"
  | "keychain-denied"
  | "encryption-unavailable"
  | "unresolved";

export interface BrowserCookieCryptoState {
  readonly mode: BrowserCookieCryptoMode;
  readonly persistence: BrowserCookiePersistence;
  readonly reason: BrowserCookieCryptoReason;
  readonly storageBackend: BrowserCookieStorageBackend;
  readonly encryptionAvailable: boolean;
  readonly mockKeychainEnabled: boolean;
}

export interface BrowserLabsStateUpdate {
  readonly inAppBrowserBetaEnabled: boolean;
}

export type BrowserViewConsoleLevel =
  "log" | "info" | "warning" | "error" | "debug" | "trace";

export interface BrowserViewStackFrame {
  readonly functionName: string;
  readonly url: string;
  readonly lineNumber: number | null;
  readonly columnNumber: number | null;
}

export interface BrowserViewConsoleEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly source: string;
  readonly level: BrowserViewConsoleLevel;
  readonly text: string;
  readonly url: string | null;
  readonly lineNumber: number | null;
  readonly columnNumber: number | null;
  readonly stackTrace: readonly BrowserViewStackFrame[];
}

export type BrowserViewNetworkStatus = "pending" | "finished" | "failed";

export interface BrowserViewNetworkEntry {
  readonly id: string;
  readonly requestId: string;
  readonly url: string;
  readonly method: string;
  readonly resourceType: string | null;
  readonly status: BrowserViewNetworkStatus;
  readonly statusCode: number | null;
  readonly statusText: string | null;
  readonly mimeType: string | null;
  readonly fromCache: boolean;
  readonly startedAt: number;
  readonly completedAt: number | null;
  readonly durationMs: number | null;
  readonly encodedDataLength: number | null;
  readonly failureText: string | null;
}

export interface BrowserViewDebugSnapshotData {
  readonly consoleEntries: readonly BrowserViewConsoleEntry[];
  readonly networkEntries: readonly BrowserViewNetworkEntry[];
}

export interface BrowserViewDebugSnapshotChange
  extends BrowserViewTileKey, BrowserViewDebugSnapshotData {}

export interface BrowserViewCapturePageResult extends BrowserViewTileKey {
  readonly mediaType: string;
  readonly base64: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly capturedAt: number;
}

export interface BrowserViewElementBoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface BrowserViewElementAttribute {
  readonly name: string;
  readonly value: string;
}

export interface BrowserViewElementStyle {
  readonly property: string;
  readonly value: string;
}

/**
 * DOM-only element context harvested by the top-frame injected picker
 * (decision #25). Every field is derived from untrusted page data and is
 * length/count bounded by the main process before it crosses IPC.
 */
export interface BrowserViewElementCapture {
  readonly selector: string;
  readonly tagName: string;
  readonly elementId: string | null;
  readonly classNames: readonly string[];
  readonly attributes: readonly BrowserViewElementAttribute[];
  readonly outerHtml: string;
  readonly outerHtmlTruncated: boolean;
  readonly textPreview: string | null;
  readonly ariaRole: string | null;
  readonly accessibleName: string | null;
  readonly boundingBox: BrowserViewElementBoundingBox;
  readonly computedStyles: readonly BrowserViewElementStyle[];
}

export type BrowserViewElementPickResult =
  | {
      readonly outcome: "picked";
      readonly pageUrl: string;
      readonly element: BrowserViewElementCapture;
    }
  | {
      readonly outcome: "iframe-not-inspectable";
      readonly pageUrl: string;
      readonly frameLabel: string | null;
    }
  | { readonly outcome: "cancelled" }
  | { readonly outcome: "unavailable"; readonly reason: string };
