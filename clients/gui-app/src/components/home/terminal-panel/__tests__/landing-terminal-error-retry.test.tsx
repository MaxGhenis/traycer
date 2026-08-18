import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LandingTerminalErrorState } from "@/components/home/terminal-panel/landing-terminal-tile";

describe("LandingTerminalErrorState retry pending UX", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the Retry label and disables the button with an inline spinner while pending", () => {
    const onRetry = vi.fn();
    render(
      <LandingTerminalErrorState
        message="Could not start terminal."
        isPending
        onRetry={onRetry}
      />,
    );

    screen.getByText("Could not start terminal.");
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).toHaveProperty("disabled", true);
    expect(
      retry.querySelector('[data-testid="landing-terminal-retry-pending"]'),
    ).not.toBeNull();
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("invokes retry when the request is not pending", () => {
    const onRetry = vi.fn();
    render(
      <LandingTerminalErrorState
        message="Could not start terminal."
        isPending={false}
        onRetry={onRetry}
      />,
    );

    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).toHaveProperty("disabled", false);
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
