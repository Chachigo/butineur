import { useState, type MouseEvent, type RefObject } from 'react'
import { now as clock } from '../debug'
import { fmt } from '../format'
import { coinFly, pop } from '../fx'
import { tr } from '../i18n'
import { addEvent, deleteShopItem, saveShopItem, uid, useDB } from '../store'
import type { ShopItem } from '../types'
import Icon from './Icon'
import IconPicker from './IconPicker'
import NumberInput from './NumberInput'
import { useCloseOnBack } from './useCloseOnBack'
import { SelectionBar, useLongPress, useSelection } from './useSelection'

type Props = {
  items: ShopItem[]
  balance: number
  currency: string
  allowNegative: boolean
  balanceRef: RefObject<HTMLElement | null>
}

export default function Shop({ items, balance, currency, allowNegative, balanceRef }: Props) {
  const [editing, setEditing] = useState<ShopItem | null>(null)
  const [freeOpen, setFreeOpen] = useState(false)
  const [freeAmount, setFreeAmount] = useState('')
  const [freeLabel, setFreeLabel] = useState('')
  const sel = useSelection(items, deleteShopItem)
  useCloseOnBack(sel.selecting, sel.stop)

  /** Refused by default: an interface guard, the log itself can go negative. */
  const tooExpensive = (amount: number) => !allowNegative && amount > balance

  const spend = (amount: number, label: string, shopItemId: string | undefined, el: HTMLElement) => {
    if (!(amount > 0) || tooExpensive(amount)) return
    addEvent({ id: uid(), ts: clock(), kind: 'spend', amount, label, shopItemId })
    coinFly(el, balanceRef.current, `−${fmt(amount)}`, true)
    pop(balanceRef.current, true)
  }

  const buy = (item: ShopItem) => (e: MouseEvent<HTMLButtonElement>) =>
    spend(item.price, item.name, item.id, e.currentTarget)

  /** Closes and clears: otherwise the abandoned input comes back on the next spending. */
  const closeFree = () => {
    setFreeOpen(false)
    setFreeAmount('')
    setFreeLabel('')
  }

  const spendFree = (e: MouseEvent<HTMLButtonElement>) => {
    const amount = +freeAmount.replace(',', '.')
    if (!(amount > 0)) return
    spend(amount, freeLabel.trim() || tr('history.defaultLabel'), undefined, e.currentTarget)
    closeFree()
  }

  return (
    <>
      <SelectionBar sel={sel} noun="sel.item" />

      {items.length === 0 && (
        <p className="empty">
          {tr('shop.empty')}
          <br />
          {tr('shop.emptyHint')}
        </p>
      )}

      <ul className="list">
        {items.map((item) => (
          <ShopRow
            key={item.id}
            item={item}
            currency={currency}
            balance={balance}
            tooExpensive={tooExpensive}
            onBuy={buy(item)}
            onEdit={() => setEditing(item)}
            sel={sel}
          />
        ))}
      </ul>

      <div className="free">
        <button className="btn free__open" onClick={() => setFreeOpen(true)}>
          {tr('shop.free')}
        </button>
      </div>

      {freeOpen && (
        <div className="sheet" onClick={closeFree}>
          <div className="sheet__panel" onClick={(e) => e.stopPropagation()}>
            <header className="sheet__head">
              <h2>{tr('shop.freeTitle')}</h2>
              <button className="sheet__x" onClick={closeFree} aria-label={tr('common.close')}>
                ✕
              </button>
            </header>

            <div className="sheet__body">
              <label className="field">
                <span className="field__label">{tr('shop.what')}</span>
                <input
                  className="input"
                  value={freeLabel}
                  onChange={(e) => setFreeLabel(e.target.value)}
                  placeholder={tr('shop.whatHint')}
                  aria-label={tr('history.label')}
                  autoFocus
                />
              </label>

              <label className="field">
                <span className="field__label">{tr('history.amount')}</span>
                <span className="field__row">
                  <input
                    className="input input--sm"
                    inputMode="decimal"
                    value={freeAmount}
                    onChange={(e) => setFreeAmount(e.target.value)}
                    placeholder="0"
                    aria-label={tr('history.amount')}
                  />
                  <span className="field__suffix">{currency}</span>
                </span>
              </label>

              {tooExpensive(+freeAmount.replace(',', '.')) && (
                <p className="hint hint--bad">{tr('shop.notEnough')}</p>
              )}
            </div>

            <footer className="sheet__foot">
              <button className="btn" onClick={closeFree}>
                {tr('common.cancel')}
              </button>
              <button
                className="btn btn--go"
                onClick={spendFree}
                disabled={
                  !(+freeAmount.replace(',', '.') > 0) || tooExpensive(+freeAmount.replace(',', '.'))
                }
              >
                {tr('shop.spend')}
              </button>
            </footer>
          </div>
        </div>
      )}

      {!sel.selecting && (
        <button className="fab" onClick={() => setEditing(blankItem())} aria-label={tr('shop.newItem')}>
          +
        </button>
      )}

      {editing && <ItemEditor item={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function ShopRow({
  item,
  currency,
  balance,
  tooExpensive,
  onBuy,
  onEdit,
  sel,
}: {
  item: ShopItem
  currency: string
  balance: number
  tooExpensive: (amount: number) => boolean
  onBuy: (e: MouseEvent<HTMLButtonElement>) => void
  onEdit: () => void
  sel: ReturnType<typeof useSelection>
}) {
  const selected = sel.selection?.has(item.id) ?? false
  const longPress = useLongPress(() => sel.start(item.id), !sel.selecting)

  return (
    <li className={`task${selected ? ' task--picked' : ''}`}>
      <button
        className="task__body"
        onClick={() => (sel.selecting ? sel.toggle(item.id) : onEdit())}
        {...longPress}
      >
        {sel.selecting && (
          <span className={`task__tick${selected ? ' task__tick--on' : ''}`} aria-hidden>
            {selected ? '✓' : ''}
          </span>
        )}
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

      {!sel.selecting && (
        <button
          className="task__go task__go--buy"
          onClick={onBuy}
          disabled={tooExpensive(item.price)}
          title={
            tooExpensive(item.price)
              ? tr('shop.tooDearTitle')
              : item.price > balance
                ? tr('shop.redTitle')
                : undefined
          }
        >
          {tooExpensive(item.price)
            ? tr('shop.tooDear')
            : item.price > balance
              ? tr('shop.buyWarn')
              : tr('shop.buy')}
        </button>
      )}
    </li>
  )
}

const blankItem = (): ShopItem => ({
  id: uid(),
  name: '',
  icon: '',
  price: 0,
  updatedAt: 0,
  deletedAt: null,
})

/** Same structure as the task editor: same fields, same buttons, same order. */
function ItemEditor({ item, onClose }: { item: ShopItem; onClose: () => void }) {
  const db = useDB()
  const [s, setS] = useState(item)
  const isNew = !db.shopItems.some((x) => x.id === item.id)
  const cur = db.settings.currency
  const canSave = !!s.name.trim() && s.price > 0

  useCloseOnBack(true, onClose)

  const save = () => {
    if (!canSave) return
    saveShopItem({ ...s, name: s.name.trim() })
    onClose()
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__panel" onClick={(e) => e.stopPropagation()}>
        <header className="sheet__head">
          <h2>{tr(isNew ? 'shop.newItem' : 'common.edit')}</h2>
          <button className="sheet__x" onClick={onClose} aria-label={tr('common.close')}>
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
              placeholder={tr('shop.itemName')}
              aria-label={tr('shop.name')}
            />
          </div>

          <label className="field">
            <span className="field__label">{tr('shop.price')}</span>
            <span className="field__row">
              <NumberInput
                className="input input--sm"
                value={s.price}
                min={0}
                placeholder="20"
                onChange={(price) => setS({ ...s, price })}
              />
              <span className="field__suffix">{cur}</span>
            </span>
          </label>
        </div>

        <footer className="sheet__foot">
          {isNew ? (
            <button className="btn" onClick={onClose}>
              {tr('common.cancel')}
            </button>
          ) : (
            <button
              className="btn btn--danger"
              onClick={() => {
                deleteShopItem(s.id)
                onClose()
              }}
            >
              {tr('common.delete')}
            </button>
          )}
          <button className="btn btn--go" onClick={save} disabled={!canSave}>
            {tr('common.save')}
          </button>
        </footer>
      </div>
    </div>
  )
}
