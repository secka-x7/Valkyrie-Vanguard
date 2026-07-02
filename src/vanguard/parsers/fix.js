// Valkyrie Vanguard — FIX Protocol Parser
// FIX 4.2/4.4/5.0. Tag=value, SOH (0x01) delimited.
import { createARCMessage } from '../arc.js'

const SOH = '\x01'

// FIX MsgType → instruction type
const MSG_TYPES = { 'D':'NEW_ORDER', '8':'EXECUTION_REPORT', 'G':'ORDER_MODIFY', 'F':'ORDER_CANCEL', 'V':'MARKET_DATA_REQUEST' }

export const FIXAdapter = {
  parse(raw) {
    const text   = Buffer.isBuffer(raw) ? raw.toString('ascii') : String(raw)
    const fields = {}
    for (const pair of text.split(SOH)) {
      const eq = pair.indexOf('=')
      if (eq > 0) fields[pair.slice(0, eq)] = pair.slice(eq + 1)
    }

    // Tag 44=Price, Tag 38=OrderQty — value = Price × Qty, in minor units
    const price    = parseFloat(fields['44'] || '0')
    const qty      = parseFloat(fields['38'] || '0')
    const currency = fields['15'] || 'USD'
    const valueUSD = price * qty
    // Convert to minor units (cents for USD)
    const amountMinor = BigInt(Math.round(valueUSD * 100))

    return createARCMessage({
      originFormat:    'fix_' + (fields['35'] === 'D' ? 'order' : 'exec'),
      instructionType: MSG_TYPES[fields['35']] || 'UNKNOWN',
      originator:  { rawIdentifier: fields['49'] || '', identifierType: 'FIX_SENDER', name: fields['49'] || '' },
      beneficiary: { rawIdentifier: fields['56'] || fields['76'] || '', identifierType: 'FIX_TARGET', name: '' },
      amountMinor, currency,
      reference:      fields['11'] || fields['37'] || '',
      remittanceInfo: fields['58'] || null,
      rawFields: fields
    })
  },

  generate(arc) {
    const f    = arc.extensions?.rawFields || {}
    const tags = { ...f }
    // Ensure required fields
    if (!tags['8'])  tags['8']  = 'FIX.4.4'
    if (!tags['35']) tags['35'] = 'D'
    if (!tags['49']) tags['49'] = arc.core.originator?.rawIdentifier || 'VANGUARD'
    if (!tags['56']) tags['56'] = arc.core.beneficiary?.rawIdentifier || ''
    if (!tags['11']) tags['11'] = arc.core.reference

    const ordered = ['8','9','35','49','56','34','52','11','38','40','44','54','55','59','10']
    const parts   = []
    for (const tag of ordered) { if (tags[tag]) parts.push(`${tag}=${tags[tag]}`) }
    for (const [tag, val] of Object.entries(tags)) { if (!ordered.includes(tag)) parts.push(`${tag}=${val}`) }
    // Checksum (tag 10)
    const body  = parts.join(SOH) + SOH
    const sum   = body.split('').reduce((s, c) => s + c.charCodeAt(0), 0) % 256
    return Buffer.from(body + `10=${String(sum).padStart(3, '0')}` + SOH)
  }
}
