import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react'
import App from './App'
import { parseInput, InvalidInputError } from './lib/validation'
import { prepareSolver, type PreparedSolver } from './lib/solver'
import type {
  WorkerRequest,
  WorkerResponse,
  BatchResponse,
  NearbyResponse,
} from './solver.worker'

/**
 * In-memory Worker: runs the same parse/validate + prepareSolver pipeline
 * synchronously and delivers responses on macrotasks, exactly like the
 * real worker, but without a separate thread.
 */
class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null
  private cache: { text: string; prepared: PreparedSolver } | null = null
  private timers: ReturnType<typeof setTimeout>[] = []

  postMessage(message: WorkerRequest): void {
    if (message.kind === 'nearby') {
      const witness =
        this.cache?.prepared.findNearest(message.target, message.tolerance) ??
        null
      const response: NearbyResponse =
        witness === null
          ? {
              id: message.id,
              kind: 'nearby',
              token: message.token,
              targetIndex: message.targetIndex,
              found: false,
            }
          : {
              id: message.id,
              kind: 'nearby',
              token: message.token,
              targetIndex: message.targetIndex,
              found: true,
              a: witness.a,
              b: witness.b,
              deviation: witness.deviation,
            }
      this.respond(response)
      return
    }

    try {
      const input = parseInput(message.text)
      if (this.cache === null || this.cache.text !== message.text) {
        this.cache = {
          text: message.text,
          prepared: prepareSolver(input.a, input.b),
        }
      }
      const prepared = this.cache.prepared
      const reachable = prepared.solveTargets(input.targets)
      const response: BatchResponse = {
        id: message.id,
        kind: 'ok',
        targets: input.targets,
        reachable,
        distinctA: prepared.distinctA.length,
        distinctB: prepared.distinctB.length,
        elapsedMs: 0,
      }
      this.respond(response)
    } catch (err) {
      this.cache = null
      if (err instanceof InvalidInputError) {
        this.respond({ id: message.id, kind: 'invalid' })
      } else {
        throw err
      }
    }
  }

  private respond(response: WorkerResponse): void {
    const timer = setTimeout(() => {
      this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>)
    }, 0)
    this.timers.push(timer)
  }

  terminate(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
  }
}

const INPUT_1 = JSON.stringify({
  // sums: 0, 3, 6, 50, 53, 100
  a: [0, 3, 50],
  b: [0, 3, 50],
  targets: [53, 99, 8, 4, 400000],
})

// Replacement input （换稿）: sums 0, 100, 200.
const INPUT_2 = JSON.stringify({
  a: [0, 100],
  b: [0, 100],
  targets: [100, 4],
})

const BAD_INPUT = '{ not json'

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5))
  })
}

function compute(text: string): void {
  fireEvent.change(screen.getByPlaceholderText('{"a":[0,3],"b":[1,2],"targets":[1,3,4]}'), {
    target: { value: text },
  })
  fireEvent.click(screen.getByRole('button', { name: '计算可达性' }))
}

function resultRow(indexOneBased: number): HTMLElement {
  const cell = screen.getByText(`#${indexOneBased}`)
  const row = cell.closest('.result-row')
  if (row === null) throw new Error(`result row #${indexOneBased} not found`)
  return row as HTMLElement
}

function setTolerance(row: HTMLElement, value: string): void {
  fireEvent.change(within(row).getByLabelText('容差（微米）'), {
    target: { value },
  })
}

function clickQuery(row: HTMLElement): void {
  fireEvent.click(within(row).getByRole('button', { name: '查询' }))
}

describe('App — nearest reachable spec UI', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)
    vi.stubGlobal(
      'requestAnimationFrame',
      (cb: FrameRequestCallback) =>
        setTimeout(() => cb(performance.now()), 0) as unknown as number,
    )
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('keeps batch results and answers nearest queries with signed deviation', async () => {
    render(<App />)
    compute(INPUT_1)
    await flush()

    // Original batch results and order are unchanged.
    expect(screen.getByText(/共 5 个目标/).textContent).toMatch(/1 个可达/)
    expect(resultRow(1).textContent).toContain('true')
    expect(resultRow(2).textContent).toContain('false')

    // Row 1: target 53 exact, two representations → smaller A spec.
    setTolerance(resultRow(1), '0')
    clickQuery(resultRow(1))
    await flush()
    expect(within(resultRow(1)).getByText('A=3 · B=50 · 偏差 0')).toBeTruthy()

    // Row 2: target 99, nearest reachable is 100 (positive deviation).
    setTolerance(resultRow(2), '0')
    clickQuery(resultRow(2))
    await flush()
    expect(within(resultRow(2)).getByText('容差内无可达规格')).toBeTruthy()
    setTolerance(resultRow(2), '1')
    clickQuery(resultRow(2))
    await flush()
    expect(within(resultRow(2)).getByText('A=50 · B=50 · 偏差 +1')).toBeTruthy()

    // Row 3: target 8 → 6 at deviation -2.
    setTolerance(resultRow(3), '3')
    clickQuery(resultRow(3))
    await flush()
    expect(within(resultRow(3)).getByText('A=3 · B=3 · 偏差 -2')).toBeTruthy()

    // Row 4: target 4 → 3 at deviation -1, witnesses (0,3) and (3,0):
    // smaller A wins.
    setTolerance(resultRow(4), '2')
    clickQuery(resultRow(4))
    await flush()
    expect(within(resultRow(4)).getByText('A=0 · B=3 · 偏差 -1')).toBeTruthy()

    // Row 5: 400000 unreachable even with full tolerance.
    setTolerance(resultRow(5), '1000')
    clickQuery(resultRow(5))
    await flush()
    expect(within(resultRow(5)).getByText('容差内无可达规格')).toBeTruthy()
  })

  it('invalid tolerance keeps the previous witness until a valid retry', async () => {
    render(<App />)
    compute(INPUT_1)
    await flush()

    const row = resultRow(4)

    // Invalid draft: hint only, no witness yet.
    setTolerance(row, 'abc')
    clickQuery(row)
    await flush()
    expect(within(row).getByText(/容差须为 0–1000 的整数/)).toBeTruthy()
    expect(within(row).queryByText(/A=/)).toBeNull()

    // Valid query replaces the flagged state with a witness.
    setTolerance(row, '2')
    expect(within(row).queryByText(/容差须为 0–1000 的整数/)).toBeNull()
    clickQuery(row)
    await flush()
    expect(within(row).getByText('A=0 · B=3 · 偏差 -1')).toBeTruthy()

    // Out-of-range tolerance: hint shown AND previous witness retained.
    setTolerance(row, '1001')
    clickQuery(row)
    await flush()
    expect(within(row).getByText(/容差须为 0–1000 的整数/)).toBeTruthy()
    expect(within(row).getByText('A=0 · B=3 · 偏差 -1')).toBeTruthy()
  })

  it('revokes witnesses when the input is replaced and serves the new input', async () => {
    render(<App />)
    compute(INPUT_1)
    await flush()
    setTolerance(resultRow(1), '0')
    clickQuery(resultRow(1))
    await flush()
    expect(screen.getByText('A=3 · B=50 · 偏差 0')).toBeTruthy()

    // Replace the input draft and commit: old rows and witnesses vanish.
    compute(INPUT_2)
    await flush()
    expect(screen.queryByText('A=3 · B=50 · 偏差 0')).toBeNull()
    expect(screen.getByText('#1').textContent).toBe('#1')
    expect(resultRow(1).textContent).toContain('100')
    expect(screen.queryByText('#5')).toBeNull()

    // A query on the new input uses the new bitsets.
    setTolerance(resultRow(1), '0')
    clickQuery(resultRow(1))
    await flush()
    expect(within(resultRow(1)).getByText('A=0 · B=100 · 偏差 0')).toBeTruthy()

    // Row 2 target 4: only sum 0 within tolerance 3 → none.
    setTolerance(resultRow(2), '3')
    clickQuery(resultRow(2))
    await flush()
    expect(within(resultRow(2)).getByText('容差内无可达规格')).toBeTruthy()
  })

  it('clears results and witnesses when the new input fails validation', async () => {
    render(<App />)
    compute(INPUT_1)
    await flush()
    setTolerance(resultRow(1), '0')
    clickQuery(resultRow(1))
    await flush()
    expect(screen.getByText('A=3 · B=50 · 偏差 0')).toBeTruthy()

    compute(BAD_INPUT)
    await flush()

    // INVALID_INPUT status + empty results panel, every row gone.
    expect(screen.getAllByText('INVALID_INPUT').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('#1')).toBeNull()
    expect(screen.queryByText('A=3 · B=50 · 偏差 0')).toBeNull()

    // Recover with a valid input.
    compute(INPUT_2)
    await flush()
    expect(resultRow(1).textContent).toContain('100')
    setTolerance(resultRow(1), '0')
    clickQuery(resultRow(1))
    await flush()
    expect(within(resultRow(1)).getByText('A=0 · B=100 · 偏差 0')).toBeTruthy()
  })

  it('discards a late nearby response from the replaced input', async () => {
    render(<App />)
    compute(INPUT_1)
    await flush()

    // Start a nearby query...
    setTolerance(resultRow(1), '0')
    clickQuery(resultRow(1))
    // ...and before it is delivered, replace the input (rows revoked).
    compute(INPUT_2)
    await flush()

    // The late nearby response (old token) must not render; only the new
    // batch rows exist, with no witness on row 1.
    expect(resultRow(1).textContent).toContain('100')
    expect(screen.queryByText('A=3 · B=50 · 偏差 0')).toBeNull()
    expect(within(resultRow(1)).queryByText(/A=/)).toBeNull()
  })
})
