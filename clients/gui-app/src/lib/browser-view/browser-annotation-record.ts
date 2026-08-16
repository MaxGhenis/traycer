import {
  browserAnnotationRecordSchema,
  type BrowserAnnotationCounts,
  type BrowserAnnotationRecord as BrowserAnnotationWireRecord,
} from "@traycer/protocol/persistence/epic/schemas";

/**
 * Composer/draft form of the persist wire record: same fields, no
 * `kind` discriminant. Wire adds/removes that one field.
 */
export type BrowserAnnotationRecord = Omit<
  BrowserAnnotationWireRecord,
  "kind"
>;

export type { BrowserAnnotationCounts };

export function browserAnnotationImageFileName(annotationId: string): string {
  return `browser-annotation-${annotationId}.png`;
}

export function toBrowserAnnotationWire(
  record: BrowserAnnotationRecord,
): BrowserAnnotationWireRecord {
  return { kind: "browser-annotation", ...record };
}

export function toComposerAnnotationRecord(
  record: BrowserAnnotationWireRecord,
): BrowserAnnotationRecord {
  const { kind: _kind, ...rest } = record;
  return rest;
}

export function parseBrowserAnnotationRecord(
  value: unknown,
): BrowserAnnotationRecord | null {
  const parsed = browserAnnotationRecordSchema.safeParse(withKind(value));
  if (!parsed.success) return null;
  return toComposerAnnotationRecord(parsed.data);
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
  elements: BrowserAnnotationRecord["elements"],
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

function withKind(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.kind === "browser-annotation") return value;
  return { kind: "browser-annotation", ...value };
}
