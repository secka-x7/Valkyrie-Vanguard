// Valkyrie Vanguard — ISO 20022 Parser
// pacs.008, pacs.009, pain.001, camt.052, camt.053, camt.054
// XML parsing without external deps — lightweight regex-based extraction
import { createARCMessage, parseDecimalToMinor } from '../arc.js'

function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  return xml.match(re)?.[1]?.trim() || null
}

function extractTagAll(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi')
  const results = []; let m
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim())
  return results
}

const MSG_TYPE_MAP = {
  'pacs.008': 'CREDIT_TRANSFER',
  'pacs.009': 'FI_CREDIT_TRANSFER',
  'pain.001': 'PAYMENT_INITIATION',
  'camt.052': 'ACCOUNT_REPORT',
  'camt.053': 'ACCOUNT_STATEMENT',
  'camt.054': 'DEBIT_CREDIT_NOTIFICATION'
}

export const ISO20022Adapter = {
  parse(raw) {
    const xml     = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
    const msgType = detectMsgType(xml)
    const instrType = MSG_TYPE_MAP[msgType] || 'UNKNOWN'

    const amtTag  = extractTag(xml, 'InstdAmt') || extractTag(xml, 'Amt') || extractTag(xml, 'TxAmt')
    const currency = amtTag ? (/<[^>]+ Ccy="([^"]+)"/.exec(xml.slice(xml.indexOf(amtTag?.slice(0,10)) - 50, xml.indexOf(amtTag?.slice(0,10)) + 50))?.[1] || 'USD') : 'USD'
    const amtStr   = amtTag?.replace(/<[^>]+>/g, '').trim() || '0'
    const amountMinor = parseDecimalToMinor(amtStr, currency)

    const debtorName  = extractTag(xml, 'Dbtr')  ? extractTag(extractTag(xml, 'Dbtr')  || '', 'Nm') : null
    const credtrName  = extractTag(xml, 'Cdtr')  ? extractTag(extractTag(xml, 'Cdtr')  || '', 'Nm') : null
    const debtorAcct  = extractTag(xml, 'DbtrAcct')  ? extractTag(extractTag(xml, 'DbtrAcct')  || '', 'Id') : null
    const credtrAcct  = extractTag(xml, 'CdtrAcct')  ? extractTag(extractTag(xml, 'CdtrAcct')  || '', 'Id') : null
    const uetr        = extractTag(xml, 'UETR') || extractTag(xml, 'EndToEndId') || ''
    const reference   = extractTag(xml, 'MsgId') || extractTag(xml, 'TxId') || uetr
    const remittance  = extractTag(xml, 'RmtInf') || null

    return createARCMessage({
      originFormat: `iso20022_${msgType?.replace('.','') || 'unknown'}`,
      instructionType: instrType,
      originator:  { rawIdentifier: debtorAcct  || '', identifierType: 'IBAN', name: debtorName  || '' },
      beneficiary: { rawIdentifier: credtrAcct  || '', identifierType: 'IBAN', name: credtrName  || '' },
      amountMinor, currency, reference,
      remittanceInfo: remittance,
      rawFields: { msgType, uetr, xml: xml.slice(0, 500) } // preserve original for Extensions
    })
  },

  generate(arc) {
    const msgType = arc.extensions?.rawFields?.msgType || 'pacs.008'
    const exp = 2
    const mult = 10n ** BigInt(exp)
    const whole = arc.core.amountMinor / mult
    const frac  = arc.core.amountMinor % mult
    const amtStr = `${whole}.${String(frac).padStart(exp,'0')}`
    return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:${msgType}">
  <${msgType === 'pacs.008' ? 'FIToFICstmrCdtTrf' : 'MsgEnvlp'}>
    <GrpHdr><MsgId>${arc.core.reference}</MsgId><CreDtTm>${new Date().toISOString()}</CreDtTm></GrpHdr>
    <CdtTrfTxInf>
      <Dbtr><Nm>${arc.core.originator?.name || ''}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${arc.core.originator?.rawIdentifier || ''}</IBAN></Id></DbtrAcct>
      <Cdtr><Nm>${arc.core.beneficiary?.name || ''}</Nm></Cdtr>
      <CdtrAcct><Id><IBAN>${arc.core.beneficiary?.rawIdentifier || ''}</IBAN></Id></CdtrAcct>
      <InstdAmt Ccy="${arc.core.currency}">${amtStr}</InstdAmt>
    </CdtTrfTxInf>
  </${msgType === 'pacs.008' ? 'FIToFICstmrCdtTrf' : 'MsgEnvlp'}>
</Document>`)
  }
}

function detectMsgType(xml) {
  const nsMatch = xml.match(/urn:iso:std:iso:20022:tech:xsd:([a-z.0-9]+)/)
  if (nsMatch) return nsMatch[1]
  if (xml.includes('FIToFICstmrCdtTrf')) return 'pacs.008'
  if (xml.includes('pain.001')) return 'pain.001'
  if (xml.includes('camt.053')) return 'camt.053'
  return 'unknown'
}
