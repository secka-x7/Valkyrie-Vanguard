// Valkyrie Vanguard — Orchestrator
// End-to-end message flow: ingest → screen → route → fee → credit treasury
import { claimMessage, ERR_DUPLICATE } from './idempotency.js'
import { screenMessage } from './screening.js'
import { resolveAddress, discoverPath } from './reach.js'
import { calculateFees } from './fee.js'
import { recordLedger } from '../db.js'
import { detectFormat } from './parsers/auto.js'
import { creditTreasury } from '../core/treasury.js'
import { broadcast } from '../index.js'
import {
  vector1_protocolInsertion, vector3_formatExpansion, vector4_bridgeMonopoly,
  vector5_savingsProof, vector6_intelligenceMoat, vector7_regulatoryShield,
  vector8_temporalLockIn, vector9_ecosystem, vector10_protocolEvolution
} from './accumulate.js'

export async function processMessage(raw, options = {}) {
  const { format: hintFormat, institutionId = 'unknown', priority = 'NORMAL' } = options
  const processId = crypto.randomUUID()

  // 1. Detect format
  const detected = hintFormat ? { format: hintFormat, adapter: null } : detectFormat(raw)
  if (!detected.adapter && !hintFormat) {
    return { status: 'UNSUPPORTED_FORMAT', processId }
  }

  let arc
  try {
    const adapter = detected.adapter
    if (!adapter) return { status: 'NO_ADAPTER', format: detected.format, processId }
    arc = adapter.parse(raw)
    if (Array.isArray(arc)) {
      // NACHA batch — process each entry
      const results = []
      for (const entry of arc) results.push(await processSingleARC(entry, institutionId, priority, processId))
      return { status: 'BATCH', count: results.length, results }
    }
  } catch (e) {
    return { status: 'PARSE_ERROR', error: e.message?.slice(0, 100), processId }
  }

  return processSingleARC(arc, institutionId, priority, processId)
}

async function processSingleARC(arc, institutionId, priority, processId) {
  // 2. Idempotency — atomic claim, fail-closed
  try { claimMessage(arc.envelope.messageId) }
  catch (e) { if (e.code === ERR_DUPLICATE) return { status: 'DUPLICATE', messageId: arc.envelope.messageId }; throw e }

  recordLedger({ messageId: arc.envelope.messageId, event: 'INGESTED', detail: institutionId, format: arc.envelope.originFormat })

  // 3. Address resolution
  const resolved = resolveAddress(arc.core?.beneficiary?.rawIdentifier, arc.core?.beneficiary?.identifierType)
  const path     = discoverPath(resolved)

  // 4. Sanctions screening
  const screen = screenMessage(arc)
  vector7_regulatoryShield(true, screen.cleared)
  recordLedger({ messageId: arc.envelope.messageId, event: 'SCREENED', detail: screen.action, format: arc.envelope.originFormat })

  if (!screen.cleared) {
    recordLedger({ messageId: arc.envelope.messageId, event: 'HELD', detail: JSON.stringify(screen.flags), format: arc.envelope.originFormat })
    return { status: 'HELD', messageId: arc.envelope.messageId, flags: screen.flags }
  }

  // 5. Calculate fees — BigInt throughout
  const controls     = { hourlyVolumeUSD: parseFloat(global._hourlyVolumeUSD || '0') }
  const fees         = calculateFees(arc.envelope.originFormat, priority, arc.core.amountMinor, controls)

  // 6. ACCUMULATE vectors
  vector3_formatExpansion(institutionId, arc.envelope.originFormat)
  vector4_bridgeMonopoly(institutionId, arc.envelope.originFormat)
  vector5_savingsProof(institutionId, fees.totalMinor, fees.swiftEquivMinor, arc.core.currency)
  vector6_intelligenceMoat(arc, institutionId)
  vector8_temporalLockIn(institutionId)
  vector9_ecosystem(arc.envelope.originFormat, institutionId, arc.core?.beneficiary?.rawIdentifier)
  vector10_protocolEvolution(arc.envelope.originFormat)

  // 7. Credit treasury — the only place revenue enters the system
  creditTreasury({ source1Minor: fees.source1Minor, source2Minor: fees.source2Minor, additionalMinor: fees.additionalMinor })

  recordLedger({
    messageId: arc.envelope.messageId, event: 'CREDITED',
    detail: institutionId, format: arc.envelope.originFormat,
    source1Minor: fees.source1Minor, source2Minor: fees.source2Minor,
    additionalMinor: fees.additionalMinor, currency: arc.core.currency
  })

  // Track hourly volume for propeller GP1
  global._hourlyVolumeUSD = ((global._hourlyVolumeUSD || 0) + Number(arc.core.amountMinor) / 100).toFixed(2)

  broadcast('message_processed', {
    messageId:    arc.envelope.messageId,
    format:       arc.envelope.originFormat,
    path:         path.pathType,
    fees:         { source1: fees.source1Minor.toString(), source2: fees.source2Minor.toString(), total: fees.totalMinor.toString() },
    savedVsSwift: fees.savedVsSwiftMinor.toString(),
    currency:     arc.core.currency
  })

  return {
    status:       'PROCESSED',
    messageId:    arc.envelope.messageId,
    path:         path.pathType,
    fees:         { source1Minor: fees.source1Minor.toString(), source2Minor: fees.source2Minor.toString(), totalMinor: fees.totalMinor.toString() },
    savedVsSwift: fees.savedVsSwiftMinor.toString(),
    processId
  }
}
