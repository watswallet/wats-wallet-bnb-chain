// ConfirmTransaction.vue (SSR) -- gaz ucretinin "≈" karsiligi SECILI BIRIMDE (Plan B Gorev 11).
//
// Karsilik satiri artik `money(tokenToUsd(gas, fiyat))` ile yazilir: sablon yalniz "≈ " ekler, sembol
// metinden gelir ("$0.75", "₺30,00", kur yokken "USD 0.75"). Fiyat ya da gaz YOKSA satir HIC cizilmez
// (Number(null) = 0 tuzagi: "≈ $0.00" "ucret bedava" derdi).
//
// Solana kolu secildi: gaz ucreti zincir okumasi gerektirmez (prepareTransferContext saplanir), ATS ucret
// karti cizilmez ve yerel gaz karti her zaman gorunur. Fiyat useUsdPrice saplamasindan gelir.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

vi.mock('../utils/historyRecipients', () => ({ fetchHistoryCounterparties: async () => [] }))

const baglam = vi.hoisted(() => ({ feeLamports: 5_000_000, basarisiz: false }))
vi.mock('../utils/solana/send', () => ({
    prepareTransferContext: async () => {
        if (baglam.basarisiz) throw new Error('rpc dustu')
        return {
            blockhash: '11111111111111111111111111111111',
            feeLamports: baglam.feeLamports, rentExemptLamports: 890880,
            recipientAtaExists: true, ataRentLamports: 0,
        }
    },
}))
vi.mock('../utils/solana/balances', () => ({
    fetchSolanaAssets: async () => ([{ mint: 'native', amount: 5, decimals: 9 }]),
}))
vi.mock('axios', () => ({
    default: { post: async () => ({ status: 200, data: {} }), get: async () => ({ status: 200, data: {} }) },
}))

// Fiyat saplamasi: native gaz fiyati `tokenBalances` verilen cagridan (nativePrice), ATS fiyati digerinden.
const FIYAT = vi.hoisted(() => ({ native: 150, ats: 0.05 }))
vi.mock('../composables/useUsdPrice', async () => {
    const { ref } = await import('vue')
    return {
        useUsdPrice: (deps = {}) => ({
            price: ref(deps.tokenBalances ? FIYAT.native : FIYAT.ats),
            loadNative: async () => {},
            loadById: async () => {},
        }),
    }
})

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { userStore } from '../store/user'
import { currencyStore } from '../store/currency'
import ConfirmTransaction from './ConfirmTransaction.vue'
import supported_chains from '../data/supported_chains.json'

const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')
const SOLANA_FROM = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const SOLANA_TO = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const EVM_ADDRESS = '0xAbCdEf0000000000000000000000000000000001'

// Bosluklu biciler dilde nbsp (U+00A0) / dar nbsp (U+202F) kullanir: duz bosluga indirilir.
// SSR cikti "<" isaretini `&lt;` yazar: metin hali karsilastirilir.
const norm = (s) => (typeof s === 'string' ? s.replace(/[  ]/g, ' ').replace(/&lt;/g, '<') : s)
const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
// Gaz karsilik satiri: "≈ " ile baslayan tek span'in metni; satir yoksa null.
const karsilik = (html) => {
    const m = gorunen(html).match(/<span[^>]*>≈ ([^<]*)<\/span>/)
    return m ? norm(m[1].trim()) : null
}

const tazeKur = (rates) => {
    const now = Date.now()
    return { rates, currencies: [], updatedAt: now, stale: false, fetchedAt: now }
}

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    baglam.feeLamports = 5_000_000
    baglam.basarisiz = false
    FIYAT.native = 150
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

async function ciz({ hazirla, locale = 'en' } = {}) {
    installChromeStub({
        currentNetwork: SOLANA_CHAIN,
        active_account: { address: EVM_ADDRESS, solanaAddress: SOLANA_FROM, key: 'acc1' },
        vaults: [],
        saved_addresses: [],
    })
    const app = createApp(ConfirmTransaction)
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    networkStore().currentNetwork = SOLANA_CHAIN
    userStore().address = EVM_ADDRESS
    cryptoStore().transactionData = {
        from: SOLANA_FROM, to: SOLANA_TO, amount: '1', asset: 'native', network: SOLANA_CHAIN.name,
    }
    hazirla?.(currencyStore())
    return render(app)
}

describe('ConfirmTransaction.vue (SSR) -- gaz karsiligi secili birimde', () => {
    it('varsayilan USD: 0.005 SOL x 150 = "≈ $0.75"', async () => {
        expect(karsilik(await ciz())).toBe('$0.75')
    })

    it('try / kur 40 / tr dili: "≈ ₺30,00" (0.75 x 40)', async () => {
        const html = await ciz({
            locale: 'tr',
            hazirla: (store) => { store.code = 'try'; store.snapshot = tazeKur({ try: 40 }) },
        })
        expect(karsilik(html)).toBe('₺30,00')
        // Eski sablon "≈ $" + metin basardi: "$₺30,00" ya da "$$" gorunmemeli.
        expect(gorunen(html)).not.toContain('$₺')
        expect(gorunen(html)).not.toContain('≈ $')
    })

    it('kur yok (secili try, tablo yok): "USD 0.75" kod etiketli, "₺" asla', async () => {
        const html = await ciz({
            hazirla: (store) => { store.code = 'try'; store.snapshot = null },
        })
        expect(karsilik(html)).toBe('USD 0.75')
        expect(gorunen(html)).not.toContain('₺')
    })

    it('kucuk gaz (5000 lamport x 150 = 0.00075): "≈ <$0.01" ("$0.00" degil)', async () => {
        baglam.feeLamports = 5000
        expect(karsilik(await ciz())).toBe('<$0.01')
    })

    it('fiyat YOK: karsilik satiri hic cizilmez ("≈ $0.00" bedava derdi)', async () => {
        FIYAT.native = null
        const html = await ciz()
        // Pozitif kontrol: gaz tutari kartta var, yalniz karsilik yok.
        expect(gorunen(html)).toContain('SOL')
        expect(karsilik(html)).toBeNull()
        expect(gorunen(html)).not.toMatch(/≈ \$?0\.00/)
    })

    it('gaz okunamadi (gaz bos): karsilik satiri yok, NaN / "$0.00" yazilmaz (Number(null) tuzagi)', async () => {
        baglam.basarisiz = true
        // Bilesen okuma hatasini console.error ile bildirir (beklenen): test ciktisi kirlenmesin.
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {})
        const html = await ciz()
        expect(hata).toHaveBeenCalled()
        hata.mockRestore()
        expect(karsilik(html)).toBeNull()
        expect(gorunen(html)).not.toContain('NaN')
        expect(gorunen(html)).not.toMatch(/≈ \$?0\.00/)
    })
})
