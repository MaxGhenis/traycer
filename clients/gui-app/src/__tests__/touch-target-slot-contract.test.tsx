import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ToolbarIconButton,
  ToolbarPillButton,
} from "@/components/home/toolbar/toolbar-buttons";
import { ThemeModeToggle } from "@/components/settings/controls/theme-mode-toggle";
import { ThemePresetPicker } from "@/components/settings/controls/theme-preset-picker";
import { FontPicker } from "@/components/settings/controls/font-picker";
import { TerminalCursorStylePicker } from "@/components/settings/controls/terminal-cursor-style-picker";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { PORTAL_ICON_BUTTON_HIT_SLOP } from "@/components/ui/coarse-pointer-hit-slop";
import { THEME_PRESETS } from "@/lib/theme-presets";

/**
 * The coarse-pointer hit area is a CONTRACT between three stylesheets and the
 * controls they cover, and nothing in either half names the other. Each
 * stylesheet grows a hit area with a descendant selector keyed on the shadcn
 * SLOT attribute, so a control is enlarged only if it is inside a scope AND
 * emits a slot the scope grants. Both halves type-check and render perfectly
 * while covering nothing, which is exactly how hand-rolled `<button>`s at
 * choke points came to paint 18-30px targets inside correct scopes.
 *
 * So the assertions here read the granted slot list OFF the stylesheets rather
 * than restating it, and require the primitives to emit a slot in it. A test
 * that pinned one component's class string would pass forever while the next
 * raw `<button>` regressed the same contract.
 *
 * Coverage is render-verified wherever a primitive renders standalone. Three
 * controls live inside surfaces too heavy to mount here (a feed row, the app
 * header, the landing surface); those are pinned against their source, which
 * proves the attribute is present without proving where it lands.
 */

/** Vitest's cwd is the gui-app root. */
function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

interface CssRule {
  readonly selector: string;
  readonly declarations: string;
  readonly slots: readonly string[];
}

/**
 * The innermost rules of a stylesheet, with comments stripped and selectors
 * whitespace-collapsed. Bodies never nest here, so the innermost-rule regex is
 * exact: at-rule preludes cannot match a body containing braces, and their own
 * closing brace is left unpaired.
 */
function parseRules(css: string): readonly CssRule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = pattern.exec(withoutComments);
  while (match !== null) {
    const selector = match[1].trim().replace(/\s+/g, " ");
    if (!selector.startsWith("@")) {
      rules.push({
        selector,
        declarations: match[2],
        slots: [...selector.matchAll(/\[data-slot="([^"]+)"\]/g)].map(
          (slot) => slot[1],
        ),
      });
    }
    match = pattern.exec(withoutComments);
  }
  return rules;
}

function sortedUnique(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort();
}

interface TouchScope {
  /** Human name used in test titles. */
  readonly name: string;
  readonly stylesheet: string;
  readonly scopeAttribute: string;
  /**
   * Whether the anchoring rule exempts `.absolute` controls. The three
   * stylesheets deliberately DIFFER here, so this is recorded per scope rather
   * than asserted uniformly - see the comment on the assertion below.
   */
  readonly exemptsAbsolute: boolean;
}

const TOUCH_SCOPES: readonly TouchScope[] = [
  {
    name: "settings",
    stylesheet: "src/components/settings/settings-touch-targets.css",
    scopeAttribute: "data-settings-touch-scope",
    exemptsAbsolute: false,
  },
  {
    name: "home",
    stylesheet: "src/components/home/home-touch-targets.css",
    scopeAttribute: "data-home-touch-scope",
    exemptsAbsolute: true,
  },
  {
    name: "mobile shell",
    stylesheet: "src/components/layout/shell/mobile-shell-touch-targets.css",
    scopeAttribute: "data-mobile-shell-touch-scope",
    exemptsAbsolute: true,
  },
];

/** Slots a scope grants hit-slop to, read off its stylesheet's `::after` rules. */
function grantedSlots(scope: TouchScope): readonly string[] {
  const slopRules = parseRules(readSource(scope.stylesheet)).filter((rule) =>
    rule.selector.includes("::after"),
  );
  return sortedUnique(slopRules.flatMap((rule) => rule.slots));
}

const GRANTED_BY_SCOPE = new Map(
  TOUCH_SCOPES.map((scope) => [scope.name, grantedSlots(scope)] as const),
);

function expectSlotIsGranted(element: Element, scopeName: string): void {
  const granted = GRANTED_BY_SCOPE.get(scopeName) ?? [];
  expect(granted.length).toBeGreaterThan(0);
  expect(granted).toContain(element.getAttribute("data-slot"));
}

afterEach(() => {
  cleanup();
});

describe("touch-target stylesheets", () => {
  it.each([...TOUCH_SCOPES])(
    "$name grants hit-slop to at least one slot, under its own scope attribute",
    (scope) => {
      const rules = parseRules(readSource(scope.stylesheet));

      expect(grantedSlots(scope).length).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(rule.selector).toContain(`[${scope.scopeAttribute}]`);
      }
    },
  );

  it.each([...TOUCH_SCOPES])(
    "$name anchors every slot it slops, and slops every slot it anchors",
    (scope) => {
      const rules = parseRules(readSource(scope.stylesheet));
      // The slop pseudo is `position: absolute`, so it resolves against the
      // nearest POSITIONED ancestor. A slot listed only in the `::after` rule
      // still gets a pseudo - one hung off whatever ancestor happens to be
      // positioned, silently placing the hit area somewhere other than on the
      // control. Nothing about that renders visibly, which is why it is
      // asserted here as a set equality rather than left to review.
      const anchored = sortedUnique(
        rules
          .filter((rule) => /position:\s*relative/.test(rule.declarations))
          .flatMap((rule) => rule.slots),
      );

      expect(anchored).toEqual(grantedSlots(scope));
    },
  );

  it.each([...TOUCH_SCOPES])(
    "$name sizes its slop to a literal 44px",
    (scope) => {
      const slopRules = parseRules(readSource(scope.stylesheet)).filter(
        (rule) => rule.selector.includes("::after"),
      );

      expect(slopRules.length).toBeGreaterThan(0);
      for (const rule of slopRules) {
        // Pixel-literal, never `min-h-11`: the root font is 15px, so the rem
        // idiom lands at 41.25px and leaves the control short of the target.
        expect(rule.declarations).toMatch(/max\(100%,\s*44px\)/);
      }
    },
  );

  it.each([...TOUCH_SCOPES])(
    "$name gates its rules on a coarse pointer",
    (scope) => {
      expect(readSource(scope.stylesheet)).toContain(
        "@media (pointer: coarse)",
      );
    },
  );

  it("exempts absolutely positioned controls only where the scope says so", () => {
    // These files are NOT interchangeable, and a test that asserted they were
    // would be asserting a tidiness the app does not have. The two scopes that
    // contain `.absolute` controls (the epics-row delete button, the drawer's
    // built-in close) must skip the `position: relative` fallback, because this
    // CSS is unlayered and would otherwise beat Tailwind's layered `absolute`
    // utility and pull them back into flow. Settings has no such control, so it
    // carries no exemption - and adding one blindly would be cargo cult.
    for (const scope of TOUCH_SCOPES) {
      const anchoringRules = parseRules(readSource(scope.stylesheet)).filter(
        (rule) => /position:\s*relative/.test(rule.declarations),
      );

      expect(anchoringRules.length).toBeGreaterThan(0);
      for (const rule of anchoringRules) {
        expect(rule.selector.includes(":not(.absolute)")).toBe(
          scope.exemptsAbsolute,
        );
      }
    }
  });

  it("keeps the mobile shell's slop pseudo transparent", () => {
    // An element has one `::after`, so this rule MERGES with a control's own
    // (e.g. `ui/tabs`' line-variant indicator). Without the explicit
    // transparent background the control's fill survives the merge and paints
    // a full-cover box over its label.
    const slopRules = parseRules(
      readSource("src/components/layout/shell/mobile-shell-touch-targets.css"),
    ).filter((rule) => rule.selector.includes("::after"));

    expect(slopRules.length).toBeGreaterThan(0);
    for (const rule of slopRules) {
      expect(rule.declarations).toMatch(/background:\s*transparent/);
    }
  });
});

describe("controls inside a touch scope emit a granted slot", () => {
  it("composer toolbar icon buttons", () => {
    render(<ToolbarIconButton aria-label="Attach image" />);

    expectSlotIsGranted(
      screen.getByRole("button", { name: "Attach image" }),
      "home",
    );
  });

  it("composer toolbar pill buttons", () => {
    render(<ToolbarPillButton aria-label="Pick model" />);

    expectSlotIsGranted(
      screen.getByRole("button", { name: "Pick model" }),
      "home",
    );
  });

  it("every segment of the theme-mode toggle", () => {
    render(<ThemeModeToggle value="light" onChange={() => undefined} />);

    const segments = screen.getAllByRole("button");
    expect(segments).toHaveLength(3);
    for (const segment of segments) {
      expectSlotIsGranted(segment, "settings");
    }
  });

  it("every segment of the terminal cursor-style picker", () => {
    render(
      <TerminalCursorStylePicker value="block" onChange={() => undefined} />,
    );

    const segments = screen.getAllByRole("button");
    expect(segments).toHaveLength(3);
    for (const segment of segments) {
      expectSlotIsGranted(segment, "settings");
    }
  });

  it("the theme-preset picker trigger", () => {
    const preset = THEME_PRESETS[0];
    render(<ThemePresetPicker value={preset.id} onChange={() => undefined} />);

    expectSlotIsGranted(
      screen.getByRole("button", { name: new RegExp(preset.label) }),
      "settings",
    );
  });

  it("the font picker trigger", () => {
    render(
      <FontPicker
        value={null}
        onChange={() => undefined}
        options={[]}
        defaultLabel="System Default"
        resetTooltip="Reset"
        ariaLabel="Interface font"
      />,
    );

    expectSlotIsGranted(
      screen.getByRole("button", { name: "Interface font" }),
      "settings",
    );
  });
});

describe("controls whose surface is too heavy to mount", () => {
  // Source-pinned rather than rendered: each of these lives inside a surface
  // that needs a feed row, the router, or the landing composer to exist. The
  // assertion is narrowed to the enclosing control so it cannot pass on some
  // unrelated slot elsewhere in the file.
  const SOURCE_PINNED: ReadonlyArray<{
    readonly name: string;
    readonly file: string;
    readonly anchor: string;
    readonly scope: string;
  }> = [
    {
      name: "the notification mark-read control",
      file: "src/components/notifications/notification-row.tsx",
      anchor: "function NotificationRowControlButton",
      scope: "mobile shell",
    },
    {
      name: "the mobile header's settings crumb",
      file: "src/components/layout/header/mobile-app-header.tsx",
      anchor: 'data-testid="mobile-header-settings-crumb"',
      scope: "mobile shell",
    },
    {
      name: "the landing surface's View history entry",
      file: "src/components/home/landing-draft-surface.tsx",
      anchor: 'data-testid="home-view-history"',
      scope: "home",
    },
  ];

  it.each([...SOURCE_PINNED])("$name carries a granted slot", (control) => {
    const source = readSource(control.file);
    const anchorIndex = source.indexOf(control.anchor);
    expect(anchorIndex).toBeGreaterThanOrEqual(0);

    // The attribute must sit within the control's own element, not merely
    // somewhere in the file.
    const controlSource = source.slice(anchorIndex, anchorIndex + 900);
    const slot = /data-slot="([^"]+)"/.exec(controlSource);
    expect(slot).not.toBeNull();
    expect(GRANTED_BY_SCOPE.get(control.scope) ?? []).toContain(slot?.[1]);
  });
});

describe("controls that render inside a portal", () => {
  // A portal is reparented to the document body, so no ancestor of it carries
  // a scope attribute and the descendant rules above can never reach it. Such
  // a control owns its target at the primitive instead.
  it("gates the portal slop on a coarse pointer and keeps it off ::after", () => {
    expect(PORTAL_ICON_BUTTON_HIT_SLOP).toContain("pointer-coarse:");
    expect(PORTAL_ICON_BUTTON_HIT_SLOP).not.toContain("after:");
    // The scope stylesheets claim `::after`, and a portalled surface may still
    // set a scope attribute on its own content, so the two can meet on one
    // element. `::before` is the half that cannot collide.
    expect(PORTAL_ICON_BUTTON_HIT_SLOP).toContain("before:");
  });

  it("gives the dialog close button its own hit area", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    const close = screen.getByRole("button", { name: "Close" });
    for (const token of PORTAL_ICON_BUTTON_HIT_SLOP.split(" ")) {
      expect(close.className).toContain(token);
    }
  });

  it("gives the sheet close button its own hit area", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Sheet</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    const close = screen.getByRole("button", { name: "Close" });
    for (const token of PORTAL_ICON_BUTTON_HIT_SLOP.split(" ")) {
      expect(close.className).toContain(token);
    }
  });

  it("sizes flush-stacked portal rows instead of slopping them", () => {
    // Filter options stack with no gap, so invisible slop would overlap the
    // neighbouring option. They grow the row itself, the way `ui/select.tsx`
    // and `ui/dropdown-menu.tsx` size their own portalled rows.
    const source = readSource("src/components/epics/epics-filter-popover.tsx");

    expect(source).toContain("pointer-coarse:min-h-11");
  });
});
