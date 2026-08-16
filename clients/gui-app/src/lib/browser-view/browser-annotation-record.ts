import type {
  BrowserViewElementAttribute,
  BrowserViewElementBoundingBox,
  BrowserViewElementCapture,
  BrowserViewElementStyle,
} from "@/lib/browser-view/desktop-browser-view";

/**
 * One attached annotation bundle in the chat composer draft.
 * Geometry, stroke points, and pixels stay out: the crop image is the visual
 * truth, linked only by `imageHash` + `imageFileName`.
 */
export interface BrowserAnnotationCounts {
  readonly elements: number;
  readonly regions: number;
  readonly strokes: number;
}

export interface BrowserAnnotationRecord {
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
  readonly imageFileName: string;
  readonly imageHash: string;
}

export function browserAnnotationImageFileName(annotationId: string): string {
  return `browser-annotation-${annotationId}.png`;
}

export function parseBrowserAnnotationRecord(
  value: unknown,
): BrowserAnnotationRecord | null {
  if (!isRecord(value)) return null;
  const annotationId = parseNonEmptyString(value.annotationId);
  const tabId = parseNonEmptyString(value.tabId);
  const sessionId = parseNonEmptyString(value.sessionId);
  const origin = parseString(value.origin);
  const pageUrl = parseString(value.pageUrl);
  const pageTitle = parseString(value.pageTitle);
  const capturedAt = parseFiniteNumber(value.capturedAt);
  const comment = parseString(value.comment);
  const counts = parseCounts(value.counts);
  const elements = parseElements(value.elements);
  const imageFileName = parseNonEmptyString(value.imageFileName);
  const imageHash = parseNonEmptyString(value.imageHash);
  if (
    annotationId === null ||
    tabId === null ||
    sessionId === null ||
    origin === null ||
    pageUrl === null ||
    pageTitle === null ||
    capturedAt === null ||
    comment === null ||
    counts === null ||
    elements === null ||
    imageFileName === null ||
    imageHash === null
  ) {
    return null;
  }
  return {
    annotationId,
    tabId,
    sessionId,
    origin,
    pageUrl,
    pageTitle,
    capturedAt,
    comment,
    counts,
    elements,
    imageFileName,
    imageHash,
  };
}

export function parseBrowserAnnotationRecords(
  value: unknown,
): ReadonlyArray<BrowserAnnotationRecord> {
  if (!Array.isArray(value)) return [];
  const records: BrowserAnnotationRecord[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const record = parseBrowserAnnotationRecord(entry);
    if (record === null) continue;
    if (seen.has(record.annotationId)) continue;
    seen.add(record.annotationId);
    records.push(record);
  }
  return records;
}

export function mergeBrowserAnnotationRecords(
  current: ReadonlyArray<BrowserAnnotationRecord>,
  incoming: ReadonlyArray<BrowserAnnotationRecord>,
): ReadonlyArray<BrowserAnnotationRecord> {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map((record) => record.annotationId));
  const appended: BrowserAnnotationRecord[] = [];
  for (const record of incoming) {
    if (seen.has(record.annotationId)) continue;
    seen.add(record.annotationId);
    appended.push(record);
  }
  if (appended.length === 0) return current;
  return [...current, ...appended];
}

export function collectDraftAnnotationImageHashes(
  drafts: Partial<
    Record<
      string,
      { readonly browserAnnotations: ReadonlyArray<BrowserAnnotationRecord> }
    >
  >,
): ReadonlyArray<string> {
  const hashes: string[] = [];
  const seen = new Set<string>();
  for (const draft of Object.values(drafts)) {
    if (draft === undefined) continue;
    for (const record of draft.browserAnnotations) {
      if (seen.has(record.imageHash)) continue;
      seen.add(record.imageHash);
      hashes.push(record.imageHash);
    }
  }
  return hashes;
}

export function annotationTagLabels(
  elements: ReadonlyArray<BrowserViewElementCapture>,
): ReadonlyArray<string> {
  return elements.map((element) =>
    element.tagName.length > 0 ? element.tagName : "element",
  );
}

export function formatAnnotationCounts(
  counts: BrowserAnnotationCounts,
): string {
  const parts: string[] = [];
  if (counts.elements > 0) {
    parts.push(pluralize(counts.elements, "element", "elements"));
  }
  if (counts.regions > 0) {
    parts.push(pluralize(counts.regions, "region", "regions"));
  }
  if (counts.strokes > 0) {
    parts.push(pluralize(counts.strokes, "drawing", "drawings"));
  }
  return parts.join(" · ");
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCounts(value: unknown): BrowserAnnotationCounts | null {
  if (!isRecord(value)) return null;
  const elements = parseFiniteNumber(value.elements);
  const regions = parseFiniteNumber(value.regions);
  const strokes = parseFiniteNumber(value.strokes);
  if (elements === null || regions === null || strokes === null) return null;
  if (elements < 0 || regions < 0 || strokes < 0) return null;
  return { elements, regions, strokes };
}

function parseElements(
  value: unknown,
): ReadonlyArray<BrowserViewElementCapture> | null {
  if (!Array.isArray(value)) return null;
  const elements: BrowserViewElementCapture[] = [];
  for (const entry of value) {
    const element = parseElement(entry);
    if (element === null) return null;
    elements.push(element);
  }
  return elements;
}

function parseElement(value: unknown): BrowserViewElementCapture | null {
  if (!isRecord(value)) return null;
  const selector = parseString(value.selector);
  const tagName = parseString(value.tagName);
  const elementId = parseNullableString(value.elementId);
  const classNames = parseStringArray(value.classNames);
  const attributes = parseAttributes(value.attributes);
  const outerHtml = parseString(value.outerHtml);
  const outerHtmlTruncated = parseBoolean(value.outerHtmlTruncated);
  const textPreview = parseNullableString(value.textPreview);
  const ariaRole = parseNullableString(value.ariaRole);
  const accessibleName = parseNullableString(value.accessibleName);
  const boundingBox = parseBoundingBox(value.boundingBox);
  const computedStyles = parseStyles(value.computedStyles);
  if (
    selector === null ||
    tagName === null ||
    elementId === undefined ||
    classNames === null ||
    attributes === null ||
    outerHtml === null ||
    outerHtmlTruncated === null ||
    textPreview === undefined ||
    ariaRole === undefined ||
    accessibleName === undefined ||
    boundingBox === null ||
    computedStyles === null
  ) {
    return null;
  }
  return {
    selector,
    tagName,
    elementId,
    classNames,
    attributes,
    outerHtml,
    outerHtmlTruncated,
    textPreview,
    ariaRole,
    accessibleName,
    boundingBox,
    computedStyles,
  };
}

function parseNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return undefined;
}

function parseBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    items.push(entry);
  }
  return items;
}

function parseAttributes(
  value: unknown,
): readonly BrowserViewElementAttribute[] | null {
  if (!Array.isArray(value)) return null;
  const items: BrowserViewElementAttribute[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const name = parseString(entry.name);
    const attrValue = parseString(entry.value);
    if (name === null || attrValue === null) return null;
    items.push({ name, value: attrValue });
  }
  return items;
}

function parseStyles(
  value: unknown,
): readonly BrowserViewElementStyle[] | null {
  if (!Array.isArray(value)) return null;
  const items: BrowserViewElementStyle[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const property = parseString(entry.property);
    const styleValue = parseString(entry.value);
    if (property === null || styleValue === null) return null;
    items.push({ property, value: styleValue });
  }
  return items;
}

function parseBoundingBox(
  value: unknown,
): BrowserViewElementBoundingBox | null {
  if (!isRecord(value)) return null;
  const x = parseFiniteNumber(value.x);
  const y = parseFiniteNumber(value.y);
  const width = parseFiniteNumber(value.width);
  const height = parseFiniteNumber(value.height);
  const top = parseFiniteNumber(value.top);
  const right = parseFiniteNumber(value.right);
  const bottom = parseFiniteNumber(value.bottom);
  const left = parseFiniteNumber(value.left);
  if (
    x === null ||
    y === null ||
    width === null ||
    height === null ||
    top === null ||
    right === null ||
    bottom === null ||
    left === null
  ) {
    return null;
  }
  return { x, y, width, height, top, right, bottom, left };
}
