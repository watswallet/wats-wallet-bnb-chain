// TON gonderimi arka planca REDDEDILINCE Confirm ekraninda hata gorunur ve ana
// ekrana GECILMEZ. Eskiden yalniz console.error vardi: dugme "donup" duruyordu,
// kullanici ne oldugunu goremiyordu.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

vi.mock('../utils/ton/tonBalance', () => ({ getTonBalance: async () => 100 }))
vi.mock('../utils/ton/jettonBalance', () => ({
    getJettonBalance: async () => 0,
    toDecimalString: (v) => String(v),
}))
vi.mock('../utils/ton/jettonAddress', () => ({
    getJettonWalletAddress: async () => '0:' + '1'.repeat(64),
}))
vi.mock('../utils/ton/tonClient', () => ({ getTonClient: () => ({}) }))
vi.mock('../utils/ton/tonIdentity', () => ({
    ensureTonAddress: async () => 'UQAgPlDEUtqTMAJ1fpGT0AFebk85pdtOYKq72I5Eq9VIIy1P',
}))
import { ref } from 'vue'
vi.mock('../composables/useTonFee', () => ({
    useTonFee: () => ({
        atsMaxFee: ref(null), relayActive: ref(false),
        statusUnreadable: ref(false), ready: ref(true), decision: ref(null),
        quote: ref(null), budget: ref(null), loading: ref(false),
        onboarding: ref(false), error: ref(null),
        load: async () => {}, stop: () => {}, runOnboarding: async () => {},
    }),
}))
vi.mock('../utils/historyRecipients', () => ({ fetchHistoryCounterparties: async () => [] }))
vi.mock('axios', () => ({ default: { get: async () => ({ status: 200, data: {} }), post: async () => ({ status: 200, data: {} }) } }))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { pageStore } from '../store/pageStore'
import ConfirmTransaction from './ConfirmTransaction.vue'
import supported_chains from '../data/supported_chains.json'
import { NATIVE_TOKEN_ADDRESS } from '../utils/nativeToken'
import tr from '../i18n/locales/tr.json'

const TON_CHAIN = supported_chains.find((c) => String(c.chainId) === '-239')
const TON_TO = 'UQBSV_JhbECj_h_whhhC2V-zZAS_MOLoSCl1FjNXUwnmmbqq'

beforeEach(() => { vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} }) })
afterEach(() => { vi.unstubAllGlobals(); delete globalThis.chrome })

async function kur(sendYaniti) {
    const stub = installChromeStub({
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', name: 'A' },
        vaults: [],
    })
    stub.setSendMessage(async (m) => (m?.type === 'TON_FEE_IDENTITY'
        ? { success: true, tonPublicKey: '0x' + '11'.repeat(32), evmCapable: true }
        : sendYaniti(m)))
    const pinia = createTestPinia()
    networkStore().currentNetwork = TON_CHAIN
    const crypto = cryptoStore()
    crypto.sendAsset = { address: NATIVE_TOKEN_ADDRESS, decimals: 9, symbol: 'GRAM', name: 'GRAM' }
    crypto.transactionData = { to: TON_TO, amount: '1', from: TON_TO }
    pageStore().currentPage = 'confirmTransaction'
    const app = createApp(ConfirmTransaction, { use: [pinia, createTestI18n('tr')] })
    const holder = captureInstance(app, 'ConfirmTransaction')
    await render(app)
    return holder.instance.setupState
}

describe('TON gonderimi reddedilince Confirm ekraninda hata', () => {
    it('success:false -> evmSendError dolu, ekran confirmTransaction kalir, isSubmitting acilir', async () => {
        const state = await kur(async () => ({ success: false, error: 'TON_PENDING' }))
        await state.send()
        expect(state.evmSendError).toBe(tr.send.confirmTransaction.txFailed)
        expect(pageStore().currentPage).toBe('confirmTransaction')
        expect(state.isSubmitting).toBe(false)
    })

    it('basarili yanit hata yazmaz ve ana ekrana gecer', async () => {
        const state = await kur(async () => ({ success: true }))
        await state.send()
        expect(state.evmSendError).toBeFalsy()
        expect(pageStore().currentPage).toBe('home')
    })
})
