import { useEffect, useMemo, useRef, useState } from 'react'

// The browser stores data under this single key, so no database is needed.
const STORAGE_KEY = 'dailydrink-web-v1'
const DAY = 86_400_000
const QUICK_AMOUNTS = [150, 200, 350, 500, 750]
const SPOKEN_NUMBERS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

function parseVoiceAmount(transcript) {
  const command = transcript.toLowerCase().match(/\b(?:okay\s+)?add\s+(.+)/)
  if (!command) return null
  const amountText = command[1].replace(/\b(?:ml|millilit(?:er|re)s?)\b.*$/, '').trim()
  const digits = amountText.match(/^(\d{1,5})\b/)
  if (digits) return Number(digits[1])
  let total = 0; let current = 0; let found = false
  for (const word of amountText.replace(/-/g, ' ').split(/\s+/)) {
    if (word === 'and') continue
    if (SPOKEN_NUMBERS[word] !== undefined) { current += SPOKEN_NUMBERS[word]; found = true; continue }
    if (word === 'hundred') { current = (current || 1) * 100; found = true; continue }
    if (word === 'thousand') { total += (current || 1) * 1000; current = 0; found = true; continue }
    break
  }
  const amount = total + current
  return found && amount > 0 ? amount : null
}

const todayKey = () => new Date().toISOString().slice(0, 10)
const loadData = () => {
  const defaults = { goal: 2000, intakes: [], settings: { name: '', weight: '', reminders: false, interval: 120, dark: false, goalSource: 'custom' } }
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (!raw) return defaults
    if (raw.settings && raw.settings.interval !== undefined) raw.settings.interval = Math.max(1, Number(raw.settings.interval) || 120)
    return { ...defaults, ...raw }
  } catch { return defaults }
}
const statusFor = percent => percent <= 20 ? ['Keep sipping — you’re just getting started.', 'critical'] : percent <= 40 ? ['A good start. Keep your bottle nearby.', 'poor'] : percent <= 60 ? ['Halfway there — nice momentum!', 'fair'] : percent <= 80 ? ['Almost there — one more glass!', 'good'] : ['You’re doing brilliantly today!', 'excellent']
const dateLabel = date => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00`))
const timeLabel = stamp => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(stamp))

function App() {
  // Main app state: goal, water entries, and settings.
  const [data, setData] = useState(loadData)
  const [tab, setTab] = useState('home')
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState('')
  const reminderAudio = useRef(null)
  const today = todayKey()
  const entries = data.intakes.filter(item => item.date === today).sort((a, b) => b.timestamp - a.timestamp)
  const total = entries.reduce((sum, item) => sum + item.amount, 0)
  const percent = Math.min(100, Math.round((total / data.goal) * 100))
  const [statusText, statusClass] = statusFor(percent)
  const lastDrink = entries[0]?.timestamp
  const remaining = Math.max(0, data.goal - total)
  const recommendedGoal = Number(data.settings.weight) > 0 ? Math.min(4000, Math.max(1500, Math.round(Number(data.settings.weight) * 35))) : null
  const isWeightGoal = data.settings.goalSource === 'weight'
  const goalSourceLabel = isWeightGoal ? 'Recommended from weight' : 'Custom goal'

  // Save automatically whenever the user changes data.
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) }, [data])
  useEffect(() => { document.documentElement.dataset.theme = data.settings.dark ? 'dark' : 'light' }, [data.settings.dark])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2800); return () => clearTimeout(timer) }, [toast])

  function prepareReminderSound() {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return
    if (!reminderAudio.current) reminderAudio.current = new AudioContext()
    if (reminderAudio.current.state === 'suspended') reminderAudio.current.resume().catch(() => {})
  }

  function playReminderSound() {
    try {
      prepareReminderSound()
      const context = reminderAudio.current
      if (!context) return
      const chime = () => [0, 0.3].forEach(offset => {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.frequency.value = 880
        gain.gain.setValueAtTime(0.0001, context.currentTime + offset)
        gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + offset + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + offset + 0.22)
        oscillator.connect(gain).connect(context.destination)
        oscillator.start(context.currentTime + offset)
        oscillator.stop(context.currentTime + offset + 0.24)
      })
      if (context.state === 'suspended') context.resume().then(chime).catch(() => {})
      else chime()
    } catch {}
  }

  // Hydration reminder notifications (min 1 minute for quick testing).
  useEffect(() => {
    const { reminders, interval } = data.settings
    if (!reminders) return
    const safeInterval = Math.max(1, Number(interval) || 120)
    const fire = () => {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try { new Notification('💧 Time to hydrate!', { body: `Have a sip of water — ${safeInterval} minutes since your last reminder.`, tag: 'dailydrink-reminder' }) } catch {}
      }
      playReminderSound()
      setToast('💧 Reminder: Time to drink water!')
    }
    const ms = safeInterval * 60 * 1000
    const id = setInterval(fire, ms)
    return () => clearInterval(id)
  }, [data.settings.reminders, data.settings.interval])

  // Add one glass/bottle entry. The 10 L limit matches the original app safety rule.
  function addIntake(amount) {
    if (!Number.isInteger(amount) || amount < 1 || amount > 10000 || total + amount > 10000) { setToast('Please enter an amount between 1 and 10,000 ml.'); return }
    const previous = total
    setData(current => ({ ...current, intakes: [...current.intakes, { id: crypto.randomUUID(), date: today, amount, timestamp: Date.now() }] }))
    setModal(null)
    setToast(previous < data.goal && previous + amount >= data.goal ? '🎉 Daily hydration goal reached!' : `+${amount} ml added`)
  }
  function setGoal(goal, source = 'custom') { if (goal >= 500 && goal <= 10000) { setData(x => ({ ...x, goal, settings: { ...x.settings, goalSource: source } })); setModal(null); setToast('Daily goal updated.'); } else setToast('Set a goal between 500 and 10,000 ml.') }
  function removeIntake(id) { setData(x => ({ ...x, intakes: x.intakes.filter(item => item.id !== id) })); setToast('Entry removed.') }
  function resetToday() { setData(x => ({ ...x, intakes: x.intakes.filter(item => item.date !== today) })); setModal(null); setToast('Today’s entries have been cleared.') }
  function updateSettings(settings) {
    const safe = { ...settings }
    if (safe.interval !== undefined) safe.interval = Math.max(1, Number(safe.interval) || 120)
    setData(x => ({ ...x, settings: { ...x.settings, ...safe } })); setToast('Settings saved.')
    // Browsers only allow the notification permission dialog during a direct user action.
    // This function is called by the reminder switch's change handler.
    if (safe.reminders === true && !data.settings.reminders) prepareReminderSound()
    if (safe.reminders === true && !data.settings.reminders && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        setToast(permission === 'granted' ? 'Reminders enabled. Your first alert will appear in 5 minutes.' : 'Allow notifications in your browser to receive popup reminders.')
      }).catch(() => setToast('Unable to request notification permission.'))
    }
  }

  return <main className="app-shell">
    <section className="app-card">
      {tab === 'home' && <Home {...{ data, entries, total, percent, statusText, statusClass, addIntake, removeIntake, setModal, lastDrink, remaining, goalSourceLabel }} />}
      {tab === 'history' && <History data={data} />}
      {tab === 'settings' && <Settings data={data} updateSettings={updateSettings} saveGoal={(goal, source) => setGoal(goal, source)} resetToday={() => setModal('reset')} />}
      <nav className="bottom-nav" aria-label="Main navigation">
        <NavButton icon="⌂" label="Today" active={tab === 'home'} onClick={() => setTab('home')} />
        <NavButton icon="▥" label="History" active={tab === 'history'} onClick={() => setTab('history')} />
        <NavButton icon="⚙" label="Settings" active={tab === 'settings'} onClick={() => setTab('settings')} />
      </nav>
    </section>
    {toast && <div className="toast" role="status">{toast}</div>}
    {modal === 'custom' && <AmountModal title="Add custom amount" submit={addIntake} close={() => setModal(null)} />}
    {modal === 'goal' && <GoalModal initial={data.goal} submit={setGoal} close={() => setModal(null)} />}
    {modal === 'reset' && <ConfirmModal title="Reset today’s data?" detail="This removes all water entries for today. This action can’t be undone." confirm={resetToday} close={() => setModal(null)} />}
  </main>
}

function Home({ data, entries, total, percent, statusText, statusClass, addIntake, removeIntake, setModal, lastDrink, remaining, goalSourceLabel }) {
  const [voiceStatus, setVoiceStatus] = useState('')
  const recognition = useRef(null)
  useEffect(() => () => recognition.current?.abort(), [])
  function startVoiceAdd() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) { setVoiceStatus('Voice input is not supported in this browser. Try Chrome or Edge.'); return }
    recognition.current?.abort()
    const listener = new SpeechRecognition()
    listener.lang = 'en-US'
    listener.interimResults = false
    listener.maxAlternatives = 1
    listener.onstart = () => setVoiceStatus('Listening… say “okay add 200” or “add two hundred”.')
    listener.onerror = event => setVoiceStatus(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'Please allow microphone access to use voice add.' : event.error === 'audio-capture' ? 'No microphone was found. Check that it is connected.' : 'I could not hear that. Please try again.')
    listener.onresult = event => {
      const words = event.results[0][0].transcript
      const amount = parseVoiceAmount(words)
      if (!amount) { setVoiceStatus(`Try “okay add 200” — heard: “${words}”.`); return }
      addIntake(amount)
      setVoiceStatus(`Added ${amount} ml by voice.`)
    }
    listener.onend = () => { recognition.current = null }
    recognition.current = listener
    try { listener.start() } catch { setVoiceStatus('Voice input is already starting. Please try again.') }
  }
  const name = data.settings.name.trim()
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return <div className="screen home-screen">
    <header className="topbar"><div><p>{greeting}{name ? `, ${name}` : ''} 👋</p><h1>{dateLabel(todayKey())}</h1></div><button className="round-button" aria-label="Edit daily goal" onClick={() => setModal('goal')}>✎</button></header>
    <section className="progress-card">
      <WaterOrb percent={percent} />
      <strong className="amount">{total.toLocaleString()}</strong><span className="muted">ml consumed</span>
      <div className="progress-track"><i style={{ width: `${percent}%` }} /></div>
      <span className="goal-label">Goal: {data.goal.toLocaleString()} ml</span>
      <span className={`status ${statusClass}`}>{statusText}</span>
      <div className="home-metrics"><div><strong>{remaining.toLocaleString()} ml</strong><small>remaining</small></div><div><strong>{lastDrink ? timeLabel(lastDrink) : 'No drinks yet'}</strong><small>last sip</small></div><div><strong>{goalSourceLabel}</strong><small>goal type</small></div></div>
    </section>
    <section><div className="section-heading"><h2>Quick add</h2><button className="text-button" onClick={() => setModal('custom')}>Custom +</button></div>
      <div className="quick-add">{QUICK_AMOUNTS.map((amount, index) => <button key={amount} onClick={() => addIntake(amount)}><span>{['☕','🥛','🥤','💧','🧴'][index]}</span>{amount} ml</button>)}<button className="voice-add" onClick={startVoiceAdd}><span>🎙️</span>Voice add</button></div>
      {voiceStatus && <p className="voice-status" role="status">{voiceStatus}</p>}
    </section>
    <section className="log-section"><div className="section-heading"><h2>Today’s log</h2><span>{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span></div>
      {entries.length ? <ul className="intake-list">{entries.map(item => <li key={item.id}><span className="drop-icon">💧</span><div><b>{item.amount} ml</b><small>{timeLabel(item.timestamp)}</small></div><button aria-label={`Remove ${item.amount} ml entry`} onClick={() => removeIntake(item.id)}>×</button></li>)}</ul> : <div className="empty-state"><span>💧</span><p>No water logged yet. Start with a quick add!</p></div>}
    </section>
  </div>
}

function WaterOrb({ percent }) { return <div className="water-orb" aria-label={`${percent}% of daily goal`}><div className="water-fill" style={{ height: `${Math.max(8, percent)}%` }} /><div className="orb-label">{percent}%</div></div> }
function NavButton({ icon, label, active, onClick }) { return <button className={active ? 'active' : ''} onClick={onClick}><span>{icon}</span>{label}</button> }

function History({ data }) {
  const [range, setRange] = useState('week')
  const days = range === 'week' ? 7 : 30
  const records = useMemo(() => Array.from({ length: days }, (_, index) => {
    const d = new Date(Date.now() - (days - 1 - index) * DAY); const key = d.toISOString().slice(0, 10)
    const total = data.intakes.filter(i => i.date === key).reduce((sum, i) => sum + i.amount, 0)
    return { key, label: range === 'week' ? new Intl.DateTimeFormat('en-US', { weekday: 'narrow' }).format(d) : `${d.getMonth() + 1}/${d.getDate()}`, total }
  }), [data.intakes, range, days])
  const logged = records.filter(x => x.total); const avg = logged.length ? Math.round(logged.reduce((sum, x) => sum + x.total, 0) / logged.length) : 0; const best = Math.max(0, ...records.map(x => x.total)); const met = records.filter(x => x.total >= data.goal).length
  const streak = useMemo(() => {
    let count = 0
    for (let i = 0; i < days; i++) {
      const key = new Date(Date.now() - i * DAY).toISOString().slice(0, 10)
      const total = data.intakes.filter(i => i.date === key).reduce((sum, item) => sum + item.amount, 0)
      if (total >= data.goal) count++
      else break
    }
    return count
  }, [data.intakes, data.goal, days])
  return <div className="screen"><header className="simple-header"><p>Your progress</p><h1>Hydration history</h1></header><div className="toggle"><button className={range === 'week' ? 'selected' : ''} onClick={() => setRange('week')}>Weekly</button><button className={range === 'month' ? 'selected' : ''} onClick={() => setRange('month')}>Monthly</button></div>
    <section className="chart-card"><div className="chart">{records.map(r => <div className="bar-wrap" key={r.key}><i title={`${r.label}: ${r.total} ml`} style={{ height: `${Math.max(r.total ? 7 : 2, Math.min(100, r.total / data.goal * 100))}%` }} /><span>{r.label}</span></div>)}</div><p>Daily intake · goal line: {data.goal.toLocaleString()} ml</p></section>
    <section className="stat-grid"><Stat label="Daily average" value={`${avg.toLocaleString()} ml`} /><Stat label="Best day" value={`${best.toLocaleString()} ml`} /><Stat label="Goals reached" value={`${met} days`} /><Stat label="Streak" value={`${streak} days`} /></section>
    <section className="log-section"><div className="section-heading"><h2>Recent days</h2></div>{[...records].reverse().filter(r => r.total).length ? <ul className="day-list">{[...records].reverse().filter(r => r.total).map(r => <li key={r.key}><span>{dateLabel(r.key)}</span><b>{r.total.toLocaleString()} ml</b><small>{Math.round(r.total / data.goal * 100)}%</small></li>)}</ul> : <div className="empty-state"><span>📈</span><p>Your completed days will appear here.</p></div>}</section>
  </div>
}
function Stat({ label, value }) { return <article><small>{label}</small><b>{value}</b></article> }

function Settings({ data, updateSettings, saveGoal, resetToday }) {
  const [form, setForm] = useState(data.settings)
  const [showRecommendation, setShowRecommendation] = useState(false)
  useEffect(() => setForm(data.settings), [data.settings])
  const patch = value => {
    const next = { ...form, ...value }
    setForm(next)
    updateSettings(value)
    if (value.weight !== undefined) setShowRecommendation(false)
  }
  const weight = Number(form.weight)
  const suggestedGoal = weight > 0 ? Math.min(4000, Math.max(1500, Math.round(weight * 35))) : null
  const suggest = () => {
    if (suggestedGoal !== null) {
      saveGoal(suggestedGoal)
      setShowRecommendation(true)
    }
  }
  return <div className="screen settings-screen"><header className="simple-header"><p>Personalise DailyDrink</p><h1>Settings</h1></header>
    <SettingCard title="👤 Profile"><label>Your name<input value={form.name} maxLength="40" placeholder="e.g. Alex" onChange={e => patch({ name: e.target.value })} /></label><label>Body weight (kg)<div className="input-action"><input type="number" min="1" max="300" value={form.weight} placeholder="e.g. 65" onChange={e => patch({ weight: e.target.value })} /><button onClick={suggest} disabled={suggestedGoal === null}>Apply recommendation</button></div></label>
      {showRecommendation && suggestedGoal !== null && <div className="recommendation-card"><strong>Recommended daily water</strong><p>{`${suggestedGoal.toLocaleString()} ml`}</p></div>}
      <p className="helper">The recommendation is calculated automatically from your weight and shown after you click the button.</p></SettingCard>
    <SettingCard title="🔔 Reminders"><Switch label="Hydration reminders" checked={form.reminders} onChange={checked => patch({ reminders: checked })} />{form.reminders && <label>Repeat every<select value={form.interval} onChange={e => patch({ interval: Number(e.target.value) })}><option value="1">1 minute (test)</option><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option><option value="180">3 hours</option></select></label>}<p className="helper">Minimum 1 minute for testing. Browser reminders work while this app is open.</p></SettingCard>
    <SettingCard title="🎨 Appearance"><Switch label="Dark mode" checked={form.dark} onChange={checked => patch({ dark: checked })} /></SettingCard>
    <SettingCard title="⚠️ Danger zone"><button className="reset-button" onClick={resetToday}>Reset today’s data</button></SettingCard>
  </div>
}
function SettingCard({ title, children }) { return <section className="setting-card"><h2>{title}</h2>{children}</section> }
function Switch({ label, checked, onChange }) { return <label className="switch-row">{label}<input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><i /></label> }

function AmountModal({ title, submit, close }) { const [value, setValue] = useState(''); return <Modal title={title} close={close}><form onSubmit={e => { e.preventDefault(); submit(Number(value)) }}><label>Amount in millilitres<input autoFocus type="number" min="1" max="10000" value={value} placeholder="e.g. 250" onChange={e => setValue(e.target.value)} /></label><div className="modal-actions"><button type="button" className="secondary" onClick={close}>Cancel</button><button type="submit">Add water</button></div></form></Modal> }
function GoalModal({ initial, submit, close }) { const [value, setValue] = useState(initial); return <Modal title="Set daily goal" close={close}><form onSubmit={e => { e.preventDefault(); submit(Number(value)) }}><label>Goal in millilitres<input autoFocus type="number" min="500" max="10000" value={value} onChange={e => setValue(e.target.value)} /></label><p className="helper">Most adults need about 1,500–4,000 ml per day.</p><div className="modal-actions"><button type="button" className="secondary" onClick={close}>Cancel</button><button type="submit">Save goal</button></div></form></Modal> }
function ConfirmModal({ title, detail, confirm, close }) { return <Modal title={title} close={close}><p>{detail}</p><div className="modal-actions"><button className="secondary" onClick={close}>Cancel</button><button className="danger" onClick={confirm}>Reset data</button></div></Modal> }
function Modal({ title, children, close }) { return <div className="modal-backdrop" role="presentation" onMouseDown={close}><section className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={e => e.stopPropagation()}><button className="close" aria-label="Close" onClick={close}>×</button><h2>{title}</h2>{children}</section></div> }

export default App
