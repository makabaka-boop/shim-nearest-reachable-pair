import { memo, useEffect, useRef, useState } from 'react'
import type { NearbyRowState } from './nearbyState'
import { EMPTY_ROW } from './nearbyState'

export const ROW_HEIGHT = 64
const OVERSCAN = 10

export interface ResultRowProps {
  index: number
  target: number
  reachable: boolean
  nearby: NearbyRowState
  nearbyEnabled: boolean
  onNearbyDraftChange: (index: number, value: string) => void
  onNearbyQuery: (index: number, target: number) => void
}

function formatDeviation(deviation: number): string {
  return deviation > 0 ? `+${deviation}` : `${deviation}`
}

function NearbyVerdict({ nearby }: { nearby: NearbyRowState }) {
  return (
    <span className="nearby-verdict-group">
      {nearby.status === 'running' && (
        <span className="nearby-verdict running">查询中…</span>
      )}
      {nearby.status === 'done' && nearby.witness !== null && (
        <span className="nearby-verdict done">
          A={nearby.witness.a} · B={nearby.witness.b} · 偏差{' '}
          {formatDeviation(nearby.witness.deviation)}
        </span>
      )}
      {nearby.status === 'none' && (
        <span className="nearby-verdict none">容差内无可达规格</span>
      )}
      {nearby.invalidDraft && (
        <span className="nearby-verdict invalid">
          容差须为 0–1000 的整数（已保留上次结果）
        </span>
      )}
    </span>
  )
}

function ResultRowComponent({
  index,
  target,
  reachable,
  nearby,
  nearbyEnabled,
  onNearbyDraftChange,
  onNearbyQuery,
}: ResultRowProps) {
  const busy = nearby.status === 'running'
  return (
    <div
      className={`result-row ${reachable ? 'is-reachable' : 'is-unreachable'}`}
      style={{ top: index * ROW_HEIGHT }}
    >
      <span className="cell-index">#{index + 1}</span>
      <span className="cell-target">{target}</span>
      <span className="cell-verdict">{reachable ? 'true' : 'false'}</span>
      <span className="cell-nearby">
        <span className="nearby-controls">
          <input
            className="nearby-input"
            type="text"
            inputMode="numeric"
            aria-label="容差（微米）"
            placeholder="0–1000"
            value={nearby.draft}
            disabled={!nearbyEnabled || busy}
            onChange={(e) => onNearbyDraftChange(index, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onNearbyQuery(index, target)
            }}
          />
          <button
            type="button"
            className="nearby-button"
            disabled={!nearbyEnabled || busy}
            onClick={() => onNearbyQuery(index, target)}
          >
            查询
          </button>
        </span>
        <NearbyVerdict nearby={nearby} />
      </span>
    </div>
  )
}

const MemoizedRow = memo(ResultRowComponent)

interface VirtualResultsProps {
  targets: number[]
  reachable: boolean[]
  nearbyRows: Record<number, NearbyRowState>
  nearbyEnabled: boolean
  onNearbyDraftChange: (index: number, value: string) => void
  onNearbyQuery: (index: number, target: number) => void
}

export function VirtualResults({
  targets,
  reachable,
  nearbyRows,
  nearbyEnabled,
  onNearbyDraftChange,
  onNearbyQuery,
}: VirtualResultsProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(480)
  const totalCount = targets.length

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    setViewportHeight(el.clientHeight)
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setViewportHeight(entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Reset scroll when a fresh result set arrives.
  useEffect(() => {
    setScrollTop(0)
    if (viewportRef.current) viewportRef.current.scrollTop = 0
  }, [targets])

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2
  const end = Math.min(totalCount, start + visibleCount)
  const rows = []
  for (let i = start; i < end; i++) {
    rows.push(
      <MemoizedRow
        key={i}
        index={i}
        target={targets[i]}
        reachable={reachable[i]}
        nearby={nearbyRows[i] ?? EMPTY_ROW}
        nearbyEnabled={nearbyEnabled}
        onNearbyDraftChange={onNearbyDraftChange}
        onNearbyQuery={onNearbyQuery}
      />,
    )
  }

  return (
    <div
      className="results-viewport"
      ref={viewportRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="results-spacer" style={{ height: totalCount * ROW_HEIGHT }}>
        {rows}
      </div>
    </div>
  )
}
