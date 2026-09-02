import { describe, it, expect, beforeEach, vi } from 'vitest'

// Testler kendi donus degerini secebilsin diye mock, degistirilebilir bir degiskene bakar.
// beforeEach her testten once bunu varsayilana dondurur (bkz. altta) — sira bagimliligi olmasin.
const VALID_CFG = {
  paymaster: '0x1111111111111111111111111111111111111111',
  delegate: '0x2222222222222222222222222222222222222222',
  entryPoint: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
  token: { address: '0xAAA0000000000000000000000000000000000000', symbol: 'ATS', decimals: 18 },
}
let atsConfigReturn = VALID_CFG
vi.mock('../utils/atsConfig', () => ({ getAtsConfig: () => atsConfigReturn }))

import { useAtsFee } from './useAtsFee'

const ATS = '0xAAA0000000000000000000000000000000000000'
const ADDR = '0x' + '1'.repeat(40)
const CALL = { to: '0x' + '9'.repeat(40), value: '0', data: '0x' }
const ARGS = { chainId: 421614, address: '0x0', call: { to: '0x0', data: '0x' } }
// v3: basarili /status yaniti `ready` iceriyor; bloklama artik buna dayanir.
const OK = { success: true, ready: true, mode: 'direct', transferFee: 1.25, atsBalance: 10, symbol: 'ATS', nextSteps: [] }

let storageStore
beforeEach(() => {
  storageStore = {}
  globalThis.chrome = {
    runtime: { sendMessage: vi.fn() },
    storage: {
      local: {
        get: vi.fn(async (key) => (key in storageStore ? { [key]: storageStore[key] } : {})),
        set: vi.fn(async (obj) => { Object.assign(storageStore, obj) }),
      },
    },
  }
  atsConfigReturn = VALID_CFG
})

// v2'deki delegasyon-merkezli senaryolar ("delege degil ama bloklamaz", "bootstrap ucreti
// toplama dahil edilir") v3'te karsiliksiz kaldi: bloklama artik istemcinin turettigi
// delegasyon/bootstrap durumuna degil, backend'in tek yetkili `ready` alanina dayaniyor
// (bkz. asagidaki 'v3 alanlari' describe'u). O testler bu yuzden kaldirildi; kalanlar
// hala gecerli olan cekirdek davranisi (fail-closed, gerekli miktar hesabi) dogruluyor.
describe('useAtsFee — cekirdek akis', () => {
  it('basarili quote ucret + bakiyeyi doldurur, ready + yeterliyse bloklamaz', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK)
    const a = useAtsFee()
    await a.loadAtsFee(ARGS)
    expect(a.atsFee.value).toBe(1.25)
    expect(a.ready.value).toBe(true)
    expect(a.blocked.value).toBe(false)
  })

  it('ATS gonderiliyorsa tutar da gerekliye eklenir', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ ...OK, atsBalance: 10 })
    const a = useAtsFee()
    await a.loadAtsFee({ ...ARGS, sentAssetAddress: ATS, sendAmount: '9' })
    expect(a.requiredAts.value).toBeCloseTo(10.25)
    expect(a.insufficient.value).toBe(true)
  })

  it('quote basarisizsa hata set eder ve BLOKLAR', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: false, error: 'stale rate' })
    const a = useAtsFee()
    await a.loadAtsFee(ARGS)
    expect(a.error.value).toBe('stale rate')
    expect(a.blocked.value).toBe(true)
  })

  it('yapilandirilmamis zincirde bayat quote ile bloklamayi kacirmaz', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK)
    const a = useAtsFee()
    await a.loadAtsFee(ARGS)
    expect(a.blocked.value).toBe(false)
    atsConfigReturn = null
    await a.loadAtsFee(ARGS)
    expect(a.atsFee.value).toBe(null)
    expect(a.loading.value).toBe(false)
    expect(a.blocked.value).toBe(true)
  })

  it('beginQuote loading acar ve onceki hatayi temizler', () => {
    const a = useAtsFee()
    a.failQuote('eski hata')
    a.beginQuote()
    expect(a.loading.value).toBe(true)
    expect(a.error.value).toBe(null)
  })

  it('failQuote basarili quote sonrasi cagrilirsa state\'i sifirlar ve fail-closed birakir', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK)
    const a = useAtsFee()
    await a.loadAtsFee(ARGS)
    expect(a.blocked.value).toBe(false) // basarili quote sonrasi bloklu degildi

    a.failQuote('buildTransaction patladi')
    expect(a.error.value).toBe('buildTransaction patladi')
    expect(a.loading.value).toBe(false)
    expect(a.atsFee.value).toBe(null) // eski basarili quote'tan kalan ucret bayat kalmadi
    expect(a.atsBalance.value).toBe(0)
    expect(a.blocked.value).toBe(true) // bayat ucretle yanlislikla bloksuz kalmadi
  })

  it('sendMessage throw/reject etmesi state\'i sifirlar ve fail-closed birakir', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK)
    const a = useAtsFee()
    await a.loadAtsFee(ARGS)
    expect(a.blocked.value).toBe(false) // basarili quote sonrasi bloklu degildi

    chrome.runtime.sendMessage.mockRejectedValue(new Error('network error'))
    await a.loadAtsFee(ARGS)
    expect(a.error.value).toBe('network error')
    expect(a.loading.value).toBe(false)
    expect(a.atsFee.value).toBe(null) // eski basarili quote'tan kalan ucret bayat kalmadi
    expect(a.blocked.value).toBe(true) // bayat ucretle yanlislikla bloksuz kalmadi
  })

  it('failQuote() parametre olmadan cagrilirsa varsayilan hata mesajini kullanir', () => {
    const a = useAtsFee()
    a.failQuote()
    expect(a.error.value).toBe('quote failed')
  })
})

describe('useAtsFee — v3 alanlari', () => {
  it('yanittaki mode/decision/nextSteps alanlarini yansitir', async () => {
    globalThis.chrome = { runtime: { sendMessage: async () => ({
      success: true, ready: false, mode: undefined, blocker: 'src-allowance-missing',
      decision: { severity: 'user', action: 'run-onboarding', i18nKey: 'send.confirmTransaction.atsOnboardingNeeded' },
      nextSteps: [{ chainId: 56, action: 'approve-paymaster', sponsored: true }],
      transferFee: 2, atsBalance: 10, symbol: 'ATS', isCrosschain: true,
    }) } }
    const f = useAtsFee()
    await f.loadAtsFee({ chainId: 8453, address: ADDR, call: CALL })
    expect(f.ready.value).toBe(false)
    expect(f.decision.value.action).toBe('run-onboarding')
    expect(f.nextSteps.value).toHaveLength(1)
    expect(f.isCrosschain.value).toBe(true)
  })

  it('ready:false ve engel varsa BLOKLAR (bakiye yetse bile)', async () => {
    globalThis.chrome = { runtime: { sendMessage: async () => ({
      success: true, ready: false, blocker: 'remote-not-ready',
      decision: { severity: 'operator', action: 'suggest-other-chain', i18nKey: 'x' },
      transferFee: 2, atsBalance: 1000, symbol: 'ATS', nextSteps: [],
    }) } }
    const f = useAtsFee()
    await f.loadAtsFee({ chainId: 8453, address: ADDR, call: CALL })
    expect(f.blocked.value).toBe(true)
  })

  it('ready:true ve bakiye yeterliyse BLOKLAMAZ', async () => {
    globalThis.chrome = { runtime: { sendMessage: async () => ({
      success: true, ready: true, mode: 'crosschain', transferFee: 2, atsBalance: 1000,
      symbol: 'ATS', nextSteps: [], isCrosschain: true,
    }) } }
    const f = useAtsFee()
    await f.loadAtsFee({ chainId: 8453, address: ADDR, call: CALL })
    expect(f.blocked.value).toBe(false)
  })

  // Bootstrap modunda gonderim IKI op'tur ve ikisi de AYRI AYRI fiyatlanip tahsil edilir.
  // Ekran/butce tek op uzerinden hesaplarsa, 1x ile 2x ucret arasi bakiyesi olan kullaniciya
  // "yeterli" gosterilir: op1 iner ve odenir, op2 bakiye yetersizliginden duser — para gitmis,
  // transfer HIC gonderilmemis olur. Op basina tavan (assertQuoteWithinApproval) bunu
  // yakalayamaz, cunku her op tek basina sinirin icindedir.
  describe('bootstrap: iki op, iki ucret', () => {
    const quote = (over = {}) => ({
      success: true, ready: true, mode: 'bootstrap', transferFee: 2, atsBalance: 3,
      symbol: 'ATS', nextSteps: [], opCount: 2, ...over,
    })

    it('opCount 2 iken gereken tutar ve gosterilen ucret PER-OP un IKI KATIDIR', async () => {
      globalThis.chrome = { runtime: { sendMessage: async () => quote() } }
      const f = useAtsFee()
      await f.loadAtsFee({ chainId: 56, address: ADDR, call: CALL })
      expect(f.atsFee.value).toBe(2)          // per-op ucret degismedi (onay siniri buna bakar)
      expect(f.feeTotal.value).toBe(4)        // ekranda gosterilecek TOPLAM
      expect(f.requiredAts.value).toBe(4)
    })

    it('opCount 2 iken 1x ile 2x arasi bakiye YETERSIZ sayilir ve BLOKLAR', async () => {
      globalThis.chrome = { runtime: { sendMessage: async () => quote({ atsBalance: 3 }) } }
      const f = useAtsFee()
      await f.loadAtsFee({ chainId: 56, address: ADDR, call: CALL })
      expect(f.insufficient.value).toBe(true)
      expect(f.blocked.value).toBe(true)
    })

    it('opCount 2 iken 2x bakiye YETERLIDIR', async () => {
      globalThis.chrome = { runtime: { sendMessage: async () => quote({ atsBalance: 4 }) } }
      const f = useAtsFee()
      await f.loadAtsFee({ chainId: 56, address: ADDR, call: CALL })
      expect(f.insufficient.value).toBe(false)
      expect(f.blocked.value).toBe(false)
    })

    it('opCount 1 (tek op) davranisi degismez', async () => {
      globalThis.chrome = { runtime: { sendMessage: async () => quote({ mode: 'crosschain', opCount: 1 }) } }
      const f = useAtsFee()
      await f.loadAtsFee({ chainId: 8453, address: ADDR, call: CALL })
      expect(f.feeTotal.value).toBe(2)
      expect(f.requiredAts.value).toBe(2)
      expect(f.insufficient.value).toBe(false)   // bakiye 3 >= 2
    })

    it('opCount yanitta hic yoksa 1 varsayilir (fail-safe, eski backend)', async () => {
      globalThis.chrome = { runtime: { sendMessage: async () => quote({ opCount: undefined }) } }
      const f = useAtsFee()
      await f.loadAtsFee({ chainId: 56, address: ADDR, call: CALL })
      expect(f.requiredAts.value).toBe(2)
    })

    it('ATS gonderiliyorsa iki op un ucreti DE tutarin ustune eklenir', async () => {
      globalThis.chrome = { runtime: { sendMessage: async () => quote({ atsBalance: 100 }) } }
      const f = useAtsFee()
      await f.loadAtsFee({ chainId: 56, address: ADDR, call: CALL, sentAssetAddress: ATS, sendAmount: '10' })
      expect(f.requiredAts.value).toBeCloseTo(14)   // 2 + 2 + 10
    })
  })

  // Spec §4.8: /quote ucreti budget.srcAllowance'i asiyorsa ekran butce-tazeleme adimini
  // /sponsor'un reddetmesini BEKLEMEDEN gostermeli. /status taban ucretle (minChargeAts)
  // sorguladigi icin ready:true der; bu op icin gecerli olmayabilir (belge 05).
  describe('needsTopUp (butce tazeleme onden yakalama)', () => {
    const resp = (over = {}) => ({
      success: true, ready: true, mode: 'crosschain', transferFee: 2, atsBalance: 100,
      symbol: 'ATS', nextSteps: [], isCrosschain: true, ...over,
    })

    it('ready:true ama needsTopUp:true ise BLOKLAR', async () => {
      globalThis.chrome = { runtime: { sendMessage: async () => resp({ needsTopUp: true }) } }
      const f = useAtsFee()
      await f.loadAtsFee({ chainId: 8453, address: ADDR, call: CALL })
      expect(f.ready.value).toBe(true)
      expect(f.insufficient.value).toBe(false)   // bakiye BOL — bloklayan tek sey izin
      expect(f.needsTopUp.value).toBe(true)
      expect(f.blocked.value).toBe(true)
    })

    it('butce-tazeleme karti src-allowance-low ile AYNI karari uretir (ayni kart + onboarding butonu)', async () => {
      globalThis.chrome = { runtime: { sendMessage: async () => resp({ needsTopUp: true }) } }
      const f = useAtsFee()
      await f.loadAtsFee({ chainId: 8453, address: ADDR, call: CALL })
      expect(f.decision.value).toMatchObject({
        severity: 'user', action: 'run-onboarding',
        i18nKey: 'send.confirmTransaction.atsBudgetLow',
      })
    })

    // Iki adimli nextSteps = backend "hic kurulmamis" diyor (paymaster + toplayici izni
    // birden gerekiyor). Baslik "butce yetmiyor" degil "tek seferlik kurulum gerekli"
    // olmali: aciklama metni zaten adim sayisina bakiyor (ConfirmTransaction.vue), baslik
    // farkli sinyalden turetilince kart kendi icinde celisiyordu (2026-08-12 canli).
    it('nextSteps 2 adimliysa karar src-allowance-missing (kurulum basligi)', async () => {
      globalThis.chrome = { runtime: { sendMessage: async () => resp({
        needsTopUp: true,
        nextSteps: [{ action: 'approve-paymaster' }, { action: 'approve-collector' }],
      }) } }
      const f = useAtsFee()
      await f.loadAtsFee({ chainId: 8453, address: ADDR, call: CALL })
      expect(f.decision.value).toMatchObject({
        severity: 'user', action: 'run-onboarding',
        i18nKey: 'send.confirmTransaction.atsOnboardingNeeded',
      })
    })

    it('backend in KENDI engeli varsa o kazanir (needsTopUp onun yerine gecmez)', async () => {
      globalThis.chrome = { runtime: { sendMessage: async () => resp({
        ready: false, needsTopUp: true, blocker: 'paymaster-paused',
        decision: { severity: 'operator', action: 'suggest-other-chain', i18nKey: 'x' },
      }) } }
      const f = useAtsFee()
      await f.loadAtsFee({ chainId: 8453, address: ADDR, call: CALL })
      expect(f.decision.value.action).toBe('suggest-other-chain')
    })

    it('needsTopUp yoksa bloklamaz', async () => {
      globalThis.chrome = { runtime: { sendMessage: async () => resp({ needsTopUp: false }) } }
      const f = useAtsFee()
      await f.loadAtsFee({ chainId: 8453, address: ADDR, call: CALL })
      expect(f.blocked.value).toBe(false)
      expect(f.decision.value).toBe(null)
    })
  })

  // Minor 11: backend `ready:false` deyip `blocker` vermezse decision null, error de bos kalir
  // -> kullanici HICBIR kart gormeden bloklu kalir ve neden gonderemedigini bilemez.
  it('ready:false ve blocker YOKSA gecici bir karara duser (kullanici kartsiz kalmaz)', async () => {
    globalThis.chrome = { runtime: { sendMessage: async () => ({
      success: true, ready: false, transferFee: 2, atsBalance: 10, symbol: 'ATS', nextSteps: [],
    }) } }
    const f = useAtsFee()
    await f.loadAtsFee({ chainId: 8453, address: ADDR, call: CALL })
    expect(f.blocked.value).toBe(true)
    expect(f.decision.value).toBeTruthy()
    expect(f.decision.value.severity).toBe('transient')
  })

  it('runOnboarding basariliysa teklifi yeniden yukler', async () => {
    let calls = []
    globalThis.chrome = { runtime: { sendMessage: async (m) => {
      calls.push(m.type)
      if (m.type === 'ATS_RUN_ONBOARDING') return { success: true, steps: [{ txHash: '0x1' }] }
      return { success: true, ready: true, mode: 'crosschain', transferFee: 2, atsBalance: 10, symbol: 'ATS', nextSteps: [] }
    } } }
    const f = useAtsFee()
    await f.loadAtsFee({ chainId: 8453, address: ADDR, call: CALL })
    await f.runOnboarding({ chainId: 8453, address: ADDR, call: CALL })
    expect(calls).toEqual(['ATS_FEE_QUOTE', 'ATS_RUN_ONBOARDING', 'ATS_FEE_QUOTE'])
    expect(f.ready.value).toBe(true)
  })

  // Bootstrap kota hatalari ("imza zaten acik" ~5 dk, "gunluk kota doldu" ertesi gun,
  // "deneme hakki doldu" destek) KODSUZ 400 olarak gelir. `finally` icindeki zorunlu
  // tazeleme bu OZGUL metni ezmemeli — aksi halde kullaniciya jenerik bir "kurulum
  // gerekli" karti gosterilir ve neden basarisiz oldugu kaybolur.
  it('runOnboarding basarisiz olursa sunucu hata metnini AYNEN tutar (tazeleme sonrasi da)', async () => {
    let calls = []
    globalThis.chrome = { runtime: { sendMessage: async (m) => {
      calls.push(m.type)
      if (m.type === 'ATS_RUN_ONBOARDING') return { success: false, error: 'gunluk kota doldu, yarin tekrar deneyin' }
      return { success: true, ready: false, mode: 'crosschain', transferFee: 2, atsBalance: 10, symbol: 'ATS', nextSteps: [] }
    } } }
    const f = useAtsFee()
    await f.loadAtsFee({ chainId: 8453, address: ADDR, call: CALL })
    const ok = await f.runOnboarding({ chainId: 8453, address: ADDR, call: CALL })
    expect(ok).toBe(false)
    expect(f.error.value).toBe('gunluk kota doldu, yarin tekrar deneyin')
    // Durum yine de tazelenmis olmali (iki adimli onboarding'de 1. adim zincire yazilip
    // 2. adim dusmus olabilir; bayat /status kullaniciyi yaniltir).
    expect(calls).toEqual(['ATS_FEE_QUOTE', 'ATS_RUN_ONBOARDING', 'ATS_FEE_QUOTE'])
    // ConfirmTransaction.vue'daki jenerik hata kartinin gizleme kosulu ("decision fiilen
    // gosteriliyorsa jenerik karti bastir") tam bu durumu varsayiyor: basarisizlik sonrasi
    // decision VE error AYNI ANDA dolu olur (kodsuz backend hatasi -> transient/refresh-status).
    expect(f.decision.value).toBeTruthy()
    expect(f.decision.value.action).toBe('refresh-status')
    expect(f.error.value).toBeTruthy()
  })

  it('basarisizliktan sonra tazeleme daha acil (operator) bir engel bulursa decision onu yansitir, error yine sunucu metnidir', async () => {
    let quoteCalls = 0
    globalThis.chrome = { runtime: { sendMessage: async (m) => {
      if (m.type === 'ATS_RUN_ONBOARDING') return { success: false, error: 'kurulum patladi' }
      quoteCalls += 1
      if (quoteCalls === 1) {
        // ilk /status (loadAtsFee): normal, engel yok
        return { success: true, ready: true, mode: 'crosschain', transferFee: 2, atsBalance: 10, symbol: 'ATS', nextSteps: [] }
      }
      // tazeleme /status: ag durdurulmus — kullaniciyi ilgilendirmeyen daha acil bir engel
      return {
        success: true, ready: false, blocker: 'paymaster-paused',
        decision: { severity: 'operator', action: 'suggest-other-chain', i18nKey: 'send.confirmTransaction.atsChainPaused' },
        transferFee: 2, atsBalance: 10, symbol: 'ATS', nextSteps: [],
      }
    } } }
    const f = useAtsFee()
    await f.loadAtsFee({ chainId: 8453, address: ADDR, call: CALL })
    await f.runOnboarding({ chainId: 8453, address: ADDR, call: CALL })
    // Tazelemenin bulduğu daha acil engel kazanır (decision fiilen gosterilir) ama sunucunun
    // ozgul hata metni SILINMEZ — ikisi ayni anda dolu kalir (bkz. yukaridaki test yorumu).
    expect(f.decision.value).toBeTruthy()
    expect(f.decision.value.severity).toBe('operator')
    expect(f.decision.value.action).toBe('suggest-other-chain')
    expect(f.error.value).toBeTruthy()
    expect(f.error.value).toBe('kurulum patladi')
  })

  // GERCEK VAKA (2026-08-10, chainId 1, canli backend). Tam zincir:
  //   /status -> ready:true, mode:"bootstrap", nextSteps:[], srcAllowance:"0"
  //   -> ekran needsTopUp ile bloklanir ve "kurulumu baslat" karti cikar
  //   -> buton basilir, runAtsOnboarding calistiracak adim BULAMAZ
  // Duzeltmeden ONCE: arka plan {success:true, steps:[]} donuyordu; buton hicbir sey
  // yapmiyor, hicbir hata gorunmuyor, ekran ayni kaliyordu. Kullanici defalarca basti.
  it('adim gelmediginde buton SESSIZ kalmaz: kullaniciya gorunur bir engele donusur', async () => {
    globalThis.chrome = { runtime: { sendMessage: async (m) => {
      if (m.type === 'ATS_RUN_ONBOARDING') {
        return { success: false, error: 'Sunucu kurulum adimlarini gondermedi', code: 'onboarding-steps-missing' }
      }
      return {
        success: true, ready: true, mode: 'bootstrap', transferFee: 19.5, atsBalance: 955,
        symbol: 'ATS', nextSteps: [], needsTopUp: true, isCrosschain: true,
      }
    } } }
    const f = useAtsFee()
    await f.loadAtsFee({ chainId: 1, address: ADDR, call: CALL })
    // Baslangic: bakiye BOL (955 > 19.5) — blokun sebebi bakiye DEGIL, butce/izin.
    expect(f.insufficient.value).toBe(false)
    expect(f.blocked.value).toBe(true)
    expect(f.decision.value.action).toBe('run-onboarding')

    expect(await f.runOnboarding({ chainId: 1, address: ADDR, call: CALL })).toBe(false)
    // Tazeleme ayni "kurulum gerekli" kartini geri koyar; ONBOARDING HATASI onu ezmeli,
    // yoksa kullanici yine ayni butona bakar.
    expect(f.decision.value.severity).toBe('operator')
    expect(f.decision.value.i18nDescKey).toBeTruthy()
    expect(f.error.value).toBeTruthy()
  })
})

// --- chrome.runtime.sendMessage SERILESTIRME SINIRI -----------------------------------------
// Mock'lanan `sendMessage` hicbir sey serilestirmez, yani gercek sinir testlerde HIC
// zorlanmaz — 2026-08-09'daki "Ucret hesaplanamadi" vakasi (yanittaki BigInt'ler, bkz.
// utils/messageSafe.js) tam bu kor noktadan gecti. Bu mock artik her cagride
// structuredClone deneyerek sinirin davranisini taklit ediyor: giden govdeye BigInt ya da
// klonlanamayan bir deger sizarsa test kirmizi olur.
import { ref } from 'vue'

// Chrome uzanti mesajlarini JSON olarak serilestirir (structuredClone DEGIL — o BigInt'i
// kabul eder, Chrome etmez). Mock hem GIDEN govdeyi hem YANITI dener: 2026-08-09'daki hata
// yanittaki BigInt'lerdendi ve Chrome onu da GONDERENIN promise'ine dusuruyor.
const serializingChrome = (resp) => ({
  runtime: {
    sendMessage: vi.fn(async (msg) => {
      try { JSON.stringify(msg); JSON.stringify(resp) }
      catch { throw new Error('Could not serialize message.') }
      return resp
    }),
  },
})

describe('useAtsFee — giden mesaj serilestirilebilir olmali', () => {
  it('ref icinde tutulan (proxy) call ile mesaj YINE DE gonderilebilir', async () => {
    globalThis.chrome = serializingChrome(OK)
    const held = ref(null)
    held.value = { to: '0x' + '9'.repeat(40), value: '0', data: '0x1234' }
    const a = useAtsFee()
    await a.loadAtsFee({ chainId: 421614, address: ADDR, call: held.value })
    expect(a.error.value).toBe(null)
    expect(a.atsFee.value).toBe(1.25)
  })

  it('call.value BigInt olsa bile mesaj gonderilebilir (string e normalize edilir)', async () => {
    globalThis.chrome = serializingChrome(OK)
    const a = useAtsFee()
    await a.loadAtsFee({
      chainId: 421614, address: ADDR,
      call: { to: '0x' + '9'.repeat(40), value: 1000000000000000000n, data: '0x' },
    })
    expect(a.error.value).toBe(null)
    const sent = chrome.runtime.sendMessage.mock.calls[0][0]
    expect(sent.message.call.value).toBe('1000000000000000000')
  })

  it('call null iken de gonderilebilir', async () => {
    globalThis.chrome = serializingChrome(OK)
    const a = useAtsFee()
    await a.loadAtsFee({ chainId: 421614, address: ADDR, call: null })
    expect(a.error.value).toBe(null)
    expect(chrome.runtime.sendMessage.mock.calls[0][0].message.call).toBe(null)
  })
})

// GERCEK VAKA (2026-08-10): /paymaster/relay nginx'ten **504** dondu ve kullanici uzun bir
// bekleme sonunda jenerik "Gecici bir sorun olustu" gordu. Sebep: arka plan HTTP durumunu
// dusuruyor, composable de her kodsuz hatayi sabit 400 sayiyordu. 5xx ile 4xx AYRI kartlar:
// 5xx "sunucu hatasi, biraz sonra tekrar deneyin" demeli — kullanicinin yapabilecegi tek
// dogru sey budur ve tekrar denemek GERCEKTEN cozer (zincire hicbir sey inmemisti).
describe('HTTP durumu karara yansir', () => {
  const respondWith = (resp) => { globalThis.chrome = { runtime: { sendMessage: async () => resp } } }

  it('504: sunucu hatasi karti (retry-later)', async () => {
    respondWith({ success: false, error: 'HTTP 504', httpStatus: 504 })
    const f = useAtsFee()
    await f.loadAtsFee({ chainId: 8453, address: ADDR, call: CALL })
    expect(f.decision.value.action).toBe('retry-later')
    expect(f.decision.value.i18nKey).toMatch(/atsServerError/)
  })

  it('400: gecici kart (eski davranis korunur)', async () => {
    respondWith({ success: false, error: 'gecersiz istek', httpStatus: 400 })
    const f = useAtsFee()
    await f.loadAtsFee({ chainId: 8453, address: ADDR, call: CALL })
    expect(f.decision.value.action).toBe('refresh-status')
  })

  it('durum hic gelmezse 400 varsayilir (eski sunucu/yol)', async () => {
    respondWith({ success: false, error: 'bilinmeyen' })
    const f = useAtsFee()
    await f.loadAtsFee({ chainId: 8453, address: ADDR, call: CALL })
    expect(f.decision.value.action).toBe('refresh-status')
  })
})

// Header'daki yakit pill'i "N islem" tahminini bu ipucundan uretiyor. Quote akisi bunun
// tek uretim noktasi; yazilmazsa pill kalici olarak "uyari yok" durumunda kalir.
describe('useAtsFee — yakit ipucu', () => {
  it('basarili quote op basina ucreti ipucu olarak yazar', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK)
    const a = useAtsFee()
    await a.loadAtsFee({ ...ARGS, chainId: 56 })
    expect(storageStore.ats_fee_hints['56'].perOp).toBe(1.25)
  })

  it('basarisiz quote ipucu YAZMAZ (bayat ucretle yaniltmasin)', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: false, error: 'stale rate' })
    const a = useAtsFee()
    await a.loadAtsFee({ ...ARGS, chainId: 56 })
    expect(storageStore.ats_fee_hints).toBeUndefined()
  })

  it('depo patlasa bile quote DUSMEZ', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK)
    chrome.storage.local.set.mockRejectedValue(new Error('quota'))
    const a = useAtsFee()
    await a.loadAtsFee({ ...ARGS, chainId: 56 })
    expect(a.atsFee.value).toBe(1.25)
    expect(a.error.value).toBe(null)
  })
})
