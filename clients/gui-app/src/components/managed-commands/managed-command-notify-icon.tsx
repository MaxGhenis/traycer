import { CirclePlay, Radar } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one glyph per shell, used by every managed-command surface so a shell
 * that is watching for you looks the same wherever it appears.
 *
 * `Radar` while the shell notifies - something sweeping, telling the agent what
 * it sees - and `CirclePlay` while it does not - a run nobody is being told
 * about. Deliberately NOT lucide's `Monitor`, which is a display and reads as
 * "screen", and deliberately not a terminal glyph, which would collide with the
 * Terminals surface next door.
 *
 * The flag is live-tunable, so the glyph swaps under a row that stays put. That
 * is the point: the swap is what depicts "this stopped being a watcher".
 *
 * The icon SUPPLEMENTS text and never replaces it: it is `aria-hidden` because
 * the row always says "Shell" in words, and it stays neutral-toned because
 * colour on this surface means status and nothing else.
 */
export function ManagedCommandNotifyIcon(props: {
  readonly notifying: boolean;
  readonly className: string | undefined;
}) {
  const Glyph = props.notifying ? Radar : CirclePlay;
  return (
    <Glyph
      aria-hidden
      data-notify-icon={props.notifying ? "on" : "off"}
      className={cn(
        "size-3 shrink-0 text-muted-foreground/70",
        props.className,
      )}
    />
  );
}
