// offerable -- Hisseler listesinin SAF sulgeci (Ilk Alim Kapisi, K34, K35; Task 43).
//
// KOK NEDEN / KAPATILAN HATA SINIFLARI:
//  (1) Sulgec katalog fonksiyonlarina (stockEntry / stocksByChain) konursa TUTULAN ama uygun olmayan ihraccinin
//      hissesi okunamaz olurdu (K35): satirlar yalniz GOSTERIM kenarinda suzulur, katalog degismez;
//  (2) hisse olmayan adres icin uygunluk sorulursa (casus) kapi alakasiz bir ihracciyi yoklar;
//  (3) "ELDE O IHRACCININ satiri var mi" sorusu tum ihracci toplamina kayarsa dondurma notu yanlis ihracciya yazilir (TK7);
//  (4) Takas hedef kapsami elle listelenirse katalog buyudugunde sessizce eskir (bridgeStockChainIds kalibi).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { companyRows } from '../stocks/stockCompanies'
import { stocksByChain } from '../tokenizedStocks'
import { RETIRED_BSTOCKS } from '../../data/bStocksRetired'
import {
    offerableRows, canOfferBuy, unavailableOutput, holdsIssuer, buyRowFor, generalSwapStockChainIds,
} from './offerable'

const KAYNAK = readFileSync(fileURLToPath(new URL('./offerable.js', import.meta.url)), 'utf8')

// Gercek katalog satirlari (uydurma degil): TSLA iki ihraccida da var (bStocks BSC 56, xStocks Ethereum 1 ve BSC 56).
const TSLA = companyRows('TSLA', { xstocksEnabled: true })
const TSLA_B = TSLA.find((r) => r.issuer === 'bstocks')
const TSLA_X_ETH = TSLA.find((r) => r.issuer === 'xstocks' && r.chainId === 1)
const TSLA_X_BSC = TSLA.find((r) => r.issuer === 'xstocks' && r.chainId === 56)
const NVDA_X_BSC = companyRows('NVDA', { xstocksEnabled: true }).find((r) => r.issuer === 'xstocks' && r.chainId === 56)
// AAPL xStocks yalniz Ethereum'da: farkli ag kardesi (bStocks BSC 56 <-> xStocks Ethereum 1)
const AAPL = companyRows('AAPL', { xstocksEnabled: true })
const AAPL_B = AAPL.find((r) => r.issuer === 'bstocks')
const AAPL_X_ETH = AAPL.find((r) => r.issuer === 'xstocks' && r.chainId === 1)

const uygun = (...ihraccilar) => (issuer) => ihraccilar.includes(issuer)
const tutulan = (...satirlar) => (row) => satirlar.includes(row)

describe('offerable: offerableRows', () => {
    it('pozitif bekci: katalog satirlari gercek (TSLA iki ihraccida, BSC xStocks dahil)', () => {
        expect(TSLA_B).toBeDefined()
        expect(TSLA_X_ETH).toBeDefined()
        expect(TSLA_X_BSC).toBeDefined()
        expect(NVDA_X_BSC).toBeDefined()
        expect(AAPL_B).toBeDefined()
        expect(AAPL_X_ETH).toBeDefined()
    })

    it('uygun ya da tutulan satirlar; tutulan uygun olmayan satir korunur (K35)', () => {
        const rows = [TSLA_B, TSLA_X_ETH, TSLA_X_BSC]
        // yalniz xStocks uygun, hicbir sey tutulmuyor -> bStocks satiri duser
        expect(offerableRows(rows, { isAvailable: uygun('xstocks'), isHeld: tutulan() })).toEqual([TSLA_X_ETH, TSLA_X_BSC])
        // bStocks uygun degil AMA tutuluyor -> korunur (K35)
        expect(offerableRows(rows, { isAvailable: uygun('xstocks'), isHeld: tutulan(TSLA_B) })).toEqual(rows)
        // sira korunur
        expect(offerableRows([TSLA_X_BSC, TSLA_B], { isAvailable: uygun('bstocks', 'xstocks'), isHeld: tutulan() })).toEqual([TSLA_X_BSC, TSLA_B])
    })

    it('hicbir ihracci uygun degil ve hicbir sey tutulmuyorsa liste bos; tutulan tek satir kalir', () => {
        const rows = [TSLA_B, TSLA_X_ETH]
        expect(offerableRows(rows, { isAvailable: uygun(), isHeld: tutulan() })).toEqual([])
        expect(offerableRows(rows, { isAvailable: uygun(), isHeld: tutulan(TSLA_X_ETH) })).toEqual([TSLA_X_ETH])
    })

    it('girdi dizisini DEGISTIRMEZ ve yeni dizi doner', () => {
        const rows = [TSLA_B, TSLA_X_ETH]
        const kopya = [...rows]
        const out = offerableRows(rows, { isAvailable: uygun('bstocks', 'xstocks'), isHeld: tutulan() })
        expect(rows).toEqual(kopya)
        expect(out).not.toBe(rows)
    })
})

describe('offerable: canOfferBuy', () => {
    it('en az bir satirin ihraccisi uygunsa true; tutulan satir Al icin SAYILMAZ', () => {
        expect(canOfferBuy([TSLA_B, TSLA_X_ETH], uygun('xstocks'))).toBe(true)
        expect(canOfferBuy([TSLA_B], uygun('xstocks'))).toBe(false)
        expect(canOfferBuy([], uygun('bstocks', 'xstocks'))).toBe(false)
        expect(canOfferBuy([TSLA_B, TSLA_X_ETH], uygun())).toBe(false)
    })
})

describe('offerable: unavailableOutput', () => {
    it('hisse olmayan adres false ve isAvailable CAGRILMAZ (casus)', () => {
        const isAvailable = vi.fn(() => false)
        expect(unavailableOutput(1, '0x0000000000000000000000000000000000000001', isAvailable)).toBe(false)
        expect(unavailableOutput(56, '', isAvailable)).toBe(false)
        expect(unavailableOutput(56, undefined, isAvailable)).toBe(false)
        expect(isAvailable).not.toHaveBeenCalled()
    })

    it('emekli adres (K28, orn. PYPLx BSC) hisse sayilir: xstocks sorulur', () => {
        const PYPLX = '0xf706585e7e8900bE0267bEE3B9A2F70835EC6628'
        const isAvailable = vi.fn(() => false)
        expect(unavailableOutput(56, PYPLX, isAvailable)).toBe(true)
        expect(isAvailable).toHaveBeenCalledTimes(1)
        expect(isAvailable).toHaveBeenCalledWith('xstocks')
        expect(unavailableOutput(56, PYPLX, uygun('xstocks'))).toBe(false)
    })

    it('emekli bStocks adresi (BMNRB / FLNCB, BSC) hisse sayilir: bstocks sorulur; baska zincirde hisse degil', () => {
        for (const r of RETIRED_BSTOCKS) {
            const isAvailable = vi.fn(() => false)
            expect(unavailableOutput(56, r.address, isAvailable), r.symbol).toBe(true)
            expect(isAvailable).toHaveBeenCalledTimes(1)
            expect(isAvailable).toHaveBeenCalledWith('bstocks')
            expect(unavailableOutput(56, r.address.toLowerCase(), uygun('bstocks')), `${r.symbol} uygun`).toBe(false)
            expect(unavailableOutput(56, r.address, uygun('xstocks')), `${r.symbol} yalniz xstocks uygun`).toBe(true)
            const casus = vi.fn(() => false)
            expect(unavailableOutput(1, r.address, casus), `${r.symbol} Ethereum`).toBe(false)
            expect(casus).not.toHaveBeenCalled()
        }
    })

    it('uygun ihracci false', () => {
        expect(unavailableOutput(TSLA_B.chainId, TSLA_B.address, uygun('bstocks'))).toBe(false)
        expect(unavailableOutput(TSLA_X_ETH.chainId, TSLA_X_ETH.address, uygun('xstocks'))).toBe(false)
    })

    it('uygun olmayan true (ihracciya gore: yalniz o ihracci sorulur)', () => {
        const isAvailable = vi.fn((issuer) => issuer === 'xstocks')
        expect(unavailableOutput(TSLA_B.chainId, TSLA_B.address, isAvailable)).toBe(true)
        expect(isAvailable).toHaveBeenCalledWith('bstocks')
        expect(unavailableOutput(TSLA_X_ETH.chainId, TSLA_X_ETH.address, uygun('bstocks'))).toBe(true)
    })

    it('adres buyuk / kucuk harf duyarsiz (katalog anahtari kucuk harfe indirilir)', () => {
        expect(unavailableOutput(TSLA_B.chainId, TSLA_B.address.toLowerCase(), uygun())).toBe(true)
    })
})

describe('offerable: holdsIssuer', () => {
    it('yalniz o ihraccinin satiri tutuluyorsa true (xStocks tutulan + bstocks sorusu false)', () => {
        const rows = [TSLA_B, TSLA_X_ETH, TSLA_X_BSC]
        const isHeld = tutulan(TSLA_X_ETH)
        expect(holdsIssuer(rows, 'xstocks', isHeld)).toBe(true)
        expect(holdsIssuer(rows, 'bstocks', isHeld)).toBe(false)
    })

    it('hicbir sey tutulmuyorsa ve satir yoksa false', () => {
        expect(holdsIssuer([TSLA_B, TSLA_X_ETH], 'bstocks', tutulan())).toBe(false)
        expect(holdsIssuer([], 'bstocks', () => true)).toBe(false)
    })

    it('tutulan bStocks satiri bstocks sorusunda true', () => {
        expect(holdsIssuer([TSLA_B, TSLA_X_ETH], 'bstocks', tutulan(TSLA_B))).toBe(true)
    })
})

describe('offerable: buyRowFor', () => {
    it('current uygunsa current', () => {
        expect(buyRowFor([TSLA_B, TSLA_X_BSC], TSLA_B, uygun('bstocks', 'xstocks'))).toBe(TSLA_B)
        expect(buyRowFor([TSLA_B, TSLA_X_BSC], TSLA_X_BSC, uygun('xstocks'))).toBe(TSLA_X_BSC)
    })

    it('uygun degil + uygun kardes -> ayni sirket + ayni agdaki kardes', () => {
        expect(buyRowFor([TSLA_B, TSLA_X_BSC], TSLA_B, uygun('xstocks'))).toBe(TSLA_X_BSC)
        expect(buyRowFor([TSLA_B, TSLA_X_BSC], TSLA_X_BSC, uygun('bstocks'))).toBe(TSLA_B)
    })

    it('kardes yok -> null', () => {
        expect(buyRowFor([TSLA_B], TSLA_B, uygun('xstocks'))).toBeNull()
        expect(buyRowFor([TSLA_B, TSLA_X_BSC], TSLA_B, uygun())).toBeNull()
        expect(buyRowFor([], TSLA_B, uygun('xstocks'))).toBeNull()
        expect(buyRowFor([TSLA_B], null, uygun('bstocks'))).toBeNull()
    })

    it('farkli sirket / farkli ag satiri secilmez', () => {
        // farkli sirket: ayni agda uygun xStocks var ama baska dayanak
        expect(buyRowFor([TSLA_B, NVDA_X_BSC], TSLA_B, uygun('xstocks'))).toBeNull()
        // farkli ag: AAPL xStocks yalniz Ethereum'da, current (bStocks) BSC'de
        expect(buyRowFor([AAPL_B, AAPL_X_ETH], AAPL_B, uygun('xstocks'))).toBeNull()
        // ayni ihracci satiri (baska ag) kardes DEGIL
        expect(buyRowFor([TSLA_X_ETH, TSLA_X_BSC], TSLA_X_ETH, uygun('bstocks'))).toBeNull()
    })

    it('dayanagi olmayan satirlar birbirine eslesmez', () => {
        const a = { issuer: 'bstocks', chainId: 56, address: '0xa', underlying: undefined }
        const b = { issuer: 'xstocks', chainId: 56, address: '0xb', underlying: undefined }
        expect(buyRowFor([a, b], a, uygun('xstocks'))).toBeNull()
    })
})

describe('offerable: generalSwapStockChainIds', () => {
    afterEach(() => {
        vi.doUnmock('../featureFlags')
        vi.resetModules()
    })

    it('[56]: yalniz bStocks BSC; xStocks satirlari sayilmaz', () => {
        expect(generalSwapStockChainIds()).toEqual([56])
        // xStocks katalogda Ethereum / Arbitrum satirlari VAR ama sayilmiyor
        const xZincirler = new Set(stocksByChain({ includeXstocks: true }).filter((g) => g.rows.some((r) => r.issuer === 'xstocks')).map((g) => g.chainId))
        expect(xZincirler.has(1)).toBe(true)
        expect(generalSwapStockChainIds()).not.toContain(1)
        expect(generalSwapStockChainIds()).not.toContain(42161)
    })

    it('her cagri yeni dizi doner (disaridan degistirilemez)', () => {
        const a = generalSwapStockChainIds()
        a.push(999)
        expect(generalSwapStockChainIds()).toEqual([56])
    })

    it.each([[true], [false]])('VITE_XSTOCKS_ENABLED=%s derlemesinde de ayni', async (bayrak) => {
        vi.resetModules()
        vi.doMock('../featureFlags', async (importOriginal) => ({ ...(await importOriginal()), XSTOCKS_ENABLED: bayrak }))
        const mod = await import('./offerable')
        expect(mod.generalSwapStockChainIds()).toEqual([56])
    })
})

describe('offerable: kaynak kilidi', () => {
    const kaynak = yorumsuz(KAYNAK)

    it('SAF: vue, depo, ag ve uygunluk kancasi import edilmez', () => {
        expect(kaynak).not.toMatch(/from\s+['"]vue['"]/)
        expect(kaynak).not.toMatch(/\bchrome\./)
        expect(kaynak).not.toMatch(/\baxios\b/)
        expect(kaynak).not.toMatch(/useStockEligibility/)
        expect(kaynak).not.toMatch(/featureFlags/)
    })

    it('Takas kapsami elle liste degil: katalogdan ve isGeneralSwapOutputExcluded ile turetilir', () => {
        expect(kaynak).toContain('isGeneralSwapOutputExcluded')
        expect(kaynak).toContain('stocksByChain')
        expect(kaynak).not.toMatch(/\[\s*56\s*\]/)
    })
})
