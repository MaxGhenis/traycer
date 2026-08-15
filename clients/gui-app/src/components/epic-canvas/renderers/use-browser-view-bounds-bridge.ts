import { useEffect, type RefObject } from "react";
import {
  rectFromDomRect,
  registerBrowserOverlayTile,
  updateBrowserOverlayTileRect,
} from "@/lib/browser-view/browser-overlay-coordinator";
import type {
  BrowserViewBounds,
  BrowserViewBoundsUpdate,
  BrowserViewTileKey,
} from "@/lib/browser-view/desktop-browser-view";
import { PANEL_RESIZING_CLASS_NAME } from "@/lib/layout/panel-resizing-class";

export interface BrowserViewBoundsBridge {
  updateBounds(input: BrowserViewBoundsUpdate): Promise<void>;
}

interface UseBrowserViewBoundsBridgeArgs {
  readonly browserView: BrowserViewBoundsBridge | null;
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
  readonly tileKey: BrowserViewTileKey;
  readonly visible: boolean;
}

/**
 * Shared bounds + overlay-registry bridge for every Electron tile.
 * Both user and agent tiles punch through popovers unless the overlay
 * coordinator knows their live rect, so this hook is capability-agnostic.
 */
export function useBrowserViewBoundsBridge(
  args: UseBrowserViewBoundsBridgeArgs,
): void {
  const { browserView, surfaceRef, tileKey, visible } = args;

  useEffect(() => {
    const surface = surfaceRef.current;
    if (browserView === null || surface === null || !visible) return;
    const unregisterOverlayTile = registerBrowserOverlayTile({
      key: tileKey,
      rect: rectFromDomRect(surface.getBoundingClientRect()),
    });

    let frameId: number | null = null;
    let frozen = document.documentElement.classList.contains(
      PANEL_RESIZING_CLASS_NAME,
    );

    const sendBounds = (force: boolean): void => {
      const rect = surface.getBoundingClientRect();
      const bounds = readElementBounds(rect);
      if (bounds.width <= 0 || bounds.height <= 0) return;
      if (frozen && !force) return;
      updateBrowserOverlayTileRect(tileKey, rectFromDomRect(rect));
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        void browserView
          .updateBounds({ ...tileKey, bounds })
          .catch(ignoreBrowserViewError);
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      sendBounds(false);
    });
    const mutationObserver = new MutationObserver(() => {
      const nextFrozen = document.documentElement.classList.contains(
        PANEL_RESIZING_CLASS_NAME,
      );
      if (frozen && !nextFrozen) {
        frozen = false;
        sendBounds(true);
        return;
      }
      frozen = nextFrozen;
    });
    resizeObserver.observe(surface);
    mutationObserver.observe(document.documentElement, {
      attributeFilter: ["class"],
      attributes: true,
    });
    window.addEventListener("resize", handleWindowResize, { passive: true });
    sendBounds(false);

    function handleWindowResize(): void {
      sendBounds(false);
    }

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", handleWindowResize);
      unregisterOverlayTile();
    };
  }, [browserView, surfaceRef, tileKey, visible]);
}

function readElementBounds(rect: DOMRectReadOnly): BrowserViewBounds {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function ignoreBrowserViewError(_error: unknown): void {}
