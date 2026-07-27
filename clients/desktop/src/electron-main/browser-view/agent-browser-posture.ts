import { describeLogError, log } from "../app/logger";

export interface AgentBrowserPostureDebugger {
  isAttached(): boolean;
  attach(protocolVersion: string): void;
  sendCommand(
    method: string,
    commandParams: Record<string, unknown>,
  ): Promise<unknown>;
}

export interface AgentBrowserPostureWebContents {
  readonly debugger: AgentBrowserPostureDebugger;
  isDestroyed(): boolean;
  on(event: "did-navigate", listener: () => void): void;
}

/**
 * Background-work posture for the agent's own browser tile (ticket 02).
 *
 * The tile is created without stealing foreground - nothing here calls
 * `.focus()`, `.show()`, or otherwise activates the parent window. Instead,
 * every attached page is told (via CDP) that it is "active" so Chromium does
 * not throttle timers/rAF the way it would an ordinary background tab, and
 * that it has emulated focus so focus-dependent script behavior (e.g. text
 * selection, some event listeners) still works while a human is looking at a
 * different tile. This has to be re-applied after every main-frame
 * navigation: a cross-origin navigation can hand the page to a fresh
 * renderer process, which resets both properties.
 */
export function applyAgentBrowserBackgroundPosture(
  webContents: AgentBrowserPostureWebContents,
): void {
  sendPostureCommands(webContents);
  webContents.on("did-navigate", () => {
    sendPostureCommands(webContents);
  });
}

function sendPostureCommands(
  webContents: AgentBrowserPostureWebContents,
): void {
  if (webContents.isDestroyed()) return;
  const browserDebugger = webContents.debugger;
  try {
    if (!browserDebugger.isAttached()) {
      browserDebugger.attach("1.3");
    }
  } catch (err) {
    log.warn("[agent-browser-view] debugger attach failed", {
      error: describeLogError(err),
    });
    return;
  }

  Promise.all([
    browserDebugger.sendCommand("Page.setWebLifecycleState", {
      state: "active",
    }),
    browserDebugger.sendCommand("Emulation.setFocusEmulationEnabled", {
      enabled: true,
    }),
  ]).catch((err: unknown) => {
    log.warn("[agent-browser-view] background posture command failed", {
      error: describeLogError(err),
    });
  });
}
