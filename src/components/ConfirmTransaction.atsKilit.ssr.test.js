// ConfirmTransaction.vue (SSR) -- ATS KOLUNDA BAKIYE KONTROLU DUSERSE KILIT.
//
// checkEvmGasAndBalance acilista BIR KEZ calisir. Catch'i eskiden HER hatada
// `nativeAmountInsufficient = true` yaziyordu. Gerekcesi yalniz NATIVE gonderim
// icin gecerli: gonderilen BNB'nin karsilandigi bilinmiyorsa userOp execution'da
// revert eder ve ucreti paymaster oder. TOKEN gonderiminde gonderilen native tutar
// SIFIRDIR; basarili yol bu degeri tanim geregi false yapar. Hata yolu ise basarili
// yolun asla uretemeyecegi bir kilit uretiyordu: tek bir gecici RPC hatasi (ya da
// bStock carpaninin o an okunamamasi) butonu "Yetersiz Bakiye" diye kilitliyor,
// "Tekrar dene" yalniz ATS teklifini yeniledigi icin kilit ekran kapanana kadar
// kaliyordu. Token gonderiminin asil korumasi gonderim anindaki buildTransaction.
//
// Iki yon BIRLIKTE kilitlenir: yalniz token yonunu olcmek, native gonderimin
// fail-closed kapisini da acan bir yamayi YESIL birakirdi.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Zincir okumalari saplanir; bakiye okumasi senaryoya gore DUSER.
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    class SahteSaglayici {
        async getBalance() {
            if (globalThis.__atsKilit.bakiyeHatasi) throw new Error(globalThis.__atsKilit.bakiyeHatasi)
            return 10n ** 18n
        }
        async estimateGas() { return 65000n }
        async getFeeData() { return { maxFeePerGas: 1n, gasPrice: 1n, maxPriorityFeePerGas: 1n } }
        async getNetwork() { return { chainId: 56n } }
    }
    return { ...actual, JsonRpcProvider: SahteSaglayici, ethers: { ...actual.ethers, JsonRpcProvider: SahteSaglayici } }
})

// Cagri kurulumu saplanir: burada olculen sey kurulumun kendisi degil, kontrol
// dustugunde EKRANIN verdigi karar.
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

const HAZIR_TEKLIF = {
    success: true, ready: true, mode: 'normal', isCrosschain: false,
    nextSteps: [], opCount: 1, needsTopUp: false,
    transferFee: 2.5, atsBalance: 100, symbol: 'ATS',
}

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    globalThis.__atsKilit = { bakiyeHatasi: null }
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
    delete globalThis.__atsKilit
})

async function ekraniKur({ asset, sendAsset, amount = '1', bakiyeHatasi = null }) {
    globalThis.__atsKilit.bakiyeHatasi = bakiyeHatasi

    const stub = installChromeStub({
        active_account: { key: 'k1', address: FROM, name: 'A', type: 'hd', derivationPath: "m/44'/60'/0'/0/0" },
        vaults: [],
    })
    stub.setSendMessage(async (m) => {
        if (m?.type === 'ATS_FEE_QUOTE') return HAZIR_TEKLIF
        if (m?.type === 'ATS_FUEL_BALANCE') return { success: true, balance: 100, symbol: 'ATS' }
        return { success: false }
    })

    const pinia = createTestPinia()
    const network = networkStore()
    network.currentNetwork = BSC
    network.rpc = 'https://bsc.example'
    const crypto = cryptoStore()
    crypto.sendAsset = sendAsset
    crypto.transactionData = { from: FROM, to: TO, amount, asset, network: BSC.name }
    pageStore().currentPage = 'confirmTransaction'

    const app = createApp(ConfirmTransaction, { use: [pinia, createTestI18n('tr')] })
    const holder = captureInstance(app, 'ConfirmTransaction')
    await render(app)
    expect(holder.setupStateEmptyError).toBeUndefined()
    return holder.instance.setupState
}

const HISSE = { address: GOOGLB, decimals: 18, symbol: 'GOOGLB', name: 'Alphabet' }
const BNB = { address: '0x0', decimals: 18, symbol: 'BNB', name: 'BNB' }

describe('ATS kolu: bakiye/gaz kontrolu duserse', () => {
    it('TOKEN gonderimi kilitlenmez (gonderilen native tutar sifir)', async () => {
        const state = await ekraniKur({ asset: GOOGLB, sendAsset: HISSE, bakiyeHatasi: 'network timeout' })

        expect(state.isAtsTransfer).toBe(true)
        expect(state.nativeAmountInsufficient).toBe(false)
        expect(state.feeBlocked).toBe(false)
    })

    it('NATIVE gonderim kilitli kalir (fail-closed: tutarin karsilandigi bilinmiyor)', async () => {
        const state = await ekraniKur({ asset: null, sendAsset: BNB, bakiyeHatasi: 'network timeout' })

        expect(state.isAtsTransfer).toBe(true)
        expect(state.nativeAmountInsufficient).toBe(true)
        expect(state.feeBlocked).toBe(true)
    })

    it('kontrol dusmezse token gonderimi acik (harness koruma testi)', async () => {
        const state = await ekraniKur({ asset: GOOGLB, sendAsset: HISSE })

        expect(state.isAtsTransfer).toBe(true)
        expect(state.feeBlocked).toBe(false)
    })
})
