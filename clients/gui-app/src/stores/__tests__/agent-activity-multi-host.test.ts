import { afterEach, describe, expect, it } from "vitest";
import {
  __resetAgentActivityStoreForTests,
  __setHostAgentActivityStateForTests,
  getEpicAgentActivity,
  useAgentActivityStore,
} from "@/stores/agent-activity-store";

/**
 * `s5-parity-gaps` gap 1.
 *
 * The store held ONE flat `byEpic` map fed by ONE stream that production
 * pinned to the local host, and every state frame is a full replacement. So a
 * remote host's activity on a cloud-homed epic could not be represented at
 * all: there was nowhere to put it, and a second stream would have erased the
 * first. Every case below would have been INEXPRESSIBLE before the host
 * dimension - which is precisely why the gap survived a "B7 closed" grade.
 */

const LOCAL_HOST = "host-local";
const REMOTE_HOST = "host-remote";
const CLOUD_EPIC = "cloud-homed-epic";

afterEach(() => {
  __resetAgentActivityStoreForTests();
});

describe("agent activity across hosts", () => {
  it("reflects a REMOTE host's agents on a cloud-homed epic", () => {
    __setHostAgentActivityStateForTests(
      REMOTE_HOST,
      { [CLOUD_EPIC]: { working: ["remote-agent"], turn: ["remote-agent"] } },
      "local",
    );

    const activity = getEpicAgentActivity(CLOUD_EPIC);
    expect([...activity.working]).toEqual(["remote-agent"]);
    expect([...activity.turn]).toEqual(["remote-agent"]);
  });

  it("unions two hosts working the same epic instead of the last frame winning", () => {
    __setHostAgentActivityStateForTests(
      LOCAL_HOST,
      { [CLOUD_EPIC]: { working: ["local-agent"], turn: [] } },
      "local",
    );
    __setHostAgentActivityStateForTests(
      REMOTE_HOST,
      { [CLOUD_EPIC]: { working: ["remote-agent"], turn: ["remote-agent"] } },
      "local",
    );

    const activity = getEpicAgentActivity(CLOUD_EPIC);
    // Pre-fix, the second full-replacement frame overwrote the first and the
    // local agent disappeared - the store could only ever describe one host.
    expect([...activity.working].sort()).toEqual([
      "local-agent",
      "remote-agent",
    ]);
    expect([...activity.turn]).toEqual(["remote-agent"]);
  });

  it("scopes a host's disconnect wipe to that host", () => {
    __setHostAgentActivityStateForTests(
      LOCAL_HOST,
      { [CLOUD_EPIC]: { working: ["local-agent"], turn: [] } },
      "local",
    );
    __setHostAgentActivityStateForTests(
      REMOTE_HOST,
      { [CLOUD_EPIC]: { working: ["remote-agent"], turn: [] } },
      "local",
    );

    useAgentActivityStore.getState().resetHost(REMOTE_HOST);

    // One host going away must not erase another's live agents - the mirror
    // image of the defect, and the failure mode a flat map would have had the
    // moment a second stream existed.
    expect([...getEpicAgentActivity(CLOUD_EPIC).working]).toEqual([
      "local-agent",
    ]);
  });

  it("keeps bucket identity for the single-host case", () => {
    __setHostAgentActivityStateForTests(
      LOCAL_HOST,
      { [CLOUD_EPIC]: { working: ["local-agent"], turn: [] } },
      "local",
    );
    const first = getEpicAgentActivity(CLOUD_EPIC);
    const second = getEpicAgentActivity(CLOUD_EPIC);
    // The union must not allocate on every read, or every activity consumer
    // re-renders on any unrelated store write.
    expect(second).toBe(first);
  });
});
