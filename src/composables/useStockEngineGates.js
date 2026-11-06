// Al/Sat ekraninin MOTORA BAGLI kapilari (spec 5.3, T14). Yalniz bStocks (pancake) motorunda etkindir;
// xStocks (cow) icin hicbir sey istemez ve hicbir kapi uretmez (extraBlock hep null).
//
//  1) ATS ucreti: hazir teklifin COZULMUS istegiyle (`quote.result.request`, index/slippage dahil) motorun
//     `atsPayload`i hesaplanir ve mevcut `useAtsOpFee` ile ATS_SWAP_FEE_QUOTE istenir (Swap.vue ile ayni yuk).
//     Ucret yalniz GECERLI TEKLIFE aittir: teklif kimligi degisince eski ucret SAYILMAZ (`loadedFor`).
//  2) Fiyat etkisi onayi (> %5): onay kutusu her yeni teklifte duser; olculemeyen etki (N/A) kilitlemez.
//
// Ekran kapiyi `extraBlock` ile okur: null = ek engel yok. Sira: ucret kapilari, sonra fiyat etkisi onayi.
// Hesap yoktur: sayilar `useAtsOpFee` ve motorun `display`inden gelir.
import { computed, reactive, ref, watch } from 'vue'
import { useAtsOpFee } from './useAtsOpFee'
import { priceImpactBlocked } from '../utils/stocks/engines/pancakeQuote'

/**
 * @param {{ engine: import('vue').Ref<object|null>, quote: object, account?: import('vue').Ref<object|null> }} opts
 *   engine: engineFor(...) sonucu (ref). quote: reaktif useCowQuote cikisi (state, quoteId, result).
 *   account: aktif hesap (ATS kurulumu icin adres).
 */
export function useStockEngineGates({ engine, quote, account = ref(null) } = {}) {
  const ats = reactive(useAtsOpFee())
  const acknowledged = ref(false)
  // Ucreti YUKLENMIS son teklif kimligi: atsQuoted ve ats-loading karari bununla verilir.
  const loadedFor = ref(null)
  let lastPayload = null

  const usesAts = computed(() => engine.value?.id === 'pancake')

  const payload = computed(() => {
    if (!usesAts.value || quote.state !== 'ready') return null
    const request = quote.result?.request
    return request ? engine.value.atsPayload(request) : null
  })

  async function loadFor(p, id) {
    lastPayload = p
    loadedFor.value = null
    await ats.load(p)
    // Bu arada yeni teklif/yuk geldiyse eski sonuc YENIYE sayilmaz.
    if (lastPayload === p && quote.quoteId === id) loadedFor.value = id
  }

  function resetFee() {
    lastPayload = null
    loadedFor.value = null
    ats.reset()
  }

  watch(
    payload,
    (p) => {
      if (p) {
        loadFor(p, quote.quoteId)
        return
      }
      // 'loading' ara durumunda eski ucret kalir (kart yanip sonmesin); karar yine de loadedFor'dadir.
      if (!usesAts.value || quote.state === 'idle' || quote.state === 'error' || quote.state === 'locked') resetFee()
    },
    { immediate: true },
  )
  watch(() => engine.value?.id, () => resetFee())
  watch(() => quote.quoteId, () => {
    acknowledged.value = false
  })

  const atsQuoted = computed(() =>
    usesAts.value && loadedFor.value !== null && loadedFor.value === quote.quoteId && ats.atsFee != null
      ? { transferFee: ats.atsFee, commissionFee: ats.commissionHuman }
      : null,
  )

  // null | 'ats-loading' | 'ats-insufficient' | 'ats-blocked'
  const atsBlock = computed(() => {
    if (!usesAts.value || quote.state !== 'ready') return null
    if (ats.loading || loadedFor.value !== quote.quoteId) return 'ats-loading'
    if (ats.atsFee != null && ats.insufficient) return 'ats-insufficient'
    if (!ats.ready || ats.atsFee == null) return 'ats-blocked'
    return null
  })
  const atsBlocked = computed(() => atsBlock.value === 'ats-insufficient' || atsBlock.value === 'ats-blocked')

  const impact = computed(() => quote.result?.display?.priceImpact ?? null)
  const gated = computed(() => engine.value?.hasPriceImpactGate === true && quote.state === 'ready')
  const priceImpactHigh = computed(() => gated.value && impact.value?.high === true)
  const priceImpactUnmeasured = computed(() => gated.value && impact.value?.unmeasured === true)
  const impactBlock = computed(() => (priceImpactHigh.value && priceImpactBlocked(impact.value, acknowledged.value).blocked ? 'price-impact' : null))

  const extraBlock = computed(() => atsBlock.value ?? impactBlock.value)

  // ATS kurulumu (src-allowance/balance adimlari): ayni yukle calisir, sonra ucret tazelenir.
  async function startOnboarding() {
    const p = lastPayload
    const address = account.value?.address
    if (!p || !address) return false
    const ok = await ats.runOnboarding({ chainId: p.payload.chainId, address, index: p.payload.index })
    if (ok && lastPayload === p) await loadFor(p, quote.quoteId)
    return ok
  }

  return { ats, atsQuoted, atsBlock, atsBlocked, extraBlock, acknowledged, priceImpactHigh, priceImpactUnmeasured, startOnboarding }
}
