import { useState } from 'react'
import Icon, { phosphor } from './Icon'
import { PHOSPHOR_GROUPS } from './icons.generated'
import { useCloseOnBack } from './useCloseOnBack'

/**
 * Two banks: the Phosphor icons (the default, sober and consistent) and a
 * selection of emoji for what has no drawn equivalent — animals, specific food,
 * faces.
 */
// Same categories as the icon bank: you look in the same place in both. Emoji
// cover what a line drawing cannot render — faces, specific animals, named
// food.
const EMOJI_GROUPS: [string, string[]][] = [
  ['Maison', ['🧹', '🧼', '🧺', '🛏️', '🚿', '🛁', '🪣', '🍽️', '🗑️', '♻️', '🚽', '🧻', '🪠', '🧴', '🪥', '🧽', '🛋️', '🔧', '🪛', '🔨', '🧯', '💡', '🔑', '📦', '🛒', '👜']],
  ['Corps', ['🏃', '🏋️', '🧘', '🚴', '🤸', '💪', '🚶', '🏊', '🧠', '👁️', '💇', '☯️']],
  ['Santé', ['🩹', '💊', '💉', '🦷', '🩺', '😷', '🚭', '🧪', '🤒', '🧬']],
  ['Repas', ['💧', '🥤', '☕', '🍎', '🥗', '🍳', '🥦', '🍵', '🥕', '🍞', '🧀', '🍒', '🍕', '🍦', '🍚', '🍲', '👨‍🍳', '🥫', '🍫']],
  ['Fête', ['🎉', '🥳', '🎂', '🎁', '🍾', '🥂', '🎈', '🎊', '🍰', '🪅', '🕯️', '💃', '🕺', '🍷', '🍺', '🍸']],
  ['Travail', ['💼', '📚', '✏️', '📝', '📌', '📅', '🕐', '📞', '✉️', '💬', '🎓', '📈', '⚖️', '🏭']],
  ['Informatique', ['💻', '🖥️', '⌨️', '🖱️', '💾', '📁', '📂', '📄', '🔐', '🖨️', '📥', '🤖']],
  ['Loisirs', ['🎨', '🎸', '🎮', '📷', '🧩', '🎬', '📖', '🎧', '🌍', '🎲', '🎯', '🎤', '🔭', '🧶', '🎟️', '🎳', '📺', '🎥']],
  ['Transport', ['✈️', '🚲', '🚌', '🚗', '🚐', '⛵', '🧳', '⛽', '🛞', '🌉', '🛵', '🚕']],
  ['Vêtements', ['👕', '👖', '👗', '🧦', '👟', '👢', '👠', '🧢', '👓', '⌚', '🧥', '🧣']],
  ['Animaux', ['🐶', '🐱', '🐰', '🐹', '🐟', '🦎', '🐢', '🦜', '🐴', '🐝', '🐄', '🦋', '🐾', '🦴', '🪶']],
  ['Nature', ['🪴', '🌿', '☀️', '🌙', '🌈', '⛰️', '⛺', '☂️', '🌱', '🌳', '❄️', '🌊']],
  ['Divers', ['⭐', '✨', '🔥', '⚡', '❤️', '✅', '🎯', '💎', '🏆', '🥇', '🚩', '🔔', '🚀', '👻', 'ℹ️', '👤', '🪙', '🔒', '😤', '🤩']],
]

type Tab = 'ph' | 'emoji'

export default function IconPicker({
  value,
  onChange,
  fallback,
}: {
  value: string
  onChange: (icon: string) => void
  fallback: string
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('emoji')

  useCloseOnBack(open, () => setOpen(false))

  const choose = (icon: string) => {
    onChange(icon)
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        className="iconpick"
        onClick={() => setOpen(true)}
        aria-label="Choisir une icône"
      >
        <Icon icon={value} fallback={fallback} />
      </button>

      {open && (
        <div className="sheet" onClick={() => setOpen(false)}>
          <div className="sheet__panel" onClick={(e) => e.stopPropagation()}>
            <header className="sheet__head">
              <h2>Icône</h2>
              <button className="sheet__x" onClick={() => setOpen(false)} aria-label="Fermer">
                ✕
              </button>
            </header>

            <nav className="tabs tabs--inner" role="tablist">
              <button
                role="tab"
                aria-selected={tab === 'emoji'}
                className={tab === 'emoji' ? 'tab tab--on' : 'tab'}
                onClick={() => setTab('emoji')}
              >
                Emoji
              </button>
              <button
                role="tab"
                aria-selected={tab === 'ph'}
                className={tab === 'ph' ? 'tab tab--on' : 'tab'}
                onClick={() => setTab('ph')}
              >
                Icônes
              </button>
            </nav>

            <div className="sheet__body">
              {tab === 'ph'
                ? PHOSPHOR_GROUPS.map(([label, icons]) => (
                    <section key={label}>
                      <p className="hint">{label}</p>
                      <div className="iconpick__grid">
                        {icons.map(([name, chars]) => (
                          <button
                            key={name}
                            type="button"
                            title={name}
                            className={`iconpick__cell${
                              value === phosphor(chars) ? ' iconpick__cell--on' : ''
                            }`}
                            onClick={() => choose(phosphor(chars))}
                          >
                            <Icon icon={phosphor(chars)} fallback="" />
                          </button>
                        ))}
                      </div>
                    </section>
                  ))
                : EMOJI_GROUPS.map(([label, icons]) => (
                    <section key={label}>
                      <p className="hint">{label}</p>
                      <div className="iconpick__grid">
                        {icons.map((e) => (
                          <button
                            key={e}
                            type="button"
                            className={`iconpick__cell${value === e ? ' iconpick__cell--on' : ''}`}
                            onClick={() => choose(e)}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}

              <button className="link" onClick={() => choose('')}>
                Aucune icône
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
