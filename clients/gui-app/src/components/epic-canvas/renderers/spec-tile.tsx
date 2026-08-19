import { CollabTileBody } from "./collab-tile-body";
import { ArtifactVersionHistoryEntryPoint } from "./artifact-version-history";
import { useArtifactVersionHistoryAvailable } from "@/hooks/epic/use-artifact-version-history-available";
import type { EpicNodeRef } from "@/stores/epics/canvas/types";

interface SpecTileProps {
  readonly node: EpicNodeRef;
  readonly viewTabId: string;
  readonly tileId: string;
  readonly isActive: boolean;
}

export function SpecTile(props: SpecTileProps) {
  const historyAvailable = useArtifactVersionHistoryAvailable();
  return (
    <div className="flex h-full min-h-0 flex-col">
      {historyAvailable ? (
        <div className="flex items-center border-b border-canvas-border/40 px-6 py-2">
          <ArtifactVersionHistoryEntryPoint artifactId={props.node.id} />
        </div>
      ) : null}
      <CollabTileBody
        node={props.node}
        viewTabId={props.viewTabId}
        tileId={props.tileId}
        isActive={props.isActive}
        testId="spec-tile"
      />
    </div>
  );
}
