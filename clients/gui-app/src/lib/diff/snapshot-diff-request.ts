/**
 * Whether a file change addresses any snapshot content at all.
 *
 * This is `useSnapshotDiffQuery`'s own gate, kept where both the hook and the
 * surfaces reading its result can share one definition: with neither side
 * hashed there is nothing to read, so the query is switched off and never
 * resolves, and a surface deciding whether it is still waiting on that read
 * must ask here rather than assume it was requested.
 */
export function hasSnapshotDiffContentToRead(args: {
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
}): boolean {
  return args.beforeHash !== null || args.afterHash !== null;
}
