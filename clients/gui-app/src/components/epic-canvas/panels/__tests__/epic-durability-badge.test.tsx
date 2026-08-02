import "../../../../../__tests__/test-browser-apis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EpicDurabilityBadge } from "../epic-durability-badge";

const durability = vi.hoisted(() => ({
  status: "paused" as "paused" | "offline" | "local" | "promoting" | null,
  pauseReason: "access-revoked" as
    "access-revoked" | "entitlement-lapsed" | null,
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
