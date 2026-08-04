import { useEffect, useMemo, useRef, useState } from 'react'
import { now as clock, timeOffset } from './debug'
import { DAY, pendingToEvents, replay, staleOneShots } from './engine'
import {
  drainPending,
  notificationSpecs,
  pushWidgetState,
  syncNotifications,
  takeNewTaskRequest,
  widgetPayload,
} from './native'
import { deleteTask, quitterAtelier, uid, update, useDB } from './store'
import type { Task } from './types'
import Balance from './ui/Balance'
import History from './ui/History'
import Settings from './ui/Settings'
import Shop from './ui/Shop'
import Stats from './ui/Stats'
import TaskEditor, { blankTask } from './ui/TaskEditor'
import TaskList from './ui/TaskList'
import TaskStats from './ui/TaskStats'
import Tuto, { tutoVu } from './ui/Tuto'
import { useCloseOnBack } from './ui/useCloseOnBack'

type Tab = 'tasks' | 'shop' | 'history' | 'stats'

const TABS: [Tab, string][] = [
  ['tasks', 'Tâches'],
  ['shop', 'Boutique'],
  ['history', 'Historique'],
  ['stats', 'Stats'],
]

export default function App() {
  const db = useDB()
  const [tab, setTab] = useState<Tab>('tasks')
  const [editing, setEditing] = useState<Task | null>(null)
  const [stats, setStats] = useState<Task | null>(null)
  const [tuto, setTuto] = useState(() => !tutoVu())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const balanceRef = useRef<HTMLElement | null>(null)

  // Le retour ramène à l'onglet des tâches avant de songer à quitter l'appli.
  useCloseOnBack(tab !== 'tasks', () => setTab('tasks'))

  // La couleur d'accentuation pilote toute la feuille de style.
  useEffect(() => {
    document.documentElement.style.setProperty('--go', db.settings.accent)
  }, [db.settings.accent])

  // Clavier ouvert : le bouton flottant recouvre le champ de saisie. La
  // WebView ne le dit pas, mais elle rétrécit le viewport — c'est le signal.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () =>
      document.body.classList.toggle('kbd', vv.height < window.innerHeight * 0.75)
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  // Fait basculer les échéances et les périodes de compteur au fil du temps.
  // `clock()` porte le décalage de l'atelier de debug, nul en usage normal.
  const [now, setNow] = useState(() => clock())
  useEffect(() => {
    const i = setInterval(() => setNow(clock()), 60_000)
    return () => clearInterval(i)
  }, [])

  // Le journal complet est rejoué : le solde n'est jamais stocké.
  const rep = useMemo(
    () => replay(db.events, db.tasks, now, db.settings.dayStart),
    [db.events, db.tasks, now, db.settings.dayStart],
  )
  const visibleTasks = useMemo(
    () => db.tasks.filter((t) => !t.deletedAt && !t.archived && !t.template),
    [db.tasks],
  )
  const modeles = useMemo(() => db.tasks.filter((t) => !t.deletedAt && t.template), [db.tasks])

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
    const stale = staleOneShots(db.tasks, rep, now, db.settings.dayStart)
    if (stale.length) stale.forEach(deleteTask)
  }, [db.tasks, rep, now, db.settings.dayStart])

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

  if (settingsOpen) {
    return <Settings onClose={() => setSettingsOpen(false)} onTuto={() => setTuto(true)} />
  }

  return (
    <div className="app">
      {/* Un décalage oublié ressemblerait à un bug : il s'annonce, et se coupe d'un tap. */}
      {timeOffset() !== 0 && (
        <button className="timewarp" onClick={() => void quitterAtelier()}>
          ⏱ debug : {timeOffset() > 0 ? '+' : '−'}
          {Math.round(Math.abs(timeOffset()) / DAY)} j — revenir au présent
        </button>
      )}

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
            dayStart={db.settings.dayStart}
            balanceRef={balanceRef}
            onEdit={setEditing}
            onStats={setStats}
            modeles={modeles}
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
        {tab === 'stats' && (
          <Stats
            entries={rep.entries}
            now={now}
            dayStart={db.settings.dayStart}
            weekStart={db.settings.weekStart}
          />
        )}
      </main>

      {tuto && <Tuto onClose={() => setTuto(false)} />}

      {stats && (
        <TaskStats
          task={stats}
          rep={rep}
          now={now}
          currency={db.settings.currency}
          dayStart={db.settings.dayStart}
          onEdit={() => {
            setEditing(stats)
            setStats(null)
          }}
          onClose={() => setStats(null)}
        />
      )}

      {editing && (
        <TaskEditor
          task={editing}
          state={rep.perTask.get(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
