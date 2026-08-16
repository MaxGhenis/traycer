import { displayTitle } from "@/lib/display-title";
import { selectSiblingChatIdForBrowserTile } from "@/lib/browser-view/browser-tile-chat-routing";
import type { EpicCanvasState } from "@/stores/epics/canvas/types";

export const ANNOTATION_ROUTE_NONE_HINT =
  "Open or focus a chat in this task to attach.";

export type AnnotationRouteSource = "sibling" | "last-focused";

export type AnnotationRoute =
  | {
      readonly kind: "chat";
      readonly chatId: string;
      readonly label: string;
      readonly source: AnnotationRouteSource;
    }
  | {
      readonly kind: "none";
      readonly hint: string;
    };

export interface AnnotationRouteChat {
  readonly title: string;
}

export interface ResolveAnnotationRouteInput {
  readonly canvas: EpicCanvasState | null;
  readonly browserInstanceId: string;
  readonly lastFocusedChatId: string | null;
  /**
   * Epic chat registry lookup. Return null when the id is missing, deleted,
   * or archived so last-focused cannot target an orphan draft.
   */
  readonly resolveChat: (chatId: string) => AnnotationRouteChat | null;
}

/**
 * Epic-scoped annotation target: visible split sibling, else the last-focused
 * chat in this epic, else none (Attach disabled + hint). Replaces tile-local
 * routing for annotations only.
 */
/**
 * Overlay comment-box target. Sibling stays unnamed; last-focused shows
 * the chat title; none shows the hint and disables Attach.
 */
export function overlayTargetFromRoute(route: AnnotationRoute): {
  readonly label: string;
  readonly canAttach: boolean;
} {
  if (route.kind === "none") {
    return { label: route.hint, canAttach: false };
  }
  if (route.source === "sibling") {
    return { label: "", canAttach: true };
  }
  return { label: route.label, canAttach: true };
}

export function resolveAnnotationRoute(
  input: ResolveAnnotationRouteInput,
): AnnotationRoute {
  const siblingChatId = selectSiblingChatIdForBrowserTile(
    input.canvas,
    input.browserInstanceId,
  );
  if (siblingChatId !== null) {
    const sibling = resolveRoutedChat(
      input.resolveChat,
      siblingChatId,
      input.canvas,
    );
    if (sibling !== null) {
      return {
        kind: "chat",
        chatId: siblingChatId,
        label: sibling,
        source: "sibling",
      };
    }
  }
  if (input.lastFocusedChatId !== null && input.lastFocusedChatId.length > 0) {
    const focused = input.resolveChat(input.lastFocusedChatId);
    if (focused !== null) {
      return {
        kind: "chat",
        chatId: input.lastFocusedChatId,
        label: displayTitle(focused.title, "chat"),
        source: "last-focused",
      };
    }
  }
  return { kind: "none", hint: ANNOTATION_ROUTE_NONE_HINT };
}

export function chatLabelFromCanvas(
  canvas: EpicCanvasState | null,
  chatId: string,
): string | null {
  if (canvas === null) return null;
  for (const tile of Object.values(canvas.tilesByInstanceId)) {
    if (tile === undefined) continue;
    if (tile.type === "chat" && tile.id === chatId) {
      return tile.name;
    }
  }
  return null;
}

export function chatLabelFromCanvases(
  canvases: ReadonlyArray<EpicCanvasState>,
  chatId: string,
): string | null {
  for (const canvas of canvases) {
    const label = chatLabelFromCanvas(canvas, chatId);
    if (label !== null) return label;
  }
  return null;
}

function resolveRoutedChat(
  resolveChat: (chatId: string) => AnnotationRouteChat | null,
  chatId: string,
  canvas: EpicCanvasState | null,
): string | null {
  const resolved = resolveChat(chatId);
  if (resolved !== null) return displayTitle(resolved.title, "chat");
  const canvasName = chatLabelFromCanvas(canvas, chatId);
  if (canvasName === null) return null;
  return displayTitle(canvasName, "chat");
}
