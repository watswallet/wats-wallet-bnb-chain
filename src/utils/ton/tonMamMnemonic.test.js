import { describe, it, expect } from 'vitest'
import { mnemonicNew, mnemonicWordList } from '@ton/crypto'
import { TonKeychainRoot } from '@ton-keychain/core'
import { isMamMnemonic } from './tonMamMnemonic'
import { isTonMnemonic } from './tonMnemonic'

// MAM (Multi-Account Mnemonic) Tonkeeper'in kendi cok hesapli semasidir: TEK
// ifade -> N hesap. UCUNCU bir ailedir ve digerlerinden AYRISIR.
//
// Olculdu (2026-09-09): 40 MAM ifadesinden 0'i BIP39 checksum'indan, 0'i
// TON-native version kontrolunden gecti. Yani sorulmazsa "taninmayan ifade"
// gorunur ve kullanici saglam ifadesini BOZUK sanir.
//
// `@ton-keychain/core` GPL-3.0'dir ve URETIM kodundan CIKARILDI (gerekce
// tonMamMnemonic.js'in bas yorumunda). Burada devDependency olarak duruyor:
// asagidaki fark testi bizim uygulamamizi ONA KARSI kosturur, yani sema
// saparsa yayinlanan kod degil BU TEST kirilir.

describe('isMamMnemonic', () => {
    it('gercek bir MAM ifadesini tanir', async () => {
        const root = await TonKeychainRoot.generate()
        expect(await isMamMnemonic(root.mnemonic)).toBe(true)
    })

    it('metin girdiyi de kabul eder', async () => {
        const root = await TonKeychainRoot.generate()
        expect(await isMamMnemonic(root.mnemonic.join(' '))).toBe(true)
    })

    it('TON-native ifade MAM DEGILDIR', async () => {
        const words = await mnemonicNew()
        expect(await isMamMnemonic(words)).toBe(false)
    })

    it('MAM ifadesi TON-native DEGILDIR -- aileler ayrisiyor', async () => {
        const root = await TonKeychainRoot.generate()
        expect(await isTonMnemonic(root.mnemonic)).toBe(false)
    })

    // FIRLATMAZ: cagiran taraf (ice aktarma ekrani) bunu bir SORU olarak soruyor
    // ve hayir cevabi bir hata degildir.
    it('cop girdi FIRLATMAZ, false doner', async () => {
        expect(await isMamMnemonic('hic de mnemonic degil')).toBe(false)
        expect(await isMamMnemonic('')).toBe(false)
        expect(await isMamMnemonic(null)).toBe(false)
        expect(await isMamMnemonic(['tek'])).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// FARK TESTI -- uretim kodu ile GPL kutuphanesi arasindaki tek baglanti.
// ---------------------------------------------------------------------------
// tonMamMnemonic.js kuralin kendisini yaziyor (SW-guvenli ciplak crypto.subtle
// ile, GPL kod yayinlanan pakete girmesin diye). Bir kopyanin riski sessiz
// SAPMADIR: sabitlerden biri ya da hmac anahtar/veri sirasi degisirse baska bir
// ifade kumesi MAM sayilir ve kimse fark etmez.
//
// Bu blok o riski kapatir: TOHUMLU (deterministik, dolayisiyla tekrarlanabilir)
// bir rastgele kaynaktan uretilen 600 ifadenin HEPSINDE iki uygulamanin ayni
// cevabi vermesi sart. Uyusmazlik olursa ifade ciktiya yazilir.
describe('isMamMnemonic -- @ton-keychain/core ile fark testi', () => {
    // xorshift32: sabit tohum -> her kosuda AYNI 600 ifade. Basarisizlik
    // tekrarlanabilir olsun diye; Math.random ile bir kere gorup bir daha
    // bulamamak en kotusu olurdu.
    const prng = (seed) => () => {
        seed ^= seed << 13; seed >>>= 0
        seed ^= seed >>> 17
        seed ^= seed << 5; seed >>>= 0
        return seed / 4294967296
    }

    it('600 ifadede kutuphaneyle BIREBIR ayni cevabi verir', async () => {
        const rnd = prng(0x7a11c0de)
        const ORNEK = 600

        let pozitif = 0
        const uyusmazlik = []

        for (let i = 0; i < ORNEK; i++) {
            const words = Array.from(
                { length: 24 },
                () => mnemonicWordList[Math.floor(rnd() * mnemonicWordList.length)]
            )
            const bizim = await isMamMnemonic(words)
            const kutuphane = await TonKeychainRoot.isValidMnemonic(words)

            if (bizim) pozitif++
            if (bizim !== kutuphane) {
                uyusmazlik.push({ ifade: words.join(' '), bizim, kutuphane })
            }
        }

        expect(uyusmazlik).toEqual([])

        // Test BOSALMASIN: ornek kume `true` dalina hic ugramadan gecerse
        // fark testi yalnizca "ikisi de false diyor" demis olur ve sapmayi
        // yakalayamaz. ~1/256 oraniyla 600 ornekte birkac pozitif beklenir.
        expect(pozitif).toBeGreaterThan(0)
    }, 60000)

    // MUTASYON BOSLUGU (bulundu 2026-09-11): rastgele ornekleme `!isTonMnemonic`
    // dalini HIC calistiramaz. Bir ifadenin hem MAM-seed'i (~1/256) hem
    // TON-native saglamasini (~1/256) tutturmasi ~1/65536'dir; 600 ornekte
    // gorunmez. Nitekim o satir `return true` ile degistirildiginde 7 testin
    // tamami YESIL kaliyordu.
    //
    // Asagidaki uc ifade 600.000 orneklik bir taramada bulundu: UCU DE hem
    // MAM-seed kapisini geciyor hem TON-native GECERLI. Kutuphane
    // TON-uyumlulari ACIKCA disladigi icin (`!isTonCompatible`) dogru cevap
    // FALSE'tur -- aileler ortusmez. Dislama kaldirilirsa bu test kirilir.
    const HEM_MAM_SEED_HEM_TON = [
        'similar retire slim century parade brisk oak shallow life capital grief expand taxi describe notable cigar resemble scare web spirit dutch another winner noble',
        'hill crush trip cruel twelve abstract nose mirror hockey shadow sad strategy flock patch assume order pretty circle renew leader erode increase attitude erase',
        'congress space ahead fit blanket business ripple lottery bomb candy rigid hip onion ski monitor federal only electric sting smooth fun file noodle struggle',
    ]

    it('TON-native de olan bir ifade MAM SAYILMAZ', async () => {
        for (const ifade of HEM_MAM_SEED_HEM_TON) {
            const words = ifade.split(' ')

            // Vektorun hala gecerli oldugunu KANITLA: yalnizca `false` beklemek
            // yetmez -- kelimelerden biri degisip vektor sirdan bir ifadeye
            // donuserse test yine gecer ama artik hicbir sey olcmez.
            expect(await isTonMnemonic(words)).toBe(true)

            expect(await isMamMnemonic(words)).toBe(false)
            expect(await TonKeychainRoot.isValidMnemonic(words)).toBe(false)
        }
    }, 30000)

    it('uretilmis MAM ifadelerinde de birebir ayni', async () => {
        for (let i = 0; i < 5; i++) {
            const root = await TonKeychainRoot.generate()
            expect(await isMamMnemonic(root.mnemonic))
                .toBe(await TonKeychainRoot.isValidMnemonic(root.mnemonic))
        }
    }, 60000)
})
