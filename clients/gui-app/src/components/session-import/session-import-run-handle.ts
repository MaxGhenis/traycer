import type { SessionImportSelection } from "@traycer/protocol/host/session-import/candidate";

// Module-scoped handle so any surface can start an import without the run
// stream being owned by - and therefore dying with - the component that asked
// for it. Lives in its own file because TanStack Router fast-refresh requires
// `session-import-run-controller.tsx` to export only components.

export interface SessionImportRunRequest {
  readonly selections: ReadonlyArray<SessionImportSelection>;
  /** Display titles by selection key, for the progress and summary views. */
  readonly titles: ReadonlyMap<string, string>;
}

interface SessionImportStartHandle {
  readonly start: (request: SessionImportRunRequest) => void;
}

const ref: { current: SessionImportStartHandle | null } = { current: null };

export function setSessionImportStartHandle(
  handle: SessionImportStartHandle | null,
): void {
  ref.current = handle;
}

export function getSessionImportStartHandle(): SessionImportStartHandle | null {
  return ref.current;
}

export function startSessionImportRun(request: SessionImportRunRequest): void {
  ref.current?.start(request);
}
