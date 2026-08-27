import { useRef, useState } from 'react'
import { tr, trn } from '../i18n'

/**
 * Multi-selection by long press, shared by the task list and the shop.
 * `null` = not selecting; an empty set is still an active mode, so everything
 * can be unchecked without leaving it.
 */
export function useSelection<T extends { id: string }>(items: T[], remove: (id: string) => void) {
  const [selection, setSelection] = useState<Set<string> | null>(null)

  const toggle = (id: string) =>
    setSelection((prev) => {
      const next = new Set(prev ?? [])
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return {
    selection,
    selecting: selection !== null,
    toggle,
    start: (id: string) => setSelection(new Set([id])),
    stop: () => setSelection(null),
    selectAll: () => setSelection(new Set(items.map((i) => i.id))),
    removeSelected: () => {
      selection?.forEach(remove)
      setSelection(null)
    },
  }
}

export type Selection = ReturnType<typeof useSelection>

/** Enters selection mode after a press held down. */
export function useLongPress(onLongPress: () => void, active: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const cancel = () => clearTimeout(timer.current)

  return {
    onPointerDown: () => {
      if (!active) return
      timer.current = setTimeout(onLongPress, 450)
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  }
}

export function SelectionBar({ sel, noun }: { sel: Selection; noun: string }) {
  if (!sel.selection) return null
  const n = sel.selection.size
  return (
    <div className="selbar">
      <button className="selbar__x" onClick={sel.stop} aria-label={tr('sel.leave')}>
        ✕
      </button>
      <span className="selbar__count">{trn(noun, n)}</span>
      <button className="selbar__all" onClick={sel.selectAll}>
        {tr('sel.all')}
      </button>
      <button className="btn btn--danger" onClick={sel.removeSelected} disabled={n === 0}>
        {tr('common.delete')}
      </button>
    </div>
  )
}
