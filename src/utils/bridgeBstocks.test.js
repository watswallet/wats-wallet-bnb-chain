// bSTOCKS KOPRU YOLUNDAN TAMAMEN DISLANDI (inceleme bulgusu I-1).
//
// Kok sorun bir ASIMETRI idi: gosterim yolu bStock'ta UI birimine gecti
// (useTokenBalance -> balanceOfUI, Bridge.vue ve bridgeFrom.vue dahil) ama
// kopru harcama yolu HAM birimde kaldi (bridge.js `parseUnits`). Bu haliyle
// MAX ile kopru ham bakiyeyi asar ve `Insufficient token balance` ile duser;
// MAX altindaki miktarlarda ise carpan kadar FAZLA token koprulenir.
//
// Cevirmek yerine dislamak secildi: spec'in kendi tespitine gore LI.FI bu
// tokenlere ROTA BULAMIYOR, yani kopru onlar icin zaten calismayan bir yol.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'

const lifiGet = vi.hoisted(() => vi.fn())

// LI.FI'ye HIC gidilmedigini kanitlayabilmek icin axios saplanir.
vi.mock('axios', () => ({
    default: { create: () => ({ get: lifiGet }) },
}))

// HICBIR TEST AGA CIKMAZ: yalnizca JsonRpcProvider degistirilir (decimals() -> 18),
// ethers'in geri kalani GERCEK kalir. Aksi halde "kapi acilmadi" vakasi gercek bir
// RPC ucuna baglanmayi denerdi.
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    const coder = actual.ethers.AbiCoder.defaultAbiCoder()
    class SahteProvider {
        async call() { return coder.encode(['uint8'], [18]) }
        async resolveName(n) { return n }
    }
    return { ...actual, ethers: { ...actual.ethers, JsonRpcProvider: SahteProvider } }
})

const here = dirname(fileURLToPath(import.meta.url))
const BRIDGE_FROM = readFileSync(join(here, '..', 'components/bridge/bridgeFrom.vue'), 'utf8')

const GOOGLB = BSTOCKS.find((t) => t.symbol === 'GOOGLB')
const PRIVATE_KEY = '0x' + '1'.repeat(64)
const NATIVE = { address: '0x0', decimals: 18 }

beforeEach(() => {
    lifiGet.mockReset()
    lifiGet.mockResolvedValue({ data: { action: { fromAmount: '1' } } })
})

describe('bridgeQuote - bStock kapisi', () => {
    it('bStock girdisinde FIRLATIR ve LI.FI ye HIC gitmez', async () => {
        const { default: bridgeQuote, BSTOCK_NOT_BRIDGEABLE } = await import('./bridge')

        await expect(bridgeQuote(
            BSTOCKS_CHAIN_ID, 1, { address: GOOGLB.address, decimals: 18 }, NATIVE,
            '1', 'RECOMMENDED', 0.5, PRIVATE_KEY,
        )).rejects.toThrow(BSTOCK_NOT_BRIDGEABLE)

        expect(lifiGet).not.toHaveBeenCalled()
    })

    it('kucuk harfli adres de yakalanir (kova kayitlari oyle tasiyor)', async () => {
        const { default: bridgeQuote, BSTOCK_NOT_BRIDGEABLE } = await import('./bridge')

        await expect(bridgeQuote(
            BSTOCKS_CHAIN_ID, 1, { address: GOOGLB.address.toLowerCase(), decimals: 18 }, NATIVE,
            '1', 'RECOMMENDED', 0.5, PRIVATE_KEY,
        )).rejects.toThrow(BSTOCK_NOT_BRIDGEABLE)
    })

    // bStocks YALNIZCA 56'da yasiyor. Ayni adres baska bir zincirde bambaska bir
    // kontrat olabilir; orada bu kapi ACILMAMALI.
    it('BASKA ZINCIRDE ayni adres kapiya TAKILMAZ', async () => {
        const { default: bridgeQuote } = await import('./bridge')

        const quote = await bridgeQuote(
            1, 56, { address: GOOGLB.address, decimals: 18 }, NATIVE,
            '1', 'RECOMMENDED', 0.5, PRIVATE_KEY,
        )

        expect(quote).toEqual({ action: { fromAmount: '1' } })
        expect(lifiGet).toHaveBeenCalledTimes(1)
    })

    it('bStock OLMAYAN girdi normal akisina devam eder', async () => {
        const { default: bridgeQuote } = await import('./bridge')

        // Native girdi: kontrat okumasi yapilmaz, yani ag'a hic dokunulmaz.
        const quote = await bridgeQuote(
            BSTOCKS_CHAIN_ID, 1, NATIVE, NATIVE, '1', 'RECOMMENDED', 0.5, PRIVATE_KEY,
        )

        expect(quote).toEqual({ action: { fromAmount: '1' } })
        expect(lifiGet).toHaveBeenCalledTimes(1)
    })
})

// Kapi bridgeQuote'ta; buradaki filtre kullaniciyi olu bir yola HIC sokmamak icin.
// Ikisi birden gerekli: token `crypto.bridge.inToken`a secici DISINDAN da girebilir.
describe('bridgeFrom.vue - bStock satirlari secicide gorunmez', () => {
    it('mergedTokens bStock satirlarini eler', () => {
        expect(BRIDGE_FROM).toMatch(/import\s*\{\s*isBStock\s*\}\s*from\s*'\.\.\/\.\.\/utils\/bstocks'/)

        const merged = BRIDGE_FROM.match(/const mergedTokens = computed\(\(\) => \{([\s\S]*?)\n\}\)/)
        expect(merged, 'mergedTokens govdesi bulunamadi').toBeTruthy()
        expect(merged[1]).toMatch(/if \(isBStock\(token\.chainId, token\.address\)\) return/)
    })
})
