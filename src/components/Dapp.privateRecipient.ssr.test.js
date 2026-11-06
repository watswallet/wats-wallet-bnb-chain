// Dapp.vue erken kilit: Gizli Hesap adresi onay ekranindaki istegin HERHANGI bir yerinde (tx.to, ERC-20 alicisi,
// router calldata'si) ise ekran, ATS_FEE_QUOTE (bundler) ve provider.estimateGas (RPC) gibi HICBIR ag istegi
// atmadan kilitlenir (Send.vue'daki privateRecipient kilidinin ikizi). Asil kapi arka plandadir
// (background.privacyGate.test.js); bu, bayat/eski bir istek icin ikinci hatlar.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const rpcCagrilari = []
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    class SahteSaglayici {
        constructor(url) { this.url = url }
        async getBalance() { rpcCagrilari.push('getBalance'); return 10n ** 18n }
        async getTransactionCount() { rpcCagrilari.push('getTransactionCount'); return 0 }
        async estimateGas() { rpcCagrilari.push('estimateGas'); return 50000n }
        async getFeeData() { rpcCagrilari.push('getFeeData'); return { maxFeePerGas: 1n, gasPrice: 1n, maxPriorityFeePerGas: 1n } }
        async call() { rpcCagrilari.push('call'); return '0x' }
        async getNetwork() { return { chainId: 1n } }
    }
    return { ...actual, ethers: { ...actual.ethers, JsonRpcProvider: SahteSaglayici } }
})

const axiosPostMock = vi.fn(async () => ({ status: 200, data: {} }))
vi.mock('axios', () => ({ default: { post: (...a) => axiosPostMock(...a), get: vi.fn(async () => ({ data: {} })) } }))

import { ethers as realEthers } from 'ethers'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import Dapp from './Dapp.vue'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const SIGNER = realEthers.getAddress('0xabcdef0000000000000000000000000000000001')
const SIGNER_ACCOUNT = { key: 'k1', address: SIGNER, name: 'Hesap 1', type: 'hd', derivationPath: "m/44'/60'/0'/0/0" }
const GIZLI_ADDR = realEthers.getAddress('0x' + 'cd12'.repeat(10))
const GIZLI = { key: 'g-1', address: GIZLI_ADDR, name: 'Gizli', type: 'hd', private: true, derivationPath: "m/44'/60'/0'/1/0" }
const RECIPIENT = '0x2222222222222222222222222222222222222222'
const TOKEN = '0x00000000000000000000000000000000000000aa'
const pad = (hex) => hex.padStart(64, '0')

beforeEach(() => {
    rpcCagrilari.length = 0
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})
afterEach(() => {
    vi.unstubAllGlobals()
    axiosPostMock.mockClear()
    delete globalThis.chrome
})

function setup(txData) {
    const stub = installChromeStub({
        currentNetwork: ETH_CHAIN,
        current_request: { type: 'SEND_TX', id: 'req-priv-1', origin: 'https://dapp.example', favicon: '', txData },
        active_account: SIGNER_ACCOUNT,
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [SIGNER_ACCOUNT], privateAccount: GIZLI }],
        dapps: {},
    })
    const mesajlar = []
    stub.setSendMessage(async (msg) => {
        mesajlar.push(msg)
        return {}
    })
    globalThis.chrome.storage.local.remove = async (key) => { delete stub.localStore[key] }
    const app = createApp(Dapp)
    app.use(createTestPinia())
    app.use(createTestI18n())
    networkStore().currentNetwork = ETH_CHAIN
    pageStore().currentPage = 'dapp'
    return { app, mesajlar }
}

describe('Dapp.vue (SSR) -- Gizli adres alici olamaz (erken kilit)', () => {
    const KOSULLAR = [
        ['duz tx.to', { from: SIGNER, to: GIZLI_ADDR, amount: '0x1', data: '0x' }],
        ['ERC-20 transfer alicisi', { from: SIGNER, to: TOKEN, amount: '0x0', data: '0xa9059cbb' + pad(GIZLI_ADDR.slice(2)) + pad('1') }],
        ['router calldata icine gomulu adres (buyuk harf)', { from: SIGNER, to: RECIPIENT, amount: '0x0', data: '0x3593564c' + pad('40') + pad(GIZLI_ADDR.slice(2).toUpperCase()) }],
    ]

    for (const [ad, txData] of KOSULLAR) {
        it(`${ad}: kilitlenir; ATS teklifi, bundler ve RPC istegi ATILMAZ`, async () => {
            const { app, mesajlar } = setup(txData)
            const captured = captureInstance(app, 'Dapp')
            await render(app)

            expect(captured.instance.setupState.privateRecipientBlocked).toBe(true)
            expect(captured.instance.setupState.sendBlocked).toBe(true)
            expect(captured.instance.setupState.isCheckingBalance).toBe(false)
            expect(mesajlar.filter((m) => /^ATS_|GASLESS_/.test(m.type))).toEqual([])
            expect(rpcCagrilari).toEqual([])
            expect(axiosPostMock).not.toHaveBeenCalled()

            // Kilitliyken send() hicbir sey gondermez.
            await captured.instance.setupState.send()
            expect(mesajlar.some((m) => m.type === 'SEND_TRANSACTION')).toBe(false)
        })
    }

    it('Gizli adresi icermeyen normal islem kilitlenmez (kurulum calisir)', async () => {
        const { app } = setup({ from: SIGNER, to: RECIPIENT, amount: '0x1', data: '0x' })
        const captured = captureInstance(app, 'Dapp')
        await render(app)
        expect(captured.instance.setupState.privateRecipientBlocked).toBe(false)
        expect(rpcCagrilari.length).toBeGreaterThan(0)
    })
})
