// "ATS al" girisinin AG GECISI, gizli mod + PRIVATE_SWAP_BRIDGE kapali (2026-10-31, "ATS al bos ekran", karar 3).
//
// openAtsPurchase aktif ag BSC degilse applyNetworkChange(BSC, t, { flow: 'swap' }) cagirir. Soru: akis kapisi 'swap'i gizli modda,
// Takas/Kopru bayragi kapaliyken reddeder mi? Reddederse dugme SESSIZCE hicbir sey yapmazdi. Olculen: REDDETMEZ -- kapi yalniz
// zincirin takas destegine bakar (chainSupportsFlow), gizli moda/bayraga degil; bayragi okuyan tek yer arka plandaki gizlilik kapisidir
// ve o ATS_SALE_* mesajlarini SWAP bayragina baglamaz. Bu test o davranisi kilitler: yarin kapiya gizli mod kosulu eklenirse kirmizi olur.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const bayrak = vi.hoisted(() => ({ privateSwapBridge: false, privateAtsSale: true }))
vi.mock('./featureFlags', async (importOriginal) => ({
    ...(await importOriginal()),
    get PRIVATE_SWAP_BRIDGE() { return bayrak.privateSwapBridge },
    get PRIVATE_ATS_SALE() { return bayrak.privateAtsSale },
}))
vi.mock('./testRPC', () => ({ findFastestRPC: vi.fn(async () => ({ url: 'https://bsc.example' })) }))

import { applyNetworkChange } from './applyNetworkChange'
import { chainSupportsFlow, FLOW } from './chainKind'
import { networkStore } from '../store/network'
import { privacyStore } from '../store/privacy'
import supported_chains from '../data/supported_chains.json'

const BSC_CHAIN = supported_chains.find((c) => c.chainId === 56)
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const GIZLI_HESAP = { address: '0xCcccCccc00000000000000000000000000000003', key: 'private-0xcccc', type: 'hd', private: true }
const t = (key, params) => `${key}:${params?.name ?? ''}`

let alertSpy
beforeEach(async () => {
    setActivePinia(createPinia())
    bayrak.privateSwapBridge = false
    bayrak.privateAtsSale = true
    globalThis.chrome = {
        storage: {
            local: {
                get: vi.fn(async (k) => (k === 'active_account' ? { active_account: GIZLI_HESAP } : {})),
                set: vi.fn(async () => {}),
            },
        },
        runtime: { sendMessage: vi.fn(() => Promise.resolve()) },
    }
    alertSpy = vi.fn()
    globalThis.alert = alertSpy
    networkStore()
    await new Promise((r) => setTimeout(r, 0))
    networkStore().currentNetwork = ETH_CHAIN
    privacyStore().active = true
})

describe('applyNetworkChange -- gizli mod, PRIVATE_SWAP_BRIDGE kapali: "ATS al" BSC gecisi calisir', () => {
    it('akis kapisi BSC icin takasi gizli modda da kabul eder (zincir desteklerse)', () => {
        expect(chainSupportsFlow(BSC_CHAIN, FLOW.SWAP)).toBe(true)
    })

    it("Gizli Hesapla applyNetworkChange(BSC, t, { flow: 'swap' }) true doner, ag BSC olur, uyari YOK", async () => {
        const ok = await applyNetworkChange(BSC_CHAIN, t, { flow: 'swap' })

        expect(ok).toBe(true)
        expect(networkStore().currentNetwork.chainId).toBe(56)
        expect(alertSpy).not.toHaveBeenCalled()
    })
})
