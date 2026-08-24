import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SwitcherRowLabel } from "@/components/epic-canvas/mobile/switcher-row-label";
import { splitRowLabel } from "@/components/epic-canvas/mobile/switcher-row-label-split";

/**
 * Middle truncation is a CSS outcome - the head is a flex child that truncates
 * when the track runs out - so jsdom cannot observe where the cut lands. What
 * IS testable, and what actually decides whether a deep row identifies its
 * agent, is which characters the component refuses to let the browser cut.
 */
afterEach(cleanup);

describe("splitRowLabel", () => {
  it("leaves a title short enough to fit whole unsplit", () => {
    // Nothing to protect: with no split there is one truncating span, exactly
    // as every row rendered before middle truncation existed.
    expect(splitRowLabel("Depth 4 Configuration")).toEqual({
      head: "Depth 4 Configuration",
      tail: "",
    });
  });

  it("protects the last word of a long title", () => {
    const { head, tail } = splitRowLabel(
      "Recursive Depth Configuration Verification and Indent Clamp Analysis",
    );
    expect(tail).toBe(" Analysis");
    expect(head).toBe(
      "Recursive Depth Configuration Verification and Indent Clamp",
    );
    expect(head + tail).toBe(
      "Recursive Depth Configuration Verification and Indent Clamp Analysis",
    );
  });

  it("keeps a sibling distinguishable from the parent it shares a stem with", () => {
    // The regression this exists for. A parent titled with the stem and a child
    // titled stem-plus-qualifier truncated to the same visible string, so the
    // child read as a shorter copy of the row directly above it.
    const parent = "Recursive Depth Configuration";
    const child = "Recursive Depth Configuration Verification";
    expect(splitRowLabel(child).tail).toBe(" Verification");
    expect(splitRowLabel(child).tail.trim()).not.toBe(parent);
  });

  it("falls back to the final characters of an unbroken token", () => {
    // No word boundary to cut on - an id, a hash, a versioned name. The end is
    // still where two of them differ.
    const { head, tail } = splitRowLabel(
      "agent-configuration-verification-0f3a91c",
    );
    expect(tail).toBe("fication-0f3a91c");
    expect(head + tail).toBe("agent-configuration-verification-0f3a91c");
  });

  it("does not split a title whose tail would leave no readable head", () => {
    // Ellipsis-plus-fragment identifies an agent no better than the tail alone
    // and reads worse, so such a label truncates from the end like any other.
    expect(splitRowLabel("Verification").tail).toBe("");
  });
});

describe("<SwitcherRowLabel />", () => {
  it("renders the whole title, so the row's accessible name is not truncated", () => {
    const label =
      "Recursive Depth Configuration Verification and Indent Clamp Analysis";
    const { container } = render(<SwitcherRowLabel label={label} />);
    expect(container.textContent).toBe(label);
  });

  it("makes only the head shrinkable, so the tail cannot be cut away", () => {
    render(
      <SwitcherRowLabel label="Recursive Depth Configuration Verification and Indent Clamp Analysis" />,
    );
    const head = screen.getByText(
      "Recursive Depth Configuration Verification and Indent Clamp",
    );
    const tail = screen.getByText("Analysis");
    // `truncate` on the head is what produces the ellipsis; `shrink-0` on the
    // tail is what keeps the distinguishing words on screen at any width.
    expect(head.className).toContain("truncate");
    expect(head.className).toContain("min-w-0");
    expect(tail.className).toContain("shrink-0");
    expect(tail.className).not.toContain("truncate");
  });

  it("renders a short title as one plain truncating span", () => {
    const { container } = render(<SwitcherRowLabel label="Alpha" />);
    const spans = container.querySelectorAll("span");
    expect(spans).toHaveLength(1);
    expect(spans[0].className).toContain("truncate");
  });
});
