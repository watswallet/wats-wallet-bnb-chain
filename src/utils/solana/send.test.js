import { describe, it, expect, vi, afterEach } from 'vitest'
import { prepareTransferContext, broadcastSignedTransaction } from './send'
import { SOL_NATIVE_MARKER } from './constants'

const FROM = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const TO = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
// GERCEK, dogrulanmis egri-disi (PDA) adres - buildTransferPlan.test.js'teki
// OFF_CURVE ile AYNI: bir cuzdanin ozel anahtari yoktur, bu adrese giden
// fonlar GERI ALINAMAZ.
const OFF_CURVE = 'FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B'

const solanaRpc = vi.fn()
vi.mock('./client', () => ({ solanaRpc: (...a) => solanaRpc(...a), SOLANA_API_BASE: 'https://api.test' }))

afterEach(() => { vi.clearAllMocks() })

function stubRpc({ ataInfo = null } = {}) {
    solanaRpc.mockImplementation(async (method) => {
        if (method === 'getLatestBlockhash') return { value: { blockhash: 'BH1', lastValidBlockHeight: 100 } }
        if (method === 'getMinimumBalanceForRentExemption') return 890880
        if (method === 'getAccountInfo') return { value: ataInfo }
        throw new Error(`beklenmeyen metot: ${method}`)
    })
}

describe('prepareTransferContext', () => {
    it('SOL transferinde ATA hic sorgulanmaz', async () => {
        stubRpc()
        const ctx = await prepareTransferContext({ from: FROM, to: TO, mint: SOL_NATIVE_MARKER })

        expect(ctx.blockhash).toBe('BH1')
        expect(ctx.recipientAtaExists).toBe(true)
        expect(ctx.ataRentLamports).toBe(0)
        expect(solanaRpc).not.toHaveBeenCalledWith('getAccountInfo', expect.anything())
    })

    it('SPL: alicinin ATA si varsa ek kira yok', async () => {
        stubRpc({ ataInfo: { lamports: 2039280 } })
        const ctx = await prepareTransferContext({ from: FROM, to: TO, mint: MINT })

        expect(ctx.recipientAtaExists).toBe(true)
        expect(ctx.ataRentLamports).toBe(0)
    })

    it('SPL: alicinin ATA si yoksa kira tutari doner', async () => {
        stubRpc({ ataInfo: null })
        const ctx = await prepareTransferContext({ from: FROM, to: TO, mint: MINT })

        expect(ctx.recipientAtaExists).toBe(false)
        expect(ctx.ataRentLamports).toBeGreaterThan(0)
    })

    // Kira minimumu Home'daki "Maks" dugmesi icin gerekli: bu deger olmadan
    // kullanici tum bakiyesini gonderir ve hesabi silinebilir hale gelir.
    it('kira muafiyeti minimumu her zaman doner', async () => {
        stubRpc()
        const ctx = await prepareTransferContext({ from: FROM, to: TO, mint: SOL_NATIVE_MARKER })
        expect(ctx.rentExemptLamports).toBe(890880)
    })

    it('blockhash alinamazsa hata firlatilir', async () => {
        solanaRpc.mockImplementation(async (method) => {
            if (method === 'getLatestBlockhash') return { value: {} }
            return 890880
        })
        await expect(prepareTransferContext({ from: FROM, to: TO, mint: SOL_NATIVE_MARKER }))
            .rejects.toThrow('BLOCKHASH_UNAVAILABLE')
    })

    // RPC/proxy bozuk bir govdeyle "basarili" donerse, deger SESSIZCE gecerli bir
    // kira muafiyetiymis gibi kabul EDILMEMELI.
    //
    // Kritik olan, degerin ONCEDEN Number()'a ZORLANMAMASIDIR: Number(null),
    // Number('') ve Number(false) hepsi 0'dir ve 0 hem sonlu hem negatif
    // olmayan bir sayidir, yani "sonlu ve >= 0 mi" kontrolunu SORUNSUZ gecerler.
    // Bu durumda rentExemptLamports = 0 olur, maxSendableSol TUM bakiyeyi
    // onerir, hesap kira muafiyeti esiginin altina duser ve calistiricilar
    // tarafindan SILINEBILIR -- tam olarak buildTransferPlan.js'in
    // isValidLamportNumber ile kapattigi delik. Bu yuzden deger daha bastan
    // `typeof === 'number'` degilse reddedilir; hicbir cevrim denenmez.
    const GECERSIZ_KIRA = [
        ['null', null],
        ['bos dizge', ''],
        ['false', false],
        ['undefined', undefined],
        ['NaN', NaN],
        ['sayisal olmayan dizge', 'abc'],
        // '890880' typeof 'number' DEGIL: sessizce 890880'e cevrilip
        // gecirilmemeli, cunku buildTransferPlan/maxSendableSol GERCEK number
        // disinda hicbir seyi kabul etmiyor ve dizgeyi 0 sayardi.
        ['sayisal dizge', '890880'],
    ]

    it.each(GECERSIZ_KIRA)('kira muafiyeti %s donerse ACIKCA reddedilir', async (_ad, deger) => {
        solanaRpc.mockImplementation(async (method) => {
            if (method === 'getLatestBlockhash') return { value: { blockhash: 'BH1', lastValidBlockHeight: 100 } }
            if (method === 'getMinimumBalanceForRentExemption') return deger
            throw new Error(`beklenmeyen metot: ${method}`)
        })
        await expect(prepareTransferContext({ from: FROM, to: TO, mint: SOL_NATIVE_MARKER }))
            .rejects.toThrow('RENT_EXEMPTION_UNAVAILABLE')
    })

    // Negatif bir kira anlamsizdir; ayni sekilde reddedilir.
    it('kira muafiyeti negatif donerse ACIKCA reddedilir', async () => {
        solanaRpc.mockImplementation(async (method) => {
            if (method === 'getLatestBlockhash') return { value: { blockhash: 'BH1', lastValidBlockHeight: 100 } }
            if (method === 'getMinimumBalanceForRentExemption') return -1
            throw new Error(`beklenmeyen metot: ${method}`)
        })
        await expect(prepareTransferContext({ from: FROM, to: TO, mint: SOL_NATIVE_MARKER }))
            .rejects.toThrow('RENT_EXEMPTION_UNAVAILABLE')
    })

    // Kontrolun ters yonu: MESRU bir 0 (gercek bir number) reddedilmemeli.
    // Tip kontrolu "sifira benzeyen her sey"i degil, YALNIZCA number OLMAYANI
    // eler; aksi halde gecerli bir zincir yaniti yuzunden gonderim imkansizlasirdi.
    it('kira muafiyeti GERCEK 0 donerse kabul edilir', async () => {
        solanaRpc.mockImplementation(async (method) => {
            if (method === 'getLatestBlockhash') return { value: { blockhash: 'BH1', lastValidBlockHeight: 100 } }
            if (method === 'getMinimumBalanceForRentExemption') return 0
            throw new Error(`beklenmeyen metot: ${method}`)
        })
        const ctx = await prepareTransferContext({ from: FROM, to: TO, mint: SOL_NATIVE_MARKER })
        expect(ctx.rentExemptLamports).toBe(0)
    })

    // SPL yolunda ATA yokken kira null donerse: buildTransferPlan'in genel
    // ATA_RENT_REQUIRED'ina degil, RPC hatasini isaret eden daha net
    // ATA_RENT_UNAVAILABLE'a dusmeli.
    it('SPL: ATA kirasi null donerse ATA_RENT_UNAVAILABLE ile reddedilir', async () => {
        solanaRpc.mockImplementation(async (method, params) => {
            if (method === 'getLatestBlockhash') return { value: { blockhash: 'BH1', lastValidBlockHeight: 100 } }
            if (method === 'getAccountInfo') return { value: null }
            if (method === 'getMinimumBalanceForRentExemption') {
                const [size] = params
                return size === 0 ? 890880 : null // sistem hesabi GECERLI, ATA (165 bayt) BOZUK
            }
            throw new Error(`beklenmeyen metot: ${method}`)
        })
        await expect(prepareTransferContext({ from: FROM, to: TO, mint: MINT }))
            .rejects.toThrow('ATA_RENT_UNAVAILABLE')
    })

    // Egri disi (PDA/token hesabi) bir aliciya SPL gonderimi: getAssociatedTokenAddressSync
    // BU KONTROLDEN ONCE cagrilirsa argumansiz bir TokenOwnerOffCurveError firlatir
    // (message === ''), yani cagirana FALSY bir hata ulasir. Kontrol burada, ATA
    // turetmesinden ONCE, buildTransferPlan ile AYNI tanidik kodla yapilmali.
    it('SPL: egri disi alici RECIPIENT_NOT_WALLET ile reddedilir', async () => {
        stubRpc()
        await expect(prepareTransferContext({ from: FROM, to: OFF_CURVE, mint: MINT }))
            .rejects.toThrow('RECIPIENT_NOT_WALLET')
        expect(solanaRpc).not.toHaveBeenCalledWith('getAccountInfo', expect.anything())
    })
})

describe('broadcastSignedTransaction', () => {
    it('imzali islemi sendTransaction ile yollar ve imzayi doner', async () => {
        solanaRpc.mockResolvedValue('SIG123')
        const sig = await broadcastSignedTransaction('BASE64TX')

        expect(sig).toBe('SIG123')
        const [method, params] = solanaRpc.mock.calls[0]
        expect(method).toBe('sendTransaction')
        expect(params[0]).toBe('BASE64TX')
        expect(params[1]).toMatchObject({ encoding: 'base64' })
    })

    // Preflight ACIK: yetersiz bakiye veya yanlis ATA gibi sessiz
    // basarisizliklari YAYINDAN ONCE yakalar. Atlanirsa islem zincire gider,
    // dususe gecer ve kullanici ucreti odemis olur.
    it('preflight acik birakilir', async () => {
        solanaRpc.mockResolvedValue('SIG123')
        await broadcastSignedTransaction('BASE64TX')
        expect(solanaRpc.mock.calls[0][1][1]).toMatchObject({ skipPreflight: false })
    })

    // toMatchObject (yukarida) fazladan veya DEGISMIS bir alani YAKALAMAZ --
    // DEFAULT_BROADCAST_OPTIONS.maxRetries 3'ten 5'e kaysa yukaridaki iki test
    // yine yesil kalirdi. background.js:585 hicbir options gecirmeden bu
    // fonksiyonu cagiriyor; bu yuzden RPC'ye giden nesnenin TAM OLARAK
    // degisiklikten ONCEki degerle ayni oldugu burada, alan alan kilitlenir.
    it('opsiyonsuz cagrida RPC argumanlari TAM OLARAK eskisiyle ayni', async () => {
        solanaRpc.mockResolvedValue('SIG123')
        await broadcastSignedTransaction('BASE64TX')
        expect(solanaRpc.mock.calls[0][1][1]).toEqual({
            encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3
        })
    })

    // signAndSendTransaction dapp'in `options`'ini (temizlenmis haliyle)
    // gecirmek zorunda: maxRetries orada belirlenir. Ikinci bir yayin yolu
    // ACILMAZ (§6.4: "asla new Connection") -- bu yuzden opsiyonlar mevcut
    // fonksiyona parametre olarak girer.
    it('verilen opsiyonlar sendTransaction a gecirilir', async () => {
        solanaRpc.mockResolvedValue('SIG123')
        await broadcastSignedTransaction('BASE64TX', {
            encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 1
        })
        expect(solanaRpc.mock.calls[0][1][1]).toMatchObject({ maxRetries: 1 })
    })

    // IKINCI KATMAN: sanitizeSendOptions cagrilmayi UNUTSA bile (ya da baska
    // bir cagiran ham dapp opsiyonlarini verse) preflight KAPATILAMAZ.
    it('skipPreflight true verilse bile ZORLA false yayinlanir', async () => {
        solanaRpc.mockResolvedValue('SIG123')
        await broadcastSignedTransaction('BASE64TX', { skipPreflight: true, encoding: 'base58', maxRetries: 1 })

        const gonderilen = solanaRpc.mock.calls[0][1][1]
        expect(gonderilen.skipPreflight).toBe(false)
        expect(gonderilen.encoding).toBe('base64')
    })
})
