import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Bayrak modul YUKLENIRKEN sabitlenir (build-time sabit olabilmesi icin).
// Bu yuzden her senaryo resetModules + taze import ister.
async function loadFlags(value) {
    vi.resetModules()
    if (value === undefined) vi.stubEnv('VITE_SOLANA_ENABLED', undefined)
    else vi.stubEnv('VITE_SOLANA_ENABLED', value)
    return import('./featureFlags.js')
}

async function loadChains(value) {
    vi.resetModules()
    if (value === undefined) vi.stubEnv('VITE_SOLANA_ENABLED', undefined)
    else vi.stubEnv('VITE_SOLANA_ENABLED', value)
    const mod = await import('../data/supportedChains.js')
    return mod.default
}

describe('SOLANA_ENABLED bayragi', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

    it('ortam degiskeni yoksa KAPALI olur -- acik varsaymak Solana kodunu sessizce yayina sokar', async () => {
        const { SOLANA_ENABLED } = await loadFlags(undefined)
        expect(SOLANA_ENABLED).toBe(false)
    })

    it("'false' degerinde kapali olur", async () => {
        const { SOLANA_ENABLED } = await loadFlags('false')
        expect(SOLANA_ENABLED).toBe(false)
    })

    it("yalnizca 'true' metni bayragi acar -- '1'/'yes' gibi degerler ACMAZ", async () => {
        expect((await loadFlags('1')).SOLANA_ENABLED).toBe(false)
        expect((await loadFlags('yes')).SOLANA_ENABLED).toBe(false)
        expect((await loadFlags('true')).SOLANA_ENABLED).toBe(true)
    })
})

describe('desteklenen zincir listesi bayraga baglidir', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

    it('bayrak KAPALIYKEN Solana kaydi listede YOKTUR', async () => {
        const chains = await loadChains('false')
        expect(chains.some((c) => c.vm === 'solana')).toBe(false)
        expect(chains.some((c) => c.chainId === 'solana-mainnet')).toBe(false)
    })

    it('bayrak kapaliyken EVM ve TON kayitlari AYNEN kalir', async () => {
        const chains = await loadChains('false')
        expect(chains.some((c) => Number(c.chainId) === 1)).toBe(true)
        expect(chains.some((c) => c.kind === 'ton')).toBe(true)
    })

    it('bayrak ACIKKEN Solana kaydi listededir', async () => {
        const chains = await loadChains('true')
        expect(chains.some((c) => c.chainId === 'solana-mainnet')).toBe(true)
    })
})

describe('PRIVACY_ENABLED', () => {
    async function loadPrivacy(value) {
        vi.resetModules()
        if (value === undefined) vi.stubEnv('VITE_PRIVACY_ENABLED', undefined)
        else vi.stubEnv('VITE_PRIVACY_ENABLED', value)
        return import('./featureFlags.js')
    }

    afterEach(() => {
        vi.unstubAllEnvs()
        vi.resetModules()
    })

    it('yalnizca tam "true" dizgesiyle acilir', async () => {
        expect((await loadPrivacy('true')).PRIVACY_ENABLED).toBe(true)
        expect((await loadPrivacy('TRUE')).PRIVACY_ENABLED).toBe(false)
        expect((await loadPrivacy('1')).PRIVACY_ENABLED).toBe(false)
        expect((await loadPrivacy('false')).PRIVACY_ENABLED).toBe(false)
        expect((await loadPrivacy(undefined)).PRIVACY_ENABLED).toBe(false)
    })
})

// --- XSTOCKS_ENABLED --------------------------------------------------------------------

// Bayrak modul YUKLENIRKEN sabitlenir; her senaryo resetModules + taze import ister.
async function loadXstocksFlag(value) {
    vi.resetModules()
    if (value === undefined) vi.stubEnv('VITE_XSTOCKS_ENABLED', undefined)
    else vi.stubEnv('VITE_XSTOCKS_ENABLED', value)
    return import('./featureFlags.js')
}

describe('XSTOCKS_ENABLED bayragi', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

    it('ortam degiskeni yoksa KAPALI olur -- acik varsaymak xStocks i sessizce yayina sokar', async () => {
        const { XSTOCKS_ENABLED } = await loadXstocksFlag(undefined)
        expect(XSTOCKS_ENABLED).toBe(false)
    })

    it("'false' degerinde kapali olur", async () => {
        const { XSTOCKS_ENABLED } = await loadXstocksFlag('false')
        expect(XSTOCKS_ENABLED).toBe(false)
    })

    it("yalnizca 'true' metni bayragi acar -- '1', 'yes', 'TRUE' ACMAZ", async () => {
        expect((await loadXstocksFlag('1')).XSTOCKS_ENABLED).toBe(false)
        expect((await loadXstocksFlag('yes')).XSTOCKS_ENABLED).toBe(false)
        expect((await loadXstocksFlag('TRUE')).XSTOCKS_ENABLED).toBe(false)
        expect((await loadXstocksFlag('true')).XSTOCKS_ENABLED).toBe(true)
    })

    it('Solana bayragindan BAGIMSIZDIR (biri digerini acmaz)', async () => {
        vi.resetModules()
        vi.stubEnv('VITE_SOLANA_ENABLED', 'false')
        vi.stubEnv('VITE_XSTOCKS_ENABLED', 'true')
        const flags = await import('./featureFlags.js')
        expect(flags.SOLANA_ENABLED).toBe(false)
        expect(flags.XSTOCKS_ENABLED).toBe(true)
    })

    it('testlerde (vitest.config.js test.env) bayrak varsayilan ACIK gelir', async () => {
        vi.resetModules()
        const { XSTOCKS_ENABLED } = await import('./featureFlags.js')
        expect(XSTOCKS_ENABLED).toBe(true)
    })
})

// Uretim bayragi kilidi (FIN-cekirdek-8): ortam dosyasina yanlislikla 'true' yazilirsa bu test
// kirmizi olur; bayrak BILEREK acilirken testin guncellenmesi de bilincli bir karar olur.
// Dosya satir sonundan (CRLF/LF) bagimsiz okunur; yorum satirlari sayilmaz.
describe('XSTOCKS_ENABLED ortam dosyalari (uretim ACIK, gelistirme KAPALI)', () => {
    const bayrakSatirlari = (dosya) => readFileSync(fileURLToPath(new URL('../../' + dosya, import.meta.url)), 'utf8')
        .split(/\r?\n/)
        .map((satir) => satir.trim())
        .filter((satir) => satir.startsWith('VITE_XSTOCKS_ENABLED='))

    // 1.9.3 (2026-10-30): xStocks uretimde BILEREK acildi (kullanici karari). Gelistirme KAPALI kalir.
    it('.env.production tam olarak bir VITE_XSTOCKS_ENABLED=true satiri tasir (1.9.3 yayin karari)', () => {
        expect(bayrakSatirlari('.env.production')).toEqual(['VITE_XSTOCKS_ENABLED=true'])
    })

    it('.env.development tam olarak bir VITE_XSTOCKS_ENABLED=false satiri tasir', () => {
        expect(bayrakSatirlari('.env.development')).toEqual(['VITE_XSTOCKS_ENABLED=false'])
    })
})

// Kullanim istatistigi bayragi: ayni katilik. NEDEN: yayimli politika analitik
// toplamadigini soyluyor; bayrak, politika + magaza formu hazir olmadan bir magaza
// derlemesinin telemetriyi kendiliginden yayina sokmasini engeller.
async function loadAnalyticsFlag(value) {
    vi.resetModules()
    if (value === undefined) vi.stubEnv('VITE_ANALYTICS_ENABLED', undefined)
    else vi.stubEnv('VITE_ANALYTICS_ENABLED', value)
    return import('./featureFlags.js')
}

describe('ANALYTICS_ENABLED bayragi', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

    it('ortam degiskeni yoksa KAPALI olur', async () => {
        expect((await loadAnalyticsFlag(undefined)).ANALYTICS_ENABLED).toBe(false)
    })

    it("'false' / '1' / 'yes' / 'TRUE' ACMAZ, yalnizca 'true' acar", async () => {
        for (const v of ['false', '1', 'yes', 'TRUE']) {
            expect((await loadAnalyticsFlag(v)).ANALYTICS_ENABLED).toBe(false)
        }
        expect((await loadAnalyticsFlag('true')).ANALYTICS_ENABLED).toBe(true)
    })
})

// Uretim bayragi kilidi (XSTOCKS kilidiyle AYNI kalip). NEDEN: bayragi acmak bilincli bir
// degisiklik olmali. Acmadan once gizlilik politikasi guncellenir, Chrome Web Store
// Privacy practices formu doldurulur, nginx access_log kapatilir (ya da saklama suresi
// sinirlanir) ve yeni surum tamamlanir; bu test ancak bunlardan SONRA bilerek guncellenir.
// Ortam dosyasina yanlislikla 'true' yazilirsa kirmizi olur.
describe('ANALYTICS_ENABLED ortam dosyalarinda KAPALI kilitlidir', () => {
    const bayrakSatirlari = (dosya) => readFileSync(fileURLToPath(new URL('../../' + dosya, import.meta.url)), 'utf8')
        .split(/\r?\n/)
        .map((satir) => satir.trim())
        .filter((satir) => satir.startsWith('VITE_ANALYTICS_ENABLED='))

    it('.env.production tam olarak bir VITE_ANALYTICS_ENABLED=false satiri tasir', () => {
        expect(bayrakSatirlari('.env.production')).toEqual(['VITE_ANALYTICS_ENABLED=false'])
    })
})

// --- PRIVATE_ATS_SALE (gizli-mod cok-ag E18) ---------------------------------------------

async function loadAtsSaleFlag(value) {
    vi.resetModules()
    if (value === undefined) vi.stubEnv('VITE_PRIVATE_ATS_SALE', undefined)
    else vi.stubEnv('VITE_PRIVATE_ATS_SALE', value)
    return import('./featureFlags.js')
}

describe('PRIVATE_ATS_SALE bayragi', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

    it('degisken yoksa KAPALI olur -- acik varsaymak Gizli Hesap ATS alimini sessizce yayina sokar', async () => {
        expect((await loadAtsSaleFlag(undefined)).PRIVATE_ATS_SALE).toBe(false)
    })

    it("yalnizca tam 'true' metni acar; 'TRUE', '1', 'yes', bos ve 'false' ACMAZ", async () => {
        for (const v of ['TRUE', '1', 'yes', '', 'false']) {
            expect((await loadAtsSaleFlag(v)).PRIVATE_ATS_SALE, v).toBe(false)
        }
        expect((await loadAtsSaleFlag('true')).PRIVATE_ATS_SALE).toBe(true)
    })

    it('gizlilik bayragindan BAGIMSIZ okunur (bu bayrak PRIVACY_ENABLED i acmaz ve ondan etkilenmez)', async () => {
        vi.resetModules()
        vi.stubEnv('VITE_PRIVATE_ATS_SALE', 'true')
        vi.stubEnv('VITE_PRIVACY_ENABLED', 'false')
        const flags = await import('./featureFlags.js')
        expect(flags.PRIVATE_ATS_SALE).toBe(true)
        expect(flags.PRIVACY_ENABLED).toBe(false)
    })
})
