import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { HDNodeWallet } from 'ethers'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { createVault, deriveMasterKey, randBytes } from './utils/crypto-utils'
import { derivePrivateAccount } from './utils/privacy/privateAccount'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

// SWAP_QUOTE: IMZACI Gizli Hesap iken gaz ucretinin dolar fiyati icin `api.coingecko.com`a istek ATILMAZ
// (gizli-mod cok-ag spec 4.7 satir 4, `skipPrice`). Takas motoru taklit edilir (ag yok); cuzdan gercek bir HD
// kasadan kurulur, yani imzaci adresi turetilmistir. Motorun KENDI davranisi utils/swap.quote.test.js'tedir.
const expectedMock = vi.fn()
vi.mock('./utils/swap', async (importOriginal) => ({
    ...(await importOriginal()),
    MultiChainSwapManager: class {
        getExpectedOutput(...args) { return expectedMock(...args) }
    },
}))

const MNEMONIC = 'test test test test test test test test test test test junk'
let A, GIZLI, vault, jwk
beforeAll(async () => {
    const masterKey = await deriveMasterKey('parola-123456', randBytes(32))
    const hd = HDNodeWallet.fromPhrase(MNEMONIC, null, 'm')
    const path1 = "m/44'/60'/0'/0/0"
    A = { key: 'a-1', name: 'Hesap 1', type: 'hd', index: 0, derivationPath: path1, address: hd.derivePath(path1).address }
    vault = await createVault(masterKey, MNEMONIC, A)
    GIZLI = derivePrivateAccount(MNEMONIC, vault, { name: 'Gizli Hesap' })
    vault.privateAccount = GIZLI
    jwk = await crypto.subtle.exportKey('jwk', masterKey)
}, 60000)

let bg
async function boot(signer, { privacyFlag } = {}) {
    // privacyFlag 'false' iken arka plan acilista depoda kalan Gizli Hesap'i genel hesaba GERI ALIR (background.js rollbackPrivateAccountOnStart):
    // yalniz ilk istek Gizli hesabi gorur. Bu yuzden genel hesapla acilir, acilis oturduktan SONRA imzaci depoya yazilir.
    const acilis = privacyFlag === 'false' ? A : signer
    bg = await bootBackground({
        privacyFlag,
        localStore: { active_account: acilis, vaults: [structuredClone(vault)], dapps: {}, solana_dapps: {} },
        sessionStore: { sessionMasterKeyJwk: jwk },
    })
    if (acilis !== signer) {
        for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r))
        bg.localStore.active_account = structuredClone(signer)
    }
}

const OUT = '0x' + '22'.repeat(20)
const quoteMsg = () => ({
    type: 'SWAP_QUOTE',
    message: { chainId: 56, inTokenAddress: '0x0', outTokenAddress: OUT, amount: '1', slippage: 0.5 },
})

beforeEach(() => {
    expectedMock.mockReset()
    expectedMock.mockResolvedValue({ expectedOutput: '1', estimatedGasFee: { totalCost: '0.001', totalCostUSD: null } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r))
    teardownBackground()
    vi.restoreAllMocks()
})

// Gizli Hesap aktifken SWAP_QUOTE kapida PRIVATE_SWAP_BRIDGE_CLOSED ile kesilir (bayraktan bagimsiz); bu dosyanin Gizli testleri isleyicinin skipPrice sozlesmesini olcer, bu yuzden privacyFlag 'false' (kapi yok) ile kurulur.
describe('SWAP_QUOTE: gaz ucretinin dolar fiyati yalniz Gizli OLMAYAN imzaciyla cekilir', () => {
    it('Gizli Hesap imzaci: getExpectedOutput skipPrice TRUE ile cagrilir', async () => {
        await boot(GIZLI, { privacyFlag: 'false' })
        expect(bg.localStore.active_account.key).toBe(GIZLI.key)

        const res = await bg.call(quoteMsg())

        // Acilis geri almasi gec calisip imzaciyi genel hesaba cevirmedi: istek boyunca Gizli Hesap aktifti.
        expect(bg.localStore.active_account.key).toBe(GIZLI.key)
        expect(res.success).toBe(true)
        expect(expectedMock).toHaveBeenCalledTimes(1)
        expect(expectedMock.mock.calls[0]).toEqual(['0x0', OUT, '1', 0.5, { skipPrice: true }])
    })

    it('KONTROL: genel hesap imzaci: skipPrice FALSE (normal mod degismez)', async () => {
        await boot(A)

        const res = await bg.call(quoteMsg())

        expect(res.success).toBe(true)
        expect(expectedMock.mock.calls[0][4]).toEqual({ skipPrice: false })
    })

    it('bayragi dusmus eski Gizli Hesap kaydi da (kasadaki kayitla ayni adres) Gizli sayilir', async () => {
        const bayraksiz = { ...GIZLI }
        delete bayraksiz.private
        await boot(bayraksiz, { privacyFlag: 'false' })
        expect(bg.localStore.active_account.key).toBe(bayraksiz.key)

        await bg.call(quoteMsg())

        // Acilis geri almasi gec calisip imzaciyi genel hesaba cevirmedi: istek boyunca eski Gizli Hesap kaydi aktifti.
        expect(bg.localStore.active_account.key).toBe(bayraksiz.key)
        expect(expectedMock).toHaveBeenCalledTimes(1)
        expect(expectedMock.mock.calls[0][4]).toEqual({ skipPrice: true })
    })
})
