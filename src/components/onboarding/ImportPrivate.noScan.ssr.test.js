// ImportPrivate.vue: ozel anahtar (imported) hesaplar HICBIR hesap taramasi / kullanim yoklamasi baslatmaz (final T-15).
//
// "Gizli Hesap / imported hesaplar taranmaz" siniri (Review Focus 5) onceden YALNIZ useAccountScan.test.js'teki
// kaynak-metni taramasiyla korunuyordu (useAccountScan( / scanUsedAccounts( cagri yerleri == ImportPhrases.vue). Takma ad, dinamik
// import ya da yeniden adlandirma o taramadan kacardi. Bu dosya DAVRANISSAL guvence ekler: ekran GERCEKTEN calistirilir ve
// EVM/Solana yoklamalari ile Solana turetici HIC cagrilmadigi olculur. (Bayrak ACIK: vitest.config.js test.env.)
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. src/test-utils/ssrRender.js).
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const shared = vi.hoisted(() => ({ locked: false, masterKey: null }))

const probeEvmAddressSpy = vi.fn(async () => 'unused')
const probeSolanaAddressSpy = vi.fn(async () => 'unused')
const createSolanaAddressDeriverSpy = vi.fn(async () => () => 'SOL')
vi.mock('../../utils/evmUsageProbe', () => ({ probeEvmAddress: (...args) => probeEvmAddressSpy(...args) }))
vi.mock('../../utils/solanaUsageProbe', () => ({ probeSolanaAddress: (...args) => probeSolanaAddressSpy(...args) }))
vi.mock('../../utils/solana/derive', async (importOriginal) => ({
    ...(await importOriginal()),
    createSolanaAddressDeriver: (...args) => createSolanaAddressDeriverSpy(...args),
}))
vi.mock('../../utils/masterKey', async (importOriginal) => ({
    ...(await importOriginal()),
    requireSessionMasterKey: async () => shared.masterKey,
}))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { deriveMasterKey } from '../../utils/crypto-utils'
import ImportPrivate from './ImportPrivate.vue'

const EVM_KEY = '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'

const VAULT_1 = {
    id: 'kasa-1',
    type: 'hd',
    fingerprint: 'baska-seed-parmak-izi',
    accounts: [{
        key: 'hesap-1', index: 0, name: 'Wats 1', type: 'hd', fingerprint: 'baska-seed-parmak-izi',
        address: '0x0000000000000000000000000000000000000001',
    }],
}

beforeAll(async () => {
    shared.masterKey = await deriveMasterKey('parola-123', new Uint8Array(16))
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete globalThis.chrome
    probeEvmAddressSpy.mockClear()
    probeSolanaAddressSpy.mockClear()
    createSolanaAddressDeriverSpy.mockClear()
})

async function mountImportPrivate({ vaults }) {
    const { localStore: store } = installChromeStub({ vaults: structuredClone(vaults) })
    vi.stubGlobal('alert', vi.fn())

    const onConfirmed = vi.fn()
    const onPrivateKey = vi.fn()
    const app = createApp(ImportPrivate, { props: { onConfirmed, onPrivate_key: onPrivateKey } })
    app.use(createTestPinia())
    app.use(createTestI18n())
    const captured = captureInstance(app, 'ImportPrivate')
    await render(app)
    const s = captured.instance.setupState
    s.privateKey = EVM_KEY
    return { s, store, onConfirmed, onPrivateKey }
}

const nothingScanned = () => {
    expect(probeEvmAddressSpy).not.toHaveBeenCalled()
    expect(probeSolanaAddressSpy).not.toHaveBeenCalled()
    expect(createSolanaAddressDeriverSpy).not.toHaveBeenCalled()
}

describe('ImportPrivate: ozel anahtar ice aktarma hesap taramasi BASLATMAZ', () => {
    it('cuzdan ekle (kasa var): hesap eklenir (type imported) ama EVM/Solana yoklamasi ve Solana turetici HIC cagrilmaz', async () => {
        const m = await mountImportPrivate({ vaults: [VAULT_1] })
        await m.s.importWallet()

        // Ice aktarma GERCEKTEN calisti (test bos gecmez): tek yeni kasa, tek imported hesap, ready
        expect(m.store.vaults).toHaveLength(2)
        expect(m.store.active_account.type).toBe('imported')
        expect(m.onConfirmed).toHaveBeenCalledWith('ready')
        nothingScanned()
    })

    it('ilk cuzdan (kasa yok): sifre adimina devredilir, EVM/Solana yoklamasi ve Solana turetici HIC cagrilmaz', async () => {
        const m = await mountImportPrivate({ vaults: [] })
        await m.s.importWallet()

        expect(m.onPrivateKey).toHaveBeenCalledWith(EVM_KEY)
        expect(m.onConfirmed).toHaveBeenCalledWith('password')
        nothingScanned()
    })
})
