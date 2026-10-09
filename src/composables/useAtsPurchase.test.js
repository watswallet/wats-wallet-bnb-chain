// "ATS Al" kisayolu (spec docs/superpowers/specs/2026-10-04-ats-satin-alma-design.md §6.4).
// Ag degisimi applyNetworkChange'in GERCEK yan etkisiyle (secili takas tokenlerini SIFIRLAR)
// taklit edilir: tokenler agdan ONCE yazilsaydi o sifirlama secimi silerdi.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const applyNetworkChange = vi.hoisted(() => vi.fn())
vi.mock('../utils/applyNetworkChange', () => ({ applyNetworkChange: (...a) => applyNetworkChange(...a) }))
const useTokenBalance = vi.hoisted(() => vi.fn())
vi.mock('./useTokenBalance', () => ({ useTokenBalance: (...a) => useTokenBalance(...a) }))

import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { pageStore } from '../store/pageStore'
import supported_chains from '../data/supported_chains.json'
import { reconcileSwapToken } from '../utils/swapTokenState'
import { isAtsSaleLive } from '../utils/atsSaleConfig'
import {
    openAtsPurchase, pickPayToken, salePayRecord, ATS_SALE_OUT_RECORD, PAY_PICK_TIMEOUT_MS,
    openAtsPurchaseWindow, isAtsPurchaseLaunch, useAtsPurchase,
} from './useAtsPurchase'

const BSC = supported_chains.find((c) => c.chainId === 56)
const POLYGON = supported_chains.find((c) => c.chainId === 137)
const HESAP = { key: 'k1', type: 'hd', address: '0xAbCdEf0000000000000000000000000000000001' }
const USDT = '0x55d398326f99059fF775485246999027B3197955'
const USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
const ATS = '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d'
const t = (k) => k

// Sembol -> bakiye: sayi, Error (okuma duser) ya da 'asili' (hic donmez).
let bakiye
const sembolu = (adres) => ({ [USDT.toLowerCase()]: 'USDT', [USDC.toLowerCase()]: 'USDC', '0x0': 'BNB' })[String(adres).toLowerCase()]

beforeEach(async () => {
    setActivePinia(createPinia())
    globalThis.chrome = {
        storage: { local: { get: vi.fn(async () => ({ active_account: HESAP })), set: vi.fn(async () => {}) } },
        runtime: { sendMessage: vi.fn(async () => ({})), getURL: (p) => `chrome-extension://wats/${p}` },
        windows: { create: vi.fn(async () => ({ id: 9 })) },
    }
    networkStore()
    await new Promise((r) => setTimeout(r, 0))   // initializeCurrentNetwork bitsin
    networkStore().currentNetwork = POLYGON
    networkStore().rpc = 'https://polygon.example'
    bakiye = { USDT: 0, USDC: 0, BNB: 0 }
    useTokenBalance.mockReset()
    useTokenBalance.mockImplementation(async (adres, tokenAdresi) => {
        const b = bakiye[sembolu(tokenAdresi)]
        if (b === 'asili') return new Promise(() => {})
        if (b instanceof Error) throw b
        return b
    })
    applyNetworkChange.mockReset()
    applyNetworkChange.mockImplementation(async (chain) => {
        // GERCEK applyNetworkChange'in yan etkisi: ag degisir, secili takas tokenleri SIFIRLANIR.
        networkStore().currentNetwork = chain
        networkStore().rpc = 'https://bsc.example'
        cryptoStore().swap.inToken = null
        cryptoStore().swap.outToken = null
        return true
    })
})

afterEach(() => {
    vi.useRealTimers()
    delete globalThis.chrome
})

describe('openAtsPurchase -- once ag, sonra tokenler (spec §6.4)', () => {
    it('BSC disindan: ag BSC ye gecer (takas akisi), SONRA USDT -> ATS secilir ve takas acilir', async () => {
        bakiye.USDT = 10
        expect(await openAtsPurchase({ t })).toBe(true)
        expect(applyNetworkChange).toHaveBeenCalledTimes(1)
        const [zincir, ceviri, secenek] = applyNetworkChange.mock.calls[0]
        expect(zincir.chainId).toBe(56)
        expect(ceviri).toBe(t)
        expect(secenek).toEqual({ flow: 'swap' })
        // Bakiyeler YENI agin RPC'sinden okundu: ag once degisti.
        expect(useTokenBalance).toHaveBeenCalledWith(HESAP.address, USDT, 'https://bsc.example', 56)
        expect(cryptoStore().swap.inToken.address).toBe(USDT)
        expect(cryptoStore().swap.outToken.address).toBe(ATS)
        expect(pageStore().currentPage).toBe('swap')
    })

    it('zaten BSC de: ag degistirilmez', async () => {
        networkStore().currentNetwork = BSC
        networkStore().rpc = 'https://bsc.example'
        bakiye.USDT = 3
        await openAtsPurchase({ t })
        expect(applyNetworkChange).not.toHaveBeenCalled()
        expect(cryptoStore().swap.inToken.address).toBe(USDT)
        expect(pageStore().currentPage).toBe('swap')
    })

    it('ag gecisi reddedilirse (TON hesabi, RPC yok) satin alma ekrani ACILMAZ', async () => {
        applyNetworkChange.mockResolvedValueOnce(false)
        pageStore().currentPage = 'home'
        expect(await openAtsPurchase({ t })).toBe(false)
        expect(pageStore().currentPage).toBe('home')
        expect(cryptoStore().swap.outToken).toBeNull()
    })
})

describe('odeme tokeni: bakiyesi olan ILK token (USDT > USDC > BNB), yoksa USDT', () => {
    it.each([
        [{ USDT: 0, USDC: 5, BNB: 1 }, 'USDC'],
        [{ USDT: 2, USDC: 5, BNB: 1 }, 'USDT'],
        [{ USDT: 0, USDC: 0, BNB: 0.3 }, 'BNB'],
        [{ USDT: 0, USDC: 0, BNB: 0 }, 'USDT'],
    ])('%o -> %s', async (b, beklenen) => {
        bakiye = b
        await openAtsPurchase({ t })
        expect(cryptoStore().swap.inToken.symbol.toUpperCase()).toBe(beklenen)
    })

    it('BNB secilirse zincirin native kaydi (adres 0x0)', async () => {
        bakiye = { USDT: 0, USDC: 0, BNB: 1 }
        await openAtsPurchase({ t })
        expect(cryptoStore().swap.inToken.address).toBe('0x0')
    })

    it('okunamayan bakiye 0 sayilir', async () => {
        bakiye = { USDT: new Error('rpc'), USDC: 4, BNB: 0 }
        await openAtsPurchase({ t })
        expect(cryptoStore().swap.inToken.address).toBe(USDC)
    })

    it('okuma ASILIRSA ekran bekletilmez: sure dolunca USDT', async () => {
        vi.useFakeTimers()
        bakiye = { USDT: 'asili', USDC: 'asili', BNB: 'asili' }
        const acilis = openAtsPurchase({ t })
        await vi.advanceTimersByTimeAsync(PAY_PICK_TIMEOUT_MS)
        expect(await acilis).toBe(true)
        expect(cryptoStore().swap.inToken.address).toBe(USDT)
    })

    // Sure TOKEN BASINA isler: asili bir okuma (0 sayilir) cevap veren digerlerinin sonucunu
    // silmemeli. Butun kume tek sureye yarissaydi sonuc bos kalir, USDC yerine USDT secilirdi.
    it('bir token asilirsa yalniz o 0 sayilir; cevap veren USDC secilir', async () => {
        vi.useFakeTimers()
        bakiye = { USDT: 'asili', USDC: 4, BNB: 1 }
        const acilis = openAtsPurchase({ t })
        await vi.advanceTimersByTimeAsync(PAY_PICK_TIMEOUT_MS)
        expect(await acilis).toBe(true)
        expect(cryptoStore().swap.inToken.address).toBe(USDC)
    })

    it('pickPayToken saf kural', () => {
        expect(pickPayToken([{ symbol: 'BNB', balance: 1 }, { symbol: 'USDC', balance: 2 }])).toBe('USDC')
        expect(pickPayToken([])).toBe('USDT')
        expect(pickPayToken(null)).toBe('USDT')
    })
})

describe('token kayitlari', () => {
    it('ATS hedef kaydi', () => {
        expect(ATS_SALE_OUT_RECORD).toMatchObject({ symbol: 'ats', address: ATS, decimals: 18, chainId: 56, logoURI: '/ats.png' })
    })

    it('USDT/USDC kayitlari 18 ondalik, BSC ve logolu', () => {
        expect(salePayRecord('USDT')).toMatchObject({ symbol: 'usdt', address: USDT, decimals: 18, chainId: 56, coingecko_id: 'tether' })
        expect(salePayRecord('USDC')).toMatchObject({ symbol: 'usdc', address: USDC, decimals: 18, chainId: 56, coingecko_id: 'usd-coin' })
        expect(salePayRecord('USDT').image.large).toBe('https://coin-images.coingecko.com/coins/images/325/large/Tether.png')
        expect(salePayRecord('USDC').image.thumb).toBe('https://coin-images.coingecko.com/coins/images/6319/thumb/usdc.png')
    })

    it('Swap acilisindaki uzlasma (reconcileSwapToken) kayitlari BSC de KORUR', () => {
        for (const s of ['USDT', 'USDC', 'BNB']) {
            const { token, reason } = reconcileSwapToken(salePayRecord(s), 56)
            expect(reason).toBeNull()
            expect(token.address).toBe(salePayRecord(s).address)
        }
    })
})

describe('dapp onay penceresinden: satin alma penceresi', () => {
    it('ayri cuzdan penceresi ?ats-purchase=1#window ile acilir', async () => {
        await openAtsPurchaseWindow()
        expect(globalThis.chrome.windows.create).toHaveBeenCalledWith({
            url: 'chrome-extension://wats/src/popup/index.html?ats-purchase=1#window',
            type: 'popup', width: 360, height: 600, focused: true,
        })
    })

    it('isAtsPurchaseLaunch yalniz ?ats-purchase=1', () => {
        expect(isAtsPurchaseLaunch({ search: '?ats-purchase=1' })).toBe(true)
        expect(isAtsPurchaseLaunch({ search: '?ats-purchase=0' })).toBe(false)
        expect(isAtsPurchaseLaunch({ search: '' })).toBe(false)
        expect(isAtsPurchaseLaunch(null)).toBe(false)
    })
})

describe('useAtsPurchase', () => {
    // `live` derlemenin ayarini AYNEN tasir (bugun false; Task 16'dan sonra true) -- test iki
    // durumda da gecerli kalsin diye sabit bir degerle degil kaynagiyla karsilastirilir.
    it('live satis ayarini tasir; open() ceviriyle satin almayi acar', async () => {
        const { createSSRApp, defineComponent, h } = await import('vue')
        const { renderToString } = await import('vue/server-renderer')
        const { createTestI18n } = await import('../test-utils/ssrRender.js')
        let api
        const Kap = defineComponent({ setup() { api = useAtsPurchase(); return () => h('div') } })
        const app = createSSRApp(Kap)
        app.use(createTestI18n())
        await renderToString(app)
        expect(api.live).toBe(isAtsSaleLive())
        bakiye.USDC = 1
        expect(await api.open()).toBe(true)
        expect(applyNetworkChange.mock.calls[0][1]).toEqual(expect.any(Function))
        expect(cryptoStore().swap.inToken.address).toBe(USDC)
        expect(pageStore().currentPage).toBe('swap')
    })
})
