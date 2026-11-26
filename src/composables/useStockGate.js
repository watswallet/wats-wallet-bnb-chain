// Hisse alim kapisinin ARAYUZ AYNASI (Ilk Alim Kapisi, spec 6.1) -- ortak uygunluk kaynaginin INCE SARMALAYICISI.
//
// YETKI BURADA DEGIL: yetkili kapi arka plan servis calisanindadir (utils/stockGate/gate.js, her edinme
// isleyicisinde). Bu composable kendi mesajini ATMAZ: karari ortak kaynaktan (useStockEligibility, K34) okur ve
// secili ihraccinin kararini bir arayuz durumuna cevirir. Tek STATUS, tek abone sayaci, bayat yanit (seq), geri
// besleme korumasi, sigorta ve yeniden deneme orada TEK yerdedir; yanit bayat olabilir (sorgu ile alim arasinda
// baglanti ulkesi degisebilir), arka plan her alimda kapiyi YENIDEN sorar.
//
// IKI KURAL bu dosyanin sebebidir:
//  1. HISSE OLMAYAN CIKTIDA SIFIR IS: ihracci null (ya da gecersiz) ise abonelik YOK; durum `idle` (kapi ACIK).
//     Hisse olmayan tokene gecen kullanici asla eski bir `blocked` ile kilitli kalmaz: durum her okunusta
//     o anki ihraccidan turetilir.
//  2. BELIRSIZLIK KAPIYI ACMAZ: yanit gelene kadar `checking`; CHECK_FAILED / sigorta `error`; kume disi her sey kapali.
//
// Bu dosya depoya YAZMAZ ve depodan OKUMAZ.
import { computed, toValue } from 'vue'
import { isValidIssuer } from '../utils/stockGate/rules'
import { toGateReason } from '../utils/stockGate/errors'
import { useStockEligibility } from './useStockEligibility'

export const GATE_ALLOWED_STATES = Object.freeze(['idle', 'ok', 'warn'])
export const gateAllows = (state) => GATE_ALLOWED_STATES.includes(state)

const IDLE = Object.freeze({ state: 'idle', reason: null, ipCountry: null })
const CHECKING = Object.freeze({ ...IDLE, state: 'checking' })
const ERROR = Object.freeze({ ...IDLE, state: 'error', reason: 'CHECK_FAILED' })
const CODE_RE = /^[A-Z]{2}$/
const code = (x) => (typeof x === 'string' && CODE_RE.test(x) ? x : null)

/**
 * STOCK_GATE_STATUS kararini (tek ihracci) arayuz durumuna cevirir. ASLA firlatmaz; gecersiz yanit `error` olur.
 * Karar 3 anahtarlidir ({ decision, reason, ipCountry }); cikti da 3 alan tasir (state, reason, ipCountry).
 */
export function stateOfReply(reply) {
  try {
    if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return { ...ERROR }
    const ipCountry = code(reply.ipCountry)
    switch (reply.decision) {
      case 'OK': return { state: 'ok', reason: null, ipCountry }
      case 'WARN': return { state: 'warn', reason: null, ipCountry }
      case 'BLOCKED': return { state: 'blocked', reason: toGateReason(reply.reason), ipCountry }
      default: return { ...ERROR }
    }
  } catch {
    return { ...ERROR }
  }
}

// Ortak kaynaktaki bir karari arayuz durumuna cevirir: CHECK_FAILED (gercek ya da sigorta) `error`dur.
function stateOfVerdict(verdict) {
  const view = stateOfReply(verdict)
  return view.state === 'blocked' && view.reason === 'CHECK_FAILED' ? { ...ERROR } : view
}

/**
 * Vue sarmalayici. issuerSource: ref | getter | dize | null. `enabled` false ise kapi sorulmaz (idle, abonelik yok).
 * Tuketici `reactive(useStockGate(...))` ile ac-sarar; `allowed` Swap/Bridge/StockTrade'in tek kapi kosuludur.
 */
export function useStockGate(issuerSource, { enabled = true } = {}) {
  const issuerOf = () => {
    if (!toValue(enabled)) return null
    const issuer = toValue(issuerSource) ?? null
    return typeof issuer === 'string' && isValidIssuer(issuer) ? issuer : null
  }
  const eligibility = useStockEligibility({ enabled: () => issuerOf() !== null })
  const view = computed(() => {
    const issuer = issuerOf()
    if (issuer === null) return IDLE
    const verdict = eligibility.verdictOf(issuer)
    return verdict === null ? CHECKING : stateOfVerdict(verdict)
  })
  const pick = (name) => computed(() => view.value[name])
  return {
    state: pick('state'),
    reason: pick('reason'),
    ipCountry: pick('ipCountry'),
    allowed: computed(() => gateAllows(view.value.state)),
    refresh: () => (issuerOf() === null ? Promise.resolve() : eligibility.refresh()),
  }
}
