// "ATS Al" -- TON hesabinda gonderme onayi (spec §1, §6.4): TON hesabi BSC'ye gecemez, bu yuzden
// ConfirmTransaction.vue'nun engel kartindaki ATS Al dugmesi `&& !isTonNetwork` ile kapatilidir.
// Bu kosul baska hicbir testte sabit degildi: kosul silinse tum suite yesil kalirdi.
// Iddia CEVRILMIS metin uzerinde; pozitif kontrol: TON engel karti (buy-ats karari) GERCEKTEN cizilir.
// useTonFee saplanir (karar testin sectigi), satis ACIK. 'vue' mock'u BURADA olmak ZORUNDA (bkz. ssrRender.js).
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

vi.mock('../utils/ton/tonBalance', () => ({ getTonBalance: async () => 5 }))
vi.mock('../utils/ton/jettonBalance', () => ({ getJettonBalance: async () => 0, toDecimalString: (v) => String(v) }))
vi.mock('../utils/ton/jettonAddress', () => ({ getJettonWalletAddress: async () => '0:' + '1'.repeat(64) }))
vi.mock('../utils/ton/tonClient', () => ({ getTonClient: () => ({}) }))
vi.mock('../utils/ton/tonIdentity', () => ({
    ensureTonAddress: async () => 'UQAgPlDEUtqTMAJ1fpGT0AFebk85pdtOYKq72I5Eq9VIIy1P',
}))

// TON ucret karari: buy-ats. statusUnreadable true -> tonFeeDecisionActive (engel karti cizilir).
const tonKarar = vi.hoisted(() => ({ karar: null }))
vi.mock('../composables/useTonFee', async () => {
    const { ref } = await import('vue')
    return {
        useTonFee: () => ({
            atsMaxFee: ref(null), relayActive: ref(false), statusUnreadable: ref(true), ready: ref(false),
            decision: ref(tonKarar.karar), quote: ref(null), budget: ref(null), loading: ref(false),
            onboarding: ref(false), error: ref(null),
            load: async () => {}, stop: () => {}, runOnboarding: async () => {},
        }),
    }
})
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
import { NATIVE_TOKEN_ADDRESS } from '../utils/nativeToken'

const TON_CHAIN = supported_chains.find((c) => String(c.chainId) === '-239')
const TON_TO = 'UQBSV_JhbECj_h_whhhC2V-zZAS_MOLoSCl1FjNXUwnmmbqq'
const BUY_ATS = { action: 'buy-ats', severity: 'user', i18nKey: 'send.confirmTransaction.atsBalanceMissing' }
const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
    acilis.mockClear()
    satis.acik = true
    tonKarar.karar = null
})

async function ekraniKur() {
    const stub = installChromeStub({
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', name: 'A' },
        vaults: [],
    })
    stub.setSendMessage(async () => ({ success: false }))
    const pinia = createTestPinia()
    networkStore().currentNetwork = TON_CHAIN
    const crypto = cryptoStore()
    crypto.sendAsset = { address: NATIVE_TOKEN_ADDRESS, decimals: 9, symbol: 'GRAM', name: 'GRAM' }
    crypto.transactionData = { to: TON_TO, amount: '1', from: TON_TO }
    pageStore().currentPage = 'confirmTransaction'
    const app = createApp(ConfirmTransaction, { use: [pinia, createTestI18n()] })
    const holder = captureInstance(app, 'ConfirmTransaction')
    const html = gorunen(await render(app))
    return { html, state: holder.instance.setupState }
}

describe('ConfirmTransaction.vue (SSR) -- TON hesabinda buy-ats engel karti', () => {
    it('TON engel karti cizilir ama "Buy ATS" dugmesi YOK (TON hesabi BSC ye gecemez)', async () => {
        tonKarar.karar = BUY_ATS
        const { html, state } = await ekraniKur()
        expect(state.isTonNetwork).toBe(true)
        expect(state.feeDecision.action).toBe('buy-ats')
        // Pozitif kontrol: TON engel karti GERCEKTEN cizildi.
        expect(html).toContain('ATS balance required')
        expect(html).not.toContain('Buy ATS')
    })
})
