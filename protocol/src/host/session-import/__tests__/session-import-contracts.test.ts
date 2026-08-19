import { describe, expect, it } from "vitest";
import {
  sessionImportScanClientFrameSchema,
  sessionImportScanServerFrameSchema,
  sessionImportScanV10,
} from "@traycer/protocol/host/session-import/scan";
import {
  sessionImportRunClientFrameSchema,
  sessionImportRunServerFrameSchema,
  sessionImportRunV10,
} from "@traycer/protocol/host/session-import/run";
import { sessionImportStatusV10 } from "@traycer/protocol/host/session-import/contracts";

/**
 * `sessionImport.*@1.0` frame fixtures, modelled on `migration-run.test.ts`.
 *
 * Covers every frame kind and every arm of the three discriminated unions the
 * wizard renders off - group location, candidate state, and import outcome -
 * because each arm is a different row treatment, and an arm that silently
 * stopped parsing would show up as a missing row rather than an error. All
 * frames are JSON-only: `hasBinaryPayload` is pinned to the `false` literal.
 */

const importableCandidate = {
  harness: "claude",
  nativeSessionId: "b3b0f0e4-0000-4000-8000-000000000001",
  title: "Fix the flaky worktree test",
  firstPrompt: "the worktree suite fails on CI only",
  createdAt: 1_750_000_000_000,
  updatedAt: 1_750_000_600_000,
  messageCount: 42,
  hasSubagents: true,
  state: { kind: "importable" },
} as const;

describe("sessionImport.scan@1.0 server frames", () => {
  it("parses a started frame", () => {
    const parsed = sessionImportScanServerFrameSchema.parse({
      kind: "started",
      providers: ["claude", "codex"],
      hasBinaryPayload: false,
    });

    expect(parsed.kind).toBe("started");
    if (parsed.kind === "started") {
      expect(parsed.providers).toEqual(["claude", "codex"]);
    }
  });

  it("parses a group frame anchored on an existing folder", () => {
    const parsed = sessionImportScanServerFrameSchema.parse({
      kind: "group",
      group: {
        location: {
          kind: "folder",
          path: "/Users/dev/repos/traycer",
          workspaceId: "workspace-1",
        },
        sessions: [importableCandidate],
      },
      hasBinaryPayload: false,
    });

    expect(parsed.kind).toBe("group");
    if (parsed.kind === "group") {
      expect(parsed.group.location.kind).toBe("folder");
      expect(parsed.group.sessions[0]?.state.kind).toBe("importable");
    }
  });

  it("parses a group frame whose folder no longer exists", () => {
    const parsed = sessionImportScanServerFrameSchema.parse({
      kind: "group",
      group: {
        location: { kind: "missing_folder", path: "/Users/dev/repos/gone" },
        sessions: [],
      },
      hasBinaryPayload: false,
    });

    expect(parsed.kind).toBe("group");
    if (parsed.kind === "group" && parsed.group.location.kind === "missing_folder") {
      expect(parsed.group.location.path).toBe("/Users/dev/repos/gone");
    }
  });

  it("parses every candidate state arm", () => {
    const states = [
      { kind: "importable" },
      { kind: "already_in_traycer", epicId: "epic-1", chatId: "chat-1" },
      { kind: "unreadable", reason: "rollout file is truncated" },
    ] as const;

    for (const state of states) {
      const parsed = sessionImportScanServerFrameSchema.parse({
        kind: "group",
        group: {
          location: { kind: "folder", path: "/repo", workspaceId: null },
          sessions: [{ ...importableCandidate, state }],
        },
        hasBinaryPayload: false,
      });
      expect(parsed.kind).toBe("group");
      if (parsed.kind === "group") {
        expect(parsed.group.sessions[0]?.state.kind).toBe(state.kind);
      }
    }
  });

  it("parses a candidate with no native metadata to show", () => {
    const parsed = sessionImportScanServerFrameSchema.parse({
      kind: "group",
      group: {
        location: { kind: "folder", path: "/repo", workspaceId: null },
        sessions: [
          {
            ...importableCandidate,
            title: null,
            firstPrompt: null,
            messageCount: null,
          },
        ],
      },
      hasBinaryPayload: false,
    });
    expect(parsed.kind).toBe("group");
  });

  it("parses a complete frame", () => {
    const parsed = sessionImportScanServerFrameSchema.parse({
      kind: "complete",
      totals: {
        groups: 4,
        sessions: 120,
        importable: 90,
        alreadyInTraycer: 28,
        unreadable: 2,
      },
      hasBinaryPayload: false,
    });

    expect(parsed.kind).toBe("complete");
    if (parsed.kind === "complete") {
      expect(parsed.totals.sessions).toBe(120);
    }
  });

  it("parses a pong frame", () => {
    const parsed = sessionImportScanServerFrameSchema.parse({
      kind: "pong",
      hasBinaryPayload: false,
    });
    expect(parsed.kind).toBe("pong");
  });

  it("rejects a group frame that claims a binary payload", () => {
    expect(() =>
      sessionImportScanServerFrameSchema.parse({
        kind: "group",
        group: {
          location: { kind: "folder", path: "/repo", workspaceId: null },
          sessions: [],
        },
        hasBinaryPayload: true,
      }),
    ).toThrow();
  });

  it("rejects a candidate whose native session id is empty", () => {
    expect(() =>
      sessionImportScanServerFrameSchema.parse({
        kind: "group",
        group: {
          location: { kind: "folder", path: "/repo", workspaceId: null },
          sessions: [{ ...importableCandidate, nativeSessionId: "" }],
        },
        hasBinaryPayload: false,
      }),
    ).toThrow();
  });

  it("rejects an unknown candidate state kind", () => {
    expect(() =>
      sessionImportScanServerFrameSchema.parse({
        kind: "group",
        group: {
          location: { kind: "folder", path: "/repo", workspaceId: null },
          sessions: [
            { ...importableCandidate, state: { kind: "needs_upgrade" } },
          ],
        },
        hasBinaryPayload: false,
      }),
    ).toThrow();
  });
});

describe("sessionImport.scan@1.0 client frames and open request", () => {
  it("parses a ping frame", () => {
    const parsed = sessionImportScanClientFrameSchema.parse({
      kind: "ping",
      hasBinaryPayload: false,
    });
    expect(parsed.kind).toBe("ping");
  });

  it("accepts a null provider filter as 'every provider'", () => {
    expect(
      sessionImportScanV10.openRequestSchema.parse({ providers: null }),
    ).toEqual({ providers: null });
  });

  it("accepts a narrowed provider filter", () => {
    expect(
      sessionImportScanV10.openRequestSchema.parse({ providers: ["codex"] }),
    ).toEqual({ providers: ["codex"] });
  });

  it("rejects a provider that is not a harness", () => {
    expect(() =>
      sessionImportScanV10.openRequestSchema.parse({ providers: ["aider"] }),
    ).toThrow();
  });
});

describe("sessionImport.run@1.0 server frames", () => {
  it("parses a started frame", () => {
    const parsed = sessionImportRunServerFrameSchema.parse({
      kind: "started",
      runId: "run-1",
      total: 7,
      hasBinaryPayload: false,
    });
    expect(parsed.kind).toBe("started");
    if (parsed.kind === "started") {
      expect(parsed.total).toBe(7);
    }
  });

  it("parses a progress frame for every outcome arm", () => {
    const outcomes = [
      { kind: "imported", epicId: "epic-1", chatId: "chat-1" },
      {
        kind: "skipped_already_imported",
        epicId: "epic-1",
        chatId: "chat-1",
      },
      {
        kind: "failed",
        reason: "source_unreadable",
        detail: "ENOENT: rollout-2026-08-01.jsonl",
      },
    ] as const;

    for (const outcome of outcomes) {
      const parsed = sessionImportRunServerFrameSchema.parse({
        kind: "progress",
        runId: "run-1",
        index: 0,
        total: 3,
        harness: "codex",
        nativeSessionId: "thread-1",
        outcome,
        hasBinaryPayload: false,
      });
      expect(parsed.kind).toBe("progress");
      if (parsed.kind === "progress") {
        expect(parsed.outcome.kind).toBe(outcome.kind);
      }
    }
  });

  it("parses every closed failure reason", () => {
    const reasons = [
      "source_unreadable",
      "source_empty",
      "workspace_bind_failed",
      "creation_failed",
      "internal_error",
    ] as const;

    for (const reason of reasons) {
      const parsed = sessionImportRunServerFrameSchema.parse({
        kind: "progress",
        runId: "run-1",
        index: 1,
        total: 2,
        harness: "claude",
        nativeSessionId: "session-1",
        outcome: { kind: "failed", reason, detail: "" },
        hasBinaryPayload: false,
      });
      expect(parsed.kind).toBe("progress");
      if (parsed.kind === "progress" && parsed.outcome.kind === "failed") {
        expect(parsed.outcome.reason).toBe(reason);
      }
    }
  });

  it("rejects a failure reason outside the closed enum", () => {
    expect(() =>
      sessionImportRunServerFrameSchema.parse({
        kind: "progress",
        runId: "run-1",
        index: 0,
        total: 1,
        harness: "claude",
        nativeSessionId: "session-1",
        outcome: { kind: "failed", reason: "disk_full", detail: "" },
        hasBinaryPayload: false,
      }),
    ).toThrow();
  });

  it("parses a complete frame", () => {
    const parsed = sessionImportRunServerFrameSchema.parse({
      kind: "complete",
      runId: "run-1",
      counts: { imported: 5, skippedAlreadyImported: 1, failed: 1 },
      hasBinaryPayload: false,
    });
    expect(parsed.kind).toBe("complete");
    if (parsed.kind === "complete") {
      expect(parsed.counts.imported).toBe(5);
    }
  });

  it("rejects a complete frame with negative counts", () => {
    expect(() =>
      sessionImportRunServerFrameSchema.parse({
        kind: "complete",
        runId: "run-1",
        counts: { imported: -1, skippedAlreadyImported: 0, failed: 0 },
        hasBinaryPayload: false,
      }),
    ).toThrow();
  });

  it("parses a pong frame", () => {
    const parsed = sessionImportRunServerFrameSchema.parse({
      kind: "pong",
      hasBinaryPayload: false,
    });
    expect(parsed.kind).toBe("pong");
  });
});

describe("sessionImport.run@1.0 client frames and open request", () => {
  it("parses a ping frame", () => {
    const parsed = sessionImportRunClientFrameSchema.parse({
      kind: "ping",
      hasBinaryPayload: false,
    });
    expect(parsed.kind).toBe("ping");
  });

  it("accepts a selection set", () => {
    const parsed = sessionImportRunV10.openRequestSchema.parse({
      selections: [
        { harness: "claude", nativeSessionId: "session-1" },
        { harness: "codex", nativeSessionId: "thread-1" },
      ],
    });
    expect(parsed.selections).toHaveLength(2);
  });

  // An empty submission is the re-attach case: a client reconnecting to a run
  // that outlived its socket has nothing new to ask for.
  it("accepts an empty selection set", () => {
    expect(
      sessionImportRunV10.openRequestSchema.parse({ selections: [] }).selections,
    ).toEqual([]);
  });

  it("rejects a selection with an empty native session id", () => {
    expect(() =>
      sessionImportRunV10.openRequestSchema.parse({
        selections: [{ harness: "claude", nativeSessionId: "" }],
      }),
    ).toThrow();
  });
});

describe("sessionImport.status@1.0", () => {
  it("accepts an empty request", () => {
    expect(sessionImportStatusV10.requestSchema.parse({})).toEqual({});
  });

  it("parses an idle host that has never imported", () => {
    const parsed = sessionImportStatusV10.responseSchema.parse({
      active: null,
      lastCompleted: null,
    });
    expect(parsed.active).toBeNull();
    expect(parsed.lastCompleted).toBeNull();
  });

  it("parses a run in flight", () => {
    const parsed = sessionImportStatusV10.responseSchema.parse({
      active: { runId: "run-1", done: 3, total: 9 },
      lastCompleted: null,
    });
    expect(parsed.active?.done).toBe(3);
  });

  it("parses the last completed run's summary", () => {
    const parsed = sessionImportStatusV10.responseSchema.parse({
      active: null,
      lastCompleted: {
        counts: { imported: 9, skippedAlreadyImported: 0, failed: 0 },
        at: 1_750_000_000_000,
      },
    });
    expect(parsed.lastCompleted?.counts.imported).toBe(9);
  });
});
