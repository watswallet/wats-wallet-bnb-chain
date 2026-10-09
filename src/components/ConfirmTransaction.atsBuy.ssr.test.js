// "ATS Al" -- gonderme onayinin buy-ats yerleri (spec §6.4): engel karti (teklif reddedildi, eksik
// miktar bilinmiyor) ve EVM ucret kartindaki eksik-ATS bolumu. Ikisi ayni anda cizilmez; dugme TEK.
// Satis kapaliyken dugme HIC yok. Zincir okumalari ConfirmTransaction.atsKilit.ssr.test.js'teki gibi
// saplanir; yakit bakiyesi (useAtsFuel) testin sectigi deger.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const satis = vi.hoisted(() => ({ acik: true }))
const acilis = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../composables/useAtsPurchase', () => ({
    useAtsPurchase: () => ({ live: satis.acik, open: acilis }),
}))

const yakit = vi.hoisted(() => ({ bakiye: null }))
vi.mock('../composables/useAtsFuel', async () => {
    const { ref } = await import('vue')
    return {
        useAtsFuel: () => ({
            balance: ref(yakit.bakiye), symbol: ref('ATS'), loading: ref(false), stale: ref(false),
            feePerOp: ref(null), level: ref('unknown'), opsLeft: ref(null), display: ref('—'), exact: ref('—'),
            load: async () => {}, refresh: async () => {}, setChain: async () => {},
        }),
    }
})

vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    class SahteSaglayici {
        async getBalance() { return 10n ** 18n }
        async estimateGas() { return 65000n }
        async getFeeData() { return { maxFeePerGas: 1n, gasPrice: 1n, maxPriorityFeePerGas: 1n } }
        async getNetwork() { return { chainId: 56n } }
    }
    return { ...actual, JsonRpcProvider: SahteSaglayici, ethers: { ...actual.ethers, JsonRpcProvider: SahteSaglayici } }
})
vi.mock('../utils/buildTransaction', () => ({
    buildTransaction: async ({ to, asset }) => ({ to: asset || to, value: 0n, data: '0xa9059cbb' }),
}))
vi.mock('../utils/historyRecipients', () => ({ fetchHistoryCounterparties: async () => [] }))
vi.mock('axios', () => ({
    default: { post: vi.fn(async () => ({ status: 200, data: {} })), get: vi.fn(async () => ({ status: 200, data: {} })) },
}))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { pageStore } from '../store/pageStore'
import ConfirmTransaction from './ConfirmTransaction.vue'
import supported_chains from '../data/supported_chains.json'

const BSC = supported_chains.find((c) => Number(c.chainId) === 56)
const FROM = '0xAbCdEf0000000000000000000000000000000001'
const TO = '0x2222222222222222222222222222222222222222'
const GOOGLB = '0x3F53De71c126BdaBAe20f9cD64848d317f6C3238'
const HISSE = { address: GOOGLB, decimals: 18, symbol: 'GOOGLB', name: 'Alphabet' }

const BUY_ATS = { action: 'buy-ats', severity: 'user', i18nKey: 'send.confirmTransaction.atsBalanceMissing' }
// Teklif REDDEDILDI: ucret yok, eksik miktar hesaplanamaz -> engel karti anlatir.
const RED = { success: false, code: 'balance-missing', error: 'ATS yok', httpStatus: 409 }
// Teklif var ama bakiye yetmiyor: eksik-ATS bolumu ucret kartinin icinde.
const EKSIK_TEKLIF = {
    success: true, ready: true, mode: 'normal', isCrosschain: false, nextSteps: [], opCount: 1, needsTopUp: false,
    transferFee: 20.487605, atsBalance: 2.080255, symbol: 'ATS', decision: BUY_ATS,
}

const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const kacKez = (html, metin) => html.split(metin).length - 1
const DUGME = 'Buy ATS'

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
    acilis.mockClear()
    satis.acik = true
    yakit.bakiye = null
})

async function ekraniKur({ teklif, bakiye = null }) {
    yakit.bakiye = bakiye
    const stub = installChromeStub({
        active_account: { key: 'k1', address: FROM, name: 'A', type: 'hd', derivationPath: "m/44'/60'/0'/0/0" },
        vaults: [],
    })
    stub.setSendMessage(async (m) => (m?.type === 'ATS_FEE_QUOTE' ? teklif : { success: false }))

    const pinia = createTestPinia()
    const network = networkStore()
    network.currentNetwork = BSC
    network.rpc = 'https://bsc.example'
    const crypto = cryptoStore()
    crypto.sendAsset = HISSE
    crypto.transactionData = { from: FROM, to: TO, amount: '1', asset: GOOGLB, network: BSC.name }
    pageStore().currentPage = 'confirmTransaction'

    const app = createApp(ConfirmTransaction, { use: [pinia, createTestI18n()] })
    const holder = captureInstance(app, 'ConfirmTransaction')
    const dugme = captureInstance(app, 'AtsBuyButton')
    const html = gorunen(await render(app))
    return { html, state: holder.instance.setupState, dugme: dugme.instance }
}

describe('ConfirmTransaction.vue (SSR) -- buy-ats yerlerinde "ATS Al"', () => {
    it('engel kartinda: dugme cizilir ve satin alma ekranini acar', async () => {
        const { html, state, dugme } = await ekraniKur({ teklif: RED })
        expect(state.isAtsTransfer).toBe(true)
        expect(state.feeDecision.action).toBe('buy-ats')
        expect(state.showAtsShortfall).toBe(false)
        expect(html).toContain('ATS balance required')
        expect(kacKez(html, DUGME)).toBe(1)
        await dugme.setupState.onClick()
        expect(acilis).toHaveBeenCalledTimes(1)
    })

    it('ucret kartindaki eksik-ATS bolumunde: dugme TEK kez', async () => {
        const { html, state } = await ekraniKur({ teklif: EKSIK_TEKLIF, bakiye: 2.080255 })
        expect(state.showAtsShortfall).toBe(true)
        expect(html).toContain('Missing balance')
        expect(kacKez(html, DUGME)).toBe(1)
    })

    it('satis KAPALI: iki yerde de dugme YOK (kartlar yine cizilir)', async () => {
        satis.acik = false
        const engel = await ekraniKur({ teklif: RED })
        // Pozitif kontrol: kart cizildi (bos sayfa "dugme yok" testini bosuna gecirmesin).
        expect(engel.html).toContain('ATS balance required')
        expect(engel.html).not.toContain(DUGME)
        const eksik = await ekraniKur({ teklif: EKSIK_TEKLIF, bakiye: 2.080255 })
        expect(eksik.state.showAtsShortfall).toBe(true)
        expect(eksik.html).toContain('Missing balance')
        expect(eksik.html).not.toContain(DUGME)
    })
})
