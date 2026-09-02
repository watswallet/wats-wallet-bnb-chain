// AddressBook.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN (Task 16b review, F3): bu, Send.vue'nun alici SECTIRDIGI ekrandir.
// `myAccounts` her zaman `account.address` (EVM) yayiyordu ve `wallets`
// (saved_addresses) hicbir zincir filtresiz TUMU listeleniyordu -- Solana
// aktifken kullanici kendi EVM adresini "kendi hesabim" diye sunulmus goruyordu.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js
// basindaki KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { networkStore } from '../../store/network'
import { popupStore } from '../../store/popup'
import AddressBook from './AddressBook.vue'
import supported_chains from '../../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')

const EVM_ACTIVE = '0xAbCdEf0000000000000000000000000000000001'
const EVM_OTHER = '0xffffffffffffffffffffffffffffffffffffffff'
const SOL_ACTIVE = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const SOL_OTHER = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

afterEach(() => {
    delete globalThis.chrome
})

function setup(chainRecord, storage) {
    installChromeStub(storage)
    const app = createApp(AddressBook)
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord

    // Disaridan tetiklenen bir modal: `popups.addressBook` acik olmadan icerik
    // HIC render edilmez (v-if en dis katmanda).
    const popups = popupStore()
    popups.addressBook = true

    const captured = captureInstance(app, 'AddressBook')
    return { app, captured }
}

describe('AddressBook.vue (SSR) -- EVM REGRESYONU: davranis degismedi', () => {
    it('EVM aktif: EVM kayitli adresler VE diger EVM hesaplari listelenir', async () => {
        const { app, captured } = setup(ETH_CHAIN, {
            active_account: { address: EVM_ACTIVE, key: 'acc1' },
            saved_addresses: [{ label: 'Exchange', address: EVM_OTHER, chainId: 1 }],
            vaults: [{ fingerprint: 'fp1', accounts: [
                { key: 'acc1', address: EVM_ACTIVE, name: 'Hesap 1' },
                { key: 'acc2', address: EVM_OTHER, name: 'Hesap 2' },
            ] }],
        })
        const html = await render(app)

        expect(captured.instance.setupState.wallets).toHaveLength(1)
        expect(captured.instance.setupState.myAccounts).toHaveLength(1)
        expect(captured.instance.setupState.myAccounts[0].pickAddress).toBe(EVM_OTHER)
        expect(html).toContain('EVM')
    })

    it('EVM aktif: aktif hesabin KENDISI myAccounts te GORUNMEZ (eski davranis)', async () => {
        const { app, captured } = setup(ETH_CHAIN, {
            active_account: { address: EVM_ACTIVE, key: 'acc1' },
            saved_addresses: [],
            vaults: [{ fingerprint: 'fp1', accounts: [{ key: 'acc1', address: EVM_ACTIVE, name: 'Hesap 1' }] }],
        })
        await render(app)

        expect(captured.instance.setupState.myAccounts).toHaveLength(0)
    })
})

describe('AddressBook.vue (SSR) -- Solana da SOLANA kimligi sunulur (Task 16b review, F3)', () => {
    it('Solana kayitli adresler gorunur, EVM kayitlari GIZLENIR', async () => {
        const { app, captured } = setup(SOLANA_CHAIN, {
            active_account: { address: EVM_ACTIVE, solanaAddress: SOL_ACTIVE, key: 'acc1' },
            saved_addresses: [
                { label: 'EVM kayit', address: EVM_OTHER, chainId: 1 },
                { label: 'Solana kayit', address: SOL_OTHER, chainId: 'solana-mainnet' },
            ],
            vaults: [{ fingerprint: 'fp1', accounts: [{ key: 'acc1', address: EVM_ACTIVE, solanaAddress: SOL_ACTIVE, name: 'Hesap 1' }] }],
        })
        const html = await render(app)

        expect(captured.instance.setupState.wallets).toHaveLength(1)
        expect(captured.instance.setupState.wallets[0].label).toBe('Solana kayit')
        expect(html).not.toContain(EVM_OTHER)
    })

    // ASIL HATA: baska bir hesabin Solana adresi HENUZ COZULMEDIYSE (kullanici
    // o hesaba hic gecmedi) EVM adresi ONUN YERINE SUNULMAZ -- o hesap
    // LISTEDEN DUSER.
    it('solanaAddress HENUZ cozulmemis bir hesap listelenmez (EVM adresine DUSULMEZ)', async () => {
        const { app, captured } = setup(SOLANA_CHAIN, {
            active_account: { address: EVM_ACTIVE, solanaAddress: SOL_ACTIVE, key: 'acc1' },
            saved_addresses: [],
            vaults: [{ fingerprint: 'fp1', accounts: [
                { key: 'acc1', address: EVM_ACTIVE, solanaAddress: SOL_ACTIVE, name: 'Hesap 1' },
                { key: 'acc2', address: EVM_OTHER, name: 'Hesap 2' }, // solanaAddress YOK
            ] }],
        })
        const html = await render(app)

        expect(captured.instance.setupState.myAccounts).toHaveLength(0)
        expect(html).not.toContain(EVM_OTHER)
    })

    it('solanaAddress cozulmus baska bir hesap DOGRU kimlikle (pickAddress=solanaAddress) sunulur', async () => {
        const OTHER_SOL = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
        const { app, captured } = setup(SOLANA_CHAIN, {
            active_account: { address: EVM_ACTIVE, solanaAddress: SOL_ACTIVE, key: 'acc1' },
            saved_addresses: [],
            vaults: [{ fingerprint: 'fp1', accounts: [
                { key: 'acc1', address: EVM_ACTIVE, solanaAddress: SOL_ACTIVE, name: 'Hesap 1' },
                { key: 'acc2', address: EVM_OTHER, solanaAddress: OTHER_SOL, name: 'Hesap 2' },
            ] }],
        })
        const html = await render(app)

        expect(captured.instance.setupState.myAccounts).toHaveLength(1)
        expect(captured.instance.setupState.myAccounts[0].pickAddress).toBe(OTHER_SOL)
        expect(html).not.toContain(EVM_OTHER)
    })

    it('harf kasasi BIREBIR korunur (kucultulmez) -- hem wallets hem myAccounts icin', async () => {
        const { app, captured } = setup(SOLANA_CHAIN, {
            active_account: { address: EVM_ACTIVE, solanaAddress: SOL_ACTIVE, key: 'acc1' },
            saved_addresses: [{ label: 'Solana kayit', address: SOL_OTHER, chainId: 'solana-mainnet' }],
            vaults: [{ fingerprint: 'fp1', accounts: [{ key: 'acc1', address: EVM_ACTIVE, solanaAddress: SOL_ACTIVE, name: 'Hesap 1' }] }],
        })
        await render(app)

        expect(captured.instance.setupState.wallets[0].address).toBe(SOL_OTHER)
        expect(captured.instance.setupState.wallets[0].address).not.toBe(SOL_OTHER.toLowerCase())
    })
})

// ---------------------------------------------------------------------------
// "SON GONDERDIKLERIM" BOLUMU -- inceleme turu 3 (ORTA-2 ve ORTA-3).
//
// Gecmis TUM zincirleri KARISIK tutar ve lastSentAt'e gore siralidir. Bu iki
// gercek birlikte, saf katmanin ve bilesenin SIRALAMASINI kritik yapar:
//   - kirpma FILTREDEN ONCE calisirsa, son 5 alici EVM oldugunda Solana'da
//     bolum BOS gorunur (eslesen Solana alicilari OLSA BILE),
//   - eleme kapisi yalniz `.address` (EVM) okursa, kullanicinin KENDI Solana
//     adresi -- gonderen AKTIF hesap dahil -- alici olarak onerilir.
// ---------------------------------------------------------------------------
const SOL_RECENT_1 = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const SOL_RECENT_2 = 'So11111111111111111111111111111111111111112'

const evmSent = (i, at) => ({ address: '0x' + String(i).padStart(40, '1'), lastSentAt: at, count: 1, label: null })
const solSent = (address, at, label = null) => ({ address, lastSentAt: at, count: 1, label })

const soloAccount = {
    active_account: { address: EVM_ACTIVE, solanaAddress: SOL_ACTIVE, key: 'acc1' },
    saved_addresses: [],
    vaults: [{ fingerprint: 'fp1', accounts: [{ key: 'acc1', address: EVM_ACTIVE, solanaAddress: SOL_ACTIVE, name: 'Hesap 1' }] }],
}

describe('AddressBook.vue (SSR) -- son gonderdiklerim: SUZ, SONRA KIRP', () => {
    it('son 5 alici EVM olsa bile Solana da eski bir Solana alicisi GORUNUR', async () => {
        const { app, captured } = setup(SOLANA_CHAIN, {
            ...soloAccount,
            // 5 TAZE EVM alicisi + 1 ESKI Solana alicisi. Varsayilan kirpma
            // (RECENT_RECIPIENTS_SHOWN=5) filtreden ONCE calisirsa geriye
            // yalniz EVM kalir ve bolum Solana da BOSALIR.
            sent_recipients: [
                evmSent(1, 900), evmSent(2, 800), evmSent(3, 700),
                evmSent(4, 600), evmSent(5, 500),
                solSent(SOL_RECENT_1, 10, 'Borsa'),
            ],
        })
        await render(app)

        expect(captured.instance.setupState.recent.map(r => r.address)).toEqual([SOL_RECENT_1])
    })

    it('kirpma yine de uygulanir -- eslesen alici cok oldugunda en fazla 5', async () => {
        const many = Array.from({ length: 7 }, (_, i) =>
            solSent('So1111111111111111111111111111111111111111' + String(i + 10), 100 + i))
        const { app, captured } = setup(SOLANA_CHAIN, {
            ...soloAccount,
            sent_recipients: [evmSent(1, 900), evmSent(2, 800), ...many],
        })
        await render(app)

        const out = captured.instance.setupState.recent
        expect(out).toHaveLength(5)
        // En son gonderilen basta: 7 kaydin en tazeleri kaliyor, en eskisi degil.
        expect(out[0].address).toBe(many[6].address)
    })

    it('EVM aktifken bolum eski davranisiyla EVM alicilarini gosterir', async () => {
        const { app, captured } = setup(ETH_CHAIN, {
            active_account: { address: EVM_ACTIVE, key: 'acc1' },
            saved_addresses: [],
            vaults: [{ fingerprint: 'fp1', accounts: [{ key: 'acc1', address: EVM_ACTIVE, name: 'Hesap 1' }] }],
            sent_recipients: [evmSent(1, 900), solSent(SOL_RECENT_1, 800)],
        })
        const html = await render(app)

        expect(captured.instance.setupState.recent.map(r => r.address)).toEqual([evmSent(1, 900).address])
        expect(html).not.toContain(SOL_RECENT_1)
    })
})

describe('AddressBook.vue (SSR) -- son gonderdiklerim: kendi kimliklerin elenir', () => {
    it('AKTIF hesabin KENDI Solana adresi alici olarak ONERILMEZ', async () => {
        const { app, captured } = setup(SOLANA_CHAIN, {
            ...soloAccount,
            sent_recipients: [solSent(SOL_ACTIVE, 900), solSent(SOL_RECENT_1, 800)],
        })
        const html = await render(app)

        expect(captured.instance.setupState.recent.map(r => r.address)).toEqual([SOL_RECENT_1])
        expect(html).not.toContain(SOL_ACTIVE)
    })

    it('BASKA bir hesabin Solana adresi de ONERILMEZ (kendi hesaplarinda zaten var)', async () => {
        const { app, captured } = setup(SOLANA_CHAIN, {
            active_account: { address: EVM_ACTIVE, solanaAddress: SOL_ACTIVE, key: 'acc1' },
            saved_addresses: [],
            vaults: [{ fingerprint: 'fp1', accounts: [
                { key: 'acc1', address: EVM_ACTIVE, solanaAddress: SOL_ACTIVE, name: 'Hesap 1' },
                { key: 'acc2', address: EVM_OTHER, solanaAddress: SOL_OTHER, name: 'Hesap 2' },
            ] }],
            sent_recipients: [solSent(SOL_OTHER, 900), solSent(SOL_RECENT_2, 800)],
        })
        await render(app)

        expect(captured.instance.setupState.recent.map(r => r.address)).toEqual([SOL_RECENT_2])
    })
})
