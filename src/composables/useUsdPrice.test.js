import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUsdPrice, _onbellegiTemizle } from './useUsdPrice'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Gercek zincir kimlikleri: 1 = Ethereum (ethereum), -239 = TON (the-open-network).
// Uydurma kimlik kullanilsaydi buildNativeToken null donerdi ve testler
// "fiyat yok" dalinda kosup asil yolu HIC olcmezdi.
const ETH = 1
const TON = -239

const yanit = (priceUSD) => ({ data: { tokens: [{ market_data: { priceUSD } }] } })

function kur({ balances = {}, post } = {}) {
    const http = { post: post || vi.fn().mockResolvedValue(yanit(2)) }
    const api = useUsdPrice({
        tokenBalances: () => balances,
        apiBase: () => 'https://ornek.test',
        http,
        now: () => kur.saat,
    })
    return { ...api, http }
}
kur.saat = 1_000_000

beforeEach(() => {
    _onbellegiTemizle()
    kur.saat = 1_000_000
})

describe('useUsdPrice - bellekteki satir', () => {
    it('Home un yazdigi fiyati kullanir ve AG TURU YAPMAZ', async () => {
        const { price, loadNative, http } = kur({ balances: { '1_0x0': { price: 3500 } } })

        await loadNative(ETH)

        expect(price.value).toBe(3500)
        expect(http.post).not.toHaveBeenCalled()
    })

    it('BASKA zincirin satiri kullanilmaz - anahtar chainId TASIR', async () => {
        // Ayni '0x0' adresi her zincirin native varligi. Anahtar yalniz adres
        // olsaydi Ethereum fiyati TON ucretine yazilirdi.
        const { price, loadNative, http } = kur({ balances: { '1_0x0': { price: 3500 } } })

        await loadNative(TON)

        expect(price.value).toBe(2)
        expect(http.post).toHaveBeenCalledOnce()
    })

    it.each([
        ['sifir', 0],
        ['negatif', -5],
        ['metin', 'abc'],
        ['bos', ''],
        ['null', null],
    ])('bellekteki %s fiyat KULLANILMAZ, sunucuya sorulur', async (_ad, bozuk) => {
        const { price, loadNative, http } = kur({ balances: { '1_0x0': { price: bozuk } } })

        await loadNative(ETH)

        expect(http.post).toHaveBeenCalledOnce()
        expect(price.value).toBe(2)
    })
})

describe('useUsdPrice - sunucu yolu', () => {
    it('zincirin KANONIK native kimligiyle sorar', async () => {
        const post = vi.fn().mockResolvedValue(yanit(5.5))
        const { price, loadNative } = kur({ post })

        await loadNative(TON)

        expect(post).toHaveBeenCalledWith('https://ornek.test/getTokensDataById', { ids: ['the-open-network'] })
        expect(price.value).toBe(5.5)
    })

    it('market alani da okunur (iki isim de dolasiyor)', async () => {
        const post = vi.fn().mockResolvedValue({ data: { tokens: [{ market: { priceUSD: 7 } }] } })
        const { price, loadNative } = kur({ post })

        await loadNative(ETH)

        expect(price.value).toBe(7)
    })

    it('istek PATLARSA null doner, FIRLATMAZ', async () => {
        const post = vi.fn().mockRejectedValue(new Error('403'))
        const { price, loadNative } = kur({ post })

        await expect(loadNative(ETH)).resolves.toBeUndefined()
        expect(price.value).toBeNull()
    })

    it.each([
        ['bos token listesi', { data: { tokens: [] } }],
        ['tokens yok', { data: {} }],
        ['sifir fiyat', yanit(0)],
        ['fiyat yok', yanit(undefined)],
    ])('%s -> null (asla 0)', async (_ad, cevap) => {
        const post = vi.fn().mockResolvedValue(cevap)
        const { price, loadNative } = kur({ post })

        await loadNative(ETH)

        // 0 dondurmek ekranda "$0.00" yazdirirdi: ucret bedava demek olurdu.
        expect(price.value).toBeNull()
    })

    it('TANINMAYAN zincirde SORMAZ', async () => {
        const { price, loadNative, http } = kur()

        await loadNative(999999)

        expect(http.post).not.toHaveBeenCalled()
        expect(price.value).toBeNull()
    })

    it('chainId YOKSA sormaz', async () => {
        const { price, loadNative, http } = kur()

        await loadNative(undefined)

        expect(http.post).not.toHaveBeenCalled()
        expect(price.value).toBeNull()
    })

    it('apiBase bossa sormaz', async () => {
        const http = { post: vi.fn() }
        const { price, loadNative } = useUsdPrice({ tokenBalances: () => ({}), apiBase: () => '', http })

        await loadNative(ETH)

        expect(http.post).not.toHaveBeenCalled()
        expect(price.value).toBeNull()
    })
})

describe('useUsdPrice - onbellek', () => {
    it('ayni zincir icin ikinci acilista TEKRAR SORMAZ', async () => {
        const post = vi.fn().mockResolvedValue(yanit(3))
        const a = kur({ post })
        await a.loadNative(ETH)

        // Ekran kapanip yeniden aciliyor: yeni ornek, AYNI modul onbellegi.
        const b = kur({ post })
        await b.loadNative(ETH)

        expect(post).toHaveBeenCalledOnce()
        expect(b.price.value).toBe(3)
    })

    it('BASARISIZ sonuc da onbelleklenir - patlayan uc her acista denenmez', async () => {
        const post = vi.fn().mockRejectedValue(new Error('404'))
        const a = kur({ post })
        await a.loadNative(ETH)

        const b = kur({ post })
        await b.loadNative(ETH)

        expect(post).toHaveBeenCalledOnce()
        expect(b.price.value).toBeNull()
    })

    it('tazelik suresi GECINCE yeniden sorulur', async () => {
        const post = vi.fn().mockResolvedValue(yanit(3))
        const a = kur({ post })
        await a.loadNative(ETH)

        kur.saat += 61_000
        const b = kur({ post })
        await b.loadNative(ETH)

        expect(post).toHaveBeenCalledTimes(2)
    })

    it('onbellek zincir BASINA - bir zincirin cevabi otekine sizmaz', async () => {
        const post = vi.fn()
            .mockResolvedValueOnce(yanit(3500))
            .mockResolvedValueOnce(yanit(5.5))
        const a = kur({ post })

        await a.loadNative(ETH)
        expect(a.price.value).toBe(3500)

        await a.loadNative(TON)
        expect(a.price.value).toBe(5.5)
    })
})

describe('useUsdPrice - kimlikle okuma (ATS yolu)', () => {
    it('verilen coingecko kimligiyle sorar', async () => {
        const post = vi.fn().mockResolvedValue(yanit(0.0123))
        const { price, loadById } = kur({ post })

        await loadById('alltoscan')

        expect(post).toHaveBeenCalledWith('https://ornek.test/getTokensDataById', { ids: ['alltoscan'] })
        expect(price.value).toBe(0.0123)
    })

    it('kimlik YOKSA sormaz', async () => {
        const { price, loadById, http } = kur()

        await loadById(undefined)

        expect(http.post).not.toHaveBeenCalled()
        expect(price.value).toBeNull()
    })

    it('sunucu o kimligi TANIMIYORSA null - asla 0', async () => {
        // ATS gibi kucuk bir token listede olmayabilir; o zaman kart dolar
        // satirini HIC cizmemeli. 0 donmek "ucret bedava" demek olurdu.
        const post = vi.fn().mockResolvedValue({ data: { success: false } })
        const { price, loadById } = kur({ post })

        await loadById('alltoscan')

        expect(price.value).toBeNull()
    })

    it('onbellek native yoluyla PAYLASILIR - ayni kimlik iki kez sorulmaz', async () => {
        const post = vi.fn().mockResolvedValue(yanit(4))
        const a = kur({ post })
        await a.loadById('ethereum')

        // Ethereum'un native kimligi de 'ethereum': ikinci cagri onbellekten gelmeli.
        const b = kur({ post })
        await b.loadNative(ETH)

        expect(post).toHaveBeenCalledOnce()
        expect(b.price.value).toBe(4)
    })

    it('iki ornek BIRBIRININ fiyatini ezmez (gaz + ATS ayni ekranda)', async () => {
        const post = vi.fn()
            .mockResolvedValueOnce(yanit(3500))
            .mockResolvedValueOnce(yanit(0.02))
        const gaz = kur({ post })
        const ats = kur({ post })

        await gaz.loadNative(ETH)
        await ats.loadById('alltoscan')

        expect(gaz.price.value).toBe(3500)
        expect(ats.price.value).toBe(0.02)
    })
})

// SOLANA DALI (K1). Solana kimligi METINDIR ('solana-mainnet'): buildNativeToken
// sayisal arama yaptigi icin onu HICBIR kayitla eslemez ve eskiden fiyat sessizce
// null kaliyordu (ag ucretinin fiyat karsiligi Solana'da hic cizilmiyordu).
describe('useUsdPrice - Solana dali', () => {
    const SOL = 'solana-mainnet'

    it('solana kimligiyle (nativeCoingeckoId) sorar ve fiyati doner', async () => {
        const post = vi.fn().mockResolvedValue(yanit(150))
        const { price, loadNative } = kur({ post })

        await loadNative(SOL)

        expect(post).toHaveBeenCalledOnce()
        expect(post).toHaveBeenCalledWith('https://ornek.test/getTokensDataById', { ids: ['solana'] })
        expect(price.value).toBe(150)
    })

    it.each([
        ['sifir fiyat', yanit(0)],
        ['fiyat yok', yanit(undefined)],
        ['bos liste', { data: { tokens: [] } }],
    ])('%s: price null, 0 DEGIL (satir cizilmez)', async (_ad, cevap) => {
        const { price, loadNative } = kur({ post: vi.fn().mockResolvedValue(cevap) })

        await loadNative(SOL)

        expect(price.value).toBeNull()
    })

    it('istek patlarsa null doner, FIRLATMAZ', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const { price, loadNative } = kur({ post: vi.fn().mockRejectedValue(new Error('403')) })

        await expect(loadNative(SOL)).resolves.toBeUndefined()

        expect(price.value).toBeNull()
    })

    it('Ethereum fiyati Solana ucretine SIZMAZ - onbellek kimlik basina', async () => {
        const post = vi.fn()
            .mockResolvedValueOnce(yanit(3500))
            .mockResolvedValueOnce(yanit(150))
        const eth = kur({ post })
        const sol = kur({ post })

        await eth.loadNative(ETH)
        await sol.loadNative(SOL)

        expect(eth.price.value).toBe(3500)
        expect(sol.price.value).toBe(150)
        expect(post).toHaveBeenNthCalledWith(2, 'https://ornek.test/getTokensDataById', { ids: ['solana'] })
    })

    it('loadNative(1) regresyonsuz: Ethereum kimligiyle sorar', async () => {
        const post = vi.fn().mockResolvedValue(yanit(3500))
        const { price, loadNative } = kur({ post })

        await loadNative(ETH)

        expect(post).toHaveBeenCalledWith('https://ornek.test/getTokensDataById', { ids: ['ethereum'] })
        expect(price.value).toBe(3500)
    })

    it('bellekteki baska zincir satiri Solana icin KULLANILMAZ', async () => {
        const post = vi.fn().mockResolvedValue(yanit(150))
        const { price, loadNative } = kur({ post, balances: { '1_0x0': { price: 3500 } } })

        await loadNative(SOL)

        expect(price.value).toBe(150)
    })
})

describe('useUsdPrice - kaynak taramasi', () => {
    const kaynak = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'useUsdPrice.js'), 'utf8')

    it('zincir tipi kindOf ile okunur, supported_chains.json dogrudan import edilmez', () => {
        // Yalniz 'kindOf' kelimesinin gecmesi yetmez (import satiri da eslesir): Solana dali
        // kindOf(chainId) === 'solana' sorusuna BAGLI olmali.
        expect(kaynak).toMatch(/kindOf\(chainId\)\s*===\s*'solana'/)
        expect(kaynak).not.toMatch(/supported_chains\.json/)
    })

    it('"ton degilse EVM" bicimi yok', () => {
        expect(kaynak).not.toMatch(/!\s*isTon\s*\(/)
        expect(kaynak).not.toMatch(/kind\s*!==?\s*['"]ton['"]/)
    })
})

// final SU-16 (Constraint 20): Solana bayragi KAPALIYKEN eski davranis aynen kalir. Bayrak
// derleme sabitidir (featureFlags.SOLANA_ENABLED); testler vitest.config.js ile ACIK kosar.
// Burada env gecici olarak kapatilir ve modul grafigi yeniden yuklenir (supportedChains.js
// Solana kaydini listeden dusurur, kindOf Solana'yi gormez).
describe('useUsdPrice - Solana bayragi KAPALI (Constraint 20)', () => {
    async function taze(bayrak) {
        vi.stubEnv('VITE_SOLANA_ENABLED', bayrak)
        vi.resetModules()
        const mod = await import('./useUsdPrice')
        mod._onbellegiTemizle()
        const post = vi.fn().mockResolvedValue(yanit(150))
        const api = mod.useUsdPrice({
            tokenBalances: () => ({}),
            apiBase: () => 'https://ornek.test',
            http: { post },
            now: () => 1_000_000,
        })
        return { api, post }
    }

    it("bayrak kapali: loadNative('solana-mainnet') sunucuya SORMAZ ve price null kalir", async () => {
        try {
            const { api, post } = await taze('false')
            await api.loadNative('solana-mainnet')
            expect(post).not.toHaveBeenCalled()
            expect(api.price.value).toBeNull()
        } finally {
            vi.unstubAllEnvs()
            vi.resetModules()
        }
    })

    // Kontrol: ayni senaryo bayrak ACIKKEN sorar -- test bayragi GERCEKTEN ayirt ediyor.
    it("kontrol: bayrak acik: loadNative('solana-mainnet') Solana kimligiyle sorar", async () => {
        try {
            const { api, post } = await taze('true')
            await api.loadNative('solana-mainnet')
            expect(post).toHaveBeenCalledWith('https://ornek.test/getTokensDataById', { ids: ['solana'] })
            expect(api.price.value).toBe(150)
        } finally {
            vi.unstubAllEnvs()
            vi.resetModules()
        }
    })

    it('bayrak kapali: EVM (Ethereum) dali etkilenmez', async () => {
        try {
            const { api, post } = await taze('false')
            await api.loadNative(1)
            expect(post).toHaveBeenCalledWith('https://ornek.test/getTokensDataById', { ids: ['ethereum'] })
            expect(api.price.value).toBe(150)
        } finally {
            vi.unstubAllEnvs()
            vi.resetModules()
        }
    })
})
