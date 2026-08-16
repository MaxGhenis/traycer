import { describe, expect, it } from "vitest";
import {
  ANNOTATION_BINDING_NAME,
  ANNOTATION_CANCEL_EXPRESSION,
  ANNOTATION_CAPTURE_FAILED_EXPRESSION,
  ANNOTATION_HIDE_CHROME_EXPRESSION,
  ANNOTATION_LIMITS,
  ANNOTATION_RESET_AFTER_ATTACH_EXPRESSION,
  ANNOTATION_WORLD_NAME,
  buildAnnotationOverlayBootstrap,
  buildAnnotationSetMarkCountExpression,
  sanitizeAnnotationBindingPayload,
  sanitizeAttachRequest,
} from "../browser-annotation-overlay-script";

const UNION = { x: 4, y: 8, width: 16, height: 24 };

const VALID_ATTACH = {
  marks: [
    {
      id: "mark-1",
      kind: "region" as const,
      bounds: UNION,
      selector: null,
    },
  ],
  elements: [],
  comment: "note",
  unionRect: UNION,
};

describe("buildAnnotationOverlayBootstrap", () => {
  it("produces a self-contained isolated-world IIFE with the overlay shell", () => {
    const source = buildAnnotationOverlayBootstrap();
    expect(source.startsWith("(function(){")).toBe(true);
    expect(source.endsWith("})()")).toBe(true);
    expect(source).toContain("attachShadow");
    expect(source).toContain("Select");
    expect(source).toContain("Region");
    expect(source).toContain("Draw");
    expect(source).toContain("Erase");
    expect(source).toContain(ANNOTATION_BINDING_NAME);
    expect(source).toContain("__traycerAnnotationCancel");
    expect(source).toContain("__traycerAnnotationHideChromeForCapture");
    expect(source).toContain("__traycerAnnotationResetAfterAttach");
    expect(source).toContain("__traycerAnnotationCaptureFailed");
    expect(source).toContain("__traycerAnnotationSetMarkCount");
    expect(source).toContain("JSON.stringify");
    expect(source).toContain("Escape");
  });

  it("exposes named command expressions and the isolated world name", () => {
    expect(ANNOTATION_WORLD_NAME).toBe("traycer-annotation");
    expect(ANNOTATION_BINDING_NAME).toBe("__traycerAnnotation");
    expect(ANNOTATION_CANCEL_EXPRESSION).toContain("__traycerAnnotationCancel");
    expect(ANNOTATION_HIDE_CHROME_EXPRESSION).toContain(
      "__traycerAnnotationHideChromeForCapture",
    );
    expect(ANNOTATION_RESET_AFTER_ATTACH_EXPRESSION).toContain(
      "__traycerAnnotationResetAfterAttach",
    );
    expect(ANNOTATION_CAPTURE_FAILED_EXPRESSION).toContain(
      "__traycerAnnotationCaptureFailed",
    );
    expect(buildAnnotationSetMarkCountExpression(2)).toContain(
      "__traycerAnnotationSetMarkCount",
    );
    expect(buildAnnotationSetMarkCountExpression(2)).toContain("2");
  });
});

describe("sanitizeAnnotationBindingPayload", () => {
  it("maps cancelled", () => {
    expect(sanitizeAnnotationBindingPayload({ type: "cancelled" })).toEqual({
      type: "cancelled",
    });
    expect(
      sanitizeAnnotationBindingPayload(JSON.stringify({ type: "cancelled" })),
    ).toEqual({ type: "cancelled" });
  });

  it("maps stateChanged and rejects an invalid mode", () => {
    expect(
      sanitizeAnnotationBindingPayload({
        type: "stateChanged",
        mode: "select",
        markCount: 0,
      }),
    ).toEqual({ type: "stateChanged", mode: "select", markCount: 0 });
    expect(
      sanitizeAnnotationBindingPayload({
        type: "stateChanged",
        mode: "lasso",
        markCount: 1,
      }),
    ).toBeNull();
  });

  it("maps a valid attachRequested payload", () => {
    expect(
      sanitizeAnnotationBindingPayload({
        type: "attachRequested",
        payload: VALID_ATTACH,
      }),
    ).toEqual({
      type: "attachRequested",
      payload: VALID_ATTACH,
    });
  });

  it("rejects attachRequested when annotationId or screenshot is supplied", () => {
    expect(
      sanitizeAnnotationBindingPayload({
        type: "attachRequested",
        annotationId: "guest",
        payload: VALID_ATTACH,
      }),
    ).toBeNull();
    expect(
      sanitizeAnnotationBindingPayload({
        type: "attachRequested",
        screenshot: "pixels",
        payload: VALID_ATTACH,
      }),
    ).toBeNull();
  });

  it("rejects annotationId or screenshot nested anywhere in the payload", () => {
    expect(
      sanitizeAnnotationBindingPayload({
        type: "attachRequested",
        payload: { ...VALID_ATTACH, annotationId: "guest" },
      }),
    ).toBeNull();
    expect(
      sanitizeAnnotationBindingPayload({
        type: "attachRequested",
        payload: { ...VALID_ATTACH, screenshot: "pixels" },
      }),
    ).toBeNull();
    expect(
      sanitizeAnnotationBindingPayload({
        type: "attachRequested",
        payload: {
          ...VALID_ATTACH,
          marks: [
            {
              ...VALID_ATTACH.marks[0],
              annotationId: "smuggled",
            },
          ],
        },
      }),
    ).toBeNull();
    expect(
      sanitizeAnnotationBindingPayload({
        type: "attachRequested",
        payload: {
          ...VALID_ATTACH,
          elements: [{ screenshot: "data:image/png;base64,abc" }],
        },
      }),
    ).toBeNull();
  });

  it("drops raw unknown types", () => {
    expect(sanitizeAnnotationBindingPayload({ type: "mystery" })).toBeNull();
    expect(
      sanitizeAnnotationBindingPayload({
        type: "ended",
        reason: "navigation",
      }),
    ).toBeNull();
    expect(sanitizeAnnotationBindingPayload("not-json")).toBeNull();
    expect(sanitizeAnnotationBindingPayload(null)).toBeNull();
  });
});

describe("sanitizeAttachRequest", () => {
  it("accepts a valid payload and drops extra fields", () => {
    const result = sanitizeAttachRequest({
      ...VALID_ATTACH,
      extra: "ignored",
    });
    expect(result).toEqual(VALID_ATTACH);
    expect(result === null ? [] : Object.keys(result)).toEqual([
      "marks",
      "elements",
      "comment",
      "unionRect",
    ]);
  });

  it("rejects guest-supplied annotationId or screenshot", () => {
    expect(
      sanitizeAttachRequest({ ...VALID_ATTACH, annotationId: "guest" }),
    ).toBeNull();
    expect(
      sanitizeAttachRequest({ ...VALID_ATTACH, screenshot: "png" }),
    ).toBeNull();
  });

  it("rejects annotationId or screenshot nested under payload or marks", () => {
    expect(
      sanitizeAttachRequest({
        type: "attachRequested",
        payload: { ...VALID_ATTACH, annotationId: "guest" },
      }),
    ).toBeNull();
    expect(
      sanitizeAttachRequest({
        ...VALID_ATTACH,
        marks: [{ ...VALID_ATTACH.marks[0], screenshot: "x" }],
      }),
    ).toBeNull();
  });

  it("requires a unionRect and bounds comment length", () => {
    expect(sanitizeAttachRequest({ comment: "x" })).toBeNull();
    const longComment = "c".repeat(ANNOTATION_LIMITS.comment + 20);
    const result = sanitizeAttachRequest({
      unionRect: UNION,
      comment: longComment,
    });
    expect(result?.comment).toHaveLength(ANNOTATION_LIMITS.comment);
  });

  it("forces stroke and region selectors to null", () => {
    const result = sanitizeAttachRequest({
      unionRect: UNION,
      marks: [
        {
          id: "s1",
          kind: "stroke",
          bounds: UNION,
          selector: "canvas",
        },
      ],
    });
    expect(result?.marks[0]?.selector).toBeNull();
  });
});
