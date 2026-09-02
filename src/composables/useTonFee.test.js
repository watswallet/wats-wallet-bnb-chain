// useTonFee - TON gasless ucret onizlemesi. Kritik olan uc davranis:
// (1) gec donen ESKI cagrinin yeniyi EZMEMESI (useAtsOpFee.js'teki AYNI desen),
// (2) hata halinde karar T3'un resolveTonFeeBlocker'indan gelmesi,
// (3) 60sn'lik sessiz tazelemenin `loading`i TETIKLEMEMESI.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../utils/ton/tonFeeStatus', () => ({
  readTonFeeStatus: vi.fn(),
  tonFeeRelayActive: vi.fn((status) => !!(status && status.ton && status.ton.enabled)),
}))
vi.mock('../utils/ton/tonFeeClient', () => ({
  tonFeeQuote: vi.fn(),
}))

import { readTonFeeStatus } from '../utils/ton/tonFeeStatus'
import { tonFeeQuote } from '../utils/ton/tonFeeClient'
import { useTonFee, TON_FEE_SILENT_REFRESH_MS } from './useTonFee'

const ACTIVE_STATUS = { ton: { enabled: true, rateFresh: true, wallet: 'W5' } }
const QUOTE_OK = (atsMaxFee = '18140000000000000000') => ({
  quoteId: 'q1',
  sign: { feeAuth: { atsMaxFee, actionHash: '0xaa', seqno: 3, deadline: 999 } },
})

beforeEach(() => {
  globalThis.chrome = { runtime: { sendMessage: vi.fn() } }
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('sender yoksa hicbir agir cagri yapilmaz', () => {
  it('sender eksikse readTonFeeStatus HIC cagrilmaz, ready false kalir', async () => {
    const t = useTonFee()
    await t.load({})
    expect(readTonFeeStatus).not.toHaveBeenCalled()
    expect(t.ready.value).toBe(false)
    t.stop()
  })
})

describe('bolge kapaliysa teklif HIC istenmez', () => {
  it('relayActive false ise tonFeeQuote cagrilmaz', async () => {
    readTonFeeStatus.mockResolvedValue({ ton: { enabled: false } })
    const t = useTonFee()
    await t.load({ sender: '0xA1', tonWallet: 'EQ...', tonPublicKey: '0xpk', actions: [{ kind: 'ton' }] })
    expect(t.relayActive.value).toBe(false)
    expect(tonFeeQuote).not.toHaveBeenCalled()
    t.stop()
  })
})

describe('tonWallet/tonPublicKey/actions eksikse yalniz durum kontrolu yapilir', () => {
  it('relayActive true olur ama tutar cozulmez, HATA sayilmaz', async () => {
    readTonFeeStatus.mockResolvedValue(ACTIVE_STATUS)
    const t = useTonFee()
    await t.load({ sender: '0xA1' })
    expect(t.relayActive.value).toBe(true)
    expect(tonFeeQuote).not.toHaveBeenCalled()
    expect(t.atsMaxFee.value).toBeNull()
    expect(t.ready.value).toBe(false)
    expect(t.decision.value).toBeNull()
    expect(t.error.value).toBeNull()
    t.stop()
  })
})

describe('basarili teklif - KURAL 1: gosterilen alan atsMaxFee', () => {
  it('atsMaxFee feeAuth.atsMaxFee alanindan turer, ayri hesap YAPILMAZ', async () => {
    readTonFeeStatus.mockResolvedValue(ACTIVE_STATUS)
    tonFeeQuote.mockResolvedValue(QUOTE_OK('18140000000000000000'))
    const t = useTonFee()
    await t.load({ sender: '0xA1', tonWallet: 'EQ...', tonPublicKey: '0xpk', actions: [{ kind: 'ton' }] })
    expect(t.atsMaxFee.value).toBe('18.14')
    expect(t.ready.value).toBe(true)
    expect(t.quote.value.sign.feeAuth.atsMaxFee).toBe('18140000000000000000')
    t.stop()
  })

  it('tonFeeQuote AYNEN payer/tonWallet/tonPublicKey/actions ile cagrilir', async () => {
    readTonFeeStatus.mockResolvedValue(ACTIVE_STATUS)
    tonFeeQuote.mockResolvedValue(QUOTE_OK())
    const t = useTonFee()
    const actions = [{ kind: 'ton', to: 'EQdest', amountNano: '1' }]
    await t.load({ sender: '0xA1', tonWallet: 'EQwallet', tonPublicKey: '0xpk', actions })
    expect(tonFeeQuote).toHaveBeenCalledWith({
      tonWallet: 'EQwallet', tonPublicKey: '0xpk', payer: '0xA1', actions,
    })
    t.stop()
  })
})

describe('hata halinde karar resolveTonFeeBlocker uzerinden gelir', () => {
  it('/status fetch hatasi (ILK yukleme): relayActive varsayilan false KALIR, statusUnreadable TRUE olur', async () => {
    readTonFeeStatus.mockRejectedValue(Object.assign(new Error('ag hatasi'), { phase: 'status' }))
    const t = useTonFee()
    await t.load({ sender: '0xA1' })
    expect(t.relayActive.value).toBe(false)
    expect(t.statusUnreadable.value).toBe(true)
    expect(t.decision.value).toBeTruthy()
    expect(t.decision.value.action).toBe('retry-later')
    t.stop()
  })

  // ROUND 1 REVIEW BULGU 4 - kok neden testi: bir /status kesintisi "sunucu
  // kapatti" ile "okuyamadik" ayrimini KORUMALI. Relay DAHA ONCE basarili bir
  // okumayla ACIK dogrulanmissa, SONRAKI bir /status hatasi bunu FALSE'a
  // DUSURMEMELI (payWithTonFee/TON_FEE_RESERVE gizleme kararlari BOZULMAMALI) -
  // yalniz statusUnreadable isaretlenip decision'in ayrica gorunmesi saglanir.
  it('/status hatasi ONCEKI basarili "acik" okumayi BOZMAZ, yalniz statusUnreadable isaretler', async () => {
    const t = useTonFee()
    readTonFeeStatus.mockResolvedValueOnce(ACTIVE_STATUS)
    await t.load({ sender: '0xA1' })
    expect(t.relayActive.value).toBe(true)
    expect(t.statusUnreadable.value).toBe(false)

    readTonFeeStatus.mockRejectedValueOnce(Object.assign(new Error('ag hatasi'), { phase: 'status' }))
    await t.load({ sender: '0xA1' })
    expect(t.relayActive.value).toBe(true) // KORUNDU
    expect(t.statusUnreadable.value).toBe(true)
    expect(t.decision.value).toBeTruthy()
    t.stop()
  })

  it('/quote hatasinda relayActive ONCEKI basarili durumdan KORUNUR, statusUnreadable false KALIR', async () => {
    readTonFeeStatus.mockResolvedValue(ACTIVE_STATUS)
    tonFeeQuote.mockRejectedValue(Object.assign(new Error('tank dusuk'), { code: 'ton-tank-low', phase: 'quote' }))
    const t = useTonFee()
    await t.load({ sender: '0xA1', tonWallet: 'EQ...', tonPublicKey: '0xpk', actions: [{ kind: 'ton' }] })
    expect(t.relayActive.value).toBe(true)
    expect(t.statusUnreadable.value).toBe(false)
    expect(t.atsMaxFee.value).toBeNull()
    expect(t.decision.value).toEqual({
      severity: 'operator', action: 'retry-later', i18nKey: 'send.confirmTransaction.tonTankLow',
    })
    t.stop()
  })

  it('abort-unsafe kodu BLOKED severity + abort-unsafe action doner', async () => {
    readTonFeeStatus.mockResolvedValue(ACTIVE_STATUS)
    tonFeeQuote.mockRejectedValue(Object.assign(new Error('hash uyusmuyor'), { code: 'TON_QUOTE_HASH_MISMATCH', phase: 'quote' }))
    const t = useTonFee()
    await t.load({ sender: '0xA1', tonWallet: 'EQ...', tonPublicKey: '0xpk', actions: [{ kind: 'ton' }] })
    expect(t.decision.value.severity).toBe('blocked')
    expect(t.decision.value.action).toBe('abort-unsafe')
    t.stop()
  })
})

describe('yaris korumasi (useAtsOpFee.js ile ayni desen)', () => {
  it('gec donen ESKI teklif yenisini EZMEZ', async () => {
    readTonFeeStatus.mockResolvedValue(ACTIVE_STATUS)
    let resolveOld
    tonFeeQuote
      .mockImplementationOnce(() => new Promise((r) => { resolveOld = r }))
      .mockResolvedValueOnce(QUOTE_OK('9000000000000000000'))

    const t = useTonFee()
    const args = { sender: '0xA1', tonWallet: 'EQ...', tonPublicKey: '0xpk', actions: [{ kind: 'ton' }] }
    const oldCall = t.load(args)
    await t.load(args)
    expect(t.atsMaxFee.value).toBe('9')

    resolveOld(QUOTE_OK('1000000000000000000'))
    await oldCall
    expect(t.atsMaxFee.value).toBe('9')
    t.stop()
  })
})

describe('60sn sessiz tazeleme', () => {
  it('ilk yukleme loading i acar/kapatir, otomatik tazeleme loading i DEGISTIRMEZ', async () => {
    vi.useFakeTimers()
    readTonFeeStatus.mockResolvedValue(ACTIVE_STATUS)
    tonFeeQuote.mockResolvedValue(QUOTE_OK())

    const t = useTonFee()
    const p = t.load({ sender: '0xA1', tonWallet: 'EQ...', tonPublicKey: '0xpk', actions: [{ kind: 'ton' }] })
    expect(t.loading.value).toBe(true)
    await p
    expect(t.loading.value).toBe(false)

    expect(readTonFeeStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(TON_FEE_SILENT_REFRESH_MS)
    expect(readTonFeeStatus).toHaveBeenCalledTimes(2)
    // Sessiz tur boyunca loading HIC true olmadi (silent:true).
    expect(t.loading.value).toBe(false)

    t.stop()
  })

  it('stop() sonraki sessiz turu iptal eder', async () => {
    vi.useFakeTimers()
    readTonFeeStatus.mockResolvedValue(ACTIVE_STATUS)
    tonFeeQuote.mockResolvedValue(QUOTE_OK())

    const t = useTonFee()
    await t.load({ sender: '0xA1', tonWallet: 'EQ...', tonPublicKey: '0xpk', actions: [{ kind: 'ton' }] })
    t.stop()

    await vi.advanceTimersByTimeAsync(TON_FEE_SILENT_REFRESH_MS * 2)
    expect(readTonFeeStatus).toHaveBeenCalledTimes(1)
  })
})

describe('runOnboarding - HER ZAMAN BSC (ATS_SRC_CHAIN_ID), TON chainId DEGIL', () => {
  it('ATS_RUN_ONBOARDING chainId:56 ile gonderilir ve sonra load() tekrar calisir', async () => {
    readTonFeeStatus.mockResolvedValue(ACTIVE_STATUS)
    tonFeeQuote.mockResolvedValue(QUOTE_OK())
    chrome.runtime.sendMessage.mockResolvedValue({ success: true })

    const t = useTonFee()
    const args = { sender: '0xA1', tonWallet: 'EQ...', tonPublicKey: '0xpk', actions: [{ kind: 'ton' }] }
    await t.load(args)
    readTonFeeStatus.mockClear()

    const ok = await t.runOnboarding({ address: '0xA1', index: 0 })
    expect(ok).toBe(true)
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'ATS_RUN_ONBOARDING', message: { chainId: 56, address: '0xA1', index: 0 },
    })
    // Tazeleme: onboarding sonrasi AYNI argumanlarla load() tekrar calisti.
    expect(readTonFeeStatus).toHaveBeenCalledTimes(1)
    t.stop()
  })

  it('basarisiz onboarding false doner ama yine de tazeler', async () => {
    readTonFeeStatus.mockResolvedValue(ACTIVE_STATUS)
    tonFeeQuote.mockResolvedValue(QUOTE_OK())
    chrome.runtime.sendMessage.mockResolvedValue({ success: false, error: 'kota doldu' })

    const t = useTonFee()
    await t.load({ sender: '0xA1', tonWallet: 'EQ...', tonPublicKey: '0xpk', actions: [{ kind: 'ton' }] })
    const ok = await t.runOnboarding({ address: '0xA1' })
    expect(ok).toBe(false)
    expect(t.onboarding.value).toBe(false)
    t.stop()
  })
})

// KOK NEDEN (canlida olculdu 2026-08-31): backend TON teklifini
// `src-allowance-missing` ile reddediyor -> ekran "kurulum gerekli" diyor; ama
// AYNI backend'in /paymaster/status'u `ready:true` + `nextSteps:[]` donuyor, yani
// kosulacak adim YOK. Arka plan bunu `onboarding-steps-missing` koduyla ACIKCA
// bildiriyor (atsPaymaster.js runAtsOnboarding) -- ama bu composable yaniti
// `!!resp.success`e indirgeyip `code`/`error`i ATIYORDU ve hemen ardindan gelen
// load() `error`/`decision`i sifirliyordu. Kullanicinin gordugu tek sey: spinner,
// sonra AYNI kart. Sonsuz ve SESSIZ dongu.
//
// EVM kolu bunu ZATEN dogru yapiyor (useAtsFee.runOnboarding): basarisizligi
// saklar, tazelemeden SONRA geri koyar. Asagidakiler TON kolunu o sozlesmeye
// baglar. Cozum backend'de (bkz. docs/backend-bug-2026-08-10-status-vs-sponsor.md)
// ama dongunun GORUNUR olmasi istemcinin isi.
describe('onboarding basarisizligi EKRANA ULASIR (sessiz dongu yok)', () => {
  // Kartin "kurulum gerekli" halini ureten gercek sebep: teklif src-allowance-*
  // ile duser (atsBlocker: action run-onboarding).
  const ALLOWANCE_ERR = () => Object.assign(new Error('izin verilmemis'), {
    code: 'src-allowance-missing', httpStatus: 400, phase: 'quote',
  })

  async function setupBlockedScreen() {
    readTonFeeStatus.mockResolvedValue(ACTIVE_STATUS)
    tonFeeQuote.mockRejectedValue(ALLOWANCE_ERR())
    const t = useTonFee()
    await t.load({ sender: '0xA1', tonWallet: 'EQ...', tonPublicKey: '0xpk', actions: [{ kind: 'ton' }] })
    // On kosul: ekran gercekten "kurulumu baslat" butonunu gosteriyor.
    expect(t.decision.value.action).toBe('run-onboarding')
    return t
  }

  it('onboarding-steps-missing: karar "kurulum gerekli"den "baslatilamiyor"a DONER', async () => {
    const t = await setupBlockedScreen()
    chrome.runtime.sendMessage.mockResolvedValue({
      success: false,
      error: 'Sunucu kurulum adimlarini gondermedi (/paymaster/status nextSteps bos).',
      code: 'onboarding-steps-missing',
    })

    const ok = await t.runOnboarding({ address: '0xA1' })

    expect(ok).toBe(false)
    // Tazeleme AYNI "run-onboarding" karari uretir; basarisizligin karari onu
    // EZMELI - aksi halde kullanici ayni butona sonsuza dek basar.
    expect(t.decision.value).toMatchObject({
      severity: 'operator',
      action: 'retry-later',
      i18nKey: 'send.confirmTransaction.atsOnboardingUnavailable',
      i18nDescKey: 'send.confirmTransaction.atsOnboardingUnavailableDesc',
    })
    // Sunucu metni de KORUNUR: load() onu sifirliyordu.
    expect(t.error.value).toContain('nextSteps')
    t.stop()
  })

  it('kodsuz basarisizlik: mesaj korunur, karar gecici olarak isaretlenir', async () => {
    const t = await setupBlockedScreen()
    chrome.runtime.sendMessage.mockResolvedValue({ success: false, error: 'gunluk kota doldu' })

    await t.runOnboarding({ address: '0xA1' })

    expect(t.error.value).toBe('gunluk kota doldu')
    expect(t.decision.value).toMatchObject({ severity: 'transient', action: 'refresh-status' })
    t.stop()
  })

  it('sendMessage KENDISI reddederse (worker kapali) hata yine gorunur', async () => {
    const t = await setupBlockedScreen()
    chrome.runtime.sendMessage.mockRejectedValue(new Error('receiving end does not exist'))

    const ok = await t.runOnboarding({ address: '0xA1' })

    expect(ok).toBe(false)
    expect(t.error.value).toContain('receiving end')
    t.stop()
  })

  it('tazeleme DAHA ACIL bir engel bulduysa o kazanir (relayer tanki bitti)', async () => {
    const t = await setupBlockedScreen()
    // Onboarding koserken relayer'in TON tanki bosaldi: tazeleme bunu getirir ve
    // "kurulum baslatilamiyor"dan daha aciktir (kurulum yapilsa bile gonderilemez).
    // Kod TON ailesinden secildi: bu uc paymaster-paused gibi ATS kodlari DONMEZ
    // (bkz. tonFeeBlocker.js "UC AYRI KOD AILESI" notu).
    tonFeeQuote.mockRejectedValue(Object.assign(new Error('tank dusuk'), {
      code: 'ton-tank-low', httpStatus: 400, phase: 'quote',
    }))
    chrome.runtime.sendMessage.mockResolvedValue({ success: false, code: 'onboarding-steps-missing', error: 'adim yok' })

    await t.runOnboarding({ address: '0xA1' })

    expect(t.decision.value).toMatchObject({
      severity: 'operator', i18nKey: 'send.confirmTransaction.tonTankLow',
    })
    t.stop()
  })

  it('BASARILI onboarding hicbir hata birakmaz (regresyon)', async () => {
    const t = await setupBlockedScreen()
    // Kurulum tuttu: tazeleme artik temiz bir teklif getiriyor.
    tonFeeQuote.mockResolvedValue(QUOTE_OK())
    chrome.runtime.sendMessage.mockResolvedValue({ success: true, steps: [] })

    const ok = await t.runOnboarding({ address: '0xA1' })

    expect(ok).toBe(true)
    expect(t.error.value).toBeNull()
    expect(t.decision.value).toBeNull()
    expect(t.ready.value).toBe(true)
    t.stop()
  })
})

// Bakiye eksikken ekran "daha ne kadar ATS gerekli" diyebilmeli (2026-09-01).
// O sayinin TEK kaynagi /status'un `budget` blogu; teklif ZATEN dusmus oldugu
// icin `atsMaxFee` yoktur. Bu yuzden budget'i composable TASIMALI.
describe('/status budget disari acilir - "ne kadar eksik" hesabinin girdisi', () => {
  const BUDGET = { minChargeAts: '19054878048780488167', commissionAts: '9527439024390244083' }

  it('basarili okumada budget YAZILIR', async () => {
    readTonFeeStatus.mockResolvedValue({ ...ACTIVE_STATUS, budget: BUDGET })
    tonFeeQuote.mockResolvedValue(QUOTE_OK())
    const t = useTonFee()
    await t.load({ sender: '0xA1', tonWallet: 'EQ..', tonPublicKey: '0xpk', actions: [{ kind: 'ton' }] })
    expect(t.budget.value).toEqual(BUDGET)
    t.stop()
  })

  it('TEKLIF DUSSE BILE budget KALIR - kartin cizilecegi durum tam budur', async () => {
    readTonFeeStatus.mockResolvedValue({ ...ACTIVE_STATUS, budget: BUDGET })
    const err = new Error('bakiye yok')
    err.code = 'src-balance-missing'
    err.phase = 'quote'
    tonFeeQuote.mockRejectedValue(err)
    const t = useTonFee()
    await t.load({ sender: '0xA1', tonWallet: 'EQ..', tonPublicKey: '0xpk', actions: [{ kind: 'ton' }] })
    expect(t.decision.value?.action).toBe('buy-ats')
    expect(t.budget.value, 'teklif dusunce budget de silinmis').toEqual(BUDGET)
    t.stop()
  })

  it('sender yokken budget TEMIZLENIR (baska hesabin sayisi ekranda kalmasin)', async () => {
    readTonFeeStatus.mockResolvedValue({ ...ACTIVE_STATUS, budget: BUDGET })
    const t = useTonFee()
    await t.load({ sender: '0xA1' })
    expect(t.budget.value).toEqual(BUDGET)
    await t.load({})
    expect(t.budget.value).toBeNull()
    t.stop()
  })

  it('status budget TASIMIYORSA null - eski deger yapismaz', async () => {
    readTonFeeStatus.mockResolvedValueOnce({ ...ACTIVE_STATUS, budget: BUDGET })
    const t = useTonFee()
    await t.load({ sender: '0xA1' })
    expect(t.budget.value).toEqual(BUDGET)
    readTonFeeStatus.mockResolvedValueOnce({ ...ACTIVE_STATUS })
    await t.load({ sender: '0xA1' })
    expect(t.budget.value).toBeNull()
    t.stop()
  })
})
