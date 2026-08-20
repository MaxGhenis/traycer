import { StrictMode, type ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  type RenderResult,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ArtifactVersionObservationEntry,
  ArtifactVersionsRestoreResponse,
  DeletedArtifactEntry,
} from "@traycer/protocol/host/epic/artifact-versions";
import { EpicSessionContext } from "@/lib/registries/epic-session-registry";
import { EpicViewTabContext } from "@/components/epic-canvas/view-tab-context";
import {
  createOpenEpicStore,
  type EpicStreamClientFactory,
  type OpenEpicStoreHandle,
} from "@/stores/epics/open-epic/store";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

interface HostQueryArgs {
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly cacheKeyIdentity: readonly unknown[] | undefined;
  readonly options: { readonly enabled: boolean };
}

interface MutationOptions {
  readonly onSuccess?: (response: ArtifactVersionsRestoreResponse) => void;
  readonly onError?: () => void;
}

interface MutationConfig {
  readonly method: string;
}

interface OpenedChatNode {
  readonly id: string;
  readonly instanceId: string;
  readonly type: "chat";
  readonly name: string;
  readonly hostId: string;
}

const state = vi.hoisted(() => ({
  supportedMethods: new Set<string>(),
  supportError: false,
  supportCalls: [] as string[],
  queryCalls: [] as HostQueryArgs[],
  mutationCalls: [] as Array<{
    readonly method: string;
    readonly variables: Readonly<Record<string, unknown>>;
  }>,
  nodeRefCalls: [] as Array<{
    readonly chatId: string;
    readonly hostId: string;
  }>,
  openedChats: [] as Array<{
    readonly tabId: string;
    readonly node: OpenedChatNode;
  }>,
  historyEntries: [] as ArtifactVersionObservationEntry[],
  deletedEntries: [] as DeletedArtifactEntry[],
  settingsEnabled: true,
  blobByObservationId: new Map<
    string,
    { readonly contentHash: string; readonly markdown: string }
  >(),
  restorePreflight: {
    kind: "preflight",
    imagesMissing: [] as string[],
    threadCount: 0,
    currentHash: "b".repeat(64),
  } satisfies ArtifactVersionsRestoreResponse,
  restoreExecute: null as ArtifactVersionsRestoreResponse | null,
}));

vi.mock("@/components/epic-canvas/hooks/use-tab-host-id", () => ({
  useTabHostId: () => "host-a",
}));

vi.mock("@/hooks/host/use-tab-host-client", () => ({
  useTabHostClient: () => null,
}));

vi.mock("@/lib/epic-selectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/epic-selectors")>()),
  epicNodeRefForNodeId: (_state: object, chatId: string, hostId: string) => {
    state.nodeRefCalls.push({ chatId, hostId });
    return {
      id: chatId,
      instanceId: `instance-${chatId}`,
      type: "chat",
      name: "Originating chat",
      hostId,
    } satisfies OpenedChatNode;
  },
}));

vi.mock("@/hooks/epic/use-epic-tile-navigation", () => ({
  useEpicTileNavigation: () => ({
    openTilePreviewInTab: (tabId: string, node: OpenedChatNode) => {
      state.openedChats.push({ tabId, node });
    },
  }),
}));

vi.mock("@/hooks/host/use-host-supports-method", () => ({
  useHostSupportsMethod: (_hostId: string, method: string) => {
    if (state.supportError) throw new Error("negotiation failed");
    state.supportCalls.push(method);
    return state.supportedMethods.has(method);
  },
}));

vi.mock("@/hooks/host/use-host-query", () => ({
  useHostQuery: (args: HostQueryArgs) => {
    state.queryCalls.push(args);
    if (args.method === "epic.artifactVersions.list") {
      return {
        data: { entries: state.historyEntries, nextCursor: null },
        isLoading: false,
        isError: false,
      };
    }
    if (args.method === "epic.deletedArtifacts.list") {
      return {
        data: { entries: state.deletedEntries },
        isLoading: false,
        isError: false,
      };
    }
    if (args.method === "epic.artifactVersionSettings.get") {
      return {
        data: {
          settings: {
            enabled: state.settingsEnabled,
            retentionDays: 30,
            maxVersionsPerArtifact: 100,
            maxBytesPerArtifact: 16 * 1024 * 1024,
          },
          storage: { referencedBytes: 0, reclaimableBytes: 0 },
        },
        isLoading: false,
        isError: false,
      };
    }
    const observationId = args.params.observationId;
    return {
      data:
        typeof observationId === "string"
          ? state.blobByObservationId.get(observationId)
          : undefined,
      isLoading: false,
      isError: false,
    };
  },
}));

vi.mock("@/hooks/host/use-host-scoped-mutation", () => ({
  useHostScopedMutationForClient: (_client: null, config: MutationConfig) => ({
    isPending: false,
    variables: { artifactId: "" },
    mutate: (
      variables: Readonly<Record<string, unknown>>,
      options: MutationOptions | undefined,
    ) => {
      state.mutationCalls.push({ method: config.method, variables });
      if (
        config.method === "epic.artifactVersions.restore" &&
        variables.mode === "preflight"
      ) {
        options?.onSuccess?.(state.restorePreflight);
        return;
      }
      if (
        config.method === "epic.artifactVersions.restore" &&
        variables.mode === "execute" &&
        state.restoreExecute !== null
      ) {
        options?.onSuccess?.(state.restoreExecute);
      }
    },
  }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/components/diff/diff-content-primitive", () => ({
  DiffContentFrame: (props: { readonly children: ReactNode }) => props.children,
  DiffContentPrimitive: (props: { readonly patch: string }) => (
    <pre data-testid="diff-content">{props.patch}</pre>
  ),
}));

import { ArtifactVersionHistoryEntryPoint } from "../artifact-version-history";

const noopEpicStreamClientFactory: EpicStreamClientFactory = () => ({
  applyUpdate: () => undefined,
  awareness: () => undefined,
  applyArtifactRoomUpdate: () => undefined,
  artifactRoomAwareness: () => undefined,
  retryMigration: () => undefined,
  close: () => undefined,
});

const HISTORY_METHODS = [
  "epic.artifactVersions.list",
  "epic.artifactVersions.getBlob",
  "epic.artifactVersions.restore",
  "epic.deletedArtifacts.list",
  "epic.deletedArtifacts.revive",
  "epic.artifactVersionSettings.get",
] as const;

function observation(
  observationId: string,
  chatTitle: string | null,
): ArtifactVersionObservationEntry {
  return {
    observationId,
    contentHash: HASH_A,
    serializerVersion: 1,
    parentContentHash: null,
    provenance: {
      kind: "agent",
      chatId: `chat-${observationId}`,
      turnId: "7",
      harnessId: "claude",
      chatTitle,
    },
    captureStreamId: "stream-a",
    localSeq: 1,
    capturedAt: 1_700_000_000_000,
    available: true,
    degraded: false,
  };
}

let epicHandle: OpenEpicStoreHandle;

function historyTree(handle: OpenEpicStoreHandle | null): ReactNode {
  return (
    <StrictMode>
      <EpicSessionContext.Provider value={handle}>
        <EpicViewTabContext.Provider value="tab-a">
          <ArtifactVersionHistoryEntryPoint artifactId="artifact-a" />
        </EpicViewTabContext.Provider>
      </EpicSessionContext.Provider>
    </StrictMode>
  );
}

function renderHistory(): RenderResult {
  return render(historyTree(epicHandle));
}

function openHistory(): RenderResult {
  const result = renderHistory();
  fireEvent.click(screen.getByTestId("artifact-version-history-entry"));
  return result;
}

describe("<ArtifactVersionHistoryEntryPoint />", () => {
  beforeEach(() => {
    epicHandle = createOpenEpicStore({
      epicId: "epic-a",
      streamClientFactory: noopEpicStreamClientFactory,
      userId: null,
      onAuthError: null,
    });
    state.supportedMethods = new Set(HISTORY_METHODS);
    state.supportError = false;
    state.supportCalls = [];
    state.queryCalls = [];
    state.mutationCalls = [];
    state.nodeRefCalls = [];
    state.openedChats = [];
    state.historyEntries = [];
    state.deletedEntries = [];
    state.settingsEnabled = true;
    state.blobByObservationId.clear();
    state.restorePreflight = {
      kind: "preflight",
      imagesMissing: [],
      threadCount: 0,
      currentHash: HASH_B,
    };
    state.restoreExecute = null;
  });

  afterEach(() => {
    cleanup();
    epicHandle.dispose();
    vi.restoreAllMocks();
  });

  it("closes without throwing when the Epic session tears down", () => {
    state.historyEntries = [observation("observation-a", "Originating chat")];
    const result = openHistory();
    expect(screen.getByTestId("artifact-version-history-sheet")).toBeTruthy();

    expect(() => result.rerender(historyTree(null))).not.toThrow();

    expect(screen.queryByTestId("artifact-version-history-sheet")).toBeNull();
    expect(screen.queryByText("Version history unavailable")).toBeNull();
  });

  it("contains unexpected history faults at the artifact header", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    state.supportError = true;

    renderHistory();

    expect(
      screen.getByText("Version history unavailable").getAttribute("role"),
    ).toBe("status");
    expect(consoleError).toHaveBeenCalled();
  });

  it("stays hidden unless every negotiated history method is supported", () => {
    state.supportedMethods.delete("epic.deletedArtifacts.revive");

    renderHistory();

    expect(new Set(state.supportCalls)).toEqual(new Set(HISTORY_METHODS));
    expect(screen.queryByTestId("artifact-version-history-entry")).toBeNull();
  });

  it("preserves capture order while using observation identity for duplicate content", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    state.historyEntries = [
      observation("observation-new", "Newest snapshot"),
      observation("observation-old", "Older snapshot"),
    ];
    state.blobByObservationId.set("observation-new", {
      contentHash: HASH_A,
      markdown: "new body",
    });
    state.blobByObservationId.set("observation-old", {
      contentHash: HASH_A,
      markdown: "old body",
    });

    openHistory();

    const newest = screen.getByText("Newest snapshot");
    const older = screen.getByText("Older snapshot");
    expect(
      newest.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      consoleError.mock.calls.some((call) =>
        call.some((value) => String(value).includes("same key")),
      ),
    ).toBe(false);

    state.queryCalls = [];
    fireEvent.click(
      screen.getByTestId("artifact-version-observation-observation-old"),
    );

    expect(
      state.queryCalls.some(
        (call) =>
          call.method === "epic.artifactVersions.getBlob" &&
          call.options.enabled &&
          call.params.observationId === "observation-old" &&
          call.cacheKeyIdentity?.[0] === HASH_A,
      ),
    ).toBe(true);
  });

  it("links titled agent provenance to its originating chat and leaves missing chats inert", () => {
    state.historyEntries = [
      observation("observation-linked", "Auth hardening"),
      observation("observation-gone", null),
      {
        ...observation("observation-legacy-restore", null),
        provenance: {
          kind: "restore",
          restoredFromObservationId: null,
          targetHash: HASH_A,
        },
      },
      {
        ...observation("observation-legacy-revive", null),
        provenance: {
          kind: "revive",
          deletionEventId: null,
          targetHash: HASH_A,
        },
      },
    ];

    openHistory();

    const chatLink = screen.getByRole("button", {
      name: "Open chat Auth hardening",
    });
    expect(chatLink.parentElement?.textContent).toBe(
      "Agent · Auth hardening · turn 7",
    );
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === "P" &&
          element.textContent === "Agent · chat-observation-gone · turn 7",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Restored from an earlier version.")).toBeTruthy();
    expect(screen.getByText("Restored after deletion.")).toBeTruthy();

    fireEvent.click(chatLink);

    expect(state.nodeRefCalls).toEqual([
      { chatId: "chat-observation-linked", hostId: "host-a" },
    ]);
    expect(state.openedChats).toEqual([
      {
        tabId: "tab-a",
        node: {
          id: "chat-observation-linked",
          instanceId: "instance-chat-observation-linked",
          type: "chat",
          name: "Originating chat",
          hostId: "host-a",
        },
      },
    ]);
  });

  it("keeps frozen versions browsable below the off-state explanation", () => {
    state.settingsEnabled = false;
    state.historyEntries = [
      observation("observation-frozen", "Frozen snapshot"),
    ];
    state.blobByObservationId.set("observation-frozen", {
      contentHash: HASH_A,
      markdown: "frozen body",
    });

    openHistory();

    const explanation = screen.getByText(
      "Version history is off — turn it on in Settings.",
    );
    const frozen = screen.getByText("Frozen snapshot");
    expect(
      explanation.compareDocumentPosition(frozen) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    fireEvent.click(
      screen.getByTestId("artifact-version-observation-observation-frozen"),
    );
    expect(
      screen.getByRole("button", { name: "Restore this version" }),
    ).toBeTruthy();
  });

  it("restores missing-image history as a new body-only version", () => {
    state.historyEntries = [
      observation("observation-target", "Target snapshot"),
    ];
    state.blobByObservationId.set("observation-target", {
      contentHash: HASH_A,
      markdown: "target body",
    });
    state.restorePreflight = {
      kind: "preflight",
      imagesMissing: [HASH_A],
      threadCount: 0,
      currentHash: HASH_B,
    };
    openHistory();

    fireEvent.click(
      screen.getByRole("button", { name: "Restore this version" }),
    );

    expect(
      screen.getByText(
        "It becomes a new version at the top of history. Nothing is deleted.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("You can restore the body only, or cancel."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore body only" }));

    expect(state.mutationCalls).toContainEqual({
      method: "epic.artifactVersions.restore",
      variables: {
        epicId: "epic-a",
        artifactId: "artifact-a",
        targetObservationId: "observation-target",
        mode: "execute",
        expectedCurrentHash: HASH_B,
        bodyOnly: true,
      },
    });
  });

  it("distinguishes missing metadata from a missing saved body", () => {
    state.deletedEntries = [
      {
        artifactId: "artifact-scalars",
        title: "Lost metadata",
        deletedAt: 1_700_000_000_000,
        versionCount: 2,
        lastContentHash: HASH_A,
        unrestorable: "missing_scalars",
      },
      {
        artifactId: "artifact-blob",
        title: "Lost body",
        deletedAt: 1_700_000_100_000,
        versionCount: 1,
        lastContentHash: HASH_B,
        unrestorable: "missing_blob",
      },
    ];
    openHistory();

    fireEvent.mouseDown(screen.getByTestId("artifact-history-tab-deleted"));

    expect(
      screen.getByText(
        "Cannot restore: the artifact's title, kind, or tree position is missing.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Cannot restore: the saved artifact body is missing."),
    ).toBeTruthy();
    for (const button of screen.getAllByRole("button", {
      name: "Restore artifact",
    })) {
      expect(button.hasAttribute("disabled")).toBe(true);
    }
  });

  it("renders the clean restore outcome banner and badge", () => {
    state.historyEntries = [
      observation("observation-original", "Original snapshot"),
      observation("observation-restored", "Restored snapshot"),
    ];
    state.blobByObservationId.set("observation-original", {
      contentHash: HASH_A,
      markdown: "original body",
    });
    state.restoreExecute = {
      kind: "outcome",
      status: "clean",
      newObservationId: "observation-restored",
    };

    openHistory();

    fireEvent.click(
      screen.getByRole("button", { name: "Restore this version" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Restore as new version" }),
    );

    expect(screen.getByText("Restored as a new version.")).toBeTruthy();
    expect(screen.getByText("Restored")).toBeTruthy();
  });

  it("renders the renormalized restore outcome banner and badge", () => {
    state.historyEntries = [
      observation("observation-original", "Original snapshot"),
      observation("observation-restored", "Restored snapshot"),
    ];
    state.blobByObservationId.set("observation-original", {
      contentHash: HASH_A,
      markdown: "original body",
    });
    state.restoreExecute = {
      kind: "outcome",
      status: "renormalized",
      newObservationId: "observation-restored",
    };

    openHistory();

    fireEvent.click(
      screen.getByRole("button", { name: "Restore this version" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Restore as new version" }),
    );

    expect(
      screen.getByText(
        "Restored. Content was re-normalized by a newer editor version — formatting may differ slightly.",
        { exact: false },
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("re-normalized by a newer editor version — review"),
    ).toBeTruthy();
  });

  it("renders the degraded restore outcome banner and badge", () => {
    state.historyEntries = [
      observation("observation-original", "Original snapshot"),
      observation("observation-restored", "Restored snapshot"),
    ];
    state.blobByObservationId.set("observation-original", {
      contentHash: HASH_A,
      markdown: "original body",
    });
    state.restoreExecute = {
      kind: "outcome",
      status: "degraded",
      newObservationId: "observation-restored",
    };

    openHistory();

    fireEvent.click(
      screen.getByRole("button", { name: "Restore this version" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Restore as new version" }),
    );

    expect(
      screen.getByText(
        "Restored as a new version with missing image content. The new row is marked Body only.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Restored with missing image content"),
    ).toBeTruthy();
  });

  it("re-runs preflight after a restore conflict and clears the refreshing state", () => {
    state.historyEntries = [
      observation("observation-target", "Target snapshot"),
    ];
    state.blobByObservationId.set("observation-target", {
      contentHash: HASH_A,
      markdown: "target body",
    });
    state.restoreExecute = { kind: "conflict", currentHash: HASH_A };

    openHistory();

    fireEvent.click(
      screen.getByRole("button", { name: "Restore this version" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Restore as new version" }),
    );

    const preflightCalls = state.mutationCalls.filter(
      (call) =>
        call.method === "epic.artifactVersions.restore" &&
        call.variables.mode === "preflight",
    );
    expect(preflightCalls).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Restore as new version" }),
    ).toBeTruthy();
  });

  it("shows the unavailable copy when an execute call reports unavailable", () => {
    state.historyEntries = [
      observation("observation-target", "Target snapshot"),
    ];
    state.blobByObservationId.set("observation-target", {
      contentHash: HASH_A,
      markdown: "target body",
    });
    state.restoreExecute = { kind: "unavailable", reason: "missing_blob" };

    openHistory();

    fireEvent.click(
      screen.getByRole("button", { name: "Restore this version" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Restore as new version" }),
    );

    expect(
      screen.getByText("The saved body for this version is missing."),
    ).toBeTruthy();
  });
});
