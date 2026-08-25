/**
 * The part of a TanStack query result that says whether it has ever produced
 * data. Deliberately narrower than `UseQueryResult`: nothing about a query's
 * arrival depends on its data type, its error type, or its refetch controls.
 */
export interface HostQueryArrivalState {
  /** No data and no error yet - `status === "pending"`. */
  readonly isPending: boolean;
}

/**
 * Whether a host query still owes its caller a first answer.
 *
 * A DISABLED TanStack query is `status: "pending"` with `fetchStatus: "idle"`,
 * and `isLoading` is defined as `isPending && isFetching` - so a disabled query
 * reports `isLoading: false` and is indistinguishable, to a surface that gates
 * its spinner on `isLoading`, from a query that ran and came back with nothing.
 * `useHostQuery` disables itself whenever no host client is bound or host
 * readiness has not landed, so such a surface renders "nothing here" - or a
 * verdict like "blob missing" - about data that was never requested. A host
 * query with no host to ask is WAITING, not empty.
 *
 * `requested` is the caller's OWN gate: the condition it passed as the query's
 * `enabled`, or `true` when it passed none. It is what separates the two ways a
 * query can be disabled. A query the caller switched off is never going to run,
 * so it awaits nothing and its surface should fall through to whatever it shows
 * for absent data; without this input the predicate would collapse to
 * `isPending` and hold such a surface on a spinner forever.
 */
export function isHostQueryAwaitingData(args: {
  readonly query: HostQueryArrivalState;
  readonly requested: boolean;
}): boolean {
  if (!args.requested) return false;
  return args.query.isPending;
}
