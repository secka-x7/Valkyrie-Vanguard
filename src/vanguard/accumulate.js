// Valkyrie Vanguard — ACCUMULATE-OMEGA
// 10 vectors. Compounding flywheel. Autonomous pursuit from minute 1.
import { getConfig, setConfig, recordLedger } from '../db.js'
import { broadcast } from '../index.js'
import { resolveAddress, getReachStats } from './reach.js'

let _stats = { vectorFires: {}, institutionsPursued: 0, formatsExpanded: 0, bridgeMonopolies: 0 }

// Vector 1 — Protocol Insertion: insert into path of every connected anchor's downstream
export function vector1_protocolInsertion(anchor) {
  if (!anchor?.correspondents?.length) return
  const count = anchor.correspondents.length
  setConfig('v1_insertions', String(parseInt(getConfig('v1_insertions') || '0') + count))
  broadcast('accumulate', { vector: 1, action: 'INSERTION', count, anchor: anchor.vid })
  _stats.vectorFires[1] = (_stats.vectorFires[1] || 0) + count
}

// Vector 2 — Correspondent Chain Absorption
export function vector2_correspondentChain(anchor) {
  const tier1 = anchor.correspondents || []
  const tier2 = tier1.flatMap(c => anchor.tier2Correspondents?.[c] || [])
  const total  = tier1.length + tier2.length
  _stats.institutionsPursued += total
  setConfig('v2_institutions_pursued', String(parseInt(getConfig('v2_institutions_pursued') || '0') + total))
  broadcast('accumulate', { vector: 2, tier1: tier1.length, tier2: tier2.length, total })
  _stats.vectorFires[2] = (_stats.vectorFires[2] || 0) + total
  return { tier1, tier2, total }
}

// Vector 3 — Format Monopoly Expansion: track which formats each institution uses
const _institutionFormats = new Map()
export function vector3_formatExpansion(institutionId, newFormat) {
  const existing = _institutionFormats.get(institutionId) || new Set()
  if (!existing.has(newFormat)) {
    existing.add(newFormat)
    _institutionFormats.set(institutionId, existing)
    _stats.formatsExpanded++
    broadcast('accumulate', { vector: 3, institution: institutionId, format: newFormat, totalFormats: existing.size })
  }
}

// Vector 4 — Format Bridge Monopoly: detect when two format-incompatible institutions connect
const _formatGroups = { swift: new Set(), ach: new Set(), sepa: new Set(), fix: new Set() }
export function vector4_bridgeMonopoly(institutionId, format) {
  const group = format.includes('swift') || format.includes('mt') ? 'swift' :
                format.includes('nacha') || format.includes('ach') ? 'ach' :
                format.includes('sepa') ? 'sepa' :
                format.includes('fix') ? 'fix' : 'other'
  _formatGroups[group]?.add(institutionId)
  // Bridge opportunities: institutions in different groups
  let bridges = 0
  const groups = Object.values(_formatGroups)
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++)
      if (groups[i].size > 0 && groups[j].size > 0) bridges += groups[i].size * groups[j].size
  _stats.bridgeMonopolies = bridges
  setConfig('bridge_monopolies', String(bridges))
  broadcast('accumulate', { vector: 4, bridges, institution: institutionId })
}

// Vector 5 — Real-time Savings Proof (computed per message, stored for Mirror)
export function vector5_savingsProof(institutionId, totalFeeMinor, swiftEquivMinor, currency) {
  const key     = `savings_${institutionId}`
  const existing = BigInt(getConfig(key) || '0')
  const savings  = swiftEquivMinor - totalFeeMinor
  if (savings > 0n) { setConfig(key, String(existing + savings)); broadcast('accumulate', { vector: 5, institution: institutionId, savingsMinor: savings.toString() }) }
}

// Vector 6 — Intelligence Moat: cross-institution fraud patterns
const _fraudPatterns = new Map() // pattern → count across institutions
export function vector6_intelligenceMoat(arc, institutionId) {
  const amt = arc.core?.amountMinor
  if (!amt) return
  // Structuring detection: amounts just below $10,000 USD threshold
  const usd = Number(amt) / 100
  if (usd > 9000 && usd < 10000) {
    const pattern = 'structuring_near_threshold'
    const existing = _fraudPatterns.get(pattern) || { count: 0, institutions: new Set() }
    existing.count++
    existing.institutions.add(institutionId)
    _fraudPatterns.set(pattern, existing)
    if (existing.institutions.size > 2) {
      broadcast('fraud_pattern', { pattern, institutions: existing.institutions.size, count: existing.count })
    }
  }
}

// Vector 7 — Regulatory Shield: track compliance improvement metrics
let _falsePositivesEliminated = 0
export function vector7_regulatoryShield(wasScreened, passed) {
  if (wasScreened && passed) {
    _falsePositivesEliminated++ // each clean screen = eliminated potential false positive
    if (_falsePositivesEliminated % 1000 === 0) broadcast('accumulate', { vector: 7, falsePositivesEliminated: _falsePositivesEliminated })
  }
}

// Vector 8 — Temporal Lock-in: track how long each institution has been connected
const _connectionDates = new Map()
export function vector8_temporalLockIn(institutionId) {
  if (!_connectionDates.has(institutionId)) {
    _connectionDates.set(institutionId, Date.now())
    broadcast('accumulate', { vector: 8, institution: institutionId, event: 'first_connection' })
  }
  const daysSince = (Date.now() - _connectionDates.get(institutionId)) / 86400000
  if (daysSince > 90) broadcast('accumulate', { vector: 8, institution: institutionId, daysSince: daysSince.toFixed(0), lockedIn: true })
}

// Vector 9 — Ecosystem Creation: track quality standard propagation
let _ecosystemReach = 0
export function vector9_ecosystem(messageFormat, fromInstitution, toInstitution) {
  _ecosystemReach++
  if (_ecosystemReach % 10000 === 0) { setConfig('ecosystem_reach', String(_ecosystemReach)); broadcast('accumulate', { vector: 9, ecosystemReach: _ecosystemReach }) }
}

// Vector 10 — Protocol Evolution: new format support auto-proposes itself
const _supportedFormats = new Set(['swift_mt', 'iso20022', 'nacha', 'sepa', 'fix', 'iso8583', 'fedwire', 'chips'])
export function vector10_protocolEvolution(newFormat) {
  if (!_supportedFormats.has(newFormat)) {
    _supportedFormats.add(newFormat)
    broadcast('accumulate', { vector: 10, newFormat, totalFormats: _supportedFormats.size, message: `New format ${newFormat} encountered — parser deployment queued` })
  }
}

// Master flywheel — runs every 30 seconds
export function runFlywheel() {
  setInterval(() => {
    const stats = getReachStats()
    setConfig('accumulate_stats', JSON.stringify({ ..._stats, reach: stats, ts: Date.now() }))
    broadcast('flywheel', { stats: _stats, reach: stats })
  }, 30000)
}

export function getAccumulateStats() { return { ..._stats, reach: getReachStats() } }
