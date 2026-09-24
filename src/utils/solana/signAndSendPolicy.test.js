// signAndSendTransaction'a OZGU saf politika katmani -- AG YOK, CHROME YOK.
//
// KOK NEDEN (§6.2/§4.3.1 kapi 8): `signAndSendTransaction`'da islemi BIZ
// yayinlariz ve serilestirme `verifySignatures` ACIK yapilir. Eksik bir ortak
// imzaci onay ANINDA yakalanmazsa kullanici onaylar, sonra serilestirme patlar
// -- yani kullaniciya imzalayamayacagi bir sey onaylatilmis olur.
//
// missingCosigners BIZI DE icerir (henuz imzalamadik). Kapi yalnizca BIZIM
// DISIMIZDAKI imzasiz imzacilari saymalidir; aksi halde her mesru istek
// SOLANA_MISSING_COSIGNER ile reddedilir ve ozellik HIC calismaz.
import './bufferGlobal.js'
import { describe, it, expect } from 'vitest'
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { foreignMissingCosigners, sanitizeSendOptions, MAX_BROADCAST_RETRIES, ownSignatureBytes } from './signAndSendPolicy'

const BIZ = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const ORTAK = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'

describe('foreignMissingCosigners', () => {
    it('yalnizca BIZ imzasizsak bos dizi doner (mesru tek imzali islem)', () => {
        expect(foreignMissingCosigners({ missingCosigners: [BIZ] }, BIZ)).toEqual([])
    })

    it('bizim disimizdaki imzasiz imzaci raporlanir', () => {
        expect(foreignMissingCosigners({ missingCosigners: [BIZ, ORTAK] }, BIZ)).toEqual([ORTAK])
    })

    it('hicbir imzaci eksik degilse bos dizi', () => {
        expect(foreignMissingCosigners({ missingCosigners: [] }, BIZ)).toEqual([])
    })

    // K8: base58 BUYUK/KUCUK HARF DUYARLIDIR. Harf kasasi degistirilmis bir
    // adres BASKA bir adrestir; "bizmisiz gibi" elenirse gercekten eksik olan
    // bir ortak imzaci sessizce gorunmez olur ve kullanici imzalanamayacak bir
    // islemi onaylar.
    it('adres TAM eslesir -- harf kasasi degisik adres BIZ SAYILMAZ', () => {
        const kasaFarkli = BIZ.toUpperCase()
        expect(foreignMissingCosigners({ missingCosigners: [kasaFarkli] }, BIZ)).toEqual([kasaFarkli])
    })

    it('bozuk/eksik girdide patlamaz, bos dizi doner', () => {
        expect(foreignMissingCosigners(null, BIZ)).toEqual([])
        expect(foreignMissingCosigners({}, BIZ)).toEqual([])
        expect(foreignMissingCosigners({ missingCosigners: 'x' }, BIZ)).toEqual([])
    })

    // Adresimiz COZULEMEDIYSE hicbir sey elenmez: "bilmiyorum" ile "bizimki"
    // ayni sey degildir -- suphede kalan istek KAPIDA durur, gecmez.
    it('adresimiz yoksa hicbir imzaci elenmez', () => {
        expect(foreignMissingCosigners({ missingCosigners: [BIZ, ORTAK] }, undefined)).toEqual([BIZ, ORTAK])
    })
})

// Dapp'in verdigi `options` GUVENILMEZ bir girdidir (§6.4). Ozellikle
// `skipPreflight: true` guvenlik acisindan anlamlidir: preflight, yetersiz
// bakiye / yanlis hesap gibi sessiz basarisizliklari YAYINDAN ONCE yakalar.
// Atlanirsa islem zincire gider, dususe gecer ve ucreti KULLANICI oder.
describe('sanitizeSendOptions', () => {
    it('skipPreflight dapp true dese bile HER ZAMAN false', () => {
        expect(sanitizeSendOptions({ skipPreflight: true }).skipPreflight).toBe(false)
    })

    it('preflightCommitment SABIT confirmed (dapp ne derse desin)', () => {
        expect(sanitizeSendOptions({ preflightCommitment: 'processed' }).preflightCommitment).toBe('confirmed')
    })

    it('encoding base64 olarak SABITLENIR', () => {
        expect(sanitizeSendOptions({ encoding: 'base58' }).encoding).toBe('base64')
    })

    // minContextSlot YOK SAYILIR: dugum tarafinda istegi bir slota kadar
    // BEKLETIR; dusman bir dapp bunu proxy baglantisini tutmak icin kullanabilir.
    it('minContextSlot cikti nesnesine HIC girmez', () => {
        const o = sanitizeSendOptions({ minContextSlot: 999999 })
        expect('minContextSlot' in o).toBe(false)
    })

    it('bilinmeyen alanlar tasinmaz -- cikti KAPALI bir kumedir', () => {
        const o = sanitizeSendOptions({ evil: 1, maxRetries: 2 })
        expect(Object.keys(o).sort()).toEqual(['encoding', 'maxRetries', 'preflightCommitment', 'skipPreflight'])
    })

    it.each([
        ['ust sinirin ustu', 1000, MAX_BROADCAST_RETRIES],
        ['negatif', -5, MAX_BROADCAST_RETRIES],
        ['tam sayi degil', 2.7, 2],
        ['sifir KORUNUR', 0, 0],
        ['araligin icinde', 2, 2],
    ])('maxRetries kirpilir (%s)', (_ad, girdi, beklenen) => {
        expect(sanitizeSendOptions({ maxRetries: girdi }).maxRetries).toBe(beklenen)
    })

    it.each([['yok', undefined], ['null', null], ['dizi', []], ['sayi', 7]])(
        'options %s ise varsayilanlara duser',
        (_ad, girdi) => {
            expect(sanitizeSendOptions(girdi)).toEqual({
                encoding: 'base64', skipPreflight: false,
                preflightCommitment: 'confirmed', maxRetries: MAX_BROADCAST_RETRIES,
            })
        })
})

// §6.4: imza YAYINDAN ONCE yerel olarak bilinmelidir. Yanit KAYBOLURSA
// (dugum islemi KABUL ETTIKTEN sonra) elimizde kalan TEK iz budur; RPC'nin
// donus degerine guvenmek, belirsiz bir dususte dapp'e hicbir sey
// donduremememiz demektir.
describe('ownSignatureBytes', () => {
    const BIZ = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
    const ORTAK = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
    const dolu = (n) => new Uint8Array(64).fill(n)
    const bos = () => new Uint8Array(64)
    const anahtar = (adres) => ({ toBase58: () => adres })

    it('legacy: imza ANAHTARLA eslesir, siraya guvenilmez', () => {
        const parsed = {
            version: 'legacy',
            requiredSigners: [ORTAK, BIZ],
            tx: { signatures: [
                { publicKey: anahtar(ORTAK), signature: dolu(1) },
                { publicKey: anahtar(BIZ), signature: dolu(2) },
            ] },
        }
        expect(ownSignatureBytes(parsed, BIZ)).toEqual(dolu(2))
    })

    it('v0: imza staticAccountKeys SIRASINDAKI yuvadan okunur', () => {
        const parsed = {
            version: 0,
            tx: { signatures: [dolu(1), dolu(2)], message: { staticAccountKeys: [anahtar(ORTAK), anahtar(BIZ)] } },
        }
        expect(ownSignatureBytes(parsed, BIZ)).toEqual(dolu(2))
    })

    // web3.js imzalanmamis yuvalari 64 SIFIR baytla doldurur. Sifir dolu bir
    // yuvayi "imza" saymak, hic imzalanmamis bir islem icin dapp'e uydurma bir
    // imza (base58'i sabit bir dizge) dondurmek olurdu.
    it('imzalanmamis (sifir dolu) yuva null doner', () => {
        const v0 = { version: 0, tx: { signatures: [bos()], message: { staticAccountKeys: [anahtar(BIZ)] } } }
        const legacy = { version: 'legacy', requiredSigners: [BIZ], tx: { signatures: [{ publicKey: anahtar(BIZ), signature: bos() }] } }
        expect(ownSignatureBytes(v0, BIZ)).toBeNull()
        expect(ownSignatureBytes(legacy, BIZ)).toBeNull()
    })

    // Review bulgusu (Onur derece): sadece `.length === 64` bakan bir kapi,
    // dizi-BENZER ama yinelenemeyen bir degerde (`{ length: 64 }`) `for...of`
    // ile PATLAR. Bu fonksiyonun sozlesmesi hicbir zaman firlatmamak -- bu
    // yuzden ArrayBuffer.isView ONCE gelmeli.
    it('imza sekli uyumsuz (dizi-benzer ama yinelenemez) deger PATLAMADAN null uretir', () => {
        const uydurma = { length: 64 }
        const parsed = { version: 'legacy', tx: { signatures: [{ publicKey: anahtar(BIZ), signature: uydurma }] } }
        expect(() => ownSignatureBytes(parsed, BIZ)).not.toThrow()
        expect(ownSignatureBytes(parsed, BIZ)).toBeNull()
    })

    it('imzamiz yoksa null doner, patlamaz', () => {
        expect(ownSignatureBytes({ version: 'legacy', tx: { signatures: [] } }, BIZ)).toBeNull()
        expect(ownSignatureBytes({ version: 0, tx: { signatures: [dolu(1)], message: { staticAccountKeys: [anahtar(ORTAK)] } } }, BIZ)).toBeNull()
        expect(ownSignatureBytes(null, BIZ)).toBeNull()
    })

    it('legacy: imzasi olmayan (null) giris atlanir', () => {
        const parsed = { version: 'legacy', requiredSigners: [BIZ], tx: { signatures: [{ publicKey: anahtar(BIZ), signature: null }] } }
        expect(ownSignatureBytes(parsed, BIZ)).toBeNull()
    })

    // K8: base58 BUYUK/KUCUK HARF DUYARLIDIR. Harf kasasi degistirilmis bir
    // adres BASKA bir adrestir -- "bizmisiz gibi" eslesirse baskasinin imzasi
    // bize ait sayilir.
    it('adres yalnizca harf kasasinda farkliysa null doner (legacy)', () => {
        const kasaFarkli = BIZ.toUpperCase()
        const parsed = {
            version: 'legacy',
            requiredSigners: [BIZ],
            tx: { signatures: [{ publicKey: anahtar(BIZ), signature: dolu(3) }] },
        }
        expect(ownSignatureBytes(parsed, kasaFarkli)).toBeNull()
    })

    it('adres yalnizca harf kasasinda farkliysa null doner (v0)', () => {
        const kasaFarkli = BIZ.toUpperCase()
        const parsed = { version: 0, tx: { signatures: [dolu(3)], message: { staticAccountKeys: [anahtar(BIZ)] } } }
        expect(ownSignatureBytes(parsed, kasaFarkli)).toBeNull()
    })

    // Review bulgusu (Onemli): eslesme requiredSigners'a DEGIL, web3.js'in
    // KENDI staticAccountKeys dizisine dayanmali. requiredSigners burada
    // KASITLI TERS sirada -- parseDappTransaction'in TURETTIGI bu ayri dizi
    // yarin (versionedSigners degisirse) staticAccountKeys ile hizasini
    // kaybedebilir; ownSignatureBytes ona guvenseydi BASKA imzacinin
    // baytlarini dapp'e islem kimligi diye dondururdu.
    it('v0: requiredSigners staticAccountKeys ile HIZASIZ olsa bile dogru yuvadan okunur', () => {
        const parsed = {
            version: 0,
            requiredSigners: [BIZ, ORTAK], // staticAccountKeys ile TERS -- kasitli hizasizlik
            tx: { signatures: [dolu(1), dolu(2)], message: { staticAccountKeys: [anahtar(ORTAK), anahtar(BIZ)] } },
        }
        expect(ownSignatureBytes(parsed, BIZ)).toEqual(dolu(2))
    })
})

// Yukaridaki tum testler UYDURMA nesnelerle calisir; bu blok TEK bir GERCEK
// VersionedTransaction ile kilitler -- staticAccountKeys/signatures hizasinin
// varsayimi degil, web3.js'in KENDI ureteci oldugunu kanitlar. Ucret odeyen
// HER ZAMAN index 0'dir (Solana mesaj bicimi); BIZ burada bilerek ikinci
// zorunlu imzaciyiz ki index-0 varsayan bir uygulama bu testte YAKALANSIN.
describe('ownSignatureBytes -- GERCEK VersionedTransaction ile kilit', () => {
    const BLOCKHASH = '11111111111111111111111111111111'

    it('v0: bizim imzamiz index 0 DEGIL -- staticAccountKeys uzerinden dogru yuvadan okunur', () => {
        const a = Keypair.generate() // ucret odeyen, HER ZAMAN index 0
        const b = Keypair.generate() // ikinci zorunlu imzaci -- BIZ buyuz
        const message = new TransactionMessage({
            payerKey: a.publicKey,
            recentBlockhash: BLOCKHASH,
            instructions: [SystemProgram.transfer({ fromPubkey: b.publicKey, toPubkey: a.publicKey, lamports: 1 })],
        }).compileToV0Message()
        const tx = new VersionedTransaction(message)
        tx.sign([a, b])

        const knownIndex = message.staticAccountKeys.findIndex((k) => k.equals(b.publicKey))
        expect(knownIndex).not.toBe(0) // fixture varsayimini dogrula: BIZ index 0'da DEGIL

        const parsed = { version: 0, tx, requiredSigners: [a.publicKey.toBase58(), b.publicKey.toBase58()] }
        const sonuc = ownSignatureBytes(parsed, b.publicKey.toBase58())
        expect(sonuc).toEqual(tx.signatures[knownIndex])
        expect(sonuc).not.toEqual(tx.signatures[0])
    })
})
