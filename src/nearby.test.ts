import { describe, it, expect } from 'vitest'
import { prepareSolver, type NearestWitness } from './lib/solver'
import { parseTolerance } from './lib/validation'

/**
 * Naive O(|A|·|B|) reference for the nearest reachable spec query.
 * Only used on small samples in tests; the production solver must never
 * enumerate pairs like this. Selection order, independently implemented:
 *   1. smallest |sum - target|
 *   2. tie → smaller total sum
 *   3. tie → smaller A-level spec
 */
function naiveNearest(
  a: number[],
  b: number[],
  target: number,
  tolerance: number,
): NearestWitness | null {
  let best: { x: number; y: number; sum: number } | null = null
  for (const x of new Set(a)) {
    for (const y of new Set(b)) {
      const sum = x + y
      const dev = sum - target
      if (Math.abs(dev) > tolerance) continue
      if (
        best === null ||
        Math.abs(dev) < Math.abs(best.sum - target) ||
        (Math.abs(dev) === Math.abs(best.sum - target) &&
          (sum < best.sum || (sum === best.sum && x < best.x)))
      ) {
        best = { x, y, sum }
      }
    }
  }
  if (best === null) return null
  return { a: best.x, b: best.y, deviation: best.sum - target }
}

function checkNearestMatrix(
  a: number[],
  b: number[],
  targets: number[],
  tolerances: number[],
) {
  const prepared = prepareSolver(a, b)
  for (const target of targets) {
    for (const tolerance of tolerances) {
      expect(prepared.findNearest(target, tolerance)).toEqual(
        naiveNearest(a, b, target, tolerance),
      )
    }
  }
}

describe('nearest — selection order', () => {
  it('prefers the smallest |deviation|', () => {
    // sums: 0, 8 → target 5: |0-5|=5 vs |8-5|=3 → 8 wins
    const prepared = prepareSolver([0, 8], [0])
    expect(prepared.findNearest(5, 5)).toEqual({ a: 8, b: 0, deviation: 3 })
  })

  it('equal |deviation| prefers the smaller total', () => {
    // sums: 4, 8 → target 6, both at distance 2 → total 4 wins
    const prepared = prepareSolver([4, 8], [0])
    expect(prepared.findNearest(6, 2)).toEqual({ a: 4, b: 0, deviation: -2 })
  })

  it('equal total prefers the smaller A spec', () => {
    // Both levels carry 3 and 50: 53 = 3+50 = 50+3 → A=3 wins.
    const prepared = prepareSolver([0, 3, 50], [0, 3, 50])
    expect(prepared.findNearest(53, 0)).toEqual({ a: 3, b: 50, deviation: 0 })
  })

  it('keeps A/B identity when the solver internally swaps sides', () => {
    // |A| > |B| forces the internal swap; the reported pair must still be
    // the original (A, B) with the smaller-A tie-break applied to A.
    const prepared = prepareSolver([0, 3, 50, 100], [0, 50])
    // 100 = 100+0 = 50+50 → smaller A is 50
    expect(prepared.findNearest(100, 0)).toEqual({ a: 50, b: 50, deviation: 0 })
    // 150 = 100+50 = 50+100(∉B) → unique
    expect(prepared.findNearest(150, 0)).toEqual({ a: 100, b: 50, deviation: 0 })
  })

  it('exact hit wins over any approximation', () => {
    const prepared = prepareSolver([0, 10], [0, 10])
    expect(prepared.findNearest(10, 10)).toEqual({ a: 0, b: 10, deviation: 0 })
  })

  it('returns null when nothing is reachable within tolerance', () => {
    const prepared = prepareSolver([0], [0])
    expect(prepared.findNearest(100, 10)).toBeNull()
    expect(prepared.findNearest(100, 0)).toBeNull()
  })
})

describe('nearest — zero values and boundaries', () => {
  it('zero specs sum to zero with zero deviation', () => {
    const prepared = prepareSolver([0], [0])
    expect(prepared.findNearest(0, 0)).toEqual({ a: 0, b: 0, deviation: 0 })
    expect(prepared.findNearest(1, 0)).toBeNull()
    expect(prepared.findNearest(1, 1)).toEqual({ a: 0, b: 0, deviation: -1 })
    expect(prepared.findNearest(1000, 1000)).toEqual({
      a: 0,
      b: 0,
      deviation: -1000,
    })
    expect(prepared.findNearest(1001, 1000)).toBeNull()
  })

  it('max boundary 400000 = 200000 + 200000', () => {
    const prepared = prepareSolver([200000], [200000])
    expect(prepared.findNearest(400000, 0)).toEqual({
      a: 200000,
      b: 200000,
      deviation: 0,
    })
    expect(prepared.findNearest(399999, 0)).toBeNull()
    expect(prepared.findNearest(399999, 1)).toEqual({
      a: 200000,
      b: 200000,
      deviation: 1,
    })
    // target 0 is 400000 μm away — far beyond any tolerance
    expect(prepared.findNearest(0, 1000)).toBeNull()
  })

  it('tolerance 0 only accepts exact hits', () => {
    const prepared = prepareSolver([0, 3, 50], [0, 1, 9, 100])
    expect(prepared.findNearest(4, 0)).toEqual({ a: 3, b: 1, deviation: 0 })
    expect(prepared.findNearest(5, 0)).toBeNull()
    expect(prepared.findNearest(5, 1)).toEqual({ a: 3, b: 1, deviation: -1 })
  })
})

describe('nearest — naive cross-check on small cartesian products', () => {
  it('mixed specs, both levels populated (no internal swap)', () => {
    checkNearestMatrix(
      [0, 1, 2, 5, 17, 200000],
      [0, 3, 4, 9, 100, 200000],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 21, 22, 26, 100, 109, 200000, 200001, 399999, 400000],
      [0, 1, 2, 3, 5, 10, 1000],
    )
  })

  it('more A specs than B specs (forces internal swap)', () => {
    checkNearestMatrix(
      [0, 2, 4, 6, 8, 10, 200000],
      [1, 3],
      [0, 1, 2, 3, 4, 5, 7, 9, 11, 13, 200001, 200003, 400000],
      [0, 1, 2, 4, 1000],
    )
  })

  it('single A spec against many B specs', () => {
    checkNearestMatrix(
      [5],
      [0, 1, 2, 3, 4, 5],
      [0, 4, 5, 6, 9, 10, 11],
      [0, 1, 2, 3, 1000],
    )
  })

  it('duplicate specs collapse before selection', () => {
    const prepared = prepareSolver([3, 3, 3], [1, 1])
    expect(prepared.findNearest(4, 0)).toEqual({ a: 3, b: 1, deviation: 0 })
    checkNearestMatrix(
      [0, 0, 5, 5, 5],
      [0, 3, 3],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      [0, 1, 2, 3],
    )
  })

  it('only zeros on both levels', () => {
    checkNearestMatrix([0, 0], [0], [0, 1, 2, 1000, 1001], [0, 1, 1000])
  })

  it('only max boundary specs', () => {
    checkNearestMatrix(
      [200000],
      [200000],
      [0, 399000, 399999, 400000],
      [0, 1, 999, 1000],
    )
  })

  it('extremes mixed with zero', () => {
    checkNearestMatrix(
      [0, 200000],
      [0, 200000],
      [0, 1, 199999, 200000, 200001, 399999, 400000],
      [0, 1, 2, 1000],
    )
  })
})

describe('nearest — sparse deterministic sets match naive', () => {
  function xorshiftValues(n: number, max: number, seed: number): number[] {
    let x = seed >>> 0 || 1
    const out = new Set<number>()
    while (out.size < n) {
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      x >>>= 0
      out.add(x % (max + 1))
    }
    return [...out]
  }

  it('medium sparse sets across targets and tolerances', () => {
    const a = xorshiftValues(60, 200000, 7)
    const b = xorshiftValues(45, 200000, 13)
    const targets: number[] = []
    for (let t = 0; t <= 400000; t += 9973) targets.push(t)
    checkNearestMatrix(a, b, targets, [0, 1, 7, 100, 1000])
  })

  it('dense interval pair across the whole tolerance range', () => {
    const a: number[] = []
    const b: number[] = []
    for (let i = 0; i <= 200; i++) {
      a.push(i)
      b.push(i * 3)
    }
    const targets: number[] = []
    for (let t = 0; t <= 900; t += 7) targets.push(t)
    checkNearestMatrix(a, b, targets, [0, 1, 2, 5, 1000])
  })
})

describe('parseTolerance', () => {
  it('accepts integers in [0, 1000]', () => {
    expect(parseTolerance('0')).toBe(0)
    expect(parseTolerance('1')).toBe(1)
    expect(parseTolerance('1000')).toBe(1000)
    expect(parseTolerance(' 42 ')).toBe(42)
    expect(parseTolerance('007')).toBe(7)
  })

  it('rejects anything else', () => {
    expect(parseTolerance('')).toBeNull()
    expect(parseTolerance('   ')).toBeNull()
    expect(parseTolerance('-1')).toBeNull()
    expect(parseTolerance('+5')).toBeNull()
    expect(parseTolerance('1001')).toBeNull()
    expect(parseTolerance('1.5')).toBeNull()
    expect(parseTolerance('1e2')).toBeNull()
    expect(parseTolerance('abc')).toBeNull()
    expect(parseTolerance('10px')).toBeNull()
    expect(parseTolerance('1 0')).toBeNull()
  })
})
