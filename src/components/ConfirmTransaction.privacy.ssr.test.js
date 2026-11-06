// ConfirmTransaction.vue (SSR) -- EVM gonderimi arka planca REDDEDILINCE (C-I1) ve
// alici kaydinin TARAF etiketi (C-I2).
//
// KOK NEDEN: EVM dali SEND_TRANSACTION cevabini hic okumuyordu. Gizli modda kapi
// {success:false, error:'PRIVATE_USE_PRIVATE_SEND'} ile aninda reddeder ama ekran
// "gonderildi" sanip alici listesine yazip ana ekrana donuyordu.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
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
    buildTransaction: async ({ to }) => ({ to, value: 1n, data: '0x' }),
}))

const fetchHistoryCounterpartiesMock = vi.fn(async () => [])
vi.mock('../utils/historyRecipients', () => ({
    fetchHistoryCounterparties: (...a) => fetchHistoryCounterpartiesMock(...a),
}))
const axiosPostMock = vi.fn(async () => ({ status: 200, data: {} }))
vi.mock('axios', () => ({
    default: { post: (...a) => axiosPostMock(...a), get: vi.fn(async () => ({ status: 200, data: {} })) },
}))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { pageStore } from '../store/pageStore'
import { privacyStore } from '../store/privacy'
import ConfirmTransaction from './ConfirmTransaction.vue'
import supported_chains from '../data/supported_chains.json'

const ETH = supported_chains.find((c) => Number(c.chainId) === 1)
const FROM = '0xAbCdEf0000000000000000000000000000000001'
const GIZLI = '0xCcccCccc00000000000000000000000000000003'
const TO = '0x2222222222222222222222222222222222222222'

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})
afterEach(() => {
    vi.unstubAllGlobals()
    fetchHistoryCounterpartiesMock.mockClear()
    axiosPostMock.mockClear()
    delete globalThis.chrome
})

async function ekraniKur({ privateActive = false, sendResponse }) {
    const active = privateActive
        ? { key: 'p', address: GIZLI, name: 'Gizli', type: 'hd', private: true, derivationPath: "m/44'/60'/0'/1/0" }
        : { key: 'k1', address: FROM, name: 'A', type: 'hd', derivationPath: "m/44'/60'/0'/0/0" }
    const stub = installChromeStub({ active_account: active, vaults: [], saved_addresses: [] })
    const sent = []
    stub.setSendMessage(async (m) => {
        if (m?.type === 'SEND_TRANSACTION') { sent.push(m); return sendResponse }
        return { success: false }
    })

    const pinia = createTestPinia()
    const network = networkStore()
    network.currentNetwork = ETH
    network.rpc = 'https://eth.example'
    cryptoStore().sendAsset = { address: '0x0', decimals: 18, symbol: 'ETH', name: 'Ether' }
    cryptoStore().transactionData = { from: active.address, to: TO, amount: '1', asset: null, network: ETH.name }
    pageStore().currentPage = 'confirm_transaction'
    const privacy = privacyStore()
    privacy.active = privateActive
    privacy.privateAddress = privateActive ? GIZLI : null

    const app = createApp(ConfirmTransaction, { use: [pinia, createTestI18n('en')] })
    const holder = captureInstance(app, 'ConfirmTransaction')
    await render(app)
    expect(holder.setupStateEmptyError).toBeUndefined()
    return { state: holder.instance.setupState, stub, sent }
}

describe('ConfirmTransaction.vue (SSR) -- EVM gonderim reddi (C-I1)', () => {
    it('arka plan success:false derse alici KAYDEDILMEZ, ana ekrana GECILMEZ, cevrilmis hata gorunur', async () => {
        const { state, stub, sent } = await ekraniKur({
            privateActive: true,
            sendResponse: { success: false, error: 'PRIVATE_USE_PRIVATE_SEND' },
        })
        await state.send()

        expect(sent).toHaveLength(1)
        expect(stub.localStore.sent_recipients).toBeUndefined()
        expect(pageStore().currentPage).not.toBe('home')
        // Cevrilmis genel metin; ham kod ASLA ekrana cikmaz.
        expect(state.evmSendError).toBe('The transaction could not be sent.')
        expect(state.evmSendError).not.toContain('PRIVATE_USE_PRIVATE_SEND')
        // Dugme tekrar kullanilabilir: gonderim bitti.
        expect(state.isSubmitting).toBe(false)
    })

    it('basarili gonderimde alici yazilir ve ana ekrana gecilir (regresyon)', async () => {
        const { state, stub } = await ekraniKur({ sendResponse: { success: true, txHash: '0xabc' } })
        await state.send()

        expect(pageStore().currentPage).toBe('home')
        expect(state.evmSendError).toBeNull()
        expect(stub.localStore.sent_recipients).toHaveLength(1)
        // Normal taraf: etiket YOK.
        expect('private' in stub.localStore.sent_recipients[0]).toBe(false)
    })

    it('onceki hata yeni denemede temizlenir', async () => {
        const { state } = await ekraniKur({ sendResponse: { success: false, error: 'X' } })
        await state.send()
        expect(state.evmSendError).toBeTruthy()
        globalThis.chrome.runtime.sendMessage = async () => ({ success: true, txHash: '0xabc' })
        await state.send()
        expect(state.evmSendError).toBeNull()
    })
})

describe('ConfirmTransaction.vue (SSR) -- alici kaydi gonderenin tarafini tasir (C-I2)', () => {
    it('gizli gonderen basarili gonderirse kayit private:true ile yazilir', async () => {
        const { state, stub } = await ekraniKur({ privateActive: true, sendResponse: { success: true, txHash: '0xabc' } })
        await state.send()

        expect(stub.localStore.sent_recipients).toEqual([
            expect.objectContaining({ address: TO, private: true }),
        ])
    })
})

// C-I5: onay ekrani Gizli Hesap adresini sunucuya (itibar/gecmis) SIZDIRMAZ.
describe('ConfirmTransaction.vue (SSR) -- Gizli Hesap sunucuya gitmez (C-I5)', () => {
    it('gonderen Gizli Hesapken gecmis sorgusu yapilmaz', async () => {
        await ekraniKur({ privateActive: true, sendResponse: { success: true, txHash: '0xabc' } })
        expect(fetchHistoryCounterpartiesMock).not.toHaveBeenCalled()
    })

    it('alici Gizli Hesapsa itibar sorgusu yapilmaz ve gonderim engelli', async () => {
        const stub = installChromeStub({
            active_account: { key: 'k1', address: FROM, type: 'hd', derivationPath: "m/44'/60'/0'/0/0" },
            vaults: [], saved_addresses: [],
        })
        stub.setSendMessage(async () => ({ success: false }))
        const pinia = createTestPinia()
        networkStore().currentNetwork = ETH
        networkStore().rpc = 'https://eth.example'
        cryptoStore().sendAsset = { address: '0x0', decimals: 18, symbol: 'ETH', name: 'Ether' }
        cryptoStore().transactionData = { from: FROM, to: GIZLI, amount: '1', asset: null, network: ETH.name }
        const privacy = privacyStore()
        privacy.privateAddress = GIZLI
        const app = createApp(ConfirmTransaction, { use: [pinia, createTestI18n('en')] })
        const holder = captureInstance(app, 'ConfirmTransaction')
        await render(app)

        expect(axiosPostMock).not.toHaveBeenCalled()
        expect(holder.instance.setupState.securityBlocked).toBe(true)
    })
})
