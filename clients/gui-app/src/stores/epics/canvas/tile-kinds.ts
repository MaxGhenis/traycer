import { makeLiteralGuard } from "@/lib/type-guard";
const TILE_KIND_CHAT = "chat";
const TILE_KIND_TERMINAL_AGENT = "terminal-agent";
const TILE_KIND_SPEC = "spec";
const TILE_KIND_TICKET = "ticket";
const TILE_KIND_STORY = "story";
const TILE_KIND_REVIEW = "review";
const TILE_KIND_TERMINAL = "terminal";
export const TILE_KIND_BROWSER = "browser";
export const TILE_KIND_BROWSER_PEEK = "browser-peek";
// The agent's own browser tile: a real WebContentsView in a separate,
// credential-free partition (never `persist:traycer-browser`). Distinct from
// `browser` (the user's tile, drivable via the old control-grant surface)
// and `browser-peek` (a read-only screencast mirror).
export const TILE_KIND_AGENT_BROWSER = "agent-browser";
const TILE_KIND_WORKSPACE_FILE = "workspace-file";
export const TILE_KIND_GIT_DIFF = "git-diff";
export const TILE_KIND_SNAPSHOT_DIFF = "snapshot-diff";
// A "blank" tab: a real strip tab whose body renders the inline opener until
// content is picked (which replaces it in place).
export const TILE_KIND_BLANK = "blank";

export type TileKindId =
  | typeof TILE_KIND_CHAT
  | typeof TILE_KIND_TERMINAL_AGENT
  | typeof TILE_KIND_SPEC
  | typeof TILE_KIND_TICKET
  | typeof TILE_KIND_STORY
  | typeof TILE_KIND_REVIEW
  | typeof TILE_KIND_TERMINAL
  | typeof TILE_KIND_BROWSER
  | typeof TILE_KIND_BROWSER_PEEK
  | typeof TILE_KIND_AGENT_BROWSER
  | typeof TILE_KIND_WORKSPACE_FILE
  | typeof TILE_KIND_GIT_DIFF
  | typeof TILE_KIND_SNAPSHOT_DIFF
  | typeof TILE_KIND_BLANK;

export const isTileKind = makeLiteralGuard<TileKindId>({
  [TILE_KIND_CHAT]: true,
  [TILE_KIND_TERMINAL_AGENT]: true,
  [TILE_KIND_SPEC]: true,
  [TILE_KIND_TICKET]: true,
  [TILE_KIND_STORY]: true,
  [TILE_KIND_REVIEW]: true,
  [TILE_KIND_TERMINAL]: true,
  [TILE_KIND_BROWSER]: true,
  [TILE_KIND_BROWSER_PEEK]: true,
  [TILE_KIND_AGENT_BROWSER]: true,
  [TILE_KIND_WORKSPACE_FILE]: true,
  [TILE_KIND_GIT_DIFF]: true,
  [TILE_KIND_SNAPSHOT_DIFF]: true,
  [TILE_KIND_BLANK]: true,
});
