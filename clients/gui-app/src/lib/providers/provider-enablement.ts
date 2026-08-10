/**
 * The tri-state hiding behind the two enablement fields on the wire.
 *
 * `enabled` alone is a boolean, but "off" has two meanings and they are not
 * the same sentence to a user:
 *
 *   - `enabled: false` + `disabledBy: null` — the provider has never been
 *     enabled on this host. Providers ship off by default, so this is the
 *     resting state of most of the catalog on a fresh install. Nobody turned
 *     it off, and copy claiming they did describes an action that never
 *     happened.
 *   - `enabled: false` + `disabledBy` set — a person switched it off, with the
 *     audit record to prove it. "Disabled" is accurate here and only here.
 *
 * The host draws the same distinction in the availability error it reports
 * ("Enable in Settings → Providers" vs "Disabled in Settings → Providers"), so
 * this module exists to keep the client's own copy from drifting away from it.
 * No new wire field carries the tri-state - the pair already says it.
 */
import type { ProviderCliState } from "@traycer/protocol/host/provider-schemas";

export type ProviderEnablement = "enabled" | "never-enabled" | "disabled";

/** Just the two fields that decide the state, so callers can pass a fixture. */
export type ProviderEnablementInput = Pick<
  ProviderCliState,
  "enabled" | "disabledBy"
>;

export function providerEnablement(
  state: ProviderEnablementInput,
): ProviderEnablement {
  if (state.enabled) return "enabled";
  return state.disabledBy === null ? "never-enabled" : "disabled";
}

/**
 * The word next to an enable switch. "Not enabled" rather than "Off" so the
 * label and the control agree on one verb, and rather than "Disabled" so the
 * default state stops accusing the user of a decision.
 */
export const PROVIDER_ENABLEMENT_LABELS: Record<ProviderEnablement, string> = {
  enabled: "Enabled",
  "never-enabled": "Not enabled",
  disabled: "Disabled",
};

export function providerEnablementLabel(
  state: ProviderEnablementInput,
): string {
  return PROVIDER_ENABLEMENT_LABELS[providerEnablement(state)];
}

/**
 * The invitation shown on a never-enabled provider, and `null` for the other
 * two states - an enabled provider needs no prompt, and a provider a person
 * deliberately turned off should not be nagged back on.
 */
export function providerEnableInvitation(
  state: ProviderEnablementInput,
  providerLabel: string,
): string | null {
  if (providerEnablement(state) !== "never-enabled") return null;
  return `Turn on to use ${providerLabel} when creating an agent.`;
}
