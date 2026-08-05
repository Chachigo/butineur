import { useEffect, useRef } from 'react'
import { DAY, dayNum, missedCycles, type Replay } from '../engine'
import { fmt } from '../format'
import type { LedgerEntry, Task } from '../types'

const JOURS_ABR = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']
const MOIS = new Intl.DateTimeFormat('fr-FR', { month: 'short' })

const SEMAINES = 53

/**
 * Une case par jour sur l'année, toutes tâches confondues — l'onglet
 * remplace le graphe qui vivait sur chaque fiche de tâche. Tout vient du
 * rejeu (`rep.entries`, `rep.perTask`) : rien à recalculer nous-mêmes quand
 * l'atelier de debug retire ses événements de test, tout suit comme le solde.
 */
export default function Stats({
  tasks,
  entries,
  perTask,
  now,
  currency,
  dayStart,
  weekStart,
}: {
  tasks: Task[]
  entries: LedgerEntry[]
  perTask: Replay['perTask']
  now: number
  currency: string
  dayStart: number
  weekStart: 0 | 1
}) {
  const compte = new Map<number, number>()
  const palier = new Set<number>()
  let gagne = 0
  let nbTaches = 0
  for (const e of entries) {
    const j = dayNum(e.ts, dayStart)
    if (e.kind === 'complete' || (e.kind === 'count' && e.label.endsWith('objectif atteint'))) {
      compte.set(j, (compte.get(j) ?? 0) + 1)
      nbTaches++
    }
    if (e.kind === 'complete' || e.kind === 'count') gagne += e.total
    if (e.tierBonus > 0) palier.add(j)
  }

  const premiere = entries.reduce((min, e) => Math.min(min, e.ts), now)
  const mois = entries.length
    ? (now - premiere) / DAY < 1
      ? 1
      : (new Date(now).getFullYear() - new Date(premiere).getFullYear()) * 12 +
        (new Date(now).getMonth() - new Date(premiere).getMonth()) +
        1
    : 1
  const loupees = missedCycles(tasks, entries, now, dayStart)
  const record = Math.max(0, ...[...perTask.values()].map((s) => s.bestStreak))

  const ordre = weekStart === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]
  const aujourdhui = dayNum(now, dayStart)
  const dowAujourdhui = new Date(aujourdhui * DAY).getUTCDay()
  const finSemaine = aujourdhui + (6 - ordre.indexOf(dowAujourdhui))
  const premierJour = finSemaine - SEMAINES * 7 + 1

  const colonnes = Array.from({ length: SEMAINES }, (_, c) => {
    const jours = ordre.map((_dow, r) => premierJour + c * 7 + r)
    const mois = MOIS.format(new Date(jours[0] * DAY))
    return { mois, jours }
  })

  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroller.current?.scrollTo({ left: scroller.current.scrollWidth })
  }, [])

  return (
    <>
      <div className="stats">
        <Chiffre valeur={`${fmt(gagne)} ${currency}`} legende="gagné en tout" />
        <Chiffre valeur={`${fmt(gagne / mois)} ${currency}`} legende="par mois en moyenne" />
        <Chiffre valeur={String(nbTaches)} legende="tâches faites" />
        <Chiffre valeur={String(loupees)} legende="cycles manqués" />
        <Chiffre valeur={String(record)} legende="plus longue série" />
      </div>

      <p className="hint">L'année écoulée, toutes tâches confondues.</p>
      <div className="heatmap" ref={scroller}>
        <div className="heatmap__jours">
          {ordre.map((dow) => (
            <span key={dow} className="heatmap__label">
              {JOURS_ABR[dow]}
            </span>
          ))}
        </div>
        <div className="heatmap__corps">
          <div className="heatmap__mois">
            {colonnes.map((c, i) => (
              <span key={i} className="heatmap__mois-item">
                {i === 0 || c.mois !== colonnes[i - 1].mois ? c.mois : ''}
              </span>
            ))}
          </div>
          <div className="heatmap__grille">
            {colonnes.map((c, i) => (
              <div key={i} className="heatmap__colonne">
                {c.jours.map((j) => (
                  <span
                    key={j}
                    className={`heatmap__case heatmap__case--l${niveau(compte.get(j) ?? 0)}${
                      palier.has(j) ? ' heatmap__case--palier' : ''
                    }${j > aujourdhui ? ' heatmap__case--futur' : ''}`}
                    title={new Date((j + 0.5) * DAY).toLocaleDateString('fr-FR')}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

const Chiffre = ({ valeur, legende }: { valeur: string; legende: string }) => (
  <div className="stats__cell">
    <span className="stats__value">{valeur}</span>
    <span className="stats__label">{legende}</span>
  </div>
)

function niveau(n: number): 0 | 1 | 2 | 3 | 4 {
  if (n <= 0) return 0
  if (n === 1) return 1
  if (n === 2) return 2
  if (n <= 4) return 3
  return 4
}
