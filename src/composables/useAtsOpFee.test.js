// useAtsOpFee — swap/bridge ucret + komisyon durumu.
// Kritik olan uc davranis: (1) §06.1 tavaninin dogru uygulanmasi, (2) gec donen eski
// teklifin yenisini EZMEMESI, (3) hata halinde ekranin "yesil" kalmamasi.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAtsOpFee } from './useAtsOpFee'
import { resolveAtsBlocker } from '../utils/atsBlocker'

const OK = (over = {}) => ({
  success: true,
  transferFee: 2, symbol: 'ATS', atsBalance: 100, opCount: 1, ready: true,
  nextSteps: [], commissionAts: '0', commissionAtsHuman: 0,
  commissionRegion: 'local', maxAtsSellRaw: '97',
  ...over,
})

beforeEach(() => {
  globalThis.chrome = { runtime: { sendMessage: vi.fn() } }
})

describe('teklif ucunu dogru secer', () => {
  it('swap -> ATS_SWAP_FEE_QUOTE, bridge -> ATS_BRIDGE_FEE_QUOTE', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK())
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: { chainId: 56 } })
    expect(chrome.runtime.sendMessage.mock.calls[0][0].type).toBe('ATS_SWAP_FEE_QUOTE')
    await a.load({ kind: 'bridge', payload: { chainId: 56 } })
    expect(chrome.runtime.sendMessage.mock.calls[1][0].type).toBe('ATS_BRIDGE_FEE_QUOTE')
  })
})

describe('komisyon alanlari', () => {
  it('kapaliyken hasCommission false ve toplam yalniz ucret', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK())
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.hasCommission.value).toBe(false)
    expect(a.totalAtsCost.value).toBe(2)
  })

  it('acikken komisyon toplama EKLENIR', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(
      OK({ commissionAts: '1000', commissionAtsHuman: 1 }))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.hasCommission.value).toBe(true)
    expect(a.totalAtsCost.value).toBe(3)
  })

  // Bootstrap modunda IKI op gider ve her biri AYRI AYRI tahsil edilir — op1 KENDI fiyatiyla
  // (bootstrapFee = /quote.atsFeeBootstrap, tabansiz), normal fiyatin ikinci kopyasiyla degil.
  it('bootstrap ta op1 kendi fiyatiyla eklenir, komisyon TEK sayilir', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(
      OK({ opCount: 2, bootstrapFee: 0.5, commissionAts: '1000', commissionAtsHuman: 1 }))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.totalAtsCost.value).toBe(3.5)   // 2 + 0.5 + 1
  })

  it('yanitta bootstrapFee yoksa op1 normal fiyattan sayilir (muhafazakar)', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(
      OK({ opCount: 2, commissionAts: '1000', commissionAtsHuman: 1 }))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.totalAtsCost.value).toBe(5)     // 2 + 2 + 1
  })
})

describe('exceedsAtsCap — §06.1', () => {
  it('tavani asan miktar yakalanir', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK({ maxAtsSellRaw: '97' }))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.exceedsAtsCap('98')).toBe(true)
    expect(a.exceedsAtsCap('97')).toBe(false)
    expect(a.exceedsAtsCap('10')).toBe(false)
  })

  // Yanlis bir "yetersiz" karti, calisacak bir islemi bloklamaktan kotudur.
  it('tavan bilinmiyorsa ENGELLEMEZ', () => {
    const a = useAtsOpFee()
    expect(a.exceedsAtsCap('10')).toBe(false)
  })

  it('cozulemeyen miktar engellemez', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK())
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.exceedsAtsCap('abc')).toBe(false)
  })
})

describe('hata halinde ekran YESIL kalmaz', () => {
  it('basarisiz teklif ready i dusurur ve hatayi tasir', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({
      success: false, error: 'izin yok', code: 'src-allowance-missing',
    })
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.ready.value).toBe(false)
    expect(a.blocked.value).toBe(true)
    expect(a.errorCode.value).toBe('src-allowance-missing')
    expect(a.decision.value).toBeTruthy()
  })

  it('firlatam mesajlasma da ready i dusurur', async () => {
    chrome.runtime.sendMessage.mockRejectedValue(new Error('kanal kapali'))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.ready.value).toBe(false)
    expect(a.error.value).toBe('kanal kapali')
  })

  // route-requires-native (§06.3): teklif asamasinda soylenir, kullanici gonderilemeyecek
  // bir ekrana goturulmez.
  it('native gerektiren rota kodu tasinir', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({
      success: false, error: 'native gerekiyor', code: 'route-requires-native',
    })
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.errorCode.value).toBe('route-requires-native')
    expect(a.ready.value).toBe(false)
  })
})

describe('yaris korumasi', () => {
  it('gec donen ESKI teklif yenisini EZMEZ', async () => {
    let resolveOld
    chrome.runtime.sendMessage
      .mockImplementationOnce(() => new Promise((r) => { resolveOld = r }))
      .mockResolvedValueOnce(OK({ transferFee: 9, maxAtsSellRaw: '5' }))

    const a = useAtsOpFee()
    const oldCall = a.load({ kind: 'swap', payload: {} })
    await a.load({ kind: 'swap', payload: {} })
    expect(a.atsFee.value).toBe(9)

    resolveOld(OK({ transferFee: 1, maxAtsSellRaw: '999' }))
    await oldCall
    expect(a.atsFee.value).toBe(9)
    expect(a.maxAtsSellRaw.value).toBe('5')
  })
})

// "en fazla" niteleyicisinin tek kaynagi quoteAtsTransfer'in feeRefundable'idir. Takas ve
// Kopru kartlari onu eskiden KOSULSUZ gosteriyordu — capraz-zincirde bile, iadenin hic
// olmadigi yerde.
describe('feeRefundable', () => {
  it('yanittan tasinir, alan yoksa false', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK({ feeRefundable: true }))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.feeRefundable.value).toBe(true)
    chrome.runtime.sendMessage.mockResolvedValue(OK())
    await a.load({ kind: 'swap', payload: {} })
    expect(a.feeRefundable.value).toBe(false)
  })

  it('hata sonrasi false a doner (bayat deger kalmaz)', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK({ feeRefundable: true, opCount: 2, bootstrapFee: 0.5 }))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    chrome.runtime.sendMessage.mockResolvedValue({ success: false, error: 'x' })
    await a.load({ kind: 'swap', payload: {} })
    expect(a.feeRefundable.value).toBe(false)
    expect(a.totalAtsCost.value).toBe(null)
  })
})

// BAKIYE BU OP'UN UCRETINE YETIYOR MU? Takas/Kopru bunu hic sormuyordu: ready:true ile
// buton acik kaliyor, /sponsor 'balance-missing' ile GONDERIMDEN SONRA reddediyordu.
// Bakiye teklifin `atsBalance`i -- satis tavaninin (maxAtsSellRaw) kuruldugu AYNI sayi,
// yani tavan ile bu karar birbiriyle celisemez.
describe('insufficient -- bakiye bu op un toplam ucretini karsiliyor mu', () => {
  // Inceleme senaryosu: bootstrap (op1 + transfer), bakiye 1 ATS.
  it('transfer + op1 bakiyeyi asiyorsa true', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(
      OK({ transferFee: 20.87, opCount: 2, bootstrapFee: 0.89, atsBalance: 1 }))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.insufficient.value).toBe(true)
  })

  it('sinir: toplam kadar bakiye yeter, eksigi yetmez', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(
      OK({ transferFee: 20.87, opCount: 2, bootstrapFee: 0.89, atsBalance: 21.76 }))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.insufficient.value).toBe(false)

    chrome.runtime.sendMessage.mockResolvedValue(
      OK({ transferFee: 20.87, opCount: 2, bootstrapFee: 0.89, atsBalance: 21.75 }))
    await a.load({ kind: 'swap', payload: {} })
    expect(a.insufficient.value).toBe(true)
  })

  it('komisyon da sayilir', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(
      OK({ transferFee: 2, commissionAts: '1000', commissionAtsHuman: 1, atsBalance: 2.5 }))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.insufficient.value).toBe(true)
  })

  // Ucret bilinmiyorsa "yetersiz" DENMEZ: buton zaten !ready ile kapali ve orada
  // "yetersiz bakiye" yazmak yanlis sebebi soylemek olurdu.
  it('teklif yokken ya da dusmusken false, gereken tutar null', async () => {
    const a = useAtsOpFee()
    expect(a.insufficient.value).toBe(false)
    expect(a.requiredAtsFor()).toBe(null)

    chrome.runtime.sendMessage.mockResolvedValue(OK({ atsBalance: 0 }))
    await a.load({ kind: 'swap', payload: {} })
    expect(a.insufficient.value).toBe(true)

    chrome.runtime.sendMessage.mockResolvedValue({ success: false, error: 'x' })
    await a.load({ kind: 'swap', payload: {} })
    expect(a.insufficient.value).toBe(false)
    expect(a.requiredAtsFor()).toBe(null)
  })

  // Kopru BSC ATS'sini gonderirken ayni bakiyeden hem ucret hem gonderilen miktar cikar.
  it('insufficientFor / requiredAtsFor gonderilen ATS i ekler', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(
      OK({ transferFee: 20.87, opCount: 2, bootstrapFee: 0.89, atsBalance: 25 }))
    const a = useAtsOpFee()
    await a.load({ kind: 'bridge', payload: {} })
    expect(a.insufficient.value).toBe(false)
    expect(a.requiredAtsFor()).toBeCloseTo(21.76, 10)
    expect(a.requiredAtsFor(5)).toBeCloseTo(26.76, 10)
    expect(a.insufficientFor(5)).toBe(true)
    expect(a.insufficientFor(3)).toBe(false)
  })
})

// BUTCE TAZELEME (capraz-zincir izni). quoteAtsTransfer, BSC'deki toplayici izninin bu op'un
// tahsilatina (ucret + komisyon) yetmedigini ONCEDEN soyler: `needsTopUp`. /status taban
// ucretle sordugu icin ready:true der. Takas/Kopru bu alani hic okumuyordu; op /sponsor'da
// 'src-allowance-low' ile GONDERIMDEN SONRA reddediliyordu. Gonder ekrani (useAtsFee) ayni
// durumda engelliyor ve butce tazeleme kartini gosteriyor -- burada da ayni karar.
describe('needsTopUp -- toplayici izni bu op a yetmiyor', () => {
  it('ready:true olsa da hazir DEGIL; karar butce tazeleme karti', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK({ needsTopUp: true }))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.needsTopUp.value).toBe(true)
    expect(a.ready.value).toBe(false)
    expect(a.blocked.value).toBe(true)
    expect(a.insufficient.value).toBe(false)   // bakiye BOL -- engelleyen tek sey izin
    expect(a.decision.value).toMatchObject({
      severity: 'user', action: 'run-onboarding', i18nKey: 'send.confirmTransaction.atsBudgetLow',
    })
  })

  // Iki adimli nextSteps = backend "hic kurulmamis" diyor; baslik da kurulum olmali
  // (Gonder ekraniyla ayni kural, useAtsFee).
  it('nextSteps 2 adimliysa karar kurulum basligidir', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK({
      needsTopUp: true,
      nextSteps: [{ action: 'approve-paymaster' }, { action: 'approve-collector' }],
    }))
    const a = useAtsOpFee()
    await a.load({ kind: 'bridge', payload: {} })
    expect(a.decision.value).toMatchObject({
      action: 'run-onboarding', i18nKey: 'send.confirmTransaction.atsOnboardingNeeded',
    })
  })

  it('backend in KENDI karari kazanir', async () => {
    const backend = { severity: 'operator', action: 'suggest-other-chain', i18nKey: 'x' }
    chrome.runtime.sendMessage.mockResolvedValue(OK({ ready: false, needsTopUp: true, decision: backend }))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.decision.value).toEqual(backend)
  })

  it('backend in engeli (blocker) da kazanir', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK({ ready: false, needsTopUp: true, blocker: 'paymaster-paused' }))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.decision.value).toEqual(resolveAtsBlocker('paymaster-paused'))
  })

  it('ESLENMIS: needsTopUp yoksa hazir ve karar yok', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK())
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.needsTopUp.value).toBe(false)
    expect(a.ready.value).toBe(true)
    expect(a.decision.value).toBe(null)
  })

  it('hata sonrasi sifirlanir (bayat true kalmaz)', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK({ needsTopUp: true }))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    chrome.runtime.sendMessage.mockResolvedValue({ success: false, error: 'x' })
    await a.load({ kind: 'swap', payload: {} })
    expect(a.needsTopUp.value).toBe(false)
  })
})

describe('onceki odeme (prepaid) — spec §6.5', () => {
  const PRE = { kind: 'carry', atsAmountRaw: '2000', atsAmount: 2 }

  it('/status hazirken needsTopUp ve yetersizlik kalkar; gereken ATS yalniz eklenen tutar', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK({
      ready: true, needsTopUp: true, atsBalance: 0, prepaid: PRE,
    }))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.ready.value).toBe(true)
    expect(a.blocked.value).toBe(false)
    expect(a.decision.value).toBe(null)
    expect(a.needsTopUp.value).toBe(false)
    expect(a.insufficient.value).toBe(false)
    expect(a.requiredAtsFor(3)).toBe(3)
    expect(a.prepaid.value).toEqual(PRE)
  })

  // SON INCELEME (kritik): /status hazir DEGILKEN gonderim kapisi reddeder; karti gizlemek kilitlerdi.
  it('/status hazir DEGILSE (src-*) butce karti KALIR ve not gosterilmez', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK({
      ready: false, blocker: 'src-balance-missing', decision: resolveAtsBlocker('src-balance-missing'),
      needsTopUp: true, atsBalance: 0, prepaid: PRE,
    }))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.ready.value).toBe(false)
    expect(a.blocked.value).toBe(true)
    expect(a.decision.value).toEqual(resolveAtsBlocker('src-balance-missing'))
    expect(a.prepaid.value).toBe(null)
  })

  it('operator engeli kalir', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK({
      ready: false, blocker: 'rate-stale', decision: resolveAtsBlocker('rate-stale'), prepaid: PRE,
    }))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.ready.value).toBe(false)
    expect(a.decision.value).toEqual(resolveAtsBlocker('rate-stale'))
  })

  it('reset prepaid i temizler', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK({ prepaid: PRE }))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    a.reset()
    expect(a.prepaid.value).toBe(null)
  })
})
