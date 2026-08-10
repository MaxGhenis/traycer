import { describe, expect, it } from "vitest";
import {
  providerEnableInvitation,
  providerEnablement,
  providerEnablementLabel,
} from "@/lib/providers/provider-enablement";

const DISABLED_BY = {
  userId: "d0c6ab6e-6c33-4a1c-9a2a-4b1b3f3b1d55",
  handle: "pranshu",
  at: 1,
};

describe("providerEnablement", () => {
  it("reads an enabled provider as enabled regardless of a stale attribution", () => {
    expect(providerEnablement({ enabled: true, disabledBy: null })).toBe(
      "enabled",
    );
    // `disabledBy` is cleared on enable, but the client must not depend on that
    // ordering: `enabled` is the fact, `disabledBy` only explains an off state.
    expect(providerEnablement({ enabled: true, disabledBy: DISABLED_BY })).toBe(
      "enabled",
    );
  });

  it("separates never-enabled from user-disabled", () => {
    expect(providerEnablement({ enabled: false, disabledBy: null })).toBe(
      "never-enabled",
    );
    expect(
      providerEnablement({ enabled: false, disabledBy: DISABLED_BY }),
    ).toBe("disabled");
  });
});

describe("providerEnablementLabel", () => {
  it("never tells a user they disabled something they never enabled", () => {
    expect(providerEnablementLabel({ enabled: true, disabledBy: null })).toBe(
      "Enabled",
    );
    expect(providerEnablementLabel({ enabled: false, disabledBy: null })).toBe(
      "Not enabled",
    );
    expect(
      providerEnablementLabel({ enabled: false, disabledBy: DISABLED_BY }),
    ).toBe("Disabled");
  });
});

describe("providerEnableInvitation", () => {
  it("invites only the never-enabled state", () => {
    expect(
      providerEnableInvitation({ enabled: false, disabledBy: null }, "Codex"),
    ).toBe("Turn on to use Codex when creating an agent.");
  });

  it("stays silent for an enabled provider and for a deliberate disable", () => {
    expect(
      providerEnableInvitation({ enabled: true, disabledBy: null }, "Codex"),
    ).toBeNull();
    expect(
      providerEnableInvitation(
        { enabled: false, disabledBy: DISABLED_BY },
        "Codex",
      ),
    ).toBeNull();
  });
});
