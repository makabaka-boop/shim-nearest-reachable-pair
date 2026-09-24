import { describe, it, expect } from 'vitest'
import {
  EMPTY_ROW,
  initialNearbyState,
  nearbyReducer,
  type NearbyUiState,
} from './nearbyState'

const WITNESS = { a: 3, b: 50, deviation: 0 }

/** Drive a row through a successful query lifecycle. */
function completedState(index = 0, id = 1): NearbyUiState {
  let s = initialNearbyState()
  s = nearbyReducer(s, { type: 'batch-start' }) // token 1
  s = nearbyReducer(s, { type: 'draft', index, value: '10' })
  s = nearbyReducer(s, { type: 'submit', index, id })
  s = nearbyReducer(s, {
    type: 'response',
    id,
    token: 1,
    targetIndex: index,
    found: true,
    witness: WITNESS,
  })
  return s
}

describe('nearbyState — query lifecycle', () => {
  it('draft edits are stored per row and clear the invalid flag', () => {
    let s = initialNearbyState()
    s = nearbyReducer(s, { type: 'invalid-tolerance', index: 2 })
    expect(s.rows[2].invalidDraft).toBe(true)
    s = nearbyReducer(s, { type: 'draft', index: 2, value: '100' })
    expect(s.rows[2].draft).toBe('100')
    expect(s.rows[2].invalidDraft).toBe(false)
  })

  it('submit marks the row running and drops the previous witness', () => {
    let s = completedState()
    expect(s.rows[0].status).toBe('done')
    s = nearbyReducer(s, { type: 'submit', index: 0, id: 9 })
    expect(s.rows[0].status).toBe('running')
    expect(s.rows[0].witness).toBeNull()
    expect(s.rows[0].pendingId).toBe(9)
  })

  it('matching response stores the witness', () => {
    const s = completedState()
    expect(s.rows[0]).toMatchObject({
      status: 'done',
      witness: WITNESS,
      pendingId: null,
    })
  })

  it('not-found response records "none"', () => {
    let s = initialNearbyState()
    s = nearbyReducer(s, { type: 'batch-start' })
    s = nearbyReducer(s, { type: 'submit', index: 4, id: 7 })
    s = nearbyReducer(s, {
      type: 'response',
      id: 7,
      token: 1,
      targetIndex: 4,
      found: false,
      witness: null,
    })
    expect(s.rows[4].status).toBe('none')
    expect(s.rows[4].witness).toBeNull()
    expect(s.rows[4].pendingId).toBeNull()
  })
})

describe('nearbyState — invalid tolerance keeps the last valid query', () => {
  it('keeps a previous witness', () => {
    let s = completedState()
    s = nearbyReducer(s, { type: 'invalid-tolerance', index: 0 })
    expect(s.rows[0].invalidDraft).toBe(true)
    expect(s.rows[0].status).toBe('done')
    expect(s.rows[0].witness).toEqual(WITNESS)
  })

  it('keeps a previous "none" verdict', () => {
    let s = initialNearbyState()
    s = nearbyReducer(s, { type: 'batch-start' })
    s = nearbyReducer(s, { type: 'submit', index: 0, id: 1 })
    s = nearbyReducer(s, {
      type: 'response',
      id: 1,
      token: 1,
      targetIndex: 0,
      found: false,
      witness: null,
    })
    s = nearbyReducer(s, { type: 'invalid-tolerance', index: 0 })
    expect(s.rows[0].status).toBe('none')
    expect(s.rows[0].invalidDraft).toBe(true)
  })

  it('flags a row that never had a valid query', () => {
    let s = initialNearbyState()
    s = nearbyReducer(s, { type: 'invalid-tolerance', index: 3 })
    expect(s.rows[3]).toMatchObject({
      status: 'idle',
      invalidDraft: true,
      witness: null,
    })
  })
})

describe('nearbyState — input replacement revokes witnesses', () => {
  it('batch-start clears all rows and bumps the token', () => {
    let s = completedState(0, 1)
    s = nearbyReducer(s, { type: 'draft', index: 5, value: '3' })
    s = nearbyReducer(s, { type: 'batch-start' })
    expect(s.rows).toEqual({})
    expect(s.token).toBe(2)
  })

  it('a late response from the old input is discarded (token mismatch)', () => {
    let s = completedState(0, 1)
    s = nearbyReducer(s, { type: 'batch-start' })
    const after = nearbyReducer(s, {
      type: 'response',
      id: 1,
      token: 1, // old token
      targetIndex: 0,
      found: true,
      witness: WITNESS,
    })
    expect(after).toBe(s)
    expect(after.rows[0]).toBeUndefined()
  })

  it('a late response for a superseded request id is discarded', () => {
    let s = initialNearbyState()
    s = nearbyReducer(s, { type: 'batch-start' })
    s = nearbyReducer(s, { type: 'submit', index: 0, id: 1 })
    s = nearbyReducer(s, { type: 'submit', index: 0, id: 2 })
    const after = nearbyReducer(s, {
      type: 'response',
      id: 1, // superseded by id 2
      token: 1,
      targetIndex: 0,
      found: true,
      witness: WITNESS,
    })
    expect(after.rows[0].status).toBe('running')
    expect(after.rows[0].witness).toBeNull()
  })

  it('a response for an unknown row is discarded', () => {
    let s = initialNearbyState()
    s = nearbyReducer(s, { type: 'batch-start' })
    const after = nearbyReducer(s, {
      type: 'response',
      id: 1,
      token: 1,
      targetIndex: 9,
      found: true,
      witness: WITNESS,
    })
    expect(after.rows[9]).toBeUndefined()
  })

  it('reset returns to the initial state', () => {
    let s = completedState()
    s = nearbyReducer(s, { type: 'reset' })
    expect(s).toEqual(initialNearbyState())
    expect(EMPTY_ROW.pendingId).toBeNull()
  })
})
