// useAtsOpFee — swap/bridge ucret + komisyon durumu.
// Kritik olan uc davranis: (1) §06.1 tavaninin dogru uygulanmasi, (2) gec donen eski
// teklifin yenisini EZMEMESI, (3) hata halinde ekranin "yesil" kalmamasi.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAtsOpFee } from './useAtsOpFee'

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

  // Bootstrap modunda IKI op gider ve her biri AYRI AYRI tahsil edilir.
  it('bootstrap ta ucret op sayisi kadar, komisyon TEK sayilir', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(
      OK({ opCount: 2, commissionAts: '1000', commissionAtsHuman: 1 }))
    const a = useAtsOpFee()
    await a.load({ kind: 'swap', payload: {} })
    expect(a.totalAtsCost.value).toBe(5)
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
