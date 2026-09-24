// Solana gonderim hata eslemesinin TAMLIGI — kaynak uzerinden kilitlenir.
//
// KOK NEDEN (Task 12 brief): buildTransferPlan.js DOKUZ ayri hata adi firlatiyor.
// Eslenmeyen bir ad kullaniciya ham sabit olarak gorunur (ornegin "AMOUNT_TOO_LARGE"
// yazan kirmizi bir kutu). Bu test buildTransferPlan.js + address.js kaynagindaki
// HER `throw new Error('...')` adini toplar ve her birinin SOLANA_SEND_ERRORS
// tablosunda ACIKCA (jenerik dususe guvenmeden) bir karsiligi oldugunu dogrular —
// ileride eklenen bir hata adi boylece SESSIZCE eslemesiz kalamaz.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SOLANA_SEND_ERRORS, resolveSolanaSendError, isKnownSolanaSendError, isAmbiguousBroadcastError } from './sendErrors'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8')

function collectThrownErrorNames(source) {
    const names = new Set()
    // Kapanan tirnaktan hemen sonra ')' YA DA ',' kabul edilir: tek-argumanli
    // `throw new Error('AD')` ile iki-argumanli `throw new Error('AD', { cause })`
    // (Task 26 kontrolor karariyla zorunlu -- alttaki hata `cause` ile korunur)
    // ikisi de yakalanir. Ad hala tirnak icinde BUYUK_HARF+ALT_CIZGI ile ANKORLU:
    // bu, `throw new Error(SOME_CONST)` gibi tirnaksiz bir ifadeyi ya da baska bir
    // yerdeki rastgele metni YAKALAMAZ -- yalnizca gercek throw cagrisinin ilk
    // argumanini genisletir.
    const re = /throw new Error\('([A-Z_]+)'[,)]/g
    let m
    while ((m = re.exec(source))) names.add(m[1])
    return names
}

describe('Solana gonderim hata eslemesi TAM', () => {
    it('buildTransferPlan.js + address.js firlattigi HER ad TABLO da ACIKCA var', () => {
        const thrown = new Set([
            ...collectThrownErrorNames(read('buildTransferPlan.js')),
            ...collectThrownErrorNames(read('address.js')),
        ])

        // Emniyet kemeri: regex deseni kirilirsa (orn. throw sozdizimi degisirse) bu
        // dongu SESSIZCE 0 ad'la "gecer" — bilinen dokuzun hepsinin bulunmus oldugu
        // ayrica dogrulanir, boylece regex'in kendisi de dolayli olarak sinanir.
        expect(thrown.size).toBeGreaterThanOrEqual(9)

        for (const name of thrown) {
            expect(Object.prototype.hasOwnProperty.call(SOLANA_SEND_ERRORS, name), name).toBe(true)
        }
    })

    it('bilinen dokuz ad TABLO da (dokumantasyon ile esli, regex e bagimli degil)', () => {
        const expected = [
            'INVALID_SOLANA_ADDRESS', 'RECIPIENT_NOT_WALLET', 'SELF_TRANSFER',
            'AMOUNT_NOT_POSITIVE', 'AMOUNT_EXCEEDS_PRECISION', 'AMOUNT_TOO_LARGE',
            'BLOCKHASH_REQUIRED', 'ATA_RENT_REQUIRED', 'INVALID_SOL_DECIMALS',
        ]
        for (const name of expected) {
            expect(Object.prototype.hasOwnProperty.call(SOLANA_SEND_ERRORS, name), name).toBe(true)
        }
    })

    it('bilinmeyen kod jenerik anahtara duser, ham sabit olarak DONMEZ', () => {
        expect(resolveSolanaSendError('TOTALLY_UNKNOWN_CODE')).toBe('send.errors.generic')
        expect(resolveSolanaSendError(undefined)).toBe('send.errors.generic')
        expect(resolveSolanaSendError(null)).toBe('send.errors.generic')
    })

    it('SOLANA_RPC_HTTP_<status> oneki ozel olarak yakalanir', () => {
        expect(resolveSolanaSendError('SOLANA_RPC_HTTP_500')).toBe(resolveSolanaSendError('SOLANA_RPC_TIMEOUT'))
        expect(resolveSolanaSendError('SOLANA_RPC_HTTP_429')).not.toBe('send.errors.generic')
    })
})

// KOK NEDEN (kod incelemesi, Task 12 1. tur): tablo dogru anahtara esliyor OLMASI
// yetmiyor — o anahtarin KENDISI locale dosyalarinda hic yoksa vue-i18n anahtari
// OLDUGU GIBI ekrana basar (`i18n/index.js`'te `missing` handler'i yok). `en.json`/
// `tr.json`'da grep 0 sonuc veriyordu: TABLO dogruydu ama CEVIRI hic yazilmamisti.
// Bu test dosyanin KENDI kaynagini degil, GERCEK sozlukleri okur — birinden bir
// anahtar silinirse (ornegin Task 17 farkli bir isim secerse) burasi KIZARIR.
describe('Solana hata mesajlari iki DILDE de dolu (kod<->ceviri kayma imkansiz)', () => {
    const localeDict = (locale) =>
        JSON.parse(read(join('..', '..', 'i18n', 'locales', `${locale}.json`)))

    const resolvePath = (dict, path) =>
        path.split('.').reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), dict)

    // SOLANA_SEND_ERRORS'in TUM degerleri + tabloya dahil olmayan ama bu gorevin
    // eklendigi tek diger Solana-ozel anahtar (ConfirmTransaction.vue'nun ATA-kirasi
    // satiri, sendErrors tablosunun disinda, dogrudan template'te kullaniliyor).
    const keys = new Set([...Object.values(SOLANA_SEND_ERRORS), 'send.confirmTransaction.ataRent'])

    for (const key of keys) {
        it(`${key} iki dilde de DOLU string`, () => {
            for (const locale of ['tr', 'en']) {
                const value = resolvePath(localeDict(locale), key)
                expect(typeof value, `${locale}.${key}`).toBe('string')
                expect(value.length, `${locale}.${key}`).toBeGreaterThan(0)
            }
        })
    }

    it('AMOUNT_EXCEEDS_PRECISION {decimals} parametresini TASIR (metinde gecer)', () => {
        for (const locale of ['tr', 'en']) {
            const value = resolvePath(localeDict(locale), SOLANA_SEND_ERRORS.AMOUNT_EXCEEDS_PRECISION)
            expect(value, locale).toContain('{decimals}')
        }
    })
})

// KOK NEDEN (kod incelemesi, 2. tur, Bulgu H): Send.vue'nun MAX ipucu
// `resolveSolanaSendError`in HER kodu (taninmayan dahil) bir mesaja
// cevirdigini varsayip dogrudan gosteriyordu. Ham bir offline/DNS fetch
// reddi (`TypeError: Failed to fetch`) TABLO'da yoktur; boyle bir mesaj
// jenerik "Islem gonderilemedi" metnine duser ve gonderim HENUZ
// baslamadan, yalniz ucret yuklenirken gorunmesi yaniltici olur — dogrusu
// bu durumda daha guvenli bir yedege (feeUnavailable) dusmektir.
// isKnownSolanaSendError cagirana "bu koda GERCEKTEN bir karsiligim var mi"
// sorusunu ayirt etme imkani verir.
describe('isKnownSolanaSendError', () => {
    it('TABLO daki her kod TANINIR', () => {
        for (const code of Object.keys(SOLANA_SEND_ERRORS)) {
            expect(isKnownSolanaSendError(code), code).toBe(true)
        }
    })

    it('SOLANA_RPC_HTTP_<status> oneki TANINIR', () => {
        expect(isKnownSolanaSendError('SOLANA_RPC_HTTP_500')).toBe(true)
        expect(isKnownSolanaSendError('SOLANA_RPC_HTTP_429')).toBe(true)
    })

    it('ham bir fetch/ag hatasi mesaji TANINMAZ', () => {
        expect(isKnownSolanaSendError('Failed to fetch')).toBe(false)
        expect(isKnownSolanaSendError('TypeError: NetworkError when attempting to fetch resource.')).toBe(false)
    })

    it('bos/tanimsiz deger TANINMAZ', () => {
        expect(isKnownSolanaSendError(undefined)).toBe(false)
        expect(isKnownSolanaSendError(null)).toBe(false)
        expect(isKnownSolanaSendError('')).toBe(false)
    })
})

// --- BELIRSIZ YAYIN (nihai inceleme, Bulgu 1) ---
//
// Bu ayrim PARA meselesidir. BELIRSIZ dususte islem ZINCIRE GITMIS OLABILIR:
// kullaniciya "tekrar deneyin" demek, imzalanmis bir transferi ikinci kez
// gondermeye davet etmektir (TAZE blockhash -> FARKLI imza -> CIFT GONDERIM).
// KESIN reddedilen yayinda ise tekrar denemek DOGRU tavsiyedir.
describe('isAmbiguousBroadcastError', () => {
    it('zaman asimi BELIRSIZDIR', () => {
        expect(isAmbiguousBroadcastError('SOLANA_RPC_TIMEOUT')).toBe(true)
    })

    it('5xx BELIRSIZDIR (proxy 502 / saglayici 503 dahil)', () => {
        for (const status of [500, 502, 503, 504, 599]) {
            expect(isAmbiguousBroadcastError(`SOLANA_RPC_HTTP_${status}`), String(status)).toBe(true)
        }
    })

    // 4xx'te istek PROXY tarafindan reddedildi (beyaz liste / oran limiti / boyut
    // siniri) ve dugume HIC gitmedi. Belirsiz sayilirsa hicbir zaman gonderilmemis
    // islemler icin bekleyen kayit uretilir.
    it('4xx BELIRSIZ DEGILDIR', () => {
        for (const status of [400, 403, 404, 429, 499]) {
            expect(isAmbiguousBroadcastError(`SOLANA_RPC_HTTP_${status}`), String(status)).toBe(false)
        }
    })

    // Preflight/JSON-RPC hatalari HTTP 200 ile gelir ve dugumun KESIN cevabidir.
    it('dugumun KESIN reddi BELIRSIZ DEGILDIR', () => {
        expect(isAmbiguousBroadcastError('Blockhash not found')).toBe(false)
        expect(isAmbiguousBroadcastError('Transaction simulation failed: Insufficient funds')).toBe(false)
        expect(isAmbiguousBroadcastError('BLOCKHASH_UNAVAILABLE')).toBe(false)
    })

    it('dizge olmayan / bicimsiz girdi BELIRSIZ SAYILMAZ', () => {
        expect(isAmbiguousBroadcastError(null)).toBe(false)
        expect(isAmbiguousBroadcastError(undefined)).toBe(false)
        expect(isAmbiguousBroadcastError(503)).toBe(false)
        expect(isAmbiguousBroadcastError('SOLANA_RPC_HTTP_')).toBe(false)
        expect(isAmbiguousBroadcastError('SOLANA_RPC_HTTP_abc')).toBe(false)
    })
})

// Kullaniciya gosterilen metin: yayin belirsizken ARAYUZ ayri bir anahtar
// kullanir (send.errors.statusUnknown). rpcTimeout metni "tekrar deneyin" diyor;
// belirsiz dususte gosterilmesi tam olarak yanlis tavsiyedir.
describe('statusUnknown anahtari', () => {
    it('iki dilde de vardir ve tekrar denemeyi ONERMEZ', async () => {
        const en = (await import('../../i18n/locales/en.json')).default
        const tr = (await import('../../i18n/locales/tr.json')).default
        expect(en.send.errors.statusUnknown).toBeTruthy()
        expect(tr.send.errors.statusUnknown).toBeTruthy()
        expect(en.send.errors.statusUnknown.toLowerCase()).not.toMatch(/try again/)
    })
})

// KOK NEDEN (spec 3.6): dapp baglayicisi TABLO'ya on uc yeni kod getiriyor ve
// hepsi ARKA PLANDA firlatilip dapp'in promise'ine `data.code` olarak gidiyor --
// yani buildTransferPlan.js/address.js kaynagini tarayan yukaridaki regex bu
// adlarin HICBIRINI gormez. Bu yuzden on uclu kume, bilinen dokuzlu gibi ELLE
// ve ACIKCA kilitlenir: bir ad tablodan duserse kullanici ham kod gorurdu, ki
// spec 3.6 bunu acikca yasakliyor.
describe('Solana dapp baglayicisi hata kodlari (spec 3.6) TABLO da', () => {
    const DAPP_CODES = {
        TX_DESERIALIZE_FAILED: 'send.errors.txDeserializeFailed',
        UNSUPPORTED_TX_VERSION: 'send.errors.unsupportedTxVersion',
        SOLANA_DAPP_FROM_MISMATCH: 'send.errors.dappFromMismatch',
        SOLANA_NOT_A_SIGNER: 'send.errors.notASigner',
        SOLANA_MISSING_COSIGNER: 'send.errors.missingCosigner',
        SOLANA_MESSAGE_LOOKS_LIKE_TX: 'send.errors.messageLooksLikeTx',
        SOLANA_MESSAGE_TOO_LARGE: 'send.errors.messageTooLarge',
        SOLANA_WRONG_CLUSTER: 'send.errors.wrongCluster',
        SOLANA_BLOCKHASH_EXPIRED: 'send.errors.blockhashExpired',
        SOLANA_TOO_MANY_TRANSACTIONS: 'send.errors.tooManyTransactions',
        SOLANA_ACCOUNT_UNSUPPORTED: 'send.solanaUnsupportedAccount',
        SOLANA_SIGNIN_DOMAIN_MISMATCH: 'send.errors.signInDomainMismatch',
        SOLANA_SIGNIN_ADDRESS_MISMATCH: 'send.errors.signInAddressMismatch',
    }

    it('on uc kodun hepsi TABLO da ve BEKLENEN anahtara esleniyor', () => {
        expect(Object.keys(DAPP_CODES)).toHaveLength(13)
        for (const [code, key] of Object.entries(DAPP_CODES)) {
            expect(resolveSolanaSendError(code), code).toBe(key)
        }
    })

    // Jenerik dusus bu kodlar icin bir BASARISIZLIK olurdu: "islem
    // gonderilemedi" metni, kullaniciya kor imzalama saldirisinin engellendigini
    // de suresi dolmus bir blockhash'i de ayni sekilde anlatirdi.
    it('hicbiri jenerik metne DUSMUYOR', () => {
        for (const code of Object.keys(DAPP_CODES)) {
            expect(resolveSolanaSendError(code), code).not.toBe('send.errors.generic')
        }
    })

    it('hepsi isKnownSolanaSendError tarafindan TANINIYOR', () => {
        for (const code of Object.keys(DAPP_CODES)) {
            expect(isKnownSolanaSendError(code), code).toBe(true)
        }
    })

    // Yayin BELIRSIZLIGI yalnizca zaman asimi/5xx icindir; bir uygulama kodunu
    // belirsiz saymak kullaniciyi "bekleyen islem olabilir" ekranina gonderirdi.
    it('hicbiri BELIRSIZ yayin sayilmiyor', () => {
        for (const code of Object.keys(DAPP_CODES)) {
            expect(isAmbiguousBroadcastError(code), code).toBe(false)
        }
    })
})

// KOK NEDEN: mevcut kaynak taramasi YALNIZCA buildTransferPlan.js + address.js
// okuyor. M3'un uc saf modulu (parseDappTransaction, signDappTransaction,
// decodeInstructions) tabloya baglanmazsa dapp onay ekraninda ham
// "TX_DESERIALIZE_FAILED" yazan bir kirmizi kutu cikar -- §3.6'nin ACIKCA
// yasakladigi sey. decodeInstructions.js bugun HICBIR ad firlatmiyor (§5.2, K5:
// cozemedigimiz her sey `type: null` doner) ama taramaya YINE de eklenir:
// boylece ileride oraya eklenecek bir throw sessizce eslemesiz kalamaz, bu
// testin tum amaci budur.
//
// Kodlarin KENDISI Task 20'de tabloya girdi ve orada zaten hem eslesme hem de
// "jenerik metne dusmuyor" testi var. Burada eklenen TEK sey taramadir; ayni
// iddialari tekrarlayan ikinci bir `it` yazmak Task 20'yi kopyalamak olurdu.
// solanaDappFunctions.js (dapp onay ekranlarinin ARKA PLAN tarafi) da bu
// taramaya eklenir: nihai inceleme -- WALLET_LOCKED/NO_ACTIVE_ACCOUNT/
// SOLANA_DAPP_FROM_MISMATCH gibi adlar M3 uc dosyasinin DISINDA firlatiliyor
// ama AYNI onay ekranlarina ulasiyor; tabloya baglanmazsa onlar da ham kod
// olarak GORUNUR.
describe('M3 dapp imzalama kodlari TABLO da', () => {
    it('parseDappTransaction.js + signDappTransaction.js + decodeInstructions.js + solanaDappFunctions.js firlattigi HER ad TABLO da', () => {
        const thrown = new Set([
            ...collectThrownErrorNames(read('parseDappTransaction.js')),
            ...collectThrownErrorNames(read('signDappTransaction.js')),
            ...collectThrownErrorNames(read('decodeInstructions.js')),
            ...collectThrownErrorNames(read('../solanaDappFunctions.js')),
        ])
        // Emniyet kemeri: regex kirilirsa dongu sessizce 0 ad'la gecerdi.
        // solanaDappFunctions.js eklenmeden ONCE taban 3 idi; olculdu: bugun
        // (dedup sonrasi) 9 benzersiz ad var (TX_DESERIALIZE_FAILED,
        // UNSUPPORTED_TX_VERSION, SOLANA_MISSING_COSIGNER, WALLET_LOCKED,
        // NO_ACTIVE_ACCOUNT, SOLANA_UNSUPPORTED_ACCOUNT, VAULT_NOT_FOUND,
        // SOLANA_DAPP_FROM_MISMATCH, SOLANA_NOT_A_SIGNER).
        expect(thrown.size).toBeGreaterThanOrEqual(9)
        for (const name of thrown) {
            expect(Object.prototype.hasOwnProperty.call(SOLANA_SEND_ERRORS, name), name).toBe(true)
        }
    })
})

// KOK NEDEN (inceleme bulgusu, Onemli'ye yukseltildi): collectThrownErrorNames'in
// deseni kapanan parantezin tirnaktan HEMEN sonra gelmesini sartlar, bu yuzden
// `throw new Error('AD', { cause: e })` (signDappTransaction.js:64 -- Task 26
// kontrolor karariyla zorunlu kilinan iki-argumanli form, alttaki hatayi KORUR)
// TOPLANMAZ. Bugun kacak yok cunku ayni ad ayrica tek-argumanli olarak da
// firlatiliyor (signDappTransaction.js:86) -- bu bir garanti degil, mevcut
// kaynagin sansi. Yalnizca neden-formuyla firlatilan bir adin sessizce
// eslemesiz kalmasi, bu taramanin varolma amacinin tam tersidir.
//
// Bu test collectThrownErrorNames'i sentetik, tabloya BAGLI OLMAYAN bir adla
// dogrudan sinar: gercek dosya taramasindaki uc adlik beklenen kumeyi degistirmez.
describe('collectThrownErrorNames iki-argumanli throw formunu da toplar', () => {
    it("throw new Error(AD, { cause }) formundan adi TOPLAR", () => {
        const source = "function f(e) {\n  throw new Error('SOLANA_ONLY_CAUSE_FORM_PROBE', { cause: e })\n}\n"
        const names = collectThrownErrorNames(source)
        expect(names.has('SOLANA_ONLY_CAUSE_FORM_PROBE')).toBe(true)
    })
})
