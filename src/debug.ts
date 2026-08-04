import { DAY } from './engine'
import type { Event, Task } from './types'

/**
 * Atelier de debug. Il n'existe que pour observer en dix secondes ce qui
 * demanderait des jours : échéances, séries rompues, remise à zéro des
 * compteurs, rappels programmés.
 *
 * Le décalage vit dans `localStorage`, pas dans les réglages : c'est un outil
 * d'appareil, il n'a rien à faire dans une sauvegarde ni dans la synchro du
 * lot 3.
 */
const KEY = 'debugOffset'

export const timeOffset = (): number => Number(localStorage.getItem(KEY)) || 0

/** L'heure que voit l'appli. Sans décalage, c'est `Date.now()` tout court. */
export const now = (): number => Date.now() + timeOffset()

/**
 * Un rechargement suffit à tout remettre d'aplomb : rien de dérivé n'est
 * stocké, le solde et les cycles se recalculent du journal à la lecture.
 */
export function setTimeOffset(ms: number): void {
  if (ms) localStorage.setItem(KEY, String(ms))
  else localStorage.removeItem(KEY)
  location.reload()
}

/** Les événements fabriqués se reconnaissent à leur identifiant, pour pouvoir les retirer. */
const PREFIX = 'dbg-'
export const isDebugEvent = (id: string) => id.startsWith(PREFIX)

/**
 * `n` validations d'affilée, une par cycle, la dernière à l'instant.
 * Ce sont de vrais événements : la série qu'ils produisent est calculée par le
 * moteur comme n'importe quelle autre, sinon la simulation ne prouverait rien.
 */
export function fakeStreak(task: Task, n: number, at = now()): Event[] {
  const every = Math.max(1, task.repeat?.everyDays ?? 1)
  return Array.from({ length: Math.max(1, n) }, (_, i) => ({
    id: `${PREFIX}${task.id}-${i}-${at}`,
    ts: at - (n - 1 - i) * every * DAY,
    kind: 'complete' as const,
    taskId: task.id,
    baseReward: task.reward,
    penaltyFactor: 1,
    penaltyFlat: 0,
  }))
}

/**
 * De quoi annuler tout ce que l'atelier a fabriqué. On n'efface rien du
 * journal — on empile des `undo`, exactement comme le bouton d'annulation :
 * le solde revient au centime près et la règle d'or tient.
 */
export function undoDebugEvents(events: Event[], at = Date.now()): Event[] {
  const annules = new Set(events.filter((e) => e.kind === 'undo').map((e) => e.targetId))
  return events
    // Les annulations portent le même préfixe : sans ce garde-fou, chaque clic
    // annulerait les annulations précédentes et le journal enflerait sans fin.
    .filter((e) => e.kind !== 'undo' && isDebugEvent(e.id) && !annules.has(e.id))
    .map((e, i) => ({ id: `${PREFIX}undo-${at}-${i}`, ts: at, kind: 'undo' as const, targetId: e.id }))
}
