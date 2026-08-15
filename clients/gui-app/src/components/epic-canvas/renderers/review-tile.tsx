import { CollabTileBody } from "./collab-tile-body";
import { ArtifactVersionHistoryEntryPoint } from "./artifact-version-history";
import type { EpicNodeRef } from "@/stores/epics/canvas/types";

interface ReviewTileProps {
  readonly node: EpicNodeRef;
  readonly viewTabId: string;
  readonly tileId: string;
  readonly isActive: boolean;
}

export function ReviewTile(props: ReviewTileProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center border-b border-canvas-border/40 px-6 py-2">
        <ArtifactVersionHistoryEntryPoint artifactId={props.node.id} />
      </div>
      <CollabTileBody
        node={props.node}
        viewTabId={props.viewTabId}
        tileId={props.tileId}
        isActive={props.isActive}
        testId="review-tile"
      />
    </div>
  );
}
