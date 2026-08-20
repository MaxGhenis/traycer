import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSessionImportAvailable } from "@/hooks/session-import/use-session-import-available";
import { useSessionImportStatus } from "@/hooks/session-import/use-session-import-status-query";
import { SessionImportDialog } from "@/components/session-import/session-import-dialog";
import { useOnboardingStore } from "@/stores/onboarding/onboarding-store";
import { useSessionImportPromptStore } from "@/stores/session-import/session-import-prompt-store";

/**
 * The quiet offer for people who skipped the onboarding act, or who installed
 * Traycer before it existed. Deliberately understated (spec §5): no dot, no
 * shortcut, no palette entry - a single dismissible line above the task list.
 *
 * It carries NO session count. Counting would mean scanning `~/.claude` and
 * `~/.codex` just to decide whether to draw a row, which is exactly the
 * background scanning D13 rules out; the wizard it opens does the scan, once,
 * when the user has actually asked for it.
 */
export function SessionImportPromptRow() {
  const [importOpen, setImportOpen] = useState(false);
  const available = useSessionImportAvailable();
  const onboardingCompletedAt = useOnboardingStore((s) => s.completedAt);
  const dismissedAt = useSessionImportPromptStore((s) => s.dismissedAt);
  const dismiss = useSessionImportPromptStore((s) => s.dismiss);
  // Nothing has ever been imported on this host is the closest honest read of
  // "this user has not tried the feature" - and it retires the row for free the
  // moment they do.
  const eligible =
    available && onboardingCompletedAt !== null && dismissedAt === null;
  const statusQuery = useSessionImportStatus(eligible);

  if (!eligible) return null;
  const status = statusQuery.data;
  if (status === undefined) return null;
  if (status.lastCompleted !== null || status.active !== null) return null;

  return (
    <>
      <div
        data-testid="session-import-prompt"
        className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/50 px-2.5 py-2 text-ui-xs text-muted-foreground"
      >
        <span className="min-w-0 flex-1">
          Sessions from Claude Code and Codex can be imported as tasks.
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="session-import-prompt-open"
            onClick={() => setImportOpen(true)}
          >
            Import
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="session-import-prompt-dismiss"
            onClick={dismiss}
          >
            Dismiss
          </Button>
        </span>
      </div>
      {importOpen ? (
        <SessionImportDialog onClose={() => setImportOpen(false)} />
      ) : null}
    </>
  );
}
