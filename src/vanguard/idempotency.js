// Valkyrie Vanguard — Idempotency
// Atomic claim. Fail-closed. Duplicate messages silently rejected.
import { claimIdempotency } from '../db.js'

export const ERR_DUPLICATE = 'DUPLICATE_MESSAGE'

export function claimMessage(messageId) {
  if (!messageId) throw new Error('messageId required for idempotency claim')
  const claimed = claimIdempotency(messageId)
  if (!claimed) {
    const err = new Error(`Message ${messageId} already processed — duplicate rejected`)
    err.code  = ERR_DUPLICATE
    throw err
  }
  return true
}
