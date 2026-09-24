/// <reference lib="webworker" />
/**
 * Worker: keeps the (up to 100k × 100k) computation off the UI thread so
 * the page stays responsive while exact reachability is solved.
 *
 * Two request kinds share one prepared-solver cache:
 *   - batch:  parse + validate the input, build the bitsets (only when the
 *             text actually changed) and answer all targets;
 *   - nearby: per-row "nearest reachable spec" query; it reuses the bitsets
 *             built from the currently valid input and never builds its own.
 *
 * A failed parse drops the cache, so witnesses cannot leak from an input
 * that validation rejected; requests still in flight for that input then
 * report "not found".
 */
import { parseInput, InvalidInputError } from './lib/validation'
import { prepareSolver, type PreparedSolver } from './lib/solver'

export type BatchRequest = { id: number; kind: 'batch'; text: string }
export type NearbyRequest = {
  id: number
  kind: 'nearby'
  /** Input token assigned when the batch input was committed. */
  token: number
  targetIndex: number
  target: number
  tolerance: number
}
export type WorkerRequest = BatchRequest | NearbyRequest

export type BatchResponse =
  | {
      id: number
      kind: 'ok'
      targets: number[]
      reachable: boolean[]
      distinctA: number
      distinctB: number
      elapsedMs: number
    }
  | { id: number; kind: 'invalid' }
  | { id: number; kind: 'error'; message: string }

export type NearbyResponse =
  | {
      id: number
      kind: 'nearby'
      token: number
      targetIndex: number
      found: true
      a: number
      b: number
      deviation: number
    }
  | {
      id: number
      kind: 'nearby'
      token: number
      targetIndex: number
      found: false
    }
  | {
      id: number
      kind: 'nearby-error'
      token: number
      targetIndex: number
      message: string
}

export type WorkerResponse = BatchResponse | NearbyResponse

const ctx = self as unknown as DedicatedWorkerGlobalScope

/** Bitsets of the last validly committed input; null until one exists. */
let cache: { text: string; prepared: PreparedSolver } | null = null

function handleBatch(id: number, text: string): void {
  try {
    const input = parseInput(text)
    if (cache === null || cache.text !== text) {
      cache = { text, prepared: prepareSolver(input.a, input.b) }
    }
    const prepared = cache.prepared
    const started = ctx.performance.now()
    const reachable = prepared.solveTargets(input.targets)
    const elapsedMs = ctx.performance.now() - started
    const response: BatchResponse = {
      id,
      kind: 'ok',
      targets: input.targets,
      reachable,
      distinctA: prepared.distinctA.length,
      distinctB: prepared.distinctB.length,
      elapsedMs,
    }
    ctx.postMessage(response)
  } catch (err) {
    // Revoke the previous input: validation failure must destroy old
    // witnesses (the main thread already cleared the visible rows).
    cache = null
    if (err instanceof InvalidInputError) {
      const response: BatchResponse = { id, kind: 'invalid' }
      ctx.postMessage(response)
    } else {
      const response: BatchResponse = {
        id,
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      }
      ctx.postMessage(response)
    }
  }
}

function handleNearby(req: NearbyRequest): void {
  try {
    // Only ever answer from the currently valid input's bitsets; with no
    // valid input the query is simply unanswerable here.
    const witness =
      cache === null
        ? null
        : cache.prepared.findNearest(req.target, req.tolerance)
    const response: NearbyResponse =
      witness === null
        ? {
            id: req.id,
            kind: 'nearby',
            token: req.token,
            targetIndex: req.targetIndex,
            found: false,
          }
        : {
            id: req.id,
            kind: 'nearby',
            token: req.token,
            targetIndex: req.targetIndex,
            found: true,
            a: witness.a,
            b: witness.b,
            deviation: witness.deviation,
          }
    ctx.postMessage(response)
  } catch (err) {
    const response: NearbyResponse = {
      id: req.id,
      kind: 'nearby-error',
      token: req.token,
      targetIndex: req.targetIndex,
      message: err instanceof Error ? err.message : String(err),
    }
    ctx.postMessage(response)
  }
}

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data
  if (req.kind === 'nearby') {
    handleNearby(req)
  } else {
    handleBatch(req.id, req.text)
  }
}
