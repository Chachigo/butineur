import confetti from 'canvas-confetti'

/** Accessibilité : aucune animation ne doit être imposée. */
export const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const center = (el: HTMLElement) => {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/**
 * La pièce s'envole entre la tâche et le solde. ~380 ms.
 *
 * Le sens suit l'argent : un gain va vers le solde, une perte en part. Les
 * appelants passent toujours les deux extrémités dans le même ordre, c'est le
 * signe qui décide — sinon chaque site d'appel devrait y penser.
 */
export function coinFly(
  task: HTMLElement | null,
  balance: HTMLElement | null,
  label: string,
  negative = false,
) {
  const from = negative ? balance : task
  const to = negative ? task : balance
  if (!from || !to || reduced()) return
  const a = center(from)
  const b = center(to)
  const el = document.createElement('div')
  el.className = `coin${negative ? ' coin--neg' : ''}`
  el.textContent = label
  el.style.left = `${a.x}px`
  el.style.top = `${a.y}px`
  document.body.appendChild(el)

  el.animate(
    [
      { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.15)', opacity: 1, offset: 0.25 },
      { transform: `translate(calc(-50% + ${b.x - a.x}px), calc(-50% + ${b.y - a.y}px)) scale(.4)`, opacity: 0 },
    ],
    { duration: 380, easing: 'cubic-bezier(.4,0,.7,.2)' },
  ).finished.finally(() => el.remove())
}

/** Gerbe de confettis pour un palier ou une série franchie. */
export function burst(el?: HTMLElement | null) {
  if (reduced()) return
  const o = el ? center(el) : null
  void confetti({
    particleCount: 55,
    spread: 65,
    startVelocity: 26,
    ticks: 55,
    scalar: 0.75,
    disableForReducedMotion: true,
    origin: o ? { x: o.x / innerWidth, y: o.y / innerHeight } : { y: 0.35 },
  })
}

/** Petit à-coup sur un élément — validation, dépense, incrément. */
export function pop(el: HTMLElement | null, negative = false) {
  if (!el || reduced()) return
  el.animate(
    [
      { transform: 'scale(1)' },
      { transform: `scale(${negative ? 0.94 : 1.08})` },
      { transform: 'scale(1)' },
    ],
    { duration: 260, easing: 'ease-out' },
  )
}
