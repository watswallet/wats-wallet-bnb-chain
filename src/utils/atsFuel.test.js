import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  FUEL_LOW_OPS, ATS_BUY_URL, formatFuel, formatFuelExact, pickFeeHint,
  fuelOpsLeft, fuelLevel, readFeeHints, writeFeeHint, readFuelCache, writeFuelCache,
} from './atsFuel'

const ADDR = '0x' + 'A'.repeat(40)

// chrome.storage.local'i tek bir nesne uzerinde taklit et: get/set gercek bir depo gibi
// davranir, yani "yaz sonra oku" testleri gercek davranisi olcer.
let store
beforeEach(() => {
  store = {}
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn(async (key) => (key in store ? { [key]: store[key] } : {})),
        set: vi.fn(async (obj) => { Object.assign(store, obj) }),
      },
    },
  }
})

describe('formatFuel', () => {
  it('okunamayan deger tire doner', () => {
    expect(formatFuel(null)).toBe('—')
    expect(formatFuel(undefined)).toBe('—')
    expect(formatFuel('abc')).toBe('—')
  })
  it('sifir sifirdir', () => {
    expect(formatFuel(0)).toBe('0')
    expect(formatFuel('0')).toBe('0')
  })
  it('cok kucuk bakiye SIFIRA yuvarlanmaz', () => {
    // 0.001 icin "0" yazmak "yakit yok" demektir; oysa bakiye VAR.
    expect(formatFuel(0.001)).toBe('<0.01')
  })
  it('1 altinda iki ondalik, sondaki sifir kirpilir', () => {
    expect(formatFuel(0.42)).toBe('0.42')
    expect(formatFuel(0.4)).toBe('0.4')
  })
  it('1-100 arasi tek ondalik', () => {
    expect(formatFuel(12.44)).toBe('12.4')
    expect(formatFuel(12)).toBe('12')
  })
  it('100-1000 arasi tam sayi', () => {
    expect(formatFuel(955.31)).toBe('955')
  })
  it('yuvarlaninca binlige tasan deger K esigine duser', () => {
    expect(formatFuel(999.6)).toBe('1K')
  })
  it('binler K, milyonlar M, milyarlar B', () => {
    expect(formatFuel(1234)).toBe('1.2K')
    expect(formatFuel(3400000)).toBe('3.4M')
    expect(formatFuel(2500000000)).toBe('2.5B')
  })
  it('buyuk basamakta ondalik DUSER, yer tasmasin', () => {
    // 987.7M alti karakterdir; header'da yer yok.
    expect(formatFuel(987654321)).toBe('988M')
  })
  it('yuvarlama UST basamaga tasiyorsa o basamaga gecer', () => {
    // Kontrol yalniz birler->K esiginde vardi; "1000K"/"1000M" ne kastedilen deger ne de
    // okunur bir cikti.
    expect(formatFuel(999999)).toBe('1M')
    expect(formatFuel(999999999)).toBe('1B')
  })
  it('en ust basamak TAVANLIDIR', () => {
    // 999B ustunde 5 karaktere sigan dogru bir sayi yok; sessizce yanlis bir sayiya
    // kirpmak yerine kirpildigini soyleyen bir bicim.
    expect(formatFuel(9.99e11)).toBe('999B')
    expect(formatFuel(1e13)).toBe('>999B')
  })
  it('cikti hicbir durumda 5 karakteri gecmez', () => {
    // Iddia "hicbir durumda" diyorsa test de bir ORNEK LISTESI olamaz: elle secilmis 11
    // deger 1e13 -> "10000B" ihlalini goremiyordu. Her buyuklugu SUPUR.
    const values = [0, 0.001, 0.42, 12.44, 99.96, 955.31, 999.6, 1234, 3400000, 987654321, 2.5e9]
    for (let k = -8; k <= 20; k++) {
      values.push(10 ** k, 10 ** k * 9.87, 10 ** k * 9.999)
    }
    for (const v of values) {
      const out = formatFuel(v)
      expect(out.length, `formatFuel(${v}) = ${out}`).toBeLessThanOrEqual(5)
    }
  })
})

describe('formatFuelExact', () => {
  it('popover icin kisaltmaz, sondaki sifirlari kirpar', () => {
    expect(formatFuelExact('955.3100')).toBe('955.31')
    expect(formatFuelExact(12)).toBe('12')
    expect(formatFuelExact('0.0004')).toBe('0.0004')
  })
  it('okunamayan deger tire doner', () => {
    expect(formatFuelExact(null)).toBe('—')
  })
  it('toz bakiye SIFIRA yuvarlanmaz (formatFuel ile AYNI koruma)', () => {
    // (0.00001).toFixed(4) -> "0.0000" -> kirpilinca "0". Pill '<0.01' derken popover
    // '0 ATS' diyemez; bakiye varken "0" yazmak "yakit yok" demektir. Iki fonksiyon bu
    // korumada birlikte yurumeli.
    expect(formatFuelExact(0.00001)).toBe('<0.0001')
    expect(formatFuelExact(0)).toBe('0')
  })
})

describe('pickFeeHint', () => {
  const HINTS = {
    '1': { perOp: 9, at: 100 },
    '56': { perOp: 1.5, at: 50 },
  }
  it('MEVCUT zincirin ipucu daha eski olsa bile kazanir', () => {
    // Ethereum'daki op ucreti ile BSC'dekinin buyuklugu ayrisir; en yeniyi kosulsuz
    // secmek "N islem" tahminini kati yaniltir.
    expect(pickFeeHint(HINTS, 56)).toEqual({ perOp: 1.5, at: 50 })
  })
  it('sayi ya da string chainId ile ayni sonucu verir', () => {
    expect(pickFeeHint(HINTS, '56')).toEqual({ perOp: 1.5, at: 50 })
  })
  it('mevcut zincirin ipucu YOKSA null; BASKA zincire DUSMEZ', () => {
    // Geri dusme YANLIS UYARI uretir, bu yuzden yok: HINTS'teki Ethereum ucreti (9) ile
    // BSC'de duran bakiyeyi bolmek buyukluk olarak alakasiz bir "N islem" verir --
    // pahali zincirin ipucu kirmizi pill + "tek isleme yetmiyor", ucuz zincirinki sahte
    // bir 'ok' cikarir. Ipucu yoksa dogru davranis SESSIZLIK: fuelLevel bunu 'unknown'
    // yapar ve hic uyarmaz. Bunu "duzeltip" geri dusmeyi geri getirme.
    expect(pickFeeHint(HINTS, 137)).toBe(null)
  })
  it('gecersiz kayitlar yok sayilir', () => {
    expect(pickFeeHint({ '1': { perOp: 0, at: 9 }, '56': { perOp: null } }, 1)).toBe(null)
  })
  it('bos/bozuk harita null doner', () => {
    expect(pickFeeHint({}, 1)).toBe(null)
    expect(pickFeeHint(null, 1)).toBe(null)
  })
})

describe('fuelOpsLeft', () => {
  it('asagi yuvarlar', () => {
    expect(fuelOpsLeft({ balance: 10, feePerOp: 3 })).toBe(3)
  })
  it('ipucu yoksa null', () => {
    expect(fuelOpsLeft({ balance: 10, feePerOp: null })).toBe(null)
    expect(fuelOpsLeft({ balance: 10, feePerOp: 0 })).toBe(null)
  })
  it('bakiye okunamiyorsa null', () => {
    expect(fuelOpsLeft({ balance: null, feePerOp: 3 })).toBe(null)
  })
})

describe('fuelLevel', () => {
  it('bakiye okunamadi -> unknown', () => {
    expect(fuelLevel({ balance: null, feePerOp: 1 })).toBe('unknown')
  })
  it('bakiye sifir -> empty', () => {
    expect(fuelLevel({ balance: 0, feePerOp: 1 })).toBe('empty')
    expect(fuelLevel({ balance: 0, feePerOp: null })).toBe('empty')
  })
  it('IPUCU YOK + bakiye var -> unknown (UYARI URETMEZ)', () => {
    // Uydurulmus bir esikle 955 ATS'si olani korkutmak, hic uyarmamaktan daha kotu.
    expect(fuelLevel({ balance: 955, feePerOp: null })).toBe('unknown')
  })
  it('tek op a bile yetmiyor -> empty', () => {
    expect(fuelLevel({ balance: 0.5, feePerOp: 1 })).toBe('empty')
  })
  it('esigin altinda -> low', () => {
    expect(fuelLevel({ balance: 2.5, feePerOp: 1 })).toBe('low')
    expect(FUEL_LOW_OPS).toBe(3)
  })
  it('esik ve uzeri -> ok', () => {
    expect(fuelLevel({ balance: 3, feePerOp: 1 })).toBe('ok')
    expect(fuelLevel({ balance: 955, feePerOp: 1 })).toBe('ok')
  })
})

describe('depo yardimcilari', () => {
  it('ipucu yazilir ve zincire gore okunur', async () => {
    await writeFeeHint(56, 1.25)
    const hints = await readFeeHints()
    expect(hints['56'].perOp).toBe(1.25)
    expect(typeof hints['56'].at).toBe('number')
  })
  it('gecersiz ipucu YAZILMAZ', async () => {
    await writeFeeHint(56, 0)
    await writeFeeHint(56, null)
    expect(await readFeeHints()).toEqual({})
  })
  it('depo patlarsa ipucu yazimi SESSIZ gecer', async () => {
    chrome.storage.local.set.mockRejectedValueOnce(new Error('quota'))
    await expect(writeFeeHint(56, 1.25)).resolves.toBeUndefined()
  })
  it('depo patlarsa ipucu okumasi bos nesne doner', async () => {
    chrome.storage.local.get.mockRejectedValueOnce(new Error('io'))
    expect(await readFeeHints()).toEqual({})
  })
  it('onbellek adres bazlidir ve buyuk/kucuk harf duyarsizdir', async () => {
    await writeFuelCache(ADDR, '955.31')
    const rec = await readFuelCache(ADDR.toLowerCase())
    expect(rec.balance).toBe('955.31')
  })
  it('BASKA adresin onbellegi donmez', async () => {
    await writeFuelCache(ADDR, '955.31')
    expect(await readFuelCache('0x' + 'B'.repeat(40))).toBe(null)
  })
  it('adres ya da bakiye yoksa onbellege yazilmaz', async () => {
    await writeFuelCache(null, '1')
    await writeFuelCache(ADDR, 'abc')
    expect(await readFuelCache(ADDR)).toBe(null)
  })
})

describe('ATS_BUY_URL', () => {
  it('MEXC ATS/USDT sayfasidir (MoonPay ATS listelemiyor)', () => {
    expect(ATS_BUY_URL).toBe('https://www.mexc.com/exchange/ATS_USDT')
  })
})
