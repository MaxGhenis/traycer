import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  downgradeResponseAcrossMajors,
  upgradeResponseToVersion,
} from "@traycer/protocol/framework/index";
import { hostRpcRegistry } from "@traycer/protocol/host/index";
import { RELEASED_FLOOR_METHOD_NAMES } from "@traycer/protocol/host/released-floor";
import {
  DEFAULT_PROVIDER_NATIVE_CAPABILITIES,
  DEFAULT_PROVIDER_NATIVE_CAPABILITIES_V70,
  modelProviderAuthActionSchema,
  modelProviderAuthResultSchema,
  modelProviderEntrySchema,
  modelProviderErrorCodeSchema,
  modelProviderPromptSchema,
  modelProvidersListResultSchema,
  nativeListQuerySchema,
  nativeListQuerySchemaV70,
  nativeListResultSchema,
  nativeListResultSchemaV70,
  projectProviderNativeCapabilitiesToV70,
  providerMcpCapabilitiesSchema,
  providerMcpCapabilitiesSchemaV70,
  providerModelProvidersCapabilitiesSchema,
  providerNativeCapabilitiesSchema,
  providerNativeCapabilitiesSchemaV70,
  providerNativeErrorCodeSchema,
  providerPluginsCapabilitiesSchema,
  providerPluginsCapabilitiesSchemaV70,
  providerSettingsTabSchema,
  providerSkillsCapabilitiesSchema,
  providerSkillsCapabilitiesSchemaV70,
  providerSettingsTabSchemaV70,
} from "@traycer/protocol/host/provider-native-schemas";
import { providerIdSchema, providerIdSchemaV70 } from "@traycer/protocol/host/provider-ids";
import {
  providerCliStateSchema,
  providerCliStateSchemaV70,
  providersAwaitModelProviderAuthRequestSchema,
  providersAwaitModelProviderAuthResponseSchema,
  providersCancelModelProviderAuthRequestSchema,
  providersCancelModelProviderAuthResponseSchema,
  providersListModelProvidersRequestSchema,
  providersListModelProvidersResponseSchema,
  providersListResponseSchema,
  providersListResponseSchemaV10,
  providersListResponseSchemaV20,
  providersListResponseSchemaV30,
  providersListResponseSchemaV40,
  providersListResponseSchemaV50,
  providersListResponseSchemaV60,
  providersListRequestSchemaV70,
  providersListResponseSchemaV70,
  providersModelProviderAuthRequestSchema,
  providersModelProviderAuthResponseSchema,
} from "@traycer/protocol/host/provider-schemas";

/**
 * Model Providers protocol ticket coverage (T1).
 *
 * The load-bearing claim this file exists to hold: the `modelProviders` tab id
 * can never reach a client that negotiated `providers.list@7.0` or lower. It is
 * not an additive value there. `supportedTabs` is an array of a CLOSED enum
 * nested inside `nativeCapabilities`, and `providerCliStateSchema` decodes that
 * whole object through one `.catch(DEFAULT)` - so an unknown member does not
 * degrade to "tab ignored", it takes MCP, Plugins and Skills down with it for
 * that provider.
 */

/**
 * Peel `.nullable()` / `.default()` / `.catch()` wrappers off a field schema to
 * reach the schema object underneath, so a test can assert WHICH schema a
 * frozen line is wired to rather than only how it behaves.
 */
function unwrapSchema(schema: z.ZodType): z.ZodType {
  let current: z.ZodType = schema;
  for (;;) {
    const def: unknown = current.def;
    if (typeof def !== "object" || def === null || !("innerType" in def)) {
      return current;
    }
    const inner: unknown = def.innerType;
    if (!(inner instanceof z.ZodType)) return current;
    current = inner;
  }
}

const MCP_CAPABILITIES = {
  transports: ["stdio"] as const,
  authTypes: ["none"] as const,
  authActions: [] as const,
  actionScopes: {
    list: ["global"] as const,
    add: ["global"] as const,
    update: ["global"] as const,
    remove: ["global"] as const,
    toggleServer: ["global"] as const,
    toggleTool: ["global"] as const,
    discover: ["global"] as const,
    auth: [] as const,
  },
  addServer: "cli" as const,
  removeServer: "cli" as const,
  updateServer: "patch" as const,
  perToolBacking: "native" as const,
  statusSource: "native" as const,
  toolsSource: "native" as const,
  schemasSource: "native" as const,
  instructionsSource: "probe" as const,
  traycerSessionsOnlyEnforcement: false,
  stdioDegradeNotice: false,
  oauthDegradesToConfigOnly: false,
};

const SKILLS_CAPABILITIES = {
  actionScopes: {
    list: ["global"] as const,
    add: ["global"] as const,
    create: ["global"] as const,
    import: [] as const,
    remove: ["global"] as const,
  },
};

/** What an `opencode` host on v8.0 advertises once the tab is live. */
const OPENCODE_CAPABILITIES = providerNativeCapabilitiesSchema.parse({
  supportedTabs: ["general", "env", "usage", "mcp", "skills", "modelProviders"],
  mcp: MCP_CAPABILITIES,
  plugins: null,
  skills: SKILLS_CAPABILITIES,
  modelProviders: { actions: ["connect", "oauth", "disconnect"] },
});

function providerState(providerId: string) {
  return {
    providerId,
    enabled: true,
    disabledBy: null,
    selected: { kind: "bundled" as const },
    candidates: [],
    auth: {
      status: "unknown" as const,
      badgeText: null,
      label: null,
      detail: null,
    },
    authPending: false,
    checkedAt: null,
    apiKey: { supported: false, configured: false, source: null },
    terminalAgentArgs: "",
    envOverrides: [],
    loginCapability: null,
  };
}

const opencodeState = providerCliStateSchema.parse({
  ...providerState("opencode"),
  nativeCapabilities: OPENCODE_CAPABILITIES,
});

/** The same host's `claude-code` row: no Model Providers surface at all. */
const claudeState = providerCliStateSchema.parse({
  ...providerState("claude-code"),
  nativeCapabilities: {
    supportedTabs: ["general", "env", "usage", "mcp"],
    mcp: MCP_CAPABILITIES,
    plugins: null,
    skills: null,
    modelProviders: null,
  },
});

const liveResponse = providersListResponseSchema.parse({
  providers: [opencodeState, claudeState],
  native: null,
});

describe("modelProviders tab id and capability block", () => {
  it("is on the live tab enum and absent from the frozen v7.0 one", () => {
    expect(providerSettingsTabSchema.safeParse("modelProviders").success).toBe(
      true,
    );
    expect(
      providerSettingsTabSchemaV70.safeParse("modelProviders").success,
    ).toBe(false);
  });

  it("requires the capability key rather than tolerating an absent one", () => {
    // Required-and-nullable, like its mcp/plugins/skills siblings. An absent
    // key would fail the whole capability object on a v8.0 client, which the
    // state-level `.catch()` then serves as the empty default - so a producer
    // that forgets the fill must fail here, loudly, not in the field.
    expect(
      providerNativeCapabilitiesSchema.safeParse({
        supportedTabs: ["general"],
        mcp: null,
        plugins: null,
        skills: null,
      }).success,
    ).toBe(false);
  });

  it("accepts an empty action list as a read-only catalog", () => {
    expect(
      providerModelProvidersCapabilitiesSchema.parse({ actions: [] }).actions,
    ).toEqual([]);
    expect(
      providerModelProvidersCapabilitiesSchema.safeParse({
        actions: ["connect", "oauth", "disconnect"],
      }).success,
    ).toBe(true);
    expect(
      providerModelProvidersCapabilitiesSchema.safeParse({
        actions: ["reconnect"],
      }).success,
    ).toBe(false);
  });

  it("carries modelProviders: null on both defaults, in the shape of their own line", () => {
    expect(DEFAULT_PROVIDER_NATIVE_CAPABILITIES.modelProviders).toBeNull();
    expect(DEFAULT_PROVIDER_NATIVE_CAPABILITIES_V70).not.toHaveProperty(
      "modelProviders",
    );
  });
});

describe("the v7.0 collapse this transition exists to prevent", () => {
  it("shows what an unprojected tab id would cost a v7.0 client", () => {
    // NOT a downgrade - the raw payload, handed to the frozen v7.0 state as if
    // the bridge had simply reparsed it. The tab id fails the enum, the array
    // fails, the capability object fails, and `.catch()` serves the empty
    // default: MCP and Skills are gone, silently, for that provider.
    const collapsed = providerCliStateSchemaV70.parse({
      ...providerState("opencode"),
      nativeCapabilities: OPENCODE_CAPABILITIES,
    });
    expect(collapsed.nativeCapabilities).toEqual(
      DEFAULT_PROVIDER_NATIVE_CAPABILITIES_V70,
    );
    expect(collapsed.nativeCapabilities.mcp).toBeNull();
    expect(collapsed.nativeCapabilities.skills).toBeNull();
  });

  it("projects the tab away instead, keeping every other capability intact", () => {
    const projected =
      projectProviderNativeCapabilitiesToV70(OPENCODE_CAPABILITIES);
    expect(projected.supportedTabs).toEqual([
      "general",
      "env",
      "usage",
      "mcp",
      "skills",
    ]);
    expect(projected).not.toHaveProperty("modelProviders");
    expect(projected.mcp).toEqual(OPENCODE_CAPABILITIES.mcp);
    expect(projected.skills).toEqual(OPENCODE_CAPABILITIES.skills);
    expect(providerNativeCapabilitiesSchemaV70.safeParse(projected).success).toBe(
      true,
    );
  });
});

describe("providers.list 8.0 -> 7.0", () => {
  it("hands a v7.0 client byte-identical capabilities for a provider without the tab", () => {
    // The parity claim in its strongest form: a provider that never advertised
    // the new tab must come out of the v8 wire exactly as it went in on v7.
    const downgraded = downgradeResponseAcrossMajors(
      hostRpcRegistry["providers.list"],
      8,
      7,
      liveResponse,
    );
    expect(downgraded.ok).toBe(true);
    if (!downgraded.ok) return;
    const claudeRow = downgraded.value.providers.find(
      (provider) => provider.providerId === "claude-code",
    );
    expect(claudeRow?.nativeCapabilities).toEqual(
      providerNativeCapabilitiesSchemaV70.parse({
        supportedTabs: ["general", "env", "usage", "mcp"],
        mcp: MCP_CAPABILITIES,
        plugins: null,
        skills: null,
      }),
    );
  });

  it("cuts the tab id and the block from the provider that does advertise them", () => {
    const downgraded = downgradeResponseAcrossMajors(
      hostRpcRegistry["providers.list"],
      8,
      7,
      liveResponse,
    );
    expect(downgraded.ok).toBe(true);
    if (!downgraded.ok) return;
    const opencodeRow = downgraded.value.providers.find(
      (provider) => provider.providerId === "opencode",
    );
    expect(opencodeRow?.nativeCapabilities.supportedTabs).not.toContain(
      "modelProviders",
    );
    expect(opencodeRow?.nativeCapabilities).not.toHaveProperty(
      "modelProviders",
    );
    // The rest of the row survives - this is a projection, not the collapse.
    expect(opencodeRow?.nativeCapabilities.mcp).toEqual(
      OPENCODE_CAPABILITIES.mcp,
    );
    expect(opencodeRow?.nativeCapabilities.skills).toEqual(
      OPENCODE_CAPABILITIES.skills,
    );
    expect(
      providersListResponseSchemaV70.safeParse(downgraded.value).success,
    ).toBe(true);
  });

  it("keeps the string out of the serialized v7.0 payload entirely", () => {
    const downgraded = downgradeResponseAcrossMajors(
      hostRpcRegistry["providers.list"],
      8,
      7,
      liveResponse,
    );
    expect(downgraded.ok).toBe(true);
    if (!downgraded.ok) return;
    expect(JSON.stringify(downgraded.value)).not.toContain("modelProviders");
  });
});

describe("providers.list 8.0 -> every older major", () => {
  const FROZEN_RESPONSES = {
    1: providersListResponseSchemaV10,
    2: providersListResponseSchemaV20,
    3: providersListResponseSchemaV30,
    4: providersListResponseSchemaV40,
    5: providersListResponseSchemaV50,
    6: providersListResponseSchemaV60,
    7: providersListResponseSchemaV70,
  } as const;

  it.each([1, 2, 3, 4, 5, 6, 7] as const)(
    "8.0 -> v%i.0 is registered, succeeds, and reparses through that line's frozen schema",
    (targetMajor) => {
      // Every major gets a DIRECT path (the registry composes nothing), so a
      // missing key here is not a degraded response - it is no response that
      // peer can decode at all.
      expect(
        hostRpcRegistry["providers.list"][8].downgradePathsFromLatest[
          targetMajor
        ],
      ).toBeDefined();
      const downgraded = downgradeResponseAcrossMajors(
        hostRpcRegistry["providers.list"],
        8,
        targetMajor,
        liveResponse,
      );
      expect(downgraded.ok).toBe(true);
      if (!downgraded.ok) return;
      expect(
        FROZEN_RESPONSES[targetMajor].safeParse(downgraded.value).success,
      ).toBe(true);
      expect(JSON.stringify(downgraded.value)).not.toContain("modelProviders");
    },
  );

  it("still delivers both providers to a v6.0 client, minus nativeCapabilities", () => {
    // The tab transition must not cost an older client a provider ROW. The
    // frozen sub-v7.0 lines never modeled `nativeCapabilities` at all, so they
    // drop it wholesale and the ids survive untouched.
    const downgraded = downgradeResponseAcrossMajors(
      hostRpcRegistry["providers.list"],
      8,
      6,
      liveResponse,
    );
    expect(downgraded.ok).toBe(true);
    if (!downgraded.ok) return;
    expect(
      downgraded.value.providers.map((provider) => provider.providerId),
    ).toEqual(["opencode", "claude-code"]);
    expect(downgraded.value.providers[0]).not.toHaveProperty(
      "nativeCapabilities",
    );
  });
});

describe("providers.list every older major -> 8.0", () => {
  it("fills modelProviders: null as an OWN key on the v7 -> v8 hop", () => {
    // A missing key and an explicit null are what a consumer gate has to tell
    // apart, and `upgradeResponseToVersion` chains bridges by cast with no
    // re-parse - so the fill has to be real, not a schema default that never
    // runs.
    const upgraded = upgradeResponseToVersion(
      hostRpcRegistry["providers.list"],
      { major: 7, minor: 0 },
      { major: 8, minor: 0 },
      providersListResponseSchemaV70.parse({
        providers: [
          {
            ...providerState("opencode"),
            nativeCapabilities: {
              supportedTabs: ["general", "env", "mcp"],
              mcp: MCP_CAPABILITIES,
              plugins: null,
              skills: null,
            },
          },
        ],
        native: null,
      }),
    );
    const capabilities = upgraded.providers[0].nativeCapabilities;
    expect(Object.keys(capabilities)).toContain("modelProviders");
    expect(capabilities.modelProviders).toBeNull();
    // Everything the v7.0 host did advertise is untouched by the fill.
    expect(capabilities.mcp).toEqual(OPENCODE_CAPABILITIES.mcp);
    expect(providersListResponseSchema.safeParse(upgraded).success).toBe(true);
  });

  it.each([1, 2, 3, 4, 5, 6] as const)(
    "upgrades a v%i.0 response to 8.0 with modelProviders null",
    (sourceMajor) => {
      const frozen = {
        1: providersListResponseSchemaV10,
        2: providersListResponseSchemaV20,
        3: providersListResponseSchemaV30,
        4: providersListResponseSchemaV40,
        5: providersListResponseSchemaV50,
        6: providersListResponseSchemaV60,
      }[sourceMajor];
      const upgraded = upgradeResponseToVersion(
        hostRpcRegistry["providers.list"],
        { major: sourceMajor, minor: 0 },
        { major: 8, minor: 0 },
        frozen.parse({ providers: [providerState("codex")] }),
      );
      expect(
        upgraded.providers[0].nativeCapabilities.modelProviders,
      ).toBeNull();
      expect(providersListResponseSchema.safeParse(upgraded).success).toBe(
        true,
      );
    },
  );
});

describe("the four Model Providers methods are optional capabilities", () => {
  const METHODS = [
    "providers.listModelProviders",
    "providers.modelProviderAuth",
    "providers.awaitModelProviderAuth",
    "providers.cancelModelProviderAuth",
  ] as const;

  it.each(METHODS)(
    "%s is registered at 1.0, degrades unsupported, and stays off the released floor",
    (method) => {
      // A brand-new method NAME is handshake-fatal against a released peer
      // unless it rides the optional-capability channel. `unsupported` is what
      // turns "this host is too old" into a per-call answer with upgrade
      // guidance instead of a dead connection.
      const entry = hostRpcRegistry[method];
      expect(entry).toBeDefined();
      expect(entry.degrade).toEqual({ kind: "unsupported" });
      expect(entry[1].versions[0]).toBeDefined();
      expect(RELEASED_FLOOR_METHOD_NAMES).not.toContain(method);
    },
  );
});

describe("prompts DSL wire schema", () => {
  it("parses a text prompt with and without its optional facts", () => {
    expect(
      modelProviderPromptSchema.parse({
        type: "text",
        key: "region",
        message: "Region",
        placeholder: "us-east-1",
        when: { key: "mode", op: "eq", value: "advanced" },
      }),
    ).toEqual({
      type: "text",
      key: "region",
      message: "Region",
      placeholder: "us-east-1",
      when: { key: "mode", op: "eq", value: "advanced" },
    });
    expect(
      modelProviderPromptSchema.safeParse({
        type: "text",
        key: "region",
        message: "Region",
        placeholder: null,
        when: null,
      }).success,
    ).toBe(true);
  });

  it("requires the nullable keys rather than accepting an absent one", () => {
    // Required-and-nullable: upstream marks these optional, and the host
    // adapts. An omitted key here would mean an unmapped SDK field passes as
    // "not applicable" without anyone deciding that.
    expect(
      modelProviderPromptSchema.safeParse({
        type: "text",
        key: "region",
        message: "Region",
      }).success,
    ).toBe(false);
  });

  it("parses a select prompt with option hints and a neq condition", () => {
    const parsed = modelProviderPromptSchema.parse({
      type: "select",
      key: "mode",
      message: "Mode",
      options: [
        { label: "Basic", value: "basic", hint: null },
        { label: "Advanced", value: "advanced", hint: "more fields" },
      ],
      when: { key: "region", op: "neq", value: "" },
    });
    expect(parsed.type).toBe("select");
    if (parsed.type !== "select") return;
    expect(parsed.options[1].hint).toBe("more fields");
  });

  it("rejects an unmodeled prompt type and an unmodeled condition operator", () => {
    expect(
      modelProviderPromptSchema.safeParse({
        type: "checkbox",
        key: "k",
        message: "m",
        placeholder: null,
        when: null,
      }).success,
    ).toBe(false);
    expect(
      modelProviderPromptSchema.safeParse({
        type: "text",
        key: "k",
        message: "m",
        placeholder: null,
        when: { key: "other", op: "contains", value: "x" },
      }).success,
    ).toBe(false);
  });
});

describe("providers.listModelProviders payloads", () => {
  it("carries an entry with its source, flags and advertised methods", () => {
    const entry = modelProviderEntrySchema.parse({
      id: "anthropic",
      name: "Anthropic",
      source: "api",
      hasStoredCredential: true,
      canDisconnect: true,
      connected: true,
      methods: [
        {
          type: "api",
          label: "API Key",
          prompts: [],
        },
      ],
    });
    expect(entry.source).toBe("api");
    expect(entry.methods[0].prompts).toEqual([]);
  });

  it("reports an externally-sourced credential as read-only, never as storable", () => {
    // `env`/`config`/`custom` are the effective origin. The row still says
    // `connected`, and it is the two flags - not the source string - a
    // renderer gates its disconnect affordance on.
    const entry = modelProviderEntrySchema.parse({
      id: "openai",
      name: "OpenAI",
      source: "env",
      hasStoredCredential: false,
      canDisconnect: false,
      connected: true,
      methods: [],
    });
    expect(entry.canDisconnect).toBe(false);
    expect(entry.connected).toBe(true);
  });

  it("accepts a null source for an unauthenticated provider and rejects an unmodeled one", () => {
    expect(
      modelProviderEntrySchema.safeParse({
        id: "groq",
        name: "Groq",
        source: null,
        hasStoredCredential: false,
        canDisconnect: false,
        connected: false,
        methods: [],
      }).success,
    ).toBe(true);
    expect(
      modelProviderEntrySchema.safeParse({
        id: "groq",
        name: "Groq",
        source: "keychain",
        hasStoredCredential: false,
        canDisconnect: false,
        connected: false,
        methods: [],
      }).success,
    ).toBe(false);
  });

  it("answers with a success arm or a typed error, never a bare throw", () => {
    expect(
      modelProvidersListResultSchema.safeParse({ ok: true, providers: [] })
        .success,
    ).toBe(true);
    expect(
      modelProvidersListResultSchema.safeParse({
        ok: false,
        code: "capability_unavailable",
        detail: "opencode CLI below the minimum version",
      }).success,
    ).toBe(true);
    expect(
      modelProvidersListResultSchema.safeParse({
        ok: false,
        code: "server_unavailable",
        detail: "managed server did not start",
      }).success,
    ).toBe(true);
  });

  it("rejects the shared native-config codes on this surface", () => {
    // The two vocabularies are deliberately disjoint. `external_drift` and
    // friends describe editing provider CONFIG FILES; nothing here edits one.
    for (const code of [
      "duplicate_name",
      "external_drift",
      "rollback_failed",
      "no_change_detected",
      "unsupported_scope",
    ]) {
      expect(
        modelProvidersListResultSchema.safeParse({
          ok: false,
          code,
          detail: null,
        }).success,
        code,
      ).toBe(false);
    }
  });

  it("gates the request on a known Traycer provider id", () => {
    expect(
      providersListModelProvidersRequestSchema.safeParse({
        providerId: "opencode",
      }).success,
    ).toBe(true);
    expect(
      providersListModelProvidersRequestSchema.safeParse({
        providerId: "anthropic",
      }).success,
    ).toBe(false);
    expect(
      providersListModelProvidersResponseSchema.parse({
        result: { ok: true, providers: [] },
      }).result,
    ).toEqual({ ok: true, providers: [] });
  });
});

describe("providers.modelProviderAuth actions", () => {
  it("accepts a plain API-key connect with no advertised method", () => {
    // `methodIndex: null` is the providers with no `/provider/auth` entry -
    // the models.dev env-var name is the key's home and the host owns that
    // mapping, so there is no method to point at.
    const parsed = modelProviderAuthActionSchema.parse({
      action: "connect",
      modelProviderId: "anthropic",
      methodIndex: null,
      inputs: [{ key: "key", value: "sk-secret" }],
    });
    expect(parsed.action).toBe("connect");
    if (parsed.action !== "connect") return;
    expect(parsed.methodIndex).toBeNull();
  });

  it("requires a method index to start OAuth", () => {
    expect(
      modelProviderAuthActionSchema.safeParse({
        action: "startOauth",
        modelProviderId: "anthropic",
        methodIndex: null,
        inputs: [],
      }).success,
    ).toBe(false);
    expect(
      modelProviderAuthActionSchema.safeParse({
        action: "startOauth",
        modelProviderId: "anthropic",
        methodIndex: 0,
        inputs: [],
      }).success,
    ).toBe(true);
  });

  it("addresses submitCode by attempt id, not by provider alone", () => {
    // Attempts are single-flight per (providerId, modelProviderId) and a new
    // one supersedes the pending one, so a code for a superseded attempt has
    // to be discardable rather than applied to whatever is pending now.
    expect(
      modelProviderAuthActionSchema.safeParse({
        action: "submitCode",
        modelProviderId: "anthropic",
        code: "abc123",
      }).success,
    ).toBe(false);
    expect(
      modelProviderAuthActionSchema.safeParse({
        action: "submitCode",
        modelProviderId: "anthropic",
        attemptId: "attempt-1",
        code: "abc123",
      }).success,
    ).toBe(true);
  });

  it("takes a disconnect with nothing but the upstream provider id", () => {
    expect(
      providersModelProviderAuthRequestSchema.safeParse({
        providerId: "opencode",
        action: { action: "disconnect", modelProviderId: "anthropic" },
      }).success,
    ).toBe(true);
  });

  it("rejects an empty upstream provider id", () => {
    expect(
      modelProviderAuthActionSchema.safeParse({
        action: "disconnect",
        modelProviderId: "",
      }).success,
    ).toBe(false);
  });
});

describe("model provider auth results", () => {
  it("carries the attempt id, url, method and instructions on an OAuth start", () => {
    const result = modelProviderAuthResultSchema.parse({
      kind: "authorizationUrl",
      attemptId: "attempt-1",
      authorizationUrl: "https://example.test/oauth",
      method: "code",
      instructions: "Paste the code shown after approving.",
    });
    expect(result.kind).toBe("authorizationUrl");
    if (result.kind !== "authorizationUrl") return;
    expect(result.attemptId).toBe("attempt-1");
    expect(result.method).toBe("code");
  });

  it("requires an attempt id on that arm - a flow nobody can address is unusable", () => {
    expect(
      modelProviderAuthResultSchema.safeParse({
        kind: "authorizationUrl",
        authorizationUrl: "https://example.test/oauth",
        method: "auto",
        instructions: null,
      }).success,
    ).toBe(false);
  });

  it("models pending / done / unsupported / error and nothing else", () => {
    for (const result of [
      { kind: "pending" },
      { kind: "done" },
      { kind: "unsupported", reason: "opencode CLI is too old" },
      { kind: "error", code: "provider_auth_failed", detail: null },
    ]) {
      expect(modelProviderAuthResultSchema.safeParse(result).success).toBe(
        true,
      );
    }
    expect(
      modelProviderAuthResultSchema.safeParse({ kind: "cancelled" }).success,
    ).toBe(false);
    // `pendingInstruction` has no counterpart here: upstream carries its
    // instruction text on the authorization response, so an instruction-only
    // arm is one nothing could ever emit.
    expect(
      modelProviderAuthResultSchema.safeParse({
        kind: "pendingInstruction",
        instruction: "do the thing",
      }).success,
    ).toBe(false);
  });

  it("wraps every method's payload in the same non-nullable result envelope", () => {
    expect(
      providersModelProviderAuthResponseSchema.safeParse({ result: null })
        .success,
    ).toBe(false);
    expect(
      providersAwaitModelProviderAuthResponseSchema.parse({
        result: { kind: "pending" },
      }).result.kind,
    ).toBe("pending");
  });
});

describe("await / cancel attempt addressing", () => {
  it("polls and cancels by (modelProviderId, attemptId)", () => {
    expect(
      providersAwaitModelProviderAuthRequestSchema.safeParse({
        providerId: "opencode",
        context: { modelProviderId: "anthropic", attemptId: "attempt-1" },
      }).success,
    ).toBe(true);
    expect(
      providersCancelModelProviderAuthRequestSchema.safeParse({
        providerId: "opencode",
        context: { modelProviderId: "anthropic", attemptId: "" },
      }).success,
    ).toBe(false);
  });

  it("separates 'was something torn down' from 'what is the state now'", () => {
    // Cancelling an attempt that already completed, expired or was superseded
    // is `cancelled: false` with a perfectly normal result - and cancel is
    // best-effort LOCAL either way: upstream has no OAuth-cancel endpoint.
    const response = providersCancelModelProviderAuthResponseSchema.parse({
      cancelled: false,
      result: { kind: "done" },
    });
    expect(response.cancelled).toBe(false);
    expect(response.result.kind).toBe("done");
  });
});

describe("attempt lifecycle is encodable end to end", () => {
  // The plan settles these outcomes; the wire has to be able to SAY them. The
  // shared native-config enum could not - it has no member for a superseded or
  // expired attempt - so a host would have had to overload `external_drift` or
  // invent silence. Each case below is one settled outcome and the client
  // action it implies.
  const OUTCOMES = [
    {
      name: "a stale attempt id is discarded, not answered with the live attempt's status",
      code: "attempt_not_found" as const,
    },
    {
      name: "a superseded attempt is told so, so its UI stands down instead of restarting",
      code: "attempt_superseded" as const,
    },
    {
      name: "an attempt reaped by the pending-auth registry reports expiry",
      code: "attempt_expired" as const,
    },
    {
      name: "a rejected code leaves the attempt live and asks for another",
      code: "code_rejected" as const,
    },
    {
      name: "prompt answers the provider refuses come back as invalid input",
      code: "invalid_input" as const,
    },
    {
      name: "an upstream credential/callback refusal is its own code",
      code: "provider_auth_failed" as const,
    },
    {
      name: "a managed server that will not start is not blamed on the credential",
      code: "server_unavailable" as const,
    },
    {
      name: "an unknown upstream provider id is answerable without guessing",
      code: "provider_not_found" as const,
    },
  ];

  it.each(OUTCOMES)("poll: $name", ({ code }) => {
    const parsed = providersAwaitModelProviderAuthResponseSchema.parse({
      result: { kind: "error", code, detail: null },
    });
    expect(parsed.result.kind).toBe("error");
    if (parsed.result.kind !== "error") return;
    expect(parsed.result.code).toBe(code);
  });

  it.each(OUTCOMES)("auth action: $name", ({ code }) => {
    expect(
      providersModelProviderAuthResponseSchema.safeParse({
        result: { kind: "error", code, detail: "detail text" },
      }).success,
    ).toBe(true);
  });

  it.each(OUTCOMES)("cancel: $name, with cancelled:false", ({ code }) => {
    // Cancel is best-effort and local. "Nothing was torn down" and "here is
    // why" are separate facts, and both have to be sayable together.
    const parsed = providersCancelModelProviderAuthResponseSchema.parse({
      cancelled: false,
      result: { kind: "error", code, detail: null },
    });
    expect(parsed.cancelled).toBe(false);
    expect(parsed.result.kind).toBe("error");
  });

  it("reports a successful cancel as cancelled:true with a non-error result", () => {
    const parsed = providersCancelModelProviderAuthResponseSchema.parse({
      cancelled: true,
      result: { kind: "done" },
    });
    expect(parsed.cancelled).toBe(true);
    expect(parsed.result.kind).toBe("done");
  });

  it("keeps the auth error vocabulary disjoint from the shared native one", () => {
    // Not a style preference: `providerNativeErrorCodeSchema` rides RELEASED
    // carriers, so it cannot be widened, and its members describe config-file
    // edits. A model-provider code leaking into it (or vice versa) would mean
    // one of the two enums grew where it must not.
    for (const code of modelProviderErrorCodeSchema.options) {
      expect(
        providerNativeErrorCodeSchema.safeParse(code).success,
        `${code} must not exist on the shared native enum`,
      ).toBe(false);
    }
    for (const code of providerNativeErrorCodeSchema.options) {
      expect(
        modelProviderErrorCodeSchema.safeParse(code).success,
        `${code} must not exist on the model-provider enum`,
      ).toBe(false);
    }
  });
});

describe("the v7.0 freeze goes all the way down", () => {
  // A `...V70` schema that still points into the live tree is a freeze-shaped
  // alias, not a freeze: the outer object is pinned while every enum inside it
  // stays free to grow, and enum growth is the half that is FATAL to an
  // already-shipped v7.0 peer rather than merely leaked.
  //
  // These compare the frozen v7.0 subtrees against the live ones. They are
  // green today because the two agree, and they are here for the day they stop
  // agreeing: growth on a live subtree turns them red, which routes the
  // "what does a v7.0 client see?" decision to whoever grew it. Do NOT satisfy
  // a failure by editing the V70 copy - extend `projectProviderNativeCapabilities
  // ToV70` (or the v8→v7 response bridge) to say explicitly what gets projected
  // away.
  const PAIRS = [
    ["mcp capabilities", providerMcpCapabilitiesSchema, providerMcpCapabilitiesSchemaV70],
    [
      "plugins capabilities",
      providerPluginsCapabilitiesSchema,
      providerPluginsCapabilitiesSchemaV70,
    ],
    [
      "skills capabilities",
      providerSkillsCapabilitiesSchema,
      providerSkillsCapabilitiesSchemaV70,
    ],
    ["native list query", nativeListQuerySchema, nativeListQuerySchemaV70],
    ["native list result", nativeListResultSchema, nativeListResultSchemaV70],
  ] as const;

  it.each(PAIRS)(
    "%s: the frozen v7.0 copy still matches the live schema",
    (_label, live, frozen) => {
      expect(z.toJSONSchema(frozen, { unrepresentable: "any" })).toEqual(
        z.toJSONSchema(live, { unrepresentable: "any" }),
      );
    },
  );

  it("wires the v7.0 request/response/state to the frozen tree, not the live one", () => {
    // The structural claim the equality checks above cannot make. While live
    // and frozen agree, NO payload can tell them apart - a v7.0 schema wired
    // to the live query would pass every round-trip test in this file. So this
    // asserts the wiring itself: the schema objects reachable from the v7.0
    // contracts must BE the frozen ones.
    expect(unwrapSchema(providersListRequestSchemaV70.shape.native)).toBe(
      nativeListQuerySchemaV70,
    );
    expect(unwrapSchema(providersListResponseSchemaV70.shape.native)).toBe(
      nativeListResultSchemaV70,
    );
    expect(
      unwrapSchema(providerCliStateSchemaV70.shape.nativeCapabilities),
    ).toBe(providerNativeCapabilitiesSchemaV70);
    // ...and one level deeper, which is where a shallow freeze actually hides.
    expect(
      unwrapSchema(providerNativeCapabilitiesSchemaV70.shape.mcp),
    ).toBe(providerMcpCapabilitiesSchemaV70);
    expect(
      unwrapSchema(providerNativeCapabilitiesSchemaV70.shape.plugins),
    ).toBe(providerPluginsCapabilitiesSchemaV70);
    expect(
      unwrapSchema(providerNativeCapabilitiesSchemaV70.shape.skills),
    ).toBe(providerSkillsCapabilitiesSchemaV70);
  });

  it("keeps the frozen provider-id enum out of the live one's future", () => {
    // The v7.0 native query carries a provider id. A provider added to the
    // live enum reaches a v7.0 peer only through the bridge, never by the
    // frozen schema quietly widening underneath it.
    expect(providerIdSchemaV70.options).toEqual(providerIdSchema.options);
  });
});
