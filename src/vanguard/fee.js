// Valkyrie Vanguard — Dynamic Fee Engine
// Source 1: flat message fee (per format, per priority)
// Source 2: percentage of transaction value (60% revenue weight)
// Additional: screening, enrichment, validation, archive
// All amounts returned as BigInt minor units in USD
// Hard rule: total fee always cheaper than SWIFT equivalent

import { parseDecimalToMinor } from './arc.js'
import { getConfig } from '../db.js'

// Base Source 1 fees in USD cents (minor units)
const S1_BASE_USD_MINOR = {
  'swift_mx':    75n,   // $0.75
  'swift_mt103': 60n,   // $0.60
  'swift_mt202': 75n,
  'swift_mt700': 80n,
  'swift_mt940': 25n,
  'fedwire':    300n,   // $3.00
  'chips':      250n,
  'target2':    180n,
  'chaps':      200n,
  'sepa_sct':    45n,
  'sepa_inst':  120n,
  'sepa_sdd':    35n,
  'nacha_entry':  8n,   // $0.08
  'nacha_batch': 50n,
  'fednow':      80n,
  'rtp':         80n,
  'fix_order':   20n,
  'fix_exec':    10n,
  'iso8583':     15n,
  'camt053':     20n,
  'bai2':        15n,
  'cls':        150n,
  'cips':       120n,
  'pix':         30n,
  'upi':         20n,
  'npp':         35n,
  'faster_payments': 40n,
}

const PRIORITY_MULT = { NORMAL: 1.0, PRIORITY: 2.0, URGENT: 3.5 }

// Source 2 basis points by value tier
// Returns basis points as a number (e.g. 0.5 = 0.5 bps = 0.005%)
function getS2BasisPoints(amountMinor) {
  const amt = Number(amountMinor) / 100 // USD value
  if (amt <       10_000) return 1.0
  if (amt <      100_000) return 0.8
  if (amt <    1_000_000) return 0.5
  if (amt <   10_000_000) return 0.3
  if (amt <  100_000_000) return 0.2
  if (amt < 1_000_000_000) return 0.1
  return 0.05
}

export function calculateFees(format, priority, amountMinor, controls = {}) {
  const fmt = format?.toLowerCase() || 'unknown'

  // Source 1 — flat message fee
  const s1Base   = S1_BASE_USD_MINOR[fmt] || 30n // $0.30 fallback for unknown formats
  const prioMult = PRIORITY_MULT[priority] || 1.0
  const globalFeeRate = parseFloat(getConfig('ctl_global_fee') || '0.05')

  // Get per-format control override from Mirror
  const fmtFeeRate  = parseFloat(getConfig(`ctl_fee_${fmt}`) || '0') || 1.0
  let source1Minor  = BigInt(Math.round(Number(s1Base) * prioMult * fmtFeeRate))

  // Source 2 — percentage of transaction value (60% revenue weight)
  const bps         = getS2BasisPoints(amountMinor)
  const s2CtlMult   = parseFloat(getConfig('ctl_s2_multiplier') || '1.0')
  const s2FeeRate   = (bps * s2CtlMult) / 10000 // convert bps to decimal
  let source2Minor  = BigInt(Math.round(Number(amountMinor) * s2FeeRate))

  // Additional micro-fees
  const screeningMinor   = 5n  // $0.05
  const enrichmentMinor  = amountMinor > 0n ? 10n : 0n  // $0.10 cross-currency
  const validationMinor  = 8n  // $0.08
  const archiveMinor     = 2n  // $0.02
  const additionalMinor  = screeningMinor + enrichmentMinor + validationMinor + archiveMinor

  // Propeller amplification
  const propellerMult = getPropellerMultiplier(amountMinor, controls)
  source1Minor = BigInt(Math.round(Number(source1Minor) * propellerMult))
  source2Minor = BigInt(Math.round(Number(source2Minor) * propellerMult))

  // Hard cap: never exceed 70% cheaper than SWIFT equivalent
  // SWIFT avg cost: ~$25 per message + 0.1% of value
  const swiftEquivMinor = 2500n + BigInt(Math.round(Number(amountMinor) * 0.001))
  const ourTotal = source1Minor + source2Minor + additionalMinor
  const maxAllowed = swiftEquivMinor * 7n / 10n // 70% of SWIFT cost
  const cappedTotal = ourTotal > maxAllowed ? maxAllowed : ourTotal

  // Proportionally distribute cap if applied
  const ratio = ourTotal > 0n ? Number(cappedTotal) / Number(ourTotal) : 1
  const finalS1  = BigInt(Math.round(Number(source1Minor) * ratio))
  const finalS2  = BigInt(Math.round(Number(source2Minor) * ratio))
  const finalAdd = BigInt(Math.round(Number(additionalMinor) * ratio))

  return {
    source1Minor: finalS1,
    source2Minor: finalS2,
    additionalMinor: finalAdd,
    totalMinor: finalS1 + finalS2 + finalAdd,
    swiftEquivMinor,
    savedVsSwiftMinor: swiftEquivMinor - (finalS1 + finalS2 + finalAdd),
    basisPoints: bps,
    propellerMult: propellerMult.toFixed(2)
  }
}

function getPropellerMultiplier(amountMinor, controls = {}) {
  const intensity = (key) => parseFloat(getConfig(`ctl_${key}`) ?? '10') / 10

  let mult = 1.0
  // GP1 — volume velocity (tracked externally, passed via controls)
  const hourlyVol = parseFloat(controls.hourlyVolumeUSD || '0')
  if (hourlyVol > 100_000_000) mult *= 1 + 2.0 * intensity('gp1')
  else if (hourlyVol > 10_000_000) mult *= 1 + 1.3 * intensity('gp1')
  else if (hourlyVol > 1_000_000)  mult *= 1 + 0.8 * intensity('gp1')

  // GP4 — transaction size
  const amt = Number(amountMinor) / 100
  if (amt > 100_000_000) mult *= 1 + 3.2 * intensity('gp4')
  else if (amt > 10_000_000) mult *= 1 + 2.5 * intensity('gp4')
  else if (amt > 1_000_000)  mult *= 1 + 1.8 * intensity('gp4')
  else if (amt > 100_000)    mult *= 1 + 1.1 * intensity('gp4')

  // GP6 — temporal (UTC hour)
  const h = new Date().getUTCHours()
  if (h === 7 || h === 8)   mult *= 1 + 0.5 * intensity('gp6')  // London open
  else if (h === 13 || h === 14) mult *= 1 + 0.4 * intensity('gp6') // NY open
  else if (h >= 8 && h < 18) mult *= 1 + 0.1 * intensity('gp6')

  // GP8 — Dominion/Fortress phase bonus
  const phases = parseInt(getConfig('dominion_checks') || '0')
  if (phases > 0) mult *= 1 + Math.min(phases / 1000, 1.5) * intensity('gp8')

  // Stack cap: 10×
  return Math.min(mult, 10.0)
}
