// Valkyrie Vanguard — ModemPay Integration
// Confirmed endpoints from official documentation.
// Role: withdrawal gateway from treasury to Wave/Afrimoney.
// Money handled as integer minor units internally, converted to decimal for API.
import fetch from 'node-fetch'

const BASE   = 'https://api.modempay.com/v1'
const SECRET = process.env.MODEMPAY_SECRET_KEY

const CURRENCY_EXPONENTS = { GMD: 2, USD: 2, EUR: 2, GBP: 2 }

// Convert BigInt minor units to decimal string for API
function minorToDecimal(minorUnits, currency) {
  const exp = CURRENCY_EXPONENTS[currency] ?? 2
  const mult = 10n ** BigInt(exp)
  const whole = minorUnits / mult
  const frac  = minorUnits % mult
  if (exp === 0) return String(whole)
  return `${whole}.${String(frac).padStart(exp, '0')}`
}

function headers(idempotencyKey) {
  const h = { 'Authorization': `Bearer ${SECRET}`, 'Content-Type': 'application/json' }
  if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey
  return h
}

export const isConfigured = () => !!SECRET

// GET /v1/balances — confirmed from docs
export async function getBalances() {
  if (!SECRET) return { payout_balance: 0, available_balance: 0, configured: false }
  try {
    const r = await fetch(`${BASE}/balances`, { headers: headers(), signal: AbortSignal.timeout(10000) })
    if (!r.ok) return { payout_balance: 0, available_balance: 0, configured: true, error: `HTTP ${r.status}` }
    const d = await r.json()
    return { payout_balance: d.payout_balance || 0, available_balance: d.available_balance || 0, configured: true }
  } catch (e) { return { payout_balance: 0, available_balance: 0, configured: true, error: e.message } }
}

// POST /v1/transfers — confirmed from docs
export async function transfer({ amountMinor, currency = 'GMD', network, accountNumber, beneficiaryName, narration }) {
  if (!SECRET) throw new Error('ModemPay not configured — set MODEMPAY_SECRET_KEY')
  const ref = 'VV-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase()
  const r = await fetch(`${BASE}/transfers`, {
    method: 'POST',
    headers: headers(ref),
    body: JSON.stringify({
      amount: minorToDecimal(amountMinor, currency),
      currency, network,
      account_number: accountNumber,
      beneficiary_name: beneficiaryName || 'Valkyrie Treasury',
      narration: narration || 'Valkyrie Vanguard withdrawal'
    }),
    signal: AbortSignal.timeout(15000)
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data.message || data.error || `ModemPay error ${r.status}`)
  return { ok: true, ref, status: data.status || 'pending', raw: data }
}

// charge.succeeded webhook — confirmed event name and payload field from docs
export function parseWebhook(body) {
  const event   = body?.event
  const payload = body?.payload
  if (event === 'charge.succeeded' && payload?.amount) {
    const currency = payload.currency || 'GMD'
    const exp      = CURRENCY_EXPONENTS[currency] ?? 2
    const amountDecimal = String(payload.amount)
    const [whole, frac = ''] = amountDecimal.split('.')
    const fracPadded = frac.padEnd(exp, '0').slice(0, exp)
    const minorUnits = BigInt(whole) * (10n ** BigInt(exp)) + BigInt(fracPadded || '0')
    return { type: 'charge', amountMinor: minorUnits, currency, reference: payload.reference || payload.id || '' }
  }
  if (event === 'transfer.succeeded' && payload?.amount) {
    return { type: 'transfer', reference: payload.reference || payload.id || '' }
  }
  return null
}
