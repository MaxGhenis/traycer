import { Check, ChevronRight, FolderX, Minus } from "lucide-react";
import { HarnessIcon } from "@/components/home/pickers/harness-icon";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { cn } from "@/lib/utils";
import { useCompactRelativeTime } from "@/lib/relative-time";
import type {
  SessionImportGroupSelectionState,
  SessionImportGroupView,
  SessionImportRowView,
} from "@/components/session-import/session-import-model";
import type { SessionImportTone } from "@/components/session-import/session-import-tone";

const MISSING_FOLDER_HINT =
  "This folder no longer exists - these sessions import without a workspace.";

/**
 * Checkbox visual with no interactive element of its own: the row around it is
 * the control (`role="checkbox"`), so the whole row is the hit target and
 * nothing nests a button inside a button.
 */
function SelectionBox(props: {
  readonly state: SessionImportGroupSelectionState;
  readonly disabled: boolean;
  readonly tone: SessionImportTone;
}) {
  const { state, disabled, tone } = props;
  const filled = state !== "none";
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[0.25rem] border transition-colors",
        filled ? tone.checkboxFilled : cn("border-current/40", tone.faint),
        disabled && "opacity-40",
      )}
    >
      {state === "all" ? <Check className="size-3" /> : null}
      {state === "partial" ? <Minus className="size-3" /> : null}
    </span>
  );
}

function SessionRow(props: {
  readonly row: SessionImportRowView;
  readonly tone: SessionImportTone;
  readonly onToggle: (selectionKey: string) => void;
}) {
  const { row, tone, onToggle } = props;
  const { candidate } = row;
  const when = useCompactRelativeTime(candidate.updatedAt);
  const meta: string[] = [];
  if (candidate.messageCount !== null) {
    meta.push(`${candidate.messageCount} messages`);
  }
  if (candidate.hasSubagents) meta.push("sub-agents");

  return (
    <TooltipWrapper
      label={row.unavailableDetail}
      side="top"
      sideOffset={undefined}
      align={undefined}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={row.selected}
        aria-label={row.title}
        disabled={!row.selectable}
        data-testid="session-import-row"
        data-selectable={row.selectable}
        onClick={() => onToggle(row.selectionKey)}
        className={cn(
          "flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
          row.selectable ? tone.rowHover : "opacity-55",
          !row.selectable && "cursor-default",
        )}
      >
        <SelectionBox
          state={row.selected ? "all" : "none"}
          disabled={!row.selectable}
          tone={tone}
        />
        <HarnessIcon
          harnessId={candidate.harness}
          className={cn("size-3.5", tone.muted)}
        />
        <span className={cn("min-w-0 flex-1 truncate text-ui-sm", tone.strong)}>
          {row.title}
        </span>
        {meta.length > 0 ? (
          <span className={cn("shrink-0 text-ui-xs", tone.faint)}>
            {meta.join(" · ")}
          </span>
        ) : null}
        {row.unavailableLabel !== null ? (
          <span className={cn("shrink-0 text-ui-xs", tone.faint)}>
            {row.unavailableLabel}
          </span>
        ) : null}
        <span className={cn("w-10 shrink-0 text-right text-ui-xs", tone.faint)}>
          {when}
        </span>
      </button>
    </TooltipWrapper>
  );
}

export function SessionImportGroupItem(props: {
  readonly group: SessionImportGroupView;
  readonly tone: SessionImportTone;
  readonly onToggleExpanded: (groupKey: string) => void;
  readonly onSetGroupSelection: (groupKey: string, selected: boolean) => void;
  readonly onToggleSession: (selectionKey: string) => void;
}) {
  const {
    group,
    tone,
    onToggleExpanded,
    onSetGroupSelection,
    onToggleSession,
  } = props;

  return (
    <div
      data-testid="session-import-group"
      data-group-key={group.groupKey}
      className={cn("overflow-hidden rounded-lg border", tone.border)}
    >
      <div
        className={cn("flex w-full min-w-0 items-center", tone.groupSurface)}
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={
            group.selectionState === "partial"
              ? "mixed"
              : group.selectionState === "all"
          }
          aria-label={`Select every session in ${group.name}`}
          disabled={group.selectableCount === 0}
          data-testid="session-import-group-select"
          onClick={() =>
            onSetGroupSelection(group.groupKey, group.selectionState !== "all")
          }
          className="flex shrink-0 items-center py-2.5 pr-1.5 pl-2.5"
        >
          <SelectionBox
            state={group.selectionState}
            disabled={group.selectableCount === 0}
            tone={tone}
          />
        </button>
        <button
          type="button"
          aria-expanded={group.expanded}
          data-testid="session-import-group-toggle"
          onClick={() => onToggleExpanded(group.groupKey)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 py-2.5 pr-2.5 text-left transition-colors",
            tone.rowHover,
          )}
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 transition-transform",
              tone.faint,
              group.expanded && "rotate-90",
            )}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  "min-w-0 truncate text-ui-sm font-medium",
                  tone.strong,
                )}
              >
                {group.name}
              </span>
              {group.missingFolder ? (
                <TooltipWrapper
                  label={MISSING_FOLDER_HINT}
                  side="top"
                  sideOffset={undefined}
                  align={undefined}
                >
                  <span
                    data-testid="session-import-missing-folder"
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-ui-xs",
                      tone.warningSurface,
                    )}
                  >
                    <FolderX aria-hidden className="size-3" />
                    Folder not found
                  </span>
                </TooltipWrapper>
              ) : null}
            </span>
            <span className={cn("min-w-0 truncate text-ui-xs", tone.faint)}>
              {group.path}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {group.providerCounts.map((entry) => (
              <span
                key={entry.harness}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-ui-xs",
                  tone.chip,
                )}
              >
                <HarnessIcon harnessId={entry.harness} className="size-3" />
                {entry.count}
              </span>
            ))}
            <span className={cn("text-ui-xs", tone.muted)}>
              {group.selectedCount}/{group.selectableCount}
            </span>
          </span>
        </button>
      </div>
      {group.expanded ? (
        <div className={cn("flex flex-col gap-0.5 border-t p-1", tone.border)}>
          {group.rows.map((row) => (
            <SessionRow
              key={row.selectionKey}
              row={row}
              tone={tone}
              onToggle={onToggleSession}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
