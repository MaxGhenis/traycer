import "../../../../__tests__/test-browser-apis";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PipEpicSessionsFeed } from "../use-pip-epic-sessions";
import { resetPipEpicSessionsForTests } from "../pip-epic-sessions";
import { resetPipStoreForTests } from "../pip-store";

const EPIC = "epic-1";

interface DirectoryEntry {
  readonly hostId: string;
  readonly label: string;
  readonly kind: "local";
  readonly websocketUrl: string | null;
  readonly version: string;
  readonly transportDialability: "dialable" | "not-dialable";
}

interface RecordedSession {
  readonly hostId: string;
  readonly method: string;
  readonly params: unknown;
  closed: boolean;
}

interface RecordedTransport {
  readonly hostId: string;
  closed: boolean;
  readonly sessions: RecordedSession[];
}

const directoryState = vi.hoisted(() => ({
  data: [] as DirectoryEntry[],
}));

const transportFactory = vi.hoisted(() => {
  const transports: RecordedTransport[] = [];
  const openTransport = (hostId: string) => {
    const record: RecordedTransport = {
      hostId,
      closed: false,
      sessions: [],
    };
    transports.push(record);
    return {
      wsStreamClient: {
        subscribe: (method: string, params: unknown) => {
          const session: RecordedSession = {
            hostId,
            method,
            params,
            closed: false,
          };
          record.sessions.push(session);
          return {
            onServerFrame: (_handler: unknown) => undefined,
            onStatusChange: (_handler: unknown) => undefined,
            close: () => {
              session.closed = true;
            },
          };
        },
      },
      close: () => {
        record.closed = true;
      },
    };
  };
  return {
    transports,
    openTransport,
    reset(): void {
      transports.length = 0;
    },
  };
});

vi.mock("@/hooks/host/use-host-directory-list-query", () => ({
  useHostDirectoryList: () => ({ data: directoryState.data }),
}));

vi.mock("@/hooks/host/use-remote-sessions-poll-readiness", () => ({
  useRemoteSessionsPollReadiness: () => () => false,
}));

vi.mock("@/lib/host/use-durable-stream-transport", () => ({
  useDurableStreamTransportFactory: () => transportFactory.openTransport,
}));

vi.mock("@/lib/epic-selectors", () => ({
  useEpicChatRecords: () => [{ id: "chat-a" }],
}));

function localHost(
  hostId: string,
  overrides: Partial<DirectoryEntry>,
): DirectoryEntry {
  return {
    hostId,
    label: hostId,
    kind: "local",
    websocketUrl: `ws://127.0.0.1/${hostId}`,
    version: "test",
    transportDialability: "dialable",
    ...overrides,
  };
}

function allSessions(): RecordedSession[] {
  return transportFactory.transports.flatMap((transport) => transport.sessions);
}

describe("PipEpicSessionsFeed", () => {
  beforeEach(() => {
    resetPipStoreForTests();
    resetPipEpicSessionsForTests();
    transportFactory.reset();
    directoryState.data = [localHost("host-a", {}), localHost("host-b", {})];
  });

  afterEach(() => {
    cleanup();
    resetPipStoreForTests();
    resetPipEpicSessionsForTests();
    transportFactory.reset();
  });

  it("subscribes to browser.sessions on both hosts and closes transports and sessions on unmount", () => {
    const { unmount } = render(<PipEpicSessionsFeed epicId={EPIC} />);

    expect(transportFactory.transports.map((item) => item.hostId)).toEqual([
      "host-a",
      "host-b",
    ]);
    const sessions = allSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions.map((session) => session.method)).toEqual([
      "browser.sessions",
      "browser.sessions",
    ]);
    expect(sessions.map((session) => session.params)).toEqual([
      { epicId: EPIC, chatId: "chat-a" },
      { epicId: EPIC, chatId: "chat-a" },
    ]);
    expect(transportFactory.transports.every((item) => !item.closed)).toBe(
      true,
    );
    expect(sessions.every((session) => !session.closed)).toBe(true);

    unmount();

    expect(transportFactory.transports.every((item) => item.closed)).toBe(true);
    expect(allSessions().every((session) => session.closed)).toBe(true);
  });

  it("closes only the host that becomes undialable and still tears the rest down on unmount", () => {
    const { rerender, unmount } = render(<PipEpicSessionsFeed epicId={EPIC} />);
    expect(transportFactory.transports).toHaveLength(2);

    directoryState.data = [
      localHost("host-a", {}),
      localHost("host-b", { transportDialability: "not-dialable" }),
    ];
    rerender(<PipEpicSessionsFeed epicId={EPIC} />);

    const hostA = transportFactory.transports.find(
      (item) => item.hostId === "host-a",
    );
    const hostB = transportFactory.transports.find(
      (item) => item.hostId === "host-b",
    );
    expect(hostA?.closed).toBe(false);
    expect(hostB?.closed).toBe(true);
    expect(hostA?.sessions.every((session) => !session.closed)).toBe(true);
    expect(hostB?.sessions.every((session) => session.closed)).toBe(true);
    expect(transportFactory.transports).toHaveLength(2);

    unmount();

    expect(hostA?.closed).toBe(true);
    expect(hostA?.sessions.every((session) => session.closed)).toBe(true);
    expect(hostB?.closed).toBe(true);
    expect(hostB?.sessions.every((session) => session.closed)).toBe(true);
  });
});
