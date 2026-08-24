/**
 * The presentational scraps an agent row wears on both form factors: the
 * archived marker, the trailing relative time, and the provider that mounts the
 * row-menu facts for a list body that has no other use for them.
 *
 * Split from `chat-row-menu`, which decides row BEHAVIOUR and exports no
 * components: a module that mixes the two loses fast refresh for everything in
 * it.
 */
import type { ReactNode } from "react";
import { useCompactRelativeTime } from "@/lib/relative-time";
import {
  SidebarArchiveSupportedContext,
  SidebarChatSharingContext,
  useChatRowMenuFacts,
} from "@/components/epic-canvas/sidebar/chat-row-menu";

/**
 * Mounts {@link useChatRowMenuFacts} onto the two contexts the rows read, for a
 * list body that has no other use for the values. The desktop panel body reads
 * `canArchive` for its own empty-state copy and so provides them itself.
 */
export function ChatRowMenuFactsProvider(props: {
  readonly epicId: string;
  readonly children: ReactNode;
}) {
  const facts = useChatRowMenuFacts(props.epicId);
  return (
    <SidebarArchiveSupportedContext.Provider value={facts.canArchive}>
      <SidebarChatSharingContext.Provider value={facts.sharing}>
        {props.children}
      </SidebarChatSharingContext.Provider>
    </SidebarArchiveSupportedContext.Provider>
  );
}

/**
 * Keeps the archival state attached to the title rather than competing with
 * timestamps and controls in the trailing metadata cluster.
 */
export function ArchivedTitlePrefix(): ReactNode {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 text-muted-foreground"
      data-testid="chat-row-archived-label"
    >
      <span className="font-semibold">Archived</span>
      <span aria-hidden="true">·</span>
    </span>
  );
}

/**
 * The row's trailing last-activity time, on the shared compact ladder
 * (`now` / `10m` / `4h` / `1d` / `1w` / short date). Isolated in its own leaf
 * so the shared 60s clock tick repaints this span rather than the whole row.
 */
export function ChatRowIdleTime(props: {
  readonly updatedAt: number;
}): ReactNode {
  const relative = useCompactRelativeTime(props.updatedAt);
  return (
    <span
      className="flex-none tabular-nums text-ui-xs text-muted-foreground"
      data-testid="chat-row-idle-time"
    >
      {relative}
    </span>
  );
}
