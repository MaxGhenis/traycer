import type {
  BrowserViewElementAttribute,
  BrowserViewElementBoundingBox,
  BrowserViewElementCapture,
  BrowserViewElementPickResult,
  BrowserViewElementStyle,
} from "../../ipc-contracts/browser-view-types";

/**
 * Injected top-frame element picker (ticket 11, decision #25).
 *
 * The bootstrap runs in a dedicated CDP isolated world so page JavaScript can
 * neither observe nor spoof the picker: it shares the DOM but keeps its own JS
 * heap and prototype chain. Everything the script returns is treated as
 * untrusted data and re-bounded by {@link sanitizeElementPickPayload} in the
 * main process before it crosses IPC.
 */

export const ELEMENT_PICKER_WORLD_NAME = "traycer-element-picker";

/**
 * Evaluated (fire-and-forget) in the same isolated world to abort an active
 * pick. Resolves the pending bootstrap promise with a `cancelled` outcome and
 * fully tears the picker down.
 */
export const ELEMENT_PICKER_CANCEL_EXPRESSION =
  "(function(){var fn=globalThis.__traycerElementPickerCancel;" +
  "if(typeof fn==='function'){try{fn();}catch(e){}}return true;})()";

export const ELEMENT_PICKER_LIMITS = {
  outerHtml: 4000,
  textPreview: 200,
  attributeCount: 30,
  attributeValue: 300,
  styleCount: 48,
  styleValue: 300,
  classCount: 30,
  className: 120,
  selector: 1000,
  frameLabel: 300,
  ariaRole: 64,
  accessibleName: 300,
  tagName: 40,
} as const;

const ELEMENT_PICKER_STYLE_PROPS: readonly string[] = [
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "width",
  "height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "box-sizing",
  "color",
  "background-color",
  "background-image",
  "font-size",
  "font-family",
  "font-weight",
  "line-height",
  "text-align",
  "flex-direction",
  "justify-content",
  "align-items",
  "gap",
  "grid-template-columns",
  "grid-template-rows",
  "z-index",
  "opacity",
  "visibility",
  "overflow-x",
  "overflow-y",
  "border-top-width",
  "border-style",
  "border-radius",
  "box-shadow",
  "transform",
  "cursor",
];

/**
 * Builds the self-contained isolated-world bootstrap. Returns a Promise that
 * resolves once the user clicks an element, presses Escape, or the pick is
 * cancelled. The resolved value is one of:
 *   { kind: "picked", element }
 *   { kind: "iframe", frameLabel }
 *   { kind: "cancelled" }
 */
export function buildElementPickerBootstrap(): string {
  const limitsJson = JSON.stringify(ELEMENT_PICKER_LIMITS);
  const stylePropsJson = JSON.stringify(ELEMENT_PICKER_STYLE_PROPS);
  return (
    "(function(){\n" +
    '"use strict";\n' +
    "var W = window, D = document;\n" +
    "var LIMITS = " +
    limitsJson +
    ";\n" +
    "var STYLE_PROPS = " +
    stylePropsJson +
    ";\n" +
    ELEMENT_PICKER_BOOTSTRAP_BODY +
    "})()"
  );
}

// The interactive body of the injected picker. Authored as a plain string so it
// never runs through the bundler; kept dependency-free and ES2019-safe. Uses no
// backticks / template interpolation so it survives string concatenation above.
const ELEMENT_PICKER_BOOTSTRAP_BODY = [
  "if (W.__traycerElementPickerCancel) {",
  "  try { W.__traycerElementPickerCancel(); } catch (e) {}",
  "}",
  "",
  "function bounded(value, max) {",
  "  var s = value == null ? '' : String(value);",
  "  return s.length > max ? s.slice(0, max) : s;",
  "}",
  "function round(n) {",
  "  return typeof n === 'number' && isFinite(n) ? Math.round(n) : 0;",
  "}",
  "function cssEscape(value) {",
  "  var s = String(value);",
  "  if (W.CSS && typeof W.CSS.escape === 'function') { return W.CSS.escape(s); }",
  "  return s.replace(/[^a-zA-Z0-9_-]/g, function (c) { return '\\\\' + c; });",
  "}",
  "function classNamesOf(el) {",
  "  var out = [];",
  "  var list = el.classList ? el.classList : [];",
  "  for (var i = 0; i < list.length && out.length < LIMITS.classCount; i++) {",
  "    var name = String(list[i]);",
  "    if (name) { out.push(bounded(name, LIMITS.className)); }",
  "  }",
  "  return out;",
  "}",
  "function attributesOf(el) {",
  "  var out = [];",
  "  var attrs = el.attributes ? el.attributes : [];",
  "  for (var i = 0; i < attrs.length && out.length < LIMITS.attributeCount; i++) {",
  "    var attr = attrs[i];",
  "    out.push({ name: bounded(attr.name, 120), value: bounded(attr.value, LIMITS.attributeValue) });",
  "  }",
  "  return out;",
  "}",
  "function stylesOf(el) {",
  "  var out = [];",
  "  var cs;",
  "  try { cs = W.getComputedStyle(el); } catch (e) { return out; }",
  "  if (!cs) { return out; }",
  "  for (var i = 0; i < STYLE_PROPS.length && out.length < LIMITS.styleCount; i++) {",
  "    var prop = STYLE_PROPS[i];",
  "    var value = '';",
  "    try { value = cs.getPropertyValue(prop); } catch (e) { value = ''; }",
  "    if (value) { out.push({ property: prop, value: bounded(value.trim(), LIMITS.styleValue) }); }",
  "  }",
  "  return out;",
  "}",
  "function selectorPath(el) {",
  "  var parts = [];",
  "  var node = el;",
  "  var depth = 0;",
  "  while (node && node.nodeType === 1 && depth < 8) {",
  "    var tag = String(node.tagName || '').toLowerCase();",
  "    if (!tag) { break; }",
  "    if (node.id) {",
  "      var idSel = '#' + cssEscape(node.id);",
  "      try {",
  "        if (D.querySelectorAll(idSel).length === 1) { parts.unshift(idSel); break; }",
  "      } catch (e) {}",
  "    }",
  "    var sel = tag;",
  "    var parent = node.parentElement;",
  "    if (parent) {",
  "      var same = [];",
  "      var kids = parent.children;",
  "      for (var i = 0; i < kids.length; i++) {",
  "        if (kids[i].tagName === node.tagName) { same.push(kids[i]); }",
  "      }",
  "      if (same.length > 1) { sel += ':nth-of-type(' + (same.indexOf(node) + 1) + ')'; }",
  "    }",
  "    parts.unshift(sel);",
  "    if (!parent || parent === D.documentElement) { break; }",
  "    node = parent;",
  "    depth++;",
  "  }",
  "  return parts.join(' > ');",
  "}",
  "function inputRole(type) {",
  "  var t = (type || 'text').toLowerCase();",
  "  if (t === 'button' || t === 'submit' || t === 'reset' || t === 'image') { return 'button'; }",
  "  if (t === 'checkbox') { return 'checkbox'; }",
  "  if (t === 'radio') { return 'radio'; }",
  "  if (t === 'range') { return 'slider'; }",
  "  if (t === 'search') { return 'searchbox'; }",
  "  if (t === 'email' || t === 'tel' || t === 'url' || t === 'text') { return 'textbox'; }",
  "  return null;",
  "}",
  "function implicitRole(el) {",
  "  var t = String(el.tagName || '').toLowerCase();",
  "  if (t === 'a') { return el.hasAttribute('href') ? 'link' : null; }",
  "  if (t === 'input') { return inputRole(el.getAttribute('type')); }",
  "  if (t === 'img') { return el.getAttribute('alt') === '' ? 'presentation' : 'img'; }",
  "  var map = {",
  "    button: 'button', nav: 'navigation', main: 'main', header: 'banner',",
  "    footer: 'contentinfo', aside: 'complementary', article: 'article',",
  "    section: 'region', ul: 'list', ol: 'list', li: 'listitem', table: 'table',",
  "    form: 'form', select: 'combobox', textarea: 'textbox', dialog: 'dialog',",
  "    h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading'",
  "  };",
  "  return map[t] || null;",
  "}",
  "function roleOf(el) {",
  "  var explicit = el.getAttribute ? el.getAttribute('role') : null;",
  "  if (explicit) {",
  "    var first = explicit.trim().split(/\\s+/)[0];",
  "    if (first) { return bounded(first, LIMITS.ariaRole); }",
  "  }",
  "  var implicit = implicitRole(el);",
  "  return implicit ? bounded(implicit, LIMITS.ariaRole) : null;",
  "}",
  "function textOf(el) {",
  "  var raw = el.textContent || '';",
  "  var text = raw.replace(/\\s+/g, ' ').trim();",
  "  return text ? bounded(text, LIMITS.textPreview) : null;",
  "}",
  "function accessibleNameOf(el) {",
  "  var label = el.getAttribute ? el.getAttribute('aria-label') : null;",
  "  if (label && label.trim()) { return bounded(label.trim(), LIMITS.accessibleName); }",
  "  var labelledby = el.getAttribute ? el.getAttribute('aria-labelledby') : null;",
  "  if (labelledby) {",
  "    var names = [];",
  "    var ids = labelledby.trim().split(/\\s+/);",
  "    for (var i = 0; i < ids.length; i++) {",
  "      var ref = ids[i] ? D.getElementById(ids[i]) : null;",
  "      if (ref && ref.textContent) { names.push(ref.textContent.replace(/\\s+/g, ' ').trim()); }",
  "    }",
  "    var joined = names.join(' ').trim();",
  "    if (joined) { return bounded(joined, LIMITS.accessibleName); }",
  "  }",
  "  var alt = el.getAttribute ? el.getAttribute('alt') : null;",
  "  if (alt && alt.trim()) { return bounded(alt.trim(), LIMITS.accessibleName); }",
  "  var title = el.getAttribute ? el.getAttribute('title') : null;",
  "  if (title && title.trim()) { return bounded(title.trim(), LIMITS.accessibleName); }",
  "  return null;",
  "}",
  "function iframeState(el) {",
  "  if (!el) { return 'none'; }",
  "  var tag = String(el.tagName || '');",
  "  if (tag !== 'IFRAME' && tag !== 'FRAME') { return 'none'; }",
  "  try {",
  "    var doc = el.contentDocument;",
  "    if (doc == null) { return 'cross-origin'; }",
  "    void doc.location;",
  "    return 'same-origin';",
  "  } catch (e) {",
  "    return 'cross-origin';",
  "  }",
  "}",
  "function capture(el) {",
  "  var rect;",
  "  try { rect = el.getBoundingClientRect(); } catch (e) { rect = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 }; }",
  "  var html = String(el.outerHTML || '');",
  "  var truncated = html.length > LIMITS.outerHtml;",
  "  return {",
  "    selector: bounded(selectorPath(el), LIMITS.selector),",
  "    tagName: bounded(String(el.tagName || '').toLowerCase(), LIMITS.tagName),",
  "    elementId: el.id ? bounded(el.id, LIMITS.attributeValue) : null,",
  "    classNames: classNamesOf(el),",
  "    attributes: attributesOf(el),",
  "    outerHtml: truncated ? html.slice(0, LIMITS.outerHtml) : html,",
  "    outerHtmlTruncated: truncated,",
  "    textPreview: textOf(el),",
  "    ariaRole: roleOf(el),",
  "    accessibleName: accessibleNameOf(el),",
  "    boundingBox: {",
  "      x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height),",
  "      top: round(rect.top), right: round(rect.right), bottom: round(rect.bottom), left: round(rect.left)",
  "    },",
  "    computedStyles: stylesOf(el)",
  "  };",
  "}",
  "function describe(el) {",
  "  if (!el) { return ''; }",
  "  var tag = String(el.tagName || '').toLowerCase();",
  "  var text = tag;",
  "  if (el.id) { text += '#' + el.id; }",
  "  var classes = classNamesOf(el);",
  "  if (classes.length) { text += '.' + classes.slice(0, 3).join('.'); }",
  "  var rect = null;",
  "  try { rect = el.getBoundingClientRect(); } catch (e) {}",
  "  if (rect) { text += '  ' + Math.round(rect.width) + 'x' + Math.round(rect.height); }",
  "  return bounded(text, 160);",
  "}",
  "",
  "var host = D.documentElement || D.body;",
  "var shield = D.createElement('div');",
  "shield.setAttribute('data-traycer-element-picker', 'shield');",
  "shield.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:transparent;margin:0;padding:0;';",
  "var box = D.createElement('div');",
  "box.setAttribute('data-traycer-element-picker', 'box');",
  "box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;box-sizing:border-box;border:2px solid #4f8cff;background:rgba(79,140,255,0.18);display:none;margin:0;padding:0;';",
  "var label = D.createElement('div');",
  "label.setAttribute('data-traycer-element-picker', 'label');",
  "label.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;padding:2px 6px;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;background:#111827;border-radius:3px;white-space:nowrap;display:none;max-width:80vw;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 3px rgba(0,0,0,0.4);';",
  "var ownNodes = [shield, box, label];",
  "if (host) { host.appendChild(shield); host.appendChild(box); host.appendChild(label); }",
  "",
  "function targetAt(x, y) {",
  "  var els;",
  "  try { els = D.elementsFromPoint(x, y) || []; } catch (e) { els = []; }",
  "  for (var i = 0; i < els.length; i++) {",
  "    if (ownNodes.indexOf(els[i]) === -1) { return els[i]; }",
  "  }",
  "  return null;",
  "}",
  "function paint(el, notInspectable, text) {",
  "  if (!el) { box.style.display = 'none'; label.style.display = 'none'; return; }",
  "  var rect;",
  "  try { rect = el.getBoundingClientRect(); } catch (e) { box.style.display = 'none'; label.style.display = 'none'; return; }",
  "  box.style.display = 'block';",
  "  box.style.left = rect.left + 'px';",
  "  box.style.top = rect.top + 'px';",
  "  box.style.width = Math.max(0, rect.width) + 'px';",
  "  box.style.height = Math.max(0, rect.height) + 'px';",
  "  box.style.borderColor = notInspectable ? '#f59e0b' : '#4f8cff';",
  "  box.style.background = notInspectable ? 'rgba(245,158,11,0.18)' : 'rgba(79,140,255,0.18)';",
  "  label.style.display = 'block';",
  "  label.textContent = text;",
  "  var top = rect.top - 22;",
  "  if (top < 2) { top = rect.top + 4; }",
  "  label.style.left = Math.max(0, rect.left) + 'px';",
  "  label.style.top = top + 'px';",
  "}",
  "",
  "return new Promise(function (resolve) {",
  "  var done = false;",
  "  var lastX = 0, lastY = 0;",
  "  function teardown() {",
  "    if (done) { return; }",
  "    done = true;",
  "    W.removeEventListener('mousemove', onMove, true);",
  "    W.removeEventListener('click', onClick, true);",
  "    W.removeEventListener('keydown', onKey, true);",
  "    W.removeEventListener('scroll', onScroll, true);",
  "    for (var i = 0; i < ownNodes.length; i++) {",
  "      try { if (ownNodes[i].parentNode) { ownNodes[i].parentNode.removeChild(ownNodes[i]); } } catch (e) {}",
  "    }",
  "    try { delete W.__traycerElementPickerCancel; } catch (e) { W.__traycerElementPickerCancel = null; }",
  "  }",
  "  function finish(result) { teardown(); resolve(result); }",
  "  function refresh() {",
  "    var el = targetAt(lastX, lastY);",
  "    var state = iframeState(el);",
  "    if (state === 'cross-origin') { paint(el, true, 'iframe \\u00b7 not inspectable'); return; }",
  "    paint(el, false, describe(el));",
  "  }",
  "  function onMove(e) { lastX = e.clientX; lastY = e.clientY; refresh(); }",
  "  function onScroll() { refresh(); }",
  "  function onKey(e) {",
  "    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish({ kind: 'cancelled' }); }",
  "  }",
  "  function onClick(e) {",
  "    e.preventDefault();",
  "    e.stopPropagation();",
  "    if (typeof e.stopImmediatePropagation === 'function') { e.stopImmediatePropagation(); }",
  "    var el = targetAt(e.clientX, e.clientY);",
  "    if (!el) { finish({ kind: 'cancelled' }); return; }",
  "    if (iframeState(el) === 'cross-origin') {",
  "      var src = el.getAttribute ? el.getAttribute('src') : null;",
  "      finish({ kind: 'iframe', frameLabel: src ? bounded(src, LIMITS.frameLabel) : null });",
  "      return;",
  "    }",
  "    finish({ kind: 'picked', element: capture(el) });",
  "  }",
  "  W.__traycerElementPickerCancel = function () { finish({ kind: 'cancelled' }); };",
  "  W.addEventListener('mousemove', onMove, true);",
  "  W.addEventListener('click', onClick, true);",
  "  W.addEventListener('keydown', onKey, true);",
  "  W.addEventListener('scroll', onScroll, true);",
  "});\n",
].join("\n");

/**
 * Validates and re-bounds the untrusted value returned by the injected picker.
 * Runs in the main process; never trusts page-controlled lengths or types.
 */
export function sanitizeElementPickPayload(
  value: unknown,
  pageUrl: string,
): BrowserViewElementPickResult {
  if (!isRecord(value)) {
    return { outcome: "unavailable", reason: "invalid-result" };
  }
  const kind = value.kind;
  if (kind === "cancelled") {
    return { outcome: "cancelled" };
  }
  if (kind === "iframe") {
    return {
      outcome: "iframe-not-inspectable",
      pageUrl,
      frameLabel: boundedStringOrNull(
        value.frameLabel,
        ELEMENT_PICKER_LIMITS.frameLabel,
      ),
    };
  }
  if (kind === "picked") {
    const element = sanitizeCapture(value.element);
    if (element === null) {
      return { outcome: "unavailable", reason: "invalid-element" };
    }
    return { outcome: "picked", pageUrl, element };
  }
  return { outcome: "unavailable", reason: "invalid-result" };
}

function sanitizeCapture(value: unknown): BrowserViewElementCapture | null {
  if (!isRecord(value)) return null;
  const outerHtml = boundedString(
    value.outerHtml,
    ELEMENT_PICKER_LIMITS.outerHtml,
    "",
  );
  return {
    selector: boundedString(value.selector, ELEMENT_PICKER_LIMITS.selector, ""),
    tagName: boundedString(
      value.tagName,
      ELEMENT_PICKER_LIMITS.tagName,
      "",
    ).toLowerCase(),
    elementId: boundedStringOrNull(
      value.elementId,
      ELEMENT_PICKER_LIMITS.attributeValue,
    ),
    classNames: sanitizeStringList(
      value.classNames,
      ELEMENT_PICKER_LIMITS.classCount,
      ELEMENT_PICKER_LIMITS.className,
    ),
    attributes: sanitizeAttributes(value.attributes),
    outerHtml,
    outerHtmlTruncated: value.outerHtmlTruncated === true,
    textPreview: boundedStringOrNull(
      value.textPreview,
      ELEMENT_PICKER_LIMITS.textPreview,
    ),
    ariaRole: boundedStringOrNull(
      value.ariaRole,
      ELEMENT_PICKER_LIMITS.ariaRole,
    ),
    accessibleName: boundedStringOrNull(
      value.accessibleName,
      ELEMENT_PICKER_LIMITS.accessibleName,
    ),
    boundingBox: sanitizeBoundingBox(value.boundingBox),
    computedStyles: sanitizeStyles(value.computedStyles),
  };
}

function sanitizeAttributes(value: unknown): BrowserViewElementAttribute[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, ELEMENT_PICKER_LIMITS.attributeCount)
    .flatMap((entry): BrowserViewElementAttribute[] => {
      if (!isRecord(entry)) return [];
      const name = boundedStringOrNull(entry.name, 120);
      if (name === null) return [];
      return [
        {
          name,
          value: boundedString(
            entry.value,
            ELEMENT_PICKER_LIMITS.attributeValue,
            "",
          ),
        },
      ];
    });
}

const ELEMENT_PICKER_STYLE_PROP_SET = new Set<string>(
  ELEMENT_PICKER_STYLE_PROPS,
);

function sanitizeStyles(value: unknown): BrowserViewElementStyle[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, ELEMENT_PICKER_LIMITS.styleCount)
    .flatMap((entry): BrowserViewElementStyle[] => {
      if (!isRecord(entry)) return [];
      // Trust boundary: only the curated property names are allowed through,
      // regardless of what the (untrusted) page returned.
      if (
        typeof entry.property !== "string" ||
        !ELEMENT_PICKER_STYLE_PROP_SET.has(entry.property)
      ) {
        return [];
      }
      return [
        {
          property: entry.property,
          value: boundedString(
            entry.value,
            ELEMENT_PICKER_LIMITS.styleValue,
            "",
          ),
        },
      ];
    });
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

const ELEMENT_PICKER_BBOX_MAX = 1_000_000;

function sanitizeBoundingBox(value: unknown): BrowserViewElementBoundingBox {
  const record = isRecord(value) ? value : {};
  return {
    x: clampCoordinate(record.x),
    y: clampCoordinate(record.y),
    width: clampSize(record.width),
    height: clampSize(record.height),
    top: clampCoordinate(record.top),
    right: clampCoordinate(record.right),
    bottom: clampCoordinate(record.bottom),
    left: clampCoordinate(record.left),
  };
}

function clampCoordinate(value: unknown): number {
  return clamp(
    finiteNumber(value),
    -ELEMENT_PICKER_BBOX_MAX,
    ELEMENT_PICKER_BBOX_MAX,
  );
}

function clampSize(value: unknown): number {
  return clamp(finiteNumber(value), 0, ELEMENT_PICKER_BBOX_MAX);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
