import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ProviderCliState } from "@traycer/protocol/host/provider-schemas";
import { DEFAULT_PROVIDER_NATIVE_CAPABILITIES } from "@traycer/protocol/host/provider-native-schemas";

const providerMocks = vi.hoisted(() => ({
  providers: [] as ProviderCliState[],
}));

vi.mock("@/hooks/providers/use-providers-list-query", () => ({
  useProvidersList: () => ({
    data: { providers: providerMocks.providers },
    isPending: false,
    isError: false,
    fetchStatus: "idle",
  }),
}));

vi.mock("@/hooks/providers/use-providers-set-enabled-mutation", () => ({
  useProvidersSetEnabled: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
}));

import { OnboardingDetectedAgents } from "@/components/onboarding/onboarding-detected-agents";

function providerState(
  providerId: ProviderCliState["providerId"],
  enablement: Pick<ProviderCliState, "enabled" | "disabledBy">,
): ProviderCliState {
  return {
    providerId,
    enabled: enablement.enabled,
    disabledBy: enablement.disabledBy,
    selected: { kind: "bundled" },
    candidates: [],
    auth: {
      status: "authenticated",
      badgeText: null,
      label: "Signed in",
      detail: null,
    },
    authPending: false,
    checkedAt: null,
    apiKey: { supported: false, configured: false, source: null },
    terminalAgentArgs: "",
    envOverrides: [],
    loginCapability: null,
    availabilityPending: false,
    nativeCapabilities: DEFAULT_PROVIDER_NATIVE_CAPABILITIES,
    managedInstallState: null,
    versionVisibility: null,
    advisory: null,
    profiles: [],
  };
}

function rowText(name: string): string {
  const row = screen
    .getAllByRole("listitem")
    .find((item) => item.textContent.includes(name));
  if (row === undefined) throw new Error(`No onboarding row for ${name}.`);
  return row.textContent;
}

afterEach(() => {
  cleanup();
  providerMocks.providers = [];
});

describe("OnboardingDetectedAgents", () => {
  it("renders providers in the shared provider order", () => {
    render(<OnboardingDetectedAgents />);

    const expectedNames = [
      "Codex",
      "Claude Code",
      "OpenCode",
      "Traycer Inference",
      "OpenRouter",
      "Hugging Face",
      "Droid",
      "Cursor",
      "Copilot",
      "Grok",
      "Kiro",
      "Kilo Code",
      "Kimi",
      "Qwen Code",
      "Amp",
      "Devin",
      "Pi",
      "Hermes Agent",
      "Oh My Pi",
    ];
    const textOrEmpty = (text: string | null): string => text ?? "";
    // Longest match, not first match: display names overlap ("Pi" is a
    // substring of "Oh My Pi"), so a first-match probe would label the Oh My Pi
    // row "Pi" and silently pass a wrong order.
    const longestMatch = (text: string): string =>
      expectedNames
        .filter((name) => text.includes(name))
        .reduce(
          (longest, name) => (name.length > longest.length ? name : longest),
          "",
        );

    expect(
      screen.getAllByRole("listitem").map((row) => {
        const text = textOrEmpty(row.textContent);
        return longestMatch(text);
      }),
    ).toEqual(expectedNames);
  });

  // Onboarding is where the seeded set gets confirmed: the host turns on the
  // floor plus anything it detected, and everything else arrives off with no
  // `disabledBy`. Those rows are an OFFER, so they may not be labelled with a
  // decision nobody made - only a provider a person switched off says
  // "Disabled".
  it("offers a never-enabled provider instead of calling it disabled", () => {
    providerMocks.providers = [
      providerState("codex", { enabled: true, disabledBy: null }),
      providerState("grok", { enabled: false, disabledBy: null }),
      providerState("qwen", {
        enabled: false,
        disabledBy: {
          userId: "4b1b3f3b-1d55-4a1c-9a2a-d0c6ab6e6c33",
          handle: "pranshu",
          at: 1,
        },
      }),
    ];

    render(<OnboardingDetectedAgents />);

    expect(rowText("Codex")).toContain("Signed in");
    expect(rowText("Grok")).toContain("Not enabled - turn on to use");
    expect(rowText("Grok")).not.toContain("Disabled");
    expect(rowText("Qwen Code")).toContain("Disabled");
  });

  it("keeps the enable switch reachable on every off provider", () => {
    providerMocks.providers = [
      providerState("codex", { enabled: true, disabledBy: null }),
      providerState("grok", { enabled: false, disabledBy: null }),
    ];

    render(<OnboardingDetectedAgents />);

    const grokSwitch = screen.getByRole("switch", { name: "Enable Grok" });
    if (!(grokSwitch instanceof HTMLButtonElement)) {
      throw new Error("Expected the Grok switch to render as a button.");
    }
    // Two providers are known and one is on, so the at-least-one rule binds
    // only the enabled one - the offer is always actionable.
    expect(grokSwitch.disabled).toBe(false);
    expect(grokSwitch.getAttribute("aria-checked")).toBe("false");
  });
});
