// Injected into the page (Vite dev): replaces the database with a demo set.
// No personal data — generic tasks and leisure items.
(async () => {
  // Full URL: injected through the debug protocol, this code has no base URL,
  // and an absolute path would have nothing to resolve against.
  const { PHOSPHOR_GROUPS } = await import(new URL('/src/ui/icons.generated.ts', location.href).href)
  const CHARS = Object.fromEntries(PHOSPHOR_GROUPS.flatMap(([, l]) => l))
  const ph = (n) => 'ph:' + CHARS[n]

  const DAY = 86400000
  const now = Date.now()
  let n = 0
  const uid = () => `demo-${++n}`
  // A given day, at a given hour.
  const at = (daysAgo, h = 9, m = 0) => {
    const d = new Date(now - daysAgo * DAY)
    d.setHours(h, m, 0, 0)
    return +d
  }
  const iso = (daysFromNow, h, m = 0) => {
    const d = new Date(now + daysFromNow * DAY)
    d.setHours(h, m, 0, 0)
    return d.toISOString()
  }
  const base = { archived: false, updatedAt: now, deletedAt: null, cheer: false, remind: null }

  const tasks = [
    {
      ...base,
      id: 'vaisselle',
      name: 'Vaisselle',
      icon: ph('fork-knife'),
      reward: 2,
      repeat: { everyDays: 1 },
      counter: null,
      due: { at: iso(0, 21, 0), penalty: { kind: 'none' } },
      streak: { tiers: [{ at: 7, bonus: 5 }, { at: 30, bonus: 20 }], multiplier: null },
    },
    {
      ...base,
      id: 'eau',
      name: 'Boire de l’eau',
      icon: ph('drop'),
      reward: 1.5,
      repeat: { everyDays: 1 },
      counter: { target: 8, unit: 'verres', tiers: [{ at: 4, bonus: 0.5 }] },
      due: null,
      streak: null,
      remind: { kind: 'time', time: '14:00' },
    },
    {
      ...base,
      id: 'sport',
      name: '20 minutes de sport',
      icon: ph('barbell'),
      reward: 3,
      repeat: { everyDays: 2 },
      counter: null,
      due: { at: iso(0, 20, 0), penalty: { kind: 'none' } },
      streak: { tiers: [{ at: 10, bonus: 10 }], multiplier: { perStep: 0.05, cap: 1.5 } },
    },
    {
      ...base,
      id: 'aspirateur',
      name: 'Passer l’aspirateur',
      icon: ph('broom'),
      reward: 5,
      repeat: { everyDays: 7, weekday: 6 },
      counter: null,
      due: { at: iso(0, 19, 0), penalty: { kind: 'percent', percent: 25 } },
      streak: { tiers: [{ at: 4, bonus: 8 }], multiplier: null },
    },
    {
      ...base,
      id: 'poubelles',
      name: 'Sortir les poubelles',
      icon: ph('trash'),
      reward: 1.5,
      repeat: { everyDays: 7, weekday: 2 },
      counter: null,
      due: { at: iso(0, 19, 30), penalty: { kind: 'flat', amount: 1 } },
      streak: null,
    },
    {
      ...base,
      id: 'arroser',
      name: 'Arroser les plantes',
      icon: ph('plant'),
      reward: 1,
      repeat: { everyDays: 3 },
      counter: null,
      due: { at: iso(0, 18, 0), penalty: { kind: 'none' } },
      streak: null,
    },
    {
      ...base,
      id: 'bureau',
      name: 'Ranger le bureau',
      icon: ph('desktop'),
      reward: 8,
      repeat: null,
      counter: null,
      due: { at: iso(1, 23, 59), penalty: { kind: 'decay', percentPerDay: 10 } },
      streak: null,
    },
    { ...base, id: 'lessive', name: 'Lessive', icon: ph('washing-machine'), reward: 3, repeat: null, counter: null, due: null, streak: null, template: true },
    { ...base, id: 'courses', name: 'Courses', icon: ph('shopping-cart'), reward: 4, repeat: null, counter: null, due: null, streak: null, template: true },
  ]

  const shopItems = [
    { id: 's1', name: 'Soirée ciné', icon: ph('film-slate'), price: 15, updatedAt: now, deletedAt: null },
    { id: 's2', name: 'Jeu vidéo', icon: ph('game-controller'), price: 25, updatedAt: now, deletedAt: null },
    { id: 's3', name: 'Livre', icon: ph('book-open'), price: 12, updatedAt: now, deletedAt: null },
    { id: 's4', name: 'Café en terrasse', icon: ph('coffee'), price: 4, updatedAt: now, deletedAt: null },
    { id: 's5', name: 'Resto', icon: ph('fork-knife'), price: 30, updatedAt: now, deletedAt: null },
    { id: 's6', name: 'Week-end', icon: ph('tent'), price: 120, updatedAt: now, deletedAt: null },
  ]

  const events = []
  const done = (taskId, daysAgo, baseReward, h = 9) =>
    events.push({ id: uid(), ts: at(daysAgo, h, 15), kind: 'complete', taskId, baseReward, penaltyFactor: 1, penaltyFlat: 0 })

  // Dishes: 46 days, two old misses — the current streak is worth 21.
  for (let d = 45; d >= 1; d--) if (d !== 24 && d !== 23) done('vaisselle', d, 2, 20)
  // Sport: every other day, a few gaps.
  for (let d = 44; d >= 1; d -= 2) if (d !== 18 && d !== 34) done('sport', d, 3, 18)
  // Watering: every 3 days.
  for (let d = 45; d >= 2; d -= 3) done('arroser', d, 1, 11)
  // Weekly ones: we land back on the right day of the week.
  const jour = new Date(now).getDay()
  for (let d = (jour + 1) % 7 || 7; d <= 45; d += 7) done('aspirateur', d, 5, 15)
  for (let d = (jour + 5) % 7 || 7; d <= 45; d += 7) done('poubelles', d, 1.5, 19)
  // Water counter: 8 glasses a day, and 5 out of 8 today.
  for (let d = 30; d >= 1; d--)
    for (let i = 0; i < 8; i++) events.push({ id: uid(), ts: at(d, 8 + i, 30), kind: 'count', taskId: 'eau', delta: 1 })
  for (let i = 0; i < 5; i++) events.push({ id: uid(), ts: at(0, 8 + i, 30), kind: 'count', taskId: 'eau', delta: 1 })

  const spend = (daysAgo, amount, label, shopItemId) =>
    events.push({ id: uid(), ts: at(daysAgo, 20, 0), kind: 'spend', amount, label, shopItemId })
  spend(38, 15, 'Soirée ciné', 's1')
  spend(31, 4, 'Café en terrasse', 's4')
  spend(26, 12, 'Livre', 's3')
  spend(19, 25, 'Jeu vidéo', 's2')
  spend(11, 9.5, 'Places de concert')
  spend(4, 30, 'Resto', 's5')
  spend(2, 12, 'Livre', 's3')
  spend(1, 4, 'Café en terrasse', 's4')

  events.sort((a, b) => a.ts - b.ts)

  const db = {
    tasks,
    shopItems,
    events,
    settings: {
      currency: '€',
      budgetLabel: 'budget loisirs',
      accent: '#f5b638',
      dayStart: 0,
      defaultReward: 5,
      allowNegative: false,
      weekStart: 1,
      showStats: true,
      serverUrl: '',
      serverToken: '',
    },
  }

  // idb-keyval: database "keyval-store", store "keyval", key "db".
  await new Promise((res, rej) => {
    const req = indexedDB.open('keyval-store', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('keyval')
    req.onerror = () => rej(req.error)
    req.onsuccess = () => {
      const tx = req.result.transaction('keyval', 'readwrite')
      tx.objectStore('keyval').put(db, 'db')
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    }
  })
  localStorage.setItem('tutoVu', '1')
  return `${tasks.length} tâches, ${events.length} événements`
})()
