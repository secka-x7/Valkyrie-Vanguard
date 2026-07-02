// Valkyrie Vanguard — SWIFT MT Parser
// MT103, MT202, MT700, MT940. Real SWIFT block structure.
import { createARCMessage, parseDecimalToMinor } from '../arc.js'

export const MTAdapter = {
  parse(raw) {
    const text   = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
    const blocks = parseBlocks(text)
    const fields = parseFields(blocks['4'] || '')
    const msgType = (blocks['2'] || '').slice(0, 3)

    const [dateStr, currency, amountStr] = parse32A(fields['32A'] || '')
    const amountMinor = amountStr ? parseDecimalToMinor(amountStr, currency || 'USD') : 0n

    return createARCMessage({
      originFormat:    `swift_mt${msgType}`,
      instructionType: msgType === '103' ? 'CREDIT_TRANSFER' : msgType === '202' ? 'FI_CREDIT_TRANSFER' : 'OTHER',
      priority: 'NORMAL',
      originator:  { rawIdentifier: extractParty(fields['50K'] || fields['50A'] || ''), identifierType: 'BIC_ACCOUNT', name: extractName(fields['50K'] || '') },
      beneficiary: { rawIdentifier: extractParty(fields['59']  || fields['59A']  || ''), identifierType: 'BIC_ACCOUNT', name: extractName(fields['59'] || '') },
      amountMinor, currency: currency || 'USD',
      reference:      fields['20'] || '',
      remittanceInfo: fields['70'] || null,
      rawFields: fields
    })
  },

  generate(arc) {
    const fmt = arc.envelope.originFormat?.replace('swift_mt', '') || '103'
    const lines = []
    lines.push(`:20:${arc.core.reference}`)
    if (arc.core.amountMinor !== undefined) {
      lines.push(`:32A:${format32A(arc.core.currency, arc.core.amountMinor)}`)
    }
    if (arc.core.originator?.name)  lines.push(`:50K:${arc.core.originator.name}`)
    if (arc.core.beneficiary?.name) lines.push(`:59:${arc.core.beneficiary.name}`)
    if (arc.core.remittanceInfo)    lines.push(`:70:${arc.core.remittanceInfo}`)
    // Restore extension fields
    for (const [tag, val] of Object.entries(arc.extensions?.rawFields || {})) {
      if (!['20','32A','50K','59','70'].includes(tag)) lines.push(`:${tag}:${val}`)
    }
    return Buffer.from(`{1:F01VANGUARDXXXX0000000000}{2:I${fmt}VANGUARDXXXXN}{4:\n${lines.join('\n')}\n-}`)
  }
}

function parseBlocks(text) {
  const blocks = {}
  const re = /\{(\d):(.*?)\}/gs
  let m
  while ((m = re.exec(text)) !== null) blocks[m[1]] = m[2]
  return blocks
}

function parseFields(block4) {
  const fields = {}
  const re = /:([0-9]{2}[A-Z]?):([\s\S]*?)(?=:[\d]{2}[A-Z]?:|$)/g
  let m
  while ((m = re.exec(block4)) !== null) fields[m[1].trim()] = m[2].trim()
  return fields
}

function parse32A(field) {
  if (!field || field.length < 9) return ['', 'USD', '0']
  const date     = field.slice(0, 6)
  const currency = field.slice(6, 9)
  const amount   = field.slice(9).replace(',', '.')
  return [date, currency, amount]
}

function format32A(currency, minorUnits) {
  const exp  = 2
  const mult = 10n ** BigInt(exp)
  const whole = minorUnits / mult
  const frac  = minorUnits % mult
  const date  = new Date().toISOString().slice(2, 10).replace(/-/g, '')
  return `${date}${currency}${whole},${String(frac).padStart(exp, '0')}`
}

function extractParty(field) { return field.split('\n')[0]?.trim() || '' }
function extractName(field)  { return field.split('\n').slice(1).join(' ').trim() || '' }
