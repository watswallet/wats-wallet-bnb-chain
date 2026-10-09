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
  // op1'in (bootstrap approve) KENDI fiyati — tabansiz atsFeeBootstrap. null = yanit vermedi.
  const bootstrapFee = ref(null)
  // Kart "en fazla" diyebilir mi? Tek kaynak quoteAtsTransfer.feeRefundable.
  const feeRefundable = ref(false)
  // BSC'deki toplayici izni bu op'un tahsilatina (ucret + komisyon) YETMIYOR (capraz-zincir).
  // Kaynak quoteAtsTransfer.needsTopUp; bkz. apply().
  const needsTopUp = ref(false)
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

  // Toplam: transfer ucreti + op1 ucreti + komisyon. Bootstrap modunda IKI op gider ve her
  // biri AYRI AYRI tahsil edilir — op1 KENDI (tabansiz) fiyatiyla. op1'i hic saymamak, bakiyesi
  // tam transfer'e yeten kullaniciya "yeterli" gosterirdi; normal fiyattan saymak ise ekrani
  // ~$1 sisiriyordu. Yanit bootstrapFee vermediyse muhafazakar taraf: normal fiyat.
  const totalAtsCost = computed(() => {
    if (atsFee.value == null) return null
    const ops = Math.max(1, Number(opCount.value) || 1)
    const op1 = ops < 2 ? 0 : Number(bootstrapFee.value ?? atsFee.value)
    return Number(atsFee.value) + op1 + Number(commissionHuman.value || 0)
  })

  // BAKIYE BU OP'UN UCRETINE YETIYOR MU? /status'un ready:true'su bunu SOYLEMEZ (komisyon,
  // taban ustu ucret ve bootstrap op1 o kontrolde yok); sormadan gonderen Takas/Kopru'yu
  // /sponsor 'balance-missing' ile GONDERIMDEN SONRA reddediyordu.
  // Bakiye teklifin `atsBalance`i: Send'in kapisiyla ayni kaynak VE maxAtsSellRaw'in
  // kuruldugu ayni balanceRaw -- tavan ile bu karar birbiriyle celisemez.
  // `extraAts`: ayni bakiyeden cikan GONDERILEN ATS (Kopru'de BSC ATS'si). Takas'ta KAPI
  // yalniz ucrete bakar; satilan ATS'yi ucret karsilaniyorsa tavan (exceedsAtsCap) anlatir,
  // karsilanmiyorsa tavan karti susar ve ekran onu yalniz GOSTERILEN tutara ekler.
  // Ucret bilinmiyorsa "yetersiz" DENMEZ: buton zaten !ready ile kapali ve orada
  // "yetersiz bakiye" yazmak yanlis sebebi soylemek olurdu.
  const requiredAtsFor = (extraAts = 0) =>
    totalAtsCost.value == null ? null : totalAtsCost.value + Number(extraAts || 0)
  const insufficientFor = (extraAts = 0) => {
    const gereken = requiredAtsFor(extraAts)
    return gereken != null && Number(atsBalance.value || 0) < gereken
  }
  const insufficient = computed(() => insufficientFor(0))

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
    bootstrapFee.value = null
    feeRefundable.value = false
    needsTopUp.value = false
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
    bootstrapFee.value = res.bootstrapFee == null ? null : Number(res.bootstrapFee)
    feeRefundable.value = res.feeRefundable === true
    needsTopUp.value = !!res.needsTopUp
    nextSteps.value = res.nextSteps || []
    // /status'un ready:true'su TABAN ucretle sorulur; toplayici izni BU op'un tahsilatina
    // yetmiyorsa (needsTopUp) op /sponsor'da 'src-allowance-low' ile GONDERIMDEN SONRA
    // reddedilir. Ekran icin bu "hazir degil" demektir: dugme 'ats-not-ready' ile kilitlenir
    // ve butce tazeleme karti (run-onboarding) gosterilir -- Gonder ekraniyla (useAtsFee)
    // ayni karar. Iki adimli nextSteps backend'in "hic kurulmamis" demesidir; baslik da
    // kurulum olmali. Backend'in KENDI karari/engeli her zaman once gelir.
    ready.value = !!res.ready && !needsTopUp.value
    decision.value = res.decision
      || (res.blocker ? resolveAtsBlocker(res.blocker) : null)
      || (needsTopUp.value
        ? resolveAtsBlocker(nextSteps.value.length > 1 ? 'src-allowance-missing' : 'src-allowance-low')
        : null)
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
    atsFee, atsSymbol, atsBalance, opCount, bootstrapFee, feeRefundable, needsTopUp, ready, decision, nextSteps,
    loading, error, errorCode, blocked,
    commissionAts, commissionHuman, commissionRegion, commissionTreasury,
    hasCommission, totalAtsCost, maxAtsSellRaw, exceedsAtsCap,
    insufficient, requiredAtsFor, insufficientFor,
    load, runOnboarding, reset,
  }
}
