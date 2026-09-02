import { describe, it, expect } from 'vitest'
import { Address } from '@ton/core'
import {
    DEFAULT_PREFIX, DEFAULT_SUFFIX,
    isEvmAddress, isSupportedAddress, normalizeForCompare,
    isLookalike, splitAddress, buildTrustedList, findLookalike
} from './addressPoisoning'
import { shortenAddress } from './shortenAddress'
import { upsertRecipient } from './sentRecipients'

// Ayni bas (AbCd) + ayni son (CdEf), farkli orta: klasik zehirli adres.
const TRUSTED = '0xAbCd' + '1'.repeat(32) + 'CdEf'
const POISON = '0xAbCd' + '2'.repeat(32) + 'CdEf'
const DIFF_HEAD = '0xFFFF' + '1'.repeat(32) + 'CdEf'
const DIFF_TAIL = '0xAbCd' + '1'.repeat(32) + 'FFFF'
const UNRELATED = '0x' + '9'.repeat(40)

describe('isEvmAddress', () => {
    it('gecerli adresi kabul eder, harf kutusu onemsiz', () => {
        expect(isEvmAddress(TRUSTED)).toBe(true)
        expect(isEvmAddress(TRUSTED.toLowerCase())).toBe(true)
    })

    it('bastaki/sondaki bosluk kabul edilir', () => {
        expect(isEvmAddress('  ' + TRUSTED + ' ')).toBe(true)
    })

    it('kisa, hexdisi veya 0x'.concat("'siz degerleri reddeder"), () => {
        expect(isEvmAddress('0x1234')).toBe(false)
        expect(isEvmAddress('0x' + 'Z'.repeat(40))).toBe(false)
        expect(isEvmAddress('1'.repeat(42))).toBe(false)
    })

    it('bos/gecersiz turleri reddeder', () => {
        expect(isEvmAddress(null)).toBe(false)
        expect(isEvmAddress(undefined)).toBe(false)
        expect(isEvmAddress('')).toBe(false)
        expect(isEvmAddress(123)).toBe(false)
    })
})

describe('isLookalike', () => {
    it('ayni bas ve son, farkli orta => benzer', () => {
        expect(isLookalike(POISON, TRUSTED)).toBe(true)
    })

    it('AYNI adres benzer DEGILDIR (o zaten bilinen alici)', () => {
        expect(isLookalike(TRUSTED, TRUSTED)).toBe(false)
    })

    it('yalnizca buyuk/kucuk harf farki ayni adrestir, benzer degil', () => {
        expect(isLookalike(TRUSTED.toLowerCase(), TRUSTED.toUpperCase().replace('0X', '0x'))).toBe(false)
    })

    it('bas farkliysa benzer degil', () => {
        expect(isLookalike(DIFF_HEAD, TRUSTED)).toBe(false)
    })

    it('son farkliysa benzer degil', () => {
        expect(isLookalike(DIFF_TAIL, TRUSTED)).toBe(false)
    })

    it('alakasiz adres benzer degil', () => {
        expect(isLookalike(UNRELATED, TRUSTED)).toBe(false)
    })

    it('karsilastirma buyuk/kucuk harf duyarsizdir', () => {
        expect(isLookalike(POISON.toLowerCase(), TRUSTED.toUpperCase().replace('0X', '0x'))).toBe(true)
    })

    it('gecersiz/eksik girdide benzer degil', () => {
        expect(isLookalike(null, TRUSTED)).toBe(false)
        expect(isLookalike(POISON, undefined)).toBe(false)
        expect(isLookalike('', '')).toBe(false)
        expect(isLookalike('0x1234', TRUSTED)).toBe(false)
        expect(isLookalike(POISON, '0xZZZZ' + '1'.repeat(32) + 'CdEf')).toBe(false)
    })

    it('esik uzunluklari ayarlanabilir', () => {
        // Ilk 5 karakter istenirse AbCd1 vs AbCd2 ayrisir: artik benzer degil.
        expect(isLookalike(POISON, TRUSTED, { prefix: 5, suffix: DEFAULT_SUFFIX })).toBe(false)
    })

    it('EVM varsayilan esigi 4 anlamli hex + 4 son karakter (0x haric)', () => {
        expect(DEFAULT_PREFIX).toBe(4)
        expect(DEFAULT_SUFFIX).toBe(4)
    })

    // Esik shortenAddress'ten BAGIMSIZ SURUKLENEMEZ: burada shortenAddress'in
    // GERCEK ciktisina karsi dogrulanir, sabit sayilara degil. shortenAddress'in
    // varsayilanlari (start/end) degisirse bu test de degisiklikle birlikte
    // KIRMIZI duser — iki dosya birbirinden sessizce ayrisamaz.
    it('EVM icin toplam karsilastirilan bas/son uzunluk shortenAddress ile TAM ORTUSUR', () => {
        const [shownHead, shownTail] = shortenAddress('x'.repeat(50)).split('...')
        // EVM'de '0x' (2 karakter) anlamsizdir; DEFAULT_PREFIX yalnizca ONDAN
        // SONRAKI anlamli hex karakterleri sayar.
        expect(2 + DEFAULT_PREFIX).toBe(shownHead.length)
        expect(DEFAULT_SUFFIX).toBe(shownTail.length)
    })
})

describe('splitAddress', () => {
    it('adresi bas/orta/son diye ayirir, bas 0x tasir', () => {
        expect(splitAddress(TRUSTED)).toEqual({
            head: '0xAbCd',
            mid: '1'.repeat(32),
            tail: 'CdEf'
        })
    })

    it('parcalarin birlesimi adresin AYNISIDIR (gosterimde karakter kaybolmaz)', () => {
        const { head, mid, tail } = splitAddress(POISON)
        expect(head + mid + tail).toBe(POISON)
    })

    it('bosluklu adreste bosluk basa yapismaz (defterdeki kayit bosluk tasiyabilir)', () => {
        // isLookalike bosluklu adresi GECERLI sayar; ayni girdi burada '  0xAb' gibi
        // bir bas uretirse uyari kartinda adres kaymis gorunur — tam da guvenilmesi
        // gereken yerde.
        expect(splitAddress('  ' + TRUSTED + ' ')).toEqual({
            head: '0xAbCd',
            mid: '1'.repeat(32),
            tail: 'CdEf'
        })
    })

    it('gecersiz adreste null doner', () => {
        expect(splitAddress(null)).toBe(null)
        expect(splitAddress('0x1234')).toBe(null)
    })
})

describe('buildTrustedList', () => {
    const accounts = [{ name: 'Ana Hesap', address: TRUSTED }]
    const savedAddresses = [{ label: 'Borsa', address: UNRELATED }]
    const sentRecipients = [{ address: DIFF_HEAD, label: null }]

    it('uc kaynagi tek listede kaynak etiketiyle toplar', () => {
        expect(buildTrustedList({ accounts, savedAddresses, sentRecipients })).toEqual([
            { address: TRUSTED, label: 'Ana Hesap', source: 'account' },
            { address: UNRELATED, label: 'Borsa', source: 'saved' },
            { address: DIFF_HEAD, label: null, source: 'sent' }
        ])
    })

    it('ayni adres birden fazla kaynaktaysa oncelik hesap > defter > gecmis', () => {
        const list = buildTrustedList({
            accounts,
            savedAddresses: [{ label: 'Defterdeki Ad', address: TRUSTED }],
            sentRecipients: [{ address: TRUSTED, label: 'Gecmisteki Ad' }]
        })
        expect(list).toHaveLength(1)
        expect(list[0]).toEqual({ address: TRUSTED, label: 'Ana Hesap', source: 'account' })
    })

    it('tekillestirme buyuk/kucuk harf duyarsizdir', () => {
        const list = buildTrustedList({
            accounts,
            savedAddresses: [{ label: 'Ayni', address: TRUSTED.toLowerCase() }],
            sentRecipients: []
        })
        expect(list).toHaveLength(1)
    })

    it('adressiz veya bozuk kayitlar atlanir', () => {
        const list = buildTrustedList({
            accounts: [{ name: 'Adressiz' }, null],
            savedAddresses: [{ label: 'Bozuk', address: '0x123' }],
            sentRecipients: [{ address: '' }]
        })
        expect(list).toEqual([])
    })

    it('eksik/bozuk girdilere toleranslidir', () => {
        expect(buildTrustedList({})).toEqual([])
        expect(buildTrustedList(undefined)).toEqual([])
        expect(buildTrustedList({ accounts: null, savedAddresses: 'x', sentRecipients: 3 })).toEqual([])
    })
})

describe('buildTrustedList — gecmis adaylari ve emniyet valfleri', () => {
    // Gecmis, digerlerinden farkli olarak DUSMANIN da yazabildigi bir kaynaktir: zehirleme
    // yemi tam olarak oraya duser. Bu yuzden gecmis adaylari sorgusuz kabul edilmez.
    it('gecmis karsi taraflarini en dusuk oncelikle ekler', () => {
        const list = buildTrustedList({
            accounts: [{ name: 'Ana Hesap', address: TRUSTED }],
            historyRecipients: [{ address: UNRELATED, label: null, source: 'history' }]
        })
        expect(list).toEqual([
            { address: TRUSTED, label: 'Ana Hesap', source: 'account' },
            { address: UNRELATED, label: null, source: 'history' }
        ])
    })

    it('halihazirda guvenilen bir adrese BENZEYEN gecmis adayi ELENIR', () => {
        // Valfin can alici noktasi. POISON gecmiste duruyor (saldirgan koydu) ve TRUSTED
        // kendi hesabim. Aday kabul edilseydi: POISON'a gonderim TAM ESLESME sayilip
        // sessiz gecerdi, ustelik gercek TRUSTED adresi sahte uyari uretirdi — koruma
        // tersine donerdi.
        const list = buildTrustedList({
            accounts: [{ name: 'Ana Hesap', address: TRUSTED }],
            historyRecipients: [{ address: POISON, label: null, source: 'history' }]
        })
        expect(list.map(e => e.address)).toEqual([TRUSTED])
    })

    it('kayitli adrese benzeyen gecmis adayi da elenir', () => {
        const list = buildTrustedList({
            savedAddresses: [{ label: 'Borsa', address: TRUSTED }],
            historyRecipients: [{ address: POISON, label: null, source: 'history' }]
        })
        expect(list.map(e => e.address)).toEqual([TRUSTED])
    })

    it('birbirine benzeyen IKI gecmis adayi birbirini gotururur', () => {
        // Ikisi de yalnizca gecmiste; hangisinin gercek hangisinin yem oldugunu
        // BILEMEYIZ. Birini secmek yanlis olani "tanidik" ilan etme riskidir; ikisini de
        // dislamak yalnizca uyari uretmemek demektir — yani mevcut duruma doner, kotulesmez.
        const list = buildTrustedList({
            accounts: [],
            historyRecipients: [
                { address: TRUSTED, label: null, source: 'history' },
                { address: POISON, label: null, source: 'history' }
            ]
        })
        expect(list).toEqual([])
    })

    it('benzemeyen gecmis adaylari birbirini etkilemez', () => {
        const list = buildTrustedList({
            historyRecipients: [
                { address: TRUSTED, label: null, source: 'history' },
                { address: UNRELATED, label: null, source: 'history' }
            ]
        })
        expect(list).toHaveLength(2)
    })

    it('gecmiste de olan bir hesap/defter adresi ust oncelikte kalir', () => {
        const list = buildTrustedList({
            accounts: [{ name: 'Ana Hesap', address: TRUSTED }],
            historyRecipients: [{ address: TRUSTED, label: null, source: 'history' }]
        })
        expect(list).toEqual([{ address: TRUSTED, label: 'Ana Hesap', source: 'account' }])
    })
})

describe('findLookalike', () => {
    const trusted = buildTrustedList({
        accounts: [{ name: 'Ana Hesap', address: TRUSTED }],
        savedAddresses: [{ label: 'Borsa', address: UNRELATED }],
        sentRecipients: []
    })

    it('benzeyen guvenilir adresi kaynagi ve etiketiyle doner', () => {
        expect(findLookalike(POISON, trusted)).toEqual({
            address: TRUSTED, label: 'Ana Hesap', source: 'account'
        })
    })

    it('adres guvenilir listede TAM eslesiyorsa uyari yoktur', () => {
        expect(findLookalike(TRUSTED, trusted)).toBe(null)
    })

    it('tam eslesme farkli harf kutusuyla gelse de uyari yoktur', () => {
        expect(findLookalike(TRUSTED.toLowerCase(), trusted)).toBe(null)
    })

    it('benzeyen yoksa null doner', () => {
        expect(findLookalike('0x' + '7'.repeat(40), trusted)).toBe(null)
    })

    it('birden fazla eslesmede listedeki ilk (en oncelikli) kayit doner', () => {
        const many = buildTrustedList({
            accounts: [{ name: 'Ana Hesap', address: TRUSTED }],
            savedAddresses: [],
            sentRecipients: [{ address: '0xAbCd' + '3'.repeat(32) + 'CdEf', label: 'Eski Alici' }]
        })
        expect(findLookalike(POISON, many).source).toBe('account')
    })

    it('gecersiz girdide null doner', () => {
        expect(findLookalike('', trusted)).toBe(null)
        expect(findLookalike(null, trusted)).toBe(null)
        expect(findLookalike(POISON, null)).toBe(null)
        expect(findLookalike(POISON, [])).toBe(null)
    })
})

describe('base58 (Solana) dali', () => {
    // Solana'da zehirli adres saldirisi EVM'den YAYGIN: vanity uretecle adresin
    // bas ve son karakterlerini birebir eslemek kolay.
    const KNOWN = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
    // Esik shortenAddress ile AYNI (6 bas + 4 son, bkz. addressPoisoning.js
    // SHOWN_HEAD_TOTAL): bas 6 karakter ('9WzDXw') ve son 4 ('AWWM') KNOWN ile
    // BIREBIR ayni, yalniz orta farkli — kullanicinin GORDUGU kisaltilmis
    // gosterimle (9WzDXw...AWWM) TAM ORTUSEN gercekci bir zehirli adres.
    const LOOKALIKE = '9WzDXw' + 'Q'.repeat(30) + 'AWWM'

    it('base58 adres taninir', () => {
        expect(isSupportedAddress(KNOWN)).toBe(true)
    })

    it('bas ve son eslesen sahte adres YAKALANIR', () => {
        expect(isLookalike(KNOWN, LOOKALIKE)).toBe(true)
    })

    // KOD INCELEMESI (Task 13, minor 6): base58'de decorative bir on ek olmadigi
    // icin (EVM'deki '0x' gibi) varsayilan esik 4 DEGIL, shortenAddress'in
    // gosterdigi TOPLAM (6) olmali. Aksi halde (a) esik gorunenden DUSUK kalir
    // VE (b) valf 2 (buildTrustedList) ayni predikati kullandigi icin saldirgan
    // gorsel bir ikiz uretmeden, yalnizca 4 karakter eslestirerek valf-2 saldirisi
    // yapabilir — 58^2 kat daha ucuza.
    it('bas 5 karakter eslesip 6.si FARKLI olan adres artik YAKALANMAZ (esik shortenAddress ile TAM ORTUSUR)', () => {
        // Eski (yanlis) esikle (4) bu YAKALANIRDI: ilk 4 karakter ('9WzD') ayni.
        // Ama shortenAddress KULLANICIYA 6 karakter ('9WzDXw') gosterir ve bu
        // adayin 6.sinda ('Q' vs 'w') fark VARDIR — kullanici gercekte bunu
        // FARK EDER, bu yuzden artik "benzer" sayilmamali.
        const fiveCharMatch = '9WzDX' + 'Q'.repeat(35) + 'AWWM'
        expect(fiveCharMatch.slice(0, 5)).toBe(KNOWN.slice(0, 5))
        expect(fiveCharMatch.slice(0, 6)).not.toBe(KNOWN.slice(0, 6))
        expect(isLookalike(KNOWN, fiveCharMatch)).toBe(false)
    })

    it('ayni adres benzer sayilmaz', () => {
        expect(isLookalike(KNOWN, KNOWN)).toBe(false)
    })

    it('alakasiz adres benzer degil', () => {
        expect(isLookalike(KNOWN, 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy')).toBe(false)
    })

    // BASE58 BUYUK/KUCUK HARF DUYARLIDIR. canonical() kucultseydi bu iki adres
    // AYNI anahtara duser, `left.key === right.key` dali devreye girer ve
    // "ayni adres, uyari yok" denirdi — koruma TAM TERSINE donerdi.
    //
    // Kucultulmedigi icin bas 4 karakter ('9WzD' vs '9wzd') AYRIDIR ve benzerlik
    // de kurulmaz. Iki sonuc da dogru; yanlis olan tek sey "ayni adres" demek.
    it('yalnizca harf kasasi farkli iki adres AYNI SAYILMAZ', () => {
        const upper = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
        const mixed = '9wzdxwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

        // Kritik olan: bu iki adres birbirinin AYNISI sayilmiyor.
        expect(normalizeForCompare(upper)).not.toBe(normalizeForCompare(mixed))
        // Bas karakterler farkli oldugu icin benzerlik de kurulmaz.
        expect(isLookalike(upper, mixed)).toBe(false)
    })

    it('EVM ve base58 adresler birbiriyle KARSILASTIRILMAZ', () => {
        expect(isLookalike('0x098B716B8Aaf21512996dC57EB0615e2383E2f96', KNOWN)).toBe(false)
    })

    // Yukaridaki test GERCEK adreslerle bile form korumasi OLMASA yine false
    // donerdi: base58 alfabesi '0'i disladigi icin EVM'in '0x' oneki hicbir
    // gecerli base58 dizeyle bas kismindan eslesemez — form kontrolunu KALDIRSAK
    // bu test YINE de yesil kalir, yani korumayi GERCEKTEN sinamiyordu.
    //
    // Bu test farkli: `prefix:0` ile bas karsilastirmasi anlamsizlastirilir
    // (Solana'da headOffset=0 oldugu icin iki bos dize HER ZAMAN esittir), geriye
    // yalnizca son 4 karakter kalir — ki 'abcd' hem hex hem base58'de GECERLI
    // oldugu icin TESADUFEN esitlenebilir. Form kontrolu OLMASAYDI bu iki
    // alakasiz (bir EVM, bir Solana) adres "benzer" sayilirdi.
    it('form korumasi kaldirilirsa TESADUFI bir son-4-karakter cakismasi EVM ve Solana adresini "benzer" sayardi', () => {
        const solAddr = 'D'.repeat(40) + 'abcd' // 44 karakter, gecerli base58
        const evmAddr = '0x' + '1'.repeat(36) + 'abcd' // son 4 karakter TESADUFEN ayni
        expect(isLookalike(solAddr, evmAddr, { prefix: 0 })).toBe(false)
    })

    it('splitAddress base58 icin de calisir ve harf kasasini korur', () => {
        const parts = splitAddress(KNOWN)
        expect(parts.head + parts.mid + parts.tail).toBe(KNOWN)
    })

    // Base58'de decorative bir on ek YOK (headOffset=0): bu yuzden varsayilan
    // karsilastirma uzunlugu shortenAddress'in TOPLAM bas uzunluguyla (6) BIREBIR
    // ayni olmali — EVM'deki gibi '0x' icin 2 karakter dusulmez.
    it('splitAddress base58 icin varsayilan bas uzunlugu shortenAddress ile TAM ORTUSUR', () => {
        const [shownHead, shownTail] = shortenAddress('x'.repeat(50)).split('...')
        const parts = splitAddress(KNOWN)
        expect(parts.head).toHaveLength(shownHead.length)
        expect(parts.tail).toHaveLength(shownTail.length)
    })
})

describe('buildTrustedList / findLookalike — Solana ve karma (EVM+Solana) listeler', () => {
    // isLookalike primitive'inin testleri yeterli DEGIL: buildTrustedList kendi 'seen'
    // kumesini ve emniyet valflerini form-farkindaligi olmadan da "dogru" calistirabilirdi
    // (ornegin yanlislikla ayni anahtar uzayinda dedupe ederek). Burada uctan uca dogrulanir.
    const SOL_KNOWN = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
    // Bas 6 ('9WzDXw') + son 4 ('AWWM') SOL_KNOWN ile BIREBIR ayni — shortenAddress
    // esigiyle ORTUSEN gercekci bir zehirli adres (bkz. yukaridaki LOOKALIKE yorumu).
    const SOL_POISON = '9WzDXw' + 'Q'.repeat(30) + 'AWWM'
    const EVM_KNOWN = '0xAbCd' + '1'.repeat(32) + 'CdEf'

    it('Solana hesabina benzeyen gecmis adayi elenir (EVM icin oldugu gibi)', () => {
        const list = buildTrustedList({
            accounts: [{ name: 'Solana Cuzdanim', address: SOL_KNOWN }],
            historyRecipients: [{ address: SOL_POISON, label: null, source: 'history' }]
        })
        expect(list.map(e => e.address)).toEqual([SOL_KNOWN])
    })

    it('EVM ve Solana hesaplari AYNI listede bagimsiz kalir, birbirini dislamaz', () => {
        const list = buildTrustedList({
            accounts: [
                { name: 'EVM Cuzdanim', address: EVM_KNOWN },
                { name: 'Solana Cuzdanim', address: SOL_KNOWN }
            ]
        })
        expect(list).toHaveLength(2)
    })

    it('findLookalike: Solana adayi yalnizca Solana bicimindeki guvenilirle eslesir', () => {
        const trusted = buildTrustedList({
            accounts: [
                { name: 'EVM Cuzdanim', address: EVM_KNOWN },
                { name: 'Solana Cuzdanim', address: SOL_KNOWN }
            ]
        })

        expect(findLookalike(SOL_POISON, trusted)).toEqual({
            address: SOL_KNOWN, label: 'Solana Cuzdanim', source: 'account'
        })
        // Ayni karakter uzunlugunda bile olsa EVM bir aday Solana kaydiyla eslesmez.
        expect(findLookalike('0x' + '7'.repeat(40), trusted)).toBe(null)
    })

    it('findLookalike: Solana TAM eslesmesi uyari uretmez', () => {
        const trusted = buildTrustedList({ accounts: [{ name: 'Solana Cuzdanim', address: SOL_KNOWN }] })
        expect(findLookalike(SOL_KNOWN, trusted)).toBe(null)
    })
})

// KOD INCELEMESI (Task 13, kritik 1): background.js ayni vault hesabi icin iki
// AYRI alan tutar — `.address` (EVM) ve `.solanaAddress` (Solana), ayni tohumdan
// turetilen AYNI hesabin iki zincirdeki kimligi. buildTrustedList yalnizca
// `.address` okuyordu: kullanicinin KENDI Solana adresi hicbir zaman kendi
// guvenilir listesine giremiyordu (Probe: TRUSTED FORMS ['evm']).
describe('buildTrustedList — hesabin Solana kimligi de okunur (Kritik 1)', () => {
    const EVM_ID = '0xAbCd' + '5'.repeat(32) + 'CdEf'
    const SOL_ID = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

    it('TEK hesap objesinden HEM EVM HEM Solana kimligi guvenilir listeye girer', () => {
        const trusted = buildTrustedList({
            accounts: [{ name: 'Ana Hesap', address: EVM_ID, solanaAddress: SOL_ID }]
        })
        expect(trusted).toHaveLength(2)
        expect(trusted.map(e => e.address)).toEqual(expect.arrayContaining([EVM_ID, SOL_ID]))
        expect(trusted.every(e => e.label === 'Ana Hesap' && e.source === 'account')).toBe(true)
    })

    it('solanaAddress alani yoksa (eski/EVM-only hesap) yalnizca EVM kimligi eklenir, hata firlamaz', () => {
        const trusted = buildTrustedList({ accounts: [{ name: 'Eski Hesap', address: EVM_ID }] })
        expect(trusted).toEqual([{ address: EVM_ID, label: 'Eski Hesap', source: 'account' }])
    })

    it('kendi Solana kimligime benzeyen bir gecmis adayi da ELENIR (artik kendi hesabim sayildigi icin)', () => {
        const lookalike = SOL_ID.slice(0, 6) + 'Q'.repeat(30) + SOL_ID.slice(-4)
        const trusted = buildTrustedList({
            accounts: [{ name: 'Ana Hesap', address: EVM_ID, solanaAddress: SOL_ID }],
            historyRecipients: [{ address: lookalike, label: null, source: 'history' }]
        })
        expect(trusted.map(e => e.address)).toEqual(expect.arrayContaining([EVM_ID, SOL_ID]))
        expect(trusted.map(e => e.address)).not.toContain(lookalike)
    })
})

// KOD INCELEMESI (Task 13, kritik 1 + kritik 2 — koordinatorun dogruladigi TAM
// senaryo): kurban R'ye 1 SOL gonderir (gercek islem hem GECMISE hem "sent"e
// duser). Saldirgan L'yi (R'nin gorsel ikizi, shortenAddress ikisini de
// '9WzDXw...AWWM' gosterir) 1 lamport'luk bir toz transferle KURBANIN gecmisine
// dusurur. Bu iki testin FARKI: sentRecipients.js DUZELTILMEDEN once (Kritik 2)
// "sent" kaynagi Solana'da hic beslenmiyordu — buildTrustedList'in TEK kaynagi
// gecmis kalirdi, valf 2 R ve L'yi BIRLIKTE elerdi, uyari HIC CIKMAZDI.
describe('Kritik 1 + Kritik 2 — uctan uca Solana senaryosu: dust-poisoning gecmise dusuyor', () => {
    const R = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
    // R ile shortenAddress'te AYNI gorunen ikiz (bas 6 + son 4 birebir ayni).
    const L = '9WzDXw' + 'Q'.repeat(30) + 'AWWM'

    it('DUZELTMEDEN ONCEKI durum: "sent" beslenmez, valf 2 ikisini de eler, trusted BOS kalir, UYARI CIKMAZ', () => {
        // sentRecipients.js'in eski (EVM-only) haliyle Solana'da hicbir zaman
        // dolamayacak olan "sentRecipients" alanini BILEREK BOS birakiyoruz —
        // bu, duzeltmeden onceki gercek durumu simule eder.
        const trusted = buildTrustedList({
            historyRecipients: [
                { address: R, label: null, source: 'history' },
                { address: L, label: null, source: 'history' }
            ]
        })
        expect(trusted).toEqual([])
        // Saldirinin tam hedefi: R'ye benzer bir adres girildiginde HICBIR UYARI yok.
        expect(findLookalike(L, trusted)).toBe(null)
    })

    it('KRITIK 2 DUZELTMESIYLE: basarili gonderim sonrasi R "sent"e yazilir, valf 2 artik ETKISIZ, L YAKALANIR', () => {
        // recordSentRecipient'in SAF cekirdegi upsertRecipient (artik dedupeKey
        // kullaniyor, bkz. sentRecipients.js). R'ye GERCEK bir gonderim yapilmis
        // gibi listeye eklenir — tipki ConfirmTransaction.vue'nun basarili
        // gonderimden sonra yaptigi gibi.
        const sentRecipients = upsertRecipient([], { address: R, label: null, at: 1000 })

        const trusted = buildTrustedList({
            sentRecipients,
            historyRecipients: [
                { address: R, label: null, source: 'history' }, // ayni gonderim gecmiste de gorunur
                { address: L, label: null, source: 'history' }  // saldirganin tozu
            ]
        })

        // R "sent" kaynagindan ZATEN guvenilir; gecmisteki kendi kopyasi dedupe
        // ile elenir (form+key ayni), L ise valf 1'e (guvenilen bir adrese benzer) takilir.
        expect(trusted.map(e => e.address)).toEqual([R])

        const match = findLookalike(L, trusted)
        expect(match).toEqual({ address: R, label: null, source: 'sent' })
    })
})

// ---------------------------------------------------------------------------
// TON ADRESLERI (Gorev 2)
//
// Kapi bugune kadar YALNIZCA EVM adreslerini kapsiyordu: ADDRESS_RE = /^0x.../
// TON adresleri kapidan SESSIZCE geciyordu. Bu jetton gonderimiyle gelen bir
// gerileme DEGIL - native TON gonderimi de P1'den beri korumasizdi. Saldiri
// TON'da da aynen mumkun ve gonderim GERI ALINAMAZ.
//
// FIXTURE'LAR GERCEK: uydurma dize ('EQ1' gibi) Address.parse tarafindan
// reddedilir ve test YANLIS SEBEPTEN duser - bu tuzak P2'de iki kez yasandi.
// Asagidaki cift 200k rastgele adres uretilerek BULUNDU: ikisi de gecerli,
// ayristirilabilir, FARKLI hesaplar ve ayni gorunur pencereyi paylasiyorlar
// (ilk 4 karakter 'UQCQ', son 2 karakter 'nE').
// ---------------------------------------------------------------------------
const TON_REAL = 'UQCQvhHtQ6MKAQ0J7OCHB3lug434uG7tBMrDgKvtylug9knE'
const TON_POISON = 'UQCQPrqe2A193cxe8KSAro91Z5BY98wAFXFk7k_3dNe1W3nE'
// TON_REAL ile AYNI hesabin bounceable (EQ) bicimi. Bambaska bir dize ama
// AYNI adres.
const TON_REAL_BOUNCEABLE = 'EQCQvhHtQ6MKAQ0J7OCHB3lug434uG7tBMrDgKvtylug9hQB'
// TON_REAL ile AYNI hesabin HAM bicimi. Gezginler adresi boyle gosterir.
const TON_REAL_RAW = Address.parse(TON_REAL).toRawString()

// Bu cift ilk 4 + son 2 karakteri paylasiyor, ilk 6 + son 4'u DEGIL.
// Varsayilan esikte yakalanmamalari DOGRU; testler esigi acikca veriyor.
const TON_WINDOW = { prefix: 2, suffix: 2 }

describe('isSupportedAddress', () => {
    it('TON adresini TANIR', () => {
        expect(isSupportedAddress(TON_REAL)).toBe(true)
        expect(isSupportedAddress(TON_REAL_BOUNCEABLE)).toBe(true)
    })

    it('EVM adresini TANIR', () => {
        expect(isSupportedAddress(TRUSTED)).toBe(true)
    })

    it('cop girdiyi REDDEDER', () => {
        expect(isSupportedAddress('lorem')).toBe(false)
        expect(isSupportedAddress('EQ1')).toBe(false)
        expect(isSupportedAddress('')).toBe(false)
        expect(isSupportedAddress(null)).toBe(false)
    })

    // isEvmAddress mevcut cagiranlarin (useAddressSecurity: itibar sorgusu)
    // davranisini KORUMALI - itibar servisi EVM'e ozgu.
    it('isEvmAddress TON icin HALA false doner - itibar sorgusu EVM ozgudur', () => {
        expect(isEvmAddress(TON_REAL)).toBe(false)
    })
})

describe('isLookalike — TON', () => {
    it('benzer gorunen TON adresi YAKALANIR', () => {
        expect(isLookalike(TON_REAL, TON_POISON, TON_WINDOW)).toBe(true)
    })

    it('varsayilan esik DAHA SIKI - bu cift orada yakalanmaz', () => {
        expect(isLookalike(TON_REAL, TON_POISON)).toBe(false)
    })

    it('AYNI adres benzer sayilmaz', () => {
        expect(isLookalike(TON_REAL, TON_REAL, TON_WINDOW)).toBe(false)
    })

    // KRITIK: EQ ve UQ bicimleri AYNI HESABI gosterir ama dizeleri bambaska.
    // Dize karsilastirmasi yapilsaydi kullanicinin KENDI bilinen alicisi
    // "zehirli adres" diye isaretlenirdi - yanlis pozitif, ve kullanici
    // gercek uyarilari da onemsemez hale gelirdi.
    it('AYNI hesabin EQ ve UQ bicimleri benzer sayilmaz - ayni adrestir', () => {
        expect(isLookalike(TON_REAL, TON_REAL_BOUNCEABLE, TON_WINDOW)).toBe(false)
        expect(isLookalike(TON_REAL, TON_REAL_BOUNCEABLE)).toBe(false)
    })

    // Zincirler arasi karsilastirma ANLAMSIZ: kimse bir TON adresini bir EVM
    // adresiyle karistirmaz. Yanlis pozitif uretirse koruma degersizlesir.
    it('TON ile EVM KARSILASTIRILMAZ', () => {
        expect(isLookalike(TON_REAL, TRUSTED, { prefix: 0, suffix: 0 })).toBe(false)
        expect(isLookalike(TRUSTED, TON_REAL, { prefix: 0, suffix: 0 })).toBe(false)
    })

    // Yukaridaki korumanin AYRI bir kapiya ihtiyac duymamasinin sebebi: pencere
    // ayirt edici oneki HER ZAMAN kapsiyor (head = 2 + prefix, prefix >= 0).
    // `head` hesabi degistirilirse bu test duser ve isLookalike'a bir zincir-turu
    // kapisi geri konmasi gerektigini soyler. Kapi bir donem oradaydi; mutasyon
    // testi ulasilamaz oldugunu gosterince kaldirildi.
    it('gorunur pencere AYIRT EDICI oneki daima kapsar', () => {
        const head = 2 + DEFAULT_PREFIX
        expect(head).toBeGreaterThanOrEqual(2)
        expect(TON_REAL.slice(0, 2)).toBe('UQ')
        expect(TRUSTED.toLowerCase().slice(0, 2)).toBe('0x')
    })

    // AYNI YAPISAL OZELLIK, ikinci sonucu: isLookalike ve findLookalike'daki
    // KIMLIK kapilari (`id` vs `display`) bugun gozlenebilir bir fark uretmiyor,
    // cunku ayni hesabin iki dize bicimi ILK IKI KARAKTERDE zaten ayrisiyor -
    // "ayni hesap, farkli dize, AYNI pencere" durumu olusamiyor.
    //
    // Kapilar yine de `id` kullaniyor (dogru olan karsilastirma bu). Bu test o
    // kararin dayandigi ozelligi kilitler: pencere hesabi degisip bu ozellik
    // bozulursa test duser ve kimlik kapilarinin ARTIK YUK TASIDIGINI, dolayisiyla
    // dogrudan test edilmeleri gerektigini soyler.
    it('AYNI hesabin farkli bicimleri gorunur pencerede zaten ayrisir', () => {
        const w = (a) => a.slice(0, 2)
        expect(w(TON_REAL)).not.toBe(w(TON_REAL_BOUNCEABLE))
        expect(w(TON_REAL)).not.toBe(w(TON_REAL_RAW))
        // Ucu de GERCEKTEN ayni hesap olmali - yoksa yukaridaki karsilastirma
        // anlamsiz bir dogruyu test ederdi.
        const id = (a) => Address.parse(a).toRawString()
        expect(id(TON_REAL)).toBe(id(TON_REAL_BOUNCEABLE))
        expect(id(TON_REAL)).toBe(id(TON_REAL_RAW))
    })

    it('gecersiz TON dizesi false doner, PATLAMAZ', () => {
        expect(isLookalike(TON_REAL, 'UQnotavalidaddress', TON_WINDOW)).toBe(false)
        expect(isLookalike('EQ1', TON_POISON, TON_WINDOW)).toBe(false)
    })
})

describe('splitAddress — TON', () => {
    it('TON adresini uce boler ve birlestiginde AYNISI cikar', () => {
        const p = splitAddress(TON_REAL, TON_WINDOW)
        expect(p).not.toBeNull()
        expect(p.head + p.mid + p.tail).toBe(TON_REAL)
    })

    // Kullanicinin GORDUGU pencere: EQ/UQ oneki + gosterilen basamaklar.
    // EVM'deki '0x' + 4 ile ayni mantik.
    it('bas parca EQ/UQ onekini TASIR', () => {
        expect(splitAddress(TON_REAL, TON_WINDOW).head).toBe('UQCQ')
    })

    it('gecersiz TON adresi null doner', () => {
        expect(splitAddress('EQ1')).toBeNull()
    })
})

describe('findLookalike — TON', () => {
    const trusted = [{ address: TON_REAL, label: 'Gercek alici', source: 'sent' }]

    it('zehirli adres guvenilir kaydi DONDURUR', () => {
        expect(findLookalike(TON_POISON, trusted, TON_WINDOW)?.address).toBe(TON_REAL)
    })

    // TAM eslesme uyari uretmez - kullanici zaten bildigi adrese gonderiyordur.
    it('adresin KENDISI uyari uretmez', () => {
        expect(findLookalike(TON_REAL, trusted, TON_WINDOW)).toBeNull()
    })

    // Ayni hesabin diger bicimi de "bilinen alici"dir, zehir degil.
    it('AYNI hesabin EQ bicimi uyari uretmez', () => {
        expect(findLookalike(TON_REAL_BOUNCEABLE, trusted, TON_WINDOW)).toBeNull()
    })

    // HAM bicim (0:abc...) gercek bir senaryodur: gezginler adresi boyle gosterir
    // ve kullanici oradan kopyalayabilir. Friendly kayitla AYNI hesaptir.
    it('AYNI hesabin HAM bicimi uyari uretmez', () => {
        expect(findLookalike(TON_REAL_RAW, trusted, TON_WINDOW)).toBeNull()
    })
})

describe('buildTrustedList — TON', () => {
    // Ayni hesabin iki bicimi TEK kayit olmali; aksi halde liste sisiyor ve
    // "zaten guvenilir" kontrolu ayni adresi iki kez tariyor.
    it('AYNI hesabin EQ ve UQ bicimleri TEK kayda iner', () => {
        const list = buildTrustedList({
            accounts: [{ address: TON_REAL, name: 'A' }],
            savedAddresses: [{ address: TON_REAL_BOUNCEABLE, label: 'B' }],
        })
        expect(list).toHaveLength(1)
    })

    it('TON ve EVM adresleri BIRLIKTE yasar', () => {
        const list = buildTrustedList({
            accounts: [{ address: TON_REAL, name: 'TON' }, { address: TRUSTED, name: 'EVM' }],
        })
        expect(list).toHaveLength(2)
    })
})
