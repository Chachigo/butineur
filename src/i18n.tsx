import en from './lang/en'
import fr from './lang/fr'

const LANGS = { en, fr }

export type Lang = keyof typeof LANGS
export type Key = keyof typeof en

const KEY = 'butineur.lang'

/**
 * The chosen language, or `system` to follow the phone. Kept in `localStorage`
 * and not in the settings: it belongs to the device, it has no business in a
 * backup nor in the batch-3 sync.
 */
export const langSetting = (): Lang | 'system' => {
  // `globalThis` rather than a bare `localStorage`: the engine tests run under
  // plain node, where neither it nor `navigator` exists.
  const v = globalThis.localStorage?.getItem(KEY)
  return v === 'en' || v === 'fr' ? v : 'system'
}

/**
 * The language actually used, decided once at load time.
 *
 * ponytail: changing it reloads the page rather than re-rendering the tree.
 * Nothing derived is stored, so a reload costs nothing and saves threading a
 * context through every component — for a setting one changes about once.
 */
export const lang: Lang = (() => {
  const chosen = langSetting()
  if (chosen !== 'system') return chosen
  return globalThis.navigator?.language.startsWith('fr') ? 'fr' : 'en'
})()

export async function setLang(l: Lang | 'system'): Promise<void> {
  localStorage.setItem(KEY, l)
  const { flush } = await import('./store')
  await flush()
  location.reload()
}

// Screen readers pick their pronunciation from this: the app switches language
// without a server, so the attribute has to follow.
globalThis.document?.documentElement.setAttribute('lang', lang)

const dict = LANGS[lang]

/** `tr('day.late', { n })` — `{name}` placeholders are substituted. */
export function tr(key: Key, vars?: Record<string, string | number>): string {
  const s: string = dict[key] ?? en[key]
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : s
}

/**
 * `*bold*` inside a translated string becomes a `<strong>`.
 *
 * The alternative was splitting a sentence into fragments around its markup —
 * and no other language could then reorder them. One key, one whole sentence.
 */
export function rich(s: string) {
  return s.split(/\*(.+?)\*/).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))
}

const plural = new Intl.PluralRules(lang)

/**
 * Plural form of a key: `trn('due.days', 3)` looks up `due.days.other`.
 * `Intl.PluralRules` knows the rules of every language, we do not have to.
 */
export function trn(key: string, n: number, vars?: Record<string, string | number>): string {
  return tr(`${key}.${plural.select(n)}` as Key, { n, ...vars })
}
