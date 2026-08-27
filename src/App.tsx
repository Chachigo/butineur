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
import { tr, type Key } from './i18n'
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

const TABS: [Tab, Key][] = [
  ['tasks', 'tabs.tasks'],
  ['shop', 'tabs.shop'],
  ['history', 'tabs.history'],
  ['stats', 'tabs.stats'],
]

export default function App() {
  const db = useDB()
  const [tab, setTab] = useState<Tab>('tasks')
  const [editing, setEditing] = useState<Task | null>(null)
  const [stats, setStats] = useState<Task | null>(null)
  const [tuto, setTuto] = useState(() => !tutoVu())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const balanceRef = useRef<HTMLElement | null>(null)

  // Back goes to the tasks tab before even thinking about leaving the app.
  useCloseOnBack(tab !== 'tasks', () => setTab('tasks'))

  const tabs = db.settings.showStats ? TABS : TABS.filter(([id]) => id !== 'stats')
  // The tab can vanish while it is being viewed, from the settings.
  useEffect(() => {
    if (tab === 'stats' && !db.settings.showStats) setTab('tasks')
  }, [tab, db.settings.showStats])

  // The accent color drives the whole stylesheet.
  useEffect(() => {
    document.documentElement.style.setProperty('--go', db.settings.accent)
  }, [db.settings.accent])

  // Keyboard open: the floating button covers the input field. The WebView does
  // not say so, but it shrinks the viewport — that is the signal.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () =>
      document.body.classList.toggle('kbd', vv.height < window.innerHeight * 0.75)
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  // Flips deadlines and counter periods over as time passes.
  // `clock()` carries the debug workshop offset, zero in normal use.
  const [now, setNow] = useState(() => clock())
  useEffect(() => {
    const i = setInterval(() => setNow(clock()), 60_000)
    return () => clearInterval(i)
  }, [])

  // The whole log is replayed: the balance is never stored.
  const rep = useMemo(
    () => replay(db.events, db.tasks, now, db.settings.dayStart),
    [db.events, db.tasks, now, db.settings.dayStart],
  )
  const visibleTasks = useMemo(
    () => db.tasks.filter((t) => !t.deletedAt && !t.archived && !t.template),
    [db.tasks],
  )
  const modeles = useMemo(() => db.tasks.filter((t) => !t.deletedAt && t.template), [db.tasks])

  // Taps made on a widget with the app closed join the log. Same append-only
  // mechanics as the rest: nothing is lost, nothing is doubled.
  useEffect(() => {
    const drain = async () => {
      const items = await drainPending()
      if (items.length) {
        update((d) => ({
          ...d,
          events: [...d.events, ...pendingToEvents(items, d.tasks, d.events, uid)],
        }))
      }
      // The "+" shortcut of the list widget: it can only write an intent, the
      // app is what actually opens the editor.
      if (await takeNewTaskRequest()) setEditing(blankTask(db.settings.defaultReward))
    }
    void drain()
    const onVisible = () => document.visibilityState === 'visible' && void drain()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [db.settings.defaultReward])

  // One-shot tasks disappear the day after they are completed.
  useEffect(() => {
    const stale = staleOneShots(db.tasks, rep, now, db.settings.dayStart)
    if (stale.length) stale.forEach(deleteTask)
  }, [db.tasks, rep, now, db.settings.dayStart])

  // Widgets and reminders are only rewritten when their content has changed —
  // otherwise the one-minute tick would redraw them in a loop.
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
          {tr('app.timewarp', {
            sign: timeOffset() > 0 ? '+' : '−',
            n: Math.round(Math.abs(timeOffset()) / DAY),
          })}
        </button>
      )}

      <Balance
        value={rep.balance}
        currency={db.settings.currency}
        label={db.settings.budgetLabel}
        innerRef={balanceRef}
      />

      <nav className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'tab tab--on' : 'tab'}
            onClick={() => setTab(id)}
          >
            {tr(label)}
          </button>
        ))}
        <button className="tab tab--icon" onClick={() => setSettingsOpen(true)} aria-label={tr('app.settings')}>
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
            tasks={visibleTasks}
            entries={rep.entries}
            perTask={rep.perTask}
            now={now}
            currency={db.settings.currency}
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
