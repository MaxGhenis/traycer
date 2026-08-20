export type OnboardingActId =
  | "task-tabs"
  | "navigation"
  | "task-context"
  | "providers"
  | "session-import"
  | "agent-guide"
  | "command-theme";

export interface OnboardingAct {
  readonly id: OnboardingActId;
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly addon: "agents" | "session-import" | "theme" | null;
}

/**
 * Acts whose addon IS the act - a live panel that needs the copy rail's full
 * height and drops the mini-app when the layout stacks. Named here rather than
 * spelled out at each of the page's three checks, so adding another full-bleed
 * act cannot half-land.
 */
export function actUsesSoloStage(act: OnboardingAct): boolean {
  return act.addon === "agents" || act.addon === "session-import";
}

/**
 * Copy and per-act extras mirror the Figma onboarding frames.
 */
export const ONBOARDING_ACTS: ReadonlyArray<OnboardingAct> = [
  {
    id: "task-tabs",
    eyebrow: "ACT 01 - TASKS",
    title: "Your work lives\nin Task tabs",
    body: "Each Task tab holds one initiative: agents, artifacts, terminals, and context stay together. Switch away, come back later, nothing scatters.",
    addon: null,
  },
  {
    id: "navigation",
    eyebrow: "ACT 02 - LAYOUT",
    title: "Find it on the left.\nOpen it on the canvas.",
    body: "The left lists are your map: agents and artifacts. The canvas is where selected work opens, splits, and stays beside the conversation.",
    addon: null,
  },
  {
    id: "task-context",
    eyebrow: "ACT 03 - HANDOFF",
    title: "Agents that talk\nto each other",
    body: "Your agents coordinate inside one Task: delegate work, report back, and stay in sync without you acting as the relay.",
    addon: null,
  },
  {
    id: "providers",
    eyebrow: "ACT 04 - PROVIDERS",
    title: "Bring your\nsubscriptions with you",
    body: "Connect the coding agents you already use.",
    addon: "agents",
  },
  {
    id: "session-import",
    eyebrow: "ACT 05 - YOUR WORK",
    title: "Bring your\nsessions with you",
    body: "Work you already started in Claude Code or Codex can come with you as tasks. Pick what to bring; the import runs while you carry on.",
    addon: "session-import",
  },
  {
    id: "agent-guide",
    eyebrow: "ACT 06 - DELEGATION",
    title: "Tell Traycer\nhow to choose",
    body: "Set the rules once. Traycer follows them every time it spawns a child agent, so you're not re-deciding per task.",
    addon: null,
  },
  {
    id: "command-theme",
    eyebrow: "ACT 07 - FLOW",
    title: "Move fast.\nMake it yours.",
    body: "Use Cmd+K to create, jump, launch, and switch without breaking flow. Pick a theme before you enter; terminals and app surfaces follow it together.",
    addon: "theme",
  },
];
