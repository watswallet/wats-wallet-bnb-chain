// KOK NEDEN (§6.2): `transaction.sign(...)` MEVCUT BUTUN IMZALARI SILER.
// Dapp islemleri cok imzacilidir (Jupiter'in gecici hesaplari, escrow'lar);
// silinen bir ortak imza, kullanicinin onayladigi islemi zincirde GECERSIZ
// yapar ve hata ancak yayin sirasinda, ucret odendikten sonra gorunur.
import './bufferGlobal.js'
import { describe, it, expect } from 'vitest'
import {
    Keypair, SystemProgram, Transaction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js'
import { parseDappTransaction } from './parseDappTransaction'
import { signDappTransaction } from './signDappTransaction'

const BLOCKHASH = '11111111111111111111111111111111'
const b64 = (bytes) => Buffer.from(bytes).toString('base64')

function legacyOrtakImzali() {
    const bizim = Keypair.generate()
    const ortak = Keypair.generate()
    const tx = new Transaction()
    tx.recentBlockhash = BLOCKHASH
    tx.feePayer = bizim.publicKey
    tx.add(SystemProgram.transfer({ fromPubkey: bizim.publicKey, toPubkey: ortak.publicKey, lamports: 1 }))
    tx.add(SystemProgram.transfer({ fromPubkey: ortak.publicKey, toPubkey: bizim.publicKey, lamports: 2 }))
    tx.partialSign(ortak)
    const ortakImza = Buffer.from(tx.signatures.find((s) => s.publicKey.equals(ortak.publicKey)).signature)
    return { bizim, ortak, ortakImza, base64: b64(tx.serialize({ requireAllSignatures: false, verifySignatures: false })) }
}

describe('signDappTransaction -- legacy', () => {
    it('ORTAK IMZACININ MEVCUT IMZASINI KORUR', () => {
        const { bizim, ortak, ortakImza, base64 } = legacyOrtakImzali()
        const parsed = parseDappTransaction(base64)

        const cikti = signDappTransaction(parsed, bizim, { forBroadcast: false })

        const geri = Transaction.from(Buffer.from(cikti, 'base64'))
        const ortakSonra = geri.signatures.find((s) => s.publicKey.equals(ortak.publicKey)).signature
        expect(Buffer.compare(Buffer.from(ortakSonra), ortakImza)).toBe(0)
        // Kendi imzamiz da EKLENMIS olmali.
        expect(geri.signatures.find((s) => s.publicKey.equals(bizim.publicKey)).signature).not.toBeNull()
        expect(geri.verifySignatures()).toBe(true)
    })

    it('base64 DIZGE doner', () => {
        const { bizim, base64 } = legacyOrtakImzali()
        const cikti = signDappTransaction(parseDappTransaction(base64), bizim, { forBroadcast: false })
        expect(typeof cikti).toBe('string')
        expect(cikti).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    })

    // forBroadcast:false yolunun TEK amaci budur: eksik imzaciyla da
    // serilestirebilmek, cunku islemi dapp tamamlayacak.
    it('forBroadcast:false eksik imzaciya RAGMEN serilestirir', () => {
        const bizim = Keypair.generate()
        const ortak = Keypair.generate()
        const tx = new Transaction()
        tx.recentBlockhash = BLOCKHASH
        tx.feePayer = bizim.publicKey
        tx.add(SystemProgram.transfer({ fromPubkey: ortak.publicKey, toPubkey: bizim.publicKey, lamports: 1 }))
        const parsed = parseDappTransaction(b64(tx.serialize({ requireAllSignatures: false, verifySignatures: false })))

        const cikti = signDappTransaction(parsed, bizim, { forBroadcast: false })
        const geri = Transaction.from(Buffer.from(cikti, 'base64'))
        expect(geri.signatures.find((s) => s.publicKey.equals(ortak.publicKey)).signature).toBeNull()
    })

    // §6.2: yayini BIZ yapacaksak islem TAM imzali olmali. Ham web3.js hatasi
    // ("Signature verification failed") kullaniciya gosterilemez; sendErrors
    // tablosundaki bir koda cevrilir.
    it('forBroadcast:true eksik ortak imzaciyi SOLANA_MISSING_COSIGNER ile reddeder', () => {
        const bizim = Keypair.generate()
        const ortak = Keypair.generate()
        const tx = new Transaction()
        tx.recentBlockhash = BLOCKHASH
        tx.feePayer = bizim.publicKey
        tx.add(SystemProgram.transfer({ fromPubkey: ortak.publicKey, toPubkey: bizim.publicKey, lamports: 1 }))
        const parsed = parseDappTransaction(b64(tx.serialize({ requireAllSignatures: false, verifySignatures: false })))

        expect(() => signDappTransaction(parsed, bizim, { forBroadcast: true })).toThrow('SOLANA_MISSING_COSIGNER')
    })

    // Review bulgusu (Finding 1): `Transaction.from`'un `tx.signatures` dizisi
    // TEL'deki (dapp kontrolunde) imza-sayisi shortvec'inden kurulur, mesaj
    // basligindaki numRequiredSignatures'tan DEGIL (bkz. parseDappTransaction.js
    // K1 bulgusu). `partialSign` -> `_compile()` bu iki sayi UYUSMAZSA butun
    // diziyi SIFIRDAN kurar. Burada 3 zorunlu imzacili bir islem kuruyoruz,
    // ORTASINDAKI imzaciyi (ortak) imzaliyoruz, sonra teli sahteciliyoruz:
    // sayaci gercek (3) yerine ortak'in yuvasina KADAR (dahil) kisaltiyoruz --
    // ortak'in GERCEK imza baytlari tel'de kaliyor, sadece sayac yalan
    // soyluyor. Bu, ucuncu (hic imzalanmamis) imzaciyi TAMAMEN tel disi
    // birakir. Duzeltmeden ONCE bu senaryoda ortak'in imzasi partialSign
    // sirasinda SESSIZCE silinirdi.
    it('sahte KISA imza sayaciyla bile ORTAK IMZACININ imzasini KORUR', () => {
        const bizim = Keypair.generate()
        const a = Keypair.generate()
        const b = Keypair.generate()
        const tx = new Transaction()
        tx.recentBlockhash = BLOCKHASH
        tx.feePayer = bizim.publicKey
        tx.add(SystemProgram.transfer({ fromPubkey: bizim.publicKey, toPubkey: a.publicKey, lamports: 1 }))
        tx.add(SystemProgram.transfer({ fromPubkey: a.publicKey, toPubkey: b.publicKey, lamports: 2 }))
        tx.add(SystemProgram.transfer({ fromPubkey: b.publicKey, toPubkey: bizim.publicKey, lamports: 3 }))

        // Zorunlu imzaci sirasi web3.js'in ic mantigina gore belirlenir (basit
        // eklenme sirasi DEGIL) -- bu yuzden 'once gelen' imzaciyi (ortak) ve
        // 'sonra gelen'i (ucuncu, tel'den dusurulecek olan) DINAMIK bulunur.
        const zorunlular = tx.compileMessage().accountKeys.slice(0, 3)
        const idxA = zorunlular.findIndex((k) => k.equals(a.publicKey))
        const idxB = zorunlular.findIndex((k) => k.equals(b.publicKey))
        const [ortak, ortakIndex] = idxA < idxB ? [a, idxA] : [b, idxB]

        tx.partialSign(ortak)
        const ortakImza = Buffer.from(tx.signatures.find((s) => s.publicKey.equals(ortak.publicKey)).signature)

        const tamTel = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        const kalanSayisi = ortakIndex + 1
        const sahteTel = Buffer.concat([
            Buffer.from([kalanSayisi]),
            tamTel.subarray(1, 1 + kalanSayisi * 64),
            tamTel.subarray(1 + 3 * 64),
        ])

        const parsed = parseDappTransaction(sahteTel.toString('base64'))
        const cikti = signDappTransaction(parsed, bizim, { forBroadcast: false })

        const geri = Transaction.from(Buffer.from(cikti, 'base64'))
        const ortakSonra = geri.signatures.find((s) => s.publicKey.equals(ortak.publicKey)).signature
        expect(ortakSonra).not.toBeNull()
        expect(Buffer.compare(Buffer.from(ortakSonra), ortakImza)).toBe(0)
    })
})

describe('signDappTransaction -- v0', () => {
    it('mevcut v0 imzasini KORUR ve kendi imzamizi ekler', () => {
        const bizim = Keypair.generate()
        const ortak = Keypair.generate()
        const message = new TransactionMessage({
            payerKey: bizim.publicKey,
            recentBlockhash: BLOCKHASH,
            instructions: [SystemProgram.transfer({ fromPubkey: ortak.publicKey, toPubkey: bizim.publicKey, lamports: 1 })],
        }).compileToV0Message()
        const vtx = new VersionedTransaction(message)
        vtx.sign([ortak])
        const ortakIndex = message.staticAccountKeys.findIndex((k) => k.equals(ortak.publicKey))
        const ortakImza = Buffer.from(vtx.signatures[ortakIndex])

        const parsed = parseDappTransaction(b64(vtx.serialize()))
        const cikti = signDappTransaction(parsed, bizim, { forBroadcast: true })

        const geri = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(cikti, 'base64')))
        expect(Buffer.compare(Buffer.from(geri.signatures[ortakIndex]), ortakImza)).toBe(0)
        expect(geri.signatures.every((s) => s.some((b) => b !== 0))).toBe(true)
    })

    it('v0 forBroadcast:true eksik imzaciyi SOLANA_MISSING_COSIGNER ile reddeder', () => {
        const bizim = Keypair.generate()
        const ortak = Keypair.generate()
        const message = new TransactionMessage({
            payerKey: bizim.publicKey,
            recentBlockhash: BLOCKHASH,
            instructions: [SystemProgram.transfer({ fromPubkey: ortak.publicKey, toPubkey: bizim.publicKey, lamports: 1 })],
        }).compileToV0Message()
        const parsed = parseDappTransaction(b64(new VersionedTransaction(message).serialize()))

        expect(() => signDappTransaction(parsed, bizim, { forBroadcast: true })).toThrow('SOLANA_MISSING_COSIGNER')
    })

    // Review bulgusu (Finding 3): duzeltmeden once v0 kapisi yalnizca "yuva
    // SIFIR mi" bakiyordu -- DOLU ama GECERSIZ (tahrif edilmis) bir imza
    // yakalanmiyordu, oysa AYNI durum legacy yolda gercek ed25519 dogrulamasi
    // sayesinde yakalanirdi. Burada ortak GERCEKTEN imzalar, sonra o imza
    // baytlari BOZULUR (yuva sifir DEGIL, ama artik gecerli de degil) --
    // duzeltmeden once bu tel forBroadcast:true altinda SESSIZCE gecerdi.
    it('v0 forBroadcast:true DOLU ama GECERSIZ (tahrif edilmis) ortak imzasini SOLANA_MISSING_COSIGNER ile reddeder', () => {
        const bizim = Keypair.generate()
        const ortak = Keypair.generate()
        const message = new TransactionMessage({
            payerKey: bizim.publicKey,
            recentBlockhash: BLOCKHASH,
            instructions: [SystemProgram.transfer({ fromPubkey: ortak.publicKey, toPubkey: bizim.publicKey, lamports: 1 })],
        }).compileToV0Message()
        const vtx = new VersionedTransaction(message)
        vtx.sign([ortak])
        const ortakIndex = message.staticAccountKeys.findIndex((k) => k.equals(ortak.publicKey))
        // Yuva SIFIR degil (bos-imza kontrolunu atlar), ama artik gecerli bir
        // ed25519 imzasi da degil.
        vtx.signatures[ortakIndex][0] ^= 0xff

        const parsed = parseDappTransaction(b64(vtx.serialize()))

        expect(() => signDappTransaction(parsed, bizim, { forBroadcast: true })).toThrow('SOLANA_MISSING_COSIGNER')
    })
})
