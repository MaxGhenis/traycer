import { describe, expect, it } from "vitest";
import {
  ELEMENT_PICKER_CANCEL_EXPRESSION,
  ELEMENT_PICKER_LIMITS,
  ELEMENT_PICKER_WORLD_NAME,
  buildElementPickerBootstrap,
  sanitizeElementPickPayload,
} from "../browser-element-picker-script";

const PAGE_URL = "http://localhost:3000/app";

describe("buildElementPickerBootstrap", () => {
  it("produces a self-contained isolated-world IIFE", () => {
    const source = buildElementPickerBootstrap();
    expect(source.startsWith("(function(){")).toBe(true);
    expect(source.endsWith("})()")).toBe(true);
    // Bakes the shared limits and interaction wiring into the injected string.
    expect(source).toContain(String(ELEMENT_PICKER_LIMITS.outerHtml));
    expect(source).toContain("elementsFromPoint");
    expect(source).toContain("typeof el.innerText === 'string'");
    expect(source).toContain("__traycerElementPickerCancel");
    expect(source).toContain("return new Promise");
  });

  it("cancel expression targets the injected global", () => {
    expect(ELEMENT_PICKER_CANCEL_EXPRESSION).toContain(
      "__traycerElementPickerCancel",
    );
    expect(ELEMENT_PICKER_WORLD_NAME).toBe("traycer-element-picker");
  });
});

describe("sanitizeElementPickPayload", () => {
  it("maps the cancelled sentinel", () => {
    expect(sanitizeElementPickPayload({ kind: "cancelled" }, PAGE_URL)).toEqual(
      {
        outcome: "cancelled",
      },
    );
  });

  it("maps a cross-origin iframe hit with a bounded frame label", () => {
    const result = sanitizeElementPickPayload(
      { kind: "iframe", frameLabel: "https://other.example/embed" },
      PAGE_URL,
    );
    expect(result).toEqual({
      outcome: "iframe-not-inspectable",
      pageUrl: PAGE_URL,
      frameLabel: "https://other.example/embed",
    });
  });

  it("treats a missing iframe label as null", () => {
    const result = sanitizeElementPickPayload({ kind: "iframe" }, PAGE_URL);
    expect(result).toMatchObject({
      outcome: "iframe-not-inspectable",
      frameLabel: null,
    });
  });

  it("trusts the main-process page url, not the page-supplied one", () => {
    const result = sanitizeElementPickPayload(
      { kind: "iframe", frameLabel: "x", pageUrl: "https://evil.example" },
      PAGE_URL,
    );
    expect(result).toMatchObject({ pageUrl: PAGE_URL });
  });

  it("bounds untrusted picked element data", () => {
    const hugeHtml = "<div>".repeat(4000);
    const attributes = Array.from({ length: 100 }, (_unused, index) => ({
      name: `data-${index}`,
      value: "v".repeat(1000),
    }));
    const styles = Array.from({ length: 200 }, () => ({
      property: "display",
      value: "z".repeat(1000),
    }));
    const result = sanitizeElementPickPayload(
      {
        kind: "picked",
        element: {
          selector: "s".repeat(5000),
          tagName: "BUTTON",
          elementId: "submit",
          classNames: [1, "keep", null, "keep2"],
          attributes,
          outerHtml: hugeHtml,
          outerHtmlTruncated: true,
          textPreview: "hello",
          ariaRole: "button",
          accessibleName: "Submit",
          boundingBox: {
            x: 1.2,
            y: 2,
            width: 3,
            height: 4,
            top: 2,
            right: 4,
            bottom: 6,
            left: 1.2,
            extra: "ignored",
          },
          computedStyles: styles,
          extraField: "dropped",
        },
      },
      PAGE_URL,
    );
    expect(result.outcome).toBe("picked");
    if (result.outcome !== "picked") throw new Error("expected picked");
    const element = result.element;
    expect(element.selector.length).toBe(ELEMENT_PICKER_LIMITS.selector);
    expect(element.tagName).toBe("button");
    expect(element.outerHtml.length).toBe(ELEMENT_PICKER_LIMITS.outerHtml);
    expect(element.attributes.length).toBe(
      ELEMENT_PICKER_LIMITS.attributeCount,
    );
    expect(element.attributes[0].value.length).toBe(
      ELEMENT_PICKER_LIMITS.attributeValue,
    );
    expect(element.classNames).toEqual(["keep", "keep2"]);
    expect(element.computedStyles.length).toBe(
      ELEMENT_PICKER_LIMITS.styleCount,
    );
    expect(element.computedStyles[0].value.length).toBe(
      ELEMENT_PICKER_LIMITS.styleValue,
    );
    expect(element.boundingBox.x).toBe(1.2);
    expect(Object.keys(element.boundingBox)).not.toContain("extra");
    expect(Object.keys(element)).not.toContain("extraField");
  });

  it("drops computed styles outside the curated whitelist", () => {
    const result = sanitizeElementPickPayload(
      {
        kind: "picked",
        element: {
          selector: "div",
          tagName: "div",
          outerHtml: "<div></div>",
          boundingBox: {},
          attributes: [],
          classNames: [],
          computedStyles: [
            { property: "display", value: "grid" },
            { property: "content", value: "url(https://evil.example)" },
            { property: "--injected", value: "1" },
            { property: "color", value: "red" },
          ],
        },
      },
      PAGE_URL,
    );
    if (result.outcome !== "picked") throw new Error("expected picked");
    expect(result.element.computedStyles).toEqual([
      { property: "display", value: "grid" },
      { property: "color", value: "red" },
    ]);
  });

  it("clamps oversized bounding box magnitudes", () => {
    const result = sanitizeElementPickPayload(
      {
        kind: "picked",
        element: {
          selector: "div",
          tagName: "div",
          outerHtml: "<div></div>",
          boundingBox: {
            x: 1e308,
            y: -1e308,
            width: -50,
            height: 5e12,
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
          },
          attributes: [],
          classNames: [],
          computedStyles: [],
        },
      },
      PAGE_URL,
    );
    if (result.outcome !== "picked") throw new Error("expected picked");
    const box = result.element.boundingBox;
    expect(box.x).toBe(1_000_000);
    expect(box.y).toBe(-1_000_000);
    expect(box.width).toBe(0);
    expect(box.height).toBe(1_000_000);
  });

  it("coerces non-finite bounding box numbers to zero", () => {
    const result = sanitizeElementPickPayload(
      {
        kind: "picked",
        element: {
          selector: "button",
          tagName: "button",
          outerHtml: "<button></button>",
          boundingBox: { x: Number.NaN, width: "10", height: 5 },
          computedStyles: [],
          attributes: [],
          classNames: [],
        },
      },
      PAGE_URL,
    );
    if (result.outcome !== "picked") throw new Error("expected picked");
    expect(result.element.boundingBox.x).toBe(0);
    expect(result.element.boundingBox.width).toBe(0);
    expect(result.element.boundingBox.height).toBe(5);
  });

  it("rejects malformed payloads as unavailable", () => {
    expect(sanitizeElementPickPayload(null, PAGE_URL)).toEqual({
      outcome: "unavailable",
      reason: "invalid-result",
    });
    expect(sanitizeElementPickPayload({ kind: "picked" }, PAGE_URL)).toEqual({
      outcome: "unavailable",
      reason: "invalid-element",
    });
    expect(sanitizeElementPickPayload({ kind: "mystery" }, PAGE_URL)).toEqual({
      outcome: "unavailable",
      reason: "invalid-result",
    });
  });
});
