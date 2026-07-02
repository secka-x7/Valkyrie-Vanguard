// Valkyrie Vanguard — Boot Sequence
// Never crashes. Self-heals. Pure messaging. Real revenue from first message.
import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

import { initDB, getRecentLedger, verifyLedgerIntegrity } from './db.js'
import { initControls, getControls, setControl } from './core/controls.js'
import { getTreasuryState, withdraw } from './core/treasury.js'
import { processMessage } from './vanguard/orchestrator.js'
import { onAnchorConnect, getReachStats } from './vanguard/reach.js'
import { getAccumulateStats, runFlywheel } from './vanguard/accumulate.js'
import { getDominionStats, startDominion } from './operations/dominion.js'
import { parseWebhook } from './modempay.js'
import { creditTreasury } from './core/treasury.js'
import { recordLedger, setConfig, getConfig } from './db.js'
import { getControls as _gc } from './core/controls.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const app    = express()
const server = createServer(app)
const wss    = new WebSocketServer({ server })
const PORT   = process.env.PORT || 3000

app.use(express.json({ limit: '50mb' }))

const clients = new Set()
export function broadcast(type, data) {
  const m = JSON.stringify({ type, data, ts: Date.now() })
  clients.forEach(ws => { try { if (ws.readyState === 1) ws.send(m) } catch {} })
}

wss.on('connection', ws => {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
  buildState().then(d => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'tick', data: d }))).catch(() => {})
})

// Health
app.get('/health', (_, res) => res.json({ ok: true, uptime: process.uptime() | 0 }))

// State
app.get('/api/state', async (_, res) => { try { res.json(await buildState()) } catch { res.json({ booting: true }) } })

// Controls — Mirror only
app.get('/api/controls', (_, res) => res.json(getControls()))
app.post('/api/controls', (req, res) => {
  try { const { key, value } = req.body; res.json(setControl(key, value)); broadcast('controls', getControls()) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

// Withdrawal — Mirror only
app.post('/api/withdraw', async (req, res) => {
  const { amount, destination, network } = req.body
  if (!amount || !destination) return res.status(400).json({ error: 'amount and destination required' })
  try {
    const amountMinor = BigInt(Math.round(parseFloat(amount) * 100))
    res.json(await withdraw(amountMinor, destination, network || 'wave'))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Message ingestion — this is the primary revenue endpoint
// Connecting institutions POST their messages here
app.post('/api/message', async (req, res) => {
  try {
    const format = req.headers['x-message-format'] || req.body.format
    const institution = req.headers['x-institution-id'] || 'unknown'
    const raw    = req.body.raw ? Buffer.from(req.body.raw, 'base64') : Buffer.from(JSON.stringify(req.body))
    const result = await processMessage(raw, { format, institutionId: institution })
    res.json(result)
  } catch (e) { res.status(500).json({ error: e.message?.slice(0, 200) }) }
})

// Anchor registration — RUSH activation
app.post('/api/anchor', (req, res) => {
  try {
    const result = onAnchorConnect(req.body)
    res.json({ ok: true, ...result })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// Ledger integrity check
app.get('/api/integrity', (_, res) => res.json(verifyLedgerIntegrity()))

// ModemPay webhook — charge.succeeded
app.post('/webhook/modempay', async (req, res) => {
  res.json({ ok: true })
  try {
    const parsed = parseWebhook(req.body)
    if (parsed?.type === 'charge') {
      const fee = parsed.amountMinor * 15n / 1000n // 1.5% service fee
      creditTreasury({ source1Minor: fee, source2Minor: 0n, additionalMinor: 0n })
      recordLedger({ messageId: 'MODEM-' + parsed.reference, event: 'CREDITED', detail: 'modempay_charge', format: 'modempay', source1Minor: fee })
      broadcast('charge', { amountMinor: parsed.amountMinor.toString(), feeMinor: fee.toString() })
    }
  } catch (e) { console.error('[WEBHOOK]', e.message) }
})

// Dashboard
const mirrorPath  = join(__dir, '../dashboard/mirror.html')
const mobilePath  = join(__dir, '../dashboard/mirror-mobile.html')
app.get('/', (req, res) => {
  const ua = req.headers['user-agent'] || ''
  const p  = /Mobile|Android|iPhone|iPad/.test(ua) && existsSync(mobilePath) ? mobilePath : mirrorPath
  if (existsSync(p)) res.send(readFileSync(p, 'utf8'))
  else res.send('<h1>Valkyrie Vanguard</h1><p>Booting...</p>')
})
app.get('/mobile',  (_, res) => existsSync(mobilePath)  ? res.send(readFileSync(mobilePath, 'utf8'))  : res.redirect('/'))
app.get('/desktop', (_, res) => existsSync(mirrorPath)   ? res.send(readFileSync(mirrorPath, 'utf8'))  : res.redirect('/'))

async function buildState() {
  const treasury  = await getTreasuryState()
  const reach     = getReachStats()
  const dominion  = getDominionStats()
  const accumulate= getAccumulateStats()
  const controls  = getControls()
  const recent    = getRecentLedger(20)
  return { treasury, reach, dominion, accumulate, controls, recent, uptime: process.uptime() | 0, memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) }
}

async function boot() {
  console.log('[VALKYRIE] Booting Valkyrie Vanguard...')
  await initDB()
  initControls()

  server.listen(PORT, () => console.log(`[VALKYRIE] Live on :${PORT}`))

  setInterval(async () => { try { broadcast('tick', await buildState()) } catch {} }, 3000)
  runFlywheel()
  startDominion()

  console.log('[VALKYRIE] Operational. POST messages to /api/message. Mirror at /')
  console.log('[VALKYRIE] ModemPay webhook: /webhook/modempay')
  console.log('[VALKYRIE] Anchor registration: POST /api/anchor')
}

boot().catch(e => { console.error('[VALKYRIE BOOT FATAL]', e.message); setTimeout(() => boot(), 5000) })
process.on('uncaughtException',  e => console.error('[UNCAUGHT]',  e.message?.slice(0, 150)))
process.on('unhandledRejection', r => console.error('[REJECTION]', String(r).slice(0, 150)))
process.on('SIGTERM', () => { console.log('[VALKYRIE] Graceful shutdown'); process.exit(0) })
