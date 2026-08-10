import { Button } from "@/components/ui/button";
import { useEpicExportArtifacts } from "@/hooks/epic/use-epic-export-artifacts-mutation";
import {
  useEpicArtifactRecords,
  useEpicDurabilityPauseReason,
  useEpicDurabilityPromotionState,
  useEpicDurabilityView,
  useEpicSnapshotMeta,
  type EpicDurabilityView,
} from "@/lib/epic-selectors";
import { isEpicArtifactKind } from "@/lib/artifacts/node-display";
import { resolveManageSubscriptionUrl } from "@/lib/auth/manage-subscription-url";
import { cn } from "@/lib/utils";
import { useRunnerHost } from "@/providers/use-runner-host";
import type {
  EpicDurabilityPauseReasonV14,
  EpicLocalProtection,
  EpicPromotionState,
} from "@traycer/protocol/host/epic/subscribe";

/**
 * Host routing truth, kept separate from the cloud-sync pill: cloud transport
 * is not enough to tell a person whether their epic is local, promoting, or a
 * locally served cloud mirror.
 */
export function EpicDurabilityBadge() {
  const view = useEpicDurabilityView();
  const pauseReason = useEpicDurabilityPauseReason();
  const promotionState = useEpicDurabilityPromotionState();
  // Two silences, and only ONE of them is nothing to say.
  //
  // `cloudDurable` is the host positively stating that the epic is in the
  // cloud and this session is locally protected, so there is genuinely no
  // badge to draw - that is the ordinary online case and it stays silent.
  // `legacy` is a pre-`@1.4` peer with no durability answer, which is exactly
  // the rendering it had before this minor.
  //
  // What used to join them is `indeterminate`, and it does not any more: an
  // unknown or unprotected session drew no badge at all, so it looked
  // identical to a protected one. It now draws.
  if (view.kind === "cloudDurable") return null;
  if (view.kind === "legacy" && view.status === null) return null;
  return (
    <EpicDurabilityBadgeContent
      view={view}
      pauseReason={pauseReason}
      promotionState={promotionState}
    />
  );
}

function EpicDurabilityBadgeContent(props: {
  readonly view: EpicDurabilityView;
  readonly pauseReason: EpicDurabilityPauseReasonV14 | null;
  readonly promotionState: EpicPromotionState | null;
}) {
  const runnerHost = useRunnerHost();
  const exportArtifacts = useEpicExportArtifacts();
  const records = useEpicArtifactRecords();
  const meta = useEpicSnapshotMeta();

  const artifacts = records.flatMap((record) =>
    isEpicArtifactKind(record.type)
      ? [{ id: record.id, title: record.name }]
      : [],
  );
  const exportLocalArtifacts = (): void => {
    exportArtifacts.mutate({
      artifacts,
      format: "markdown",
      archive: true,
      archiveTitle: meta?.epicLight?.title ?? "Traycer",
    });
  };
  const status = viewStatus(props.view);
  const protection = viewProtection(props.view);
  const badge = badgeCopy(props.view, props.pauseReason, props.promotionState);
  return (
    <span
      data-testid="epic-durability-badge"
      data-durability-status={status ?? "unknown"}
      data-local-protection={protection ?? undefined}
      data-pause-reason={props.pauseReason ?? undefined}
      data-promotion-state={props.promotionState ?? undefined}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-ui-xs font-medium",
        badge.className,
      )}
    >
      <span>{badge.label}</span>
      {status === "paused" && props.pauseReason === "entitlement-lapsed" ? (
        <button
          type="button"
          className="underline underline-offset-2"
          data-testid="epic-durability-upgrade"
          onClick={() => {
            void runnerHost.openExternalLink(
              resolveManageSubscriptionUrl(runnerHost.authnBaseUrl),
            );
          }}
        >
          Upgrade
        </button>
      ) : null}
      {status === "paused" && props.pauseReason === "access-revoked" ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="h-auto px-0 text-current underline underline-offset-2"
          data-testid="epic-durability-export"
          disabled={artifacts.length === 0 || exportArtifacts.isPending}
          onClick={exportLocalArtifacts}
        >
          Export artifacts
        </Button>
      ) : null}
    </span>
  );
}

/** The concrete durability value to render, or `null` for indeterminate. */
function viewStatus(
  view: EpicDurabilityView,
): "local" | "promoting" | "paused" | "offline" | null {
  if (view.kind === "stated") return view.status;
  if (
    view.kind === "legacy" &&
    view.status !== null &&
    view.status !== "unknown"
  ) {
    return view.status;
  }
  return null;
}

function viewProtection(view: EpicDurabilityView): EpicLocalProtection | null {
  if (view.kind === "stated" || view.kind === "indeterminate") {
    return view.protection;
  }
  return null;
}

/**
 * What the badge says, TOTAL over the view - `s5-status-truthfulness`.
 *
 * The `indeterminate` arms are the new ones and they are the reason this
 * function exists in this shape. A `switch` over the raw status enum returned
 * `undefined` for anything it did not name, and the caller dereferenced
 * `.label` straight off it - so `@1.4`'s `unknown` member would not have
 * degraded, it would have thrown. More importantly, the states that reached
 * here as `null` drew NOTHING, which is how an unprotected session came to
 * look exactly like a protected one.
 */
function badgeCopy(
  view: EpicDurabilityView,
  pauseReason: EpicDurabilityPauseReasonV14 | null,
  promotionState: EpicPromotionState | null,
): { readonly label: string; readonly className: string } {
  if (view.kind === "indeterminate") {
    // `unavailable` is a stated FACT about risk, not an absence, so it gets
    // the stronger treatment and names the consequence rather than the
    // mechanism - "no local backup" is what a person can act on; "the WAL is
    // unarmed" is not.
    return view.protection === "unavailable"
      ? {
          label: "No local backup",
          className: "bg-destructive/10 text-destructive",
        }
      : {
          label: "Storage status unknown",
          className: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        };
  }
  const status = viewStatus(view);
  if (status === null) {
    return {
      label: "Storage status unknown",
      className: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  if (status === "promoting" && promotionState === "pending") {
    return {
      label: "Promotion pending",
      className: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  switch (status) {
    case "local":
      return {
        label: "Stored locally",
        className: "bg-muted text-muted-foreground",
      };
    case "promoting":
      return {
        label: "Promoting to cloud",
        className: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
      };
    case "offline":
      return {
        label: "Cloud mirror \u2014 offline",
        className: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      };
    case "paused":
      return pausedCopy(pauseReason);
  }
}

/**
 * The paused arm, widened for `@1.4`'s three delete-path reasons -
 * `s5-status-truthfulness` instance 2.
 *
 * All three used to arrive as a bare `paused` and render "Sync paused", which
 * is true and useless. `orphaned-local-edits-after-cloud-delete` is the
 * actionable one: the epic holds local edits the deleted cloud copy never
 * received, so it is the only member here that is a warning rather than a
 * status.
 */
function pausedCopy(pauseReason: EpicDurabilityPauseReasonV14 | null): {
  readonly label: string;
  readonly className: string;
} {
  switch (pauseReason) {
    case "access-revoked":
      return {
        label: "Sync blocked \u2014 access revoked",
        className: "bg-destructive/10 text-destructive",
      };
    case "orphaned-local-edits-after-cloud-delete":
      return {
        label: "Deleted in cloud \u2014 local edits kept here",
        className: "bg-destructive/10 text-destructive",
      };
    case "delete-pending-acknowledgement":
      return {
        label: "Delete pending",
        className: "bg-muted text-muted-foreground",
      };
    case "delete-tombstone-unscoped-cleared":
      return {
        label: "Delete recorded \u2014 tidying up",
        className: "bg-muted text-muted-foreground",
      };
    case "entitlement-lapsed":
    case null:
      return {
        label: "Sync paused",
        className: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      };
  }
}
