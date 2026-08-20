import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ImportedChatMarkerSegment } from "@/components/chat/segments/imported-chat-marker-segment";
import { formatAbsoluteDateTime } from "@/lib/relative-time";

describe("<ImportedChatMarkerSegment />", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the Claude Code provenance line with a formatted absolute date", () => {
    const importedAt = 1700000000000;
    render(
      <ImportedChatMarkerSegment
        sourceProvider="claude"
        importedAt={importedAt}
        sourceCwd="/repo/work"
      />,
    );

    expect(
      screen.getByText(
        `Imported from Claude Code · ${formatAbsoluteDateTime(importedAt)}`,
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("imported-chat-marker")).toBeTruthy();
  });

  it("renders the Codex provenance line with a formatted absolute date", () => {
    const importedAt = 1650000000000;
    render(
      <ImportedChatMarkerSegment
        sourceProvider="codex"
        importedAt={importedAt}
        sourceCwd="/repo/other"
      />,
    );

    expect(
      screen.getByText(
        `Imported from Codex · ${formatAbsoluteDateTime(importedAt)}`,
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("imported-chat-marker")).toBeTruthy();
  });
});
