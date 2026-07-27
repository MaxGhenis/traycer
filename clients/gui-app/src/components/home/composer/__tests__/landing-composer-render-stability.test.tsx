import "../../../../../__tests__/test-browser-apis";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { JsonContent } from "@traycer/protocol/common/registry";

import { LandingComposer } from "@/components/home/composer/landing-composer";
import {
  flushPendingLandingDraftContent,
  useLandingComposerStore,
} from "@/stores/composer/landing-composer-store";
import { useLandingDraftStore } from "@/stores/home/landing-draft-store";
import { useSettingsStore } from "@/stores/settings/settings-store";

const toolbarHarness = vi.hoisted(() => {
  const state = {
    selection: {
      harnessId: "codex",
      modelSlug: "gpt-5-codex",
    },
    reasoning: "high",
    serviceTier: "",
    permission: "supervised",
    agentMode: "regular",
  };
  return {
    store: {
      getState: () => state,
      getInitialState: () => state,
      subscribe: () => {
        return () => undefined;
      },
    },
  };
});

vi.mock("@/lib/host", () => ({
  useHostBinding: () => null,
  useHostClient: () => ({
    request: vi.fn(),
    getActiveHostId: () => "host-1",
    getActiveHost: () => null,
    getRequestContextUserId: () => "user-1",
  }),
}));

vi.mock("@/hooks/epic/use-epic-create-mutation", () => ({
  useEpicCreate: () => ({ isPending: false }),
}));

vi.mock("@/hooks/agent/use-create-tui-agent", () => ({
  useCreateTuiAgent: () => ({ isPending: false }),
}));

vi.mock("@/hooks/workspace/use-resolved-workspace-folders-query", () => ({
  useResolvedWorkspaceFolders: () => ({
    folders: [],
    isLoading: false,
    isFetching: false,
  }),
}));

vi.mock("@/components/home/hooks/use-landing-composer-actions", () => ({
  useLandingComposerActions: () => ({
    submit: vi.fn(),
    selectTerminalAgent: vi.fn(),
  }),
}));

vi.mock("@/components/home/hooks/use-composer-toolbar-store", () => ({
  useComposerToolbarStore: () => toolbarHarness.store,
}));

vi.mock("@/components/chat/composer/picker/use-composer-picker-items", () => ({
  useComposerPickerItems: () => undefined,
}));

vi.mock("@/hooks/composer/use-workspace-mention-roots", () => ({
  useLandingComposerMentionRoots: () => [],
}));

vi.mock("@/hooks/composer/use-composer-dictation", () => ({
  useComposerDictation: () => ({
    dictationControl: null,
    dictationPreparing: null,
  }),
}));

vi.mock("@/hooks/composer/use-landing-composer-paste", () => ({
  useLandingComposerPaste: () => {
    const noopDrag = (event: { preventDefault: () => void }): void => {
      event.preventDefault();
    };
    return {
      attachImageFiles: vi.fn(),
      isDraggingFiles: false,
      onDragEnter: noopDrag,
      onDragLeave: noopDrag,
      onDragOver: noopDrag,
      onDrop: noopDrag,
      onPaste: vi.fn(),
    };
  },
}));

vi.mock("@/components/home/composer/composer-body", () => ({
  ComposerBody: (props: {
    readonly header: ReactNode;
    readonly attachmentsStrip: ReactNode;
    readonly canSubmit: boolean;
  }) => (
    <div>
      {props.header}
      <div data-testid="landing-can-submit">{String(props.canSubmit)}</div>
      <div data-testid="landing-attachments">{props.attachmentsStrip}</div>
    </div>
  ),
}));

function imageContent(id: string): JsonContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "imageAttachment",
            attrs: {
              id,
              fileName: "shot.png",
              b64content: "cG5n",
              mimeType: "image/png",
              size: 3,
            },
          },
        ],
      },
    ],
  };
}

describe("<LandingComposer /> render stability", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLandingDraftStore.setState({ drafts: [], activeDraftId: null });
    useLandingComposerStore.getState().reset();
    useSettingsStore.setState({ inAppBrowserBetaEnabled: true });
  });

  afterEach(() => {
    cleanup();
    flushPendingLandingDraftContent();
    useLandingDraftStore.setState({ drafts: [], activeDraftId: null });
    useLandingComposerStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("mounts the bound attachment strip without render-phase store warnings", () => {
    const draftId = useLandingDraftStore
      .getState()
      .createDraft(null, undefined);
    useLandingDraftStore
      .getState()
      .setDraftContent(draftId, imageContent("image-1"), null);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      return undefined;
    });

    render(
      <LandingComposer
        draftId={draftId}
        pendingCreateId={null}
        initialSettings={null}
        workspaceControls={null}
      />,
    );

    expect(screen.getByTestId("landing-attachments").textContent).toContain(
      "1",
    );
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining(
        "Cannot update a component while rendering a different component",
      ),
    );
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining(
        "The result of getSnapshot should be cached to avoid an infinite loop",
      ),
    );
  });
});
