import { useMemo } from "react";
import { useNotificationFeedMode } from "@/lib/notifications/notification-feed-mode";
import {
  useHostNotificationIndicators,
  type UseHostNotificationIndicatorsArgs,
} from "@/hooks/notifications/use-host-notification-indicators-query";
import { useCloudNotificationsStore } from "@/stores/notifications/cloud-notifications-store";
import {
  EMPTY_INDICATOR_STATE_RESPONSE,
  mergeLocalPartitionIntoCloudIndicators,
  selectCloudNotificationIndicatorProjection,
  type SurfaceNotificationIndicators,
} from "@/stores/notifications/notification-indicator-state";

/**
 * Per-entity indicator flags for one surface, from whichever feeds are
 * authoritative - mirroring how the notification center itself is mode-aware.
 *
 * ## Mixed mode is two EXACT partitions, ORed
 *
 * The mode label is still `cloud`, but its inputs are two disjoint
 * durable-home partitions: the host's `indicatorState@1.1` response under
 * `home: "local"`, and the cloud snapshot. A foreign cloud row never enters
 * the local origin and a local-homed row is absent from the cloud partition,
 * so the per-flag OR neither drops a notification nor double-counts one.
 *
 * That disjointness is what licenses folding host feed bits in at all. Before
 * the `home` selector the host answered over its WHOLE SQLite, where an entry
 * produced on host B never appears - so its answer could not light a tab bound
 * to host A, and only the host-local `pendingFork` bit was safe to import.
 * `pendingFork` still comes from the host in both modes, but it now arrives as
 * one flag of the partition rather than as a special case: fork truth lives on
 * the connected host's notice board, which is part of that host's local plane.
 *
 * The cloud store keeps owning optimistic cloud-row reads, so its visible row
 * and its contribution to the indicator stay coherent while a mark-read
 * mutation is in flight.
 *
 * ## Local mode
 *
 * The whole-origin host path, for old/methodless hosts and the local-only
 * product. Only mixed mode asks the host to restrict itself to `home: local`.
 *
 * App-local failure rows contribute in BOTH modes - they are client-side
 * state, neither host nor cloud state - and are folded in downstream by
 * `selectNotificationIndicatorState`, not here.
 */
export function useNotificationIndicators(
  args: UseHostNotificationIndicatorsArgs,
): SurfaceNotificationIndicators {
  const feedMode = useNotificationFeedMode();
  const isMixed = feedMode === "cloud";
  const hostIndicators = useHostNotificationIndicators({
    epicIds: args.epicIds,
    chatIds: args.chatIds,
    chatEpicIds: args.chatEpicIds,
    home: isMixed ? "local" : undefined,
    enabled: args.enabled,
  });
  // The SAME owner as the stream and the RPC, read off the response rather
  // than looked up again: the query sends its request through
  // `useNotificationHost().client`, so the answer must be filed under that
  // host. Keying it by the ACTIVE host put host A's local-only indicators in
  // host B's `byOriginHostId` bucket whenever the two differed - host-bound
  // consumers then hid A's approval/failure indicators and could decorate B's
  // same-id tabs with them. Taking the id from the query instead of asking a
  // second hook is what makes the two unable to disagree.
  const notificationHostId = hostIndicators.hostId;
  const cloudRows = useCloudNotificationsStore((state) => state.rows);
  const cloudIndicators = useMemo<SurfaceNotificationIndicators>(() => {
    if (!isMixed || !args.enabled) return EMPTY_INDICATOR_STATE_RESPONSE;
    const projection = selectCloudNotificationIndicatorProjection(
      cloudRows,
      args.epicIds,
      args.chatIds,
    );
    return {
      ...projection.aggregate,
      byOriginHostId: projection.byOriginHostId,
    };
  }, [isMixed, args.enabled, cloudRows, args.epicIds, args.chatIds]);
  return isMixed
    ? mergeLocalPartitionIntoCloudIndicators(
        cloudIndicators,
        hostIndicators.data,
        notificationHostId,
      )
    : scopeIndicatorsToOrigin(hostIndicators.data, notificationHostId);
}

function scopeIndicatorsToOrigin(
  indicators: SurfaceNotificationIndicators,
  originHostId: string | null,
): SurfaceNotificationIndicators {
  if (originHostId === null) return indicators;
  return {
    ...indicators,
    byOriginHostId: { [originHostId]: indicators },
  };
}
