// Genel Takas MOTORU xStocks'u ag cagrisindan ONCE reddeder (spec 5.9, katman 2).
//
// Secici filtreleri (Task 6) tek basina yetmez: eski oturumdan kalan secim, dogrudan cagri ya da
// baska bir yol xStock'u motora sokabilir. Kapi motorun UC giris noktasinda (buildSwapCalls,
// executeSwap, getExpectedOutput) ve HICBIR ag cagrisindan once calisir. Kapi bayraktan BAGIMSIZDIR.
import { describe, it, expect } from 'vitest'
import { MultiChainSwapManager, XSTOCK_USE_COW } from './swap'
import { XSTOCKS } from '../data/xStocks'
import { BSTOCKS } from '../data/bStocks'

const TSLA = XSTOCKS.find((s) => s.symbol === 'TSLAx')
// Katalogda yalniz tek zincirli bir hisse (G2: sabit sembole baglanmaz, katalogdan secilir).
const TEK_ZINCIRLI = XSTOCKS.find((s) => s.chains.length === 1)
const GOOGLB = BSTOCKS.find((s) => s.symbol === 'GOOGLB')
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955'

// Ag cagrisi yapan her kapi TUZAGA cevrilir: kapi calisirsa HICBIRI cagrilmaz.
function kur(chainId) {
    const manager = new MultiChainSwapManager('0x' + '1'.repeat(64), chainId)
    const agCagrilari = []
    const tuzak = (ad) => async () => { agCagrilari.push(ad); throw new Error(`ag cagrisi yapilmamaliydi: ${ad}`) }
    manager.getProvider = () => { agCagrilari.push('getProvider'); throw new Error('provider olusturulmamaliydi') }
    manager.getTokenDecimals = tuzak('getTokenDecimals')
    manager.findBestDexRoute = tuzak('findBestDexRoute')
    manager.getTokenSymbol = tuzak('getTokenSymbol')
    manager.getTokenBalance = tuzak('getTokenBalance')
    return { manager, agCagrilari }
}

const GIRIS_NOKTALARI = [
    ['buildSwapCalls', (m, girdi, cikti) => m.buildSwapCalls(girdi, cikti, '1', '1')],
    ['executeSwap', (m, girdi, cikti) => m.executeSwap(girdi, cikti, '1', '1')],
    ['getExpectedOutput', (m, girdi, cikti) => m.getExpectedOutput(girdi, cikti, '1', '1')],
]

describe('Takas motoru - xStock kapisi', () => {
    it('XSTOCK_USE_COW sabiti ve mesaj bicimi: tam olarak "XSTOCK_USE_COW: <xStock adresi>"', async () => {
        expect(XSTOCK_USE_COW).toBe('XSTOCK_USE_COW')
        const { manager } = kur(1)
        await expect(manager.buildSwapCalls(TSLA.address, USDC_ETH, '1', '1'))
            .rejects.toThrow(new Error(`XSTOCK_USE_COW: ${TSLA.address}`))
    })

    for (const chainId of TSLA.chains) {
        for (const [ad, cagir] of GIRIS_NOKTALARI) {
            it(`Review Focus 5: ${ad} zincir ${chainId}: xStock GIRDI ise ag cagrisindan ONCE reddeder`, async () => {
                const { manager, agCagrilari } = kur(chainId)
                await expect(cagir(manager, TSLA.address, USDC_ETH)).rejects.toThrow(XSTOCK_USE_COW)
                expect(agCagrilari).toEqual([])
            })

            it(`Review Focus 5: ${ad} zincir ${chainId}: xStock CIKTI ise de reddeder`, async () => {
                const { manager, agCagrilari } = kur(chainId)
                await expect(cagir(manager, USDC_ETH, TSLA.address.toLowerCase())).rejects.toThrow(XSTOCK_USE_COW)
                expect(agCagrilari).toEqual([])
            })
        }
    }

    // Karar A-1: kapi `chains`e degil var olunan bes zincire bakar. Hissenin chains'inde olmayan
    // ama tokenin var oldugu bir zincirde (BSC) de reddedilir.
    it('A-1: hissenin chains listesinde OLMAYAN ama tokenin var oldugu zincirde (BSC) de reddeder', async () => {
        expect(TEK_ZINCIRLI, 'katalogda tek zincirli hisse yok').toBeTruthy()
        expect(TEK_ZINCIRLI.chains).not.toContain(56)
        for (const [, cagir] of GIRIS_NOKTALARI) {
            const { manager, agCagrilari } = kur(56)
            await expect(cagir(manager, TEK_ZINCIRLI.address, USDT_BSC)).rejects.toThrow(XSTOCK_USE_COW)
            expect(agCagrilari).toEqual([])
        }
    })

    // Kapi zincire duyarli: ayni adres katalogda olmayan zincirde (Polygon) xStock DEGILDIR.
    it('Review Focus 5: AYNI adres xStock OLMAYAN zincirde engellenmez (kapi gecer, ilk ag cagrisina ulasilir)', async () => {
        const { manager, agCagrilari } = kur(137)
        await expect(manager.buildSwapCalls(TSLA.address, USDC_ETH, '1', '1')).rejects.toThrow('ag cagrisi yapilmamaliydi: getTokenDecimals')
        expect(agCagrilari).toEqual(['getTokenDecimals'])
    })

    // bStocks genel Takas'ta KALIR (PancakeSwap rotasi gercek; spec karari).
    it('bStock genel Takas motorunda ENGELLENMEZ', async () => {
        const { manager, agCagrilari } = kur(56)
        await expect(manager.buildSwapCalls(GOOGLB.address, USDT_BSC, '1', '1')).rejects.toThrow('ag cagrisi yapilmamaliydi: getTokenDecimals')
        expect(agCagrilari).toEqual(['getTokenDecimals'])
    })

    it('native girdi/cikti ("0x0") kapiya takilmaz', async () => {
        const { manager } = kur(1)
        await expect(manager.buildSwapCalls('0x0', USDC_ETH, '1', '1')).rejects.toThrow('ag cagrisi yapilmamaliydi: getTokenDecimals')
    })
})
