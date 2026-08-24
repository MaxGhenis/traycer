import { splitRowLabel } from "@/components/epic-canvas/mobile/switcher-row-label-split";

/**
 * A row title that truncates in the MIDDLE rather than at the end, so a deep
 * row keeps both what a title opens with and what makes it different from its
 * siblings - the same rule the picker applies to a path, where the identifying
 * part is likewise at the end.
 *
 * No measurement, no `ResizeObserver`: the head is an ordinary flex child that
 * truncates when the track runs out, and the tail is an unshrinkable sibling
 * that renders whole. The browser decides where the cut lands, so it is exact
 * at every width and costs nothing per render. A title that fits shows no
 * ellipsis at all, which is why this needs no depth gate - a root row with a
 * short name renders exactly as it did before.
 */
export function SwitcherRowLabel(props: { readonly label: string }) {
  const { head, tail } = splitRowLabel(props.label);
  if (tail === "") {
    return (
      <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground">
        {props.label}
      </span>
    );
  }
  return (
    // `flex-1 min-w-0` on the cluster, `truncate` on the head alone: the head is
    // the only part allowed to give up width.
    <span className="flex min-w-0 flex-1 text-ui-sm text-foreground">
      <span className="min-w-0 truncate">{head}</span>
      <span className="shrink-0 whitespace-pre">{tail}</span>
    </span>
  );
}
