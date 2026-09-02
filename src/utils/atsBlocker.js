// Backend'in `blocker` (GET /paymaster/status) ve `code` (400 govdesi) alanlarini UI kararina
// cevirir. SAF: I/O yok, i18n yok — yalniz eslesme. Metin degil KOD baz alinir; backend
// mesajlari Turkcedir ve degisebilir.
//
// Sira normatiftir (belge 06): birden cok engel ayni anda gecerli olabilir ama backend TEK
// `blocker` doner. Bu modul o tek kodu yorumlar; sira karari backend'de.

const OPERATOR = 'operator'   // ag saglıksiz — kullanicinin yapabilecegi bir sey yok
const BLOCKED = 'blocked'     // kimsenin cozemeyecegi durum
const USER = 'user'           // eylem kullanicida
const INTERNAL = 'internal'   // istemci hatasi; kullaniciya gosterilmez, kod duzeltir
const TRANSIENT = 'transient' // gecici; suclama yok

const K = (name) => `send.confirmTransaction.${name}`

const TABLE = {
  // --- operator ---
  'paymaster-paused':      { severity: OPERATOR, action: 'suggest-other-chain', i18nKey: K('atsChainPaused') },
  // Tazelemek COZMEZ: /status taban ucretle sordugu icin yine ready:true der.
  'remote-not-ready':      { severity: OPERATOR, action: 'suggest-other-chain', i18nKey: K('atsRemoteNotReady') },
  'rate-stale':            { severity: OPERATOR, action: 'retry-later',         i18nKey: K('atsRateStale') },

  // --- kimse ---
  // Yeni bir authorization gondermek bunu COZMEZ; sunucu yabanci kodu gordugunde imzali
  // yetkiyi hic incelemeden reddeder. Delegasyon ZINCIR BASINADIR — kullaniciyi tum aglardan
  // kilitleme, yalnizca bu agda engelle.
  'foreign-delegation':    { severity: BLOCKED,  action: 'explain-foreign',     i18nKey: K('atsForeignDelegation') },

  // --- kullanici ---
  'src-balance-missing':   { severity: USER,     action: 'buy-ats',             i18nKey: K('atsSrcBalanceMissing') },
  'balance-missing':       { severity: USER,     action: 'buy-ats',             i18nKey: K('atsBalanceMissing') },
  'src-allowance-missing': { severity: USER,     action: 'run-onboarding',      i18nKey: K('atsOnboardingNeeded') },
  'src-allowance-low':     { severity: USER,     action: 'run-onboarding',      i18nKey: K('atsBudgetLow') },

  // NATIVE KOPRU ARTIK ENGELLI DEGIL (bkz. bridge.js buildBridgeCalls). `msg.value`
  // kullanicinin kendi bakiyesinden cikar; paymaster yalnizca gazi oder. Geriye tek
  // gercek kosul kaldi: hesap o degeri tasiyor mu. Tasimiyorsa op zincirde duser ve
  // BSC'de bir bootstrap hakki yanar, bu yuzden imzadan ONCE ve GORUNUR sekilde durur.
  'insufficient-native-for-value': {
    severity: USER, action: 'reduce-amount',
    i18nKey: K('atsNativeValueTitle'), i18nDescKey: K('atsNativeValueDesc'),
  },

  // Li.Fi'nin verdigi deger cozulemedi. 0 varsaymak op'u zincirde oldururdu; gonderilmez.
  // Kullanicinin yapabilecegi bir sey yok, tekrar denemek makul -> TRANSIENT degil
  // OPERATOR degil: gecici kabul edilir, cunku taze bir teklif farkli bir rota getirebilir.
  'route-value-unreadable': {
    severity: TRANSIENT, action: 'retry-later', i18nKey: K('atsRouteUnreadable'),
  },

  // Kurulum gerekiyor ama /status hangi adimlarin kosacagini SOYLEMEDI (nextSteps bos).
  // Kullanicinin yapabilecegi bir sey yok -> OPERATOR. Buton yine de duruyor (retry-later):
  // adimlar sunucu tarafinda duzeltilince bir tazeleme yeter, yeniden kurulum gerekmez.
  'onboarding-steps-missing': {
    severity: OPERATOR, action: 'retry-later',
    i18nKey: K('atsOnboardingUnavailable'), i18nDescKey: K('atsOnboardingUnavailableDesc'),
  },

  // --- ic (kullaniciya gosterilmez) ---
  'quote-lock-required':   { severity: INTERNAL, action: 'retry-with-lock',     i18nKey: K('atsTemporary') },
  'postop-gas-required':   { severity: INTERNAL, action: 'rebuild-gas',         i18nKey: K('atsTemporary') },
  'settlement-mismatch':   { severity: INTERNAL, action: 'rebuild-identical',   i18nKey: K('atsTemporary') },
  'settlement-unpaid':     { severity: INTERNAL, action: 'fresh-quote',         i18nKey: K('atsTemporary') },
}

/**
 * @param {string|null|undefined} code  /status'un `blocker`i ya da GaslessError.code
 * @param {{httpStatus?: number}} [opts]
 * @returns {{severity: string, action: string, i18nKey: string, i18nDescKey?: string}|null}
 *          engel yoksa null. `i18nDescKey` OPSIYONELDIR: kartin baslik altindaki aciklamasi
 *          eylemden turetilemedigi durumlar icin (bkz. onboarding-steps-missing).
 */
export function resolveAtsBlocker(code, opts = {}) {
  if (code && TABLE[code]) return TABLE[code]
  if (code) {
    // Bilinmeyen kod: backend yeni bir kod eklemis olabilir. "Engel yok" saymak sessiz bir
    // bypass olurdu; gecici sayip mesaji oldugu gibi gostermek dogru taraf.
    return { severity: TRANSIENT, action: 'refresh-status', i18nKey: K('atsTemporary') }
  }
  const s = opts.httpStatus
  if (s != null && s >= 500) return { severity: TRANSIENT, action: 'retry-later', i18nKey: K('atsServerError') }
  if (s != null && s >= 400) return { severity: TRANSIENT, action: 'refresh-status', i18nKey: K('atsTemporary') }
  return null
}
