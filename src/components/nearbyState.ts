/**
 * Pure UI state for the per-row "邻近可达规格" (nearest reachable spec)
 * queries. Kept DOM-free so the lifecycle rules can be unit-tested without
 * rendering anything.
 *
 * Lifecycle contract:
 *   - Committing a new batch input (替换输入) revokes every previous
 *     witness immediately and bumps the input token; any late worker reply
 *     carrying the old token or a stale request id is discarded, so an old
 *     witness can never be shown again.
 *   - A batch that fails validation leaves the rows empty (they were
 *     revoked at commit time already).
 *   - An invalid tolerance draft does NOT clear the row: the previous valid
 *     query result (witness or "none") stays visible with an inline hint.
 *   - A valid new query replaces the previous result while it runs.
 */

export interface NearbyWitness {
  a: number
  b: number
  /** (a + b) - queried target; signed. */
  deviation: number
}

export type NearbyRowStatus = 'idle' | 'running' | 'done' | 'none'

export interface NearbyRowState {
  /** Tolerance text draft for the row. */
  draft: string
  /** Last accepted query verdict; survives an invalid tolerance draft. */
  status: NearbyRowStatus
  /** True while the current draft fails tolerance validation. */
  invalidDraft: boolean
  /** Present iff status === 'done'; kept across invalid tolerance drafts. */
  witness: NearbyWitness | null
  /** Request id of the in-flight query, or null when idle. */
  pendingId: number | null
}

export interface NearbyUiState {
  /** Token of the currently committed input; 0 before the first commit. */
  token: number
  /** Per-row states keyed by target index; empty right after a commit. */
  rows: Record<number, NearbyRowState>
}

export const EMPTY_ROW: NearbyRowState = {
  draft: '',
  status: 'idle',
  invalidDraft: false,
  witness: null,
  pendingId: null,
}

export function initialNearbyState(): NearbyUiState {
  return { token: 0, rows: {} }
}

export type NearbyEvent =
  | { type: 'batch-start' }
  | { type: 'reset' }
  | { type: 'draft'; index: number; value: string }
  | { type: 'invalid-tolerance'; index: number }
  | { type: 'submit'; index: number; id: number }
  | {
      type: 'response'
      id: number
      token: number
      targetIndex: number
      found: boolean
      witness: NearbyWitness | null
    }

function updateRow(
  state: NearbyUiState,
  index: number,
  patch: Partial<NearbyRowState>,
): NearbyUiState {
  const row = state.rows[index] ?? EMPTY_ROW
  return {
    ...state,
    rows: { ...state.rows, [index]: { ...row, ...patch } },
  }
}

export function nearbyReducer(
  state: NearbyUiState,
  event: NearbyEvent,
): NearbyUiState {
  switch (event.type) {
    case 'batch-start':
      // Input replaced (or re-committed): revoke all witnesses up front
      // and invalidate every in-flight query by bumping the token.
      return { token: state.token + 1, rows: {} }
    case 'reset':
      return initialNearbyState()
    case 'draft':
      // Editing clears the invalid-draft flag; the last verdict is kept
      // until a new valid query supersedes it.
      return updateRow(state, event.index, {
        draft: event.value,
        invalidDraft: false,
      })
    case 'invalid-tolerance':
      // Keep status/witness of the last valid query; flag the draft only.
      return updateRow(state, event.index, { invalidDraft: true })
    case 'submit':
      return updateRow(state, event.index, {
        status: 'running',
        invalidDraft: false,
        witness: null,
        pendingId: event.id,
      })
    case 'response': {
      const row = state.rows[event.targetIndex]
      // Stale guard: the row must still be waiting for exactly this request
      // id under the current input token. Anything else — a late reply from
      // a replaced input, a superseded request, or an unknown row — is
      // ignored so revoked witnesses can never reappear.
      if (
        row === undefined ||
        row.pendingId !== event.id ||
        event.token !== state.token
      ) {
        return state
      }
      return updateRow(state, event.targetIndex, {
        status: event.found ? 'done' : 'none',
        witness: event.found ? event.witness : null,
        pendingId: null,
      })
    }
  }
}
