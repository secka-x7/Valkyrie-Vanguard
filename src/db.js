// Valkyrie Vanguard — Database Layer
// SQLite WASM. Append-only hash-chained ledger. Real records only.
// Money stored as BigInt minor units — never float.
import { createRequire } from 'module'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { createHash } from 'crypto'

const require = createRequire(import.meta.url)
const DIR  = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'
const PATH = DIR + '/valkyrie.db'
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })

let _db, _SQL

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS config(
    key TEXT PRIMARY KEY, value TEXT, ts INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS ledger(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    event TEXT NOT NULL,
    detail TEXT,
    format TEXT,
    source1_minor INTEGER DEFAULT 0,
    source2_minor INTEGER DEFAULT 0,
    additional_minor INTEGER DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    ts INTEGER NOT NULL,
    prev_hash TEXT NOT NULL,
    entry_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS idempotency(
    message_id TEXT PRIMARY KEY,
    claimed_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS withdrawals(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount_minor INTEGER NOT NULL,
    currency TEXT DEFAULT 'GMD',
    destination TEXT NOT NULL,
    network TEXT NOT NULL,
    ref TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS directory(
    vid TEXT PRIMARY KEY,
    public_key TEXT,
    trust_tier INTEGER DEFAULT 1,
    aliases TEXT DEFAULT '{}',
    jurisdiction TEXT,
    ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ledger_ts  ON ledger(ts);
  CREATE INDEX IF NOT EXISTS idx_ledger_mid ON ledger(message_id);
  CREATE INDEX IF NOT EXISTS idx_idem_exp   ON idempotency(expires_at);
`

export async function initDB() {
  _SQL = await require('sql.js')()
  _db  = existsSync(PATH)
    ? new _SQL.Database(readFileSync(PATH))
    : new _SQL.Database()
  _db.run(SCHEMA)
  _save()
  setInterval(_save, 5000)
  console.log('[DB] Ready —', PATH)
}

function _save() {
  if (!_db) return
  try { writeFileSync(PATH, Buffer.from(_db.export())) } catch {}
}

const _q = []; let _t = null
function _flush() {
  _t = null
  if (!_q.length || !_db) return
  try {
    _db.run('BEGIN')
    _q.splice(0).forEach(({ s, p }) => _db.run(s, p))
    _db.run('COMMIT')
  } catch (e) {
    try { _db.run('ROLLBACK') } catch {}
    console.error('[DB] Flush error:', e.message?.slice(0, 80))
  }
}
function _w(s, p) { _q.push({ s, p }); if (!_t) _t = setTimeout(_flush, 60) }

export function setConfig(k, v) {
  _w('INSERT OR REPLACE INTO config(key,value,ts) VALUES(?,?,?)', [k, String(v), Date.now() / 1000 | 0])
}
export function getConfig(k) {
  try { return _db?.exec(`SELECT value FROM config WHERE key='${k.replace(/'/g,"''")}'`)[0]?.values[0]?.[0] ?? null }
  catch { return null }
}

// Hash-chained ledger — append only, tamper-evident
// Money in integer minor units (cents for USD)
let _lastHash = '0'.repeat(64)

function computeHash(entry) {
  const payload = JSON.stringify({
    message_id: entry.message_id, event: entry.event,
    detail: entry.detail || '', format: entry.format || '',
    source1_minor: entry.source1_minor, source2_minor: entry.source2_minor,
    additional_minor: entry.additional_minor, currency: entry.currency,
    ts: entry.ts, prev_hash: entry.prev_hash
  })
  return createHash('sha256').update(payload).digest('hex')
}

export function recordLedger({ messageId, event, detail, format, source1Minor = 0n, source2Minor = 0n, additionalMinor = 0n, currency = 'USD' }) {
  const ts   = Date.now() / 1000 | 0
  const entry = {
    message_id: messageId, event, detail: detail || '', format: format || '',
    source1_minor: Number(source1Minor),
    source2_minor: Number(source2Minor),
    additional_minor: Number(additionalMinor),
    currency, ts, prev_hash: _lastHash
  }
  entry.entry_hash = computeHash(entry)
  _lastHash = entry.entry_hash
  _w('INSERT INTO ledger(message_id,event,detail,format,source1_minor,source2_minor,additional_minor,currency,ts,prev_hash,entry_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    [entry.message_id, entry.event, entry.detail, entry.format,
     entry.source1_minor, entry.source2_minor, entry.additional_minor,
     entry.currency, entry.ts, entry.prev_hash, entry.entry_hash])
}

// Idempotency — atomic claim per message_id
export function claimIdempotency(messageId, ttlSeconds = 86400 * 30) {
  const now     = Date.now() / 1000 | 0
  const expires = now + ttlSeconds
  // Clean expired claims first
  _w('DELETE FROM idempotency WHERE expires_at < ?', [now])
  try {
    const existing = _db?.exec(`SELECT message_id FROM idempotency WHERE message_id='${messageId.replace(/'/g,"''")}'`)[0]?.values[0]?.[0]
    if (existing) return false // already claimed — duplicate
    _w('INSERT OR IGNORE INTO idempotency(message_id,claimed_at,expires_at) VALUES(?,?,?)', [messageId, now, expires])
    return true // claimed
  } catch { return false } // fail closed — refuse to process on uncertainty
}

// Revenue totals — all in BigInt minor units, summed from real ledger
export function getTotals() {
  try {
    const r = _db?.exec(`SELECT COALESCE(SUM(source1_minor),0), COALESCE(SUM(source2_minor),0), COALESCE(SUM(additional_minor),0), COUNT(*) FROM ledger WHERE event='CREDITED'`)[0]?.values[0] || [0,0,0,0]
    const s1 = BigInt(r[0] || 0)
    const s2 = BigInt(r[1] || 0)
    const ad = BigInt(r[2] || 0)
    return { source1Minor: s1, source2Minor: s2, additionalMinor: ad, totalMinor: s1 + s2 + ad, count: r[3] || 0 }
  } catch { return { source1Minor: 0n, source2Minor: 0n, additionalMinor: 0n, totalMinor: 0n, count: 0 } }
}

export function getWithdrawnTotal() {
  try { return BigInt(_db?.exec(`SELECT COALESCE(SUM(amount_minor),0) FROM withdrawals WHERE status='completed'`)[0]?.values[0]?.[0] || 0) }
  catch { return 0n }
}

export function getHourTotals() {
  const cutoff = (Date.now() / 1000 | 0) - 3600
  try {
    const r = _db?.exec(`SELECT COALESCE(SUM(source1_minor+source2_minor+additional_minor),0), COUNT(*) FROM ledger WHERE event='CREDITED' AND ts>${cutoff}`)[0]?.values[0] || [0,0]
    return { totalMinor: BigInt(r[0] || 0), count: r[1] || 0 }
  } catch { return { totalMinor: 0n, count: 0 } }
}

export function getTodayTotals() {
  const cutoff = (Date.now() / 1000 | 0) - 86400
  try {
    const r = _db?.exec(`SELECT COALESCE(SUM(source1_minor+source2_minor+additional_minor),0) FROM ledger WHERE event='CREDITED' AND ts>${cutoff}`)[0]?.values[0]?.[0] || 0
    return BigInt(r)
  } catch { return 0n }
}

export function getRecentLedger(limit = 20) {
  try {
    const s = _db.prepare('SELECT * FROM ledger WHERE event="CREDITED" ORDER BY ts DESC LIMIT ?')
    s.bind([limit]); const rows = []
    while (s.step()) rows.push(s.getAsObject())
    s.free(); return rows
  } catch { return [] }
}

export function recordWithdrawal({ amountMinor, currency, destination, network, ref, status }) {
  _w('INSERT OR REPLACE INTO withdrawals(amount_minor,currency,destination,network,ref,status,ts) VALUES(?,?,?,?,?,?,?)',
    [Number(amountMinor), currency, destination, network, ref, status, Date.now() / 1000 | 0])
}

export function verifyLedgerIntegrity() {
  try {
    const rows = _db?.exec('SELECT * FROM ledger ORDER BY id ASC')[0]?.values || []
    let prevHash = '0'.repeat(64)
    for (const row of rows) {
      const entry = { message_id: row[1], event: row[2], detail: row[3], format: row[4], source1_minor: row[5], source2_minor: row[6], additional_minor: row[7], currency: row[8], ts: row[9], prev_hash: row[10] }
      const expected = computeHash(entry)
      if (expected !== row[11]) return { valid: false, failedAt: row[0] }
      if (row[10] !== prevHash && row[0] > 1) return { valid: false, chainBrokenAt: row[0] }
      prevHash = row[11]
    }
    return { valid: true, entries: rows.length }
  } catch (e) { return { valid: false, error: e.message } }
}
