import { useState, type MouseEvent, type RefObject } from 'react'
import { fmt } from '../format'
import { coinFly, pop } from '../fx'
import { addEvent, deleteShopItem, saveShopItem, uid } from '../store'
import type { ShopItem } from '../types'
import Icon from './Icon'
import IconPicker from './IconPicker'
import NumberInput from './NumberInput'

type Props = {
  items: ShopItem[]
  balance: number
  currency: string
  allowNegative: boolean
  balanceRef: RefObject<HTMLElement | null>
}

export default function Shop({ items, balance, currency, allowNegative, balanceRef }: Props) {
  const [editing, setEditing] = useState<ShopItem | null>(null)
  const [freeAmount, setFreeAmount] = useState('')
  const [freeLabel, setFreeLabel] = useState('')

  /** Refusé par défaut : c'est un garde-fou d'interface, le journal sait aller en négatif. */
  const tooExpensive = (amount: number) => !allowNegative && amount > balance

  const spend = (amount: number, label: string, shopItemId: string | undefined, el: HTMLElement) => {
    if (!(amount > 0) || tooExpensive(amount)) return
    addEvent({ id: uid(), ts: Date.now(), kind: 'spend', amount, label, shopItemId })
    coinFly(el, balanceRef.current, `−${fmt(amount)}`, true)
    pop(balanceRef.current, true)
  }

  const buy = (item: ShopItem) => (e: MouseEvent<HTMLButtonElement>) =>
    spend(item.price, item.name, item.id, e.currentTarget)

  const spendFree = (e: MouseEvent<HTMLButtonElement>) => {
    const amount = +freeAmount.replace(',', '.')
    if (!(amount > 0)) return
    spend(amount, freeLabel.trim() || 'Dépense', undefined, e.currentTarget)
    setFreeAmount('')
    setFreeLabel('')
  }

  return (
    <>
      {items.length === 0 && (
        <p className="empty">
          Ta boutique est vide.
          <br />
          Ajoute les loisirs que tu veux t’offrir.
        </p>
      )}

      <ul className="list">
        {items.map((item) => (
          <li key={item.id} className="task">
            <button className="task__body" onClick={() => setEditing(item)}>
              <Icon className="task__icon" icon={item.icon ?? ''} fallback="🎁" />
              <span className="task__text">
                <span className="task__name">{item.name}</span>
                <span className="task__meta">
                  <em className="badge">
                    {fmt(item.price)} {currency}
                  </em>
                </span>
              </span>
            </button>
            <button
              className="task__go task__go--buy"
              onClick={buy(item)}
              disabled={tooExpensive(item.price)}
              title={
                tooExpensive(item.price)
                  ? 'Budget insuffisant — activable dans les Réglages'
                  : item.price > balance
                    ? 'Ça fera passer ton budget dans le rouge'
                    : undefined
              }
            >
              {tooExpensive(item.price) ? 'Trop cher' : item.price > balance ? '⚠ Acheter' : 'Acheter'}
            </button>
          </li>
        ))}
      </ul>

      <div className="free">
        <p className="hint">Dépense hors catalogue</p>
        <div className="field__row">
          <input
            className="input"
            value={freeLabel}
            onChange={(e) => setFreeLabel(e.target.value)}
            placeholder="Pour quoi ?"
            aria-label="Libellé de la dépense"
          />
          <input
            className="input input--sm"
            inputMode="decimal"
            value={freeAmount}
            onChange={(e) => setFreeAmount(e.target.value)}
            placeholder="0"
            aria-label="Montant"
          />
          <button
            className="btn btn--go"
            onClick={spendFree}
            disabled={
              !(+freeAmount.replace(',', '.') > 0) || tooExpensive(+freeAmount.replace(',', '.'))
            }
          >
            Dépenser
          </button>
        </div>
        {tooExpensive(+freeAmount.replace(',', '.')) && (
          <p className="hint">Budget insuffisant. Autorise le négatif dans les Réglages si tu veux forcer.</p>
        )}
      </div>

      <button className="fab" onClick={() => setEditing(blankItem())} aria-label="Nouvel article">
        +
      </button>

      {editing && <ItemEditor item={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

const blankItem = (): ShopItem => ({
  id: uid(),
  name: '',
  icon: '',
  price: 20,
  updatedAt: 0,
  deletedAt: null,
})

function ItemEditor({ item, onClose }: { item: ShopItem; onClose: () => void }) {
  const [s, setS] = useState(item)

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__panel" onClick={(e) => e.stopPropagation()}>
        <header className="sheet__head">
          <h2>Article</h2>
          <button className="sheet__x" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>

        <div className="sheet__body">
          <div className="field field--row">
            <IconPicker value={s.icon ?? ''} onChange={(icon) => setS({ ...s, icon })} fallback="🎁" />
            <input
              className="input"
              value={s.name}
              onChange={(e) => setS({ ...s, name: e.target.value })}
              placeholder="1 h de jeu vidéo"
              aria-label="Nom"
              autoFocus
            />
          </div>
          <label className="field">
            <span className="field__label">Prix</span>
            <NumberInput
              className="input input--sm"
              value={s.price}
              min={0}
              onChange={(price) => setS({ ...s, price })}
            />
          </label>
        </div>

        <footer className="sheet__foot">
          <button
            className="btn btn--danger"
            onClick={() => {
              deleteShopItem(s.id)
              onClose()
            }}
          >
            Supprimer
          </button>
          <button
            className="btn btn--go"
            disabled={!s.name.trim()}
            onClick={() => {
              saveShopItem({ ...s, name: s.name.trim() })
              onClose()
            }}
          >
            Enregistrer
          </button>
        </footer>
      </div>
    </div>
  )
}
