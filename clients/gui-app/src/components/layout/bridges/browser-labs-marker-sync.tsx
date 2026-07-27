import { useEffect, useMemo } from "react";
import { resolveDesktopBrowserViewBridge } from "@/lib/browser-view/desktop-browser-view";
import { useRunnerHost } from "@/providers/use-runner-host";
import { useSettingsStore } from "@/stores/settings/settings-store";

export function BrowserLabsMarkerSync() {
  const runnerHost = useRunnerHost();
  const browserView = useMemo(
    () => resolveDesktopBrowserViewBridge(runnerHost),
    [runnerHost],
  );

  useEffect(() => {
    if (browserView === null) return;

    const sync = (inAppBrowserBetaEnabled: boolean): void => {
      void browserView
        .setLabsState({ inAppBrowserBetaEnabled })
        .catch(ignoreBrowserLabsMarkerError);
    };

    sync(useSettingsStore.getState().inAppBrowserBetaEnabled);
    const unsubscribeStore = useSettingsStore.subscribe((state, prevState) => {
      if (state.inAppBrowserBetaEnabled === prevState.inAppBrowserBetaEnabled) {
        return;
      }
      sync(state.inAppBrowserBetaEnabled);
    });
    const unsubscribeHydration = useSettingsStore.persist.onFinishHydration(
      (state) => {
        sync(state.inAppBrowserBetaEnabled);
      },
    );

    return () => {
      unsubscribeStore();
      unsubscribeHydration();
    };
  }, [browserView]);

  return null;
}

function ignoreBrowserLabsMarkerError(_error: unknown): void {}
