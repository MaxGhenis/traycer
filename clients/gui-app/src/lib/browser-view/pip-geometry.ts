import type { EpicPipGeometry } from "@/stores/epics/canvas/types";

export const PIP_MIN_WIDTH = 240;
export const PIP_MIN_HEIGHT = 148;
export const PIP_MAX_WIDTH = 480;
export const PIP_MAX_HEIGHT = 360;
export const PIP_DEFAULT_WIDTH = 320;
export const PIP_DEFAULT_HEIGHT = 200;
export const PIP_VIEWPORT_MARGIN = 16;
export const PIP_DEFAULT_BOTTOM_INSET = 56;
export const PIP_NUDGE_PX = 8;
export const PIP_RESIZE_STEP_PX = 16;

export type PipCorner = "bottom-right" | "bottom-left" | "top-left" | "top-right";

export const PIP_CORNER_CYCLE: readonly PipCorner[] = [
  "bottom-right",
  "bottom-left",
  "top-left",
  "top-right",
];

export function defaultPipGeometry(
  viewport: ViewportSize,
): EpicPipGeometry {
  const width = Math.min(PIP_DEFAULT_WIDTH, maxWidthForViewport(viewport));
  const height = Math.min(PIP_DEFAULT_HEIGHT, maxHeightForViewport(viewport));
  return clampPipGeometry(
    {
      x: viewport.width - width - PIP_VIEWPORT_MARGIN,
      y: viewport.height - height - PIP_DEFAULT_BOTTOM_INSET,
      width,
      height,
    },
    viewport,
  );
}

export function clampPipGeometry(
  geometry: EpicPipGeometry,
  viewport: ViewportSize,
): EpicPipGeometry {
  const maxWidth = maxWidthForViewport(viewport);
  const maxHeight = maxHeightForViewport(viewport);
  const width = clampNumber(geometry.width, PIP_MIN_WIDTH, maxWidth);
  const height = clampNumber(geometry.height, PIP_MIN_HEIGHT, maxHeight);
  const maxX = Math.max(PIP_VIEWPORT_MARGIN, viewport.width - width - PIP_VIEWPORT_MARGIN);
  const maxY = Math.max(PIP_VIEWPORT_MARGIN, viewport.height - height - PIP_VIEWPORT_MARGIN);
  return {
    x: clampNumber(geometry.x, PIP_VIEWPORT_MARGIN, maxX),
    y: clampNumber(geometry.y, PIP_VIEWPORT_MARGIN, maxY),
    width,
    height,
  };
}

export function geometryForCorner(
  corner: PipCorner,
  size: { readonly width: number; readonly height: number },
  viewport: ViewportSize,
): EpicPipGeometry {
  const width = clampNumber(size.width, PIP_MIN_WIDTH, maxWidthForViewport(viewport));
  const height = clampNumber(
    size.height,
    PIP_MIN_HEIGHT,
    maxHeightForViewport(viewport),
  );
  const right = viewport.width - width - PIP_VIEWPORT_MARGIN;
  const bottom = viewport.height - height - PIP_DEFAULT_BOTTOM_INSET;
  const left = PIP_VIEWPORT_MARGIN;
  const top = PIP_VIEWPORT_MARGIN;
  switch (corner) {
    case "bottom-right":
      return clampPipGeometry({ x: right, y: bottom, width, height }, viewport);
    case "bottom-left":
      return clampPipGeometry({ x: left, y: bottom, width, height }, viewport);
    case "top-left":
      return clampPipGeometry({ x: left, y: top, width, height }, viewport);
    case "top-right":
      return clampPipGeometry({ x: right, y: top, width, height }, viewport);
  }
}

export function nextPipCorner(current: EpicPipGeometry, viewport: ViewportSize): PipCorner {
  const midX = current.x + current.width / 2;
  const midY = current.y + current.height / 2;
  const right = midX >= viewport.width / 2;
  const bottom = midY >= viewport.height / 2;
  const currentCorner = cornerFromQuadrant(right, bottom);
  const index = PIP_CORNER_CYCLE.indexOf(currentCorner);
  return PIP_CORNER_CYCLE[(index + 1) % PIP_CORNER_CYCLE.length];
}

export function readViewportSize(): ViewportSize {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

function maxWidthForViewport(viewport: ViewportSize): number {
  return Math.max(
    PIP_MIN_WIDTH,
    Math.min(PIP_MAX_WIDTH, viewport.width - PIP_VIEWPORT_MARGIN * 2),
  );
}

function maxHeightForViewport(viewport: ViewportSize): number {
  return Math.max(
    PIP_MIN_HEIGHT,
    Math.min(PIP_MAX_HEIGHT, viewport.height - PIP_VIEWPORT_MARGIN * 2),
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cornerFromQuadrant(right: boolean, bottom: boolean): PipCorner {
  if (bottom && right) return "bottom-right";
  if (bottom) return "bottom-left";
  if (right) return "top-right";
  return "top-left";
}
