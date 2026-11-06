// Kopru MOTORU xStocks'u hem KAYNAK hem HEDEF olarak reddeder (spec 5.9, katman 2); bStocks
// KAYNAK olarak kapali, HEDEF olarak ACIK kalir (Bridge.vue 2026-10-02: LI.FI baska zincirden
// hisse almayi rotaliyor). Kapi bayraktan BAGIMSIZDIR ve LI.FI'ye HIC gitmeden calisir.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { XSTOCKS } from '../data/xStocks'
import { BSTOCKS } from '../data/bStocks'

const lifiGet = vi.hoisted(() => vi.fn())

// LI.FI'ye HIC gidilmedigini kanitlayabilmek icin axios saplanir.
vi.mock('axios', () => ({
    default: { create: () => ({ get: lifiGet }) },
}))

// HICBIR TEST AGA CIKMAZ: yalnizca JsonRpcProvider degistirilir (decimals() -> 18).
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    const coder = actual.ethers.AbiCoder.defaultAbiCoder()
    class SahteProvider {
        async call() { return coder.encode(['uint8'], [18]) }
        async resolveName(n) { return n }
    }
    return { ...actual, ethers: { ...actual.ethers, JsonRpcProvider: SahteProvider } }
})

const TSLA = XSTOCKS.find((t) => t.symbol === 'TSLAx')
const GOOGLB = BSTOCKS.find((t) => t.symbol === 'GOOGLB')
const PRIVATE_KEY = '0x' + '1'.repeat(64)
const NATIVE = { address: '0x0', decimals: 18 }

beforeEach(() => {
    lifiGet.mockReset()
    lifiGet.mockResolvedValue({ data: { action: { fromAmount: '1' } } })
})

describe('bridgeQuote - xStock kapisi', () => {
    it('Review Focus 5: xStock KAYNAK ise FIRLATIR ve LI.FI ye HIC gitmez (her listelenen zincirde)', async () => {
        const { default: bridgeQuote, BSTOCK_NOT_BRIDGEABLE } = await import('./bridge')
        for (const chainId of TSLA.chains) {
            const hedef = chainId === 1 ? 56 : 1
            await expect(bridgeQuote(
                chainId, hedef, { address: TSLA.address, decimals: 18 }, NATIVE, '1', 'RECOMMENDED', 0.5, PRIVATE_KEY,
            ), String(chainId)).rejects.toThrow(BSTOCK_NOT_BRIDGEABLE)
        }
        expect(lifiGet).not.toHaveBeenCalled()
    })

    it('kucuk harfli adres de yakalanir (kova kayitlari oyle tasiyor)', async () => {
        const { default: bridgeQuote, BSTOCK_NOT_BRIDGEABLE } = await import('./bridge')
        await expect(bridgeQuote(
            1, 56, { address: TSLA.address.toLowerCase(), decimals: 18 }, NATIVE, '1', 'RECOMMENDED', 0.5, PRIVATE_KEY,
        )).rejects.toThrow(BSTOCK_NOT_BRIDGEABLE)
    })

    it('Review Focus 5: xStock HEDEF ise de FIRLATIR ve LI.FI ye HIC gitmez', async () => {
        const { default: bridgeQuote, BSTOCK_NOT_BRIDGEABLE } = await import('./bridge')
        await expect(bridgeQuote(
            56, 1, NATIVE, { address: TSLA.address, decimals: 18 }, '1', 'RECOMMENDED', 0.5, PRIVATE_KEY,
        )).rejects.toThrow(BSTOCK_NOT_BRIDGEABLE)
        expect(lifiGet).not.toHaveBeenCalled()
    })

    it('bStock HEDEF olarak ACIK kalir (davranis degismedi)', async () => {
        const { default: bridgeQuote } = await import('./bridge')
        const quote = await bridgeQuote(
            1, 56, NATIVE, { address: GOOGLB.address, decimals: 18 }, '1', 'RECOMMENDED', 0.5, PRIVATE_KEY,
        )
        expect(quote).toEqual({ action: { fromAmount: '1' } })
        expect(lifiGet).toHaveBeenCalledTimes(1)
    })

    it('Review Focus 5: AYNI adres xStock OLMAYAN zincirde (Polygon) hedef olarak engellenmez', async () => {
        const { default: bridgeQuote } = await import('./bridge')
        const quote = await bridgeQuote(
            1, 137, NATIVE, { address: TSLA.address, decimals: 18 }, '1', 'RECOMMENDED', 0.5, PRIVATE_KEY,
        )
        expect(quote).toEqual({ action: { fromAmount: '1' } })
    })
})
