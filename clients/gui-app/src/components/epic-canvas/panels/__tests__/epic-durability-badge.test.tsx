import "../../../../../__tests__/test-browser-apis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EpicDurabilityBadge } from "../epic-durability-badge";
import type {
  EpicDurabilityPauseReasonV14,
  EpicDurabilityStatusV14,
  EpicLocalProtection,
  EpicPromotionState,
} from "@traycer/protocol/host/epic/subscribe";

/**
 * Typed through the protocol union rather than an `as` assertion on the seed
 * value: `no-unnecessary-type-assertion` autofixes such an assertion away, and
 * the widened inference that replaces it makes the `null` reassignment below a
 * type error. The type argument states the same intent where no fixer reaches.
 */
const durability = vi.hoisted<{
  status: EpicDurabilityStatusV14 | null;
  pauseReason: EpicDurabilityPauseReasonV14 | null;
  promotionState: EpicPromotionState | null;
  /**
   * `null` is a PRE-`@1.4` peer, which is what every case written before the
   * s5 status pass assumed - and it keeps their exact rendering. The new cases
   * set a real value, because at `@1.4` this key is always present.
   */
  localProtection: EpicLocalProtection | null;
}>(() => ({
  status: "paused",
  pauseReason: "access-revoked",
  promotionState: null,
  localProtection: null,
}));

// `deriveEpicDurabilityView` is the real implementation, deliberately: it IS
// the class-level correction this ticket makes, so a stub of it here would
// leave the badge's own reading of unknown untested while looking covered.
vi.mock("@/lib/epic-selectors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/epic-selectors")>();
  return {
    deriveEpicDurabilityView: actual.deriveEpicDurabilityView,
    useEpicDurabilityView: () =>
      actual.deriveEpicDurabilityView(
        durability.status,
        durability.localProtection,
      ),
    useEpicDurabilityPauseReason: () => durability.pauseReason,
    useEpicDurabilityPromotionState: () => durability.promotionState,
    useEpicArtifactRecords: () => [],
    useEpicSnapshotMeta: () => null,
  };
});

vi.mock("@/hooks/epic/use-epic-export-artifacts-mutation", () => ({
  useEpicExportArtifacts: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/providers/use-runner-host", () => ({
  useRunnerHost: () => ({
    authnBaseUrl: "https://authn.test",
    openExternalLink: vi.fn(),
  }),
}));

describe("<EpicDurabilityBadge />", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the revoked-access export surface, not the upgrade story", () => {
    durability.status = "paused";
    durability.pauseReason = "access-revoked";
    durability.promotionState = null;

    render(<EpicDurabilityBadge />);

    expect(screen.getByText("Sync blocked — access revoked")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Export artifacts" }),
    ).toBeTruthy();
    expect(screen.queryByText("Upgrade")).toBeNull();
  });

  it("renders upgrade only for the entitlement-lapsed reason", () => {
    durability.status = "paused";
    durability.pauseReason = "entitlement-lapsed";
    durability.promotionState = null;

    render(<EpicDurabilityBadge />);

    expect(screen.getByText("Sync paused")).toBeTruthy();
    expect(screen.getByText("Upgrade")).toBeTruthy();
    expect(screen.queryByText("Export artifacts")).toBeNull();
  });

  it("keeps an omitted pause reason neutral with no call to action", () => {
    durability.status = "paused";
    durability.pauseReason = null;
    durability.promotionState = null;

    render(<EpicDurabilityBadge />);

    expect(screen.getByText("Sync paused")).toBeTruthy();
    expect(screen.queryByText("Upgrade")).toBeNull();
    expect(screen.queryByText("Export artifacts")).toBeNull();
  });

  it("renders a visibly distinct pending state for promotionState=pending, not live Promoting copy", () => {
    durability.status = "promoting";
    durability.pauseReason = null;
    durability.promotionState = "pending";

    render(<EpicDurabilityBadge />);

    const badge = screen.getByTestId("epic-durability-badge");
    expect(badge.getAttribute("data-promotion-state")).toBe("pending");
    expect(screen.getByText("Promotion pending")).toBeTruthy();
    expect(screen.queryByText("Promoting to cloud")).toBeNull();
  });

  it("keeps the live Promoting to cloud copy for promotionState=active", () => {
    durability.status = "promoting";
    durability.pauseReason = null;
    durability.promotionState = "active";

    render(<EpicDurabilityBadge />);

    const badge = screen.getByTestId("epic-durability-badge");
    expect(badge.getAttribute("data-promotion-state")).toBe("active");
    expect(screen.getByText("Promoting to cloud")).toBeTruthy();
    expect(screen.queryByText("Promotion pending")).toBeNull();
  });

  // ── `s5-status-truthfulness`: unknown must not render as fine ───────────
  //
  // Every case below drew NOTHING on the pre-fix code - the component's first
  // statement was `if (status === null) return null;` - so an unprotected or
  // indeterminate session was pixel-identical to a protected one.

  it("renders an explicit indeterminate badge for durability=unknown", () => {
    durability.status = "unknown";
    durability.pauseReason = null;
    durability.promotionState = null;
    durability.localProtection = "unknown";

    render(<EpicDurabilityBadge />);

    expect(screen.getByText("Storage status unknown")).toBeTruthy();
  });

  it("warns visibly when the session has NO local protection", () => {
    durability.status = null;
    durability.pauseReason = null;
    durability.promotionState = null;
    durability.localProtection = "unavailable";

    render(<EpicDurabilityBadge />);

    const badge = screen.getByTestId("epic-durability-badge");
    expect(screen.getByText("No local backup")).toBeTruthy();
    expect(badge.getAttribute("data-local-protection")).toBe("unavailable");
  });

  it("treats an absent durability key from a @1.4 peer as unknown, not synced", () => {
    // The absence rule. `armed` would license the calm rendering; `unknown`
    // may not, and used to.
    durability.status = null;
    durability.pauseReason = null;
    durability.promotionState = null;
    durability.localProtection = "unknown";

    render(<EpicDurabilityBadge />);

    expect(screen.getByText("Storage status unknown")).toBeTruthy();
  });

  it("stays silent when both legs positively say cloud-durable and armed", () => {
    // The calm case still has to be silent, or the fix is just noise on every
    // healthy online epic. It is licensed by `armed`, not by the absence.
    durability.status = null;
    durability.pauseReason = null;
    durability.promotionState = null;
    durability.localProtection = "armed";

    render(<EpicDurabilityBadge />);

    expect(screen.queryByTestId("epic-durability-badge")).toBeNull();
  });

  it("stays silent for a pre-@1.4 peer with no durability answer", () => {
    // Old hosts keep exactly their current rendering; the minor is additive.
    durability.status = null;
    durability.pauseReason = null;
    durability.promotionState = null;
    durability.localProtection = null;

    render(<EpicDurabilityBadge />);

    expect(screen.queryByTestId("epic-durability-badge")).toBeNull();
  });

  it("names the actionable delete-path pause reason instead of a bare paused", () => {
    // `s5-status-truthfulness` instance 2. All three delete reasons used to
    // fall through to "Sync paused"; this one means the epic holds local
    // edits the deleted cloud copy never received.
    durability.status = "paused";
    durability.pauseReason = "orphaned-local-edits-after-cloud-delete";
    durability.promotionState = null;
    durability.localProtection = "armed";

    render(<EpicDurabilityBadge />);

    expect(
      screen.getByText("Deleted in cloud — local edits kept here"),
    ).toBeTruthy();
    expect(screen.queryByText("Sync paused")).toBeNull();
  });
});
