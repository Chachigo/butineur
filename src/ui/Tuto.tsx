import { useState } from 'react'
import { tr, type Key } from '../i18n'
import { useCloseOnBack } from './useCloseOnBack'

/**
 * The guided tour, on first launch and replayable from the settings. The flag
 * lives in `localStorage`: it belongs to the device, it has no business in a
 * backup nor in the sync.
 */
const KEY = 'tutoVu'

export const tutoVu = (): boolean => localStorage.getItem(KEY) === '1'
export const marquerTutoVu = () => localStorage.setItem(KEY, '1')

const PAGES: [string, Key, Key][] = [
  ['🐝', 'tuto.1.title', 'tuto.1.text'],
  ['🎁', 'tuto.2.title', 'tuto.2.text'],
  ['🔁', 'tuto.3.title', 'tuto.3.text'],
  ['🔥', 'tuto.4.title', 'tuto.4.text'],
  ['📱', 'tuto.5.title', 'tuto.5.text'],
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
          <h2 className="tuto__titre">{tr(titre)}</h2>
          <p className="tuto__texte">{tr(texte)}</p>
          <div className="tuto__points">
            {PAGES.map((_, i) => (
              <span key={i} className={`tuto__point${i === page ? ' tuto__point--on' : ''}`} />
            ))}
          </div>
        </div>

        <footer className="sheet__foot">
          <button className="btn" onClick={fermer}>
            {tr(dernier ? 'tuto.start' : 'tuto.skip')}
          </button>
          {!dernier && (
            <button className="btn btn--go" onClick={() => setPage(page + 1)}>
              {tr('tuto.next')}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
