import { describe, it, expect, vi } from 'vitest'
import { getJettonBalance } from './jettonBalance'

// ONDALIK ASLA VARSAYILMAZ. Jettonlar 9 ondalik DEGILDIR: USDT-TON 6 kullanir. Bu kod
// tabani EVM'de 18 varsaydigi icin P1'de bir kez yanmisti. Yanlis ondalik yalnizca
// gorunumu bozmaz: kullanici gonderirken de AYNI carpani kullanir.
//
// HATA 0'A CEVRILMEZ (tonBalance.js ile ayni kural), ISTISNASIZ: proxy dustugunde
// "bakiyen sifir" demek kullaniciya parasinin kayboldugunu dusundurur.
//
// DUZELTME TURU 1 (B1): eskiden "exit_code: -13" gibi bir mesaj kalibina bakan bir regex
// dagitilmamis cuzdani sessizce 0'a ceviriyordu. Bu YANLIS bir varsayima dayaniyordu:
// @ton/ton'un JettonWallet.getBalance'i (node_modules/@ton/ton/dist/jetton/JettonWallet.js:
// 18-25) dagitilmamis (aktif olmayan) cuzdanda zaten HATA ATMADAN 0n donuyor - regex hic
// ateslenmiyordu o durumda. Ateslendigi TEK durum, AKTIF bir cuzdanda get-method GERCEKTEN
// patladiginda idi - o zaman regex gercek hatayi yutup SAHTE "bakiye 0" gosteriyordu.
// Asagidaki testler artik BUNU yansitiyor: "dagitilmamis" senaryosu mock'un 0n DONMESIYLE
// modellenir (hata FIRLATMADAN - kutuphanenin gercek davranisi), ve "exit_code: -13" gibi
// bir mesajla gelen HATA artik YUTULMADIGINI kanitlayan ayri bir test var.

// 'EQ1' gibi uydurma bir dize Address.parse tarafindan GERCEKTEN reddedilir (bu modul
// walletAddress'i parse eder - jettonAddress.js'in onbellege yazdigi turetilmis adres
// gibi). Uydurma adresle mock'a hic ulasilmadan parse hatasi firlar ve "genel zincir
// hatasi YUTULMAZ" testi bunu YANLIS nedenle gecer (parse hatasi da rejects.toThrow'u
// karsilar). Bu yuzden burada jettonAddress.test.js'teki DERIVED gibi GERCEKTEN
// parse edilebilir bir adres kullaniliyor - testler mock'un getBalance'ina fiilen ulasmali.
const WALLET = 'EQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG'

const makeClient = (balance) => ({ open: vi.fn(() => ({ getBalance: vi.fn(async () => balance) })) })

describe('getJettonBalance', () => {
    it('6 ondalikli jettonu dogru cevirir', async () => {
        expect(await getJettonBalance({ client: makeClient(1500000n), walletAddress: WALLET, decimals: 6 })).toBeCloseTo(1.5, 9)
    })

    it('9 ondalikli jettonu dogru cevirir', async () => {
        expect(await getJettonBalance({ client: makeClient(1500000000n), walletAddress: WALLET, decimals: 9 })).toBeCloseTo(1.5, 9)
    })

    it('ondalik verilmezse HATA firlatir - 9 varsaymaz', async () => {
        await expect(getJettonBalance({ client: makeClient(1500000n), walletAddress: WALLET }))
            .rejects.toThrow('JETTON_DECIMALS_MISSING')
    })

    it('cuzdan dagitilmamissa sifir doner - kutuphanenin kendi 0n donusuyle, regex ILE DEGIL', async () => {
        // Gercek JettonWallet.getBalance dagitilmamis cuzdanda HATA ATMAZ, dogrudan 0n
        // doner (kaynak: node_modules/@ton/ton/dist/jetton/JettonWallet.js:18-25). Bu
        // yuzden mock burada bir HATA firlatmiyor, kutuphanenin GERCEKTE yaptigi gibi
        // sadece 0n donduruyor - ozel bir "dagitilmamis" dal koddan artik yok, olagan
        // sifir-bakiye akisiyla aynen ele aliniyor.
        expect(await getJettonBalance({ client: makeClient(0n), walletAddress: WALLET, decimals: 6 })).toBe(0)
    })

    it('genel zincir hatasi YUTULMAZ', async () => {
        const client = { open: () => ({ getBalance: async () => { throw new Error('proxy down') } }) }
        await expect(getJettonBalance({ client, walletAddress: WALLET, decimals: 6 })).rejects.toThrow('proxy down')
    })

    it('eski regex kalibiyla eslesen bir hata bile artik YUTULMAZ - B1 duzeltmesinin bekcisi', async () => {
        // Kaldirilan regex tam olarak bu mesaj kalibina bakiyordu ve onu yutup 0 donuyordu.
        // Kutuphane GERCEKTE bu mesajla hata FIRLATMIYOR (dagitilmamis durumda sessizce 0n
        // donuyor) - ama EGER bir gun AKTIF bir cuzdanda gercek bir get-method hatasi
        // TESADUFEN ayni metni tasirsa (ornegin dugum "exit_code: -13" iceren farkli bir
        // hata dondururse), bu artik SESSIZCE 0'a cevrilmemeli. Bu test, regex kaldirildiktan
        // sonra boyle bir mesajin da diger her hata gibi yukari firladigini kanitlar.
        const client = { open: () => ({ getBalance: async () => { throw new Error('exit_code: -13') } }) }
        await expect(getJettonBalance({ client, walletAddress: WALLET, decimals: 6 })).rejects.toThrow('exit_code: -13')
    })

    // Ku1: eskiden yalniz Number.isInteger kontrol ediliyordu - negatif/anlamsiz buyuk
    // bir "decimals" de tamsayi oldugu icin GECIYORDU. jettonTransfer.js'teki
    // MAX_JETTON_DECIMALS (30) sinirinin AYNISI burada da uygulanir.
    it('ondalik negatifse JETTON_DECIMALS_INVALID firlatir', async () => {
        await expect(getJettonBalance({ client: makeClient(0n), walletAddress: WALLET, decimals: -1 }))
            .rejects.toThrow('JETTON_DECIMALS_INVALID')
    })

    it('ondalik sinirin (30) UZERINDEYSE JETTON_DECIMALS_INVALID firlatir', async () => {
        await expect(getJettonBalance({ client: makeClient(0n), walletAddress: WALLET, decimals: 31 }))
            .rejects.toThrow('JETTON_DECIMALS_INVALID')
    })

    // DUZELTME TURU 1 (B2): `Number(raw) / 10 ** decimals` (eski kod) raw 2^53'u
    // (9007199254740991, 9 ondalikli bir jettonda yalnizca ~9 milyon token) astiginda
    // BOLMEDEN ONCE zaten yuvarliyordu; bu yuvarlama sonraki bolmeyle duzelmiyordu. Bu
    // test o hatanin BIR DAHA GERI GELMEDIGINI kalici olarak korur.
    it('buyuk ham degerde hassasiyet korunur - BigInt once dizgeye sonra Number a cevrilir', async () => {
        // raw ~6.2e18, 9 ondalikla ~6.2 milyar token - gercekci (buyuk arzli meme token).
        // Gercek deger: 6200076800.916655056. Number(raw)/10**9 (eski/naif yol) bunu
        // 6200076800.916656 olarak YUVARLAR (yanlis). BigInt->dize->Number (dogru yol)
        // en yakin double olan 6200076800.916655'i verir.
        const raw = 6200076800916655056n
        const result = await getJettonBalance({ client: makeClient(raw), walletAddress: WALLET, decimals: 9 })
        expect(result).toBe(6200076800.916655)
        expect(result).not.toBe(Number(raw) / 10 ** 9)
    })
})
