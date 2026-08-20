import { Trash2 } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useDeletedArtifactsAvailable } from "@/hooks/epic/use-deleted-artifacts-available";
import { useEpicSessionHostClient } from "@/hooks/epic/use-epic-session-host-client";
import { useEpicSessionHostId } from "@/hooks/epic/use-epic-session-host-id";
import { useHostQuery } from "@/hooks/host/use-host-query";
import { useOpenDeletedArtifacts } from "./use-open-deleted-artifacts";

export function DeletedArtifactsOpenMenuItem(props: {
  readonly epicId: string;
}) {
  const hostId = useEpicSessionHostId();
  const client = useEpicSessionHostClient();
  const available = useDeletedArtifactsAvailable(hostId);
  const deleted = useHostQuery({
    client,
    method: "epic.deletedArtifacts.list",
    params: { epicId: props.epicId },
    cacheKeyIdentity: undefined,
    options: { enabled: available },
  });
  const openDeletedArtifacts = useOpenDeletedArtifacts(props.epicId, hostId);

  if (!available) return null;
  const count = deleted.data?.entries.length ?? 0;
  return (
    <DropdownMenuItem
      onSelect={openDeletedArtifacts}
      data-testid="epic-sidebar-more-open-deleted-artifacts"
    >
      <Trash2 className="size-4" />
      Deleted artifacts{count === 0 ? "" : ` (${count})`}
    </DropdownMenuItem>
  );
}
