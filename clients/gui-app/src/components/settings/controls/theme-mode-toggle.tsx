import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ThemeMode } from "@/stores/settings/settings-store";

interface ThemeModeToggleProps {
  value: ThemeMode;
  onChange: (next: ThemeMode) => void;
}

const MODES: ReadonlyArray<{
  id: ThemeMode;
  label: string;
  icon: typeof Sun;
}> = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

export function ThemeModeToggle(props: ThemeModeToggleProps) {
  const { value, onChange } = props;
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-border bg-foreground/3 p-0.5">
      {MODES.map((mode) => {
        const Icon = mode.icon;
        const active = mode.id === value;
        return (
          <button
            key={mode.id}
            type="button"
            // Settings' hit-area slop selects on the slot attribute, not on the
            // element, so a hand-rolled segment needs it to be reached. The
            // slop is vertical-only and these three segments are flush
            // horizontally, so none of them captures its neighbour's taps.
            data-slot="button"
            onClick={() => {
              onChange(mode.id);
            }}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-3 py-1 text-ui-sm transition-colors",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
