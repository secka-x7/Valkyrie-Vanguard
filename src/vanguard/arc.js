// Valkyrie Vanguard — ARC Canonical Schema
// Envelope + Core + Extensions. Money as BigInt minor units. Lossless round-trip.

const CURRENCY_EXPONENTS = {
  USD:2, EUR:2, GBP:2, JPY:0, CHF:2, CAD:2, AUD:2, HKD:2, SGD:2,
  GMD:2, NGN:2, KES:2, GHS:2, ZAR:2, BHD:3, KWD:3, OMR:3
}

export function currencyExponent(currency) {
  const exp = CURRENCY_EXPONENTS[currency]
  if (exp === undefined) throw new Error(`Unknown currency exponent for ${currency} — refusing to guess`)
  return exp
}

// Parse decimal string to BigInt minor units — no float ever
export function parseDecimalToMinor(str, currency) {
  const exp = currencyExponent(currency)
  const s   = String(str).trim().replace(/,/g, '')
  const neg = s.startsWith('-')
  const abs = neg ? s.slice(1) : s
  const [whole, frac = ''] = abs.split('.')
  if (frac.length > exp) throw new Error(`${str} has more precision than ${currency} allows (max ${exp} decimal places)`)
  const fracPadded = frac.padEnd(exp, '0')
  const mult = 10n ** BigInt(exp)
  const minor = BigInt(whole || '0') * mult + BigInt(fracPadded || '0')
  return neg ? -minor : minor
}

// Format BigInt minor units to display string
export function minorToDisplay(minor, currency) {
  const exp  = currencyExponent(currency)
  const mult = 10n ** BigInt(exp)
  const abs  = minor < 0n ? -minor : minor
  const neg  = minor < 0n ? '-' : ''
  const whole = abs / mult
  const frac  = abs % mult
  if (exp === 0) return `${neg}${whole} ${currency}`
  return `${neg}${whole}.${String(frac).padStart(exp, '0')} ${currency}`
}

// ARC message structure
export function createARCMessage({
  originFormat, instructionType, priority = 'NORMAL',
  originator, beneficiary, intermediaries = [],
  amountMinor, currency, reference, remittanceInfo,
  rawFields = {}
}) {
  const messageId = crypto.randomUUID()
  const now       = Date.now()
  return {
    envelope: {
      messageId, originFormat, instructionType, priority,
      timestamps: { created: now, ingested: now },
      signatureChain: []
    },
    core: {
      originator: normalizeParty(originator),
      beneficiary: normalizeParty(beneficiary),
      intermediaries: intermediaries.map(normalizeParty),
      amountMinor: BigInt(amountMinor),
      currency,
      reference: reference || '',
      remittanceInfo: remittanceInfo || null
    },
    extensions: { originFormat, rawFields }
  }
}

function normalizeParty(p) {
  if (!p) return { rawIdentifier: '', identifierType: 'UNKNOWN', name: '' }
  return {
    rawIdentifier: p.rawIdentifier || p.identifier || '',
    identifierType: p.identifierType || p.type || 'UNKNOWN',
    name: p.name || '',
    address: p.address || null
  }
}

// Canonical bytes for signature — deterministic JSON, fixed key order
export function canonicalBytes(arcMsg) {
  const obj = {
    messageId:       arcMsg.envelope.messageId,
    originFormat:    arcMsg.envelope.originFormat,
    instructionType: arcMsg.envelope.instructionType,
    priority:        arcMsg.envelope.priority,
    createdAt:       arcMsg.envelope.timestamps.created,
    originator:      arcMsg.core.originator.rawIdentifier,
    beneficiary:     arcMsg.core.beneficiary.rawIdentifier,
    amountMinor:     arcMsg.core.amountMinor.toString(),
    currency:        arcMsg.core.currency,
    reference:       arcMsg.core.reference
  }
  return Buffer.from(JSON.stringify(obj))
}
