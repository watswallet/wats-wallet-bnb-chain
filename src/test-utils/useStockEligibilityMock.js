// Yuzey SSR testlerinin ORTAK useStockEligibility sahtesi (Task 40; useStockGateMock.js kalibi). Uygunluk durumu
// `eligibilityMock.scenario` ile surulur ve REAKTIFTIR: senaryo degisince okuyan computed / render yeniden hesaplanir.
// Kullanim (test dosyasinda, importlardan ONCE; vi.mock yukseltildigi icin fabrika icinde dinamik import):
//   vi.mock('../../composables/useStockEligibility', async (importOriginal) =>
//     (await import('../../test-utils/useStockEligibilityMock.js')).createUseStockEligibilityMock(await importOriginal()))
// Sahte gercek kancayla ayni ANLAMI tasir: yuklenirken ready false ve hicbir ihracci musait degil (yukleme = gizli);
// isAvailable yalniz ready iken OK / WARN icin true; bilinmeyen ihracci false.
// `options`: yuzeylerin kancaya verdigi `enabled` secenekleri (sirayla); `refreshCalls`: refresh() cagri sayisi.
// Bu dosya TEST yardimcisidir; uretim kodu import ETMEZ.
import { computed, reactive } from 'vue'

const verdict = (decision, reason, ipCountry = null) => Object.freeze({ decision, reason, ipCountry })
const OK = verdict('OK', 'OK')
const IP_BLOCKED = verdict('BLOCKED', 'IP_COUNTRY_ISSUER', 'TR')
const UNKNOWN = verdict('BLOCKED', 'COUNTRY_UNKNOWN')
const senaryo = (bstocks, xstocks) => Object.freeze({ ready: true, verdicts: Object.freeze({ bstocks, xstocks }) })

export const ELIGIBILITY_ALL = senaryo(OK, OK)
export const ELIGIBILITY_XSTOCKS_ONLY = senaryo(IP_BLOCKED, OK)
export const ELIGIBILITY_NONE = senaryo(IP_BLOCKED, IP_BLOCKED)
export const ELIGIBILITY_UNKNOWN = senaryo(UNKNOWN, UNKNOWN)
export const ELIGIBILITY_LOADING = Object.freeze({ ready: false, verdicts: null })

export const eligibilityMock = reactive({ scenario: ELIGIBILITY_ALL, options: [], refreshCalls: 0 })
export const resetEligibilityMock = (scenario = ELIGIBILITY_ALL) => {
  eligibilityMock.scenario = scenario
  eligibilityMock.options = []
  eligibilityMock.refreshCalls = 0
}

const ISSUERS = ['bstocks', 'xstocks']

export function createUseStockEligibilityMock(actual) {
  return {
    ...actual,
    useStockEligibility: (options = {}) => {
      eligibilityMock.options.push(options)
      const ready = computed(() => Boolean(eligibilityMock.scenario.ready))
      const verdictOf = (issuer) => {
        const s = eligibilityMock.scenario
        if (!s.ready || !s.verdicts || !ISSUERS.includes(issuer)) return null
        return s.verdicts[issuer] ?? null
      }
      const isAvailable = (issuer) => {
        const v = verdictOf(issuer)
        return Boolean(v) && (v.decision === 'OK' || v.decision === 'WARN')
      }
      const availableIssuers = computed(() => ISSUERS.filter((issuer) => isAvailable(issuer)))
      return {
        ready,
        isAvailable,
        warnOf: (issuer) => verdictOf(issuer)?.decision === 'WARN',
        verdictOf,
        availableIssuers,
        anyAvailable: computed(() => availableIssuers.value.length > 0),
        refresh: async () => {
          eligibilityMock.refreshCalls += 1
        },
      }
    },
  }
}
