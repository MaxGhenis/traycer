import { useEffect, useState } from "react";
import type { AgentActivityCloudSyncStatus } from "@traycer/protocol/host/agent/activity";
import type { StreamConnectionStatus } from "@traycer-clients/shared/host-transport/i-stream-session";
import { useAgentActivityStore } from "@/stores/agent-activity-store";
import { useNotificationsServingHostEntry } from "@/hooks/host/use-notifications-serving-host-entry";

/**
 * How long a degraded reading may hold before the pill is allowed to say so.
 *
 * The stream opens a beat after the Epic's own host link on a cold start and
 * is re-dialled by its own lane after a close; the host's room lifecycle treats
 * `reconnecting` as a blip it rides out before rebuilding. Neither is worth an
 * amber flash. Past this the user is looking at spinners that may no longer be
 * true.
 */
const PRESENCE_DEGRADED_GRACE_MS = 2_000;

/**
 * Why agent status on this Epic may be stale or unknown, or `null` when the
 * presence plane is healthy (or silent - see below).
 *
 * - `stream-down`: `agent.activity.subscribe` is not open. Nothing is being
 *   delivered; whatever the store last painted (it clears on close) is gone.
 * - `cloud-down`: the stream is open and the host stamped the latest union
 *   with a cloud link that is `reconnecting` / `disconnected`. The union was
 *   built while the host could not see other hosts' agents - hocuspocus drops
 *   every remote awareness entry the instant the socket closes - so agents on
 *   other devices may read idle. Agents on THIS device stay live: the local
 *   entry is never removed on close.
 *
 * `cloudSyncStatus === null` is deliberately NOT degraded: it is no claim (a
 * local-plane frame, a `1.0` host that predates the field, or no frame yet),
 * and inventing "blind" out of silence is the lie this field exists to end.
 */
export type AgentActivityPresenceDegradedReason = "stream-down" | "cloud-down";

/**
 * Amber = presence unavailable: the reading behind every working/turn spinner
 * cannot be trusted for this Epic, while the canvas, chats and terminals all
 * keep working - which is why it is a warning on the Epic pill and never a
 * blocking state.
 *
 * `stream-down` wins when both hold: once the stream is gone the stamped cloud
 * status is as stale as the union it came with.
 *
 * Bootstrap, brief reopen windows and socket flaps are held back by
 * {@link PRESENCE_DEGRADED_GRACE_MS}, keyed on the REASON so a flip between the
 * two restarts the grace rather than inheriting the other's.
 */
export function useAgentActivityPresenceDegraded(): AgentActivityPresenceDegradedReason | null {
  // Resolved HERE rather than taken from the caller, and the distinction is
  // the whole design of this hook.
  //
  // Callers want one fact - "may this Epic's agent status be stale?" - and the
  // answer belongs to the stream CARRYING that activity, which since the
  // renderer settled on one host-selected activity stream is the SERVING host,
  // never the surface's own host. A caller that passed its own host id would
  // amber permanently the moment that host was not the one serving, because
  // only a host with an open stream has a slice and an absent slice reads as
  // `stream-down` below. Asking a presentation component to know that is how
  // the bug gets written; so it is not asked.
  //
  // The single-stream assumption is load-bearing and DORMANT, not gone: the
  // store stays host-keyed (a bare union read would let an idle host's dead
  // stream amber a healthy Epic), and exactly one slice is populated today. If
  // anything ever opens a second activity stream - the local-served gap in
  // `renderer-unserved-plane-assertions` proposes precisely that - this hook
  // needs a caller-supplied stream identity again, and the keying it reads
  // through is deliberately still here for that day.
  const servingHostId = useNotificationsServingHostEntry()?.hostId ?? null;
  const reason = useAgentActivityStore((state) =>
    servingHostId === null
      ? null
      : selectPresenceDegradedReason(state.byHost.get(servingHostId) ?? null),
  );
  const [sustained, setSustained] =
    useState<AgentActivityPresenceDegradedReason | null>(null);
  // Render-phase adjustment rather than an effect: React re-runs the render
  // before committing, so a recovery never paints one frame of stale amber.
  if (sustained !== null && sustained !== reason) {
    setSustained(null);
  }
  useEffect(() => {
    if (reason === null) return undefined;
    const timer = window.setTimeout(() => {
      setSustained(reason);
    }, PRESENCE_DEGRADED_GRACE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [reason]);
  return reason !== null && sustained === reason ? reason : null;
}

function selectPresenceDegradedReason(
  // An absent slice is a host whose stream has never spoken - the same
  // reading as a non-`open` one, and the state a freshly opened epoch sits in
  // until its own session reports.
  host: {
    readonly connectionStatus: StreamConnectionStatus;
    readonly cloudSyncStatus: AgentActivityCloudSyncStatus | null;
  } | null,
): AgentActivityPresenceDegradedReason | null {
  if (host === null || host.connectionStatus !== "open") return "stream-down";
  if (
    host.cloudSyncStatus === "reconnecting" ||
    host.cloudSyncStatus === "disconnected"
  ) {
    return "cloud-down";
  }
  return null;
}
