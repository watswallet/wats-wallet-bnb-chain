// Test vektorleri GERCEK web3.js ciktisidir: elle yazilmis bir bayt dizisi
// bicimi dogru "hatirladigimiz" kadar dogrular, kutuphanenin gercekte urettigini
// degil.
import './bufferGlobal.js'
import { describe, it, expect } from 'vitest'
import {
    Keypair,
    SystemProgram,
    Transaction,
    TransactionMessage,
    VersionedTransaction,
    ComputeBudgetProgram,
} from '@solana/web3.js'
import { looksLikeTransaction, parseDappTransaction } from './parseDappTransaction'

const BLOCKHASH = '11111111111111111111111111111111'
const gonderen = Keypair.generate()
const alici = Keypair.generate()

const transferTalimati = () =>
    SystemProgram.transfer({
        fromPubkey: gonderen.publicKey,
        toPubkey: alici.publicKey,
        lamports: 1000,
    })

function legacyTransfer({ imzali }) {
    const tx = new Transaction()
    tx.recentBlockhash = BLOCKHASH
    tx.feePayer = gonderen.publicKey
    tx.add(transferTalimati())
    if (imzali) {
        tx.sign(gonderen)
        return new Uint8Array(tx.serialize())
    }
    return new Uint8Array(tx.serialize({ requireAllSignatures: false, verifySignatures: false }))
}

function v0Transfer({ imzali }) {
    const mesaj = new TransactionMessage({
        payerKey: gonderen.publicKey,
        recentBlockhash: BLOCKHASH,
        instructions: [transferTalimati()],
    }).compileToV0Message()
    const tx = new VersionedTransaction(mesaj)
    if (imzali) tx.sign([gonderen])
    return new Uint8Array(tx.serialize())
}

const utf8 = (metin) => new TextEncoder().encode(metin)

describe('looksLikeTransaction — islem SEKLINDEKI baytlar', () => {
    it('GERCEK legacy transfer islemi (imzasiz) islem olarak taninir', () => {
        expect(looksLikeTransaction(legacyTransfer({ imzali: false }))).toBe(true)
    })

    it('GERCEK legacy transfer islemi (imzali) islem olarak taninir', () => {
        expect(looksLikeTransaction(legacyTransfer({ imzali: true }))).toBe(true)
    })

    it('GERCEK v0 transfer islemi (imzasiz ve imzali) islem olarak taninir', () => {
        expect(looksLikeTransaction(v0Transfer({ imzali: false }))).toBe(true)
        expect(looksLikeTransaction(v0Transfer({ imzali: true }))).toBe(true)
    })
})

describe('looksLikeTransaction — mesru mesajlar YANLIS POZITIF uretmez', () => {
    it('duz UTF-8 SIWS mesaji islem SAYILMAZ', () => {
        const siws = utf8(
            `app.example.com wants you to sign in with your Solana account:\n` +
            `${gonderen.publicKey.toBase58()}\n\n` +
            `URI: https://app.example.com\nVersion: 1\nChain ID: mainnet\n` +
            `Nonce: 8f3ac91d\nIssued At: 2026-09-01T00:00:00.000Z`,
        )
        expect(looksLikeTransaction(siws)).toBe(false)
    })

    it('kisa giris mesaji ve turkce metin islem SAYILMAZ', () => {
        expect(looksLikeTransaction(utf8('Sign this message to log in. Nonce: 8f3a'))).toBe(false)
        expect(looksLikeTransaction(utf8('Merhaba dunya, bu bir imza test mesajidir.'))).toBe(false)
    })

    it('bos ve cok kisa girdi islem SAYILMAZ', () => {
        expect(looksLikeTransaction(new Uint8Array(0))).toBe(false)
        expect(looksLikeTransaction(utf8('hi'))).toBe(false)
    })
})

describe('looksLikeTransaction — bicimsiz girdi', () => {
    it('Uint8Array olmayan her sey false doner (firlatmaz)', () => {
        expect(looksLikeTransaction(null)).toBe(false)
        expect(looksLikeTransaction(undefined)).toBe(false)
        expect(looksLikeTransaction('AQAAA')).toBe(false)
        expect(looksLikeTransaction([1, 2, 3])).toBe(false)
    })

    it('islem uzunlugunda ama BASLIGI tutmayan baytlar islem SAYILMAZ', () => {
        // Ilk bayt "1 imza" der ama 65. bayttaki baslik numRequiredSignatures'i
        // 7 raporlar: iki bagimsiz konum celisiyor.
        const sahte = new Uint8Array(300)
        sahte[0] = 1
        sahte[65] = 7
        expect(looksLikeTransaction(sahte)).toBe(false)
    })
})

// KOK NEDEN: dapp islemini "cozdum" demeden imzalamak kor imzalamadir. Bu
// ayristirici onay ekraninin gosterecegi HER seyin (kim odeyecek, kim imzalayacak,
// hangi program cagriliyor) TEK kaynagi; yanlis bir surum tespiti Jupiter'in v0
// islemini sessizce legacy sanip cozulemez hataya dusururdu.
const b64 = (bytes) => Buffer.from(bytes).toString('base64')

function legacyIkiImzaci() {
    const a = Keypair.generate()
    const b = Keypair.generate()
    const tx = new Transaction()
    tx.recentBlockhash = BLOCKHASH
    tx.feePayer = a.publicKey
    tx.add(SystemProgram.transfer({ fromPubkey: a.publicKey, toPubkey: b.publicKey, lamports: 1 }))
    tx.add(SystemProgram.transfer({ fromPubkey: b.publicKey, toPubkey: a.publicKey, lamports: 2 }))
    // Ortak imzaci ZATEN imzalamis: eksik imzaci YALNIZCA a olmali.
    tx.partialSign(b)
    return { a, b, base64: b64(tx.serialize({ requireAllSignatures: false, verifySignatures: false })) }
}

describe('parseDappTransaction -- legacy', () => {
    it('surumu, ucret odeyeni ve iki imzaciyi cozer', () => {
        const { a, b, base64 } = legacyIkiImzaci()
        const parsed = parseDappTransaction(base64)

        expect(parsed.version).toBe('legacy')
        expect(parsed.feePayer).toBe(a.publicKey.toBase58())
        expect(parsed.requiredSigners).toEqual([a.publicKey.toBase58(), b.publicKey.toBase58()])
        // b ZATEN imzaladi; eksik olan yalnizca a.
        expect(parsed.missingCosigners).toEqual([a.publicKey.toBase58()])
        expect(parsed.firstProgramId).toBe(SystemProgram.programId.toBase58())
        expect(parsed.isDurableNonce).toBe(false)
    })

    // BASE58 BUYUK/KUCUK HARF DUYARLIDIR (K8): adres KUCULTULMEDEN donmeli, aksi
    // halde §6.1'in imzalayici kilidi mesru bir islemi reddeder.
    it('adresler KUCULTULMEZ', () => {
        const { a, base64 } = legacyIkiImzaci()
        const parsed = parseDappTransaction(base64)
        expect(parsed.feePayer).not.toBe(a.publicKey.toBase58().toLowerCase())
    })

    it('ilk talimat AdvanceNonceAccount ise durable nonce isaretlenir', () => {
        const a = Keypair.generate()
        const nonce = Keypair.generate().publicKey
        const auth = Keypair.generate()
        const tx = new Transaction()
        tx.recentBlockhash = BLOCKHASH
        tx.feePayer = a.publicKey
        tx.add(SystemProgram.nonceAdvance({ noncePubkey: nonce, authorizedPubkey: auth.publicKey }))
        tx.add(SystemProgram.transfer({ fromPubkey: a.publicKey, toPubkey: nonce, lamports: 1 }))

        const parsed = parseDappTransaction(b64(tx.serialize({ requireAllSignatures: false, verifySignatures: false })))
        expect(parsed.isDurableNonce).toBe(true)
    })

    // K1 REGRESYONU: web3.js `Transaction.populate`, tx.signatures'i TEL'deki
    // imza yuvasi SAYISI kadar (dapp kontrolunde) uretir, mesaj basligindaki
    // numRequiredSignatures ile CAPRAZ KONTROL ETMEDEN. Ikinci imza yuvasini
    // silip sayaci 1'e dusuren bir sahte tel, mesaji (ve basligini) HIC
    // DEGISTIRMEDEN gecerli kalir -- `tx.signatures.length`e guvenmek ikinci
    // zorunlu imzaciyi onay ekranindan TAMAMEN gizlerdi.
    it('FORGE: tek imza yuvali tel, iki imzaci isteyen mesaji tasir -- ikinci imzaci GIZLENMEZ', () => {
        const { a, b, base64 } = legacyIkiImzaci()
        const bytes = Uint8Array.from(Buffer.from(base64, 'base64'))
        // Gercek tel: [shortvec 2][64 bayt sig_a][64 bayt sig_b][mesaj, basim
        // numRequiredSignatures=2]. sig_b yuvasini SIL, sayaci 1 yap; mesaj
        // (ve basligi) DOKUNULMADAN kalir.
        const forged = new Uint8Array(bytes.length - 64)
        forged[0] = 1
        forged.set(bytes.subarray(1, 65), 1)
        forged.set(bytes.subarray(129), 65)

        const parsed = parseDappTransaction(b64(forged))
        // Mesaj basligi HALA 2 zorunlu imzaci istiyor: b, tel'de imza yuvasi
        // olmasa BILE requiredSigners'ta gorunmeli.
        expect(parsed.requiredSigners).toEqual([a.publicKey.toBase58(), b.publicKey.toBase58()])
        expect(parsed.missingCosigners).toContain(b.publicKey.toBase58())
        expect(parsed.feePayer).toBe(a.publicKey.toBase58())
    })
})

describe('parseDappTransaction -- v0', () => {
    it('surum SAYI 0 olarak doner ve ilk program cozulur', () => {
        const a = Keypair.generate()
        const message = new TransactionMessage({
            payerKey: a.publicKey,
            recentBlockhash: BLOCKHASH,
            instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1500 })],
        }).compileToV0Message()
        const vtx = new VersionedTransaction(message)

        const parsed = parseDappTransaction(b64(vtx.serialize()))
        expect(parsed.version).toBe(0)
        expect(parsed.version).not.toBe('0')
        expect(parsed.feePayer).toBe(a.publicKey.toBase58())
        expect(parsed.requiredSigners).toEqual([a.publicKey.toBase58()])
        expect(parsed.missingCosigners).toEqual([a.publicKey.toBase58()])
        expect(parsed.firstProgramId).toBe(ComputeBudgetProgram.programId.toBase58())
    })

    it('imzalanmis v0 imzaciyi eksik SAYMAZ', () => {
        const a = Keypair.generate()
        const b = Keypair.generate()
        const message = new TransactionMessage({
            payerKey: a.publicKey,
            recentBlockhash: BLOCKHASH,
            instructions: [SystemProgram.transfer({ fromPubkey: b.publicKey, toPubkey: a.publicKey, lamports: 1 })],
        }).compileToV0Message()
        const vtx = new VersionedTransaction(message)
        vtx.sign([b])

        const parsed = parseDappTransaction(b64(vtx.serialize()))
        expect(parsed.requiredSigners).toContain(b.publicKey.toBase58())
        expect(parsed.missingCosigners).toEqual([a.publicKey.toBase58()])
    })
})

describe('parseDappTransaction -- reddedilen girdiler', () => {
    it('base64 olmayan girdi TX_DESERIALIZE_FAILED', () => {
        expect(() => parseDappTransaction('bu base64 degil !!!')).toThrow('TX_DESERIALIZE_FAILED')
        expect(() => parseDappTransaction('')).toThrow('TX_DESERIALIZE_FAILED')
        expect(() => parseDappTransaction(null)).toThrow('TX_DESERIALIZE_FAILED')
    })

    it('gecerli base64 ama islem OLMAYAN baytlar TX_DESERIALIZE_FAILED', () => {
        expect(() => parseDappTransaction(b64(new Uint8Array([1, 2, 3, 4])))).toThrow('TX_DESERIALIZE_FAILED')
    })

    // v1 HENUZ YOK ama surum baytini elle kuran bir dapp'e "cozemedim" demek
    // YANLIS teshistir: kullaniciya gosterilecek metin farklidir.
    it('legacy/v0 disi bir surum UNSUPPORTED_TX_VERSION', () => {
        const { base64 } = legacyIkiImzaci()
        const bytes = Uint8Array.from(Buffer.from(base64, 'base64'))
        // Sekil: [shortvec imza sayisi][64*n imza][mesaj]. Burada imza sayisi 2,
        // shortvec tek bayt, yani mesaj 1 + 128. inci bayttan basliyor.
        bytes[1 + 2 * 64] = 0x81
        expect(() => parseDappTransaction(b64(bytes))).toThrow('UNSUPPORTED_TX_VERSION')
    })

    // M2'nin urunu bu genislemede KAYBOLMAMALI.
    it('looksLikeTransaction hala disa acik', () => {
        expect(typeof looksLikeTransaction).toBe('function')
    })
})
