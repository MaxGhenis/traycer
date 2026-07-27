import { describe, expect, it } from "vitest";
import { hostStreamRpcRegistry } from "@traycer/protocol/host/index";
import { releasedStreamMethodNames } from "./__fixtures__/released-stream-method-names";

/**
 * Stream method-name guard for the `/stream` surface.
 *
 * Unlike unary `/rpc`, a new stream method name is scoped to the subscribed
 * method rather than fatal to the full connection. The GUI still feature-detects
 * browser support by method presence in the host's openAck manifest, so the
 * published stream method-name set is worth freezing. Future browser work should
 * evolve `browser.sessions` / `browser.screencast` additively inside major 1,
 * not by accidentally adding a parallel stream name.
 */
describe("released stream method-name set is frozen", () => {
  it("advertises exactly the baselined stream method names", () => {
    const current = Object.keys(hostStreamRpcRegistry).sort();
    expect(current).toEqual([...releasedStreamMethodNames].sort());
  });
});
