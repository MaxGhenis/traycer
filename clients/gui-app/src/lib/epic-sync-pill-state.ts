import type {
  EpicCloudSyncStatus,
  EpicDurabilityStatusV14,
  EpicLocalProtection,
} from "@traycer/protocol/host/epic/subscribe";
import type { StreamConnectionStatus } from "@traycer-clients/shared/host-transport/i-stream-session";

/**
 * What the Epic header's sync pill is allowed to claim.
 *
 * `synced` and `offlineChangesSavedLocally` are durability claims. The other
 * states deliberately claim nothing about durability: before the host has
 * confirmed an edit, or while the host-durability snapshot is unknown, this
 * window may be the only place that knows about it.
 */
export type EpicSyncPillState =
  /** Every leg of the chain has acknowledged everything we know about. */
  | "synced"
  /** Work has not yet been acknowledged by the host. */
  | "syncing"
  /** The host reports pending work without asserting its durability stage. */
  | "hostPending"
  /** Cloud is down while renderer-only work still awaits host acknowledgement. */
  | "offlineWithUnsavedChanges"
  /** Cloud is down and the host reports pending work with unknown durability. */
  | "offlineWithHostPending"
  /**
   * Host reachable and holding outstanding work durably, cloud link down.
   * The only state that claims local durability, and it is true because the
   * host persists root-doc and artifact-room updates to SQLite while its cloud
   * link is down and replays them on reconnect.
   */
  | "offlineChangesSavedLocally"
  /**
   * The epic is not in the cloud at all, and everything known is on disk here.
   *
   * Exists because `synced` was rendering beside the durability badge's
   * "Stored locally" - the pill read a `LocalRoomConnection` as
   * connected/clean and concluded "All changes synced" about an epic no cloud
   * has ever seen. That is the normal settled free-tier session, not a corner
   * case. This says the true thing instead of the reassuring one.
   */
  | "storedLocally"
  /**
   * This session has NO local WAL, and the cloud link is not currently
   * carrying the work either.
   *
   * The one pill state that reports a risk rather than a stage. An unarmed
   * session used to render identically to a protected one, and while
   * disconnected it is strictly less durable than pre-WAL builds: edits live
   * in the doc alone and die on crash AND on graceful quit. Never shown while
   * the cloud is connected - there the work IS reaching somewhere, and the
   * durability badge carries the protection warning instead.
   */
  | "unprotected"
  /** GUI↔host is open, but cloud or host-durability state is still unknown. */
  | "connected"
  /** GUI↔host link coming up for the first time on this subscription. */
  | "connecting"
  /** GUI↔host link re-establishing after a prior successful connect. */
  | "reconnecting"
  /** GUI↔host link closed. */
  | "offline";

/**
 * The host's current cloud-durability knowledge for the root doc and every
 * artifact room. `unknown` is deliberately distinct from `clean`: a new GUI
 * connected to an older host, or a new subscription before its atomic
 * `dirtySnapshot`, has not established that no durable work exists.
 */
export type EpicHostDirtyState = "unknown" | "clean" | "dirty";

/**
 * The five independent legs the pill must weigh, plus the bootstrap qualifier
 * that decides "Connecting…" vs "Reconnecting…" copy.
 *
 * Deliberately NOT `OpenEpicState["connectionStatus"]`: that field is a lossy
 * *display* blend of {@link hostTransportStatus} and {@link cloudSyncStatus}
 * (see `deriveConnectionStatus` in the open-epic store), and collapsing the
 * two legs is exactly what makes it useless here - "host unreachable" and
 * "host reachable, cloud down" both read `reconnecting`, yet only the second
 * one may claim the work is saved anywhere.
 */
export interface EpicSyncPillInputs {
  /**
   * Input 1 - the renderer↔host stream. Raw, not the display blend. When this
   * is anything but `open`, unsent local edits sit in the renderer's in-memory
   * queue and nothing durable holds them.
   */
  readonly hostTransportStatus: StreamConnectionStatus;
  /**
   * Input 2 - the host↔cloud link for this Epic, as the host observes it.
   */
  readonly cloudSyncStatus: EpicCloudSyncStatus;
  /**
   * Input 3 - `true` only after a genuine `cloudSyncStatus` frame in this
   * stream cycle. A display default is never proof that the cloud is connected.
   */
  readonly hasFreshCloudSyncStatus: boolean;
  /**
   * Input 4 - cloud-durability state from `epic.subscribe@1.1`'s atomic
   * `dirtySnapshot` and its subsequent `rootDirty` / `artifactRoomDirty`
   * deltas. Old hosts and a new cycle before that snapshot both remain
   * `unknown`; neither may be treated as clean.
   */
  readonly hostDirtyState: EpicHostDirtyState;
  /**
   * Input 5 - the renderer's own replicas (root doc + artifact-room replicas)
   * diverging from what the host has confirmed. Subsumes the store's
   * `hasDirtyArtifactRoomReplicas()`, which is folded into `isDirty` by
   * `resolvePublicDirtyState`.
   */
  readonly hasUnsyncedLocalChanges: boolean;
  /**
   * Presentation qualifier on input 1, not a sixth leg: latched by the first
   * genuine cloud `connected` frame so a first-time bootstrap reads
   * "Connecting…" while a drop after a real connect reads "Reconnecting…".
   */
  readonly hasConnectedOnce: boolean;
  /**
   * Input 7 - where the host says the epic is durable (`epic.subscribe@1.4`).
   *
   * `undefined` is NOT "fine". At `@1.4` an absent key means unknown, and the
   * pill's calm claim has to be licensed by a positive statement - see
   * {@link syncedClaimIsHonest}.
   */
  readonly durability: EpicDurabilityStatusV14 | undefined;
  /**
   * Input 8 - whether this session has local WAL protection (`@1.4`).
   *
   * Doubles as the MINOR PROBE, deliberately and by construction: a `@1.4`
   * host emits this key on every `cloudSyncStatus` frame unconditionally, so
   * `undefined` identifies a peer on an older minor that cannot express any of
   * this. Such a peer keeps exactly its current rendering rather than being
   * degraded to unknown, which is what makes the whole minor additive.
   */
  readonly localProtection: EpicLocalProtection | undefined;
}

/**
 * Single source of the sync pill's claim.
 *
 * The ordering below is the honesty contract, and every ambiguous case
 * resolves toward no durability assertion:
 *
 * 1. GUI↔host link down wins over everything. We cannot see the host's cloud
 *    state, and any local edit is renderer-memory-only.
 * 2. Renderer-only work is `syncing`, never "saved locally". An `open`
 *    WebSocket proves neither that the host received the frame nor that it
 *    persisted it.
 * 3. An unknown cloud status or host-durability snapshot yields neutral
 *    `connected`, never `synced`.
 * 4. Link up + cloud up: `synced` requires a clean host snapshot and no local
 *    divergence. Host-reported pending work stays quiet as `hostPending`; the
 *    aggregate dirty bit does not prove whether the newest bytes are durable.
 * 5. Link up + cloud down: only known host-durable work with no renderer-only
 *    divergence may read "saved locally". With nothing outstanding the pill
 *    falls back to reporting the link.
 */
export function deriveEpicSyncPillState(
  inputs: EpicSyncPillInputs,
): EpicSyncPillState {
  if (inputs.hostTransportStatus === "closed") return "offline";
  if (inputs.hostTransportStatus !== "open") {
    return linkComingUpState(inputs.hasConnectedOnce);
  }
  if (inputs.hasUnsyncedLocalChanges) {
    if (
      inputs.hasFreshCloudSyncStatus &&
      inputs.cloudSyncStatus !== "connected"
    ) {
      return "offlineWithUnsavedChanges";
    }
    return "syncing";
  }
  if (!inputs.hasFreshCloudSyncStatus || inputs.hostDirtyState === "unknown") {
    return "connected";
  }
  if (inputs.cloudSyncStatus === "connected") {
    if (inputs.hostDirtyState === "dirty") return "hostPending";
    if (syncedClaimIsHonest(inputs)) return "synced";
    // Not synced anywhere in the cloud. Say which, when the host said which,
    // and otherwise claim nothing - `connected` is the neutral state that
    // exists for exactly this.
    return inputs.durability === "local" || inputs.durability === "promoting"
      ? "storedLocally"
      : "connected";
  }
  // Cloud down. The pill may not imply the work is being kept anywhere unless
  // something is keeping it - and an unarmed session is keeping it nowhere.
  if (inputs.localProtection === "unavailable") return "unprotected";
  return inputs.hostDirtyState === "dirty"
    ? "offlineWithHostPending"
    : linkComingUpState(inputs.hasConnectedOnce);
}

/**
 * Whether "All changes synced" is a true statement right now.
 *
 * `synced` is a CLOUD durability claim, and the pill used to make it off the
 * connection alone - which a `LocalRoomConnection` satisfies. So the settled
 * free-tier session rendered "All changes synced" inches from the durability
 * badge's "Stored locally", about an epic that has never been uploaded.
 *
 * The rule, stated once here rather than at each caller: a calm claim needs a
 * POSITIVE statement behind it, never an absence.
 *
 * - No `localProtection` at all means a pre-`@1.4` peer, which cannot express
 *   any of this. It keeps its exact current behaviour; degrading it to unknown
 *   would make this minor a breaking change for every older host.
 * - An absent `durability` from a `@1.4` peer means "no local-durability claim
 *   to make", i.e. the epic is durable in the cloud - the one state the frozen
 *   enum has no member for. Calm is licensed there, but only alongside the
 *   positive `armed`, so silence alone never buys reassurance.
 * - Any STATED durability value says the epic is not simply sitting durable in
 *   the cloud, `unknown` included.
 */
function syncedClaimIsHonest(inputs: EpicSyncPillInputs): boolean {
  if (inputs.localProtection === undefined) return true;
  if (inputs.durability === undefined)
    return inputs.localProtection === "armed";
  return false;
}

function linkComingUpState(
  hasConnectedOnce: boolean,
): Extract<EpicSyncPillState, "connecting" | "reconnecting"> {
  return hasConnectedOnce ? "reconnecting" : "connecting";
}
