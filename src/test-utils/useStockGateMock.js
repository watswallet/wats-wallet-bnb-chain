// StockTrade ailesi SSR testlerinin ORTAK useStockGate sahtesi (Task 30). Kapi durumu `gateMock.scenario` ile surulur.
// Kullanim (test dosyasinda, importlardan ONCE; vi.mock yukseltildigi icin fabrika icinde dinamik import):
//   vi.mock('../../composables/useStockGate', async (importOriginal) =>
//     (await import('../../test-utils/useStockGateMock.js')).createUseStockGateMock(await importOriginal()))
// Sahte REAKTIFTIR: durum `source` getter'i her degerlendirildiginde yeniden turetilir (ihracci null ise gercek kanca gibi
// 'idle'), boylece `side` / secili hisse render oncesi degistirilince Sat'ta kapi sorulmaz. SSR'da gercek kanca izleyicisi
// calismaz (watch yalniz immediate), bu yuzden sahte computed kullanir.
// Bu dosya TEST yardimcisidir; uretim kodu import ETMEZ.
import { computed } from 'vue'

// K32: gercek kancanin UC alani (state, reason, ipCountry); beyan alanlari (action / country / stale / accountId) kalkti.
export const GATE_IDLE = Object.freeze({ state: 'idle', reason: null, ipCountry: null })
export const GATE_OK = Object.freeze({ ...GATE_IDLE, state: 'ok' })
export const GATE_WARN = Object.freeze({ ...GATE_IDLE, state: 'warn', ipCountry: 'TR' })
export const GATE_CHECKING = Object.freeze({ ...GATE_IDLE, state: 'checking' })
export const gateBlocked = (reason, extra = {}) => Object.freeze({ ...GATE_IDLE, state: 'blocked', reason, ...extra })

// scenario: kaynak (ihracci) null DEGILKEN donen durum. byIssuer: ihracci basina senaryo ({ xstocks: ..., bstocks: ... });
// verilmeyen ihracci icin scenario kullanilir. getters: ekranin kancaya verdigi kaynak getter'lari (sirayla).
export const gateMock = { scenario: GATE_OK, byIssuer: null, getters: [], refreshCalls: 0 }
export const resetGateMock = (scenario = GATE_OK) => {
  gateMock.scenario = scenario
  gateMock.byIssuer = null
  gateMock.getters = []
  gateMock.refreshCalls = 0
}

export function createUseStockGateMock(actual) {
  return {
    ...actual,
    useStockGate: (source) => {
      gateMock.getters.push(source)
      const current = computed(() => {
        const issuer = (typeof source === 'function' ? source() : source) ?? null
        return issuer ? (gateMock.byIssuer?.[issuer] ?? gateMock.scenario) : GATE_IDLE
      })
      const pick = (name) => computed(() => current.value[name])
      return {
        state: pick('state'),
        reason: pick('reason'),
        ipCountry: pick('ipCountry'),
        allowed: computed(() => actual.gateAllows(current.value.state)),
        refresh: () => {
          gateMock.refreshCalls += 1
        },
      }
    },
  }
}
