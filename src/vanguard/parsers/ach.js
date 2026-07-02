// Valkyrie Vanguard — NACHA ACH Parser
// Verified field positions against Nacha developer guide.
// Full envelope: File Header(1), Batch Header(5), Entry Detail(6),
// Addenda(7), Batch Control(8), File Control(9)
import { createARCMessage } from '../arc.js'

const RECORD_LENGTH = 94
const CREDIT_CODES  = new Set(['22','23','24','32','33','34'])

export const ACHAdapter = {
  parse(raw) {
    const text  = Buffer.isBuffer(raw) ? raw.toString('ascii') : String(raw)
    const lines = []
    for (let i = 0; i < text.length; i += RECORD_LENGTH) {
      const line = text.slice(i, i + RECORD_LENGTH)
      if (line.trim()) lines.push(line)
    }

    const messages = []
    let batchEntryCount = 0, batchDebitMinor = 0n, batchCreditMinor = 0n

    for (const line of lines) {
      switch (line[0]) {
        case '1': break // File Header
        case '5': batchEntryCount = 0; batchDebitMinor = 0n; batchCreditMinor = 0n; break // Batch Header
        case '6': { // Entry Detail — verified field positions from Nacha developer guide
          const entry = {
            recordType:         line.slice(0, 1),
            transactionCode:    line.slice(1, 3),
            receivingDFIID:     line.slice(3, 11),
            checkDigit:         line.slice(11, 12),
            dfiAccountNumber:   line.slice(12, 29).trim(),
            amount:             line.slice(29, 39).trim(), // 10 chars, no decimal, right-justified zero-filled
            individualIDNumber: line.slice(39, 54).trim(),
            individualName:     line.slice(54, 76).trim(),
            discretionaryData:  line.slice(76, 78),
            addendaIndicator:   line.slice(78, 79),
            traceNumber:        line.slice(79, 94).trim()
          }
          const amountMinor  = BigInt(entry.amount.replace(/^0+/, '') || '0') // already in minor units (cents)
          const isCredit     = CREDIT_CODES.has(entry.transactionCode)
          if (isCredit) batchCreditMinor += amountMinor; else batchDebitMinor += amountMinor
          batchEntryCount++

          messages.push(createARCMessage({
            originFormat:    'nacha_entry',
            instructionType: isCredit ? 'CREDIT_TRANSFER' : 'DEBIT_TRANSFER',
            originator:  { rawIdentifier: '', identifierType: 'ABA_ACCOUNT', name: '' },
            beneficiary: { rawIdentifier: entry.receivingDFIID + entry.dfiAccountNumber, identifierType: 'ABA_ACCOUNT', name: entry.individualName },
            amountMinor, currency: 'USD',
            reference:      entry.traceNumber,
            remittanceInfo: entry.individualIDNumber || null,
            rawFields: entry
          }))
          break
        }
        case '8': { // Batch Control — validate totals
          const ctrlEntryCount  = parseInt(line.slice(6, 14).trim())
          const ctrlCreditStr   = line.slice(39, 51).trim()
          const ctrlCreditMinor = BigInt(ctrlCreditStr.replace(/^0+/, '') || '0')
          if (ctrlEntryCount !== batchEntryCount) console.warn(`[ACH] Batch entry count mismatch: expected ${ctrlEntryCount}, got ${batchEntryCount}`)
          if (ctrlCreditMinor !== batchCreditMinor) console.warn(`[ACH] Batch credit total mismatch: expected ${ctrlCreditMinor}, got ${batchCreditMinor}`)
          break
        }
        case '9': break // File Control
      }
    }
    return messages.length === 1 ? messages[0] : messages
  },

  generate(arc) {
    const f = arc.extensions?.rawFields || {}
    const amtStr = String(arc.core.amountMinor).padStart(10, '0')
    const line6  = `6${f.transactionCode || '22'}${(f.receivingDFIID || '').padEnd(8)}${f.checkDigit || '0'}${(f.dfiAccountNumber || '').padEnd(17)}${amtStr}${(f.individualIDNumber || '').padEnd(15)}${(f.individualName || arc.core.beneficiary?.name || '').padEnd(22).slice(0,22)}${f.discretionaryData || '  '}${f.addendaIndicator || '0'}${(f.traceNumber || arc.core.reference || '').padEnd(15).slice(0,15)}`
    return Buffer.from(line6)
  }
}
