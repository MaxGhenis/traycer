export const SCREENCAST_ARM_BUFFER_TIMEOUT_MS = 1_000;
export const SCREENCAST_ARM_BUFFER_CLICK_SLOP_PX = 4;

export interface ScreencastArmBufferClock {
  readonly setTimeout: (callback: () => void, ms: number) => number;
  readonly clearTimeout: (id: number) => void;
}

export interface ScreencastArmGestureDown<T> {
  readonly payload: T;
  readonly castSequence: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary: boolean;
}

export interface ScreencastArmGestureUp<T> {
  readonly payload: T;
  readonly isPrimary: boolean;
  readonly clientX: number;
  readonly clientY: number;
}

export interface ScreencastArmGesture<T> {
  readonly down: T;
  readonly up: T;
}

export interface ScreencastArmBuffer<T> {
  readonly storeDown: (down: ScreencastArmGestureDown<T>) => void;
  readonly storeMatchingUp: (up: ScreencastArmGestureUp<T>) => void;
  readonly noteMove: (clientX: number, clientY: number) => void;
  readonly takeIfCurrent: (
    presentedSequence: number | null,
  ) => ScreencastArmGesture<T> | null;
  readonly drop: () => void;
  readonly hasPending: () => boolean;
  readonly setOnDropped: (onDropped: () => void) => void;
}

interface PendingArmGesture<T> {
  readonly down: ScreencastArmGestureDown<T>;
  up: T | null;
  readonly timeoutId: number;
}

export function createScreencastArmBuffer<T>(
  clock: ScreencastArmBufferClock,
): ScreencastArmBuffer<T> {
  let pending: PendingArmGesture<T> | null = null;
  let onDropped = (): void => {};

  const clearPending = (): void => {
    if (pending === null) return;
    clock.clearTimeout(pending.timeoutId);
    pending = null;
  };

  const drop = (): void => {
    if (pending === null) return;
    clearPending();
    onDropped();
  };

  return {
    storeDown: (down) => {
      if (pending !== null || !down.isPrimary) return;
      pending = {
        down,
        up: null,
        timeoutId: clock.setTimeout(drop, SCREENCAST_ARM_BUFFER_TIMEOUT_MS),
      };
    },
    storeMatchingUp: (up) => {
      if (pending === null) return;
      if (
        !up.isPrimary ||
        !isWithinClickSlop(
          pending.down.clientX,
          pending.down.clientY,
          up.clientX,
          up.clientY,
        )
      ) {
        drop();
        return;
      }
      pending.up = up.payload;
    },
    noteMove: (clientX, clientY) => {
      if (pending === null) return;
      if (
        isWithinClickSlop(
          pending.down.clientX,
          pending.down.clientY,
          clientX,
          clientY,
        )
      ) {
        return;
      }
      drop();
    },
    takeIfCurrent: (presentedSequence) => {
      if (pending === null) return null;
      const gesture = pending;
      if (
        presentedSequence !== gesture.down.castSequence ||
        gesture.up === null
      ) {
        drop();
        return null;
      }
      clearPending();
      return { down: gesture.down.payload, up: gesture.up };
    },
    drop,
    hasPending: () => pending !== null,
    setOnDropped: (nextOnDropped) => {
      onDropped = nextOnDropped;
    },
  };
}

function isWithinClickSlop(
  originX: number,
  originY: number,
  x: number,
  y: number,
): boolean {
  return (
    Math.abs(x - originX) <= SCREENCAST_ARM_BUFFER_CLICK_SLOP_PX &&
    Math.abs(y - originY) <= SCREENCAST_ARM_BUFFER_CLICK_SLOP_PX
  );
}
