// GEVSEK KOSULLARIN GEREKCESI (brief Step 1): tarayici BILEREK gevsektir.
//   - `instrCount >= 1` ve `nReq <= 19`: yalniz mesru metin/ikili yuklerin
//     buyuk cogunlugunu disarida birakmak icindir (rastgele bir yukun bu
//     kosullari birden gecmesi cok dusuk olasilik; ozellik testi 20.000 yukte
//     hicbirinin `*-exact` olmadigini kilitler). Bu ikisinin disinda kosul
//     EKLENMEZ.
//   - `programIdIndex != 0` gibi her ek kosul, saldirganin tarayicidan kacip
//     gercek ayristiriciyi gecen bir mesaj uretmesi icin OLASI BIR KACAK yoludur
//     (gercek ayristirici zaten reddeder; reddi ona birakmayiz, tarayici
//     kapiyi daha gevsek tutar).
//   - 0x82 onekli ve >=70 bayt yuk 'bilinen acik' olarak kilitlidir (null/false);
//     izleme maddesi Gorev 31 belgesinde.
// messageShape: imzasiz Solana islem MESAJI tarayicisi (E1).
//
// Test vektorleri GERCEK web3.js ciktisidir (uydurma bayt yok): elle yazilmis
// bir bayt dizisi, kutuphanenin gercekte urettigini degil bizim "hatirladigimiz"
// bicimi dogrular. Tarayicinin kendisi web3.js'e BAGIMLI DEGILDIR (saf, import
// yok); web3.js yalnizca burada, vektor uretimi ve orak (oracle) icin kullanilir.
import './bufferGlobal.js'
import { describe, it, expect } from 'vitest'
import {
    Keypair,
    SystemProgram,
    Transaction,
    TransactionMessage,
    AddressLookupTableAccount,
    Message,
    PublicKey,
    TransactionInstruction,
    VersionedMessage,
} from '@solana/web3.js'
import {
    classifyTxMessageShape,
    looksLikeTransactionMessage,
    looksLikeTransactionMessageWith,
    looksLikeFutureVersionedMessage,
    SOFT_HEADER_RULE,
} from './messageShape'
import { buildSiwsMessage } from './siwsMessage'

const BLOCKHASH = '11111111111111111111111111111111'
const kullanici = Keypair.generate()
const baska = Keypair.generate()
const alici = Keypair.generate()

const utf8 = (metin) => new TextEncoder().encode(metin)
const birlestir = (...parcalar) => {
    const cikti = new Uint8Array(parcalar.reduce((t, p) => t + p.length, 0))
    let konum = 0
    for (const p of parcalar) {
        cikti.set(p, konum)
        konum += p.length
    }
    return cikti
}

// Seed'li PRNG (mulberry32): testler tekrarlanabilir.
function prng(tohum) {
    let a = tohum >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function rastgeleBayt(rnd, uzunluk) {
    const b = new Uint8Array(uzunluk)
    for (let i = 0; i < uzunluk; i++) b[i] = Math.floor(rnd() * 256)
    return b
}

// UTF-8 metin yuku: ASCII + bosluk + Latin/Kiril/CJK/emoji karisimi.
function rastgeleMetinYuku(rnd, hedefBayt) {
    const parcalar = []
    let bayt = 0
    while (bayt < hedefBayt) {
        const r = rnd()
        let kp
        if (r < 0.6) kp = 0x20 + Math.floor(rnd() * 95)
        else if (r < 0.7) kp = [0x20, 0x0a, 0x09, 0x0d][Math.floor(rnd() * 4)]
        else if (r < 0.8) kp = 0xc0 + Math.floor(rnd() * 0x100)
        else if (r < 0.88) kp = 0x400 + Math.floor(rnd() * 0x100)
        else if (r < 0.96) kp = 0x4e00 + Math.floor(rnd() * 0x1000)
        else kp = 0x1f600 + Math.floor(rnd() * 0x50)
        parcalar.push(String.fromCodePoint(kp))
        bayt += kp < 0x80 ? 1 : kp < 0x800 ? 2 : kp < 0x10000 ? 3 : 4
    }
    return utf8(parcalar.join(''))
}

// ---- vektor ureticiler ----

function legacyMesaj({ payer, kimden, kimler = [] }) {
    const tx = new Transaction()
    tx.recentBlockhash = BLOCKHASH
    tx.feePayer = payer.publicKey
    tx.add(
        SystemProgram.transfer({
            fromPubkey: kimden.publicKey,
            toPubkey: alici.publicKey,
            lamports: 1000,
        })
    )
    for (const k of kimler) {
        tx.add(
            SystemProgram.transfer({ fromPubkey: k.publicKey, toPubkey: alici.publicKey, lamports: 1 })
        )
    }
    return new Uint8Array(tx.compileMessage().serialize())
}

function v0Mesaj({ altIle = false } = {}) {
    const talimat = SystemProgram.transfer({
        fromPubkey: kullanici.publicKey,
        toPubkey: alici.publicKey,
        lamports: 1000,
    })
    const tablolar = []
    if (altIle) {
        // alici adresi arama tablosundan GELIR -> talimat hesap indeksi >= statik sayi
        tablolar.push(
            new AddressLookupTableAccount({
                key: Keypair.generate().publicKey,
                state: {
                    deactivationSlot: BigInt('18446744073709551615'),
                    lastExtendedSlot: 0,
                    lastExtendedSlotStartIndex: 0,
                    authority: undefined,
                    addresses: [Keypair.generate().publicKey, alici.publicKey, Keypair.generate().publicKey],
                },
            })
        )
    }
    const m = new TransactionMessage({
        payerKey: kullanici.publicKey,
        recentBlockhash: BLOCKHASH,
        instructions: [talimat],
    }).compileToV0Message(tablolar)
    return new Uint8Array(m.serialize())
}

const donus = {
    legacy: (b) => {
        try { return new Uint8Array(Message.from(b).serialize()) } catch { return null }
    },
    v0: (b) => {
        try { return new Uint8Array(VersionedMessage.deserialize(b).serialize()) } catch { return null }
    },
}
const esit = (a, b) => a !== null && a.length === b.length && a.every((x, i) => x === b[i])

describe('classifyTxMessageShape: legacy', () => {
    const vektorler = {
        'payer=kullanici': legacyMesaj({ payer: kullanici, kimden: kullanici }),
        'payer=baska, kullanici ikinci imzaci': legacyMesaj({ payer: baska, kimden: kullanici }),
        'kullanici imzaci degil': legacyMesaj({ payer: baska, kimden: baska }),
        'cok talimatli': legacyMesaj({ payer: kullanici, kimden: kullanici, kimler: [kullanici, kullanici] }),
    }

    for (const [ad, b] of Object.entries(vektorler)) {
        it(`${ad}: legacy-exact (orak: Message.from(b).serialize() bayt-bayt esit)`, () => {
            expect(b[0]).toBeLessThan(0x80)
            expect(esit(donus.legacy(b), b)).toBe(true)
            expect(classifyTxMessageShape(b)).toBe('legacy-exact')
            expect(looksLikeTransactionMessage(b)).toBe(true)
        })

        it(`${ad}: +1 bayt legacy-trailing (orak: yeniden serilestirme ESIT DEGIL)`, () => {
            const t = birlestir(b, new Uint8Array([0x00]))
            expect(esit(donus.legacy(t), t)).toBe(false)
            expect(classifyTxMessageShape(t)).toBe('legacy-trailing')
            expect(looksLikeTransactionMessage(t)).toBe(true)
        })

        it(`${ad}: son bayti eksik null`, () => {
            const eksik = b.slice(0, b.length - 1)
            expect(classifyTxMessageShape(eksik)).toBeNull()
        })
    }

    it('iki mesaj arka arkaya legacy-trailing', () => {
        const a = vektorler['payer=kullanici']
        const b = vektorler['payer=baska, kullanici ikinci imzaci']
        const ikili = birlestir(a, b)
        expect(classifyTxMessageShape(ikili)).toBe('legacy-trailing')
        expect(looksLikeTransactionMessage(ikili)).toBe(true)
    })
})

describe('classifyTxMessageShape: v0', () => {
    const duz = v0Mesaj()
    const altli = v0Mesaj({ altIle: true })

    it('v0 (ALT yok): v0-exact (orak: VersionedMessage.deserialize round-trip esit)', () => {
        expect(duz[0]).toBe(0x80)
        expect(esit(donus.v0(duz), duz)).toBe(true)
        expect(classifyTxMessageShape(duz)).toBe('v0-exact')
        expect(looksLikeTransactionMessage(duz)).toBe(true)
    })

    it('v0 (ALT var): v0-exact (orak esit)', () => {
        expect(esit(donus.v0(altli), altli)).toBe(true)
        expect(classifyTxMessageShape(altli)).toBe('v0-exact')
    })

    it('+1 bayt v0-trailing (orak: esit degil)', () => {
        for (const b of [duz, altli]) {
            const t = birlestir(b, new Uint8Array([0x00]))
            expect(esit(donus.v0(t), t)).toBe(false)
            expect(classifyTxMessageShape(t)).toBe('v0-trailing')
            expect(looksLikeTransactionMessage(t)).toBe(true)
        }
    })

    it('son bayti eksik null', () => {
        for (const b of [duz, altli]) {
            expect(classifyTxMessageShape(b.slice(0, b.length - 1))).toBeNull()
        }
    })

    // P-G-1 (ZORUNLU): alici adresi ALT'tan geliyor -> talimat hesap indeksi >=
    // statik hesap sayisi. Indeksi statik sayiya baglayan bir tarayici bunu null
    // verir ve kapiyi acik birakir (E1 ile AYNI acik).
    it('P-G-1: ALT adresini talimatta kullanan v0 mesaj v0-exact doner', () => {
        const nStatik = altli[4] // 0x80, nReq, nRoS, nRoU, sonra shortvec (tek bayt)
        // Talimat hesap indeksleri: [0]=kaynak (statik), [1]=alici (ALT: indeks >= nStatik)
        // Bayt duzeni: 1+3 baslik, 1 shortvec, 32*n anahtar, 32 blockhash, 1 talimat sayisi
        const talimatOfs = 1 + 3 + 1 + 32 * nStatik + 32 + 1
        const programIdIndex = altli[talimatOfs]
        const hesapSayisi = altli[talimatOfs + 1]
        const indeksler = Array.from(altli.slice(talimatOfs + 2, talimatOfs + 2 + hesapSayisi))
        expect(programIdIndex).toBeLessThan(nStatik)
        expect(Math.max(...indeksler)).toBeGreaterThanOrEqual(nStatik)
        expect(classifyTxMessageShape(altli)).toBe('v0-exact')
    })

    it('programIdIndex ALT araliginda ise null (program kimligi ALT\'tan gelemez)', () => {
        const nStatik = altli[4]
        const talimatOfs = 1 + 3 + 1 + 32 * nStatik + 32 + 1
        const kotu = altli.slice()
        kotu[talimatOfs] = nStatik // ALT araligina tasi
        expect(classifyTxMessageShape(kotu)).toBeNull()
    })

    it('ALT toplam adres sayisini asan hesap indeksi null', () => {
        const nStatik = altli[4]
        const talimatOfs = 1 + 3 + 1 + 32 * nStatik + 32 + 1
        const kotu = altli.slice()
        kotu[talimatOfs + 2] = 200 // statik + ALT toplaminin cok ustunde
        expect(classifyTxMessageShape(kotu)).toBeNull()
    })
})

describe('classifyTxMessageShape: mesru yukler ASLA islem sekli degildir', () => {
    // Her mesru signMessage yuku null donmeli; aksi halde kullanici mesru bir
    // giris/mesaj imzasindan reddedilir (Review Focus 1).
    const siws = utf8(
        buildSiwsMessage({
            domain: 'example.com',
            address: kullanici.publicKey.toBase58(),
            statement: 'Sign in',
            uri: 'https://example.com',
            version: '1',
            chainId: 'mainnet',
            nonce: 'abc12345',
            issuedAt: '2026-11-11T00:00:00.000Z',
        })
    )
    const rnd = prng(42)
    const yukler = {
        '"Hello"': utf8('Hello'),
        'bos': new Uint8Array(0),
        '[0x01]': new Uint8Array([0x01]),
        '[0x80]': new Uint8Array([0x80]),
        '10 KB ASCII': utf8('a'.repeat(10 * 1024)),
        'SIWS metni': siws,
        '32 bayt rastgele nonce': rastgeleBayt(rnd, 32),
        '8192 bayt ikili': rastgeleBayt(rnd, 8192),
        'emoji/CJK UTF-8': utf8('merhaba \u{1f600} 世界 добрый'),
    }
    for (const [ad, b] of Object.entries(yukler)) {
        it(`${ad}: null / false`, () => {
            expect(classifyTxMessageShape(b)).toBeNull()
            expect(looksLikeTransactionMessage(b)).toBe(false)
            expect(looksLikeFutureVersionedMessage(b)).toBe(false)
        })
    }

    // Kilit testi: offchain mesaj basligi (0xff + "solana offchain" + govde)
    // hicbir tarayicida eslesmez; Solana offchain imzalari mesru yoldur.
    it('offchain baslikli (0xff + "solana offchain" + govde): hicbir tarayici eslesmez', () => {
        const b = birlestir(
            new Uint8Array([0xff]),
            utf8('solana offchain'),
            new Uint8Array([0, 0, 1, 0, 5]),
            utf8('Hello')
        )
        expect(classifyTxMessageShape(b)).toBeNull()
        expect(looksLikeTransactionMessage(b)).toBe(false)
        expect(looksLikeTransactionMessageWith(b, true)).toBe(false)
        expect(looksLikeFutureVersionedMessage(b)).toBe(false)
    })

    it('ozellik testi: 20.000 rastgele metin/ikili yuk, hicbiri *-exact degil', () => {
        const r = prng(2026)
        for (let i = 0; i < 20000; i++) {
            const uzunluk = Math.floor(r() * 300)
            const b = i % 2 === 0 ? rastgeleBayt(r, uzunluk) : rastgeleMetinYuku(r, uzunluk)
            const sekil = classifyTxMessageShape(b)
            expect(sekil === 'legacy-exact' || sekil === 'v0-exact').toBe(false)
        }
    })
})

describe('looksLikeFutureVersionedMessage', () => {
    it('0x81 + 99 rastgele bayt (>=70) true', () => {
        const b = birlestir(new Uint8Array([0x81]), rastgeleBayt(prng(7), 99))
        expect(looksLikeFutureVersionedMessage(b)).toBe(true)
    })
    it('69 bayt false', () => {
        const b = birlestir(new Uint8Array([0x81]), rastgeleBayt(prng(7), 68))
        expect(b.length).toBe(69)
        expect(looksLikeFutureVersionedMessage(b)).toBe(false)
    })
    it('tam 70 bayt true (sinir)', () => {
        const b = birlestir(new Uint8Array([0x81]), rastgeleBayt(prng(8), 69))
        expect(looksLikeFutureVersionedMessage(b)).toBe(true)
    })

    // BILINEN ACIK (kasitli): 0x82 ve uzeri onekli >=70 bayt yuk SIMDI mesru
    // metin/ikili sayilir (Solana yeni islem formati henuz etkin degil; yanlis
    // pozitif mesru imzalari keser). IZLEME: Solana yeni bir surum onekini
    // etkinlestirince bu tarayici guncellenir (Gorev 31 belgesi). Bu test o
    // karari kilitler; kimse bilmeden degistiremesin.
    it('BILINEN ACIK: 0x82 onekli >=70 bayt yuk null/false (izleme: Gorev 31)', () => {
        const b = birlestir(new Uint8Array([0x82]), rastgeleBayt(prng(9), 99))
        expect(classifyTxMessageShape(b)).toBeNull()
        expect(looksLikeTransactionMessage(b)).toBe(false)
        expect(looksLikeTransactionMessageWith(b, true)).toBe(false)
        expect(looksLikeFutureVersionedMessage(b)).toBe(false)
    })
})

// P-G-2 yumusak baslik kurali. Tam ayristirma basarisiz olsa bile BASLIK makulse
// 'baslik-supheli' sayilir. Kural SOFT_HEADER_RULE ile acilip kapanir; iki deger
// icin de davranis kilitli.
describe('yumusak baslik kurali (SOFT_HEADER_RULE)', () => {
    const saglam = legacyMesaj({ payer: kullanici, kimden: kullanici })
    it('sabit bir const boolean (fonksiyon/store degil)', () => {
        expect(typeof SOFT_HEADER_RULE).toBe('boolean')
    })

    it('ayristirma basarisiz ama baslik makul: bayrak KAPALI -> false, ACIK -> true', () => {
        // Daha belirgin bozma: talimat sayisini cok buyut -> ayristirma kesin null
        const b = saglam.slice()
        const nHesap = b[3]
        const talimatSayisiOfs = 3 + 1 + 32 * nHesap + 32
        b[talimatSayisiOfs] = 100 // 100 talimat vaat eder, bayt yok
        expect(classifyTxMessageShape(b)).toBeNull()
        expect(looksLikeTransactionMessageWith(b, false)).toBe(false)
        expect(looksLikeTransactionMessageWith(b, true)).toBe(true)
    })

    it('v0: ALT bolumu bozuk ama baslik makul: bayrak ACIK -> true, KAPALI -> false', () => {
        const b = v0Mesaj({ altIle: true }).slice(0, -3) // ALT bolumu kesik
        expect(classifyTxMessageShape(b)).toBeNull()
        expect(looksLikeTransactionMessageWith(b, false)).toBe(false)
        expect(looksLikeTransactionMessageWith(b, true)).toBe(true)
    })

    it('tam eslesen mesaj iki degerde de true', () => {
        expect(looksLikeTransactionMessageWith(saglam, false)).toBe(true)
        expect(looksLikeTransactionMessageWith(saglam, true)).toBe(true)
    })

    it('baslik makul DEGILSE bayrak ACIK olsa da false (nReq=0, nRoS>=nReq, kisa uzunluk)', () => {
        const nReq0 = saglam.slice()
        nReq0[0] = 0
        const rosBuyuk = saglam.slice()
        rosBuyuk[1] = rosBuyuk[0]
        const kisa = saglam.slice(0, 3 + 1 + 32 * saglam[3] + 31) // blockhash eksik
        for (const b of [nReq0, rosBuyuk, kisa]) {
            expect(looksLikeTransactionMessageWith(b, true)).toBe(false)
        }
    })

    it('mesru yukler (Hello, SIWS, nonce, offchain) bayrak ACIK olsa da false', () => {
        const r = prng(11)
        const yukler = [
            utf8('Hello'),
            utf8('a'.repeat(10240)),
            rastgeleBayt(r, 32),
            birlestir(new Uint8Array([0xff]), utf8('solana offchain'), utf8('govde')),
            new Uint8Array([0x01]),
            new Uint8Array([0x80]),
        ]
        for (const b of yukler) expect(looksLikeTransactionMessageWith(b, true)).toBe(false)
    })

    it('yanlis-pozitif orani (bayrak ACIK): UTF-8 metin ve ikili ayri ayri < %0,5 (5.000 yuk, 32..8192 bayt; 100.000 yukluk olcum task-1-report.md icinde)', () => {
        const r = prng(99)
        const N = 5000
        let metinFP = 0
        let ikiliFP = 0
        for (let i = 0; i < N; i++) {
            const uzunluk = 32 + Math.floor(r() * (8192 - 32 + 1))
            if (looksLikeTransactionMessageWith(rastgeleMetinYuku(r, uzunluk), true)) metinFP++
            if (looksLikeTransactionMessageWith(rastgeleBayt(r, uzunluk), true)) ikiliFP++
        }
        expect(metinFP / N).toBeLessThan(0.005)
        expect(ikiliFP / N).toBeLessThan(0.005)
    })

    // Verilen karar (Q9 hukmu, olcume bagli): iki oran %0,5'in altinda oldugu icin
    // kural ACIK. Olcum degeri task-1-report.md'de.
    it('commit edilen sabit olcume gore ACIK (true)', () => {
        expect(SOFT_HEADER_RULE).toBe(true)
        expect(looksLikeTransactionMessage(new Uint8Array(0))).toBe(false)
    })
})

// final SU-4: `looksLikeTransactionMessage` ikinci argumani guvenlik kararini cagri
// noktasindan degistirilebilir kilardi: dizi yardimcilari (some/filter/every/map)
// islevi (oge, indeks, dizi) ile cagirir ve indeks `softHeaderRule` olurdu --
// `softHeaderRule === true` HICBIR indekste saglanmaz, yumusak baslik kurali SESSIZCE
// kapanirdi. Public islev TEK argumanlidir; iki argumanli bicim test-only
// `looksLikeTransactionMessageWith`'te.
describe('SU-4: yumusak baslik kurali cagri noktasindan kapatilamaz', () => {
    // Tam ayristirma basarisiz ama baslik makul: kural ACIKken true.
    const baslikSupheli = (() => {
        const b = legacyMesaj({ payer: kullanici, kimden: kullanici }).slice()
        const nHesap = b[3]
        b[3 + 1 + 32 * nHesap + 32] = 100 // 100 talimat vaat eder, bayt yok
        return b
    })()

    it('on kosul: ornek yuk yalniz yumusak baslik kuraliyla yakalanir', () => {
        expect(classifyTxMessageShape(baslikSupheli)).toBeNull()
        expect(looksLikeTransactionMessage(baslikSupheli)).toBe(true)
        expect(looksLikeTransactionMessageWith(baslikSupheli, false)).toBe(false)
    })

    it('some / filter / every / map: indeks ikinci arguman olarak gecse de kural KAPANMAZ', () => {
        expect([baslikSupheli].some(looksLikeTransactionMessage)).toBe(true)
        expect([baslikSupheli].filter(looksLikeTransactionMessage)).toHaveLength(1)
        expect([baslikSupheli].every(looksLikeTransactionMessage)).toBe(true)
        expect([baslikSupheli].map(looksLikeTransactionMessage)).toEqual([true])
        // Indeks 1 ve 5 icin de (ilk oge degil)
        const dizi = [utf8('Hello'), baslikSupheli, utf8('x'), utf8('y'), utf8('z'), baslikSupheli]
        expect(dizi.map(looksLikeTransactionMessage)).toEqual([false, true, false, false, false, true])
    })

    it('public islev ikinci argumani YOKSAYAR: false verilse de kural kapanmaz', () => {
        expect(looksLikeTransactionMessage(baslikSupheli, false)).toBe(true)
        expect(looksLikeTransactionMessage.length).toBe(1)
    })
})

// final SU-15: MAX_REQUIRED_SIGNATURES = 19 sinirinin ve sifir talimatli mesajin regresyon
// kilidi. Onceki vektorler 1-3 imzaciliydi; sinir hicbir testle kilitli degildi (19 -> 18 ya da
// 19 -> 20 yapan bir degisiklik testleri kirmazdi) ve sifir talimatli mesajin yalniz yumusak
// baslik kuraliyla yakalandigi testsizdi. Vektorler GERCEK web3.js ciktisidir.
describe('SU-15: imza siniri vektorleri (n = 4, 8, 11, 12, 19) ve n = 20', () => {
    const PROGRAM = new PublicKey('11111111111111111111111111111112')

    // TUM hesaplari imzaci olan tek talimatli mesaj (program kimligi imzaci degildir).
    function tumImzaciTalimat(n) {
        const imzacilar = Array.from({ length: n }, () => Keypair.generate())
        return {
            imzacilar,
            ix: new TransactionInstruction({
                programId: PROGRAM,
                keys: imzacilar.map((k) => ({ pubkey: k.publicKey, isSigner: true, isWritable: true })),
                data: Buffer.from([1, 2, 3]),
            }),
        }
    }

    function legacyNImzali(n) {
        const { imzacilar, ix } = tumImzaciTalimat(n)
        const tx = new Transaction()
        tx.feePayer = imzacilar[0].publicKey
        tx.recentBlockhash = BLOCKHASH
        tx.add(ix)
        return new Uint8Array(tx.compileMessage().serialize())
    }

    function v0NImzali(n) {
        const { imzacilar, ix } = tumImzaciTalimat(n)
        const m = new TransactionMessage({
            payerKey: imzacilar[0].publicKey,
            recentBlockhash: BLOCKHASH,
            instructions: [ix],
        }).compileToV0Message()
        return new Uint8Array(m.serialize())
    }

    for (const n of [4, 8, 11, 12, 19]) {
        it(`legacy, ${n} imzaci: legacy-exact ve islem mesaji sayilir`, () => {
            const b = legacyNImzali(n)
            expect(b[0]).toBe(n) // vektor gercekten n imzaci tasiyor
            expect(classifyTxMessageShape(b)).toBe('legacy-exact')
            expect(looksLikeTransactionMessage(b)).toBe(true)
            // Yumusak baslik kuralina GUVENMEDEN de yakalanir (tam ayristirma).
            expect(looksLikeTransactionMessageWith(b, false)).toBe(true)
        })

        it(`v0, ${n} imzaci: v0-exact ve islem mesaji sayilir`, () => {
            const b = v0NImzali(n)
            expect(b[0]).toBe(0x80)
            expect(b[1]).toBe(n)
            expect(classifyTxMessageShape(b)).toBe('v0-exact')
            expect(looksLikeTransactionMessage(b)).toBe(true)
            expect(looksLikeTransactionMessageWith(b, false)).toBe(true)
        })
    }

    // n = 20: sinirin HEMEN otesi. GERCEK web3.js 20 imzacili mesaj (hesap sayisi ve baslik
    // tutarli: 20 imzaci + program kimligi): reddi SADECE imza siniri (19) belirler -- hesap
    // sayisi gibi baska bir kosul degil. Tam ayristirma null; yumusak baslik kurali da yakalamaz
    // (baslik makul degil).
    it('legacy, 20 imzaci: classify null, islem mesaji sayilmaz', () => {
        const b = legacyNImzali(20)
        expect(b[0]).toBe(20)
        expect(classifyTxMessageShape(b)).toBeNull()
        expect(looksLikeTransactionMessage(b)).toBe(false)
        expect(looksLikeTransactionMessageWith(b, true)).toBe(false)
    })

    it('v0, 20 imzaci: classify null, islem mesaji sayilmaz', () => {
        const b = v0NImzali(20)
        expect(b[1]).toBe(20)
        expect(classifyTxMessageShape(b)).toBeNull()
        expect(looksLikeTransactionMessage(b)).toBe(false)
        expect(looksLikeTransactionMessageWith(b, true)).toBe(false)
    })

    // Elle baslikli (n = 19 mesajinin baslik baytini 20 yapar): bu vektorde hesap sayisi da
    // uyumsuzdur, yani imza siniri tek basina belirleyici degildir -- yalniz null/false beklenir.
    it('elle baslikli 20 imzaci (legacy ve v0): classify null', () => {
        const l = legacyNImzali(19).slice()
        l[0] = 20
        const v = v0NImzali(19).slice()
        v[1] = 20
        expect(classifyTxMessageShape(l)).toBeNull()
        expect(classifyTxMessageShape(v)).toBeNull()
    })
})

describe('SU-15: sifir talimatli mesaj yalniz yumusak baslik kuraliyla yakalanir', () => {
    const sifirTalimatLegacy = () => new Uint8Array(new Message({
        header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 },
        accountKeys: [kullanici.publicKey.toBase58()],
        recentBlockhash: BLOCKHASH,
        instructions: [],
    }).serialize())

    it('legacy: classify null (talimat sayisi >= 1 sarti); kural ACIK -> true, KAPALI -> false', () => {
        const b = sifirTalimatLegacy()
        expect(b).toHaveLength(69) // 3 baslik + 1 hesap sayisi + 32 hesap + 32 blockhash + 1 talimat sayisi
        expect(classifyTxMessageShape(b)).toBeNull()
        expect(looksLikeTransactionMessageWith(b, true)).toBe(true)
        expect(looksLikeTransactionMessageWith(b, false)).toBe(false)
        // Public islev SOFT_HEADER_RULE'a (ACIK) baglidir.
        expect(looksLikeTransactionMessage(b)).toBe(true)
    })

    it('v0: classify null; kural ACIK -> true, KAPALI -> false', () => {
        const b = new Uint8Array(new TransactionMessage({
            payerKey: kullanici.publicKey,
            recentBlockhash: BLOCKHASH,
            instructions: [],
        }).compileToV0Message().serialize())
        expect(classifyTxMessageShape(b)).toBeNull()
        expect(looksLikeTransactionMessageWith(b, true)).toBe(true)
        expect(looksLikeTransactionMessageWith(b, false)).toBe(false)
        expect(looksLikeTransactionMessage(b)).toBe(true)
    })
})
