import { describe, expect, it } from "vitest";
import {
  OPTIONAL_AGENT_BROWSER_VIEW_BRIDGE_METHODS,
  REQUIRED_AGENT_BROWSER_VIEW_BRIDGE_METHODS,
  probeAgentBrowserViewOptionalSurface,
  resolveDesktopAgentBrowserViewBridge,
} from "@/lib/browser-view/desktop-agent-browser-view";

function noopBridgeMethod(): undefined {
  return undefined;
}

function requiredOnlyAgentView(): Record<string, unknown> {
  const view: Record<string, unknown> = {};
  for (const methodName of REQUIRED_AGENT_BROWSER_VIEW_BRIDGE_METHODS) {
    view[methodName] = noopBridgeMethod;
  }
  return view;
}

function agentViewMissingOptional(
  missingMethod: (typeof OPTIONAL_AGENT_BROWSER_VIEW_BRIDGE_METHODS)[number],
): Record<string, unknown> {
  const view = requiredOnlyAgentView();
  for (const methodName of OPTIONAL_AGENT_BROWSER_VIEW_BRIDGE_METHODS) {
    if (methodName === missingMethod) continue;
    view[methodName] = noopBridgeMethod;
  }
  return view;
}

function hostWithAgentView(
  agentBrowserView: Record<string, unknown>,
): object {
  return { agentBrowserView };
}

describe("resolveDesktopAgentBrowserViewBridge older-preload gate", () => {
  it("resolves when every required method is present and one optional chrome method is missing", () => {
    const host = hostWithAgentView(agentViewMissingOptional("reloadTile"));

    expect(resolveDesktopAgentBrowserViewBridge(host)).not.toBeNull();
    expect(probeAgentBrowserViewOptionalSurface(host)).toEqual(
      expect.objectContaining({ reloadTile: false }),
    );
  });

  it("does not return null when every required method is present", () => {
    const host = hostWithAgentView(requiredOnlyAgentView());

    expect(resolveDesktopAgentBrowserViewBridge(host)).not.toBeNull();
    expect(probeAgentBrowserViewOptionalSurface(host)?.reloadTile).toBe(false);
  });
});
