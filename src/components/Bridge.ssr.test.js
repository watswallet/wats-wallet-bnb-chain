// Bridge.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN: Home.vue'nun Kopru dugmesini gizlemesi bu ekrandan CIKMAYA yetmez --
// bridgeFrom.vue -> selectFromChain.vue ekranin TAM ICINDEN `network.setCurrentNetwork`
// cagirip Solana'ya gecebiliyor (Swap.vue'daki ChangeNetwork ile AYNI sinif sorun,
// bkz. Swap.ssr.test.js basindaki TEKNIK SINIR notu -- ayni gerekce burada da gecerli).
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
import Bridge from './Bridge.vue'
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

    const app = createApp(Bridge)
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord
    // Kullanici zaten Kopru ekranindaymis gibi baslatilir; asagidaki iddia bu
    // deger EVM disi bir zincirde KORUNMADIGINI gorecek.
    pageStore().currentPage = 'bridge'

    return { app, network }
}

describe('Bridge.vue (SSR) -- ekran EVM olmayan bir zincirde KENDINI kapatir (Task 15)', () => {
    it('EVM aktifken ekran acik kalir (currentPage bridge de kalir)', async () => {
        const { app } = setup(ETH_CHAIN)
        await render(app)

        expect(pageStore().currentPage).toBe('bridge')
    })

    it('Solana aktifken ekran KENDINI home a kapatir', async () => {
        const { app } = setup(SOLANA_CHAIN)
        await render(app)

        expect(pageStore().currentPage).toBe('home')
    })
})
