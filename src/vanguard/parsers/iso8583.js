// Valkyrie Vanguard — ISO 8583 Parser
// Primary bitmap (8 bytes), secondary bitmap if bit 1 set.
// ASCII mode: bitmap as 16 hex chars. Binary mode: 8 raw bytes.
// Variable-length fields: LLVAR (2-digit prefix), LLLVAR (3-digit prefix).
import { createARCMessage } from '../arc.js'

// Field specifications: {type, length, variable, llLen}
// type: 'n'=numeric, 'a'=alpha, 'ans'=alphanumeric-special, 'b'=binary
const FIELD_SPECS = {
  2:  { type:'n',  length:19, variable:true,  llLen:2 }, // PAN
  3:  { type:'n',  length:6,  variable:false },           // Processing code
  4:  { type:'n',  length:12, variable:false },           // Amount
  7:  { type:'n',  length:10, variable:false },           // Transmission datetime
  11: { type:'n',  length:6,  variable:false },           // STAN
  12: { type:'n',  length:6,  variable:false },           // Local time
  13: { type:'n',  length:4,  variable:false },           // Local date
  14: { type:'n',  length:4,  variable:false },           // Expiry date
  22: { type:'n',  length:3,  variable:false },           // POS entry mode
  25: { type:'n',  length:2,  variable:false },           // POS condition
  32: { type:'n',  length:11, variable:true,  llLen:2 }, // Acquiring institution
  37: { type:'ans',length:12, variable:false },           // Retrieval ref
  38: { type:'ans',length:6,  variable:false },           // Approval code
  39: { type:'an', length:2,  variable:false },           // Response code
  41: { type:'ans',length:8,  variable:false },           // Terminal ID
  42: { type:'ans',length:15, variable:false },           // Merchant ID
  43: { type:'ans',length:40, variable:true,  llLen:2 }, // Merchant name
  49: { type:'n',  length:3,  variable:false },           // Currency code
  54: { type:'ans',length:120,variable:true,  llLen:3 }, // Additional amounts
  55: { type:'b',  length:255,variable:true,  llLen:3 }, // EMV data
  63: { type:'ans',length:999,variable:true,  llLen:3 }, // Reserved private
}

// ISO 4217 numeric → alpha
const CURRENCY_NUM = { '840':'USD','978':'EUR','826':'GBP','392':'JPY','756':'CHF' }

export const ISO8583Adapter = {
  parse(raw, encoding = 'ascii') {
    const buf    = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    let offset   = 0
    const mti    = buf.slice(0, 4).toString('ascii')
    offset       = 4

    const [primaryBitmap, off1] = parseBitmap(buf, offset, encoding)
    offset = off1

    let presentFields = bitmapToFields(primaryBitmap)

    // Bit 1 of primary bitmap signals secondary bitmap
    if (primaryBitmap[0]) {
      const [secondaryBitmap, off2] = parseBitmap(buf, offset, encoding)
      offset = off2
      presentFields = [...presentFields, ...bitmapToFields(secondaryBitmap, 64)]
    }

    const fields = {}
    for (const fieldNum of presentFields.sort((a,b) => a-b)) {
      if (fieldNum === 1) continue // bitmap itself
      const spec = FIELD_SPECS[fieldNum]
      if (!spec) { console.warn(`[ISO8583] Unknown field ${fieldNum}, skipping`); continue }
      const [value, newOffset] = extractField(buf, offset, spec, encoding)
      fields[fieldNum] = value
      offset = newOffset
    }

    // Amount (field 4): 12 digits, no decimal, in minor units of currency
    const amountStr  = fields[4] || '0'
    const currencyNum= fields[49] || '840'
    const currency   = CURRENCY_NUM[currencyNum] || 'USD'
    const amountMinor= BigInt(amountStr.replace(/^0+/, '') || '0')

    return createARCMessage({
      originFormat:    'iso8583',
      instructionType: 'CARD_AUTHORIZATION',
      originator:  { rawIdentifier: fields[2] || '', identifierType: 'PAN', name: '' },
      beneficiary: { rawIdentifier: fields[41] || '', identifierType: 'TERMINAL', name: fields[43] || '' },
      amountMinor, currency,
      reference:      fields[11] || fields[37] || '',
      remittanceInfo: null,
      rawFields: { mti, ...fields }
    })
  },

  generate(arc) {
    const f = arc.extensions?.rawFields || {}
    const mti = f.mti || '0210'
    // Simplified generation — restore raw fields
    return Buffer.from(mti + JSON.stringify(f))
  }
}

function parseBitmap(buf, offset, encoding) {
  let bitmapInt
  if (encoding === 'ascii') {
    bitmapInt = BigInt('0x' + buf.slice(offset, offset + 16).toString('ascii'))
    offset += 16
  } else {
    bitmapInt = buf.slice(offset, offset + 8).reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n)
    offset += 8
  }
  const bits = []
  for (let i = 63; i >= 0; i--) bits.unshift(!!(bitmapInt & (1n << BigInt(i))))
  return [bits, offset]
}

function bitmapToFields(bitmap, base = 0) {
  return bitmap.map((present, i) => present ? base + i + 1 : null).filter(Boolean)
}

function extractField(buf, offset, spec, encoding) {
  if (spec.variable) {
    const lenStr = buf.slice(offset, offset + spec.llLen).toString('ascii')
    const len    = parseInt(lenStr, 10)
    offset += spec.llLen
    const value = buf.slice(offset, offset + len).toString('ascii').trim()
    return [value, offset + len]
  }
  const value = buf.slice(offset, offset + spec.length).toString('ascii').trim()
  return [value, offset + spec.length]
}
