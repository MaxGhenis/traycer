import { describe, expect, it } from "vitest";
import {
  createScreencastArmBuffer,
  SCREENCAST_ARM_BUFFER_CLICK_SLOP_PX,
  SCREENCAST_ARM_BUFFER_TIMEOUT_MS,
  type ScreencastArmBuffer,
  type ScreencastArmBufferClock,
  type ScreencastArmGestureDown,
  type ScreencastArmGestureUp,
} from "@/components/epic-canvas/renderers/screencast-arm-buffer";

interface ScheduledTimeout {
  readonly id: number;
  readonly callback: () => void;
  readonly fireAt: number;
}

interface FakeClockController {
  readonly clock: ScreencastArmBufferClock;
  readonly advance: (ms: number) => void;
  readonly scheduledCount: () => number;
  readonly lastDelayMs: () => number | null;
}

function createFakeClock(): FakeClockController {
  let now = 0;
  let nextId = 1;
  let lastDelayMs: number | null = null;
  const scheduled: ScheduledTimeout[] = [];

  return {
    clock: {
      setTimeout: (callback, ms) => {
        lastDelayMs = ms;
        const id = nextId;
        nextId += 1;
        scheduled.push({ id, callback, fireAt: now + ms });
        return id;
      },
      clearTimeout: (id) => {
        const index = scheduled.findIndex((item) => item.id === id);
        if (index >= 0) scheduled.splice(index, 1);
      },
    },
    advance: (ms) => {
      now += ms;
      const due = scheduled.filter((item) => item.fireAt <= now);
      for (const item of due) {
        const index = scheduled.indexOf(item);
        if (index >= 0) scheduled.splice(index, 1);
        item.callback();
      }
    },
    scheduledCount: () => scheduled.length,
    lastDelayMs: () => lastDelayMs,
  };
}

function downAt(
  payload: string,
  castSequence: number,
  clientX: number,
  clientY: number,
): ScreencastArmGestureDown<string> {
  return { payload, castSequence, clientX, clientY, isPrimary: true };
}

function upAt(
  payload: string,
  isPrimary: boolean,
  clientX: number,
  clientY: number,
): ScreencastArmGestureUp<string> {
  return { payload, isPrimary, clientX, clientY };
}

function createBuffer(
  clock: ScreencastArmBufferClock,
): ScreencastArmBuffer<string> {
  return createScreencastArmBuffer(clock);
}

describe("createScreencastArmBuffer", () => {
  it("stores a down and matching primary nearby up and delivers both when current", () => {
    const { clock, lastDelayMs } = createFakeClock();
    const buffer = createBuffer(clock);

    buffer.storeDown(downAt("down", 7, 10, 20));
    expect(lastDelayMs()).toBe(SCREENCAST_ARM_BUFFER_TIMEOUT_MS);
    expect(buffer.hasPending()).toBe(true);

    buffer.storeMatchingUp(upAt("up", true, 12, 21));
    expect(buffer.takeIfCurrent(7)).toEqual({ down: "down", up: "up" });
    expect(buffer.hasPending()).toBe(false);
    expect(buffer.takeIfCurrent(7)).toBeNull();
  });

  it("drops when presentedSequence does not match the buffered castSequence", () => {
    const { clock } = createFakeClock();
    const buffer = createBuffer(clock);

    buffer.storeDown(downAt("down", 7, 10, 20));
    buffer.storeMatchingUp(upAt("up", true, 10, 20));
    expect(buffer.takeIfCurrent(8)).toBeNull();
    expect(buffer.hasPending()).toBe(false);
  });

  it("drops when presentedSequence is null", () => {
    const { clock } = createFakeClock();
    const buffer = createBuffer(clock);

    buffer.storeDown(downAt("down", 7, 10, 20));
    expect(buffer.takeIfCurrent(null)).toBeNull();
    expect(buffer.hasPending()).toBe(false);
  });

  it("does not deliver a down without a matching nearby up", () => {
    const { clock } = createFakeClock();
    const buffer = createBuffer(clock);

    buffer.storeDown(downAt("down", 7, 10, 20));
    expect(buffer.takeIfCurrent(7)).toBeNull();
    expect(buffer.hasPending()).toBe(false);
  });

  it("ignores a non-primary storeDown", () => {
    const { clock } = createFakeClock();
    const buffer = createBuffer(clock);
    const down = downAt("down", 7, 10, 20);

    buffer.storeDown({ ...down, isPrimary: false });
    expect(buffer.hasPending()).toBe(false);
    expect(buffer.takeIfCurrent(7)).toBeNull();
  });

  it("drops on noteMove past the click slop", () => {
    const { clock } = createFakeClock();
    const buffer = createBuffer(clock);

    buffer.storeDown(downAt("down", 7, 10, 20));
    buffer.noteMove(10 + SCREENCAST_ARM_BUFFER_CLICK_SLOP_PX + 1, 20);
    expect(buffer.hasPending()).toBe(false);
    expect(buffer.takeIfCurrent(7)).toBeNull();
  });

  it("keeps the pending gesture when noteMove stays within slop", () => {
    const { clock } = createFakeClock();
    const buffer = createBuffer(clock);

    buffer.storeDown(downAt("down", 7, 10, 20));
    buffer.noteMove(10 + SCREENCAST_ARM_BUFFER_CLICK_SLOP_PX, 20);
    buffer.noteMove(10, 20 + SCREENCAST_ARM_BUFFER_CLICK_SLOP_PX);
    expect(buffer.hasPending()).toBe(true);
    buffer.storeMatchingUp(upAt("up", true, 10, 20));
    expect(buffer.takeIfCurrent(7)).toEqual({ down: "down", up: "up" });
  });

  it("drops a non-primary up as arm-only instead of delivering a partial gesture", () => {
    const { clock } = createFakeClock();
    const buffer = createBuffer(clock);

    buffer.storeDown(downAt("down", 7, 10, 20));
    buffer.storeMatchingUp(upAt("right-up", false, 10, 20));
    expect(buffer.hasPending()).toBe(false);
    expect(buffer.takeIfCurrent(7)).toBeNull();
  });

  it("drops a far up as arm-only instead of delivering a partial gesture", () => {
    const { clock } = createFakeClock();
    const buffer = createBuffer(clock);

    buffer.storeDown(downAt("down", 7, 10, 20));
    buffer.storeMatchingUp(
      upAt("far-up", true, 10 + SCREENCAST_ARM_BUFFER_CLICK_SLOP_PX + 1, 20),
    );
    expect(buffer.hasPending()).toBe(false);
    expect(buffer.takeIfCurrent(7)).toBeNull();
  });

  it("ignores a second storeDown so there is no queue", () => {
    const { clock } = createFakeClock();
    const buffer = createBuffer(clock);

    buffer.storeDown(downAt("first", 7, 10, 20));
    buffer.storeDown(downAt("second", 8, 40, 50));
    buffer.storeMatchingUp(upAt("up", true, 10, 20));
    expect(buffer.takeIfCurrent(7)).toEqual({ down: "first", up: "up" });
  });

  it("times out at SCREENCAST_ARM_BUFFER_TIMEOUT_MS", () => {
    const { clock, advance, scheduledCount } = createFakeClock();
    const buffer = createBuffer(clock);

    buffer.storeDown(downAt("down", 7, 10, 20));
    advance(SCREENCAST_ARM_BUFFER_TIMEOUT_MS - 1);
    expect(buffer.hasPending()).toBe(true);
    expect(scheduledCount()).toBe(1);

    advance(1);
    expect(buffer.hasPending()).toBe(false);
    expect(scheduledCount()).toBe(0);
    expect(buffer.takeIfCurrent(7)).toBeNull();
  });

  it("drop clears the timeout and the pending gesture", () => {
    const { clock, advance, scheduledCount } = createFakeClock();
    const buffer = createBuffer(clock);

    buffer.storeDown(downAt("first", 7, 10, 20));
    buffer.drop();
    expect(buffer.hasPending()).toBe(false);
    expect(scheduledCount()).toBe(0);
    expect(buffer.takeIfCurrent(7)).toBeNull();

    buffer.storeDown(downAt("second", 9, 30, 40));
    advance(SCREENCAST_ARM_BUFFER_TIMEOUT_MS - 1);
    buffer.storeMatchingUp(upAt("up", true, 30, 40));
    expect(buffer.takeIfCurrent(9)).toEqual({ down: "second", up: "up" });
  });
});
