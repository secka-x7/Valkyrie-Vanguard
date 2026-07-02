// Valkyrie Vanguard — Adapter Registry
// Hard-gated certification. No uncertified adapter ever processes a message.

const _adapters   = {}
const _certified  = {}

export function registerAdapter(formatId, adapter, goldenFixtures) {
  if (!goldenFixtures?.length) throw new Error(`REFUSING to register adapter for ${formatId}: zero golden fixtures provided`)
  for (let i = 0; i < goldenFixtures.length; i++) {
    try {
      const parsed       = adapter.parse(goldenFixtures[i])
      const regenerated  = adapter.generate(parsed)
      if (!semanticallyEquivalent(goldenFixtures[i], regenerated, adapter)) {
        throw new Error(`Roundtrip mismatch on fixture ${i}`)
      }
    } catch (e) { throw new Error(`Adapter ${formatId} FAILED certification on fixture ${i}: ${e.message}`) }
  }
  _adapters[formatId]  = adapter
  _certified[formatId] = true
  console.log(`[REGISTRY] Adapter certified: ${formatId}`)
}

export function getAdapter(formatId) {
  if (!_certified[formatId]) throw new Error(`Adapter ${formatId} not certified — REFUSING to process messages`)
  return _adapters[formatId]
}

export function listFormats() { return Object.keys(_certified) }

function semanticallyEquivalent(original, regenerated, adapter) {
  // Re-parse both and compare structured fields — not byte comparison
  try {
    const p1 = adapter.parse(original)
    const p2 = adapter.parse(regenerated)
    return p1.core.amountMinor === p2.core.amountMinor &&
           p1.core.currency    === p2.core.currency &&
           p1.core.reference   === p2.core.reference
  } catch { return false }
}
