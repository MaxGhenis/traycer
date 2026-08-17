import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getNegotiatedHostMethodVersion,
  getNegotiatedHostMethods,
  recordNegotiatedHostManifest,
  recordNegotiatedHostMethods,
  resetNegotiatedManifests,
  subscribeNegotiatedManifests,
} from "@traycer-clients/shared/host-transport/negotiated-manifest-registry";

/**
 * Direct unit tests for the per-host negotiated-method registry that backs
 * optional-capability gates (including `epic.setChatArchived` / B4).
 *
 * Unknown hosts must fail closed; a recorded manifest must answer; re-recording
 * an identical set must not churn listeners (referential stability).
 */
describe("negotiated-manifest-registry", () => {
  afterEach(() => {
    resetNegotiatedManifests();
  });

  it("reads an unknown host as not-yet-known (null), not false", () => {
    expect(getNegotiatedHostMethods("host-unknown")).toBeNull();
  });

  it("answers from a recorded manifest", () => {
    recordNegotiatedHostMethods("host-1", [
      "epic.listChats",
      "epic.setChatArchived",
    ]);

    const methods = getNegotiatedHostMethods("host-1");
    expect(methods).not.toBeNull();
    if (methods === null) throw new Error("expected recorded methods");
    expect(methods.has("epic.setChatArchived")).toBe(true);
    expect(methods.has("epic.listChats")).toBe(true);
    expect(methods.has("epic.missingMethod")).toBe(false);
  });

  it("does not notify listeners or churn the set when re-recording an identical method set", () => {
    recordNegotiatedHostMethods("host-1", ["a", "b"]);
    const first = getNegotiatedHostMethods("host-1");
    expect(first).not.toBeNull();

    const listener = vi.fn();
    const unsubscribe = subscribeNegotiatedManifests(listener);

    recordNegotiatedHostMethods("host-1", ["b", "a"]);
    expect(listener).not.toHaveBeenCalled();
    // Same Set instance - useSyncExternalStore getSnapshot can stay stable.
    expect(getNegotiatedHostMethods("host-1")).toBe(first);

    unsubscribe();
  });

  it("notifies listeners and replaces the set when the negotiated methods change", () => {
    recordNegotiatedHostMethods("host-1", ["a"]);
    const first = getNegotiatedHostMethods("host-1");

    const listener = vi.fn();
    const unsubscribe = subscribeNegotiatedManifests(listener);

    recordNegotiatedHostMethods("host-1", ["a", "epic.setChatArchived"]);
    expect(listener).toHaveBeenCalledTimes(1);
    const second = getNegotiatedHostMethods("host-1");
    expect(second).not.toBe(first);
    expect(second?.has("epic.setChatArchived")).toBe(true);

    unsubscribe();
  });

  it("records canonical versions and notifies when a version changes without a name change", () => {
    recordNegotiatedHostManifest("host-1", {
      "terminal.plain.list": { major: 1, minor: 0 },
    });
    const first = getNegotiatedHostMethods("host-1");
    const listener = vi.fn();
    const unsubscribe = subscribeNegotiatedManifests(listener);

    expect(
      getNegotiatedHostMethodVersion("host-1", "terminal.plain.list"),
    ).toEqual({ major: 1, minor: 0 });
    recordNegotiatedHostManifest("host-1", {
      "terminal.plain.list": { major: 1, minor: 1 },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getNegotiatedHostMethods("host-1")).not.toBe(first);
    expect(
      getNegotiatedHostMethodVersion("host-1", "terminal.plain.list"),
    ).toEqual({ major: 1, minor: 1 });
    unsubscribe();
  });
});
