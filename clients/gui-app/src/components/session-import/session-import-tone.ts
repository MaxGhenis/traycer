/**
 * The wizard is one component on two very different grounds: the onboarding
 * act's fixed dark stage, which paints its own colours because it does not
 * follow the user's theme, and a Settings dialog, which is nothing but the
 * user's theme.
 *
 * Rather than fork the markup, every surface-dependent class is named here
 * once per ground. The dialog side deliberately avoids `bg-muted` fills - on a
 * popover surface `--muted` collapses into the surface in every preset theme's
 * dark variant (see gui-app AGENTS.md), so tints are alphas of the foreground,
 * which cannot collapse.
 */
export type SessionImportSurface = "onboarding" | "dialog";

export interface SessionImportTone {
  /** Row and header titles. */
  readonly strong: string;
  /** Secondary metadata: counts, dates, paths. */
  readonly muted: string;
  /** Tertiary: disabled rows, hints. */
  readonly faint: string;
  readonly border: string;
  readonly rowHover: string;
  /** The collapsed group header's own fill. */
  readonly groupSurface: string;
  readonly chip: string;
  readonly warningSurface: string;
  readonly input: string;
  readonly filterActive: string;
  readonly filterIdle: string;
  /** The ticked/indeterminate checkbox fill. */
  readonly checkboxFilled: string;
  readonly primaryButton: string;
  readonly secondaryButton: string;
}

const ONBOARDING_TONE: SessionImportTone = {
  strong: "text-white",
  muted: "text-white/60",
  faint: "text-white/40",
  border: "border-white/12",
  rowHover: "hover:bg-white/[0.07]",
  groupSurface: "bg-white/[0.04]",
  chip: "bg-white/10 text-white/70",
  warningSurface: "bg-amber-300/10 text-amber-100/90",
  input:
    "border-white/15 bg-white/[0.06] text-white placeholder:text-white/35 focus-visible:border-white/35 focus-visible:ring-white/20",
  filterActive: "bg-white/15 text-white",
  filterIdle: "text-white/55 hover:bg-white/10 hover:text-white/85",
  checkboxFilled: "border-white bg-white text-black",
  primaryButton:
    "bg-white text-black hover:bg-white/85 disabled:pointer-events-none disabled:opacity-45",
  secondaryButton: "text-white/70 hover:bg-white/10 hover:text-white",
};

const DIALOG_TONE: SessionImportTone = {
  strong: "text-foreground",
  muted: "text-muted-foreground",
  faint: "text-muted-foreground/70",
  border: "border-border/60",
  rowHover: "hover:bg-foreground/6",
  groupSurface: "bg-foreground/[0.04]",
  chip: "bg-foreground/8 text-muted-foreground",
  warningSurface:
    "bg-amber-500/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
  input: "",
  filterActive: "bg-foreground/10 text-foreground",
  filterIdle:
    "text-muted-foreground hover:bg-foreground/6 hover:text-foreground",
  checkboxFilled: "border-primary bg-primary text-primary-foreground",
  primaryButton: "",
  secondaryButton: "",
};

export function sessionImportTone(
  surface: SessionImportSurface,
): SessionImportTone {
  return surface === "onboarding" ? ONBOARDING_TONE : DIALOG_TONE;
}
