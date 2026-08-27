import { useEffect, useRef, useState, type RefObject } from 'react'
import { fmt } from '../format'
import { reduced } from '../fx'

/** The balance climbs (or falls) instead of jumping at once. ~420 ms. */
function useCountUp(target: number) {
  const [shown, setShown] = useState(target)
  const current = useRef(target)

  useEffect(() => {
    if (reduced()) {
      current.current = target
      setShown(target)
      return
    }
    const from = current.current
    const start = performance.now()
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 420)
      const v = from + (target - from) * (1 - (1 - p) ** 3)
      current.current = v
      setShown(v)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target])

  return shown
}

type Props = {
  value: number
  currency: string
  label: string
  innerRef: RefObject<HTMLElement | null>
}

export default function Balance({ value, currency, label, innerRef }: Props) {
  const shown = useCountUp(value)
  return (
    <header className={`balance${value < 0 ? ' balance--neg' : ''}`} ref={innerRef}>
      <div className="balance__amount">
        {fmt(shown)}
        <span className="balance__cur">{currency}</span>
      </div>
      <div className="balance__label">{label}</div>
    </header>
  )
}
