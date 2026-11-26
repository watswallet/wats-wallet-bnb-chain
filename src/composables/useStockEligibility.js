// Hisse alim kapisinin ORTAK UYGUNLUK KAYNAGI (Ilk Alim Kapisi, K34, K38; spec 5.12, 6.1).
//
// YETKI BURADA DEGIL: yetkili kapi arka plan servis calisanindadir (utils/stockGate/gate.js, her edinme
// isleyicisinde). Bu modul yalniz `STOCK_GATE_STATUS` sorar; yanit kural tablosundaki HER ihracciyi tek anlik goruntuden
// verir ({ bstocks: V, xstocks: V, ondo: V, ... }; Bolum 2: tablo-gudumlu), boylece liste / arama / oneri yuzeyleri "hangi
// ihracci musait" sorusunu ayni ulke aninda ve tek beklemeyle sorar. Zorunlu iki ihracci (bstocks, xstocks) yanitta
// eksik / bozuksa CHECK_FAILED olur; yanitta OLMAYAN baska bir ihracci icin karar yoktur (verdictOf null: kullanilamaz).
// Yanit bayat olabilir (sorgu ile alim arasinda baglanti ulkesi degisebilir); arka plan her alimda kapiyi YENIDEN sorar.
//
// KURALLAR (her biri bir hata sinifini kapatir):
//  1. YUKLEME = GIZLI (TEK YER): yanit gelene kadar hicbir ihracci musait sayilmaz (`isAvailable` false). Yuzeyler
//     "yukleniyor" icin ayri dal yazmaz; uygunluk yalniz buradan okunur.
//  2. TEMBEL ve ABONE SAYACLI: modul yuklenirken mesaj yok; abone yokken mesaj yok. Ilk abone sorar, son abone
//     birakinca zamanlayici ve dinleyici kalkar. `enabled` false olan yuzey hic abone olmaz.
//  3. SIGORTA: 5 sn icinde yanit yoksa ekran sonsuza dek iskelet kalmasin diye `ready` olur ve zorunlu iki ihracci
//     BLOCKED / CHECK_FAILED sayilir, baska ihraccilarin karari yoktur (`fused: true`). Sigorta `seq`'i ARTIRMAZ:
//     gec gelen GERCEK yanit durumu degistirir ve `fused`'i temizler (PE20 c).
//  4. BAYAT YANIT YOK SAYILIR (RF1): abonelik donemi degisince `seq` artar, eski istegin yaniti durumu degistirmez.
//  5. GERI BESLEME DONGUSU YOK (RF2): arka plan oturum onbellegini YAZAR ve bu `chrome.storage.onChanged` olayi
//     uretir; olay yeniden sorguyu tetikler. Uc koruma: (a) ayni anda en cok BIR istek ucusta, ucus sirasinda gelen
//     tetikler TEK ek istege birlesir; (b) bir "salvo"da en cok MAX_REQUESTS_PER_BURST istek; (c) salvo, SETTLE_MS
//     sessizlikten sonra yenilenir. Yazma -> olay -> sorgu -> yazma sonsuz dongusu en cok 1 ek istekte durur.
//  6. PERIYODIK SORGU YOK (bilincli, PE20 a): ulke degisimini yuzey su tetiklerle gorur: pencere gorunur olunca,
//     izlenen depo anahtarlari degisince, bir arka plan reddi (`refresh()`), yeniden `acquire` ve ulke bilinmiyorken /
//     sigorta durumunda tek zamanlayici. Yetki arka plandadir ve her Al'i yeniden denetler.
//  7. ANLIK GORUNTU son abone birakinca SILINMEZ (PE20 b): Home -> StockDetail -> StockTrade gezinmesinde abone
//     sayisi 1 -> 0 -> 1 olur; her gecista iskelet yanip sonmesin. Goruntu ELIGIBILITY_REUSE_MS'den gencse `ready`
//     sunulur ve arka planda yeniden sorulur; eskiyse `loading`'e doner.
//
// Bu dosya depoya YAZMAZ ve depodan OKUMAZ: yalniz `chrome.storage.onChanged` olaylarini dinler (hangi anahtarin
// degistigine bakar) ve `chrome.runtime.sendMessage` ile arka plana sorar.
import { computed, onMounted, onScopeDispose, shallowRef, toValue, watch } from 'vue'
import { REQUIRED_ISSUERS, isValidIssuer } from '../utils/stockGate/rules'
import { toGateReason } from '../utils/stockGate/errors'

export const ELIGIBILITY_FUSE_MS = 5000
export const ELIGIBILITY_RETRY_BASE_MS = 65000 // rulesClient BACKOFF_MS (60000) + 5000 pay
export const ELIGIBILITY_RETRY_JITTER_MS = 10000 // + [0, 10000) rastgele sapma
export const ELIGIBILITY_REUSE_MS = 30000

// Degisince yeniden sorulan depo anahtarlari (biri local, biri session; alan adi ayirt edilmez).
export const STOCK_GATE_WATCHED_KEYS = Object.freeze(['stock_gate_cache', 'stock_gate_rules_cache'])
export const SETTLE_MS = 300
export const MAX_REQUESTS_PER_BURST = 2

const DECISIONS = Object.freeze(['OK', 'WARN', 'BLOCKED'])
const CODE_RE = /^[A-Z]{2}$/
const FAILED = Object.freeze({ decision: 'BLOCKED', reason: 'CHECK_FAILED', ipCountry: null })
// Yanit yok / bozuk / sigorta: zorunlu iki ihracci kapali. Baska ihraccilarin karari uretilmez (verdictOf null = kullanilamaz).
const failedVerdicts = () => Object.fromEntries(REQUIRED_ISSUERS.map((issuer) => [issuer, { ...FAILED }]))

/**
 * Tek ihracci kararini TAM uc anahtarli nesneye cevirir. ASLA firlatmaz; bozuk karar CHECK_FAILED olur.
 * ipCountry iki harfli buyuk ulke kodu ya da null; baska her sey null'a indirilir.
 */
function verdictOf(v) {
  try {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...FAILED }
    if (!DECISIONS.includes(v.decision) || typeof v.reason !== 'string') return { ...FAILED }
    const ipCountry = typeof v.ipCountry === 'string' && CODE_RE.test(v.ipCountry) ? v.ipCountry : null
    // BLOCKED nedeni kapali kumeye (STOCK_GATE_REASONS) indirilir: ham RULES_INVALID / ISSUER_UNKNOWN / bozuk ad yuzeylere
    // (Home bos durum dali, StockDetail kilit notu) cikmaz, CHECK_FAILED olur (kapali yon). OK / WARN nedeni bilgi amaclidir.
    const reason = v.decision === 'BLOCKED' ? toGateReason(v.reason) : v.reason
    return { decision: v.decision, reason, ipCountry }
  } catch {
    return { ...FAILED }
  }
}

/**
 * STOCK_GATE_STATUS yanitini { [ihracci]: V }'ye cevirir (tablo-gudumlu). ASLA firlatmaz. Zorunlu iki ihracci her zaman
 * vardir (yanitta eksik / bozuksa CHECK_FAILED); yanitin verdigi diger anahtarlar yalniz bicimi gecerli bir ihracci adiysa
 * VE degeri nesneyse ihracci sayilir (`success` / `error` gibi hata govdesi alanlari ihracci degildir).
 */
function verdictsOfReply(reply) {
  try {
    if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return failedVerdicts()
    const issuers = [...REQUIRED_ISSUERS]
    for (const key of Object.keys(reply)) {
      if (isValidIssuer(key) && !issuers.includes(key) && reply[key] !== null && typeof reply[key] === 'object') issuers.push(key)
    }
    return Object.fromEntries(issuers.map((issuer) => [issuer, verdictOf(reply[issuer])]))
  } catch {
    return failedVerdicts()
  }
}

const isCountryUnknown = (v) => v.decision === 'BLOCKED' && v.reason === 'COUNTRY_UNKNOWN'

const defaultSend = (message) => chrome.runtime.sendMessage(message)

/**
 * Varsayilan dinleyici: izlenen depo anahtarlari degisince ve pencere gorunur olunca `trigger()`.
 * `chrome.storage.onChanged` / `document` olmayan ortamlarda (testler, SSR) sessizce bos kalir.
 */
export function defaultSubscribe(trigger) {
  const unsubs = []
  const onChanged = globalThis.chrome?.storage?.onChanged
  if (onChanged && typeof onChanged.addListener === 'function') {
    const onStorage = (changes) => {
      if (changes && typeof changes === 'object' && STOCK_GATE_WATCHED_KEYS.some((k) => Object.hasOwn(changes, k))) trigger()
    }
    onChanged.addListener(onStorage)
    unsubs.push(() => onChanged.removeListener?.(onStorage))
  }
  const doc = globalThis.document
  if (doc && typeof doc.addEventListener === 'function') {
    const onVisible = () => { if (doc.visibilityState === 'visible') trigger() }
    doc.addEventListener('visibilitychange', onVisible)
    unsubs.push(() => doc.removeEventListener?.('visibilitychange', onVisible))
  }
  return () => {
    for (const u of unsubs) {
      try { u() } catch { /* yutulur */ }
    }
  }
}

/**
 * Saf cekirdek (Vue'suz; send / subscribe / zamanlayici / rastgele / saat enjekte).
 * send(message) -> Promise<STOCK_GATE_STATUS yaniti>; subscribe(trigger) -> unsubscribe (tembel: yalniz abone
 * varken dinler). onChange(fn) her anlik goruntu degisiminde cagrilir.
 */
export function createStockEligibilityStore({
  send = defaultSend,
  subscribe = defaultSubscribe,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
  random = Math.random,
  now = Date.now,
} = {}) {
  let snap = { status: 'loading', verdicts: null, fused: false }
  let snapAt = -Infinity
  let count = 0
  let seq = 0
  let inflight = false
  let pending = false
  let chain = Promise.resolve()
  let burst = 0
  let lastSettleAt = -Infinity
  let disposed = false
  let unsubscribe = null
  let fuseTimer = null
  let retryTimer = null
  const listeners = new Set()

  const copyOf = (s) => ({
    status: s.status,
    verdicts: s.verdicts ? Object.fromEntries(Object.entries(s.verdicts).map(([issuer, v]) => [issuer, { ...v }])) : null,
    fused: s.fused,
  })

  const publish = (next) => {
    snap = next
    snapAt = now()
    for (const fn of [...listeners]) {
      try { fn(copyOf(snap)) } catch { /* arayuz geri cagrisi cekirdegi bozmaz */ }
    }
  }

  const clearFuse = () => {
    if (fuseTimer === null) return
    const h = fuseTimer
    fuseTimer = null
    try { clearTimer(h) } catch { /* yutulur */ }
  }
  const clearRetry = () => {
    if (retryTimer === null) return
    const h = retryTimer
    retryTimer = null
    try { clearTimer(h) } catch { /* yutulur */ }
  }

  // Yeniden deneme: bir ihracci COUNTRY_UNKNOWN ya da durum sigortadan geliyorsa TEK zamanlayici; gercek CHECK_FAILED
  // zamanlayici KURMAZ (kalici bir hata her 65 snde sunucuyu yormasin).
  function syncRetry() {
    const verdicts = snap.verdicts
    const need = !disposed && count > 0 && snap.status === 'ready' && verdicts !== null
      && (snap.fused || Object.values(verdicts).some(isCountryUnknown))
    if (!need) {
      clearRetry()
      return
    }
    if (retryTimer !== null) return
    retryTimer = setTimer(() => {
      retryTimer = null
      refresh()
    }, ELIGIBILITY_RETRY_BASE_MS + random() * ELIGIBILITY_RETRY_JITTER_MS)
  }

  function armFuse() {
    clearFuse()
    fuseTimer = setTimer(() => {
      fuseTimer = null
      if (disposed || count === 0 || snap.status !== 'loading') return
      publish({ status: 'ready', verdicts: failedVerdicts(), fused: true })
      syncRetry()
    }, ELIGIBILITY_FUSE_MS)
  }

  const listen = () => {
    if (unsubscribe) return
    try {
      const u = subscribe(trigger)
      unsubscribe = typeof u === 'function' ? u : () => {}
    } catch {
      unsubscribe = () => {}
    }
  }
  const unlisten = () => {
    const u = unsubscribe
    unsubscribe = null
    try { u?.() } catch { /* dinleyici kaldirma hatasi yutulur */ }
  }

  const ask = async () => {
    try {
      return await send({ type: 'STOCK_GATE_STATUS' })
    } catch {
      return null
    }
  }

  function start() {
    const mySeq = seq
    inflight = true
    chain = (async () => {
      try {
        do {
          pending = false
          burst += 1
          const reply = await ask()
          if (disposed || mySeq !== seq) return
          // Ucus sirasinda bir tetik geldiyse bu yanit tetikten ONCE sorulmustu (bayat olabilir): atla, yeniden sor.
          if (pending) continue
          clearFuse()
          publish({ status: 'ready', verdicts: verdictsOfReply(reply), fused: false })
          syncRetry()
        } while (pending)
      } finally {
        if (!disposed && mySeq === seq) {
          inflight = false
          lastSettleAt = now()
        }
      }
    })()
    return chain
  }

  // Dis olay (depo degisti / pencere gorunur oldu). Dongu korumasi icin SINIRLIDIR.
  function trigger() {
    if (disposed || count === 0) return
    if (inflight) {
      if (burst < MAX_REQUESTS_PER_BURST) pending = true
      return
    }
    if (now() - lastSettleAt > SETTLE_MS) burst = 0
    if (burst >= MAX_REQUESTS_PER_BURST) return
    start()
  }

  // Acik istek (yuzey reddi / zamanlayici): salvo siniri uygulanmaz, ekrandaki durum 'loading'e DONMEZ.
  function refresh() {
    if (disposed || count === 0) return Promise.resolve()
    if (inflight) {
      pending = true
      return chain
    }
    burst = 0
    return start()
  }

  // Yeni abonelik donemi: eski donemin ucustaki yaniti bayat sayilir.
  function newEpoch() {
    seq += 1
    inflight = false
    pending = false
    burst = 0
    chain = Promise.resolve()
  }

  function acquire() {
    if (disposed) return Promise.resolve()
    count += 1
    if (count > 1) return chain
    newEpoch()
    listen()
    const fresh = snap.status === 'ready' && now() - snapAt <= ELIGIBILITY_REUSE_MS
    if (!fresh) {
      if (snap.status !== 'loading' || snap.verdicts !== null || snap.fused) publish({ status: 'loading', verdicts: null, fused: false })
      armFuse()
    } else {
      syncRetry()
    }
    return start()
  }

  function release() {
    if (disposed || count === 0) return
    count -= 1
    if (count > 0) return
    newEpoch()
    clearFuse()
    clearRetry()
    unlisten()
  }

  function dispose() {
    if (disposed) return
    disposed = true
    seq += 1
    count = 0
    clearFuse()
    clearRetry()
    unlisten()
    listeners.clear()
  }

  return {
    acquire,
    release,
    refresh,
    dispose,
    snapshot: () => copyOf(snap),
    onChange(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}

let singleton = null

/** Modul duzeyinde tekil, TEMBEL kurulum: modul yuklenirken mesaj / dinleyici yok. */
export function getStockEligibilityStore() {
  if (singleton === null) singleton = createStockEligibilityStore()
  return singleton
}

/** Tekili sifirlar (zamanlayici, dinleyici, sayac, anlik goruntu). Test ve HMR icin; sonraki get yeni ornek kurar. */
export function disposeStockEligibilityStore() {
  if (singleton === null) return
  const s = singleton
  singleton = null
  s.dispose()
}

const available = (v) => Boolean(v) && (v.decision === 'OK' || v.decision === 'WARN')

/**
 * Vue sarmalayici. `enabled`: boolean | getter; false iken hic abone olunmaz. Abonelik `onMounted` icinde yapilir
 * (PE15; SSR testlerinde onMounted -> onServerPrefetch oldugundan ilk sorgu beklenir) ve kapsam kapaninca birakilir.
 */
export function useStockEligibility({ enabled = true } = {}) {
  const store = getStockEligibilityStore()
  const snap = shallowRef(store.snapshot())
  const offChange = store.onChange((s) => { snap.value = s })

  let held = false
  let stopWatch = null
  const hold = () => {
    if (held) return Promise.resolve()
    held = true
    return store.acquire()
  }
  const drop = () => {
    if (!held) return
    held = false
    store.release()
  }

  onMounted(() => {
    let first = Promise.resolve()
    stopWatch = watch(
      () => Boolean(toValue(enabled)),
      (on) => {
        if (on) first = hold()
        else drop()
      },
      { immediate: true },
    )
    return first
  })
  onScopeDispose(() => {
    stopWatch?.()
    stopWatch = null
    drop()
    offChange()
  })

  const ready = computed(() => snap.value.status === 'ready')
  const verdictOf = (issuer) => {
    const s = snap.value
    if (s.status !== 'ready' || !s.verdicts || !isValidIssuer(issuer)) return null
    // isValidIssuer yalniz BICIME bakar ('constructor' gecerli bicimdir): karar yanitin KENDI ozelligi olmali (Object.hasOwn);
    // bicimi gecerli ama yanitta olmayan ihracci icin karar yoktur (null: kullanilamaz)
    return Object.hasOwn(s.verdicts, issuer) ? (s.verdicts[issuer] ?? null) : null
  }
  const isAvailable = (issuer) => available(verdictOf(issuer))
  const warnOf = (issuer) => verdictOf(issuer)?.decision === 'WARN'
  const availableIssuers = computed(() => Object.keys(snap.value.verdicts ?? {}).filter((issuer) => isAvailable(issuer)))
  return {
    ready,
    isAvailable,
    warnOf,
    verdictOf,
    availableIssuers,
    anyAvailable: computed(() => availableIssuers.value.length > 0),
    refresh: () => store.refresh(),
  }
}
