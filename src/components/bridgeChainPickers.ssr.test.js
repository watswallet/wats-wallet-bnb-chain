// Kopru/Takas ekranlarinin KENDI ag sectirici bilesenleri GERCEKTEN render
// edilerek test edilir (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN (F2 + F6, kod incelemesi): Solana'nin `testnet` alani yok, bu yuzden
// HICBIR filtre olmadan LISTED_CHAINS'e giriyor ve bu ucu bilesenden secilebilir
// hale geliyordu:
//   - bridge/selectToChains.vue: kopru HEDEFI (kopru motoru tamamen EVM'e ozel;
//     arka planda getBridgeQuote toChain'i AYRICA reddeder, bkz.
//     background.evmGates.test.js).
//   - bridge/selectFromChain.vue: kopru KAYNAGI (secilince dogrudan
//     network.setCurrentNetwork cagirir).
//   - popups/networksPopup.vue: Swap ekraninin (ChangeNetwork) ag sectirici --
//     secilince aktif ag degisir, Swap.vue'nun immediate:true izleyicisi
//     kullaniciyi Home'a geri atar (cokme yok, ama satir hic gizlenmemisti).
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import SelectToChains from './bridge/selectToChains.vue'
import SelectFromChain from './bridge/selectFromChain.vue'
import NetworksPopup from './popups/networksPopup.vue'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const SOLANA_CHAIN_ID = 'solana-mainnet'

afterEach(() => {
    delete globalThis.chrome
})

function setup(Component, componentName, props = {}) {
    const app = createApp(Component, { props })
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = ETH_CHAIN

    const captured = captureInstance(app, componentName)
    return { app, captured }
}

describe('bridge/selectToChains.vue (SSR) -- kopru HEDEFI listesi Solana yi ICERMEZ (F2)', () => {
    it('filteredChains icinde solana-mainnet YOK', async () => {
        const { app, captured } = setup(SelectToChains, 'selectToChains')
        await render(app)

        const ids = captured.instance.setupState.filteredChains.map((c) => c.chainId)
        expect(ids).not.toContain(SOLANA_CHAIN_ID)
        // Regresyon: liste BOS degil (EVM zincirleri hala orada).
        expect(ids.length).toBeGreaterThan(0)
    })
})

describe('bridge/selectFromChain.vue (SSR) -- kopru KAYNAGI listesi Solana yi ICERMEZ (F6)', () => {
    it('filteredChains icinde solana-mainnet YOK', async () => {
        const { app, captured } = setup(SelectFromChain, 'selectFromChain')
        await render(app)

        const ids = captured.instance.setupState.filteredChains.map((c) => c.chainId)
        expect(ids).not.toContain(SOLANA_CHAIN_ID)
        expect(ids.length).toBeGreaterThan(0)
    })
})

// AYNI bilesenin OTEKI kullanimi (Header'daki GLOBAL ag anahtari, `allVms`
// prop'uyla) Solana'yi LISTELEMEK ZORUNDA -- o taraf networkSwitcher.ssr.test.js'te
// olculuyor. Buradaki (varsayilan, prop'suz) davranis Swap'in kullanimidir.
describe('popups/networksPopup.vue (SSR) -- Swap in ag sectirici listesi Solana yi ICERMEZ (F6)', () => {
    it('filteredChains icinde solana-mainnet YOK', async () => {
        const { app, captured } = setup(NetworksPopup, 'networksPopup')
        await render(app)

        const ids = captured.instance.setupState.filteredChains.map((c) => c.chainId)
        expect(ids).not.toContain(SOLANA_CHAIN_ID)
        expect(ids.length).toBeGreaterThan(0)
    })
})
