import { useRef, useState } from 'react'

/**
 * Sélection multiple par appui long, partagée par la liste de tâches et la
 * boutique. `null` = pas en sélection ; un ensemble vide reste un mode actif,
 * on peut donc tout décocher sans quitter.
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

/** Déclenche l'entrée en sélection après un appui maintenu. */
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

export function SelectionBar({ sel, noun }: { sel: Selection; noun: [string, string] }) {
  if (!sel.selection) return null
  const n = sel.selection.size
  return (
    <div className="selbar">
      <button className="selbar__x" onClick={sel.stop} aria-label="Quitter la sélection">
        ✕
      </button>
      <span className="selbar__count">
        {n} {n > 1 ? noun[1] : noun[0]}
      </span>
      <button className="selbar__all" onClick={sel.selectAll}>
        Tout
      </button>
      <button className="btn btn--danger" onClick={sel.removeSelected} disabled={n === 0}>
        Supprimer
      </button>
    </div>
  )
}
