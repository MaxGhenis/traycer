/**
 * How much of the end of a title is worth protecting. Auto-generated agent
 * titles name the shared task first and vary at the TAIL, so sibling rows under
 * one parent collide on their opening words - "Recursive Depth Configuration"
 * and "Recursive Depth Configuration Verification" read identically once the
 * end is cut. Sixteen characters is about two short words at `text-ui-sm`,
 * enough to carry the distinguishing part without eating the track a deep row
 * has left.
 */
const TAIL_MAX_CHARS = 16;

/**
 * The shortest head worth keeping. Below this the row would read as ellipsis
 * plus a fragment, which identifies the agent no better than the tail alone
 * and reads worse, so such a label truncates from the end like any other.
 */
const MIN_HEAD_CHARS = 8;

/**
 * Split a title into the part that may be truncated and the part that must
 * survive. `tail` empty means the label truncates normally from the end.
 *
 * The tail is taken at a word boundary where one is available, so the protected
 * fragment reads as words rather than a slice; a single unbroken token falls
 * back to its last characters, which is still where an id or a version differs.
 */
export function splitRowLabel(label: string): {
  readonly head: string;
  readonly tail: string;
} {
  if (label.length <= MIN_HEAD_CHARS + TAIL_MAX_CHARS) {
    return { head: label, tail: "" };
  }
  const lastSpace = label.lastIndexOf(" ");
  const wordTailLength = label.length - lastSpace;
  const tailLength =
    lastSpace > 0 && wordTailLength <= TAIL_MAX_CHARS
      ? wordTailLength
      : TAIL_MAX_CHARS;
  const splitAt = label.length - tailLength;
  if (splitAt < MIN_HEAD_CHARS) return { head: label, tail: "" };
  return { head: label.slice(0, splitAt), tail: label.slice(splitAt) };
}
