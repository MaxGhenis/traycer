/**
 * `browser.sessions@1.0` and `browser.screencast@1.0` - browser V1 stream
 * contracts between the GUI and host-owned headless browser sessions.
 *
 * These are intentionally stream-only additions. Once shipped, both methods
 * stay on major 1 forever; future changes must be additive minors because the
 * stream transport has no cross-major bridge.
 */
import { z } from "zod";
import { defineStreamRpcContract } from "@traycer/protocol/framework/versioned-stream-rpc";

const textFrameFields = {
  hasBinaryPayload: z.literal(false),
} as const;

const binaryFrameFields = {
  hasBinaryPayload: z.literal(true),
} as const;

const requestFrameFields = {
  ...textFrameFields,
  requestId: z.string(),
} as const;

const browserSessionReferenceFields = {
  sessionId: z.string(),
} as const;

export const browserOriginTierSchema = z.enum(["dev", "external"]);
export type BrowserOriginTier = z.infer<typeof browserOriginTierSchema>;

export const browserSessionStatusSchema = z.enum([
  "provisioning",
  "ready",
  "navigating",
  "closing",
  "crashed",
]);
export type BrowserSessionStatus = z.infer<typeof browserSessionStatusSchema>;

export const browserSessionClosedReasonSchema = z.enum([
  "completed",
  "idle-ttl",
  "evicted",
  "crashed",
]);
export type BrowserSessionClosedReason = z.infer<
  typeof browserSessionClosedReasonSchema
>;

export const browserSessionInfoSchema = z.object({
  sessionId: z.string(),
  chatId: z.string(),
  hostId: z.string(),
  url: z.string(),
  originTier: browserOriginTierSchema,
  status: browserSessionStatusSchema,
  createdAt: z.number(),
  lastActivityAt: z.number(),
  title: z.string().nullable(),
});
export type BrowserSessionInfo = z.infer<typeof browserSessionInfoSchema>;

export const browserVisibleTileDataLevelSchema = z.enum([
  "console-entry",
  "network-request",
  "screenshot",
  "element",
  "debug-errors",
  "debug-snapshot",
  "control",
]);
export type BrowserVisibleTileDataLevel = z.infer<
  typeof browserVisibleTileDataLevelSchema
>;

const browserVisibleTileGrantSchemaV11 = z.object({
  chatId: z.string(),
  tileInstanceId: z.string(),
  origin: z.string(),
  dataLevel: browserVisibleTileDataLevelSchema,
  expiresAt: z.number(),
});

export const browserVisibleTileGrantSchema = browserVisibleTileGrantSchemaV11
  .extend({
    grantId: z.string(),
  })
  .strict();
export type BrowserVisibleTileGrant = z.infer<
  typeof browserVisibleTileGrantSchema
>;

export const browserVisibleTileActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("click"),
    selector: z.string().min(1),
  }),
  z.object({
    kind: z.literal("type"),
    selector: z.string().min(1),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("scroll"),
    deltaX: z.number(),
    deltaY: z.number(),
  }),
  z.object({
    kind: z.literal("navigate"),
    url: z.string().min(1),
  }),
]);
export type BrowserVisibleTileAction = z.infer<
  typeof browserVisibleTileActionSchema
>;

export const browserSessionsOpenRequestSchema = z.object({
  chatId: z.string(),
});
export type BrowserSessionsOpenRequest = z.infer<
  typeof browserSessionsOpenRequestSchema
>;

const browserSessionsServerFrameSchemaV10 = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("snapshot"),
    ...textFrameFields,
    sessions: z.array(browserSessionInfoSchema),
  }),
  z.object({
    kind: z.literal("sessionCreated"),
    ...textFrameFields,
    session: browserSessionInfoSchema,
  }),
  z.object({
    kind: z.literal("sessionUpdated"),
    ...textFrameFields,
    session: browserSessionInfoSchema,
  }),
  z.object({
    kind: z.literal("sessionClosed"),
    ...textFrameFields,
    ...browserSessionReferenceFields,
    reason: browserSessionClosedReasonSchema,
  }),
  z.object({
    kind: z.literal("provisionProgress"),
    ...textFrameFields,
    phase: z.string(),
    bytesDownloaded: z.number().int().nonnegative(),
    bytesTotal: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("promoteState"),
    ...requestFrameFields,
    url: z.string(),
    // Opaque JSON blob (Playwright storageState). The protocol intentionally
    // does not structurally type this payload: tightening the field schema in a
    // later minor would be breaking, and streams cannot bump majors. The host
    // and GUI validate it at their own boundaries.
    storageState: z.json(),
  }),
  z.object({
    kind: z.literal("lendResult"),
    ...requestFrameFields,
    ok: z.boolean(),
    reason: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("actionAck"),
    ...requestFrameFields,
    ok: z.boolean(),
    reason: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("pong"),
    ...textFrameFields,
  }),
]);

const browserSessionsServerFrameSchemaV11 = z.discriminatedUnion("kind", [
  ...browserSessionsServerFrameSchemaV10.def.options,
  z.object({
    kind: z.literal("visibleTileControlRequest"),
    ...requestFrameFields,
    chatId: z.string(),
    agentRunId: z.string().nullable(),
    agentLabel: z.string(),
    tileInstanceId: z.string(),
    origin: z.string(),
    url: z.string().nullable(),
    requestedAt: z.number(),
    expiresAt: z.number(),
  }),
  z.object({
    kind: z.literal("visibleTileControlResult"),
    ...requestFrameFields,
    ok: z.boolean(),
    reason: z.string().nullable(),
    grant: browserVisibleTileGrantSchemaV11.nullable(),
  }),
]);

const browserSessionsServerFrameSchemaV12 = z.discriminatedUnion("kind", [
  ...browserSessionsServerFrameSchemaV10.def.options,
  z.object({
    kind: z.literal("visibleTileControlRequest"),
    ...requestFrameFields,
    grantId: z.string(),
    chatId: z.string(),
    agentRunId: z.string().nullable(),
    agentLabel: z.string(),
    tileInstanceId: z.string(),
    origin: z.string(),
    url: z.string().nullable(),
    requestedAt: z.number(),
    expiresAt: z.number(),
  }),
  z.object({
    kind: z.literal("visibleTileControlResult"),
    ...requestFrameFields,
    tileInstanceId: z.string(),
    ok: z.boolean(),
    reason: z.string().nullable(),
    grant: browserVisibleTileGrantSchema.nullable(),
  }),
  z.object({
    kind: z.literal("visibleTileControlAction"),
    ...requestFrameFields,
    grantId: z.string(),
    tileInstanceId: z.string(),
    action: browserVisibleTileActionSchema,
    requestedAt: z.number(),
  }),
]);

/**
 * Ticket 03 - typed CDP bridge for the agent's own tile (`browser.sessions@1.3`).
 *
 * The host cannot reach an Electron tile's CDP debugger directly (it's an
 * electron-main-only API), so this bridge crosses host -> renderer -> IPC ->
 * `webContents.debugger`. A single frame shaped like `method: string, params:
 * object` would collapse to an opaque blob under `flattenToFieldMap` (see
 * `versioned-stream-rpc.ts`): it only diffs fields at the TOP LEVEL of each
 * sub-schema. A *nested* discriminated union (e.g. `action:
 * browserVisibleTileActionSchema` above) fares no better, just differently -
 * the whole nested union serializes into ONE key's value, so growing it is
 * classified as a breaking `schema-changed` rather than an additive key
 * addition. It doesn't slip through undetected; it hard-fails the additivity
 * check outright, which makes it just as unusable for a method set expected
 * to keep growing. So every enumerated CDP method gets its own top-level
 * frame kind, request and result, rather than one dispatch frame carrying a
 * method name plus opaque (or nested-union) params - that is the only shape
 * this framework can grow additively.
 *
 * This is a versioning artifact for the agent's own credential-free browser,
 * not a security boundary - no policy is enforced through this bridge, and it
 * must not be generalized into one for arbitrary CDP passthrough. The method
 * set is deliberately bounded to what the curated agent-browser API needs
 * today:
 *
 * - `cdpNavigate` / `cdpCaptureScreenshot` / `cdpGetFrameTree` - the agent
 *   tile's own navigation, screenshot and frame-tree primitives (`Page.*`).
 * - `cdpEvaluate` / `cdpCallFunctionOn` / `cdpReleaseObject` - script
 *   execution against the tile's main world (`Runtime.*`).
 * - `cdpDispatchMouseEvent` / `cdpInsertText` / `cdpDispatchKeyEvent` -
 *   synthetic interaction (`Input.*`).
 * - `cdpSetDeviceMetricsOverride` - viewport control (`Emulation.*`).
 * - `cdpSetAutoAttach` (request/result) / `cdpTargetAttached` (push
 *   notification) - session discovery (`Target.*`). Unlike everything else
 *   excluded below, this one is not deferred: the snapshot-serializer spike
 *   already established that Electron OOPIF composition works specifically
 *   via flattened `Target.setAutoAttach` plus `Target.attachedToTarget`
 *   session routing, so ticket 05's cross-origin frame composition cannot
 *   work on the GUI runtime without it. Including it presupposes nothing.
 * - `cdpDescribeNode` (`DOM.*`) - also not deferred, also spike-settled: per
 *   `snapshot-serializer-spike/index.md`, mapping a parent iframe *element*
 *   to its child frame's id is identical on both runtimes -
 *   `DOM.describeNode({objectId})` on the parent session, reading
 *   `node.frameId` off the result. `Target.*` alone gives session routing;
 *   this is what gives the `frameId` to route to. Deliberately narrow: only
 *   the `objectId`-addressed form is exposed (matching how every other
 *   method here resolves elements via a `Runtime.evaluate`/`callFunctionOn`
 *   remote object, never `DOM.getDocument`/`querySelector`'s own node-id
 *   space) - this does not reopen raw DOM-domain traversal.
 *
 * Deliberately excluded, with the reason each belongs to a later ticket:
 *
 * - Cookie/storage methods (`Network.setCookie` etc.) - the agent's own tile
 *   is fresh-partition and credential-free by design (ticket 02); storage
 *   lending is a borrowed-tile concept (ticket 09), not this bridge's.
 * - `Page.createIsolatedWorld` - ticket 06 explicitly leaves "where the
 *   runner page lives" unresolved and load-bearing; adding a typed frame for
 *   it now would presuppose that answer.
 * - Console/network event forwarding, downloads, dialogs, PDF - these are
 *   either push-notification shaped (a different frame family; see the
 *   snapshot/provenance envelope in ticket 05) or explicitly left for ticket
 *   04's cross-runtime parity investigation to resolve first.
 * - A raw-CDP passthrough - the enumerated set above already covers
 *   everything the curated API needs; if a genuine need for one appears
 *   later, it must be added as an explicitly-named escape hatch marked
 *   outside this frame-diffing discipline, not folded into it.
 */
export const browserCdpErrorSchema = z.object({
  kind: z.enum(["not_attached", "tile_not_found", "cdp_error"]),
  message: z.string(),
  code: z.number().nullable(),
});
export type BrowserCdpError = z.infer<typeof browserCdpErrorSchema>;

export const browserCdpFrameInfoSchema = z.object({
  frameId: z.string(),
  parentFrameId: z.string().nullable(),
  url: z.string(),
  securityOrigin: z.string().nullable(),
});
export type BrowserCdpFrameInfo = z.infer<typeof browserCdpFrameInfoSchema>;

const cdpRequestFrameFields = {
  ...requestFrameFields,
  tileInstanceId: z.string(),
  // Targets a specific Electron flattened CDP session (an attached OOPIF or
  // worker session). `null` means the tile's own root session.
  sessionId: z.string().nullable(),
} as const;

const cdpResultFrameFields = {
  ...requestFrameFields,
  tileInstanceId: z.string(),
  ok: z.boolean(),
  error: browserCdpErrorSchema.nullable(),
} as const;

const browserSessionsServerFrameSchemaV13 = z.discriminatedUnion("kind", [
  ...browserSessionsServerFrameSchemaV12.def.options,
  z.object({
    kind: z.literal("cdpNavigate"),
    ...cdpRequestFrameFields,
    url: z.string().min(1),
  }),
  z.object({
    kind: z.literal("cdpCaptureScreenshot"),
    ...cdpRequestFrameFields,
    format: z.enum(["png", "jpeg"]),
    quality: z.number().int().min(0).max(100).nullable(),
  }),
  z.object({
    kind: z.literal("cdpGetFrameTree"),
    ...cdpRequestFrameFields,
  }),
  // Spike step 2: an isolated world INSIDE the observed page (e.g.
  // `__aside_utility`), distinct from - and unrelated to - wherever ticket
  // 06 ultimately puts the cell-runner's own blank page. This is needed
  // regardless of that unresolved decision.
  z.object({
    kind: z.literal("cdpCreateIsolatedWorld"),
    ...cdpRequestFrameFields,
    frameId: z.string(),
    worldName: z.string(),
    grantUniversalAccess: z.boolean(),
  }),
  z.object({
    kind: z.literal("cdpEvaluate"),
    ...cdpRequestFrameFields,
    expression: z.string(),
    awaitPromise: z.boolean(),
    returnByValue: z.boolean(),
    // Targets the isolated world from `cdpCreateIsolatedWorld`; null
    // evaluates in the page's main world (CDP's own default when omitted).
    contextId: z.number().int().nullable(),
  }),
  z.object({
    kind: z.literal("cdpCallFunctionOn"),
    ...cdpRequestFrameFields,
    // CDP's `Runtime.callFunctionOn` addresses either a bound object
    // (`objectId`) or a free-standing execution context
    // (`executionContextId`) - exactly one of these two must be non-null.
    // The free-standing form is what step 4 needs: calling
    // `globalThis.__aside.takeSnapshot` isn't bound to any particular
    // object, it's a global function inside the isolated world.
    objectId: z.string().nullable(),
    executionContextId: z.number().int().nullable(),
    functionDeclaration: z.string(),
    // Opaque JSON blob (CDP `CallArgument[]`). Same rationale as
    // `promoteState.storageState` above: structurally typing every possible
    // CDP call argument would be breaking to tighten later, and the host and
    // renderer both validate at their own boundaries.
    argumentsJson: z.json().nullable(),
    returnByValue: z.boolean(),
  }),
  z.object({
    kind: z.literal("cdpReleaseObject"),
    ...cdpRequestFrameFields,
    objectId: z.string(),
  }),
  z.object({
    kind: z.literal("cdpDispatchMouseEvent"),
    ...cdpRequestFrameFields,
    type: z.enum([
      "mousePressed",
      "mouseReleased",
      "mouseMoved",
      "mouseWheel",
    ]),
    x: z.number(),
    y: z.number(),
    button: z.enum(["left", "right", "middle", "none"]).nullable(),
    clickCount: z.number().int().nonnegative().nullable(),
    deltaX: z.number().nullable(),
    deltaY: z.number().nullable(),
  }),
  z.object({
    kind: z.literal("cdpInsertText"),
    ...cdpRequestFrameFields,
    text: z.string(),
  }),
  z.object({
    kind: z.literal("cdpDispatchKeyEvent"),
    ...cdpRequestFrameFields,
    type: z.enum(["keyDown", "keyUp", "rawKeyDown", "char"]),
    key: z.string().nullable(),
    code: z.string().nullable(),
    text: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("cdpSetDeviceMetricsOverride"),
    ...cdpRequestFrameFields,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    deviceScaleFactor: z.number().positive(),
    mobile: z.boolean(),
  }),
  // Session discovery for OOPIF/worker composition (ticket 04, per the
  // snapshot-serializer spike): `enableAfterCommit` already issues this
  // automatically for the root session on attach, so this exists for
  // explicit host-issued control - most concretely, re-arming auto-attach on
  // a child session so grandchild targets (nested OOPIFs) also flatten in,
  // which `handleTargetAttached`'s per-child enable of Runtime/Log/Network
  // does not itself do.
  z.object({
    kind: z.literal("cdpSetAutoAttach"),
    ...cdpRequestFrameFields,
    autoAttach: z.boolean(),
    waitForDebuggerOnStart: z.boolean(),
  }),
  z.object({
    kind: z.literal("cdpDescribeNode"),
    ...cdpRequestFrameFields,
    objectId: z.string(),
    // null omits CDP's `depth` param entirely (its own default is 1, i.e.
    // immediate children only); the frame-composition use case only reads
    // `frameId` off the root description, so callers rarely need more.
    depth: z.number().int().nullable(),
    pierce: z.boolean(),
  }),
  // Spike step 7 (ground truth for our own byte-identical-output comparison
  // tests, e.g. ticket 05's cross-runtime parity assertions) - not part of
  // the production snapshot path itself.
  z.object({
    kind: z.literal("cdpGetFullAXTree"),
    ...cdpRequestFrameFields,
    depth: z.number().int().nullable(),
  }),
]);

/**
 * Ticket 09 - borrowed-tile attachment (`browser.sessions@1.4`).
 *
 * A borrowed tile is one the USER already had open, in
 * `persist:traycer-browser` with their real logins, that they asked the agent
 * in chat to drive. The chat request IS the consent (v3): there is no
 * confirmation frame here and no grant handshake, deliberately - contrast
 * `visibleTileControlRequest` above, which is T18's older ask-then-grant
 * shape for the same tiles.
 *
 * These two frames carry only the ATTACHMENT LIFETIME. The driving itself
 * reuses the `cdp*` frames above unchanged, which is what "capability parity
 * with the agent's own tile" means concretely: a borrowed tile gets the same
 * fourteen curated methods, including `cdpEvaluate`, over the same transport.
 *
 * What the attachment frames add is the part borrowed tiles need and the
 * agent's own tile does not:
 *
 * - `borrowedTileAttached` tells the renderer which tile is being driven,
 *   by whom, and until when. The renderer needs all three: it registers that
 *   tile's CDP handler ONLY while an attachment is live, and it renders the
 *   passive indicator (our deliberate divergence from Aside, which marks
 *   borrowed tabs not at all) carrying the detach affordance.
 * - `borrowedTileDetached` ends it - on user detach, on expiry, or on host
 *   teardown. The renderer unregisters, agent access ends, indicator goes.
 *
 * There is deliberately NO frame that lists or enumerates tiles. A `tiles`
 * namespace would leak the existence, count and origins of tiles the user
 * never named, which is exactly the widening this ticket must not do: the
 * agent reaches the tile the user named and nothing else.
 *
 * KNOWN GAP, pre-existing and deliberately not addressed here: this stream
 * performs no per-minor frame projection - `browser-stream-resolver.ts`
 * always emits the newest server frames and always parses the newest client
 * schema - so a subscriber negotiated below 1.4 would receive `kind` values
 * its own schema has never heard of, which a zod `discriminatedUnion`
 * rejects outright rather than ignoring as an unknown extra field. That is
 * inherited from every browser minor since 1.1, not introduced by these
 * frames; registry-level schema additivity makes projection possible but is
 * not a substitute for it. Tracked separately, with its own owner.
 */
export const browserSessionsServerFrameSchema = z.discriminatedUnion("kind", [
  ...browserSessionsServerFrameSchemaV13.def.options,
  z.object({
    // Push notification, same shape rules as `cdpSessionEnded` above: a
    // fresh `requestId` per push for envelope consistency, not correlation.
    kind: z.literal("borrowedTileAttached"),
    ...requestFrameFields,
    tileInstanceId: z.string(),
    attachmentId: z.string(),
    chatId: z.string(),
    agentRunId: z.string().nullable(),
    agentLabel: z.string(),
    attachedAt: z.number(),
    // Absolute, host-computed, and never extended in place - an attachment
    // is time-limited by construction (v3: "time-limited and does not
    // silently persist"). The renderer holds it so the indicator can end the
    // attachment on its own clock rather than trusting a frame to arrive.
    expiresAt: z.number(),
  }),
  z.object({
    kind: z.literal("borrowedTileDetached"),
    ...requestFrameFields,
    tileInstanceId: z.string(),
    attachmentId: z.string(),
    reason: z.string(),
  }),
]);
export type BrowserSessionsServerFrame = z.infer<
  typeof browserSessionsServerFrameSchema
>;

const browserSessionsClientFrameSchemaV10 = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("getPromoteState"),
    ...requestFrameFields,
    ...browserSessionReferenceFields,
  }),
  z.object({
    kind: z.literal("lendStorage"),
    ...requestFrameFields,
    ...browserSessionReferenceFields,
    origin: z.string(),
    // Opaque JSON blob (Playwright storageState). The protocol intentionally
    // does not structurally type this payload: tightening the field schema in a
    // later minor would be breaking, and streams cannot bump majors. The host
    // and GUI validate it at their own boundaries.
    storage: z.json(),
  }),
  z.object({
    kind: z.literal("closeSession"),
    ...requestFrameFields,
    ...browserSessionReferenceFields,
  }),
  z.object({
    kind: z.literal("ping"),
    ...textFrameFields,
  }),
]);

const browserSessionsClientFrameSchemaV11 = z.discriminatedUnion("kind", [
  ...browserSessionsClientFrameSchemaV10.def.options,
  z.object({
    kind: z.literal("visibleTileControlDecision"),
    ...requestFrameFields,
    approved: z.boolean(),
    grant: browserVisibleTileGrantSchemaV11.nullable(),
    reason: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("visibleTileControlRevoked"),
    ...requestFrameFields,
    tileInstanceId: z.string(),
    reason: z.string(),
  }),
]);

const browserSessionsClientFrameSchemaV12 = z.discriminatedUnion("kind", [
  ...browserSessionsClientFrameSchemaV10.def.options,
  z.object({
    kind: z.literal("visibleTileControlDecision"),
    ...requestFrameFields,
    approved: z.boolean(),
    grant: browserVisibleTileGrantSchema.nullable(),
    reason: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("visibleTileControlRevoked"),
    ...requestFrameFields,
    grantId: z.string(),
    tileInstanceId: z.string(),
    reason: z.string(),
  }),
  z.object({
    kind: z.literal("visibleTileControlActionResult"),
    ...requestFrameFields,
    grantId: z.string(),
    ok: z.boolean(),
    reason: z.string().nullable(),
    value: z.unknown().nullable(),
  }),
]);

const browserSessionsClientFrameSchemaV13 = z.discriminatedUnion("kind", [
  ...browserSessionsClientFrameSchemaV12.def.options,
  z.object({
    kind: z.literal("cdpNavigateResult"),
    ...cdpResultFrameFields,
    frameId: z.string().nullable(),
    loaderId: z.string().nullable(),
    errorText: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("cdpCaptureScreenshotResult"),
    ...cdpResultFrameFields,
    dataBase64: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("cdpGetFrameTreeResult"),
    ...cdpResultFrameFields,
    frames: z.array(browserCdpFrameInfoSchema).nullable(),
  }),
  z.object({
    kind: z.literal("cdpEvaluateResult"),
    ...cdpResultFrameFields,
    // Opaque JSON blob (CDP `RemoteObject`). Modeling every possible remote
    // value/preview/error shape would be breaking to tighten later; the host
    // interprets it at its own boundary (ticket 04's typed error taxonomy
    // layers on top of this, it does not live in the wire frame).
    resultJson: z.json().nullable(),
    objectId: z.string().nullable(),
    exceptionDescription: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("cdpCallFunctionOnResult"),
    ...cdpResultFrameFields,
    resultJson: z.json().nullable(),
    objectId: z.string().nullable(),
    exceptionDescription: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("cdpReleaseObjectResult"),
    ...cdpResultFrameFields,
  }),
  z.object({
    kind: z.literal("cdpDispatchMouseEventResult"),
    ...cdpResultFrameFields,
  }),
  z.object({
    kind: z.literal("cdpInsertTextResult"),
    ...cdpResultFrameFields,
  }),
  z.object({
    kind: z.literal("cdpDispatchKeyEventResult"),
    ...cdpResultFrameFields,
  }),
  z.object({
    kind: z.literal("cdpSetDeviceMetricsOverrideResult"),
    ...cdpResultFrameFields,
  }),
  z.object({
    // Electron detaches the tile's debugger when the user opens DevTools (or
    // any other detach cause). The renderer pushes this the moment
    // `onDetached` fires so the host ends the agent's access immediately
    // instead of only discovering it lazily on the next failed dispatch.
    kind: z.literal("cdpSessionEnded"),
    ...requestFrameFields,
    tileInstanceId: z.string(),
    reason: z.string(),
  }),
  z.object({
    kind: z.literal("cdpSetAutoAttachResult"),
    ...cdpResultFrameFields,
  }),
  z.object({
    // Push notification, not a response to a specific request - mirrors
    // `cdpSessionEnded`'s shape (a fresh `requestId` per push, for envelope
    // consistency only, not request/response correlation). Fired whenever
    // CDP's own `Target.attachedToTarget` fires on the tile's root session,
    // so the host can discover a flattened child (OOPIF/worker) session id
    // to address further dispatches at - this bridge's existing per-command
    // `sessionId` field already carries them once known.
    kind: z.literal("cdpTargetAttached"),
    ...requestFrameFields,
    tileInstanceId: z.string(),
    sessionId: z.string(),
    targetId: z.string(),
    targetType: z.string(),
    url: z.string(),
    waitingForDebugger: z.boolean(),
  }),
  z.object({
    kind: z.literal("cdpDescribeNodeResult"),
    ...cdpResultFrameFields,
    nodeId: z.number().int().nullable(),
    backendNodeId: z.number().int().nullable(),
    nodeName: z.string().nullable(),
    // The field this method exists for: the child frame this node owns, if
    // any (only populated for frame-owner elements like iframe/frame/object).
    frameId: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("cdpCreateIsolatedWorldResult"),
    ...cdpResultFrameFields,
    executionContextId: z.number().int().nullable(),
  }),
  z.object({
    kind: z.literal("cdpGetFullAXTreeResult"),
    ...cdpResultFrameFields,
    // Opaque JSON blob (CDP `AXNode[]`) - ground truth for test comparison
    // only. Modeling the full recursive AXNode shape would be premature
    // specification for a value nothing else consumes structurally.
    nodesJson: z.json().nullable(),
  }),
]);

export const browserSessionsClientFrameSchema = z.discriminatedUnion("kind", [
  ...browserSessionsClientFrameSchemaV13.def.options,
  z.object({
    // Ticket 09. The renderer has ENDED a borrowed-tile attachment - the user
    // pressed detach on the passive indicator, or the tile's debugger
    // detached out from under it (`reason` says which).
    //
    // Named in the past tense on purpose: this REPORTS a release that has
    // already happened, it does not ask for one. The host has no refusal path
    // here and must not grow one - detach is the mechanism the borrowed-tile
    // design's safety rests on, and a refusable detach is not a detach. Same
    // shape as `visibleTileControlRevoked` above, which is also a report.
    // (`...requestFrameFields` is a transport convention on every client
    // frame in this contract; it carries `requestId` for envelope
    // consistency and implies nothing about request/response semantics.)
    //
    // The renderer stops answering dispatches for the tile BEFORE sending
    // this, and the host refuses every later dispatch for it on receipt, so
    // a frame that is delayed, dropped, or never sent cannot leave the agent
    // driving a tile the user has released.
    kind: z.literal("borrowedTileReleased"),
    ...requestFrameFields,
    tileInstanceId: z.string(),
    attachmentId: z.string(),
    reason: z.string(),
  }),
]);
export type BrowserSessionsClientFrame = z.infer<
  typeof browserSessionsClientFrameSchema
>;

export const browserSessionsV14 = defineStreamRpcContract({
  method: "browser.sessions",
  schemaVersion: { major: 1, minor: 4 } as const,
  openRequestSchema: browserSessionsOpenRequestSchema,
  serverFrameSchema: browserSessionsServerFrameSchema,
  clientFrameSchema: browserSessionsClientFrameSchema,
});

export const browserSessionsV13 = defineStreamRpcContract({
  method: "browser.sessions",
  schemaVersion: { major: 1, minor: 3 } as const,
  openRequestSchema: browserSessionsOpenRequestSchema,
  serverFrameSchema: browserSessionsServerFrameSchemaV13,
  clientFrameSchema: browserSessionsClientFrameSchemaV13,
});

export const browserSessionsV12 = defineStreamRpcContract({
  method: "browser.sessions",
  schemaVersion: { major: 1, minor: 2 } as const,
  openRequestSchema: browserSessionsOpenRequestSchema,
  serverFrameSchema: browserSessionsServerFrameSchemaV12,
  clientFrameSchema: browserSessionsClientFrameSchemaV12,
});

export const browserSessionsV11 = defineStreamRpcContract({
  method: "browser.sessions",
  schemaVersion: { major: 1, minor: 1 } as const,
  openRequestSchema: browserSessionsOpenRequestSchema,
  serverFrameSchema: browserSessionsServerFrameSchemaV11,
  clientFrameSchema: browserSessionsClientFrameSchemaV11,
});

export const browserSessionsV10 = defineStreamRpcContract({
  method: "browser.sessions",
  schemaVersion: { major: 1, minor: 0 } as const,
  openRequestSchema: browserSessionsOpenRequestSchema,
  serverFrameSchema: browserSessionsServerFrameSchemaV10,
  clientFrameSchema: browserSessionsClientFrameSchemaV10,
});

export const browserScreencastFormatSchema = z.enum(["jpeg"]);
export type BrowserScreencastFormat = z.infer<
  typeof browserScreencastFormatSchema
>;

export const browserScreencastOpenRequestSchema = z.object({
  sessionId: z.string(),
  maxWidth: z.number().int().positive(),
  maxHeight: z.number().int().positive(),
  quality: z.number().int().min(0).max(100),
  format: browserScreencastFormatSchema,
});
export type BrowserScreencastOpenRequest = z.infer<
  typeof browserScreencastOpenRequestSchema
>;

export const browserScreencastMetadataSchema = z.object({
  offsetTop: z.number(),
  pageScaleFactor: z.number(),
  deviceWidth: z.number(),
  deviceHeight: z.number(),
  scrollOffsetX: z.number(),
  scrollOffsetY: z.number(),
  timestamp: z.number(),
});
export type BrowserScreencastMetadata = z.infer<
  typeof browserScreencastMetadataSchema
>;

export const browserScreencastServerFrameSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("started"),
    ...textFrameFields,
    frameWidth: z.number().int().positive(),
    frameHeight: z.number().int().positive(),
    deviceScaleFactor: z.number().positive(),
  }),
  z.object({
    kind: z.literal("frame"),
    ...binaryFrameFields,
    sequence: z.number().int().nonnegative(),
    metadata: browserScreencastMetadataSchema,
  }),
  z.object({
    kind: z.literal("stalled"),
    ...textFrameFields,
  }),
  z.object({
    kind: z.literal("resized"),
    ...textFrameFields,
    frameWidth: z.number().int().positive(),
    frameHeight: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("failed"),
    ...textFrameFields,
    reason: z.string(),
  }),
  z.object({
    kind: z.literal("complete"),
    ...textFrameFields,
  }),
  z.object({
    kind: z.literal("pong"),
    ...textFrameFields,
  }),
]);
export type BrowserScreencastServerFrame = z.infer<
  typeof browserScreencastServerFrameSchema
>;

export const browserScreencastClientFrameSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ack"),
    ...textFrameFields,
    sequence: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("setPaused"),
    ...textFrameFields,
    paused: z.boolean(),
  }),
  z.object({
    kind: z.literal("setParams"),
    ...textFrameFields,
    maxWidth: z.number().int().positive(),
    maxHeight: z.number().int().positive(),
    quality: z.number().int().min(0).max(100),
  }),
  z.object({
    kind: z.literal("ping"),
    ...textFrameFields,
  }),
]);
export type BrowserScreencastClientFrame = z.infer<
  typeof browserScreencastClientFrameSchema
>;

export const browserScreencastV10 = defineStreamRpcContract({
  method: "browser.screencast",
  schemaVersion: { major: 1, minor: 0 } as const,
  openRequestSchema: browserScreencastOpenRequestSchema,
  serverFrameSchema: browserScreencastServerFrameSchema,
  clientFrameSchema: browserScreencastClientFrameSchema,
});
