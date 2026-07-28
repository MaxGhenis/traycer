import { useSyncExternalStore } from "react";
import type { BrowserSessionsClientFrame } from "@traycer/protocol/host/browser/contracts";

/**
 * Ticket 09: which visible browser tiles the agent is currently borrowing.
 *
 * A *borrowed* tile is one the user already had open - a real
 * `persist:traycer-browser` tab with their logins in it - which they asked
 * the agent in chat to drive. The chat request is the consent (v3), so
 * unlike `browser-tile-control-store.ts` (T18's ask-then-grant flow, kept
 * intact alongside this) there is nothing here to approve or deny: an
 * attachment arrives already granted and this store's job is to make it
 * **visible** and **endable**.
 *
 * Two things hang off an entry here, and both are the point of the ticket:
 *
 * 1. `BrowserTile` registers that tile's CDP handler **only while an
 *    attachment is live**, so a tile the user never named cannot be reached
 *    even though the transport that would reach it now exists in this
 *    renderer.
 * 2. The passive indicator renders from it - our deliberate divergence from
 *    Aside, which marks borrowed tabs not at all - carrying the detach
 *    affordance.
 *
 * The local expiry timer is not a duplicate of the host's. The host refuses
 * expired dispatches on its own clock and does not depend on this; this one
 * exists so the indicator stops claiming the agent is attached the instant
 * it stops being true, without waiting for a push to arrive. An indicator
 * that outlives its attachment is a lie in the safer direction, but it is
 * still a lie, and this is the surface the user reads to decide whether to
 * intervene.
 */
export type BrowserBorrowedTileAttachment = {
  readonly attachmentId: string;
  readonly tileInstanceId: string;
  readonly chatId: string;
  readonly agentRunId: string | null;
  readonly agentLabel: string;
  readonly attachedAt: number;
  readonly expiresAt: number;
  readonly sendFrame: (frame: BrowserSessionsClientFrame) => void;
};

const listeners = new Set<() => void>();
const attachmentByTileInstanceId = new Map<
  string,
  BrowserBorrowedTileAttachment
>();
// `window.setTimeout` rather than the bare global, so the handle is a plain
// `number` - the repo's type rules forbid `ReturnType<typeof setTimeout>`, and
// this is the renderer, where the DOM timer is the right one anyway. Same
// idiom as `terminal-focus-registry.ts`.
const expiryTimerByTileInstanceId = new Map<string, number>();

export function publishBorrowedTileAttachment(
  attachment: BrowserBorrowedTileAttachment,
): void {
  const remainingMs = attachment.expiresAt - Date.now();
  if (remainingMs <= 0) {
    // Already expired on arrival - a delayed frame, or a clock that moved.
    // It is not shown, because an attachment past its expiry is one the host
    // will refuse anyway and an indicator for it would claim the agent has
    // access it does not have.
    //
    // It also may not disturb anything else. Matching on `attachmentId`
    // before ending anything is the same discipline `clearBorrowedTileAttachment`
    // and `releaseBorrowedTileAttachment` follow, and this path needs it for
    // the same reason: a stale attach frame naming an OLD attachment must not
    // take down the live one that replaced it. Without the match this ends up
    // deleting whatever entry is there, leaving the renderer refusing
    // dispatches for an attachment the host still considers live - failing
    // safe, but silently and wrongly.
    const current = attachmentByTileInstanceId.get(attachment.tileInstanceId);
    if (current?.attachmentId !== attachment.attachmentId) return;
    clearExpiryTimer(attachment.tileInstanceId);
    attachmentByTileInstanceId.delete(attachment.tileInstanceId);
    emit();
    return;
  }
  clearExpiryTimer(attachment.tileInstanceId);
  attachmentByTileInstanceId.set(attachment.tileInstanceId, attachment);
  const timer = window.setTimeout(() => {
    expiryTimerByTileInstanceId.delete(attachment.tileInstanceId);
    const current = attachmentByTileInstanceId.get(attachment.tileInstanceId);
    if (current?.attachmentId !== attachment.attachmentId) return;
    attachmentByTileInstanceId.delete(attachment.tileInstanceId);
    emit();
  }, remainingMs);
  expiryTimerByTileInstanceId.set(attachment.tileInstanceId, timer);
  emit();
}

/**
 * Ends an attachment locally, matched on `attachmentId` so a stale end
 * cannot take down a newer attachment for the same tile. Used for the host's
 * own `borrowedTileDetached` push.
 */
export function clearBorrowedTileAttachment(input: {
  readonly tileInstanceId: string;
  readonly attachmentId: string;
}): void {
  const current = attachmentByTileInstanceId.get(input.tileInstanceId);
  if (current?.attachmentId !== input.attachmentId) return;
  clearExpiryTimer(input.tileInstanceId);
  attachmentByTileInstanceId.delete(input.tileInstanceId);
  emit();
}

/**
 * Ends an attachment from this side - the user pressed detach, or the tile's
 * debugger detached out from under it.
 *
 * Order is deliberate and load-bearing: the local record goes away **first**,
 * so `BrowserTile` has already unregistered its CDP handler by the time the
 * frame leaves, and then the host is told. Doing it the other way round
 * leaves a window where the user believes the tile is released, the renderer
 * still answers dispatches, and a queued command lands on it. `sendFrame`
 * throwing or the frame never arriving cannot reopen that window - the host
 * refuses on its own clock too, and this renderer has already stopped
 * answering.
 */
export function releaseBorrowedTileAttachment(input: {
  readonly attachment: BrowserBorrowedTileAttachment;
  readonly reason: string;
}): void {
  const current = attachmentByTileInstanceId.get(
    input.attachment.tileInstanceId,
  );
  if (current?.attachmentId !== input.attachment.attachmentId) return;
  clearExpiryTimer(input.attachment.tileInstanceId);
  attachmentByTileInstanceId.delete(input.attachment.tileInstanceId);
  emit();
  notifyHost(input.attachment, input.reason);
}

/**
 * Tells the host the attachment is over. Called only after the local record
 * is already gone, so a send that throws, is dropped, or never arrives cannot
 * leave this renderer answering dispatches for a tile the user released - and
 * the host refuses on its own clock regardless. This is how the host learns,
 * not how the release takes effect.
 */
function notifyHost(
  attachment: BrowserBorrowedTileAttachment,
  reason: string,
): void {
  attachment.sendFrame({
    kind: "borrowedTileReleased",
    hasBinaryPayload: false,
    requestId: crypto.randomUUID(),
    tileInstanceId: attachment.tileInstanceId,
    attachmentId: attachment.attachmentId,
    reason,
  });
}

export function useBorrowedTileAttachment(
  tileInstanceId: string,
): BrowserBorrowedTileAttachment | null {
  return useSyncExternalStore(
    subscribe,
    () => attachmentByTileInstanceId.get(tileInstanceId) ?? null,
    () => attachmentByTileInstanceId.get(tileInstanceId) ?? null,
  );
}

export function readBorrowedTileAttachmentForTests(
  tileInstanceId: string,
): BrowserBorrowedTileAttachment | null {
  return attachmentByTileInstanceId.get(tileInstanceId) ?? null;
}

export function resetBorrowedTileStoreForTests(): void {
  for (const timer of expiryTimerByTileInstanceId.values()) {
    window.clearTimeout(timer);
  }
  expiryTimerByTileInstanceId.clear();
  attachmentByTileInstanceId.clear();
  emit();
}

function clearExpiryTimer(tileInstanceId: string): void {
  const timer = expiryTimerByTileInstanceId.get(tileInstanceId);
  if (timer === undefined) return;
  window.clearTimeout(timer);
  expiryTimerByTileInstanceId.delete(tileInstanceId);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  for (const listener of listeners) listener();
}
