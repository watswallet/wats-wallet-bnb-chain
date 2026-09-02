import { ref, computed } from 'vue'
import { isAtsFeeInsufficient, requiredAtsAmount } from '../utils/atsFee'
import { getAtsConfig } from '../utils/atsConfig'
import { resolveAtsBlocker } from '../utils/atsBlocker'
import { writeFeeHint } from '../utils/atsFuel'

// `chrome.runtime.sendMessage` govdesi BigInt TASIYAMAZ ("Could not serialize message.").
// `call` bu riski dogrudan tasiyor: `buildTransaction` native yolda `value`yi BigInt dondurur.
// Cagiran bugun onu string'e ceviriyor, ama govde SINIRDA yine de normalize edilir —
// cagiranin ne gonderdigine guvenilmez, ve `value` kosulsuz String()'e cevrilir.
//
// NOT: 2026-08-09'daki "Ucret hesaplanamadi" vakasinin sebebi bu DEGILDI; o, YANITTAKI
// BigInt'lerdi (bkz. utils/messageSafe.js). Giden govdenin normalize edilmesi ayri ve
// gecerli bir koruma, ama o hatanin duzeltmesi degil.
function toPlainCall(call) {
  if (!call) return null
  return {
    to: call.to,
    value: call.value == null ? null : String(call.value),
    data: call.data,
  }
}

// ATS zincirinde KULLANICI TRANSFERI icin ucret durumu. Secim yoktur; ATS zorunludur.
// v3: "bu kullanici ne yapabilir" sorusunun yetkili cevabi backend'in /status ucudur; istemci
// bakiye/izin/delegasyondan kendi karar TURETMEZ.
export function useAtsFee() {
  const atsFee = ref(null)
  const atsBalance = ref(0)
  const atsSymbol = ref('ATS')
  const atsTokenAddress = ref(null)
  const isCrosschain = ref(false)
  const mode = ref(null)
  const ready = ref(false)
  const decision = ref(null)     // resolveAtsBlocker ciktisi | null
  const nextSteps = ref([])
  // Bu gonderim kac op? Bootstrap modunda IKI (approve + transfer) ve her biri AYRI AYRI
  // fiyatlanip tahsil edilir. Varsayilan 1 (tek op).
  const opCount = ref(1)
  // /quote ucreti BSC'deki toplayici iznini asiyor: /sponsor bunu src-allowance-low ile
  // reddedecek. Onceden yakalanmazsa kullanici yesil bir onay ekrani gorur, gonder'e basar
  // ve op ucus sirasinda kodsuz bir 400 ile olur (spec §4.8).
  const needsTopUp = ref(false)
  const onboarding = ref(false)
  const loading = ref(false)
  const error = ref(null)
  const ctx = ref({ sentAssetAddress: null, sendAmount: 0 })

  const ops = () => Math.max(1, Number(opCount.value) || 1)

  const feeArgs = () => ({
    transferFee: atsFee.value,
    // atsFee PER-OP ucrettir. Bootstrap modunda ikinci bir op daha gider ve ayni fiyattan
    // ayri ayri tahsil edilir; ek op'lari bootstrapFee olarak gecmek mevcut atsFee.js
    // matematigini AYNEN kullanir (paralel bir hesap yolu acmaz).
    bootstrapFee: atsFee.value == null ? 0 : (ops() - 1) * Number(atsFee.value),
    sentAssetAddress: ctx.value.sentAssetAddress,
    atsAddress: atsTokenAddress.value,
    sendAmount: ctx.value.sendAmount,
  })

  // Ekranda gosterilecek TOPLAM ucret (per-op x op sayisi). Tek op'ta per-op ile aynidir.
  const feeTotal = computed(() => (atsFee.value == null ? null : Number(atsFee.value) * ops()))

  const requiredAts = computed(() => requiredAtsAmount(feeArgs()))
  const insufficient = computed(() => isAtsFeeInsufficient({ atsBalance: atsBalance.value, ...feeArgs() }))
  // Bloklama uc sebepten: (1) backend HAZIR DEGIL diyor, (2) bakiye yetmiyor, (3) ucret BSC'deki
  // izni asiyor (butce tazeleme gerekli). `ready` backend'in tek yetkili boolean'i; kendi
  // kopyamizi cikarmiyoruz — ama (3) backend'in taban ucretle verdigi ready:true'nun BU op icin
  // gecerli olmadigi tek durumdur (belge 05: /status minChargeAts ile sorar).
  const blocked = computed(() =>
    loading.value || onboarding.value || !ready.value || insufficient.value || needsTopUp.value)

  function resetQuote() {
    atsFee.value = null
    atsBalance.value = 0
    isCrosschain.value = false
    mode.value = null
    ready.value = false
    decision.value = null
    nextSteps.value = []
    opCount.value = 1
    needsTopUp.value = false
  }

  function beginQuote() { loading.value = true; error.value = null }
  function failQuote(message) { resetQuote(); error.value = message || 'quote failed'; loading.value = false }

  async function loadAtsFee({ chainId, address, call, sentAssetAddress, sendAmount }) {
    ctx.value = { sentAssetAddress: sentAssetAddress || null, sendAmount }
    loading.value = true
    error.value = null

    const cfg = getAtsConfig(chainId)
    if (!cfg) { resetQuote(); loading.value = false; return }
    atsSymbol.value = cfg.token.symbol
    atsTokenAddress.value = cfg.token.address

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'ATS_FEE_QUOTE', message: { chainId, address, call: toPlainCall(call) },
      })
      if (resp && resp.success) {
        ready.value = !!resp.ready
        mode.value = resp.mode || null
        isCrosschain.value = !!resp.isCrosschain
        nextSteps.value = resp.nextSteps || []
        opCount.value = Number(resp.opCount) || 1
        needsTopUp.value = !!resp.needsTopUp
        // Kart SIRASI = aciliyet sirasi. Backend'in kendi engeli her zaman kazanir; yoksa
        // kendi onden yakaladigimiz butce karti devreye girer; o da yoksa ve backend
        // sebepsiz "hazir degil" diyorsa kullaniciyi KARTSIZ bloklu birakmamak icin
        // gecici bir karara duseriz.
        //
        // Butce kartinin BASLIGI adim sayisina bakar: iki adim, backend'in "hic kurulmamis"
        // demesidir (paymaster + toplayici izni birden gerekiyor) ve izin 0 oldugu icin
        // needsTopUp aritmetigi de ayni anda tetiklenir — baslik "butce yetmiyor" degil
        // "tek seferlik kurulum gerekli" olmali. Aciklama metni zaten ayni sinyali okuyor
        // (ConfirmTransaction.vue, nextSteps.length); baslik farkli sinyalden turetilince
        // kart kendi icinde celisiyordu (2026-08-12 canli, Celo). Backend'in kendi
        // src-allowance-missing engeline guvenemiyoruz: srcAllowance "0" iken bile
        // ready:true donuyor (bilinen hata, 2026-08-10 raporu).
        decision.value = resp.decision
          || (needsTopUp.value
            ? resolveAtsBlocker(nextSteps.value.length > 1 ? 'src-allowance-missing' : 'src-allowance-low')
            : null)
          || (ready.value ? null : resolveAtsBlocker(null, { httpStatus: 400 }))
        atsFee.value = resp.transferFee
        atsBalance.value = resp.atsBalance
        atsSymbol.value = resp.symbol || cfg.token.symbol
        // Header'daki yakit pill'i "N islem" tahminini bu ipucundan uretir. `writeFeeHint`
        // kendi hatasini yutar (asla reject etmez), yani await burada quote'u riske ATMAZ.
        await writeFeeHint(chainId, resp.transferFee)
      } else {
        resetQuote()
        // Kod METINDEN once: backend mesajlari Turkcedir ve degisebilir.
        // httpStatus arka plandan gelir; yoksa 400'e duseriz (kodsuz + durumsuz = genel istemci
        // hatasi). Sabit 400 yazmak 5xx'i de 4xx sayardi -> gecici bir gateway hatasinda
        // kullaniciya "sunucu hatasi, biraz sonra dene" yerine jenerik bir kart cikardi.
        decision.value = resolveAtsBlocker(resp && resp.code, { httpStatus: (resp && resp.httpStatus) || 400 })
        error.value = (resp && resp.error) || 'quote failed'
      }
    } catch (e) {
      // Bu dal `chrome.runtime.sendMessage`'in KENDISI reddettiginde calisir (arka plan
      // yaniti hic donmedi: worker kapandi, mesaj serilestirilemedi vb.). Sessiz birakmak
      // teshisi imkansiz kiliyordu: ekranda jenerik "Ucret hesaplanamadi" karti cikiyor,
      // konsolda HICBIR iz olmuyordu -- runAtsQuote'un catch'i loglar ama buraya hic ugramaz.
      console.error('[ats] ATS_FEE_QUOTE mesaji basarisiz:', e)
      resetQuote()
      error.value = e?.message || 'quote failed'
    } finally {
      loading.value = false
    }
  }

  // nextSteps'i backend'in verdigi sirayla kosar (adimlar BSC'de, sifir BNB ile) ve bitince
  // teklifi tazeler. Tazeleme SART: /status'un cevabi degismedikce ekran bloklu kalir — ama
  // tazeleme (loadAtsFee) ilk isi olarak error/decision'i sifirlar, yani basarisizlik dalinda
  // kullaniciya gosterilmesi gereken OZGUL metni (bootstrap kota hatalari kodsuz 400 gelir:
  // "imza zaten acik" ~5 dk, "gunluk kota doldu" ertesi gun, "deneme hakki doldu" destek)
  // eziyordu. Basarisizligi ONCE kaydedip tazelemeden SONRA geri koyuyoruz.
  async function runOnboarding(args) {
    onboarding.value = true
    error.value = null
    let failure = null
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'ATS_RUN_ONBOARDING', message: { chainId: args.chainId, address: args.address },
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
      failure = { message: e?.message || 'onboarding failed' }
      return false
    } finally {
      onboarding.value = false
      // Durum ZORUNLU tazelenir: iki adimli onboarding'de 1. adim zincire yazilip 2. adim
      // dusmus olabilir; bayat bir /status cevabi kullaniciyi yaniltir.
      await loadAtsFee(args)
      // ...ama tazeleme, kullaniciya gosterilmesi gereken OZGUL hatayi silmemeli.
      if (failure) {
        error.value = failure.message
        const d = resolveAtsBlocker(failure.code, { httpStatus: failure.httpStatus || 400 })
        // Tazeleme daha ACIL bir engel bulduysa (ag durdurulmus, yabanci delegasyon) o kazanir.
        const refreshed = decision.value
        const urgent = refreshed && (refreshed.severity === 'operator' || refreshed.severity === 'blocked')
        if (!urgent) decision.value = d
      }
    }
  }

  return {
    atsFee, atsBalance, atsSymbol, isCrosschain, mode, ready, decision, nextSteps,
    opCount, needsTopUp, feeTotal,
    requiredAts, loading, onboarding, error, insufficient, blocked,
    beginQuote, failQuote, loadAtsFee, runOnboarding,
  }
}
