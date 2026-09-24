// Bridge.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN: Home.vue'nun Kopru dugmesini gizlemesi bu ekrandan CIKMAYA yetmez --
// bridgeFrom.vue -> selectFromChain.vue ekranin TAM ICINDEN `network.setCurrentNetwork`
// cagirip Solana'ya gecebiliyor (Swap.vue'daki ChangeNetwork ile AYNI sinif sorun).
//
// NE OLCULUR: KAPI OTORITESI -- hangi zincirde ekran acik kalir, hangisinde
// kendini kapatir. ATESLEME ANI degil: `onMounted` asagida `onServerPrefetch`e
// esitlendigi icin bu dosyada setup ile mount AYIRT EDILEMEZ. "Hicbir ekran
// setup/render sirasinda currentPage yazmaz" iddiasi -- ve korumanin
// `immediate: true` ile kurulMAMASI gerektigi -- `screenSetupPageWrite.ssr.test.js`
// ile `screenDeadlockShapes.test.js`te kilitlenir. Gerekce:
// composables/useFlowScreenGuard.js bas yorumu, 2. madde.
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
const TON_CHAIN = supported_chains.find((c) => c.chainId === -239)
// RPC LISTESI BOS bir EVM kaydi. Bugun paketteki hicbir kayit boyle DEGIL --
// bu kayit iki kapinin CELISTIGI tek noktayi ayirmak icin var:
//   ESKI kapi  evmOnlyFeatures(chain).bridge -> false (rpc listesine de bakardi)
//   YENI kapi  chainSupportsFlow(chain, BRIDGE) -> true (yalnizca isEvm)
// chainKind.js bu farki ACIKCA secmis: "zincirin rpc listesine bagli bir kosul,
// gecici bir veri duzenlemesinde calisan bir kopruyu sessizce kapatabilirdi".
// `evmOnlyFeatures` artik `bridge`/`swap` alanlarini HIC TASIMIYOR (uretimde
// okuyucusu kalmamisti; bkz. evmGates.js bas yorumu), yani ustteki satir
// TARIHTIR -- ama asagidaki iddia bugun de anlamli: otoritenin rpc terimini
// TASIMADIGINI olcer, o terim geri eklenirse duser.
const EVM_CHAIN_WITHOUT_RPC = { ...ETH_CHAIN, rpc: [] }

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

    // TON'da kopru KAPALI ve kapali KALMALI: LI.FI EVM disi zincir tasimiyor,
    // Symbiosis de NATIVE TON tasimiyor (chainKind.js FLOW.BRIDGE gerekcesi).
    // Otorite birlesmesi bu karari DEGISTIRMEZ -- iki kapi TON'da zaten hemfikir.
    it('TON aktifken ekran KENDINI home a kapatir (kopru TON da bilincli kapali)', async () => {
        const { app } = setup(TON_CHAIN)
        await render(app)

        expect(pageStore().currentPage).toBe('home')
    })

    // OTORITE BIRLESMESININ KANITI. Yukaridaki TON/Solana iddialari iki kapi da
    // ayni cevabi verdigi icin OTORITENIN DEGISTIGINI kanitlayamaz; bu iddia
    // kanitlar: rpc'si bos bir EVM zincirinde eski kapi (evmOnlyFeatures) ekrani
    // kapatirdi, chainSupportsFlow ACIK birakir.
    it('rpc listesi bos bir EVM zincirinde ekran ACIK kalir -- kapi artik chainSupportsFlow', async () => {
        const { app } = setup(EVM_CHAIN_WITHOUT_RPC)
        await render(app)

        expect(pageStore().currentPage).toBe('bridge')
    })
})
