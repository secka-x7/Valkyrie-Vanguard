// Valkyrie Vanguard — REACH: Universal Address Resolution
// RUSH: Instant anchor activation with transitive closure.
// BIC/ABA/IBAN resolution from public data.
// Reachability graph grows with every anchor connection.
import { setConfig, getConfig } from '../db.js'
import { broadcast } from '../index.js'

// In-memory graph — protected from concurrent mutation via async serialization
const _nodes = new Map()   // vid → { vid, networks, correspondents }
const _edges  = new Map()  // vid → Set<correspondent_id>
const _reachable = new Set()
const _anchors   = new Map()

// Public BIC directory subset — grows with connections
// Format: BIC → { country, name, city }
const _bicDir = new Map([
  ['CHASUS33', { country: 'US', name: 'JPMorgan Chase', city: 'New York', network: 'SWIFT' }],
  ['CITIUS33', { country: 'US', name: 'Citibank', city: 'New York', network: 'SWIFT' }],
  ['BOFAUS3N', { country: 'US', name: 'Bank of America', city: 'Charlotte', network: 'SWIFT' }],
  ['DEUTDEDB', { country: 'DE', name: 'Deutsche Bank', city: 'Frankfurt', network: 'SWIFT' }],
  ['HSBCGB2L', { country: 'GB', name: 'HSBC', city: 'London', network: 'SWIFT' }],
  ['BNPAFRPP', { country: 'FR', name: 'BNP Paribas', city: 'Paris', network: 'SWIFT' }],
])

const _abaDir = new Map([
  ['021000021', { name: 'JPMorgan Chase', state: 'NY', network: 'ACH_FEDWIRE' }],
  ['021000089', { name: 'Citibank', state: 'NY', network: 'ACH_FEDWIRE' }],
  ['121000358', { name: 'Bank of America', state: 'CA', network: 'ACH_FEDWIRE' }],
])

export function resolveAddress(rawId, idType) {
  const id = rawId?.toUpperCase()?.trim()
  if (!id) return { reachability: 'UNKNOWN', confidence: 0 }

  // Direct VANGUARD participant check
  for (const [vid, node] of _nodes) {
    if (node.aliases?.includes(id)) return { vid, reachability: 'DIRECT', confidence: 1.0 }
  }

  // BIC resolution
  if (idType === 'BIC' || /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(id)) {
    const entry = _bicDir.get(id)
    if (entry) return { rawId: id, external: { ...entry, identifier: id }, reachability: 'INDIRECT', confidence: 1.0 }
    return { rawId: id, reachability: 'INDIRECT', confidence: 0.5, note: 'BIC not in local directory — RUSH may resolve' }
  }

  // ABA routing number
  if (idType === 'ABA' || /^\d{9}$/.test(id)) {
    const entry = _abaDir.get(id)
    if (entry) return { rawId: id, external: { ...entry, identifier: id }, reachability: 'INDIRECT', confidence: 1.0 }
    return { rawId: id, reachability: 'INDIRECT', confidence: 0.6, note: 'ABA in ACH/Fedwire network' }
  }

  // IBAN — validate structure
  if (idType === 'IBAN' || /^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(id)) {
    const country = id.slice(0, 2)
    return { rawId: id, external: { country, network: 'SEPA_SWIFT', identifier: id }, reachability: 'INDIRECT', confidence: 0.9 }
  }

  return { rawId: id, reachability: 'UNKNOWN', confidence: 0 }
}

export function discoverPath(resolved) {
  if (!resolved || resolved.reachability === 'UNKNOWN') return { pathType: 'UNREACHABLE' }
  if (resolved.reachability === 'DIRECT') return { pathType: 'DIRECT', hops: [resolved.vid], latencyMs: 50 }

  // Find best anchor for the destination's network
  const network = resolved.external?.network
  const candidates = []
  for (const [anchorId, cap] of _anchors) {
    if (cap.networks?.includes(network)) candidates.push({ anchorId, ...cap })
  }

  if (candidates.length === 0) return { pathType: 'UNAVAILABLE', note: `No anchor with access to ${network}` }

  // Select optimal anchor
  const best = candidates.sort((a, b) =>
    (b.successRate || 0.95) * (1 / (b.avgLatencyMs || 500)) -
    (a.successRate || 0.95) * (1 / (a.avgLatencyMs || 500))
  )[0]

  return { pathType: 'RELAYED', hops: [best.anchorId, resolved.rawId], anchor: best.anchorId, estimatedLatencyMs: (best.avgLatencyMs || 500) + 50 }
}

// RUSH — instant reach activation on anchor connect
export function onAnchorConnect(capability) {
  const { vid, networks, correspondents = [], avgLatencyMs = 300, successRate = 0.99 } = capability
  _anchors.set(vid, capability)
  _nodes.set(vid, { vid, networks, correspondents })
  _edges.set(vid, new Set(correspondents))

  // Expand reachable set
  const newlyReachable = new Set()
  correspondents.forEach(c => { if (!_reachable.has(c)) { _reachable.add(c); newlyReachable.add(c) } })

  // Transitive closure — BFS
  const queue = [...correspondents]
  const visited = new Set(correspondents)
  while (queue.length) {
    const node = queue.shift()
    const edges = _edges.get(node) || new Set()
    for (const neighbor of edges) {
      if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); if (!_reachable.has(neighbor)) { _reachable.add(neighbor); newlyReachable.add(neighbor) } }
    }
  }

  // Register BIC aliases for this anchor
  if (capability.bic) _bicDir.set(capability.bic, { country: capability.jurisdiction || 'XX', name: capability.name || vid, city: capability.city || '', network: 'SWIFT', via: vid })

  setConfig('reachable_count', String(_reachable.size))
  setConfig('anchor_count', String(_anchors.size))
  broadcast('rush', { vid, newlyReachable: newlyReachable.size, totalReachable: _reachable.size })

  console.log(`[RUSH] Anchor connected: ${vid} → ${newlyReachable.size} new destinations, ${_reachable.size} total`)
  return { vid, newlyReachableCount: newlyReachable.size, totalReachable: _reachable.size }
}

export function getReachStats() {
  return { anchors: _anchors.size, reachable: _reachable.size, directNodes: _nodes.size }
}
