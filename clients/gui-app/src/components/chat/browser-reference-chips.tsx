import { Globe2 } from "lucide-react";
import { useMemo } from "react";
import type { BrowserContextAttachmentRecord } from "@traycer/protocol/persistence/epic/schemas";
import type { BrowserTabInfo } from "@traycer/protocol/host/browser/contracts";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { useBrowserSessionsContext } from "@/components/epic-canvas/renderers/browser-sessions-context";
import {
  browserTabFaviconUrl,
  resolveTabTitle,
} from "@/lib/browser-view/browser-tab-display";

export function BrowserReferenceChips(props: {
  readonly references: ReadonlyArray<BrowserContextAttachmentRecord>;
}) {
  // Every other message renders this unconditionally with an empty array, so
  // the common case must not require BrowserSessionsProvider to be mounted -
  // only messages that actually reference a browser tab need the live lookup.
  if (props.references.length === 0) return null;
  return <BrowserReferenceChipsLive references={props.references} />;
}

function BrowserReferenceChipsLive(props: {
  readonly references: ReadonlyArray<BrowserContextAttachmentRecord>;
}) {
  const sessions = useBrowserSessionsContext();
  const tabByReferenceKey = useMemo(() => {
    const map = new Map<string, BrowserTabInfo>();
    sessions.items.forEach((session) => {
      session.tabs.forEach((tab) => {
        map.set(`${session.sessionId}:${tab.tabId}`, tab);
      });
    });
    return map;
  }, [sessions.items]);

  return (
    <div className="mb-2 flex max-w-full flex-wrap justify-start gap-1.5">
      {props.references.map((reference) => {
        const tab = tabByReferenceKey.get(
          `${reference.sessionId}:${reference.tabId}`,
        );
        const title = tab === undefined ? "Browser" : resolveTabTitle(tab);
        const favicon = tab === undefined ? null : browserTabFaviconUrl(tab.url);
        return (
          <TooltipWrapper
            key={`${reference.kind}:${reference.sessionId}:${reference.tabId}`}
            label={`Browser session ${reference.sessionId}, tab ${reference.tabId}`}
            side="top"
            sideOffset={undefined}
            align={undefined}
          >
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-background/70 px-2 py-1 text-ui-xs text-muted-foreground">
              {favicon === null ? (
                <Globe2 className="size-3.5 shrink-0" aria-hidden />
              ) : (
                <img
                  src={favicon}
                  alt=""
                  className="size-3.5 shrink-0 rounded-sm"
                  onError={(event) => {
                    event.currentTarget.style.visibility = "hidden";
                  }}
                />
              )}
              <span className="truncate">{title}</span>
            </span>
          </TooltipWrapper>
        );
      })}
    </div>
  );
}
