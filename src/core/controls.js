// Valkyrie Vanguard — Mirror Control State
import { setConfig, getConfig } from '../db.js'

const DEFAULTS = {
  global_fee: '0.05',
  s2_multiplier: '1.0',
  // Per-format Source 1 fee multipliers (1.0 = default)
  fee_swift_mx: '1.0', fee_swift_mt103: '1.0', fee_fedwire: '1.0',
  fee_chips: '1.0', fee_sepa_sct: '1.0', fee_sepa_inst: '1.0',
  fee_nacha_entry: '1.0', fee_fix_order: '1.0', fee_iso8583: '1.0',
  fee_target2: '1.0', fee_cls: '1.0',
  // Source 2 tier multipliers
  s2_tier_0_10k: '1.0', s2_tier_10k_100k: '1.0',
  s2_tier_100k_1m: '1.0', s2_tier_1m_10m: '1.0',
  s2_tier_10m_100m: '1.0', s2_tier_100m_1b: '1.0', s2_tier_1b_plus: '1.0',
  // Propeller intensities
  gp1: '10', gp2: '10', gp3: '10', gp4: '10', gp5: '10',
  gp6: '10', gp7: '10', gp8: '10', gp9: '10', gp10: '10',
  // Operational
  dominion_sensitivity: 'high', auto_withdraw_threshold: '0',
}

export function initControls() {
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (getConfig('ctl_' + k) === null) setConfig('ctl_' + k, v)
  }
}

export function getControls() {
  const out = {}
  for (const k of Object.keys(DEFAULTS)) {
    const raw = getConfig('ctl_' + k)
    out[k] = raw !== null ? (isNaN(raw) ? raw : parseFloat(raw)) : parseFloat(DEFAULTS[k])
  }
  return out
}

export function setControl(key, value) {
  if (!(key in DEFAULTS)) throw new Error('Unknown control: ' + key)
  setConfig('ctl_' + key, String(value))
  return getControls()
}
