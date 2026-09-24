// TON gasless ucret ONIZLEMESI + iliskili engel karari - Send/Swap ekranlarinin
// ATS kartiyla AYNI kalipta tukettigi composable (Task 8, spec bolum 8).
//
// BU DOSYA IMZALAMAZ, GONDERMEZ. Yalniz T4'un zaten var olan /status + /quote
// okuyucularini (tonFeeStatus.js, tonFeeClient.js) ONIZLEME icin cagirir ve
// T3'un resolveTonFeeBlocker'ini (tonFeeBlocker.js) kullanarak hata/engel
// kararini uretir. Gercek imza+gonderim (executeTonViaRelayer, T6) gorev 10'da
// background.js'e baglandi ama bu composable ona HALA DOKUNMAZ: onizleme kilitli
// kasada bile calisabilmeli, imza ise gercek bir kasa acilmasini gerektirir.
// Cagiran ekran gonderim aninda yalnizca "relay modu" bayragini ve kullanicinin
// GORDUGU tutari (approvedAtsFee) arka plana yollar.
//
// tonPublicKey OPSIYONELDIR: kasadan cikarilmasi (tonIdentityForAccount) sifreli
// sirri acmayi gerektiren AYRI bir islem ve bu composable'in (SAF/UI katmani)
// isi degil. ConfirmTransaction.vue onu arka plandan TEK bir mesajla
// (TON_FEE_IDENTITY) alir - yalnizca ACIK anahtar doner. Cagiran taraf onu
// veremiyorsa `load()` yalniz bolge/durum kontrolunu (readTonFeeStatus) yapar: tutar henuz gosterilemez ama
// `relayActive` (uyari/TON_FEE_RESERVE gizleme kararlarinin TEK dayanagi) yine
// de dogru hesaplanir - bkz. tonFeeUiWiring.test.js.
//
// ROUND 1 REVIEW BULGU 1: cagiran taraf `atsMaxFee` HENUZ null iken ucret
// kartinin KENDISINI cizmemeli - fiyatsiz, "bu ucret iade edilmez" yazan bir
// kart alarmdan baska bir sey katmaz. ConfirmTransaction.vue/Swap.vue kart
// gorunurlugunu `... && tonFee.atsMaxFee.value != null` ile kapiyor.
//
// ROUND 1 REVIEW BULGU 4: `relayActive` ve `statusUnreadable` AYRI degiskenler.
// Biri "sunucu ODEMEYI KAPATTI" (odeme modunu kapatir), digeri "durumu
// OKUYAMADIK" (odeme modunu DEGISTIRMEZ, yalniz decision'in gorunmesini
// saglar). Ikisini AYNI degiskene sikistirmak bir /status kesintisini ya hic
// gostermiyordu (Swap, `payWithTonFee`ye bagli kapi) ya da calisan bir
// self-pay gonderiminin yanina yanlislikla engel karti boyuyordu (Send,
// `isTonNetwork`e bagli kapi).
import { ref, computed } from 'vue'
import { readTonFeeStatus, tonFeeRelayActive } from '../utils/ton/tonFeeStatus'
import { tonFeeQuote } from '../utils/ton/tonFeeClient'
import { resolveTonFeeBlocker } from '../utils/ton/tonFeeBlocker'
// Onboarding BSC'de kosar ve BSC/ATS kodlari dondurur (onboarding-steps-missing,
// src-*): karari resolveTonFeeBlocker DEGIL resolveAtsBlocker verir. Ilki
// TON-disi kodlari "bilinmeyen" sayip jenerik bir "tekrar dene" karti cizerdi -
// oysa bu kodlarin atsBlocker'da KENDI metni var (useAtsFee ile ayni secim).
import { resolveAtsBlocker } from '../utils/atsBlocker'
import { atsWeiToHuman } from '../utils/ton/tonFeeAmounts'
import { ATS_SRC_CHAIN_ID } from '../utils/atsConfig'

// Teklif TTL'i sunucu tarafinda kisa (deadline auth'un bir parcasi, bkz.
// tonQuoteVerify.js V11). 60sn onay ekraninda gecirilen sureden kisa, gereksiz
// sik sorgudan da kacinacak kadar uzun - atsPaymaster.js/tonFeeStatus.js'teki
// AYNI 30sn TTL'in bir usttekiyle karistirilmasin diye burada AYRI sabit.
export const TON_FEE_SILENT_REFRESH_MS = 60_000

/**
 * @returns composable state + `load`/`stop`/`runOnboarding`.
 */
export function useTonFee() {
  // IKI ALAN, TEK KAYNAK. Ham deger TUTULUR, insan-okunur olan ondan TURER.
  //
  // CANLI KUSUR (2026-09-17): eskiden yalniz insan-okunur alan vardi ve Swap.vue
  // onu dogrulamanin (tonQuoteVerify V10) UST SINIRI olarak gonderiyordu. V10 ham
  // wei bekler; asBigInt ondalik noktayi reddeder ve her TON takasi
  // TON_QUOTE_FEE_ABOVE_APPROVED ile duserdi -- imza hic atilmadan.
  // ConfirmTransaction ve TonSendTx bu ref'i BILEREK atlayip
  // `quote.value.sign.feeAuth.atsMaxFee`e uzaniyordu; yani ham degere ulasmanin
  // kolay bir yolu yoktu ve ucuncu cagiran eldeki kolay olani secti. Alan artik
  // burada.
  //
  // `computed` BILEREK: ikisi ayri ref olsaydi bes ayri atama noktasindan birinin
  // unutulmasi, EKRANDA bir tutar GORUNURKEN protokole BAYAT bir ust sinir
  // gitmesi demekti - duzeltmekte oldugumuz kusurun tam ikizi.
  const atsMaxFeeRaw = ref(null)   // HAM WEI dizesi (feeAuth.atsMaxFee) - protokol icin
  const atsMaxFee = computed(() => (atsMaxFeeRaw.value != null ? atsWeiToHuman(atsMaxFeeRaw.value) : null))
  // Sunucunun SON basarili /status yanitinin soyledigi (ON/OFF). Round 1 review
  // bulgu 4: ONCEDEN bir status-asamasi HATASINDA da false'a dusuruluyordu -
  // "sunucu kapali dedi" ile "durumu okuyamadik" AYNI degiskene sikistirilmisti.
  // ARTIK yalniz basarili bir okumadan gelir; hata ONU DEGISTIRMEZ (asagida).
  const relayActive = ref(false)
  // Son /status DENEMESI basarisiz mi oldu (ag/HTTP hatasi)? `relayActive`'DEN
  // BAGIMSIZ: odeme modunu (payWithTonFee) ETKILEMEZ, yalniz decision'in
  // gorunmesini saglar - bkz. ConfirmTransaction.vue/Swap.vue tonFeeDecisionActive.
  const statusUnreadable = ref(false)
  const ready = ref(false)         // relayActive VE tutar cozuldu
  const decision = ref(null)       // resolveTonFeeBlocker ciktisi | null
  const quote = ref(null)          // ham /quote govdesi - yalniz "Detaylar" paneli icin
  // /status'un `budget` blogu (minChargeAts, commissionAts, ...) OLDUGU GIBI.
  // Ekranin "daha ne kadar ATS gerekli" karti bunun UZERINE kurulur (atsShortfall.js)
  // ve tam da TEKLIF DUSTUGUNDE gerekir: bakiye yetmeyince `atsMaxFee` hic gelmez,
  // geriye tek sayi kaynagi budget kalir. Bu yuzden `quote` gibi hata yolunda
  // SIFIRLANMAZ - yalniz basarili bir /status okumasindan yazilir.
  const budget = ref(null)
  const loading = ref(false)
  const onboarding = ref(false)
  const error = ref(null)

  // useAtsOpFee.js'teki AYNI desen: art arda cagrilarda GEC donen eski yanit
  // yeniyi EZMEZ.
  let requestId = 0
  let refreshTimer = null
  let lastArgs = null

  function stop() {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = null
  }

  function scheduleRefresh(args) {
    stop()
    // Sessiz: bir sonraki tur `loading`i TETIKLEMEZ (asagida load() icinde
    // silent:true ile cagrilir) - kullanici onay ekraninda otururken kart her
    // 60sn'de bir iskelete DONMEMELI.
    refreshTimer = setTimeout(() => { load({ ...args, silent: true }) }, TON_FEE_SILENT_REFRESH_MS)
  }

  /**
   * @param {object} args
   * @param {string} args.sender  EVM adresi - /status sorgusu ve /quote'un `payer`i.
   * @param {string} [args.tonWallet]  W5 adresi (kanonik). YOKSA yalniz bolge kontrolu yapilir.
   * @param {string} [args.tonPublicKey]  YOKSA teklif ISTENMEZ (dosya basi notu).
   * @param {Array}  [args.actions]  YOKSA teklif ISTENMEZ.
   * @param {boolean} [args.silent]  true ise `loading` degismez (arka plan tazelemesi).
   */
  async function load(args = {}) {
    const { sender, tonWallet, tonPublicKey, actions, silent = false } = args
    lastArgs = args
    const id = ++requestId
    if (!silent) { loading.value = true; error.value = null }

    try {
      if (!sender) {
        if (id === requestId) {
          atsMaxFeeRaw.value = null
          relayActive.value = false
          statusUnreadable.value = false
          ready.value = false
          decision.value = null
          quote.value = null
          budget.value = null
        }
        return
      }

      const status = await readTonFeeStatus({ sender })
      const active = tonFeeRelayActive(status)
      // BOLGE KARARI ERKEN YAZILIR (yarisla YARISMAZ - uyari/TON_FEE_RESERVE
      // gizleme kararlarinin tek dayanagi budur, bkz. dosya basi notu). Yaris
      // korumasi yalniz asagidaki TEKLIFTE (useAtsOpFee.js ile AYNI tek
      // kontrol noktasi deseni): iki ardisik `await`in HER ikisinden sonra
      // erken donmek, ESKI cagrinin `tonFeeQuote`u hic cagirmadan cikmasina
      // ve testin manuel cozdugu askidaki sozun asla tuketilmemesine yol
      // aciyordu (RED - ilk deneme).
      if (id === requestId) {
        relayActive.value = active
        statusUnreadable.value = false
        decision.value = null
        // Yanit budget TASIMIYORSA null: onceki hesabin/okumanin sayisi ekranda
        // yapisip kullaniciya yanlis bir "eksik ATS" gostermemeli.
        budget.value = (status && status.budget) || null
      }

      if (!active) {
        if (id === requestId) { atsMaxFeeRaw.value = null; ready.value = false; quote.value = null }
        return
      }

      // Bolge acik ama teklif icin gereken alanlar HENUZ yok (dosya basi notu):
      // bu bir HATA degil, tutarin henuz gosterilemedigi anlamina gelir.
      if (!tonWallet || !tonPublicKey || !actions) {
        if (id === requestId) { atsMaxFeeRaw.value = null; ready.value = false; quote.value = null }
        return
      }

      const q = await tonFeeQuote({ tonWallet, tonPublicKey, payer: sender, actions })
      if (id !== requestId) return

      // KURAL 1 (spec 8): ekrana giden alan DOGRUDAN imzalanacak alan -
      // feeAuth.atsMaxFee, tonFeeRelayer.js'in adim 7-8'de imzaladigi AYNI
      // govde. Burada AYRI bir hesap YAPILMAZ - "gosterilen = imzalanan" kod
      // duzeyinde boyle garanti edilir.
      quote.value = q
      const rawMaxFee = q?.sign?.feeAuth?.atsMaxFee
      atsMaxFeeRaw.value = rawMaxFee != null ? String(rawMaxFee) : null
      ready.value = atsMaxFeeRaw.value != null
    } catch (e) {
      if (id !== requestId) return
      atsMaxFeeRaw.value = null
      ready.value = false
      quote.value = null
      // ROUND 1 REVIEW BULGU 4 - kok neden: `relayActive` "sunucu ODEMEYI
      // KAPATTI" ile "durumu OKUYAMADIK" durumlarini AYNI degiskene
      // sikistiriyordu. Ikisi FARKLI: yalniz birincisi odeme modunu (asagida
      // `payWithTonFee`) kapatmali. Bir status-asamasi HATASINDA `relayActive`
      // ARTIK DOKUNULMAZ (onceki basarili okumadan gelen degerini KORUR - hic
      // basarili okuma olmadiysa varsayilan `false` zaten guvenli tarafta).
      // Bunun yerine AYRI bir sinyal (`statusUnreadable`) isaretlenir: bu,
      // odeme modunu DEGISTIRMEDEN decision'in gorunmesini saglar (bkz.
      // ConfirmTransaction.vue/Swap.vue `tonFeeDecisionActive`) - onceki
      // davranista bir /status kesintisi decision'i URETIYOR ama `relayActive`
      // false'a dustugu icin TON kolunda hicbir kart onu GOSTERMIYORDU (Swap)
      // ya da calisan bir self-pay gonderiminin YANINA yanlislikla bir engel
      // karti BOYUYORDU (Send, `isTonNetwork` ile kapiliydi).
      if (e?.phase === 'status' || !e?.phase) statusUnreadable.value = true
      decision.value = resolveTonFeeBlocker(e?.code ?? null, { httpStatus: e?.httpStatus, phase: e?.phase })
      error.value = e?.message || null
    } finally {
      if (id === requestId) {
        if (!silent) loading.value = false
        scheduleRefresh(args)
      }
    }
  }

  /**
   * ATS onboarding HER ZAMAN BSC'de (ATS_SRC_CHAIN_ID) calisir, TON'un kendi
   * chainId'si (-239) DEGIL: tonFeeBlocker.js balance-missing/src-* kodlarini
   * resolveAtsBlocker'a delege ediyor ve o kodlar HEP BSC tarafindandir
   * (kullanicinin BSC'deki ATS hesabi, TON islemi icin de AYNI hesap).
   */
  async function runOnboarding({ address, index } = {}) {
    onboarding.value = true
    // BASARISIZLIK TAZELEMEDEN SONRA GERI KONUR (useAtsFee.runOnboarding ile ayni
    // desen). Onceden yanit `!!resp.success`e indirgeniyor, `code`/`error`
    // ATILIYORDU; hemen ardindan gelen load() da error/decision'i sifirliyordu.
    // Sonuc canlida olculdu (2026-08-31): backend teklifi src-allowance-missing
    // ile reddederken /status `ready:true` + `nextSteps:[]` donuyor, arka plan
    // "onboarding-steps-missing" diyor ve kullanici bunu HIC gormeden ayni
    // "kurulum gerekli" kartina donuyordu - sonsuz, sessiz dongu.
    let failure = null
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'ATS_RUN_ONBOARDING', message: { chainId: ATS_SRC_CHAIN_ID, address, index },
      })
      if (!resp || !resp.success) {
        failure = {
          message: (resp && resp.error) || 'onboarding failed',
          code: resp && resp.code,
          httpStatus: resp && resp.httpStatus,
        }
        return false
      }
      return true
    } catch (e) {
      // sendMessage'in KENDISI reddetti (worker kapandi, mesaj serilestirilemedi):
      // firlatmak butonu sessizce oldururdu, cagiran (ConfirmTransaction.vue)
      // donus degerine de bakmiyor.
      failure = { message: e?.message || 'onboarding failed' }
      return false
    } finally {
      onboarding.value = false
      // Durum ZORUNLU tazelenir: iki adimli onboarding'de bir adim dusmus
      // olabilir, bayat bir onceki karar kullaniciyi yaniltir.
      if (lastArgs) await load(lastArgs)
      if (failure) {
        error.value = failure.message
        const d = resolveAtsBlocker(failure.code, { httpStatus: failure.httpStatus || 400 })
        // Tazeleme DAHA ACIL bir engel bulduysa (ag durduruldu, relayer tanki
        // bitti) o kazanir: kurulumun neden baslamadigini anlatmak, gonderimin
        // zaten mumkun olmadigi bilgisinin onune gecmemeli.
        const refreshed = decision.value
        const urgent = refreshed && (refreshed.severity === 'operator' || refreshed.severity === 'blocked')
        if (!urgent) decision.value = d
      }
    }
  }

  return {
    atsMaxFee, atsMaxFeeRaw, relayActive, statusUnreadable, ready, decision, quote, budget, loading, onboarding, error,
    load, stop, runOnboarding,
  }
}
