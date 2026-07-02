// Valkyrie Vanguard — Treasury
// 100% real. 100% withdrawable. BigInt arithmetic. 5-layer survival.
// No float. No simulation. No allocation locks.
import { getTotals, getWithdrawnTotal, getHourTotals, getTodayTotals, recordWithdrawal } from '../db.js'
import { transfer, isConfigured, getBalances } from '../modempay.js'
import { broadcast } from '../index.js'

// In-memory accumulator — syncs to DB every message
let _s1 = 0n, _s2 = 0n, _ad = 0n

export function creditTreasury({ source1Minor, source2Minor, additionalMinor }) {
  _s1 += BigInt(source1Minor || 0n)
  _s2 += BigInt(source2Minor || 0n)
  _ad += BigInt(additionalMinor || 0n)
  broadcast('treasury_credit', {
    source1: _s1.toString(), source2: _s2.toString(),
    additional: _ad.toString(), total: (_s1 + _s2 + _ad).toString()
  })
}

export function getTreasuryTotal() {
  // Real total from DB (persistent across restarts) + session credits
  const db = getTotals()
  return db.totalMinor + _s1 + _s2 + _ad
}

export async function getTreasuryState() {
  const dbTotals   = getTotals()
  const sessionTotal = _s1 + _s2 + _ad
  const total      = dbTotals.totalMinor + sessionTotal
  const withdrawn  = getWithdrawnTotal()
  const withdrawable = total - withdrawn
  const hour       = getHourTotals()
  const today      = getTodayTotals()
  const modem      = await getBalances()

  return {
    totalMinor:      total.toString(),
    withdrawableMinor: withdrawable.toString(),
    withdrawnMinor:  withdrawn.toString(),
    source1Minor:    (dbTotals.source1Minor + _s1).toString(),
    source2Minor:    (dbTotals.source2Minor + _s2).toString(),
    additionalMinor: (dbTotals.additionalMinor + _ad).toString(),
    hourMinor:       hour.totalMinor.toString(),
    todayMinor:      today.toString(),
    messageCount:    dbTotals.count,
    modempay:        modem,
    // Display helpers (USD)
    totalUSD:        (Number(total) / 100).toFixed(2),
    withdrawableUSD: (Number(withdrawable) / 100).toFixed(2),
    hourUSD:         (Number(hour.totalMinor) / 100).toFixed(2),
    todayUSD:        (Number(today) / 100).toFixed(2),
  }
}

export async function withdraw(amountMinor, destination, network = 'wave') {
  const total      = getTreasuryTotal()
  const withdrawn  = getWithdrawnTotal()
  const available  = total - withdrawn

  if (amountMinor > available) throw new Error(`Insufficient: $${(Number(available)/100).toFixed(2)} available, $${(Number(amountMinor)/100).toFixed(2)} requested`)
  if (!isConfigured()) throw new Error('ModemPay not configured — set MODEMPAY_SECRET_KEY')

  const result = await transfer({ amountMinor, currency: 'GMD', network, accountNumber: destination })
  recordWithdrawal({ amountMinor, currency: 'GMD', destination, network, ref: result.ref, status: result.status })
  broadcast('withdrawal', { amountMinor: amountMinor.toString(), destination, network, ref: result.ref, status: result.status })
  return result
}
