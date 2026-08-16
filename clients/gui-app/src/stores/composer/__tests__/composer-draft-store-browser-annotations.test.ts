import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";

import {
  attachBrowserAnnotation,
  attachRoutedBrowserAnnotation,
  removeAttachedBrowserAnnotation,
  restoreAttachedBrowserAnnotations,
} from "@/lib/browser-view/browser-annotation-attach";
import { ANNOTATION_ROUTE_NONE_HINT } from "@/lib/browser-view/browser-annotation-router";
import { createStubBrowserAnnotationPayloadFor } from "@/lib/browser-view/__tests__/browser-annotation-fixtures";
import { createBrowserConsoleAttachment } from "@/lib/browser-view/browser-context-attachments";
import type {
  BrowserViewConsoleEntry,
  BrowserViewTileKey,
} from "@/lib/browser-view/desktop-browser-view";
import { landingLiveImageRootHashes } from "@/lib/composer/landing-image-budget";
import { markLandingDraftsReady } from "@/lib/composer/landing-image-gc";
import {
  deleteImage,
  hasLandingImageBytes,
  imageHashKeys,
  putImage,
  releaseSession,
} from "@/lib/composer/landing-image-store";
import {
  useComposerDraftStore,
  type DraftState,
} from "../composer-draft-store";

const STORAGE_KEY = "traycer-gui-app:composer-drafts";

const idbData = vi.hoisted(() => new Map<string, unknown>());

function idbStringKey(key: IDBValidKey): string {
  if (typeof key !== "string") {
    throw new Error("landing image store keys are string hashes");
  }
  return key;
}

function installIdbWorking(): void {
  vi.mocked(idbSet).mockImplementation((key, value) => {
    idbData.set(idbStringKey(key), value);
    return Promise.resolve();
  });
  vi.mocked(idbDel).mockImplementation((key) => {
    idbData.delete(idbStringKey(key));
    return Promise.resolve();
  });
  vi.mocked(idbGet).mockImplementation((key) =>
    Promise.resolve(idbData.get(idbStringKey(key))),
  );
}

vi.mock("idb-keyval", () => {
  const dummyStore = () => Promise.reject(new Error("unused"));
  return {
    createStore: vi.fn(() => dummyStore),
    get: vi.fn((key: string) => Promise.resolve(idbData.get(key))),
    set: vi.fn((key: string, value: unknown) => {
      idbData.set(key, value);
      return Promise.resolve();
    }),
    del: vi.fn((key: string) => {
      idbData.delete(key);
      return Promise.resolve();
    }),
    keys: vi.fn(() => Promise.resolve(Array.from(idbData.keys()))),
  };
});

const EMPTY_DOC: DraftState["content"] = {
  type: "doc",
  content: [{ type: "paragraph" }],
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

let urlCounter = 0;
const createObjectURL = vi.fn(
  (_obj: Blob | MediaSource) => `blob:mock/${++urlCounter}`,
);
const revokeObjectURL = vi.fn((_url: string) => undefined);

async function drainImages(): Promise<void> {
  for (const hash of await imageHashKeys()) {
    await deleteImage(hash);
    releaseSession(hash);
  }
}

async function attachNamed(
  chatId: string,
  input: {
    readonly annotationId: string;
    readonly tabId: string;
    readonly sessionId: string;
    readonly comment: string;
  },
): Promise<{
  readonly hash: string;
  readonly annotationId: string;
}> {
  const stub = createStubBrowserAnnotationPayloadFor(input);
  const result = await attachBrowserAnnotation({
    chatId,
    payload: stub.payload,
    png: stub.png,
  });
  expect(result.status).toBe("attached");
  if (result.status !== "attached") {
    throw new Error(`expected attached, got ${result.status}`);
  }
  return {
    hash: result.record.imageHash,
    annotationId: result.record.annotationId,
  };
}

function draftOf(taskId: string): DraftState {
  const draft = useComposerDraftStore.getState().drafts[taskId];
  expect(draft).toBeDefined();
  if (draft === undefined) {
    throw new Error(`missing draft ${taskId}`);
  }
  return draft;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function persistedAnnotationOf(
  stored: string | null,
  taskId: string,
): { readonly annotationId: string; readonly imageHash: string } {
  if (stored === null) {
    throw new Error("missing composer-draft persist payload");
  }
  const parsed: unknown = JSON.parse(stored);
  if (!isRecord(parsed) || !isRecord(parsed.state)) {
    throw new Error("persist payload is not a draft map");
  }
  if (!isRecord(parsed.state.drafts)) {
    throw new Error("persist payload has no drafts");
  }
  const draft = parsed.state.drafts[taskId];
  if (!isRecord(draft) || !Array.isArray(draft.browserAnnotations)) {
    throw new Error(`persist draft ${taskId} has no browserAnnotations`);
  }
  const first: unknown = draft.browserAnnotations[0];
  if (!isRecord(first)) {
    throw new Error(`persist draft ${taskId} annotation is not a record`);
  }
  if (
    typeof first.annotationId !== "string" ||
    typeof first.imageHash !== "string"
  ) {
    throw new Error(`persist draft ${taskId} annotation is missing ids`);
  }
  return { annotationId: first.annotationId, imageHash: first.imageHash };
}

beforeEach(async () => {
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  installIdbWorking();
  await drainImages();
  vi.clearAllMocks();
  installIdbWorking();
  window.localStorage.clear();
  useComposerDraftStore.setState({ drafts: {} });
  markLandingDraftsReady();
});

afterEach(async () => {
  await drainImages();
  window.localStorage.clear();
  useComposerDraftStore.setState({ drafts: {} });
});

describe("composer draft store browserAnnotations", () => {
  it("Add: appends the record after bytes are already in the image store", async () => {
    const stub = createStubBrowserAnnotationPayloadFor({
      annotationId: "ann-add",
      tabId: "tab-add",
      sessionId: "session-add",
      comment: "Make the heading larger",
    });
    const hash = await putImage(stub.png);
    expect(hasLandingImageBytes(hash)).toBe(true);

    const record = {
      annotationId: stub.payload.annotationId,
      tabId: stub.payload.tabId,
      sessionId: stub.payload.sessionId,
      origin: stub.payload.origin,
      pageUrl: stub.payload.pageUrl,
      pageTitle: stub.payload.pageTitle,
      capturedAt: stub.payload.capturedAt,
      comment: stub.payload.comment,
      counts: stub.payload.counts,
      elements: stub.payload.elements,
      imageFileName: `browser-annotation-${stub.payload.annotationId}.png`,
      imageHash: hash,
    };
    useComposerDraftStore.getState().addBrowserAnnotation("chat-add", record);

    const draft = draftOf("chat-add");
    expect(draft.browserAnnotations).toEqual([record]);
    expect(await imageHashKeys()).toContain(hash);
    expect(landingLiveImageRootHashes().has(hash)).toBe(true);
  });

  it("Add: same annotationId is a no-op (no second copy, no epoch bump)", async () => {
    const first = await attachNamed("chat-dedupe", {
      annotationId: "ann-dup",
      tabId: "tab-dup",
      sessionId: "session-dup",
      comment: "first",
    });
    const before = draftOf("chat-dedupe");

    const stub = createStubBrowserAnnotationPayloadFor({
      annotationId: "ann-dup",
      tabId: "tab-other",
      sessionId: "session-other",
      comment: "second copy must not land",
    });
    const result = await attachBrowserAnnotation({
      chatId: "chat-dedupe",
      payload: stub.payload,
      png: stub.png,
    });
    expect(result.status).toBe("attached");

    const after = draftOf("chat-dedupe");
    expect(after.browserAnnotations).toHaveLength(1);
    expect(after.browserAnnotations[0]?.annotationId).toBe(first.annotationId);
    expect(after.browserAnnotations[0]?.comment).toBe("first");
    expect(after.resetEpoch).toBe(before.resetEpoch);
  });

  it("X: removeAttachedBrowserAnnotation removes the record and stored image together", async () => {
    const attached = await attachNamed("chat-remove", {
      annotationId: "ann-remove",
      tabId: "tab-remove",
      sessionId: "session-remove",
      comment: "drop me",
    });
    expect(hasLandingImageBytes(attached.hash)).toBe(true);

    removeAttachedBrowserAnnotation("chat-remove", attached.annotationId);

    expect(draftOf("chat-remove").browserAnnotations).toEqual([]);
    await vi.waitFor(async () => {
      expect(hasLandingImageBytes(attached.hash)).toBe(false);
      expect(await imageHashKeys()).not.toContain(attached.hash);
    });
    expect(landingLiveImageRootHashes().has(attached.hash)).toBe(false);
  });

  it("X: a shared image hash stays when another record still references it", async () => {
    const firstStub = createStubBrowserAnnotationPayloadFor({
      annotationId: "ann-share-a",
      tabId: "tab-a",
      sessionId: "session-share",
      comment: "first card",
    });
    const secondStub = createStubBrowserAnnotationPayloadFor({
      annotationId: "ann-share-b",
      tabId: "tab-b",
      sessionId: "session-share",
      comment: "second card",
    });
    const first = await attachBrowserAnnotation({
      chatId: "chat-share",
      payload: firstStub.payload,
      png: firstStub.png,
    });
    const second = await attachBrowserAnnotation({
      chatId: "chat-share",
      payload: secondStub.payload,
      png: firstStub.png,
    });
    expect(first.status).toBe("attached");
    expect(second.status).toBe("attached");
    if (first.status !== "attached" || second.status !== "attached") {
      throw new Error("expected both attaches");
    }
    expect(first.record.imageHash).toBe(second.record.imageHash);
    expect(draftOf("chat-share").browserAnnotations).toHaveLength(2);

    removeAttachedBrowserAnnotation("chat-share", first.record.annotationId);

    expect(
      draftOf("chat-share").browserAnnotations.map((r) => r.annotationId),
    ).toEqual(["ann-share-b"]);
    await Promise.resolve();
    expect(hasLandingImageBytes(first.record.imageHash)).toBe(true);
    expect(await imageHashKeys()).toContain(first.record.imageHash);

    removeAttachedBrowserAnnotation("chat-share", second.record.annotationId);
    await vi.waitFor(async () => {
      expect(hasLandingImageBytes(first.record.imageHash)).toBe(false);
      expect(await imageHashKeys()).not.toContain(first.record.imageHash);
    });
  });

  it("Rehydrate: persist.rehydrate includes records and image hashes", async () => {
    const stub = createStubBrowserAnnotationPayloadFor({
      annotationId: "ann-persist",
      tabId: "tab-persist",
      sessionId: "session-persist",
      comment: "survives relaunch",
    });
    const hash = await putImage(stub.png);
    const persistedRecord = {
      annotationId: stub.payload.annotationId,
      tabId: stub.payload.tabId,
      sessionId: stub.payload.sessionId,
      origin: stub.payload.origin,
      pageUrl: stub.payload.pageUrl,
      pageTitle: stub.payload.pageTitle,
      capturedAt: stub.payload.capturedAt,
      comment: stub.payload.comment,
      counts: stub.payload.counts,
      elements: stub.payload.elements,
      imageFileName: `browser-annotation-${stub.payload.annotationId}.png`,
      imageHash: hash,
    };
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          drafts: {
            "chat-persist": {
              content: EMPTY_DOC,
              selection: null,
              browserAnnotations: [persistedRecord],
              resetEpoch: 0,
              revision: 2,
            },
          },
        },
      }),
    );

    await useComposerDraftStore.persist.rehydrate();

    const draft = draftOf("chat-persist");
    expect(draft.browserAnnotations).toEqual([persistedRecord]);
    expect(draft.browserAnnotations[0]?.imageHash).toBe(hash);
    expect(landingLiveImageRootHashes().has(hash)).toBe(true);
    expect(draft.resetEpoch).toBe(1);
    expect(draft.revision).toBe(2);
  });

  it("Rehydrate: a live add is written into persist so a later rehydrate keeps it", async () => {
    const attached = await attachNamed("chat-roundtrip", {
      annotationId: "ann-roundtrip",
      tabId: "tab-roundtrip",
      sessionId: "session-roundtrip",
      comment: "persisted add",
    });
    const stored = window.localStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();
    const persisted = persistedAnnotationOf(stored, "chat-roundtrip");
    expect(persisted).toEqual({
      annotationId: attached.annotationId,
      imageHash: attached.hash,
    });

    // setState persists; write the captured payload back so rehydrate sees it.
    useComposerDraftStore.setState({ drafts: {} });
    window.localStorage.setItem(STORAGE_KEY, stored ?? "");
    await useComposerDraftStore.persist.rehydrate();

    const restored = draftOf("chat-roundtrip").browserAnnotations;
    expect(restored).toHaveLength(1);
    expect(restored[0]?.annotationId).toBe(attached.annotationId);
    expect(restored[0]?.imageHash).toBe(attached.hash);
  });

  it("Rehydrate: legacy drafts without browserAnnotations become []", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          drafts: {
            "chat-legacy": {
              content: EMPTY_DOC,
              selection: null,
              resetEpoch: 0,
              revision: 4,
            },
          },
        },
      }),
    );

    await useComposerDraftStore.persist.rehydrate();

    const draft = draftOf("chat-legacy");
    expect(draft.browserAnnotations).toEqual([]);
    expect(draft.revision).toBe(4);
  });

  it("Accepted send: clearDraft clears browserAnnotations and leaves browserContextAttachments", async () => {
    const attached = await attachNamed("chat-send", {
      annotationId: "ann-send",
      tabId: "tab-send",
      sessionId: "session-send",
      comment: "goes out with the message",
    });
    const context = createBrowserConsoleAttachment({
      tile: TILE,
      pageUrl: "https://example.com/page",
      entry: CONSOLE_ENTRY,
    });
    useComposerDraftStore
      .getState()
      .addBrowserContextAttachment("chat-send", context);
    useComposerDraftStore
      .getState()
      .setSnapshot("chat-send", EMPTY_DOC, { from: 1, to: 1 });
    const before = draftOf("chat-send");
    expect(before.browserAnnotations).toHaveLength(1);
    expect(before.browserContextAttachments).toEqual([context]);

    useComposerDraftStore.getState().clearDraft("chat-send");

    const after = draftOf("chat-send");
    expect(after.browserAnnotations).toEqual([]);
    expect(after.browserContextAttachments).toEqual([context]);
    expect(after.content).toEqual(EMPTY_DOC);
    expect(after.resetEpoch).toBe(before.resetEpoch + 1);
    expect(after.revision).toBe(before.revision + 1);
    expect(hasLandingImageBytes(attached.hash)).toBe(true);
  });

  it("Rejected send: restoreBrowserAnnotations puts records back without duplication", async () => {
    const attached = await attachNamed("chat-reject", {
      annotationId: "ann-reject",
      tabId: "tab-reject",
      sessionId: "session-reject",
      comment: "retry me",
    });
    const snapshot = draftOf("chat-reject").browserAnnotations;
    useComposerDraftStore.getState().clearDraft("chat-reject");
    expect(draftOf("chat-reject").browserAnnotations).toEqual([]);

    useComposerDraftStore
      .getState()
      .restoreBrowserAnnotations("chat-reject", snapshot);
    expect(draftOf("chat-reject").browserAnnotations).toEqual(snapshot);

    useComposerDraftStore
      .getState()
      .restoreBrowserAnnotations("chat-reject", snapshot);
    expect(draftOf("chat-reject").browserAnnotations).toHaveLength(1);
    expect(draftOf("chat-reject").browserAnnotations[0]?.annotationId).toBe(
      attached.annotationId,
    );
  });

  it("Rejected send: restoreAttachedBrowserAnnotations is a no-op when the id is already present", async () => {
    const attached = await attachNamed("chat-restore-api", {
      annotationId: "ann-restore-api",
      tabId: "tab-restore-api",
      sessionId: "session-restore-api",
      comment: "already here",
    });
    const existing = draftOf("chat-restore-api").browserAnnotations;
    const epoch = draftOf("chat-restore-api").resetEpoch;

    restoreAttachedBrowserAnnotations("chat-restore-api", existing);

    const after = draftOf("chat-restore-api");
    expect(after.browserAnnotations).toHaveLength(1);
    expect(after.browserAnnotations[0]?.annotationId).toBe(
      attached.annotationId,
    );
    expect(after.resetEpoch).toBe(epoch);
  });

  it("attachRoutedBrowserAnnotation does not store when the route is none", async () => {
    const stub = createStubBrowserAnnotationPayloadFor({
      annotationId: "ann-none",
      tabId: "tab-none",
      sessionId: "session-none",
      comment: "nowhere to go",
    });
    const result = await attachRoutedBrowserAnnotation({
      route: { kind: "none", hint: ANNOTATION_ROUTE_NONE_HINT },
      payload: stub.payload,
      png: stub.png,
    });
    expect(result).toEqual({
      status: "none",
      hint: ANNOTATION_ROUTE_NONE_HINT,
    });
    expect(useComposerDraftStore.getState().drafts).toEqual({});
    expect(await imageHashKeys()).toEqual([]);
  });
});
