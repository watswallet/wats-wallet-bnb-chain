// "ATS Al" -- DAPP ONAY PENCERESINDE (spec §6.4; Review Focus 5).
//
// Onay penceresi bekleyen istege bagli ayri bir penceredir ve ag degisimi (uiSync) her arayuze
// yayilir: satin alma BURADA yapilsaydi onay ekrani BSC'yi benimser, dapp'in cagrisi yanlis zincirde
// imzalanabilirdi. Bu yuzden dugme satin almayi AYRI bir cuzdan penceresinde acar ve bekleyen istegi
// 4001 ile REDDEDER. Sira: once pencere, sonra ret (ret bu pencereyi kapatir).
// Zincir okumalari Dapp.ats.ssr.test.js'teki gibi saplanir.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Yalniz `useAtsPurchase` sabitlenir; openAtsPurchaseWindow GERCEK (chrome.windows.create'i olcmek icin).
const satis = vi.hoisted(() => ({ acik: true }))
const acilis = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../composables/useAtsPurchase', async (importOriginal) => ({
    ...(await importOriginal()),
    useAtsPurchase: () => ({ live: satis.acik, open: acilis }),
}))

vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    class SahteSaglayici {
        constructor(url) { this.url = url }
        async getBalance() { return 0n }
        async getTransactionCount() { return 0 }
        async estimateGas() { return 50000n }
        async getFeeData() { return { maxFeePerGas: 1n, gasPrice: 1n, maxPriorityFeePerGas: 1n } }
        async call() { return '0x' }
        async getNetwork() { return { chainId: 56n } }
    }
    return { ...actual, ethers: { ...actual.ethers, JsonRpcProvider: SahteSaglayici } }
})
vi.mock('axios', () => ({
    default: {
        post: vi.fn(async () => ({ status: 200, data: {} })),
        get: vi.fn(async () => ({ data: {} })),
    },
}))

import { ethers as realEthers } from 'ethers'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import Dapp from './Dapp.vue'
import supported_chains from '../data/supported_chains.json'

const BSC = supported_chains.find((c) => Number(c.chainId) === 56)
const SIGNER = realEthers.getAddress('0xabcdef0000000000000000000000000000000001')
const SIGNER_ACCOUNT = { key: 'k1', address: SIGNER, name: 'Hesap 1', type: 'hd', derivationPath: "m/44'/60'/0'/0/0" }
const RECIPIENT = realEthers.getAddress('0x2222222222222222222222222222222222222222')

const BUY_ATS = { action: 'buy-ats', severity: 'user', i18nKey: 'send.confirmTransaction.atsBalanceMissing' }
const HAZIR_TEKLIF = {
    success: true, ready: true, mode: 'normal', isCrosschain: false,
    nextSteps: [], opCount: 1, needsTopUp: false,
    transferFee: 2.5, atsBalance: 100, symbol: 'ATS',
}
// Bakiye biliniyor: eksik-ATS bolumu ucret kartinin icinde.
const EKSIK_TEKLIF = { ...HAZIR_TEKLIF, transferFee: 20.487605, atsBalance: 2.080255, decision: BUY_ATS }
// Bakiye okunamadi: engel karti anlatir.
const KARAR_TEKLIFI = { ...HAZIR_TEKLIF, ready: false, decision: BUY_ATS }

const DUGME = 'Buy ATS'
const NOT = 'This request will be cancelled; start it again after buying ATS.'
const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const kacKez = (html, metin) => html.split(metin).length - 1

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
    acilis.mockClear()
    satis.acik = true
})

async function ciz({ teklif, yakitBakiyesi }) {
    // Tek sira: arka plana giden mesajlar ve pencere acilisi AYNI listeye yazilir.
    const olaylar = []
    const stub = installChromeStub({
        currentNetwork: BSC,
        current_request: {
            type: 'SEND_TX', id: 'req-ats-1', origin: 'https://dapp.example', favicon: '',
            txData: { from: SIGNER, to: RECIPIENT, amount: '0x0', data: '0x' },
        },
        active_account: SIGNER_ACCOUNT,
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [SIGNER_ACCOUNT] }],
        dapps: {},
    })
    stub.setSendMessage(async (msg) => {
        olaylar.push(msg)
        if (msg.type === 'ATS_FEE_QUOTE') return teklif
        if (msg.type === 'ATS_FUEL_BALANCE') return { success: true, balance: yakitBakiyesi, symbol: 'ATS' }
        return {}
    })
    globalThis.chrome.storage.local.remove = async (key) => { delete stub.localStore[key] }
    globalThis.chrome.runtime.getURL = (p) => `chrome-extension://wats/${p}`
    globalThis.chrome.windows = {
        create: vi.fn(async (secenek) => { olaylar.push({ type: 'PENCERE', secenek }); return { id: 9 } }),
    }

    const app = createApp(Dapp)
    app.use(createTestPinia())
    app.use(createTestI18n())
    networkStore().currentNetwork = BSC
    pageStore().currentPage = 'dapp'

    const holder = captureInstance(app, 'Dapp')
    const dugme = captureInstance(app, 'AtsBuyButton')
    const html = gorunen(await render(app))
    return { html, state: holder.instance.setupState, dugme: dugme.instance, olaylar }
}

describe('Dapp.vue (SSR) -- "ATS Al" dugmesi', () => {
    it('eksik-ATS bolumunde: dugme ve iptal notu TEK kez', async () => {
        const { html, state } = await ciz({ teklif: EKSIK_TEKLIF, yakitBakiyesi: 2.080255 })
        expect(state.showAtsShortfall).toBe(true)
        expect(html).toContain('Missing balance')
        expect(kacKez(html, DUGME)).toBe(1)
        expect(kacKez(html, NOT)).toBe(1)
    })

    it('engel kartinda (bakiye okunamadi): dugme ve iptal notu', async () => {
        const { html, state } = await ciz({ teklif: KARAR_TEKLIFI, yakitBakiyesi: null })
        expect(state.showAtsShortfall).toBe(false)
        expect(html).toContain('ATS balance required')
        expect(kacKez(html, DUGME)).toBe(1)
        expect(html).toContain(NOT)
    })

    it('satis KAPALI: dugme ve not YOK', async () => {
        satis.acik = false
        const { html, state } = await ciz({ teklif: EKSIK_TEKLIF, yakitBakiyesi: 2.080255 })
        // Pozitif kontrol: kart cizildi (eksik-ATS bolumu var), yalniz dugme ve not yok -- bos gecmesin.
        expect(state.showAtsShortfall).toBe(true)
        expect(html).toContain('Missing balance')
        expect(html).not.toContain(DUGME)
        expect(html).not.toContain(NOT)
    })

    // Ikinci kart bicimi: bakiye OKUNAMADI, engel karti anlatir. Bayrak kapaliyken bu kart da bugunku
    // gibi yalniz metin olmali (kabul olcutu).
    it('satis KAPALI, engel karti: "ATS balance required" cizilir, dugme ve not YOK', async () => {
        satis.acik = false
        const { html, state } = await ciz({ teklif: KARAR_TEKLIFI, yakitBakiyesi: null })
        expect(state.showAtsShortfall).toBe(false)
        // Pozitif kontrol: engel karti GERCEKTEN cizildi.
        expect(html).toContain('ATS balance required')
        expect(html).not.toContain(DUGME)
        expect(html).not.toContain(NOT)
    })
})

describe('Dapp.vue -- "ATS Al" tiklamasi (Review Focus 5)', () => {
    it('ONCE satin alma penceresi, SONRA istek 4001 ile reddedilir; onay penceresi ag DEGISTIRMEZ', async () => {
        const { dugme, olaylar } = await ciz({ teklif: EKSIK_TEKLIF, yakitBakiyesi: 2.080255 })
        await dugme.setupState.onClick()

        const pencere = olaylar.findIndex((o) => o.type === 'PENCERE')
        const ret = olaylar.findIndex((o) => o.type === 'SEND_TX_REJECTED')
        expect(pencere).toBeGreaterThan(-1)
        expect(ret).toBeGreaterThan(pencere)
        expect(olaylar[pencere].secenek).toMatchObject({
            url: 'chrome-extension://wats/src/popup/index.html?ats-purchase=1#window', type: 'popup',
        })
        expect(olaylar[ret]).toMatchObject({
            requestId: 'req-ats-1', status: 'error', error: { code: 4001, message: 'Transaction cancelled by user.' },
        })
        // Bu pencerede satin alma (ag gecisi) CALISMAZ; islem de gonderilmez.
        expect(acilis).not.toHaveBeenCalled()
        expect(olaylar.some((o) => o.type === 'SEND_TRANSACTION')).toBe(false)
        expect(pageStore().currentPage).toBe('home')
    })

    it('pencere acilamazsa istek REDDEDILMEZ (kullanici onay ekraninda kalir)', async () => {
        const { dugme, olaylar } = await ciz({ teklif: EKSIK_TEKLIF, yakitBakiyesi: 2.080255 })
        globalThis.chrome.windows.create = vi.fn(async () => { throw new Error('windows kapali') })
        await dugme.setupState.onClick()
        expect(olaylar.some((o) => o.type === 'SEND_TX_REJECTED')).toBe(false)
        expect(pageStore().currentPage).toBe('dapp')
    })
})
