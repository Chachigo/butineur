import { useState } from 'react'
import { useCloseOnBack } from './useCloseOnBack'

/**
 * The guided tour, on first launch and replayable from the settings. The flag
 * lives in `localStorage`: it belongs to the device, it has no business in a
 * backup nor in the sync.
 */
const KEY = 'tutoVu'

export const tutoVu = (): boolean => localStorage.getItem(KEY) === '1'
export const marquerTutoVu = () => localStorage.setItem(KEY, '1')

const PAGES: [string, string, string][] = [
  [
    '🐝',
    'Les tâches paient',
    'Chaque tâche faite crédite ton budget loisirs. Le montant est à toi : cinq euros pour la vaisselle si ça te motive.',
  ],
  [
    '🎁',
    'La boutique dépense',
    'Tu y ranges ce que tu veux t’offrir, avec son prix. Acheter retire du budget — et rien ne t’empêche d’ajouter une dépense hors catalogue.',
  ],
  [
    '🔁',
    'Le rythme décide de tout',
    'Chaque jour, chaque semaine, chaque mois, ou tous les N jours. C’est lui qui dit quand la tâche revient, quand elle est en retard, et quand elle redevient disponible.',
  ],
  [
    '🔥',
    'La série récompense la régularité',
    'Elle monte d’un cran par cycle tenu. Un jour de retard la met en gel 🧊 sans la casser ; au-delà, elle repart de zéro.',
  ],
  [
    '📱',
    'Les widgets sans ouvrir l’appli',
    'Le solde, un compteur, la liste des tâches à valider. Un tap depuis l’écran d’accueil compte même appli fermée, avec l’heure du geste.',
  ],
]

export default function Tuto({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(0)
  useCloseOnBack(true, onClose)

  const [emoji, titre, texte] = PAGES[page]
  const dernier = page === PAGES.length - 1

  const fermer = () => {
    marquerTutoVu()
    onClose()
  }

  return (
    <div className="sheet" onClick={fermer}>
      <div className="sheet__panel" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__body tuto">
          <span className="tuto__emoji">{emoji}</span>
          <h2 className="tuto__titre">{titre}</h2>
          <p className="tuto__texte">{texte}</p>
          <div className="tuto__points">
            {PAGES.map((_, i) => (
              <span key={i} className={`tuto__point${i === page ? ' tuto__point--on' : ''}`} />
            ))}
          </div>
        </div>

        <footer className="sheet__foot">
          <button className="btn" onClick={fermer}>
            {dernier ? 'Commencer' : 'Passer'}
          </button>
          {!dernier && (
            <button className="btn btn--go" onClick={() => setPage(page + 1)}>
              Suivant
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
