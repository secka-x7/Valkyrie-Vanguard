// Valkyrie Vanguard — Auto Format Detection
import { MTAdapter }       from './mt.js'
import { ACHAdapter }      from './ach.js'
import { ISO8583Adapter }  from './iso8583.js'
import { ISO20022Adapter } from './iso20022.js'
import { FIXAdapter }      from './fix.js'

export function detectFormat(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
  const buf  = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)

  if (text.includes('{1:') && text.includes('{4:'))    return { format: 'swift_mt', adapter: MTAdapter }
  if (text.includes('<?xml') && text.includes('20022')) return { format: 'iso20022', adapter: ISO20022Adapter }
  if (text.includes('<?xml') && text.includes('sepa'))  return { format: 'sepa', adapter: ISO20022Adapter }
  if (buf.length >= 94 && ['1','5','6','9'].includes(text[0])) return { format: 'nacha', adapter: ACHAdapter }
  if (text.includes('\x01') && text.includes('35='))    return { format: 'fix', adapter: FIXAdapter }
  if (buf.length >= 4 && /^\d{4}/.test(text.slice(0, 4))) return { format: 'iso8583', adapter: ISO8583Adapter }
  return { format: 'unknown', adapter: null }
}
