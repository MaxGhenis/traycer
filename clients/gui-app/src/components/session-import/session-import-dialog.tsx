import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SessionImportWizard } from "@/components/session-import/session-import-wizard";

/**
 * The wizard as a Settings dialog. Closing it does not stop an import that has
 * already started (spec §5) - the run belongs to the app-wide controller, and
 * this dialog is only a window onto it.
 */
export function SessionImportDialog(props: { readonly onClose: () => void }) {
  const { onClose } = props;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid="session-import-dialog"
        className="flex h-[min(80dvh,calc(100dvh-2rem))] w-[min(92vw,48rem)] flex-col gap-4 sm:max-w-[min(92vw,48rem)]"
      >
        <DialogHeader>
          <DialogTitle>Import sessions</DialogTitle>
          <DialogDescription>
            Bring sessions you have already run in Claude Code or Codex into
            Traycer as tasks.
          </DialogDescription>
        </DialogHeader>
        <SessionImportWizard
          surface="dialog"
          onImportStarted={() => undefined}
          secondaryAction={{ label: "Close", onSelect: onClose }}
        />
      </DialogContent>
    </Dialog>
  );
}
