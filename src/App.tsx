import { useEffect, useMemo, useRef, useState } from 'react'
import { pendingToEvents, replay, staleOneShots } from './engine'
import {
  drainPending,
  notificationSpecs,
  pushWidgetState,
  syncNotifications,
  takeNewTaskRequest,
  widgetPayload,
} from './native'
import { deleteTask, uid, update, useDB } from './store'
import type { Task } from './types'
import Balance from './ui/Balance'
import History from './ui/History'
import Settings from './ui/Settings'
import Shop from './ui/Shop'
import TaskEditor, { blankTask } from './ui/TaskEditor'
import TaskList from './ui/TaskList'

type Tab = 'tasks' | 'shop' | 'history'

const TABS: [Tab, string][] = [
  ['tasks', 'Tâches'],
  ['shop', 'Boutique'],
  ['history', 'Historique'],
]

export default function App() {
  const db = useDB()
  const [tab, setTab] = useState<Tab>('tasks')
  const [editing, setEditing] = useState<Task | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const balanceRef = useRef<HTMLElement | null>(null)

  // La couleur d'accentuation pilote toute la feuille de style.
  useEffect(() => {
    document.documentElement.style.setProperty('--go', db.settings.accent)
  }, [db.settings.accent])

  // Fait basculer les échéances et les périodes de compteur au fil du temps.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(i)
  }, [])

  // Le journal complet est rejoué : le solde n'est jamais stocké.
  const rep = useMemo(() => replay(db.events, db.tasks, now), [db.events, db.tasks, now])
  const visibleTasks = useMemo(
    () => db.tasks.filter((t) => !t.deletedAt && !t.archived),
    [db.tasks],
  )

  // Les taps faits sur un widget, appli fermée, rejoignent le journal. Même
  // mécanique append-only que le reste : rien ne se perd, rien ne double.
  useEffect(() => {
    const drain = async () => {
      const items = await drainPending()
      if (items.length) {
        update((d) => ({
          ...d,
          events: [...d.events, ...pendingToEvents(items, d.tasks, d.events, uid)],
        }))
      }
      // Raccourci « + » du widget liste : il ne peut qu'écrire une intention,
      // c'est l'appli qui ouvre réellement l'éditeur.
      if (await takeNewTaskRequest()) setEditing(blankTask(db.settings.defaultReward))
    }
    void drain()
    const onVisible = () => document.visibilityState === 'visible' && void drain()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [db.settings.defaultReward])

  // Les tâches à usage unique disparaissent le lendemain de leur validation.
  useEffect(() => {
    const stale = staleOneShots(db.tasks, rep, now)
    if (stale.length) stale.forEach(deleteTask)
  }, [db.tasks, rep, now])

  // On ne réécrit les widgets et les rappels que si leur contenu a bougé —
  // sinon le tick d'une minute les redessinerait en boucle.
  const widgetKey = useMemo(
    () => JSON.stringify(widgetPayload(rep, db.tasks, db.settings, now)),
    [rep, db.tasks, db.settings, now],
  )
  useEffect(() => void pushWidgetState(JSON.parse(widgetKey)), [widgetKey])

  const notifKey = useMemo(
    () => JSON.stringify(notificationSpecs(rep, db.tasks, now, db.settings.currency)),
    [rep, db.tasks, now, db.settings.currency],
  )
  useEffect(() => void syncNotifications(JSON.parse(notifKey)), [notifKey])

  if (settingsOpen) return <Settings onClose={() => setSettingsOpen(false)} />

  return (
    <div className="app">
      <Balance
        value={rep.balance}
        currency={db.settings.currency}
        label={db.settings.budgetLabel}
        innerRef={balanceRef}
      />

      <nav className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'tab tab--on' : 'tab'}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        <button className="tab tab--icon" onClick={() => setSettingsOpen(true)} aria-label="Réglages">
          ⚙
        </button>
      </nav>

      <main className="main">
        {tab === 'tasks' && (
          <TaskList
            tasks={visibleTasks}
            rep={rep}
            now={now}
            currency={db.settings.currency}
            balanceRef={balanceRef}
            onEdit={setEditing}
            onNew={() => setEditing(blankTask(db.settings.defaultReward))}
          />
        )}
        {tab === 'shop' && (
          <Shop
            items={db.shopItems.filter((s) => !s.deletedAt)}
            balance={rep.balance}
            currency={db.settings.currency}
            allowNegative={db.settings.allowNegative}
            balanceRef={balanceRef}
          />
        )}
        {tab === 'history' && <History entries={rep.entries} currency={db.settings.currency} />}
      </main>

      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
