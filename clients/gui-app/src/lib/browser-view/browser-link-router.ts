import { use, useCallback } from "react";
import type { IRunnerHost } from "@traycer-clients/shared/platform/runner-host";
import {
  routeBrowserLink,
  type BrowserLinkClickEvent,
  type BrowserLinkKind,
  type BrowserLinkOpenResult,
} from "@/lib/browser-view/browser-link-routing-core";
import { BrowserLinkRoutingContext } from "@/lib/browser-view/browser-link-routing-context";
import { RunnerHostContext } from "@/providers/runner-host-context";

export function useBrowserLinkRouter(): (
  kind: BrowserLinkKind,
  url: string,
  event: BrowserLinkClickEvent | null,
) => BrowserLinkOpenResult {
  return useBrowserLinkRouterForRunnerHost(useRunnerHostForBrowserLinks());
}

export function useBrowserLinkRouterForRunnerHost(
  runnerHost: Pick<IRunnerHost, "openExternalLink">,
): (
  kind: BrowserLinkKind,
  url: string,
  event: BrowserLinkClickEvent | null,
) => BrowserLinkOpenResult {
  const context = use(BrowserLinkRoutingContext);
  return useCallback(
    (kind, url, event) =>
      routeBrowserLink({
        runnerHost,
        source: context?.source ?? null,
        kind,
        url,
        event,
      }),
    [context?.source, runnerHost],
  );
}

function useRunnerHostForBrowserLinks(): Pick<IRunnerHost, "openExternalLink"> {
  const runnerHost = use(RunnerHostContext);
  if (runnerHost !== null) return runnerHost;
  return {
    openExternalLink: () => Promise.resolve(),
  };
}
