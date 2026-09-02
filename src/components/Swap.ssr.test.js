// Swap.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN: Home.vue'nun Swap dugmesini gizlemesi bu ekrandan CIKMAYA yetmez --
// ekranin TAM ICINDEKI ChangeNetwork bileseni (NetworksPopup uzerinden) aktif agi
// Solana'ya cevirebilir. Onceden ekran ACIK kalir, yalniz "desteklenmeyen zincir"
// notuyla dugme devre disi kalirdi (v-if degil disabled).
//
// TEKNIK SINIR (deneyle dogrulandi, bkz. Task 15 raporu): `renderToString`
// bilesenin effect scope'unu render COZULDUKTEN SONRA durdurur -- yani render
// bittikten sonra `network.currentNetwork`i degistirip watch()'un TETIKLENDIGINI
// bu harness'le DOGRUDAN gozlemlemek MUMKUN DEGIL (jsdom/happy-dom, yani gercek
// bir mount, yok). Bu yuzden koruma watcher'a `immediate: true` ile de baglandi:
// bu dosya, ekranin SETUP ANINDA (render'in KENDISI sirasinda, immediate watch
// senkron calisir) aktif zincir Solana ise KENDINI kapattigini kanitlar --
// gercek kullanicidaki "ekran ACIKKEN Solana'ya gecis" senaryosunun AYNI kod
// yolu (immediate:false/true farki yalniz TETIKLENME ANINI degistirir, KOSULU
// degil), ama bu harness'te GOZLEMLENEBILIR olan taraf budur.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js
// basindaki KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Bu dosyanin konusu YALNIZCA ag-yonlendirmesi: gercek bakiye/quote aginin
// (ethers JsonRpcProvider) hicbirine ihtiyaci yok, hepsi sabitlenir.
const useTokenBalanceMock = vi.fn(async () => 0)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import Swap from './Swap.vue'
import supported_chains from '../data/supported_chains.json'

const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

afterEach(() => {
    useTokenBalanceMock.mockClear()
    delete globalThis.chrome
})

function setup(chainRecord) {
    installChromeStub({
        currentNetwork: chainRecord,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
    })

    const app = createApp(Swap)
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord
    // Kullanici zaten Swap ekranindaymis gibi baslatilir; asagidaki iddia bu
    // deger EVM disi bir zincirde KORUNMADIGINI gorecek.
    pageStore().currentPage = 'swap'

    return { app, network }
}

describe('Swap.vue (SSR) -- ekran EVM olmayan bir zincirde KENDINI kapatir (Task 15)', () => {
    it('EVM aktifken ekran acik kalir (currentPage swap da kalir)', async () => {
        const { app } = setup(ETH_CHAIN)
        await render(app)

        expect(pageStore().currentPage).toBe('swap')
    })

    it('Solana aktifken ekran KENDINI home a kapatir', async () => {
        const { app } = setup(SOLANA_CHAIN)
        await render(app)

        expect(pageStore().currentPage).toBe('home')
    })
})
