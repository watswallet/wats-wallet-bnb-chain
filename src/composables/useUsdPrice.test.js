import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUsdPrice, _onbellegiTemizle } from './useUsdPrice'

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
