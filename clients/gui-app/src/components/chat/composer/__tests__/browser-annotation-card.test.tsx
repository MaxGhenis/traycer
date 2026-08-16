import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserSessionInfo,
  BrowserTabInfo,
} from "@traycer/protocol/host/browser/contracts";

import { BrowserAnnotationCard } from "@/components/chat/composer/browser-annotation-card";
import { BrowserAnnotationCards } from "@/components/chat/composer/browser-annotation-cards";
import {
  BrowserSessionsContext,
  type BrowserSessionsState,
} from "@/components/epic-canvas/renderers/browser-sessions-context";
import type { BrowserAnnotationRecord } from "@/lib/browser-view/browser-annotation-record";
import {
  STUB_ANNOTATION_ELEMENT,
  STUB_ANNOTATION_PARAGRAPH,
  createStubBrowserAnnotationPayloadFor,
} from "@/lib/browser-view/__tests__/browser-annotation-fixtures";
import {
  deleteImage,
  getImageBytes,
  imageHashKeys,
  putImage,
  releaseSession,
  sessionObjectUrl,
} from "@/lib/composer/landing-image-store";
import { useComposerDraftStore } from "@/stores/composer/composer-draft-store";

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

const LONG_COMMENT =
  "Please enlarge the hero heading and add more breathing room under the fold so the page feels less cramped on first paint";

const EXTRA_ELEMENT: BrowserAnnotationRecord["elements"][number] = {
  ...STUB_ANNOTATION_ELEMENT,
  selector: "main > button",
  tagName: "button",
  classNames: [...STUB_ANNOTATION_ELEMENT.classNames],
  outerHtml: "<button>Go</button>",
  textPreview: "Go",
  ariaRole: "button",
  accessibleName: "Go",
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

function makeRecord(
  overrides: Partial<BrowserAnnotationRecord> & {
    readonly annotationId: string;
    readonly tabId: string;
  },
): BrowserAnnotationRecord {
  return {
    annotationId: overrides.annotationId,
    tabId: overrides.tabId,
    sessionId: overrides.sessionId ?? "session-card",
    origin: overrides.origin ?? "https://example.com",
    pageUrl: overrides.pageUrl ?? "https://example.com/",
    pageTitle: overrides.pageTitle ?? "Example Domain",
    capturedAt: overrides.capturedAt ?? 1_700_000_000_000,
    comment: overrides.comment ?? LONG_COMMENT,
    counts: overrides.counts ?? { elements: 2, regions: 0, strokes: 1 },
    elements: overrides.elements ?? [
      STUB_ANNOTATION_ELEMENT,
      STUB_ANNOTATION_PARAGRAPH,
    ],
    imageFileName:
      overrides.imageFileName ??
      `browser-annotation-${overrides.annotationId}.png`,
    imageHash: overrides.imageHash ?? "missing-hash",
  };
}

function tab(
  overrides: Partial<BrowserTabInfo> & Pick<BrowserTabInfo, "tabId" | "url">,
): BrowserTabInfo {
  return {
    originTier: "dev",
    status: "ready",
    title: null,
    viewed: false,
    drivenBy: [],
    ...overrides,
  };
}

function session(
  overrides: Partial<BrowserSessionInfo> &
    Pick<BrowserSessionInfo, "sessionId" | "tabs">,
): BrowserSessionInfo {
  return {
    epicId: "epic-1",
    hostId: "host-1",
    profile: "primary",
    name: "Agent browser",
    createdBy: { chatId: "chat-1", agentRunId: null },
    createdAt: 1,
    lastActivityAt: 2,
    ...overrides,
  };
}

function sessionsState(
  items: ReadonlyArray<BrowserSessionInfo>,
): BrowserSessionsState {
  return {
    lifecycle: "live",
    items,
    errorMessage: null,
    routingChatId: null,
    closeSession: vi.fn(),
    requestPromoteState: vi.fn(),
    requestLendStorage: vi.fn(),
  };
}

async function landingFetcher(hash: string): Promise<{
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mediaType: string | null;
}> {
  const bytes = await getImageBytes(hash);
  if (bytes === undefined) {
    throw new Error(`Landing image ${hash} unavailable`);
  }
  return { bytes, mediaType: null };
}

function renderCard(
  record: BrowserAnnotationRecord,
  onRemove: (annotationId: string) => void,
  items: ReadonlyArray<BrowserSessionInfo> | null,
): void {
  const card = (
    <BrowserAnnotationCard
      record={record}
      onRemove={onRemove}
      imageFetcher={landingFetcher}
      sessionObjectUrl={sessionObjectUrl}
    />
  );
  if (items === null) {
    render(card);
    return;
  }
  render(
    <BrowserSessionsContext.Provider value={sessionsState(items)}>
      {card}
    </BrowserSessionsContext.Provider>,
  );
}

beforeEach(async () => {
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  installIdbWorking();
  await drainImages();
  vi.clearAllMocks();
  installIdbWorking();
  useComposerDraftStore.setState({ drafts: {} });
});

afterEach(async () => {
  cleanup();
  await drainImages();
  useComposerDraftStore.setState({ drafts: {} });
});

describe("BrowserAnnotationCard", () => {
  it("shows a pulse placeholder when the crop hash has no bytes", () => {
    renderCard(
      makeRecord({ annotationId: "ann-placeholder", tabId: "tab-1" }),
      vi.fn(),
      null,
    );

    const card = screen.getByTestId("browser-annotation-card");
    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("renders the thumbnail when putImage has stored the crop", async () => {
    const stub = createStubBrowserAnnotationPayloadFor({
      annotationId: "ann-thumb",
      tabId: "tab-thumb",
      sessionId: "session-card",
      comment: LONG_COMMENT,
    });
    const hash = await putImage(stub.png);
    renderCard(
      makeRecord({
        annotationId: "ann-thumb",
        tabId: "tab-thumb",
        imageHash: hash,
      }),
      vi.fn(),
      null,
    );

    const img = screen
      .getByTestId("browser-annotation-card")
      .querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toMatch(/^blob:mock\//);
  });

  it("renders the truncated comment text, or No comment when empty", () => {
    const { rerender } = render(
      <BrowserAnnotationCard
        record={makeRecord({
          annotationId: "ann-comment",
          tabId: "tab-1",
          comment: LONG_COMMENT,
        })}
        onRemove={vi.fn()}
        imageFetcher={landingFetcher}
        sessionObjectUrl={sessionObjectUrl}
      />,
    );
    const comment = screen.getByText(LONG_COMMENT);
    expect(comment.className).toContain("truncate");

    rerender(
      <BrowserAnnotationCard
        record={makeRecord({
          annotationId: "ann-comment",
          tabId: "tab-1",
          comment: "   ",
        })}
        onRemove={vi.fn()}
        imageFetcher={landingFetcher}
        sessionObjectUrl={sessionObjectUrl}
      />,
    );
    expect(screen.getByText("No comment")).toBeTruthy();
  });

  it("shows two tag badges plus +N when there are more than two elements", () => {
    renderCard(
      makeRecord({
        annotationId: "ann-tags",
        tabId: "tab-1",
        elements: [
          STUB_ANNOTATION_ELEMENT,
          STUB_ANNOTATION_PARAGRAPH,
          EXTRA_ELEMENT,
        ],
      }),
      vi.fn(),
      null,
    );

    expect(screen.getByText("h1")).toBeTruthy();
    expect(screen.getByText("p")).toBeTruthy();
    expect(screen.queryByText("button")).toBeNull();
    expect(screen.getByText("+1")).toBeTruthy();
  });

  it("renders the counts line as 2 elements · 1 drawing", () => {
    renderCard(
      makeRecord({
        annotationId: "ann-counts",
        tabId: "tab-1",
        counts: { elements: 2, regions: 0, strokes: 1 },
      }),
      vi.fn(),
      null,
    );

    expect(screen.getByText("2 elements · 1 drawing")).toBeTruthy();
  });

  it("shows no staleness hint when the live tab is still on the annotated URL", () => {
    const record = makeRecord({
      annotationId: "ann-fresh",
      tabId: "tab-1",
      sessionId: "session-card",
      pageUrl: "https://example.com/",
    });
    renderCard(record, vi.fn(), [
      session({
        sessionId: "session-card",
        tabs: [tab({ tabId: "tab-1", url: "https://example.com/" })],
      }),
    ]);

    expect(screen.queryByText(/page has navigated/)).toBeNull();
    expect(screen.queryByText(/source tab closed/)).toBeNull();
  });

  it("shows the navigated hint when the sessions provider reports a new URL", () => {
    const record = makeRecord({
      annotationId: "ann-nav",
      tabId: "tab-1",
      sessionId: "session-card",
      pageUrl: "https://example.com/",
    });
    renderCard(record, vi.fn(), [
      session({
        sessionId: "session-card",
        tabs: [tab({ tabId: "tab-1", url: "https://example.com/pricing" })],
      }),
    ]);

    expect(screen.getByText(/page has navigated/)).toBeTruthy();
  });

  it("shows the closed hint when the source tab is missing", () => {
    const record = makeRecord({
      annotationId: "ann-closed",
      tabId: "tab-gone",
      sessionId: "session-card",
    });
    renderCard(record, vi.fn(), [
      session({
        sessionId: "session-card",
        tabs: [tab({ tabId: "tab-other", url: "https://example.com/" })],
      }),
    ]);

    expect(screen.getByText(/source tab closed/)).toBeTruthy();
  });

  it("X calls onRemove with the annotationId", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    renderCard(
      makeRecord({ annotationId: "ann-x", tabId: "tab-1" }),
      onRemove,
      null,
    );

    await user.click(screen.getByRole("button", { name: "Remove annotation" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith("ann-x");
  });
});

describe("BrowserAnnotationCards", () => {
  it("renders two cards with different data-annotation-tab values", () => {
    const first = makeRecord({
      annotationId: "ann-tab-a",
      tabId: "tab-a",
      comment: "from tab a",
    });
    const second = makeRecord({
      annotationId: "ann-tab-b",
      tabId: "tab-b",
      comment: "from tab b",
    });
    useComposerDraftStore.getState().addBrowserAnnotation("chat-multi", first);
    useComposerDraftStore.getState().addBrowserAnnotation("chat-multi", second);

    render(<BrowserAnnotationCards taskId="chat-multi" />);

    const cards = screen.getAllByTestId("browser-annotation-card");
    expect(screen.getByTestId("browser-annotation-cards")).toBeTruthy();
    expect(cards).toHaveLength(2);
    expect(cards[0]?.getAttribute("data-annotation-id")).toBe("ann-tab-a");
    expect(cards[0]?.getAttribute("data-annotation-tab")).toBe("tab-a");
    expect(cards[1]?.getAttribute("data-annotation-id")).toBe("ann-tab-b");
    expect(cards[1]?.getAttribute("data-annotation-tab")).toBe("tab-b");
  });
});
