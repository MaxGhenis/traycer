import { useMemo } from "react";
import type {
  HostNotificationsIndicatorState,
  HostNotificationsIndicatorStateResponse,
} from "@traycer/protocol/host/notifications/contracts";
import { useNotificationFeedMode } from "@/lib/notifications/notification-feed-mode";
import {
  useHostNotificationIndicators,
  type UseHostNotificationIndicatorsArgs,
} from "@/hooks/notifications/use-host-notification-indicators-query";
import { useCloudNotificationsStore } from "@/stores/notifications/cloud-notifications-store";
import {
  EMPTY_INDICATOR_STATE_RESPONSE,
  selectCloudNotificationIndicators,
} from "@/stores/notifications/notification-indicator-state";

/**
 * Per-entity indicator flags for one surface. In mixed mode the host and
 * cloud calls each return one exact durable-home partition and their boolean
 * flags are ORed; neither side derives counts from its loaded rows.
 *
 * The mixed mode label remains `cloud`, but its inputs are two disjoint
 * durable-home partitions: the host's v1.1 `home: local` indicator response
 * and the cloud snapshot. A foreign cloud row never enters the local origin,
 * while a local-homed row is absent from the cloud partition, so the OR merge
 * neither drops nor double-counts a notification. The cloud store still owns
 * optimistic cloud-row reads, keeping its visible row and its contribution to
 * the indicator coherent while that mutation is in flight.
 *
 * In local mode this remains the whole-origin host path for old/methodless
 * hosts and the local-only product; only mixed mode asks the host for its
 * `home: local` partition.
 *
 * App-local failure rows contribute in BOTH modes - they are client-side
 * state, neither host nor cloud state - and are folded in downstream by
 * `selectNotificationIndicatorState`, not here.
 */
export function useNotificationIndicators(
  args: UseHostNotificationIndicatorsArgs,
): HostNotificationsIndicatorStateResponse {
  const feedMode = useNotificationFeedMode();
  const isMixed = feedMode === "cloud";
  const hostIndicators = useHostNotificationIndicators({
    epicIds: args.epicIds,
    chatIds: args.chatIds,
    chatEpicIds: args.chatEpicIds,
    home: isMixed ? "local" : undefined,
    enabled: args.enabled,
  });
  const cloudRows = useCloudNotificationsStore((state) => state.rows);
  const cloudIndicators = useMemo(
    () =>
      isMixed && args.enabled
        ? selectCloudNotificationIndicators(
            cloudRows,
            args.epicIds,
            args.chatIds,
          )
        : EMPTY_INDICATOR_STATE_RESPONSE,
    [isMixed, args.enabled, cloudRows, args.epicIds, args.chatIds],
  );
  return isMixed
    ? mergeNotificationIndicatorPartitions(hostIndicators.data, cloudIndicators)
    : hostIndicators.data;
}

function mergeNotificationIndicatorPartitions(
  local: HostNotificationsIndicatorStateResponse,
  cloud: HostNotificationsIndicatorStateResponse,
): HostNotificationsIndicatorStateResponse {
  return {
    epics: mergeIndicatorRecord(local.epics, cloud.epics),
    chats: mergeIndicatorRecord(local.chats, cloud.chats),
  };
}

function mergeIndicatorRecord(
  local: HostNotificationsIndicatorStateResponse["epics"],
  cloud: HostNotificationsIndicatorStateResponse["epics"],
): HostNotificationsIndicatorStateResponse["epics"] {
  const merged = { ...local };
  for (const [id, cloudState] of Object.entries(cloud)) {
    merged[id] = orIndicatorState(readIndicatorState(merged, id), cloudState);
  }
  return merged;
}

/**
 * A record read that admits the id may be absent.
 *
 * The wire type is a `z.record`, which TypeScript widens to a TOTAL
 * `Record<string, T>` - so an inline `record[id] === undefined` check reads as
 * dead code to the type checker while being the only thing standing between a
 * partition that lacks the id and a `.pendingApproval` on `undefined`.
 */
function readIndicatorState(
  record: HostNotificationsIndicatorStateResponse["epics"],
  id: string,
): HostNotificationsIndicatorState | undefined {
  return Object.hasOwn(record, id) ? record[id] : undefined;
}

/** Per-flag OR of two exact durable-home partitions. Neither drops the other:
 * a foreign cloud row never enters the local origin, and a local-homed row is
 * absent from the cloud partition. */
function orIndicatorState(
  local: HostNotificationsIndicatorState | undefined,
  cloud: HostNotificationsIndicatorState,
): HostNotificationsIndicatorState {
  if (local === undefined) return cloud;
  return {
    pendingApproval: local.pendingApproval || cloud.pendingApproval,
    pendingInterview: local.pendingInterview || cloud.pendingInterview,
    unreadFailure: local.unreadFailure || cloud.unreadFailure,
    unreadDone: local.unreadDone || cloud.unreadDone,
  };
}
