import { useMemo, useState, type ReactNode } from "react";
import { diffLines, type Change } from "diff";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  Clock3Icon,
  InfoIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
} from "lucide-react";
import type {
  ArtifactVersionObservationEntry,
  ArtifactVersionsRestoreResponse,
  DeletedArtifactEntry,
} from "@traycer/protocol/host/epic/artifact-versions";
import { useQueryClient } from "@tanstack/react-query";
import type { HostClient } from "@traycer-clients/shared/host-client/host-client";
import type { HostRpcRegistry } from "@traycer/protocol/host/index";
import type { OpenEpicStoreHandle } from "@/stores/epics/open-epic/store";
import { useTabHostId } from "@/components/epic-canvas/hooks/use-tab-host-id";
import { ArtifactVersionHistoryErrorBoundary } from "@/components/epic-canvas/renderers/artifact-version-history-error-boundary";
import { useEpicViewTabId } from "@/components/epic-canvas/view-tab-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useHostQuery } from "@/hooks/host/use-host-query";
import { useHostScopedMutationForClient } from "@/hooks/host/use-host-scoped-mutation";
import { useHostSupportsMethod } from "@/hooks/host/use-host-supports-method";
import { useTabHostClient } from "@/hooks/host/use-tab-host-client";
import { useEpicTileNavigation } from "@/hooks/epic/use-epic-tile-navigation";
import { epicNodeRefForNodeId } from "@/lib/epic-selectors";
import { hostQueryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { useMaybeOpenEpicHandle } from "@/providers/use-open-epic-handle";

type HistoryMode = "versions" | "deleted";

interface RestorePreflight {
  readonly imagesMissing: readonly string[];
  readonly threadCount: number;
  readonly currentHash: string;
}

interface OutcomeNotice {
  readonly status: "clean" | "renormalized" | "degraded";
  readonly observationId: string;
}

interface HistoryPagination {
  readonly queryUpdatedAt: number;
  readonly entries: readonly ArtifactVersionObservationEntry[];
  readonly nextCursor: string | null;
}

const RESTORE_UNAVAILABLE_COPY: Readonly<
  Record<
    Extract<ArtifactVersionsRestoreResponse, { kind: "unavailable" }>["reason"],
    string
  >
> = {
  storage_full: "The host has no room to create the new version.",
  journal_cap: "The host's recovery journal is full.",
  "target-not-found": "This version is no longer in history.",
  "missing-blob": "The saved body for this version is missing.",
  "artifact-not-live": "This artifact is no longer live.",
  "kind-mismatch": "This version belongs to a different artifact kind.",
  "body-unavailable": "The artifact body is currently unavailable.",
  "missing-images": "Some referenced images are missing.",
};

const PROVENANCE_LABELS: Readonly<
  Record<ArtifactVersionObservationEntry["provenance"]["kind"], string>
> = {
  agent: "Agent edit",
  user_session: "Your edit",
  multiple_agents: "Several agents",
  external: "External edit",
  system: "System capture",
  remote_merge: "Remote merge",
  restore: "Restored version",
  revive: "Restored artifact",
  delete: "Deleted",
  clobber: "Recovered overwrite",
};

const CAPTURED_AT_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function formatCapturedAt(value: number): string {
  return CAPTURED_AT_FORMATTER.format(value);
}

function dayLabel(value: number): string {
  return DAY_FORMATTER.format(value);
}

type Provenance = ArtifactVersionObservationEntry["provenance"];

function userSessionDetail(
  provenance: Extract<Provenance, { readonly kind: "user_session" }>,
): string {
  return provenance.hostId === undefined
    ? `User ${provenance.userId}`
    : `User ${provenance.userId} · host ${provenance.hostId}`;
}

function multipleAgentsDetail(
  provenance: Extract<Provenance, { readonly kind: "multiple_agents" }>,
): string {
  if (provenance.agents.length === 0) return "Several agents";
  return provenance.agents
    .map((agent) => agent.chatTitle ?? agent.chatId)
    .join(", ");
}

function externalDetail(
  provenance: Extract<Provenance, { readonly kind: "external" }>,
): string {
  const count = provenance.attemptedAgentWrites.length;
  if (count === 0) return "External edit";
  const noun = count === 1 ? "write" : "writes";
  return `${count} attempted agent ${noun}`;
}

function restoreDetail(
  provenance: Extract<Provenance, { readonly kind: "restore" }>,
): string {
  return provenance.restoredFromObservationId === null
    ? "Restored from an earlier version."
    : `Restored from version ${provenance.restoredFromObservationId}.`;
}

function reviveDetail(
  provenance: Extract<Provenance, { readonly kind: "revive" }>,
): string {
  return provenance.deletionEventId === null
    ? "Restored after deletion."
    : `Restored after deletion event ${provenance.deletionEventId}.`;
}

function deleteDetail(
  provenance: Extract<Provenance, { readonly kind: "delete" }>,
): string | null {
  const actor = provenance.actorKind?.replaceAll("_", " ") ?? null;
  if (actor === null) return provenance.deleteOpId;
  return provenance.deleteOpId === null
    ? `Deleted by ${actor}`
    : `Deleted by ${actor} · operation ${provenance.deleteOpId}`;
}

function provenanceDetailText(provenance: Provenance): string | null {
  switch (provenance.kind) {
    case "agent":
      return null;
    case "user_session":
      return userSessionDetail(provenance);
    case "multiple_agents":
      return multipleAgentsDetail(provenance);
    case "external":
      return externalDetail(provenance);
    case "system":
      return provenance.originalActorHint ?? provenance.trigger;
    case "remote_merge":
      return null;
    case "restore":
      return restoreDetail(provenance);
    case "revive":
      return reviveDetail(provenance);
    case "delete":
      return deleteDetail(provenance);
    case "clobber":
      return provenance.source;
  }
}

type AgentProvenance = Extract<
  ArtifactVersionObservationEntry["provenance"],
  { readonly kind: "agent" }
>;

function AgentProvenanceDetail(props: {
  readonly provenance: AgentProvenance;
  readonly onOpenChat: (chatId: string) => void;
}): ReactNode {
  return (
    <p className="px-3 pb-3 text-ui-xs text-muted-foreground">
      Agent ·{" "}
      {props.provenance.chatTitle === null ? (
        <span className="font-mono">{props.provenance.chatId}</span>
      ) : (
        <button
          type="button"
          className="font-medium underline underline-offset-2 hover:text-foreground"
          aria-label={`Open chat ${props.provenance.chatTitle}`}
          onClick={() => props.onOpenChat(props.provenance.chatId)}
        >
          {props.provenance.chatTitle}
        </button>
      )}{" "}
      · turn {props.provenance.turnId}
    </p>
  );
}

function ObservationProvenanceDetail(props: {
  readonly provenance: Provenance;
  readonly onOpenChat: (chatId: string) => void;
}): ReactNode {
  if (props.provenance.kind === "agent") {
    return (
      <AgentProvenanceDetail
        provenance={props.provenance}
        onOpenChat={props.onOpenChat}
      />
    );
  }
  const detail = provenanceDetailText(props.provenance);
  if (detail === null) return null;
  return <p className="px-3 pb-3 text-ui-xs text-muted-foreground">{detail}</p>;
}

function comparisonFor(
  entries: readonly ArtifactVersionObservationEntry[],
  selected: ArtifactVersionObservationEntry | null,
): {
  readonly entry: ArtifactVersionObservationEntry;
  readonly label: string;
} | null {
  if (selected === null) return null;
  if (selected.parentContentHash !== null) {
    const parent = entries.find(
      (entry) =>
        entry.available && entry.contentHash === selected.parentContentHash,
    );
    if (parent !== undefined)
      return { entry: parent, label: "Compared with parent version" };
  }
  const index = entries.findIndex(
    (entry) => entry.observationId === selected.observationId,
  );
  const previous = entries.slice(index + 1).find((entry) => entry.available);
  return previous === undefined
    ? null
    : { entry: previous, label: "Compared with previous entry" };
}

function mergeObservationPages(
  ...pages: ReadonlyArray<readonly ArtifactVersionObservationEntry[]>
): ArtifactVersionObservationEntry[] {
  const seen = new Set<string>();
  const merged: ArtifactVersionObservationEntry[] = [];
  for (const page of pages) {
    for (const entry of page) {
      if (seen.has(entry.observationId)) continue;
      seen.add(entry.observationId);
      merged.push(entry);
    }
  }
  return merged;
}

export function ArtifactVersionHistoryEntryPoint(props: {
  readonly artifactId: string;
}): ReactNode {
  return (
    <ArtifactVersionHistoryErrorBoundary>
      <ArtifactVersionHistoryEntryPointContent artifactId={props.artifactId} />
    </ArtifactVersionHistoryErrorBoundary>
  );
}

function ArtifactVersionHistoryEntryPointContent(props: {
  readonly artifactId: string;
}): ReactNode {
  const openEpicHandle = useMaybeOpenEpicHandle();
  const hostId = useTabHostId();
  const client = useTabHostClient();
  const supportsList = useHostSupportsMethod(
    hostId,
    "epic.artifactVersions.list",
  );
  const supportsBlob = useHostSupportsMethod(
    hostId,
    "epic.artifactVersions.getBlob",
  );
  const supportsRestore = useHostSupportsMethod(
    hostId,
    "epic.artifactVersions.restore",
  );
  const supportsDeletedList = useHostSupportsMethod(
    hostId,
    "epic.deletedArtifacts.list",
  );
  const supportsRevive = useHostSupportsMethod(
    hostId,
    "epic.deletedArtifacts.revive",
  );
  const supportsSettings = useHostSupportsMethod(
    hostId,
    "epic.artifactVersionSettings.get",
  );
  const supported =
    supportsList &&
    supportsBlob &&
    supportsRestore &&
    supportsDeletedList &&
    supportsRevive &&
    supportsSettings;
  const [open, setOpen] = useState(false);

  if (!supported || openEpicHandle === null) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto text-muted-foreground"
            aria-label="Artifact actions"
            data-testid="artifact-header-menu"
          >
            <MoreHorizontalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => setOpen(true)}
            data-testid="artifact-version-history-entry"
          >
            <Clock3Icon className="size-4" />
            Version History
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ArtifactVersionHistorySheet
        open={open}
        onOpenChange={setOpen}
        artifactId={props.artifactId}
        epicId={openEpicHandle.epicId}
        hostId={hostId}
        client={client}
        openEpicHandle={openEpicHandle}
      />
    </>
  );
}

// This coordinates the restore union and both sheet modes as one state machine.
// eslint-disable-next-line complexity
function ArtifactVersionHistorySheet(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly artifactId: string;
  readonly epicId: string;
  readonly hostId: string;
  readonly client: HostClient<HostRpcRegistry> | null;
  readonly openEpicHandle: OpenEpicStoreHandle;
}): ReactNode {
  const tileNavigation = useEpicTileNavigation();
  const viewTabId = useEpicViewTabId();
  const [mode, setMode] = useState<HistoryMode>("versions");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] =
    useState<ArtifactVersionObservationEntry | null>(null);
  const [preflight, setPreflight] = useState<RestorePreflight | null>(null);
  const [preflightRefreshing, setPreflightRefreshing] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<OutcomeNotice | null>(null);
  const [pagination, setPagination] = useState<HistoryPagination | null>(null);

  const history = useHostQuery({
    client: props.client,
    method: "epic.artifactVersions.list",
    params: {
      epicId: props.epicId,
      artifactId: props.artifactId,
      limit: 200,
    },
    cacheKeyIdentity: undefined,
    options: { enabled: props.open && mode === "versions" },
  });
  const settings = useHostQuery({
    client: props.client,
    method: "epic.artifactVersionSettings.get",
    params: {},
    cacheKeyIdentity: undefined,
    options: { enabled: props.open },
  });
  const deleted = useHostQuery({
    client: props.client,
    method: "epic.deletedArtifacts.list",
    params: { epicId: props.epicId },
    cacheKeyIdentity: undefined,
    options: { enabled: props.open && mode === "deleted" },
  });

  const loadOlder = useHostScopedMutationForClient(props.client, {
    method: "epic.artifactVersions.list",
    mutationKey: ["artifact-version-history-load-older"],
    errorMessage: "Couldn't load older versions",
    invalidateMethods: [],
    onSuccess: (response) => {
      setPagination((current) => ({
        queryUpdatedAt: history.dataUpdatedAt,
        entries: mergeObservationPages(
          history.data?.entries ?? [],
          current?.queryUpdatedAt === history.dataUpdatedAt
            ? current.entries
            : [],
          response.entries,
        ),
        nextCursor: response.nextCursor,
      }));
    },
  });

  const currentPagination =
    pagination?.queryUpdatedAt === history.dataUpdatedAt ? pagination : null;
  const entries = mergeObservationPages(
    history.data?.entries ?? [],
    currentPagination?.entries ?? [],
  );
  const nextCursor =
    currentPagination === null
      ? (history.data?.nextCursor ?? null)
      : currentPagination.nextCursor;
  const availableEntries = entries.filter((entry) => entry.available);
  const unavailableCount = entries.length - availableEntries.length;
  const selected =
    entries.find((entry) => entry.observationId === selectedId) ??
    availableEntries.at(0) ??
    null;
  const comparison = comparisonFor(entries, selected);
  const selectedBlob = useHostQuery({
    client: props.client,
    method: "epic.artifactVersions.getBlob",
    params: {
      epicId: props.epicId,
      artifactId: props.artifactId,
      observationId: selected?.observationId ?? "unselected",
    },
    cacheKeyIdentity:
      selected?.contentHash === undefined ? undefined : [selected.contentHash],
    options: {
      enabled:
        props.open &&
        mode === "versions" &&
        selected !== null &&
        selected.available,
    },
  });
  const comparisonBlob = useHostQuery({
    client: props.client,
    method: "epic.artifactVersions.getBlob",
    params: {
      epicId: props.epicId,
      artifactId: props.artifactId,
      observationId: comparison?.entry.observationId ?? "unselected",
    },
    cacheKeyIdentity:
      comparison?.entry.contentHash === undefined
        ? undefined
        : [comparison.entry.contentHash],
    options: {
      enabled: props.open && mode === "versions" && comparison !== null,
    },
  });

  const restore = useHostScopedMutationForClient(props.client, {
    method: "epic.artifactVersions.restore",
    mutationKey: ["artifact-version-restore"],
    errorMessage: "Couldn't restore this version",
    invalidateMethods: ["epic.artifactVersions.list"],
  });
  const revive = useHostScopedMutationForClient(props.client, {
    method: "epic.deletedArtifacts.revive",
    mutationKey: ["deleted-artifact-revive"],
    errorMessage: "Couldn't restore this artifact",
    invalidateMethods: [
      "epic.deletedArtifacts.list",
      "epic.artifactVersions.list",
    ],
  });
  const queryClient = useQueryClient();

  const requestPreflight = (
    entry: ArtifactVersionObservationEntry,
    conflict: boolean,
  ): void => {
    setRestoreTarget(entry);
    setUnavailable(null);
    setPreflightRefreshing(conflict);
    restore.mutate(
      {
        epicId: props.epicId,
        artifactId: props.artifactId,
        targetObservationId: entry.observationId,
        mode: "preflight",
      },
      {
        onSuccess: (response) => {
          setPreflightRefreshing(false);
          if (response.kind === "preflight") {
            setPreflight(response);
            return;
          }
          if (response.kind === "unavailable") {
            setPreflight(null);
            setUnavailable(RESTORE_UNAVAILABLE_COPY[response.reason]);
          }
        },
        onError: () => setPreflightRefreshing(false),
      },
    );
  };

  const executeRestore = (): void => {
    if (restoreTarget === null || preflight === null) return;
    restore.mutate(
      {
        epicId: props.epicId,
        artifactId: props.artifactId,
        targetObservationId: restoreTarget.observationId,
        mode: "execute",
        expectedCurrentHash: preflight.currentHash,
        bodyOnly: preflight.imagesMissing.length > 0,
      },
      {
        onSuccess: (response) => {
          if (response.kind === "conflict") {
            requestPreflight(restoreTarget, true);
            return;
          }
          if (response.kind === "unavailable") {
            setUnavailable(RESTORE_UNAVAILABLE_COPY[response.reason]);
            return;
          }
          if (response.kind !== "outcome") return;
          setOutcome({
            status: response.status,
            observationId: response.newObservationId,
          });
          setSelectedId(response.newObservationId);
          setRestoreTarget(null);
          setPreflight(null);
          void queryClient.invalidateQueries({
            queryKey: hostQueryKeys.methodScope(
              props.hostId,
              "epic.artifactVersions.list",
            ),
          });
        },
      },
    );
  };

  const diff = useMemo(() => {
    if (selectedBlob.data === undefined) return [];
    return diffLines(
      comparisonBlob.data?.markdown ?? "",
      selectedBlob.data.markdown,
    );
  }, [comparisonBlob.data?.markdown, selectedBlob.data]);

  const openProvenanceChat = (chatId: string): void => {
    if (viewTabId === null) return;
    const ref = epicNodeRefForNodeId(
      props.openEpicHandle.store.getState(),
      chatId,
      props.hostId,
    );
    if (ref === null) return;
    tileNavigation.openTilePreviewInTab(viewTabId, ref);
  };

  return (
    <>
      <Sheet open={props.open} onOpenChange={props.onOpenChange}>
        <SheetContent
          className="w-full sm:max-w-2xl"
          data-testid="artifact-version-history-sheet"
        >
          <SheetHeader className="border-b pr-12">
            <SheetTitle>
              {mode === "versions" ? "Version history" : "Deleted artifacts"}
            </SheetTitle>
            <SheetDescription>
              {mode === "versions"
                ? "Saved observations from this host, in capture order."
                : "Artifacts that can still be restored from local history."}
            </SheetDescription>
          </SheetHeader>

          {mode === "deleted" ? (
            <DeletedArtifactsView
              entries={deleted.data?.entries ?? []}
              loading={deleted.isLoading}
              pendingArtifactId={
                revive.isPending ? revive.variables.artifactId : null
              }
              onBack={() => setMode("versions")}
              onRevive={(artifactId) =>
                revive.mutate({ epicId: props.epicId, artifactId })
              }
            />
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.2fr)] overflow-hidden">
              <div className="min-h-0 overflow-y-auto border-r">
                {settings.data?.settings.enabled === false ? (
                  <div className="m-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-ui-sm">
                    <p className="font-medium">
                      Version history is off — turn it on in Settings.
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      Existing versions remain available below.
                    </p>
                  </div>
                ) : null}
                {history.isLoading ? (
                  <p className="p-4 text-muted-foreground">Loading history…</p>
                ) : null}
                {!history.isLoading && entries.length === 0 ? (
                  <p className="p-4 text-muted-foreground">
                    No versions captured yet.
                  </p>
                ) : null}
                <VersionObservationList
                  entries={availableEntries}
                  selectedId={selected === null ? null : selected.observationId}
                  outcome={outcome}
                  onSelect={setSelectedId}
                  onOpenChat={openProvenanceChat}
                />
                {nextCursor === null ? null : (
                  <div className="border-t p-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      disabled={loadOlder.isPending}
                      onClick={() =>
                        loadOlder.mutate({
                          epicId: props.epicId,
                          artifactId: props.artifactId,
                          cursor: nextCursor,
                          limit: 200,
                        })
                      }
                    >
                      Load older versions
                    </Button>
                  </div>
                )}
                {unavailableCount > 0 ? (
                  <p className="border-t p-3 text-ui-xs text-muted-foreground">
                    {unavailableCount} older{" "}
                    {unavailableCount === 1 ? "version is" : "versions are"}{" "}
                    unavailable from this machine.
                  </p>
                ) : null}
              </div>
              <VersionDiffView
                selected={selected}
                comparisonLabel={comparison?.label ?? null}
                diff={diff}
                loading={selectedBlob.isLoading || comparisonBlob.isLoading}
                outcome={outcome?.status ?? null}
                onRestore={() => {
                  if (selected !== null) requestPreflight(selected, false);
                }}
              />
            </div>
          )}

          {mode === "versions" ? (
            <SheetFooter className="border-t">
              <Button
                variant="ghost"
                className="justify-start"
                onClick={() => setMode("deleted")}
              >
                Deleted artifacts
                {deleted.data === undefined
                  ? null
                  : ` (${deleted.data.entries.length})`}
              </Button>
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>

      <RestoreVersionDialog
        target={restoreTarget}
        preflight={preflight}
        unavailable={unavailable}
        refreshing={preflightRefreshing}
        pending={restore.isPending}
        onCancel={() => {
          setRestoreTarget(null);
          setPreflight(null);
          setUnavailable(null);
        }}
        onConfirm={executeRestore}
      />
    </>
  );
}

function VersionObservationList(props: {
  readonly entries: readonly ArtifactVersionObservationEntry[];
  readonly selectedId: string | null;
  readonly outcome: OutcomeNotice | null;
  readonly onSelect: (observationId: string) => void;
  readonly onOpenChat: (chatId: string) => void;
}): ReactNode {
  let previousDay: string | null = null;
  return props.entries.map((entry, index) => {
    const day = dayLabel(entry.capturedAt);
    const showDay = day !== previousDay;
    previousDay = day;
    const olderEntry = props.entries.at(index + 1);
    const renormalizedByEditorUpdate =
      olderEntry !== undefined &&
      entry.serializerVersion !== olderEntry.serializerVersion;
    const isNewOutcome = props.outcome?.observationId === entry.observationId;
    return (
      <div key={entry.observationId}>
        {showDay ? (
          <p className="border-b bg-muted/25 px-3 py-1.5 text-ui-xs font-medium text-muted-foreground">
            {day}
          </p>
        ) : null}
        <div
          className={cn(
            "border-b transition-colors hover:bg-muted/40",
            props.selectedId === entry.observationId && "bg-muted/60",
          )}
        >
          <button
            type="button"
            aria-label={`Select version ${entry.observationId}`}
            data-testid={`artifact-version-observation-${entry.observationId}`}
            onClick={() => props.onSelect(entry.observationId)}
            className="w-full px-3 pt-3 pb-2 text-left"
          >
            <span className="flex items-center justify-between gap-2">
              <Badge variant="outline" className="font-medium">
                {PROVENANCE_LABELS[entry.provenance.kind]}
              </Badge>
              <span className="text-ui-xs text-muted-foreground">
                {formatCapturedAt(entry.capturedAt)}
              </span>
            </span>
            <span className="mt-2 flex flex-wrap gap-1">
              {renormalizedByEditorUpdate ? (
                <Badge
                  variant="outline"
                  className="border-blue-500/30 text-blue-600 dark:text-blue-400"
                >
                  re-normalized by editor update
                </Badge>
              ) : null}
              {entry.degraded ? (
                <Badge variant="destructive">Body only — images missing</Badge>
              ) : null}
              {isNewOutcome && props.outcome.status === "clean" ? (
                <Badge
                  variant="outline"
                  className="border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                >
                  Restored
                </Badge>
              ) : null}
              {isNewOutcome && props.outcome.status === "renormalized" ? (
                <Badge
                  variant="outline"
                  className="border-blue-500/30 text-blue-600 dark:text-blue-400"
                >
                  re-normalized by a newer editor version — review
                </Badge>
              ) : null}
              {isNewOutcome && props.outcome.status === "degraded" ? (
                <Badge variant="destructive">
                  Restored with missing image content
                </Badge>
              ) : null}
            </span>
          </button>
          <ObservationProvenanceDetail
            provenance={entry.provenance}
            onOpenChat={props.onOpenChat}
          />
        </div>
      </div>
    );
  });
}

function diffPartKind(part: Change): "added" | "removed" | "unchanged" {
  if (part.added) return "added";
  if (part.removed) return "removed";
  return "unchanged";
}

function VersionDiffView(props: {
  readonly selected: ArtifactVersionObservationEntry | null;
  readonly comparisonLabel: string | null;
  readonly diff: readonly Change[];
  readonly loading: boolean;
  readonly outcome: OutcomeNotice["status"] | null;
  readonly onRestore: () => void;
}): ReactNode {
  if (props.selected === null) {
    return (
      <p className="p-5 text-muted-foreground">
        Select a version to inspect it.
      </p>
    );
  }
  return (
    <div className="flex min-h-0 flex-col overflow-hidden">
      {props.outcome === "clean" ? (
        <p className="border-b border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-ui-sm text-emerald-700 dark:text-emerald-300">
          Restored as a new version.
        </p>
      ) : null}
      {props.outcome === "renormalized" ? (
        <p className="border-b border-blue-500/30 bg-blue-500/10 px-4 py-2 text-ui-sm text-blue-700 dark:text-blue-300">
          Restored. Content was re-normalized by a newer editor version —
          formatting may differ slightly.{" "}
          <a href="#artifact-version-diff" className="underline">
            Review changes
          </a>
        </p>
      ) : null}
      {props.outcome === "degraded" ? (
        <p className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-ui-sm text-amber-700 dark:text-amber-300">
          Restored as a new version with missing image content. The new row is
          marked Body only.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <div>
          <p className="font-medium">
            {formatCapturedAt(props.selected.capturedAt)}
          </p>
          <p className="text-ui-xs text-muted-foreground">
            {props.comparisonLabel ?? "Saved content"}
          </p>
        </div>
        <Button size="sm" onClick={props.onRestore}>
          <RotateCcwIcon className="size-4" />
          Restore this version
        </Button>
      </div>
      {props.loading ? (
        <p className="p-4 text-muted-foreground">Loading comparison…</p>
      ) : (
        <pre
          id="artifact-version-diff"
          className="min-h-0 flex-1 overflow-auto p-4 font-mono text-ui-xs whitespace-pre-wrap"
        >
          {props.diff.map((part) => (
            <span
              key={`${diffPartKind(part)}-${part.count}-${part.value}`}
              className={cn(
                "block",
                part.added &&
                  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                part.removed && "bg-destructive/10 text-destructive",
              )}
            >
              {part.value}
            </span>
          ))}
        </pre>
      )}
    </div>
  );
}

function RestoreVersionDialog(props: {
  readonly target: ArtifactVersionObservationEntry | null;
  readonly preflight: RestorePreflight | null;
  readonly unavailable: string | null;
  readonly refreshing: boolean;
  readonly pending: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): ReactNode {
  return (
    <Dialog
      open={props.target !== null}
      onOpenChange={(open) => !open && props.onCancel()}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Restore this version?</DialogTitle>
          <DialogDescription>
            It becomes a new version at the top of history. Nothing is deleted.
          </DialogDescription>
        </DialogHeader>
        {props.refreshing ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-ui-sm">
            The artifact changed since you looked. Refreshing the checks before
            restoring…
          </div>
        ) : null}
        {props.preflight === null && props.unavailable === null ? (
          <p className="text-muted-foreground">
            Checking the current artifact…
          </p>
        ) : null}
        {props.preflight === null || props.refreshing ? null : (
          <div className="space-y-3">
            <p className="rounded-md bg-muted/50 p-3 font-mono text-ui-xs break-all">
              Current hash: {props.preflight.currentHash}
            </p>
            {props.preflight.threadCount > 0 ? (
              <div className="flex gap-2 rounded-lg border p-3">
                <InfoIcon className="mt-0.5 size-4 shrink-0 text-blue-500" />
                <p>
                  {props.preflight.threadCount} anchored{" "}
                  {props.preflight.threadCount === 1 ? "comment" : "comments"}:
                  comments keep their text but may lose their place.
                </p>
              </div>
            ) : null}
            {props.preflight.imagesMissing.length > 0 ? (
              <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <div>
                  <p className="font-medium">
                    {props.preflight.imagesMissing.length} image{" "}
                    {props.preflight.imagesMissing.length === 1
                      ? "pin is"
                      : "pins are"}{" "}
                    missing.
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    You can restore the body only, or cancel.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        )}
        {props.unavailable === null ? null : (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            {props.unavailable}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button
            onClick={props.onConfirm}
            disabled={
              props.preflight === null ||
              props.unavailable !== null ||
              props.refreshing ||
              props.pending
            }
          >
            {props.preflight !== null &&
            props.preflight.imagesMissing.length > 0
              ? "Restore body only"
              : "Restore as new version"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function deletedArtifactUnavailableCopy(
  reason: DeletedArtifactEntry["unrestorable"],
): string | null {
  if (reason === "missing-scalars") {
    return "Cannot restore: the artifact's title, kind, or tree position is missing.";
  }
  if (reason === "missing-blob") {
    return "Cannot restore: the saved artifact body is missing.";
  }
  return null;
}

function DeletedArtifactsView(props: {
  readonly entries: readonly DeletedArtifactEntry[];
  readonly loading: boolean;
  readonly pendingArtifactId: string | null;
  readonly onBack: () => void;
  readonly onRevive: (artifactId: string) => void;
}): ReactNode {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <Button variant="ghost" size="sm" className="mb-3" onClick={props.onBack}>
        <ArrowLeftIcon className="size-4" />
        Back to history
      </Button>
      {props.loading ? (
        <p className="text-muted-foreground">Loading deleted artifacts…</p>
      ) : null}
      {!props.loading && props.entries.length === 0 ? (
        <p className="text-muted-foreground">
          No deleted artifacts are retained.
        </p>
      ) : null}
      <div className="space-y-2">
        {props.entries.map((entry) => {
          const reason = deletedArtifactUnavailableCopy(entry.unrestorable);
          return (
            <div
              key={entry.artifactId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div>
                <p className="font-medium">
                  {entry.title ?? "Untitled artifact"}
                </p>
                <p className="text-ui-xs text-muted-foreground">
                  Deleted {formatCapturedAt(entry.deletedAt)} ·{" "}
                  {entry.versionCount}{" "}
                  {entry.versionCount === 1 ? "version" : "versions"}
                </p>
                {reason === null ? null : (
                  <p className="mt-1 text-ui-xs text-amber-600 dark:text-amber-400">
                    {reason}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  reason !== null ||
                  props.pendingArtifactId === entry.artifactId
                }
                onClick={() => props.onRevive(entry.artifactId)}
              >
                Restore artifact
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
