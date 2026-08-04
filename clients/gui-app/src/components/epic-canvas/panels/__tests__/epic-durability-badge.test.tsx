import "../../../../../__tests__/test-browser-apis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EpicDurabilityBadge } from "../epic-durability-badge";
import type {
  EpicDurabilityPauseReason,
  EpicDurabilityStatus,
} from "@traycer/protocol/host/epic/subscribe";

/**
 * Typed through the protocol union rather than an `as` assertion on the seed
 * value: `no-unnecessary-type-assertion` autofixes such an assertion away, and
 * the widened inference that replaces it makes the `null` reassignment below a
 * type error. The type argument states the same intent where no fixer reaches.
 */
const durability = vi.hoisted<{
  status: EpicDurabilityStatus | null;
  pauseReason: EpicDurabilityPauseReason | null;
}>(() => ({
  status: "paused",
  pauseReason: "access-revoked",
}));

vi.mock("@/lib/epic-selectors", () => ({
  useEpicDurabilityStatus: () => durability.status,
  useEpicDurabilityPauseReason: () => durability.pauseReason,
  useEpicArtifactRecords: () => [],
  useEpicSnapshotMeta: () => null,
}));

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

    render(<EpicDurabilityBadge />);

    expect(screen.getByText("Sync paused")).toBeTruthy();
    expect(screen.getByText("Upgrade")).toBeTruthy();
    expect(screen.queryByText("Export artifacts")).toBeNull();
  });

  it("keeps an omitted pause reason neutral with no call to action", () => {
    durability.status = "paused";
    durability.pauseReason = null;

    render(<EpicDurabilityBadge />);

    expect(screen.getByText("Sync paused")).toBeTruthy();
    expect(screen.queryByText("Upgrade")).toBeNull();
    expect(screen.queryByText("Export artifacts")).toBeNull();
  });
});
