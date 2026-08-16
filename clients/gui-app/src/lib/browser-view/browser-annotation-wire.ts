import type { BrowserAnnotationRecord as BrowserAnnotationWireRecord } from "@traycer/protocol/persistence/epic/schemas";

import type { BrowserAnnotationRecord } from "@/lib/browser-view/browser-annotation-record";

export function toBrowserAnnotationWire(
  record: BrowserAnnotationRecord,
): BrowserAnnotationWireRecord {
  return {
    kind: "browser-annotation",
    annotationId: record.annotationId,
    tabId: record.tabId,
    sessionId: record.sessionId,
    origin: record.origin,
    pageUrl: record.pageUrl,
    pageTitle: record.pageTitle,
    capturedAt: record.capturedAt,
    comment: record.comment,
    counts: {
      elements: record.counts.elements,
      regions: record.counts.regions,
      strokes: record.counts.strokes,
    },
    elements: record.elements.map((element) => ({
      selector: element.selector,
      tagName: element.tagName,
      elementId: element.elementId,
      classNames: [...element.classNames],
      attributes: element.attributes.map((attribute) => ({
        name: attribute.name,
        value: attribute.value,
      })),
      outerHtml: element.outerHtml,
      outerHtmlTruncated: element.outerHtmlTruncated,
      textPreview: element.textPreview,
      ariaRole: element.ariaRole,
      accessibleName: element.accessibleName,
      boundingBox: { ...element.boundingBox },
      computedStyles: element.computedStyles.map((style) => ({
        property: style.property,
        value: style.value,
      })),
    })),
    imageFileName: record.imageFileName,
    imageHash: record.imageHash,
  };
}

export function toComposerAnnotationRecord(
  record: BrowserAnnotationWireRecord,
): BrowserAnnotationRecord {
  return {
    annotationId: record.annotationId,
    tabId: record.tabId,
    sessionId: record.sessionId,
    origin: record.origin,
    pageUrl: record.pageUrl,
    pageTitle: record.pageTitle,
    capturedAt: record.capturedAt,
    comment: record.comment,
    counts: record.counts,
    elements: record.elements,
    imageFileName: record.imageFileName,
    imageHash: record.imageHash,
  };
}
