/**
 * Isolated-world overlay runtime. Bundled into an IIFE by
 * `scripts/bundle-annotation-overlay.cjs` and injected via CDP.
 * Page JS cannot observe this module: it shares the DOM only.
 */
import { getStroke } from "perfect-freehand";
import {
  ANNOTATION_BUNDLE_BYTE_BUDGET,
  ANNOTATION_BUNDLE_ELEMENT_CAP,
  ANNOTATION_STROKE_HALO_SIZE_PX,
  ANNOTATION_STROKE_SIZE_PX,
  canAddElementMark,
  canMutateAnnotation,
  canRequestAttach,
  countElementMarks,
  eraseNewestAtPoint,
  isScrollLockArmed,
  isTinyDrag,
  modeFromHotkey,
  normalizeDragRect,
  placeCommentBox,
  resolveRegionSelection,
  shouldHandleModeHotkey,
  shouldSubmitCommentKey,
  shouldSwallowScrollInput,
  strokeBoundsFromPoints,
  svgPathFromPolygon,
  toMarkSnapshot,
  toggleElementMark,
  unionRects,
  validateElementMark,
  applyByteBudget,
  isElementVisuallyPresent,
  type OverlayMarkModel,
  type RegionCandidate,
} from "./browser-annotation-overlay-logic";

const LIMITS = {
  outerHtml: 4000,
  textPreview: 200,
  attributeCount: 30,
  attributeValue: 300,
  styleCount: 48,
  styleValue: 300,
  classCount: 30,
  className: 120,
  selector: 1000,
  ariaRole: 64,
  accessibleName: 300,
  tagName: 40,
} as const;

const STYLE_PROPS: readonly string[] = [
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

const STROKE_OPTIONS = {
  size: ANNOTATION_STROKE_SIZE_PX,
  thinning: 0.55,
  smoothing: 0.5,
  streamline: 0.45,
  simulatePressure: true,
};

const HALO_OPTIONS = {
  size: ANNOTATION_STROKE_HALO_SIZE_PX,
  thinning: 0.35,
  smoothing: 0.5,
  streamline: 0.45,
  simulatePressure: true,
};

type GuestWindow = Window & {
  __traycerAnnotation?: ((payload: string) => void) | undefined;
  __traycerAnnotationCancel?: (() => void) | undefined;
  __traycerAnnotationHideChromeForCapture?: (() => void) | undefined;
  __traycerAnnotationResetAfterAttach?: (() => void) | undefined;
  __traycerAnnotationCaptureFailed?: (() => void) | undefined;
  __traycerAnnotationSetTargetChatLabel?: ((label: string) => void) | undefined;
};

interface StrokePoint {
  readonly x: number;
  readonly y: number;
}

interface LiveMark {
  model: OverlayMarkModel;
  element: Element | null;
  points: StrokePoint[] | null;
  outline: HTMLElement | null;
  badge: HTMLElement | null;
  haloPath: SVGPathElement | null;
  inkPath: SVGPathElement | null;
  invalid: boolean;
}

function boot(): boolean {
  const W: GuestWindow = window;
  const D = document;

  if (typeof W.__traycerAnnotationCancel === "function") {
    try {
      W.__traycerAnnotationCancel();
    } catch {
      // leftover session
    }
  }
  const leftover = D.querySelector('[data-traycer-annotation="host"]');
  if (leftover && leftover.parentNode) {
    try {
      leftover.parentNode.removeChild(leftover);
    } catch {
      // ignore
    }
  }

  const hostRoot = D.documentElement || D.body;
  if (!hostRoot) return false;

  const host = D.createElement("div");
  host.setAttribute("data-traycer-annotation", "host");
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;pointer-events:none;margin:0;padding:0;";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = D.createElement("style");
  style.textContent = [
    ":host{all:initial;}",
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
    ".pill{position:fixed;top:14px;left:50%;transform:translateX(-50%);display:flex;gap:2px;background:#2c2c31;border-radius:10px;padding:4px;pointer-events:auto;z-index:4;box-shadow:0 8px 24px rgba(0,0,0,.28);}",
    ".pill button{border:0;background:none;color:#c9c9d1;font-size:13px;padding:6px 14px;border-radius:7px;cursor:pointer;}",
    '.pill button[aria-pressed="true"]{background:#4a4a55;color:#8ab4ff;}',
    ".layer{position:fixed;inset:0;pointer-events:none;z-index:1;}",
    ".outline{position:fixed;pointer-events:none;border:2px solid #635bff;box-shadow:0 0 0 4px rgba(255,255,255,.85),0 0 0 5px rgba(17,17,22,.35);background:rgba(99,91,255,.06);border-radius:3px;}",
    ".outline.region{border-color:#5b7cfa;background:rgba(91,124,250,.06);}",
    ".outline.invalid{border-color:#d4a94e;box-shadow:0 0 0 4px rgba(255,255,255,.9),0 0 0 5px rgba(80,50,0,.35);background:rgba(212,169,78,.12);}",
    ".hover{position:fixed;pointer-events:none;border:2px solid #8ab4ff;box-shadow:0 0 0 3px rgba(255,255,255,.7);background:rgba(138,180,255,.08);display:none;border-radius:3px;}",
    ".marquee{position:fixed;pointer-events:none;border:1.5px dashed #5b7cfa;box-shadow:0 0 0 3px rgba(255,255,255,.7);background:rgba(91,124,250,.08);display:none;}",
    ".badge{position:fixed;pointer-events:none;background:#635bff;color:#fff;font-size:11px;padding:2px 7px;border-radius:6px;box-shadow:0 0 0 2px rgba(255,255,255,.9),0 1px 2px rgba(0,0,0,.25);z-index:2;white-space:nowrap;max-width:40vw;overflow:hidden;text-overflow:ellipsis;}",
    ".badge.invalid{background:#d4a94e;color:#1a1204;}",
    ".ink{position:fixed;inset:0;width:100%;height:100%;overflow:visible;}",
    ".ink .halo-light{fill:#fff;opacity:.88;}",
    ".ink .halo-dark{fill:#111218;opacity:.42;}",
    ".ink .pen{fill:#5b7cfa;}",
    ".editor{position:fixed;background:#2c2c31;border-radius:12px;padding:8px 10px;width:min(430px,calc(100vw - 24px));pointer-events:auto;z-index:4;box-shadow:0 10px 28px rgba(0,0,0,.32);display:none;}",
    ".row{display:flex;align-items:flex-end;gap:8px;}",
    ".editor textarea{flex:1;background:none;border:0;color:#e7e7ec;font-size:13px;outline:none;resize:none;min-height:34px;max-height:120px;line-height:1.35;font-family:inherit;}",
    ".editor .attach{background:#635bff;color:#fff;border:0;border-radius:8px;padding:7px 16px;font-size:13px;cursor:pointer;}",
    ".editor .attach:disabled{opacity:.45;cursor:default;}",
    ".target{color:#8a8a92;font-size:10px;margin-top:5px;display:none;}",
    ".refuse{color:#d4a94e;font-size:11px;margin-top:5px;display:none;}",
    ".error{color:#f0b4b4;font-size:11px;margin-top:5px;display:none;}",
  ].join("");

  const layer = D.createElement("div");
  layer.className = "layer";
  const hover = D.createElement("div");
  hover.className = "hover";
  const marquee = D.createElement("div");
  marquee.className = "marquee";
  const svg = D.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ink");
  svg.setAttribute("aria-hidden", "true");

  const pill = D.createElement("div");
  pill.className = "pill";
  pill.setAttribute("role", "toolbar");
  pill.setAttribute("aria-label", "Annotation tools");

  const MODES = ["select", "region", "draw", "erase"] as const;
  const LABELS = {
    select: "Select",
    region: "Region",
    draw: "Draw",
    erase: "Erase",
  };
  const KEYS = { select: "V", region: "R", draw: "D", erase: "E" };
  const buttons: Record<string, HTMLButtonElement> = {};
  for (const modeName of MODES) {
    const btn = D.createElement("button");
    btn.type = "button";
    btn.textContent = LABELS[modeName];
    btn.setAttribute("data-mode", modeName);
    btn.setAttribute("aria-keyshortcuts", KEYS[modeName]);
    btn.setAttribute("aria-pressed", modeName === "select" ? "true" : "false");
    pill.appendChild(btn);
    buttons[modeName] = btn;
  }

  const editor = D.createElement("div");
  editor.className = "editor";
  const row = D.createElement("div");
  row.className = "row";
  const comment = D.createElement("textarea");
  comment.rows = 1;
  comment.placeholder = "Describe the change...";
  comment.setAttribute("aria-label", "Annotation comment");
  const attachBtn = D.createElement("button");
  attachBtn.type = "button";
  attachBtn.className = "attach";
  attachBtn.textContent = "Attach";
  row.appendChild(comment);
  row.appendChild(attachBtn);
  const targetLine = D.createElement("div");
  targetLine.className = "target";
  const refuseLine = D.createElement("div");
  refuseLine.className = "refuse";
  const errorLine = D.createElement("div");
  errorLine.className = "error";
  editor.appendChild(row);
  editor.appendChild(targetLine);
  editor.appendChild(refuseLine);
  editor.appendChild(errorLine);

  shadow.appendChild(style);
  shadow.appendChild(layer);
  layer.appendChild(svg);
  layer.appendChild(hover);
  layer.appendChild(marquee);
  shadow.appendChild(pill);
  shadow.appendChild(editor);
  hostRoot.appendChild(host);

  let mode: (typeof MODES)[number] = "select";
  let markCount = 0;
  let done = false;
  let chromeHidden = false;
  let targetChatLabel = "";
  let refusedCount = 0;
  let attachError = "";
  let attachPending = false;
  let idSeq = 0;
  const liveMarks: LiveMark[] = [];
  const elementKeys = new WeakMap<Element, string>();
  let keySeq = 0;
  let dragStart: { x: number; y: number } | null = null;
  let drawing = false;
  let draftPoints: StrokePoint[] = [];
  let draftHalo: SVGPathElement | null = null;
  let draftHaloDark: SVGPathElement | null = null;
  let draftInk: SVGPathElement | null = null;

  function emit(event: unknown): void {
    const fn = W.__traycerAnnotation;
    if (typeof fn !== "function") return;
    try {
      fn(JSON.stringify(event));
    } catch {
      // binding may be gone
    }
  }

  function emitState(): void {
    emit({ type: "stateChanged", mode, markCount });
  }

  function nextId(prefix: string): string {
    idSeq += 1;
    return prefix + "-" + String(idSeq);
  }

  function keyOf(el: Element): string {
    const existing = elementKeys.get(el);
    if (existing !== undefined) return existing;
    keySeq += 1;
    const key = "el-" + String(keySeq);
    elementKeys.set(el, key);
    return key;
  }

  function paintMode(): void {
    for (const name of MODES) {
      const button = buttons[name];
      if (button === undefined) continue;
      button.setAttribute("aria-pressed", name === mode ? "true" : "false");
    }
  }

  function setMode(next: string): void {
    if (!canMutateAnnotation(attachPending)) return;
    let found: (typeof MODES)[number] | null = null;
    for (const name of MODES) {
      if (name === next) found = name;
    }
    if (found === null || found === mode) return;
    mode = found;
    paintMode();
    hideHover();
    emitState();
  }

  function setMarkCount(next: number): void {
    const n =
      typeof next === "number" && Number.isFinite(next)
        ? Math.max(0, Math.floor(next))
        : 0;
    if (n === markCount) return;
    markCount = n;
    emitState();
    layoutChrome();
  }

  function syncMarkCountFromStack(): void {
    setMarkCount(liveMarks.length);
  }

  function models(): OverlayMarkModel[] {
    return liveMarks.map((entry) => entry.model);
  }

  function isOverlayNode(node: EventTarget | null): boolean {
    if (node === host || node === pill || node === editor) return true;
    if (node instanceof Node && pill.contains(node)) return true;
    if (node instanceof Node && editor.contains(node)) return true;
    return false;
  }

  function eventTouchesOverlay(e: Event): boolean {
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    for (const node of path) {
      if (isOverlayNode(node)) return true;
    }
    return false;
  }

  function isOverlayTextTarget(e: Event): boolean {
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    for (const node of path) {
      if (!(node instanceof HTMLElement)) continue;
      const tag = node.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || node.isContentEditable) {
        return true;
      }
    }
    return false;
  }

  function swallow(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") {
      e.stopImmediatePropagation();
    }
  }

  function cssEscape(value: string): string {
    const css = globalThis.CSS;
    if (css && typeof css.escape === "function") return css.escape(value);
    return value.replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c);
  }

  function bounded(value: unknown, max: number): string {
    const s = value == null ? "" : String(value);
    return s.length > max ? s.slice(0, max) : s;
  }

  function round(n: number): number {
    return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0;
  }

  function rectOf(el: Element): {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
  } {
    try {
      const r = el.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        left: r.left,
      };
    } catch {
      return { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };
    }
  }

  function cssRectOf(el: Element): OverlayMarkModel["bounds"] {
    const r = rectOf(el);
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  function classNamesOf(el: Element): string[] {
    const out: string[] = [];
    const list = el.classList ? el.classList : [];
    for (let i = 0; i < list.length && out.length < LIMITS.classCount; i += 1) {
      const name = String(list[i]);
      if (name) out.push(bounded(name, LIMITS.className));
    }
    return out;
  }

  function attributesOf(el: Element): { name: string; value: string }[] {
    const out: { name: string; value: string }[] = [];
    const attrs = el.attributes ? el.attributes : [];
    for (let i = 0; i < attrs.length && out.length < LIMITS.attributeCount; i += 1) {
      const attr = attrs[i];
      if (attr === undefined) continue;
      out.push({
        name: bounded(attr.name, 120),
        value: bounded(attr.value, LIMITS.attributeValue),
      });
    }
    return out;
  }

  function stylesOf(el: Element): { property: string; value: string }[] {
    const out: { property: string; value: string }[] = [];
    let cs: CSSStyleDeclaration | null = null;
    try {
      cs = W.getComputedStyle(el);
    } catch {
      return out;
    }
    if (!cs) return out;
    for (let i = 0; i < STYLE_PROPS.length && out.length < LIMITS.styleCount; i += 1) {
      const prop = STYLE_PROPS[i];
      if (prop === undefined) continue;
      let value = "";
      try {
        value = cs.getPropertyValue(prop);
      } catch {
        value = "";
      }
      if (value) {
        out.push({ property: prop, value: bounded(value.trim(), LIMITS.styleValue) });
      }
    }
    return out;
  }

  function selectorPath(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 8) {
      const tag = String(node.tagName || "").toLowerCase();
      if (!tag) break;
      if (node.id) {
        const idSel = "#" + cssEscape(node.id);
        try {
          if (D.querySelectorAll(idSel).length === 1) {
            parts.unshift(idSel);
            break;
          }
        } catch {
          // ignore invalid id
        }
      }
      let sel = tag;
      const parent: Element | null = node.parentElement;
      if (parent) {
        const same: Element[] = [];
        const kids = parent.children;
        for (let i = 0; i < kids.length; i += 1) {
          const kid = kids[i];
          if (kid && kid.tagName === node.tagName) same.push(kid);
        }
        if (same.length > 1) sel += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(sel);
      if (!parent || parent === D.documentElement) break;
      node = parent;
      depth += 1;
    }
    return parts.join(" > ");
  }

  function inputRole(type: string | null): string | null {
    const t = (type || "text").toLowerCase();
    if (t === "button" || t === "submit" || t === "reset" || t === "image") {
      return "button";
    }
    if (t === "checkbox") return "checkbox";
    if (t === "radio") return "radio";
    if (t === "range") return "slider";
    if (t === "search") return "searchbox";
    if (t === "email" || t === "tel" || t === "url" || t === "text") return "textbox";
    return null;
  }

  function implicitRole(el: Element): string | null {
    const t = String(el.tagName || "").toLowerCase();
    if (t === "a") return el.hasAttribute("href") ? "link" : null;
    if (t === "input") return inputRole(el.getAttribute("type"));
    if (t === "img") return el.getAttribute("alt") === "" ? "presentation" : "img";
    const map: Record<string, string> = {
      button: "button",
      nav: "navigation",
      main: "main",
      header: "banner",
      footer: "contentinfo",
      aside: "complementary",
      article: "article",
      section: "region",
      ul: "list",
      ol: "list",
      li: "listitem",
      table: "table",
      form: "form",
      select: "combobox",
      textarea: "textbox",
      dialog: "dialog",
      h1: "heading",
      h2: "heading",
      h3: "heading",
      h4: "heading",
      h5: "heading",
      h6: "heading",
    };
    return map[t] ?? null;
  }

  function roleOf(el: Element): string | null {
    const explicit = el.getAttribute ? el.getAttribute("role") : null;
    if (explicit) {
      const first = explicit.trim().split(/\s+/)[0];
      if (first) return bounded(first, LIMITS.ariaRole);
    }
    const implicit = implicitRole(el);
    return implicit ? bounded(implicit, LIMITS.ariaRole) : null;
  }

  function textOf(el: Element): string | null {
    const htmlEl = el instanceof HTMLElement ? el : null;
    const raw =
      htmlEl !== null && typeof htmlEl.innerText === "string"
        ? htmlEl.innerText
        : el.textContent || "";
    const text = raw.replace(/\s+/g, " ").trim();
    return text ? bounded(text, LIMITS.textPreview) : null;
  }

  function accessibleNameOf(el: Element): string | null {
    const label = el.getAttribute ? el.getAttribute("aria-label") : null;
    if (label && label.trim()) return bounded(label.trim(), LIMITS.accessibleName);
    const labelledby = el.getAttribute ? el.getAttribute("aria-labelledby") : null;
    if (labelledby) {
      const names: string[] = [];
      const ids = labelledby.trim().split(/\s+/);
      for (const id of ids) {
        const ref = id ? D.getElementById(id) : null;
        if (ref && ref.textContent) {
          names.push(ref.textContent.replace(/\s+/g, " ").trim());
        }
      }
      const joined = names.join(" ").trim();
      if (joined) return bounded(joined, LIMITS.accessibleName);
    }
    const alt = el.getAttribute ? el.getAttribute("alt") : null;
    if (alt && alt.trim()) return bounded(alt.trim(), LIMITS.accessibleName);
    const title = el.getAttribute ? el.getAttribute("title") : null;
    if (title && title.trim()) return bounded(title.trim(), LIMITS.accessibleName);
    return null;
  }

  function captureElement(el: Element): Record<string, unknown> {
    const rect = rectOf(el);
    const html = String(el instanceof HTMLElement ? el.outerHTML || "" : "");
    const truncated = html.length > LIMITS.outerHtml;
    return {
      selector: bounded(selectorPath(el), LIMITS.selector),
      tagName: bounded(String(el.tagName || "").toLowerCase(), LIMITS.tagName),
      elementId: el.id ? bounded(el.id, LIMITS.attributeValue) : null,
      classNames: classNamesOf(el),
      attributes: attributesOf(el),
      outerHtml: truncated ? html.slice(0, LIMITS.outerHtml) : html,
      outerHtmlTruncated: truncated,
      textPreview: textOf(el),
      ariaRole: roleOf(el),
      accessibleName: accessibleNameOf(el),
      boundingBox: {
        x: round(rect.x),
        y: round(rect.y),
        width: round(rect.width),
        height: round(rect.height),
        top: round(rect.top),
        right: round(rect.right),
        bottom: round(rect.bottom),
        left: round(rect.left),
      },
      computedStyles: stylesOf(el),
    };
  }

  function targetAt(x: number, y: number): Element | null {
    let els: Element[] = [];
    try {
      els = D.elementsFromPoint(x, y) || [];
    } catch {
      els = [];
    }
    for (const el of els) {
      if (el === host) continue;
      if (el === D.documentElement || el === D.body) continue;
      return el;
    }
    return null;
  }

  function computedVisual(el: Element): {
    display: string;
    visibility: string;
    opacity: number;
  } {
    try {
      const cs = W.getComputedStyle(el);
      const opacity = Number.parseFloat(cs.opacity || "1");
      return {
        display: cs.display,
        visibility: cs.visibility,
        opacity: Number.isFinite(opacity) ? opacity : 1,
      };
    } catch {
      return { display: "block", visibility: "visible", opacity: 1 };
    }
  }

  function elementIsVisible(el: Element): boolean {
    const box = cssRectOf(el);
    const visual = computedVisual(el);
    return isElementVisuallyPresent({
      connected: el.isConnected,
      width: box.width,
      height: box.height,
      display: visual.display,
      visibility: visual.visibility,
      opacity: visual.opacity,
    });
  }

  function collectRegionScan(): {
    readonly candidates: RegionCandidate[];
    readonly byId: Map<string, Element>;
  } {
    const nodes = D.querySelectorAll("body *");
    const ids = new WeakMap<Element, string>();
    const byId = new Map<string, Element>();
    let seq = 0;
    const idOf = (el: Element): string => {
      const existing = ids.get(el);
      if (existing !== undefined) return existing;
      seq += 1;
      const id = "n-" + String(seq);
      ids.set(el, id);
      byId.set(id, el);
      return id;
    };
    const markedEls = new Set<Element>();
    for (const entry of liveMarks) {
      if (entry.element !== null) markedEls.add(entry.element);
    }
    const out: RegionCandidate[] = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      if (!(el instanceof Element)) continue;
      if (el === host || host.contains(el)) continue;
      if (el === D.body || el === D.documentElement) continue;
      const ancestorIds: string[] = [];
      let parent: Element | null = el.parentElement;
      while (
        parent !== null &&
        parent !== D.body &&
        parent !== D.documentElement &&
        parent !== host
      ) {
        ancestorIds.push(idOf(parent));
        parent = parent.parentElement;
      }
      out.push({
        id: idOf(el),
        ancestorIds,
        bounds: cssRectOf(el),
        visible: elementIsVisible(el),
        alreadyMarked: markedEls.has(el),
      });
    }
    return { candidates: out, byId };
  }

  function placeBox(node: HTMLElement, rect: OverlayMarkModel["bounds"]): void {
    node.style.display = "block";
    node.style.left = String(rect.x) + "px";
    node.style.top = String(rect.y) + "px";
    node.style.width = String(Math.max(0, rect.width)) + "px";
    node.style.height = String(Math.max(0, rect.height)) + "px";
  }

  function hideHover(): void {
    hover.style.display = "none";
  }

  function strokePathD(points: readonly StrokePoint[], size: number): string {
    const input = points.map((point) => [point.x, point.y] as [number, number]);
    const outline = getStroke(input, size === ANNOTATION_STROKE_HALO_SIZE_PX ? HALO_OPTIONS : STROKE_OPTIONS);
    return svgPathFromPolygon(outline);
  }

  function makePath(className: string): SVGPathElement {
    const path = D.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", className);
    path.setAttribute("fill-rule", "nonzero");
    return path;
  }

  function paintStrokePaths(
    points: readonly StrokePoint[],
    haloLight: SVGPathElement,
    haloDark: SVGPathElement,
    ink: SVGPathElement,
  ): void {
    haloLight.setAttribute("d", strokePathD(points, ANNOTATION_STROKE_HALO_SIZE_PX));
    haloDark.setAttribute("d", strokePathD(points, ANNOTATION_STROKE_HALO_SIZE_PX));
    ink.setAttribute("d", strokePathD(points, ANNOTATION_STROKE_SIZE_PX));
  }

  function badgeLabel(mark: OverlayMarkModel, el: Element | null): string {
    if (mark.kind === "region") return "region";
    if (mark.kind === "stroke") return "draw";
    if (el) return String(el.tagName || "el").toLowerCase();
    if (mark.selector) {
      const tag = mark.selector.split(/[\s.#:>[]/)[0];
      return tag || "el";
    }
    return "el";
  }

  function positionBadge(badge: HTMLElement, bounds: OverlayMarkModel["bounds"]): void {
    let top = bounds.y - 22;
    if (top < 2) top = bounds.y + 4;
    badge.style.left = String(Math.max(0, bounds.x)) + "px";
    badge.style.top = String(top) + "px";
  }

  function paintLiveMark(entry: LiveMark): void {
    const bounds =
      entry.element && entry.element.isConnected
        ? cssRectOf(entry.element)
        : entry.model.bounds;
    entry.model = { ...entry.model, bounds };
    if (entry.outline) {
      placeBox(entry.outline, bounds);
      entry.outline.classList.toggle("invalid", entry.invalid);
      entry.outline.classList.toggle("region", entry.model.kind === "region");
    }
    if (entry.badge) {
      entry.badge.classList.toggle("invalid", entry.invalid);
      entry.badge.textContent = entry.invalid
        ? "re-mark"
        : badgeLabel(entry.model, entry.element);
      positionBadge(entry.badge, bounds);
    }
  }

  function clearInvalid(): void {
    for (const entry of liveMarks) {
      if (!entry.invalid) continue;
      entry.invalid = false;
      paintLiveMark(entry);
    }
  }

  function pushMark(entry: LiveMark): void {
    liveMarks.push(entry);
    if (entry.outline) layer.appendChild(entry.outline);
    if (entry.badge) layer.appendChild(entry.badge);
    syncMarkCountFromStack();
    layoutChrome();
  }

  function destroyMark(entry: LiveMark): void {
    entry.outline?.remove();
    entry.badge?.remove();
    entry.haloPath?.remove();
    entry.inkPath?.remove();
  }

  function findElementMark(key: string): LiveMark | null {
    for (const entry of liveMarks) {
      if (entry.model.kind === "element" && entry.model.elementKey === key) {
        return entry;
      }
    }
    return null;
  }

  function addElementMark(el: Element, allowToggle: boolean): boolean {
    if (!canMutateAnnotation(attachPending)) return false;
    const key = keyOf(el);
    const existing = findElementMark(key);
    if (existing !== null) {
      if (!allowToggle) return false;
      destroyMark(existing);
      const idx = liveMarks.indexOf(existing);
      if (idx >= 0) liveMarks.splice(idx, 1);
      syncMarkCountFromStack();
      layoutChrome();
      return true;
    }
    if (!canAddElementMark(models(), ANNOTATION_BUNDLE_ELEMENT_CAP)) {
      refusedCount += 1;
      layoutChrome();
      return false;
    }
    const next = toggleElementMark(models(), {
      id: nextId("el"),
      elementKey: key,
      bounds: cssRectOf(el),
      selector: selectorPath(el),
    });
    const added = next[next.length - 1];
    if (added === undefined) return false;
    const outline = D.createElement("div");
    outline.className = "outline";
    const badge = D.createElement("div");
    badge.className = "badge";
    const entry: LiveMark = {
      model: added,
      element: el,
      points: null,
      outline,
      badge,
      haloPath: null,
      inkPath: null,
      invalid: false,
    };
    paintLiveMark(entry);
    pushMark(entry);
    return true;
  }

  function addRegionRect(bounds: OverlayMarkModel["bounds"]): void {
    const outline = D.createElement("div");
    outline.className = "outline region";
    const badge = D.createElement("div");
    badge.className = "badge";
    const model: OverlayMarkModel = {
      id: nextId("region"),
      kind: "region",
      bounds,
      selector: null,
      elementKey: null,
    };
    const entry: LiveMark = {
      model,
      element: null,
      points: null,
      outline,
      badge,
      haloPath: null,
      inkPath: null,
      invalid: false,
    };
    paintLiveMark(entry);
    pushMark(entry);
  }

  function addStrokeMark(points: StrokePoint[]): void {
    const bounds = strokeBoundsFromPoints(points, ANNOTATION_STROKE_HALO_SIZE_PX);
    if (bounds === null) return;
    const haloLight = makePath("halo-light");
    const haloDark = makePath("halo-dark");
    const ink = makePath("pen");
    paintStrokePaths(points, haloLight, haloDark, ink);
    svg.appendChild(haloDark);
    svg.appendChild(haloLight);
    svg.appendChild(ink);
    const model: OverlayMarkModel = {
      id: nextId("stroke"),
      kind: "stroke",
      bounds,
      selector: null,
      elementKey: null,
    };
    pushMark({
      model,
      element: null,
      points,
      outline: null,
      badge: null,
      haloPath: haloLight,
      inkPath: ink,
      invalid: false,
    });
  }

  function eraseAt(x: number, y: number): void {
    if (!canMutateAnnotation(attachPending)) return;
    const hit = eraseNewestAtPoint(
      liveMarks.map((entry) => {
        if (entry.element && entry.element.isConnected) {
          return { ...entry.model, bounds: cssRectOf(entry.element) };
        }
        return entry.model;
      }),
      x,
      y,
    );
    if (hit.removed === null) return;
    const idx = liveMarks.findIndex((entry) => entry.model.id === hit.removed?.id);
    if (idx < 0) return;
    const entry = liveMarks[idx];
    if (entry === undefined) return;
    destroyMark(entry);
    liveMarks.splice(idx, 1);
    syncMarkCountFromStack();
    layoutChrome();
  }

  function applyRegion(rect: OverlayMarkModel["bounds"]): void {
    if (!canMutateAnnotation(attachPending)) return;
    const scan = collectRegionScan();
    const resolved = resolveRegionSelection({
      candidates: scan.candidates,
      region: rect,
      existingElementCount: countElementMarks(models()),
      elementCap: ANNOTATION_BUNDLE_ELEMENT_CAP,
    });
    if (resolved.reason === "empty") {
      addRegionRect(rect);
      return;
    }
    let added = 0;
    for (const candidate of resolved.selected) {
      const el = scan.byId.get(candidate.id);
      if (el === undefined) continue;
      if (addElementMark(el, false)) added += 1;
    }
    refusedCount += resolved.refusedCount;
    if (added === 0 && resolved.selected.length === 0) {
      addRegionRect(rect);
    }
    layoutChrome();
  }

  function layoutChrome(): void {
    if (chromeHidden) {
      pill.style.visibility = "hidden";
      editor.style.display = "none";
      hideHover();
      marquee.style.display = "none";
      return;
    }
    pill.style.visibility = "";
    const hasMarks = liveMarks.length > 0;
    editor.style.display = hasMarks ? "block" : "none";
    attachBtn.disabled = attachPending;
    comment.disabled = attachPending;
    for (const name of MODES) {
      const button = buttons[name];
      if (button === undefined) continue;
      button.disabled = attachPending;
    }
    if (targetChatLabel) {
      targetLine.style.display = "block";
      targetLine.textContent = "→ attaching to: " + targetChatLabel;
    } else {
      targetLine.style.display = "none";
      targetLine.textContent = "";
    }
    if (refusedCount > 0) {
      refuseLine.style.display = "block";
      refuseLine.textContent =
        String(refusedCount) +
        (refusedCount === 1 ? " element not included" : " elements not included");
    } else {
      refuseLine.style.display = "none";
      refuseLine.textContent = "";
    }
    if (attachError) {
      errorLine.style.display = "block";
      errorLine.textContent = attachError;
    } else {
      errorLine.style.display = "none";
      errorLine.textContent = "";
    }
    if (!hasMarks) return;
    const union = unionRects(
      liveMarks.map((entry) =>
        entry.element && entry.element.isConnected
          ? cssRectOf(entry.element)
          : entry.model.bounds,
      ),
    );
    const box = editor.getBoundingClientRect();
    const placed = placeCommentBox({
      union,
      viewport: { width: W.innerWidth, height: W.innerHeight },
      box: {
        width: box.width || 430,
        height: box.height || 72,
      },
      pillBottom: 14 + 40,
    });
    editor.style.left = String(placed.x) + "px";
    editor.style.top = String(placed.y) + "px";
  }

  function hideChromeForCapture(): void {
    chromeHidden = true;
    layoutChrome();
  }

  function resetAfterAttach(): void {
    chromeHidden = false;
    attachPending = false;
    host.removeAttribute("data-traycer-capture-failed");
    for (const entry of liveMarks) destroyMark(entry);
    liveMarks.length = 0;
    comment.value = "";
    refusedCount = 0;
    attachError = "";
    hideHover();
    marquee.style.display = "none";
    clearDraftStroke();
    markCount = 0;
    emitState();
    layoutChrome();
  }

  function captureFailed(): void {
    chromeHidden = false;
    attachPending = false;
    attachError = "Couldn't capture the annotated area. Try attach again.";
    host.setAttribute("data-traycer-capture-failed", "true");
    layoutChrome();
  }

  function setTargetChatLabel(label: string): void {
    targetChatLabel = typeof label === "string" ? label : "";
    layoutChrome();
  }

  function clearDraftStroke(): void {
    drawing = false;
    draftPoints = [];
    draftHalo?.remove();
    draftHaloDark?.remove();
    draftInk?.remove();
    draftHalo = null;
    draftHaloDark = null;
    draftInk = null;
  }

  function beginDraftStroke(point: StrokePoint): void {
    drawing = true;
    draftPoints = [point];
    draftHaloDark = makePath("halo-dark");
    draftHalo = makePath("halo-light");
    draftInk = makePath("pen");
    svg.appendChild(draftHaloDark);
    svg.appendChild(draftHalo);
    svg.appendChild(draftInk);
    paintStrokePaths(draftPoints, draftHalo, draftHaloDark, draftInk);
  }

  function extendDraftStroke(point: StrokePoint): void {
    draftPoints.push(point);
    if (draftHalo && draftHaloDark && draftInk) {
      paintStrokePaths(draftPoints, draftHalo, draftHaloDark, draftInk);
    }
  }

  function finishDraftStroke(): void {
    const points = draftPoints.slice();
    clearDraftStroke();
    if (points.length < 2) return;
    addStrokeMark(points);
  }

  function validateAll(): boolean {
    let ok = true;
    for (const entry of liveMarks) {
      if (entry.model.kind !== "element") {
        entry.invalid = false;
        paintLiveMark(entry);
        continue;
      }
      const el = entry.element;
      const connected = el !== null && el.isConnected;
      const visible = el !== null && elementIsVisible(el);
      const currentBox = el !== null && connected ? cssRectOf(el) : entry.model.bounds;
      const status = validateElementMark({
        connected,
        visible,
        currentBox,
        markBox: entry.model.bounds,
      });
      entry.invalid = status !== "ok";
      if (entry.invalid) ok = false;
      paintLiveMark(entry);
    }
    return ok;
  }

  function requestAttach(): void {
    if (
      !canRequestAttach({
        attachPending,
        markCount: liveMarks.length,
      })
    ) {
      return;
    }
    attachError = "";
    if (!validateAll()) {
      attachError = "Some marks need re-marking before attach.";
      layoutChrome();
      return;
    }
    const snapshots = liveMarks.map((entry) => {
      if (entry.element && entry.element.isConnected) {
        return toMarkSnapshot({ ...entry.model, bounds: cssRectOf(entry.element) });
      }
      return toMarkSnapshot(entry.model);
    });
    const captures: Record<string, unknown>[] = [];
    for (const entry of liveMarks) {
      if (entry.model.kind !== "element" || entry.element === null) continue;
      if (!entry.element.isConnected) continue;
      captures.push(captureElement(entry.element));
    }
    const budgeted = applyByteBudget({
      items: captures,
      existingBytes: 0,
      budget: ANNOTATION_BUNDLE_BYTE_BUDGET,
    });
    if (budgeted.refusedCount > 0) {
      refusedCount += budgeted.refusedCount;
    }
    const union = unionRects(snapshots.map((mark) => mark.bounds));
    if (union === null) return;
    attachPending = true;
    layoutChrome();
    emit({
      type: "attachRequested",
      payload: {
        marks: snapshots,
        elements: budgeted.kept,
        comment: comment.value,
        unionRect: union,
      },
    });
  }

  function onPagePointer(e: Event): void {
    if (eventTouchesOverlay(e)) return;
    swallow(e);
  }

  function onWheel(e: Event): void {
    if (
      !shouldSwallowScrollInput({
        armed: isScrollLockArmed(markCount),
        kind: "wheel",
        key: null,
        focusInOverlayText: false,
      })
    ) {
      return;
    }
    swallow(e);
  }

  function onTouchMove(e: Event): void {
    if (
      !shouldSwallowScrollInput({
        armed: isScrollLockArmed(markCount),
        kind: "touchmove",
        key: null,
        focusInOverlayText: false,
      })
    ) {
      return;
    }
    swallow(e);
  }

  function onPointerMove(e: PointerEvent): void {
    if (eventTouchesOverlay(e)) {
      hideHover();
      return;
    }
    if (attachPending) {
      hideHover();
      return;
    }
    if (mode === "select" && dragStart === null && !drawing) {
      const target = targetAt(e.clientX, e.clientY);
      if (target) placeBox(hover, cssRectOf(target));
      else hideHover();
      return;
    }
    hideHover();
    if (mode === "region" && dragStart) {
      placeBox(
        marquee,
        normalizeDragRect(dragStart.x, dragStart.y, e.clientX, e.clientY),
      );
      return;
    }
    if (mode === "draw" && drawing) {
      extendDraftStroke({ x: e.clientX, y: e.clientY });
    }
  }

  function onPointerDown(e: PointerEvent): void {
    if (eventTouchesOverlay(e)) return;
    swallow(e);
    if (e.button !== 0) return;
    if (!canMutateAnnotation(attachPending)) return;
    clearInvalid();
    attachError = "";
    if (mode === "select") {
      const target = targetAt(e.clientX, e.clientY);
      if (target) addElementMark(target, true);
      return;
    }
    if (mode === "erase") {
      eraseAt(e.clientX, e.clientY);
      return;
    }
    dragStart = { x: e.clientX, y: e.clientY };
    if (mode === "draw") beginDraftStroke(dragStart);
  }

  function onPointerUp(e: PointerEvent): void {
    if (eventTouchesOverlay(e) && dragStart === null && !drawing) return;
    if (dragStart === null && !drawing) return;
    swallow(e);
    if (!canMutateAnnotation(attachPending)) {
      clearDraftStroke();
      dragStart = null;
      marquee.style.display = "none";
      return;
    }
    if (mode === "region" && dragStart) {
      const rect = normalizeDragRect(dragStart.x, dragStart.y, e.clientX, e.clientY);
      marquee.style.display = "none";
      if (!isTinyDrag(rect)) applyRegion(rect);
    } else if (mode === "draw") {
      finishDraftStroke();
    }
    dragStart = null;
    layoutChrome();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      swallow(e);
      finishCancelled();
      return;
    }
    const focusInOverlayText = isOverlayTextTarget(e);
    if (
      shouldSwallowScrollInput({
        armed: isScrollLockArmed(markCount),
        kind: "keydown",
        key: e.key,
        focusInOverlayText,
      })
    ) {
      swallow(e);
    }
    if (focusInOverlayText) {
      if (shouldSubmitCommentKey(e)) {
        swallow(e);
        requestAttach();
      }
      return;
    }
    if (e.key === "Enter" && liveMarks.length > 0) {
      swallow(e);
      requestAttach();
      return;
    }
    if (
      shouldHandleModeHotkey({
        key: e.key,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        focusInOverlayText,
      })
    ) {
      const next = modeFromHotkey(e.key);
      if (next === null) return;
      swallow(e);
      setMode(next);
    }
  }

  function onPillClick(e: Event): void {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const next = t.getAttribute("data-mode");
    if (!next) return;
    swallow(e);
    setMode(next);
  }

  function teardown(): void {
    if (done) return;
    done = true;
    W.removeEventListener("mousedown", onPagePointer, true);
    W.removeEventListener("mouseup", onPagePointer, true);
    W.removeEventListener("click", onPagePointer, true);
    W.removeEventListener("auxclick", onPagePointer, true);
    W.removeEventListener("pointerdown", onPointerDown, true);
    W.removeEventListener("pointermove", onPointerMove, true);
    W.removeEventListener("pointerup", onPointerUp, true);
    W.removeEventListener("pointercancel", onPointerUp, true);
    W.removeEventListener("wheel", onWheel, { capture: true });
    W.removeEventListener("touchmove", onTouchMove, { capture: true });
    W.removeEventListener("keydown", onKey, true);
    pill.removeEventListener("click", onPillClick, true);
    attachBtn.removeEventListener("click", onAttachClick);
    try {
      if (host.parentNode) host.parentNode.removeChild(host);
    } catch {
      // ignore
    }
    try {
      delete W.__traycerAnnotationCancel;
    } catch {
      W.__traycerAnnotationCancel = undefined;
    }
    try {
      delete W.__traycerAnnotationHideChromeForCapture;
    } catch {
      W.__traycerAnnotationHideChromeForCapture = undefined;
    }
    try {
      delete W.__traycerAnnotationResetAfterAttach;
    } catch {
      W.__traycerAnnotationResetAfterAttach = undefined;
    }
    try {
      delete W.__traycerAnnotationCaptureFailed;
    } catch {
      W.__traycerAnnotationCaptureFailed = undefined;
    }
    try {
      delete W.__traycerAnnotationSetTargetChatLabel;
    } catch {
      W.__traycerAnnotationSetTargetChatLabel = undefined;
    }
  }

  function finishCancelled(): void {
    if (done) return;
    emit({ type: "cancelled" });
    teardown();
  }

  function onAttachClick(e: Event): void {
    swallow(e);
    requestAttach();
  }

  W.__traycerAnnotationCancel = finishCancelled;
  W.__traycerAnnotationHideChromeForCapture = hideChromeForCapture;
  W.__traycerAnnotationResetAfterAttach = resetAfterAttach;
  W.__traycerAnnotationCaptureFailed = captureFailed;
  W.__traycerAnnotationSetTargetChatLabel = setTargetChatLabel;
  W.addEventListener("mousedown", onPagePointer, true);
  W.addEventListener("mouseup", onPagePointer, true);
  W.addEventListener("click", onPagePointer, true);
  W.addEventListener("auxclick", onPagePointer, true);
  W.addEventListener("pointerdown", onPointerDown, { capture: true, passive: false });
  W.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
  W.addEventListener("pointerup", onPointerUp, { capture: true, passive: false });
  W.addEventListener("pointercancel", onPointerUp, { capture: true, passive: false });
  W.addEventListener("wheel", onWheel, { capture: true, passive: false });
  W.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
  W.addEventListener("keydown", onKey, true);
  pill.addEventListener("click", onPillClick, true);
  attachBtn.addEventListener("click", onAttachClick);
  emitState();
  return true;
}

boot();
