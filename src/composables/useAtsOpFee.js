// SWAP/BRIDGE icin ATS ucreti + KOMISYON durumu — belge "Swap ve Bridge Komisyonu".
//
// `useAtsFee` transfer akisina ozeldir (sentAssetAddress/sendAmount uzerinden atsFee.js
// matematigini kosar). Swap ve bridge'in sorulari FARKLI:
//   - komisyon var mi, ne kadar, hangi bolgede (§01, §02)
//   - ATS SATAN bir swap'a en fazla ne kadar girebilir (§06.1)
//   - rota native deger gerektiriyor mu (§06.3)
// Bu yuzden ayri bir composable; ikisini tek yerde birlestirmek her iki akisin da
// kararlarini bulaniklastirirdi.
//
// TEKLIF BACKGROUND'DA KURULUR (ATS_SWAP_FEE_QUOTE / ATS_BRIDGE_FEE_QUOTE): fiyatlanan cagri
// listesi ile GONDERILEN liste AYNI olmak zorunda — komisyonlu op'ta /quote callData ile
// cagrilir ve kilit ona civilenir. Listeyi burada bir daha kurmak iki ayri kilit demekti.
import { ref, computed } from 'vue'
import { resolveAtsBlocker } from '../utils/atsBlocker'

const toBig = (v) => {
  if (v === undefined || v === null || v === '') return null
  try { return BigInt(v) } catch { return null }
}

export function useAtsOpFee() {
  const atsFee = ref(null)            // op basina ucret (insan birimi)
  const atsSymbol = ref('ATS')
  const atsBalance = ref(0)
  const opCount = ref(1)
  const ready = ref(false)
  const decision = ref(null)          // resolveAtsBlocker ciktisi | null
  const nextSteps = ref([])
  const loading = ref(false)
  const error = ref(null)
  const errorCode = ref(null)

  // --- komisyon ---
  const commissionAts = ref('0')      // ATS-wei, KILITLENEN tutar
  const commissionHuman = ref(0)
  const commissionRegion = ref('local')
  const commissionTreasury = ref(null)
  // §06.1 — ATS SATAN bir swap'a en fazla bu kadar ATS girebilir (ATS-wei).
  const maxAtsSellRaw = ref(null)

  const hasCommission = computed(() => (toBig(commissionAts.value) ?? 0n) > 0n)

  // Toplam: op basina ucret x op sayisi + komisyon. Bootstrap modunda IKI op gider ve her
  // biri AYRI AYRI tahsil edilir; tek op uzerinden hesaplamak 1x-2x arasi bakiyesi olan
  // kullaniciya "yeterli" gosterirdi.
  const totalAtsCost = computed(() => {
    if (atsFee.value == null) return null
    return Number(atsFee.value) * Math.max(1, Number(opCount.value) || 1) + Number(commissionHuman.value || 0)
  })

  const blocked = computed(() => !ready.value)

  /**
   * §06.1 — satilacak ATS miktari tavani asiyor mu.
   *
   * `amountRaw`: swap'a girecek ATS miktari (wei). Tavan yoksa (teklif alinmadi) ENGELLEMEZ:
   * yanlis bir "yetersiz" karti, calisacak bir islemi bloklamaktan kotudur — gercek koruma
   * zaten teklif geldiginde devreye girer.
   */
  const exceedsAtsCap = (amountRaw) => {
    const cap = toBig(maxAtsSellRaw.value)
    const amount = toBig(amountRaw)
    if (cap === null || amount === null) return false
    return amount > cap
  }

  const reset = () => {
    atsFee.value = null
    ready.value = false
    decision.value = null
    nextSteps.value = []
    error.value = null
    errorCode.value = null
    commissionAts.value = '0'
    commissionHuman.value = 0
    maxAtsSellRaw.value = null
  }

  const apply = (res) => {
    atsFee.value = res.transferFee
    atsSymbol.value = res.symbol || 'ATS'
    atsBalance.value = res.atsBalance ?? 0
    opCount.value = res.opCount || 1
    ready.value = !!res.ready
    decision.value = res.decision || (res.blocker ? resolveAtsBlocker(res.blocker) : null)
    nextSteps.value = res.nextSteps || []
    commissionAts.value = res.commissionAts ?? '0'
    commissionHuman.value = res.commissionAtsHuman ?? 0
    commissionRegion.value = res.commissionRegion || 'local'
    commissionTreasury.value = res.commissionTreasury || null
    maxAtsSellRaw.value = res.maxAtsSellRaw ?? null
  }

  /**
   * `kind`: 'swap' | 'bridge'. `payload`: ilgili ucun bekledigi alanlar (bkz. background.js
   * atsSwapFeeQuote / atsBridgeFeeQuote).
   *
   * Yaris korumasi: art arda miktar degistirildiginde GEC donen eski teklif yenisini EZMEZ.
   */
  let requestId = 0
  const load = async ({ kind, payload }) => {
    const id = ++requestId
    loading.value = true
    error.value = null
    errorCode.value = null
    try {
      const type = kind === 'bridge' ? 'ATS_BRIDGE_FEE_QUOTE' : 'ATS_SWAP_FEE_QUOTE'
      const res = await chrome.runtime.sendMessage({ type, message: payload })
      if (id !== requestId) return
      if (!res || !res.success) {
        reset()
        error.value = (res && res.error) || 'teklif alinamadi'
        errorCode.value = res && res.code
        // Kodsuz hatalarda karar HTTP durumundan verilir; 5xx ile 4xx ayri kartlardir.
        decision.value = resolveAtsBlocker(res && (res.code || res.httpStatus))
        return
      }
      apply(res)
    } catch (e) {
      if (id !== requestId) return
      reset()
      error.value = e.message
    } finally {
      if (id === requestId) loading.value = false
    }
  }

  const runOnboarding = async ({ chainId, address, index }) => {
    loading.value = true
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'ATS_RUN_ONBOARDING', message: { chainId, address, index },
      })
      if (!res || !res.success) {
        error.value = (res && res.error) || 'kurulum basarisiz'
        errorCode.value = res && res.code
        return false
      }
      return true
    } finally {
      loading.value = false
    }
  }

  return {
    atsFee, atsSymbol, atsBalance, opCount, ready, decision, nextSteps,
    loading, error, errorCode, blocked,
    commissionAts, commissionHuman, commissionRegion, commissionTreasury,
    hasCommission, totalAtsCost, maxAtsSellRaw, exceedsAtsCap,
    load, runOnboarding, reset,
  }
}
