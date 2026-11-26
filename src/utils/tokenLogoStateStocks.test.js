// KOK NEDEN / KAPATILAN HATA (K28, K35; main senkronu 22f4f686 denetimi, madde C): d4dfd905 ile gelen "normal modda logosuz token
// kalmaz" kurali bakiyeli secicilerde (Takas / Kopru "Gonderilen", Gonder varlik secicisi) logosuz tokeni YALNIZ bakiyesi (> 0)
// OKUNMUSSA tutar. Elde tutulan tokenize hisse (katalog bStock ya da emekli BMNRB / FLNCB) logosuzsa ve bakiye okumasi o an
// yuklenmemis ya da gecici olarak okunamamissa satir secicide GIZLENIRDI: Sat / Gonder yolu sessizce kapanirdi (K35). Hisse
// satirlari artik Home'daki malvarligi kuraliyla ayni davranir: yalniz bakiyesi KESIN sifir olan gizlenir; bilinmeyen, yuklenmemis
// ve okunamayan satir monogramla GORUNUR kalir (para gizlenirse kayboldu gibi gorunur). Hisse olmayan logosuz token degismez.
// KESIF listeleri (hideLogoless: Alinan, arama) degismez: orasi edinme tarafidir, tutulan bakiye korumasi gerektirmez.
import { describe, it, expect, beforeEach } from 'vitest'
import { hideLogoless, hideLogolessUnlessHeld, hideLogolessZero, reportLogoExhausted, resetLogoState, isLogoMissing } from './tokenLogoState'
import { BSTOCKS } from '../data/bStocks'
import { RETIRED_BSTOCKS } from '../data/bStocksRetired'
import { RETIRED_XSTOCKS } from '../data/xStocksRetired'

beforeEach(() => resetLogoState())

const katalogBStock = { chainId: 56, address: BSTOCKS[0].address, symbol: BSTOCKS[0].symbol, name: BSTOCKS[0].name }
const BMNRB = RETIRED_BSTOCKS.find((r) => r.symbol === 'BMNRB')
const FLNCB = RETIRED_BSTOCKS.find((r) => r.symbol === 'FLNCB')
const PYPLX = RETIRED_XSTOCKS.find((r) => r.symbol === 'PYPLx')
const emekliBStock = { chainId: 56, address: BMNRB.address, symbol: BMNRB.symbol, name: BMNRB.name }
const emekliBStock2 = { chainId: 56, address: FLNCB.address, symbol: FLNCB.symbol, name: FLNCB.name }
const emekliXStock = { chainId: 56, address: PYPLX.address, symbol: PYPLX.symbol, name: PYPLX.name }
// Hisse DEGIL ve logosuz: ag desteklenmiyor, gorsel yok (tokenLogoState.test.js ile ayni kalip).
const HAYALET = { chainId: 999999, address: '0x2222222222222222222222222222222222222222', symbol: 'GHOST', name: 'Ghost' }

const HISSELER = [
    ['katalog bStock', katalogBStock],
    ['emekli bStock BMNRB', emekliBStock],
    ['emekli bStock FLNCB', emekliBStock2],
    ['emekli xStock PYPLx', emekliXStock],
]
const logosuzYap = (...rows) => { for (const r of rows) reportLogoExhausted(r, { chainId: r.chainId }) }
const bakiyeler = (map) => (row) => map[row.symbol]

describe('hideLogolessUnlessHeld -- elde tutulan tokenize hisse logosuz olsa da GIZLENMEZ (K35, K28)', () => {
    it('pozitif bekci: fikstur hisseleri logosuz sayilir (kural gercekten devrede), hayalet de', () => {
        logosuzYap(katalogBStock, emekliBStock, emekliBStock2, emekliXStock, HAYALET)
        for (const [ad, row] of HISSELER) expect(isLogoMissing(row, { chainId: row.chainId }), ad).toBe(true)
        expect(isLogoMissing(HAYALET)).toBe(true)
    })

    it.each(HISSELER)('%s: bakiye OKUNAMADI ({ error }) / henuz YUKLENMEDI (undefined) / pozitif -> satir KALIR', (_ad, row) => {
        logosuzYap(row)
        for (const kayit of [{ error: true, amount: 9 }, undefined, { amount: 5 }, '7.5', 3]) {
            expect(hideLogolessUnlessHeld([row], () => kayit), JSON.stringify(kayit)).toEqual([row])
        }
    })

    it.each(HISSELER)('%s: bakiye KESIN sifirsa (tutulmuyor) logosuz satir gizlenir (secici kalabaligi artmaz)', (_ad, row) => {
        logosuzYap(row)
        for (const kayit of [0, '0', { amount: 0 }, { amount: '0.000' }]) {
            expect(hideLogolessUnlessHeld([row], () => kayit), JSON.stringify(kayit)).toEqual([])
        }
    })

    it('hisse OLMAYAN logosuz token degismez: okunamayan, yuklenmemis ve sifir bakiye gizlenir; yalniz pozitif kalir', () => {
        logosuzYap(HAYALET)
        for (const kayit of [{ error: true, amount: 9 }, undefined, 0]) {
            expect(hideLogolessUnlessHeld([HAYALET], () => kayit), JSON.stringify(kayit)).toEqual([])
        }
        expect(hideLogolessUnlessHeld([HAYALET], () => 4)).toEqual([HAYALET])
    })

    it('karisik liste: sira korunur, yalniz hisse olmayan bakiyesiz logosuz satir dusurulur; girdi degismez', () => {
        logosuzYap(emekliBStock, HAYALET, katalogBStock)
        const rows = [HAYALET, emekliBStock, katalogBStock]
        const out = hideLogolessUnlessHeld(rows, bakiyeler({ GHOST: undefined, [BMNRB.symbol]: { error: true }, [katalogBStock.symbol]: 2 }))
        expect(out).toEqual([emekliBStock, katalogBStock])
        expect(rows).toHaveLength(3)
    })

    it('zincir adresle birlikte okunur: emekli bStocks adresi BSC disi bir zincirde hisse degildir (satir hisse korumasi almaz)', () => {
        const baskaZincir = { ...emekliBStock, chainId: 8453 }
        logosuzYap(baskaZincir)
        expect(hideLogolessUnlessHeld([baskaZincir], () => undefined)).toEqual([])
    })

    it('chainIdOf: satir chainId tasimiyorsa aktif ag ile hisse tanimi yapilir', () => {
        const ham = { address: BMNRB.address, symbol: BMNRB.symbol }
        reportLogoExhausted(ham, { chainId: 56 })
        reportLogoExhausted(ham, { chainId: 1 })
        expect(hideLogolessUnlessHeld([ham], () => undefined, { chainIdOf: () => 56 })).toEqual([ham])
        expect(hideLogolessUnlessHeld([ham], () => undefined, { chainIdOf: () => 1 })).toEqual([])
    })
})

describe('diger suzgecler degismez (kesif listeleri ve Home malvarligi)', () => {
    it('hideLogoless (Alinan / arama): logosuz hisse de gizlenir (edinme tarafi, bakiye korumasi gerektirmez)', () => {
        logosuzYap(katalogBStock, emekliBStock)
        expect(hideLogoless([katalogBStock, emekliBStock])).toEqual([])
    })

    it('hideLogolessZero (Home): yalniz KESIN sifir gizlenir; hisse icin de ayni', () => {
        logosuzYap(emekliBStock)
        expect(hideLogolessZero([emekliBStock], () => undefined)).toEqual([emekliBStock])
        expect(hideLogolessZero([emekliBStock], () => ({ error: true }))).toEqual([emekliBStock])
        expect(hideLogolessZero([emekliBStock], () => 3)).toEqual([emekliBStock])
        expect(hideLogolessZero([emekliBStock], () => 0)).toEqual([])
    })
})
