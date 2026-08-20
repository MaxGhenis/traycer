import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { DeletedArtifactEntry } from "@traycer/protocol/host/epic/artifact-versions";
import { Button } from "@/components/ui/button";
import { useHostQuery } from "@/hooks/host/use-host-query";
import { useHostScopedMutationForClient } from "@/hooks/host/use-host-scoped-mutation";
import { useTabHostClient } from "@/hooks/host/use-tab-host-client";
import { epicMutationKeys } from "@/lib/query-keys";
import type { DeletedArtifactsTileRef } from "@/stores/epics/canvas/types";

const DELETED_AT_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatDeletedAt(timestamp: number): string {
  return DELETED_AT_FORMATTER.format(new Date(timestamp));
}

function deletedArtifactUnavailableCopy(
  reason: DeletedArtifactEntry["unrestorable"],
): string | null {
  if (reason === "missing_scalars") {
    return "Cannot restore: the artifact's title, kind, or tree position is missing.";
  }
  if (reason === "missing_blob") {
    return "Cannot restore: the saved artifact body is missing.";
  }
  return null;
}

export function DeletedArtifactsTile(props: {
  readonly node: DeletedArtifactsTileRef;
}): ReactNode {
  const client = useTabHostClient();
  const deleted = useHostQuery({
    client,
    method: "epic.deletedArtifacts.list",
    params: { epicId: props.node.epicId },
    cacheKeyIdentity: undefined,
    options: { enabled: true },
  });
  const revive = useHostScopedMutationForClient(client, {
    method: "epic.deletedArtifacts.revive",
    mutationKey: epicMutationKeys.reviveDeletedArtifact(),
    errorMessage: "Couldn't restore this artifact",
    invalidateMethods: ["epic.deletedArtifacts.list"],
  });
  const entries = deleted.data?.entries ?? [];

  return (
    <section
      aria-label="Deleted artifacts"
      data-testid="deleted-artifacts-tile"
      className="flex h-full min-h-0 flex-col bg-background"
    >
      <header className="flex shrink-0 items-center gap-3 border-b px-5 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Trash2 className="size-4" />
        </div>
        <div className="min-w-0">
          <h1 className="font-semibold">Deleted artifacts</h1>
          <p className="text-ui-sm text-muted-foreground">
            Restore artifacts retained in this epic&apos;s version history.
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto w-full max-w-4xl">
          {deleted.isLoading ? (
            <p className="text-muted-foreground">Loading deleted artifacts…</p>
          ) : null}
          {deleted.isError ? (
            <div>
              <p className="text-muted-foreground">
                Couldn&apos;t load deleted artifacts.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void deleted.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : null}
          {!deleted.isLoading && !deleted.isError && entries.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <p className="font-medium">No deleted artifacts</p>
              <p className="mt-1 text-ui-sm text-muted-foreground">
                Artifacts retained after deletion will appear here.
              </p>
            </div>
          ) : null}
          <div className="space-y-2">
            {entries.map((entry) => {
              const reason = deletedArtifactUnavailableCopy(entry.unrestorable);
              return (
                <div
                  key={entry.artifactId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {entry.title ?? "Untitled artifact"}
                    </p>
                    <p className="text-ui-xs text-muted-foreground">
                      Deleted {formatDeletedAt(entry.deletedAt)} ·{" "}
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
                      (revive.isPending &&
                        revive.variables.artifactId === entry.artifactId)
                    }
                    onClick={() =>
                      revive.mutate({
                        epicId: props.node.epicId,
                        artifactId: entry.artifactId,
                      })
                    }
                  >
                    Restore artifact
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
