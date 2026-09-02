import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAtsFuel } from './useAtsFuel'

const ADDR = '0x' + 'A'.repeat(40)
const OTHER = '0x' + 'B'.repeat(40)

let store
beforeEach(() => {
  store = {}
  globalThis.chrome = {
    runtime: { sendMessage: vi.fn() },
    storage: {
      local: {
        get: vi.fn(async (key) => (key in store ? { [key]: store[key] } : {})),
        set: vi.fn(async (obj) => { Object.assign(store, obj) }),
      },
    },
  }
})

describe('useAtsFuel', () => {
  it('agdan okur, gosterir ve onbellege yazar', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: true, balance: '955.31', symbol: 'ATS' })
    const f = useAtsFuel()
    await f.load(ADDR, 56)
    expect(f.balance.value).toBe('955.31')
    expect(f.display.value).toBe('955')
    expect(f.exact.value).toBe('955.31')
    expect(f.stale.value).toBe(false)
    expect(store.ats_fuel_cache[ADDR.toLowerCase()].balance).toBe('955.31')
  })

  it('ag DUSTUGUNDE onbellekteki deger EKRANDA KALIR ve bayat isaretlenir', async () => {
    // '—'a dusurmek kullanicidan dogru (yalnizca eski) bir bilgiyi geri alirdi.
    store.ats_fuel_cache = { [ADDR.toLowerCase()]: { balance: '900', at: 1 } }
    const f = useAtsFuel()
    // Siralama KILITLI: ag cagrisi yapildigi ANDA onbellek zaten boyanmis olmali.
    // Yalnizca son durumu yoklamak, "once ag sonra onbellek" yazilmis bir uygulamayi
    // da gecirir -- ve o uygulama popup her acilista once '—' gosterir.
    // NOT: buradaki degeri bir DEGISKENE yakala, mock icinde dogrudan expect() COGRIMA.
    // load()'u cagiran composable'in KENDI catch bloku ag cagrisi sirasinda firlayan her
    // hatayi yutuyor -- mock icinde expect() firlatsa bile o hata composable'in catch'ine
    // dusup sessizce yutulur ve test YANLIS SIRAYLA da yesil kalirdi.
    let balanceAtCallTime
    chrome.runtime.sendMessage.mockImplementation(async () => {
      balanceAtCallTime = f.balance.value
      return { success: false, error: 'rpc down' }
    })
    await f.load(ADDR, 56)
    expect(balanceAtCallTime).toBe('900')
    expect(f.balance.value).toBe('900')
    expect(f.stale.value).toBe(true)
  })

  it('sendMessage REDDEDERSE de bayat isaretlenir, hata firlamaz', async () => {
    chrome.runtime.sendMessage.mockRejectedValue(new Error('port closed'))
    const f = useAtsFuel()
    await expect(f.load(ADDR, 56)).resolves.toBeUndefined()
    expect(f.stale.value).toBe(true)
    expect(f.display.value).toBe('—')
  })

  it('BASKA adresin onbellegi kullanilmaz', async () => {
    store.ats_fuel_cache = { [OTHER.toLowerCase()]: { balance: '900', at: 1 } }
    chrome.runtime.sendMessage.mockResolvedValue({ success: false, error: 'rpc down' })
    const f = useAtsFuel()
    await f.load(ADDR, 56)
    expect(f.balance.value).toBe(null)
    expect(f.display.value).toBe('—')
  })

  it('adres yoksa ag cagrisi HIC yapilmaz', async () => {
    const f = useAtsFuel()
    await f.load(null, 56)
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
    expect(f.balance.value).toBe(null)
  })

  it('ipucu yoksa seviye unknown, opsLeft null (UYARI URETMEZ)', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: true, balance: '955.31', symbol: 'ATS' })
    const f = useAtsFuel()
    await f.load(ADDR, 56)
    expect(f.level.value).toBe('unknown')
    expect(f.opsLeft.value).toBe(null)
  })

  it('MEVCUT zincirin ipucundan islem sayisi ve seviye turer', async () => {
    store.ats_fee_hints = { '1': { perOp: 100, at: 999 }, '56': { perOp: 20, at: 1 } }
    chrome.runtime.sendMessage.mockResolvedValue({ success: true, balance: '955.31', symbol: 'ATS' })
    const f = useAtsFuel()
    await f.load(ADDR, 56)
    expect(f.opsLeft.value).toBe(47)
    expect(f.level.value).toBe('ok')
  })

  it('yakit tek op a yetmiyorsa seviye empty', async () => {
    store.ats_fee_hints = { '56': { perOp: 20, at: 1 } }
    chrome.runtime.sendMessage.mockResolvedValue({ success: true, balance: '5', symbol: 'ATS' })
    const f = useAtsFuel()
    await f.load(ADDR, 56)
    expect(f.level.value).toBe('empty')
  })

  // Tum mikro gorevlerin bosalmasini bekle: mock'lar aninda cozuluyor, yani bir makro
  // gorev turu her bekleyen zincirin sonuna kadar kosmasini saglar. Tick saymak kirilgan.
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('ESKI adresin GEC gelen yaniti YENI adresin bakiyesini EZMEZ', async () => {
    // Header aktif hesabi depodan asenkron kuruyor ve changeAccount her an degistiriyor;
    // A'nin yaniti B'den sonra donerse muhafiz olmadan B'nin altinda A'nin yakiti kalir.
    // Zamanlayici olmadigi icin bu, oturum boyunca duzelmez.
    // NOT: mock icinde expect() FIRLATMA -- composable'in kendi catch'i onu yutar.
    let releaseA
    chrome.runtime.sendMessage.mockImplementation(async (msg) => {
      if (msg.message.address === ADDR) {
        await new Promise((r) => { releaseA = r })
        return { success: true, balance: '111', symbol: 'ATS' }
      }
      return { success: true, balance: '222', symbol: 'ATS' }
    })
    const f = useAtsFuel()
    const first = f.load(ADDR, 56)
    await flush()
    expect(typeof releaseA).toBe('function')  // A gercekten UCUSTA
    await f.load(OTHER, 56)
    expect(f.balance.value).toBe('222')
    releaseA()
    await first
    expect(f.balance.value).toBe('222')
    // Ekran korunur ama ONBELLEK yazilir: adrese gore anahtarli oldugu icin artik aktif
    // olmayan hesabin dogru degerini saklamak zararsiz ve istenir.
    expect(store.ats_fuel_cache[ADDR.toLowerCase()].balance).toBe('111')
  })

  it('ESKIYEN istek, yenisi hala ucustayken loading i KAPATMAZ', async () => {
    // Yoksa ilk istegin finally'si spinner'i durdurur ve yenile butonu istek ortasinda
    // yeniden tiklanabilir olur.
    let releaseA, releaseB
    chrome.runtime.sendMessage.mockImplementation(async (msg) => {
      const first = msg.message.address === ADDR
      await new Promise((r) => { if (first) releaseA = r; else releaseB = r })
      return { success: true, balance: first ? '111' : '222', symbol: 'ATS' }
    })
    const f = useAtsFuel()
    const a = f.load(ADDR, 56)
    await flush()
    const b = f.load(OTHER, 56)
    await flush()
    expect(f.loading.value).toBe(true)
    releaseA()
    await a
    expect(f.loading.value).toBe(true)  // B hala ucusta
    releaseB()
    await b
    expect(f.loading.value).toBe(false)
  })

  it('bayat isareti BASKA adrese SIZMAZ', async () => {
    store.ats_fuel_cache = { [OTHER.toLowerCase()]: { balance: '900', at: 1 } }
    chrome.runtime.sendMessage.mockResolvedValue({ success: false, error: 'rpc down' })
    const f = useAtsFuel()
    await f.load(ADDR, 56)
    expect(f.stale.value).toBe(true)
    // Hesap degisince yeni adresin ONBELLEK degeri aninda boyanir; o degerin uzerinde
    // ONCEKI hesabin okuma hatasindan kalan soluk nokta durmamali.
    let staleWhenPainted
    chrome.runtime.sendMessage.mockImplementation(async () => {
      staleWhenPainted = f.stale.value
      return { success: true, balance: '900', symbol: 'ATS' }
    })
    await f.load(OTHER, 56)
    expect(staleWhenPainted).toBe(false)
    expect(f.stale.value).toBe(false)
  })

  it('setChain AG OKUMASI YAPMAZ, yalniz ucret ipucunu yeniden secer', async () => {
    // Ag degisimi bakiyeyi degistirmez (bakiye her zaman BSC'dendir); degisen yalnizca
    // hangi zincirin ucret ipucunun gecerli oldugudur.
    store.ats_fee_hints = { '1': { perOp: 100, at: 999 }, '56': { perOp: 20, at: 1 } }
    chrome.runtime.sendMessage.mockResolvedValue({ success: true, balance: '955.31', symbol: 'ATS' })
    const f = useAtsFuel()
    await f.load(ADDR, 56)
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1)
    expect(f.opsLeft.value).toBe(47)
    await f.setChain(1)
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1)
    expect(f.opsLeft.value).toBe(9)
    expect(f.balance.value).toBe('955.31')
  })
})
