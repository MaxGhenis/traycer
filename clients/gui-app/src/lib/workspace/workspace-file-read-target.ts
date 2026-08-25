/**
 * Whether a workspace file read names a file to read.
 *
 * This is `useWorkspaceReadFile`'s own gate, kept where both the hook and the
 * surfaces reading its result can share one definition: an unaddressed read is
 * switched off and never resolves, so a surface deciding whether it is still
 * waiting on that read must ask here rather than assume it was requested.
 */
export function hasWorkspaceReadFileTarget(
  workspacePath: string | null,
  filePath: string | null,
): boolean {
  return (
    workspacePath !== null &&
    filePath !== null &&
    workspacePath.length > 0 &&
    filePath.length > 0
  );
}
