import "../../../../__tests__/test-browser-apis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readComposerDraftSnapshot,
  useComposerDraftStore,
  type DraftState,
} from "../composer-draft-store";
import { createBrowserConsoleAttachment } from "@/lib/browser-view/browser-context-attachments";
import type {
  BrowserViewConsoleEntry,
  BrowserViewTileKey,
} from "@/lib/browser-view/desktop-browser-view";

const STORAGE_KEY = "traycer-gui-app:composer-drafts";

const MENTION_DRAFT: DraftState = {
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "mention",
            attrs: {
              contextType: "file",
              id: "/abs/src/index.ts",
              path: "src/index.ts",
              pathKind: "file",
              relPath: "src/index.ts",
              absolutePath: "/abs/src/index.ts",
              workspacePath: "/abs",
              label: "index.ts",
              description: "src/index.ts",
            },
          },
          { type: "text", text: " trailing" },
        ],
      },
    ],
  },
  selection: null,
  resetEpoch: 0,
};

const TILE: BrowserViewTileKey = {
  viewTabId: "view-tab",
  paneId: "pane",
  tileInstanceId: "tile",
  pageSessionId: "page",
};

const CONSOLE_ENTRY: BrowserViewConsoleEntry = {
  id: "console-1",
  timestamp: 1000,
  source: "console-api",
  level: "error",
  text: "boom",
  url: "https://example.com/app.js",
  lineNumber: 4,
  columnNumber: 2,
  stackTrace: [],
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  useComposerDraftStore.setState({ drafts: {} });
});

const EMPTY_DOC: DraftState["content"] = {
  type: "doc",
  content: [{ type: "paragraph" }],
};
const EMPTY_SELECTION: DraftState["selection"] = { from: 1, to: 1 };

describe("composer draft store hydration", () => {
  it("bumps resetEpoch on every persisted draft after hydration so editors push the JSON into Tiptap", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: { drafts: { task1: MENTION_DRAFT } },
      }),
    );

    await useComposerDraftStore.persist.rehydrate();

    const draft = useComposerDraftStore.getState().drafts.task1;
    expect(draft).toBeDefined();
    if (draft === undefined) return;
    expect(draft.resetEpoch).toBe(1);
    const mention = draft.content.content?.[0]?.content?.[0];
    expect(mention?.type).toBe("mention");
    expect(mention?.attrs?.path).toBe("src/index.ts");
  });

  it("leaves drafts map empty on first-ever load", async () => {
    await useComposerDraftStore.persist.rehydrate();
    expect(useComposerDraftStore.getState().drafts).toEqual({});
  });

  it("returns a stable empty draft snapshot without creating store state", () => {
    const notify = vi.fn();
    const unsubscribe = useComposerDraftStore.subscribe(notify);

    const first = readComposerDraftSnapshot("missing-task");
    const second = readComposerDraftSnapshot("missing-task");

    unsubscribe();
    expect(first).toBe(second);
    expect(first.browserContextAttachments).toBe(
      second.browserContextAttachments,
    );
    expect(useComposerDraftStore.getState().drafts).toEqual({});
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps browser context attachment references stable between reads", () => {
    const payload = createBrowserConsoleAttachment({
      tile: TILE,
      pageUrl: "https://example.com/page",
      entry: CONSOLE_ENTRY,
    });

    useComposerDraftStore
      .getState()
      .addBrowserContextAttachment("task-1", payload);

    const first = readComposerDraftSnapshot("task-1");
    const second = readComposerDraftSnapshot("task-1");

    expect(first).toBe(second);
    expect(first.browserContextAttachments).toBe(
      second.browserContextAttachments,
    );
    expect(first.browserContextAttachments).toEqual([payload]);
  });
});

/**
 * clearDraft must broadcast via replaceDraft (empty content + bumped
 * resetEpoch) rather than deleting the map entry. A delete leaves every
 * other mounted composer for the same taskId with a stale Tiptap document
 * because `drafts[taskId]?.resetEpoch ?? 0` is observationally identical
 * before and after a delete of an epoch-0 entry.
 */
describe("composer draft store clearDraft", () => {
  it("resets the entry in place with empty content and a bumped resetEpoch (does not delete)", () => {
    const taskId = "task-clear-1";
    useComposerDraftStore
      .getState()
      .setSnapshot(taskId, MENTION_DRAFT.content, {
        from: 1,
        to: 1,
      });
    const before = useComposerDraftStore.getState().drafts[taskId];
    expect(before).toBeDefined();
    if (before === undefined) return;
    expect(before.resetEpoch).toBe(0);

    useComposerDraftStore.getState().clearDraft(taskId);

    const after = useComposerDraftStore.getState().drafts[taskId];
    expect(after).toBeDefined();
    if (after === undefined) return;
    // Entry must remain so every mounted useChatComposerDraft can observe
    // the epoch change (old clearDraft deleted the key instead).
    expect(taskId in useComposerDraftStore.getState().drafts).toBe(true);
    expect(after.content).toEqual(EMPTY_DOC);
    expect(after.selection).toEqual(EMPTY_SELECTION);
    expect(after.resetEpoch).toBe(before.resetEpoch + 1);
  });

  it("bumps resetEpoch on every successive clear of the same taskId", () => {
    const taskId = "task-clear-2";
    useComposerDraftStore
      .getState()
      .setSnapshot(taskId, MENTION_DRAFT.content, null);

    useComposerDraftStore.getState().clearDraft(taskId);
    const first = useComposerDraftStore.getState().drafts[taskId];
    expect(first?.resetEpoch).toBe(1);

    // Clear again while already empty: a sibling that applied epoch 1 must
    // still observe the second broadcast.
    useComposerDraftStore.getState().clearDraft(taskId);
    const second = useComposerDraftStore.getState().drafts[taskId];
    expect(second?.resetEpoch).toBe(2);
    expect(second?.content).toEqual(EMPTY_DOC);
  });
});
