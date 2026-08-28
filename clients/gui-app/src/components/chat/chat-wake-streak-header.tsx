import { ChevronRight } from "lucide-react";
import { useCallback, useMemo } from "react";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { deriveWakeStreakCollapsibleKey } from "@/components/chat/chat-collapsible-key";
import type {
  WakeStreakModel,
  WakeStreakSource,
} from "@/components/chat/chat-wake-streaks";
import { cn, formatSingleLine } from "@/lib/utils";
import {
  useChatCollapsibleTileInstanceId,
  useSetChatFindForcedOpen,
} from "@/stores/chats/chat-find-force-store-context";
import { useChatOpenStoreScope } from "@/stores/chats/open-store-scope";
import {
  useWakeStreakOpenStore,
  useWakeStreakSectionOpen,
} from "@/stores/chats/wake-streak-open-store";

/** Header names at most this many sources; the rest live in the tooltip. */
const SOURCE_NAME_CAP = 2;
const SOURCE_NAME_MAX_LENGTH = 28;

/**
 * The one-line fold header a run of wake acknowledgments collapses behind
 * (`chat-wake-streaks.ts`). Dashed border on purpose: every solid-bordered
 * surface in the transcript is one thing, and this row is a span of many -
 * the dash is the seam line. Copy stays factual: count, sources, time range.
 * "N earlier updates" while the streak is the live tail (its newest
 * acknowledgment is still visible below), "N updates" once a work turn closed
 * it and everything folded.
 */
export function WakeStreakHeader(props: { readonly streak: WakeStreakModel }) {
  const { streak } = props;
  const scope = useChatOpenStoreScope();
  const tileInstanceId = useChatCollapsibleTileInstanceId();
  const collapsibleKey = useMemo(
    () => deriveWakeStreakCollapsibleKey(tileInstanceId, streak.id),
    [streak.id, tileInstanceId],
  );
  const open = useWakeStreakSectionOpen(streak.id);
  const setOpen = useWakeStreakOpenStore((state) => state.setOpen);
  const setFindForcedOpen = useSetChatFindForcedOpen();
  const toggle = useCallback(() => {
    const next = !open;
    setOpen(scope, streak.id, next);
    // Closing by hand also releases find's force-open, else the section
    // snaps back open on the next find reconcile.
    if (!next) setFindForcedOpen(collapsibleKey, false);
  }, [collapsibleKey, open, scope, setFindForcedOpen, setOpen, streak.id]);

  const count = streak.memberRowIds.length;
  const updatesNoun = count === 1 ? "update" : "updates";
  const countLabel = streak.liveTail
    ? `${count} earlier ${updatesNoun}`
    : `${count} ${updatesNoun}`;
  const shownSources = streak.sources.slice(0, SOURCE_NAME_CAP);
  const hiddenSourceCount = streak.sources.length - shownSources.length;
  const sourcesLabel = shownSources
    .map((source) =>
      formatSingleLine(source.title, {
        maxLength: SOURCE_NAME_MAX_LENGTH,
        ellipsis: "…",
      }),
    )
    .join(", ");

  const sources = (
    <span className="min-w-0 truncate">
      {sourcesLabel}
      {hiddenSourceCount > 0 ? (
        <span className="text-muted-foreground/70">{` +${hiddenSourceCount} more`}</span>
      ) : null}
    </span>
  );

  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      data-testid="wake-streak-header"
      className="flex w-full max-w-[min(100%,48rem)] items-center gap-1.5 rounded-md border border-dashed border-border/60 px-2.5 py-1.5 text-ui-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ChevronRight
        aria-hidden
        className={cn(
          "size-3.5 shrink-0 transition-transform",
          open && "rotate-90",
        )}
      />
      <span className="shrink-0 font-medium">{countLabel}</span>
      <span aria-hidden className="shrink-0 text-muted-foreground/40">
        ·
      </span>
      {streak.sources.length > 1 ? (
        <TooltipWrapper
          label={<WakeStreakSourcesTooltip sources={streak.sources} />}
          side="top"
          align="start"
          sideOffset={6}
        >
          {sources}
        </TooltipWrapper>
      ) : (
        sources
      )}
      <span aria-hidden className="shrink-0 text-muted-foreground/40">
        ·
      </span>
      <span className="shrink-0 tabular-nums">
        {formatWakeStreakSpan(streak.startedAt, streak.endedAt)}
      </span>
    </button>
  );
}

function WakeStreakSourcesTooltip(props: {
  readonly sources: ReadonlyArray<WakeStreakSource>;
}) {
  return (
    <div className="flex max-w-xs flex-col gap-0.5">
      {props.sources.map((source) => (
        <span key={source.title} className="truncate">
          {source.title}
          <span className="text-muted-foreground">
            {` · ${source.updateCount} ${source.updateCount === 1 ? "update" : "updates"}`}
          </span>
        </span>
      ))}
    </div>
  );
}

/** "6:40–6:58 PM", collapsing to one time when the span rounds to a minute. */
function formatWakeStreakSpan(startedAt: number, endedAt: number): string {
  const start = clockTime(startedAt);
  const end = clockTime(endedAt);
  return start === end ? start : `${start}–${end}`;
}

function clockTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
