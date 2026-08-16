import type {
  BrowserAnnotationAttachRequest,
  BrowserAnnotationCssRect,
  BrowserAnnotationMarkKind,
  BrowserAnnotationMarkSnapshot,
  BrowserAnnotationSessionEvent,
} from "../../ipc-contracts/browser-annotation-types";
import type { BrowserViewElementCapture } from "../../ipc-contracts/browser-view-types";
import { isAnnotationMode } from "./browser-annotation-overlay-logic";

export const ANNOTATION_WORLD_NAME = "traycer-annotation";
export const ANNOTATION_BINDING_NAME = "__traycerAnnotation";

export const ANNOTATION_CANCEL_EXPRESSION =
  "(function(){var fn=globalThis.__traycerAnnotationCancel;" +
  "if(typeof fn==='function'){try{fn();}catch(e){}}return true;})()";

export const ANNOTATION_HIDE_CHROME_EXPRESSION =
  "(function(){var fn=globalThis.__traycerAnnotationHideChromeForCapture;" +
  "if(typeof fn==='function'){try{fn();}catch(e){}}return true;})()";

export const ANNOTATION_RESET_AFTER_ATTACH_EXPRESSION =
  "(function(){var fn=globalThis.__traycerAnnotationResetAfterAttach;" +
  "if(typeof fn==='function'){try{fn();}catch(e){}}return true;})()";

export const ANNOTATION_CAPTURE_FAILED_EXPRESSION =
  "(function(){var fn=globalThis.__traycerAnnotationCaptureFailed;" +
  "if(typeof fn==='function'){try{fn();}catch(e){}}return true;})()";

export const ANNOTATION_VIEWPORT_SIZE_EXPRESSION =
  "(function(){return {width:window.innerWidth,height:window.innerHeight,traycerAnnotationViewport:1};})()";

export const ANNOTATION_WAIT_FOR_PAINT_EXPRESSION =
  "(function(){return new Promise(function(resolve){" +
  "requestAnimationFrame(function(){" +
  "requestAnimationFrame(function(){resolve(true);});" +
  "});});})()";

export const ANNOTATION_LIMITS = {
  comment: 4000,
  markCount: 64,
  markId: 64,
  selector: 1000,
} as const;

export function buildAnnotationSetMarkCountExpression(count: number): string {
  const safe = Number.isFinite(count)
    ? String(Math.max(0, Math.floor(count)))
    : "0";
  return (
    "(function(){var fn=globalThis.__traycerAnnotationSetMarkCount;" +
    "if(typeof fn==='function'){try{fn(" +
    safe +
    ");}catch(e){}}return true;})()"
  );
}

export function buildAnnotationSetTargetChatLabelExpression(label: string): string {
  const encoded = JSON.stringify(label).replace(/</g, "\\u003c");
  return (
    "(function(){var fn=globalThis.__traycerAnnotationSetTargetChatLabel;" +
    "if(typeof fn==='function'){try{fn(" +
    encoded +
    ");}catch(e){}}return true;})()"
  );
}

/**
 * Isolated-world overlay bootstrap. Long-lived (no Promise): events go up
 * through the CDP binding; commands come down as named evaluates.
 */
export function buildAnnotationOverlayBootstrap(): string {
  return (
    "(function(){\n" +
    '"use strict";\n' +
    "var W = window, D = document;\n" +
    ANNOTATION_OVERLAY_BODY +
    "})()"
  );
}

const ANNOTATION_OVERLAY_BODY = [
  "if (W.__traycerAnnotationCancel) {",
  "  try { W.__traycerAnnotationCancel(); } catch (e) {}",
  "}",
  "var leftover = D.querySelector('[data-traycer-annotation=\"host\"]');",
  "if (leftover && leftover.parentNode) {",
  "  try { leftover.parentNode.removeChild(leftover); } catch (e) {}",
  "}",
  "",
  "var hostRoot = D.documentElement || D.body;",
  "if (!hostRoot) { return false; }",
  "var host = D.createElement('div');",
  "host.setAttribute('data-traycer-annotation', 'host');",
  "host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;margin:0;padding:0;';",
  "var shadow = host.attachShadow({ mode: 'closed' });",
  "var style = D.createElement('style');",
  "style.textContent = [",
  "  ':host{all:initial;}',",
  "  '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;}',",
  "  '.pill{position:fixed;top:14px;left:50%;transform:translateX(-50%);display:flex;gap:2px;background:#2c2c31;border-radius:10px;padding:4px;pointer-events:auto;z-index:2;box-shadow:0 8px 24px rgba(0,0,0,.28);}',",
  "  '.pill button{border:0;background:none;color:#c9c9d1;font-size:13px;padding:6px 14px;border-radius:7px;cursor:pointer;}',",
  "  '.pill button[aria-pressed=\"true\"]{background:#4a4a55;color:#8ab4ff;}'",
  "].join('');",
  "var pill = D.createElement('div');",
  "pill.className = 'pill';",
  "pill.setAttribute('role', 'toolbar');",
  "pill.setAttribute('aria-label', 'Annotation tools');",
  "var MODES = ['select', 'region', 'draw', 'erase'];",
  "var LABELS = { select: 'Select', region: 'Region', draw: 'Draw', erase: 'Erase' };",
  "var KEYS = { select: 'V', region: 'R', draw: 'D', erase: 'E' };",
  "var buttons = {};",
  "for (var i = 0; i < MODES.length; i++) {",
  "  var modeName = MODES[i];",
  "  var btn = D.createElement('button');",
  "  btn.type = 'button';",
  "  btn.textContent = LABELS[modeName];",
  "  btn.setAttribute('data-mode', modeName);",
  "  btn.setAttribute('aria-keyshortcuts', KEYS[modeName]);",
  "  btn.setAttribute('aria-pressed', modeName === 'select' ? 'true' : 'false');",
  "  pill.appendChild(btn);",
  "  buttons[modeName] = btn;",
  "}",
  "shadow.appendChild(style);",
  "shadow.appendChild(pill);",
  "hostRoot.appendChild(host);",
  "",
  "var mode = 'select';",
  "var markCount = 0;",
  "var done = false;",
  "var chromeHidden = false;",
  "",
  "function emit(event) {",
  "  var fn = W.__traycerAnnotation;",
  "  if (typeof fn !== 'function') { return; }",
  "  try { fn(JSON.stringify(event)); } catch (e) {}",
  "}",
  "function emitState() {",
  "  emit({ type: 'stateChanged', mode: mode, markCount: markCount });",
  "}",
  "function paintMode() {",
  "  for (var i = 0; i < MODES.length; i++) {",
  "    var name = MODES[i];",
  "    buttons[name].setAttribute('aria-pressed', name === mode ? 'true' : 'false');",
  "  }",
  "}",
  "function setMode(next) {",
  "  if (MODES.indexOf(next) === -1 || next === mode) { return; }",
  "  mode = next;",
  "  paintMode();",
  "  emitState();",
  "}",
  "function setMarkCount(next) {",
  "  var n = typeof next === 'number' && isFinite(next) ? Math.max(0, Math.floor(next)) : 0;",
  "  if (n === markCount) { return; }",
  "  markCount = n;",
  "  emitState();",
  "}",
  "function isOverlayNode(node) {",
  "  return node === host || node === pill || (node && pill.contains(node));",
  "}",
  "function eventTouchesOverlay(e) {",
  "  var path = typeof e.composedPath === 'function' ? e.composedPath() : [];",
  "  for (var i = 0; i < path.length; i++) {",
  "    if (isOverlayNode(path[i])) { return true; }",
  "  }",
  "  return false;",
  "}",
  "function isOverlayTextTarget(e) {",
  "  var path = typeof e.composedPath === 'function' ? e.composedPath() : [];",
  "  for (var i = 0; i < path.length; i++) {",
  "    var n = path[i];",
  "    if (!n || !n.tagName) { continue; }",
  "    var tag = String(n.tagName).toLowerCase();",
  "    if (tag === 'input' || tag === 'textarea' || n.isContentEditable) { return true; }",
  "  }",
  "  return false;",
  "}",
  "function isNavKey(key) {",
  "  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' ||",
  "    key === 'PageUp' || key === 'PageDown' || key === 'Home' || key === 'End' ||",
  "    key === ' ' || key === 'Spacebar';",
  "}",
  "function swallow(e) {",
  "  e.preventDefault();",
  "  e.stopPropagation();",
  "  if (typeof e.stopImmediatePropagation === 'function') { e.stopImmediatePropagation(); }",
  "}",
  "function onPagePointer(e) {",
  "  if (eventTouchesOverlay(e)) { return; }",
  "  swallow(e);",
  "}",
  "function onWheel(e) {",
  "  if (markCount <= 0) { return; }",
  "  swallow(e);",
  "}",
  "function onTouchMove(e) {",
  "  if (markCount <= 0) { return; }",
  "  swallow(e);",
  "}",
  "function onKey(e) {",
  "  if (e.key === 'Escape') {",
  "    swallow(e);",
  "    finishCancelled();",
  "    return;",
  "  }",
  "  if (markCount > 0 && isNavKey(e.key) && !isOverlayTextTarget(e)) {",
  "    swallow(e);",
  "  }",
  "  if (e.altKey || e.ctrlKey || e.metaKey) { return; }",
  "  if (isOverlayTextTarget(e)) { return; }",
  "  var k = String(e.key || '').toLowerCase();",
  "  if (k === 'v') { swallow(e); setMode('select'); }",
  "  else if (k === 'r') { swallow(e); setMode('region'); }",
  "  else if (k === 'd') { swallow(e); setMode('draw'); }",
  "  else if (k === 'e') { swallow(e); setMode('erase'); }",
  "}",
  "function onPillClick(e) {",
  "  var t = e.target;",
  "  if (!t || !t.getAttribute) { return; }",
  "  var next = t.getAttribute('data-mode');",
  "  if (!next) { return; }",
  "  swallow(e);",
  "  setMode(next);",
  "}",
  "function hideChromeForCapture() {",
  "  chromeHidden = true;",
  "  pill.style.visibility = 'hidden';",
  "}",
  "function resetAfterAttach() {",
  "  chromeHidden = false;",
  "  pill.style.visibility = '';",
  "  host.removeAttribute('data-traycer-capture-failed');",
  "  markCount = 0;",
  "  emitState();",
  "}",
  "function captureFailed() {",
  "  chromeHidden = false;",
  "  pill.style.visibility = '';",
  "  host.setAttribute('data-traycer-capture-failed', 'true');",
  "}",
  "function teardown() {",
  "  if (done) { return; }",
  "  done = true;",
  "  W.removeEventListener('mousedown', onPagePointer, true);",
  "  W.removeEventListener('mouseup', onPagePointer, true);",
  "  W.removeEventListener('click', onPagePointer, true);",
  "  W.removeEventListener('auxclick', onPagePointer, true);",
  "  W.removeEventListener('pointerdown', onPagePointer, true);",
  "  W.removeEventListener('wheel', onWheel, { capture: true });",
  "  W.removeEventListener('touchmove', onTouchMove, { capture: true });",
  "  W.removeEventListener('keydown', onKey, true);",
  "  pill.removeEventListener('click', onPillClick, true);",
  "  try { if (host.parentNode) { host.parentNode.removeChild(host); } } catch (e) {}",
  "  try { delete W.__traycerAnnotationCancel; } catch (e) { W.__traycerAnnotationCancel = null; }",
  "  try { delete W.__traycerAnnotationHideChromeForCapture; } catch (e) { W.__traycerAnnotationHideChromeForCapture = null; }",
  "  try { delete W.__traycerAnnotationResetAfterAttach; } catch (e) { W.__traycerAnnotationResetAfterAttach = null; }",
  "  try { delete W.__traycerAnnotationCaptureFailed; } catch (e) { W.__traycerAnnotationCaptureFailed = null; }",
  "  try { delete W.__traycerAnnotationSetMarkCount; } catch (e) { W.__traycerAnnotationSetMarkCount = null; }",
  "}",
  "function finishCancelled() {",
  "  if (done) { return; }",
  "  emit({ type: 'cancelled' });",
  "  teardown();",
  "}",
  "",
  "W.__traycerAnnotationCancel = finishCancelled;",
  "W.__traycerAnnotationHideChromeForCapture = hideChromeForCapture;",
  "W.__traycerAnnotationResetAfterAttach = resetAfterAttach;",
  "W.__traycerAnnotationCaptureFailed = captureFailed;",
  "W.__traycerAnnotationSetMarkCount = setMarkCount;",
  "W.addEventListener('mousedown', onPagePointer, true);",
  "W.addEventListener('mouseup', onPagePointer, true);",
  "W.addEventListener('click', onPagePointer, true);",
  "W.addEventListener('auxclick', onPagePointer, true);",
  "W.addEventListener('pointerdown', onPagePointer, true);",
  "W.addEventListener('wheel', onWheel, { capture: true, passive: false });",
  "W.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });",
  "W.addEventListener('keydown', onKey, true);",
  "pill.addEventListener('click', onPillClick, true);",
  "emitState();",
  "return true;",
  "\n",
].join("\n");

const ATTACH_RECT_MAX = 1_000_000;

/**
 * Trust boundary for `__traycerAnnotation` payloads. Guest-supplied
 * `annotationId` / `screenshot` fields are dropped (ticket 03 trust model).
 */
export function sanitizeAnnotationBindingPayload(
  value: unknown,
): BrowserAnnotationSessionEvent | null {
  const record = parseBindingRecord(value);
  if (record === null) return null;
  const type = record.type;
  if (type === "cancelled") {
    return { type: "cancelled" };
  }
  if (type === "stateChanged") {
    const mode = record.mode;
    if (typeof mode !== "string" || !isAnnotationMode(mode)) return null;
    return {
      type: "stateChanged",
      mode,
      markCount: sanitizeMarkCount(record.markCount),
    };
  }
  if (type === "attachRequested") {
    const payload = sanitizeAttachRequest(record);
    if (payload === null) return null;
    return { type: "attachRequested", payload };
  }
  return null;
}

function parseBindingRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(value) ? value : null;
}

export function sanitizeAttachRequest(
  value: unknown,
): BrowserAnnotationAttachRequest | null {
  if (!isRecord(value)) return null;
  if (containsForbiddenGuestField(value)) return null;
  const source = isRecord(value.payload) ? value.payload : value;
  const unionRect = sanitizeCssRect(source.unionRect);
  if (unionRect === null) return null;
  const comment = boundedString(source.comment, ANNOTATION_LIMITS.comment, "");
  const marks = sanitizeMarks(source.marks);
  const elements = sanitizeElements(source.elements);
  return { marks, elements, comment, unionRect };
}

function sanitizeMarks(value: unknown): BrowserAnnotationMarkSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, ANNOTATION_LIMITS.markCount)
    .flatMap((entry): BrowserAnnotationMarkSnapshot[] => {
      if (!isRecord(entry)) return [];
      const kind = sanitizeMarkKind(entry.kind);
      if (kind === null) return [];
      const bounds = sanitizeCssRect(entry.bounds);
      if (bounds === null) return [];
      const id = boundedString(entry.id, ANNOTATION_LIMITS.markId, "");
      if (id.length === 0) return [];
      return [
        {
          id,
          kind,
          bounds,
          selector:
            kind === "element"
              ? boundedStringOrNull(entry.selector, ANNOTATION_LIMITS.selector)
              : null,
        },
      ];
    });
}

function sanitizeMarkKind(value: unknown): BrowserAnnotationMarkKind | null {
  if (value === "element" || value === "region" || value === "stroke") {
    return value;
  }
  return null;
}

function sanitizeElements(value: unknown): BrowserViewElementCapture[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, ANNOTATION_LIMITS.markCount)
    .flatMap((entry): BrowserViewElementCapture[] => {
      if (!isRecord(entry)) return [];
      const boundingBox = sanitizeCssRect(entry.boundingBox);
      if (boundingBox === null) return [];
      return [
        {
          selector: boundedString(entry.selector, ANNOTATION_LIMITS.selector, ""),
          tagName: boundedString(entry.tagName, 40, "").toLowerCase(),
          elementId: boundedStringOrNull(entry.elementId, 300),
          classNames: sanitizeStringList(entry.classNames, 30, 120),
          attributes: [],
          outerHtml: boundedString(entry.outerHtml, 4000, ""),
          outerHtmlTruncated: entry.outerHtmlTruncated === true,
          textPreview: boundedStringOrNull(entry.textPreview, 200),
          ariaRole: boundedStringOrNull(entry.ariaRole, 64),
          accessibleName: boundedStringOrNull(entry.accessibleName, 300),
          boundingBox: {
            x: boundingBox.x,
            y: boundingBox.y,
            width: boundingBox.width,
            height: boundingBox.height,
            top: finiteNumber(isRecord(entry.boundingBox) ? entry.boundingBox.top : 0),
            right: finiteNumber(
              isRecord(entry.boundingBox) ? entry.boundingBox.right : 0,
            ),
            bottom: finiteNumber(
              isRecord(entry.boundingBox) ? entry.boundingBox.bottom : 0,
            ),
            left: finiteNumber(
              isRecord(entry.boundingBox) ? entry.boundingBox.left : 0,
            ),
          },
          computedStyles: [],
        },
      ];
    });
}

function sanitizeCssRect(value: unknown): BrowserAnnotationCssRect | null {
  if (!isRecord(value)) return null;
  return {
    x: clamp(finiteNumber(value.x), -ATTACH_RECT_MAX, ATTACH_RECT_MAX),
    y: clamp(finiteNumber(value.y), -ATTACH_RECT_MAX, ATTACH_RECT_MAX),
    width: clamp(finiteNumber(value.width), 0, ATTACH_RECT_MAX),
    height: clamp(finiteNumber(value.height), 0, ATTACH_RECT_MAX),
  };
}

function sanitizeMarkCount(value: unknown): number {
  return clamp(Math.floor(finiteNumber(value)), 0, ANNOTATION_LIMITS.markCount);
}

function sanitizeStringList(
  value: unknown,
  maxCount: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxCount)
    .flatMap((entry): string[] =>
      typeof entry === "string" && entry.length > 0
        ? [entry.length > maxLength ? entry.slice(0, maxLength) : entry]
        : [],
    );
}

function boundedString(value: unknown, max: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return value.length > max ? value.slice(0, max) : value;
}

function boundedStringOrNull(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.length > max ? value.slice(0, max) : value;
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function containsForbiddenGuestField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsForbiddenGuestField(entry));
  }
  if (!isRecord(value)) return false;
  if ("annotationId" in value || "screenshot" in value) return true;
  return Object.values(value).some((nested) =>
    containsForbiddenGuestField(nested),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
