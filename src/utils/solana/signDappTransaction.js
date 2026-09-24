import './bufferGlobal.js'
import nacl from 'tweetnacl'

/**
 * Dapp islemini KISMEN imzalar -- §6.2.
 *
 * `transaction.sign(...)` BILEREK KULLANILMAZ: o cagri `signatures` dizisini
 * sifirdan kurar ve dapp'in ya da bir ortak imzacinin ZATEN attigi imzayi siler.
 * `sendSolanaTransfer` icin dogru (tek imzaci), dapp islemi icin yikici.
 *
 * @param {object} parsed parseDappTransaction ciktisi
 * @param {import('@solana/web3.js').Keypair} keypair
 * @param {{forBroadcast?: boolean}} opts forBroadcast:true -> islem BIZIM
 *   yayinlayacagimiz kadar tam olmali; false -> yayini dapp yapar, eksik
 *   imzaciyla serilestirilir.
 * @returns {string} base64 islem
 */
export function signDappTransaction(parsed, keypair, { forBroadcast = false } = {}) {
    if (!parsed || !parsed.tx) throw new Error('TX_DESERIALIZE_FAILED')

    if (parsed.version === 'legacy') {
        // K1 review bulgusu (parseDappTransaction.js:140-149): `tx.signatures`
        // dizisinin UZUNLUGU, `Transaction.from`'un tel'den (dapp kontrolunde,
        // sahte olabilen bir shortvec) urettigi bir alandir. `partialSign` ->
        // `_compile()` (web3.js) bu uzunluk mesaj basligindaki
        // numRequiredSignatures ile UYUSMAZSA butun diziyi SIFIRDAN (null)
        // kurar -- sahte KISA bir sayac, uzerinde GERCEK bir ortak imza olan
        // bir yuvayi da bu sirada siler. Imzalamadan ONCE mevcut imzalari
        // (kendi anahtarimiz HARIC) yakalar, _compile() onlari sildiyse
        // `addSignature` ile geri takariz -- mesaj (ve dolayisiyla imzanin
        // gecerliligi) partialSign'dan ETKILENMEDIGI icin bu guvenlidir.
        const oncekiImzalar = parsed.tx.signatures
            .filter((s) => s.signature && !s.publicKey.equals(keypair.publicKey))
            .map((s) => ({ publicKey: s.publicKey, signature: s.signature }))

        parsed.tx.partialSign(keypair)

        for (const { publicKey, signature } of oncekiImzalar) {
            const guncelYuva = parsed.tx.signatures.find((s) => s.publicKey.equals(publicKey))
            if (guncelYuva && !guncelYuva.signature) {
                parsed.tx.addSignature(publicKey, signature)
            }
        }

        if (!forBroadcast) {
            return Buffer.from(parsed.tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64')
        }

        // verifySignatures ACIK: islemin GERCEKTEN yayinlanabilir oldugunu
        // yayindan once, yerel olarak ve bedava dogrulayan tek katman budur.
        // web3.js burada BIRDEN FAZLA farkli sebeple firlatabilir (eksik/GECERSIZ
        // imza, "recentBlockhash required", "fee payer required", "Transaction
        // too large", "unknown signer") ve hepsi TEK bir koda dusuyor: Task 28
        // kaynak taramasi TAM OLARAK uc ad bekliyor (TX_DESERIALIZE_FAILED,
        // UNSUPPORTED_TX_VERSION, SOLANA_MISSING_COSIGNER) ve sendErrors/i18n
        // satirlari bu uc adin kilidine bagli -- dorduncu bir kod o kilidi
        // kirar. Baskin sebep yine de eksik/gecersiz ortak imzadir; kullaniciya
        // gorunen sonuc (reddedildi, hicbir sey imzalanmadi) hangi alt sebep
        // olursa olsun ayni oldugu icin bu es-durum kabul edilebilir. Orijinal
        // hata `cause` ile saklanir, sessizce ATILMAZ.
        try {
            return Buffer.from(parsed.tx.serialize()).toString('base64')
        } catch (e) {
            throw new Error('SOLANA_MISSING_COSIGNER', { cause: e })
        }
    }

    parsed.tx.sign([keypair])

    // VersionedTransaction.serialize() OPSIYON ALMAZ ve imza DOGRULAMAZ; legacy
    // yolundaki `verifySignatures` kapisinin v0 karsiligi bu ACIK kontroldur.
    // Sadece "yuva bos mu" (sifir bayt) bakmak YETMEZ: legacy yol gercek
    // ed25519 dogrulamasi yapiyor, bu yuzden DOLU ama GECERSIZ (tahrif edilmis)
    // bir ortak imzasi legacy'de yakalanirken v0'da sessizce yayina giderdi --
    // iki yol simetrik olmali. `tweetnacl` (Task 17 signMessage.js'teki ayni
    // ham ed25519 dogrulama kutuphanesi) ile HER yuva, imzalanan mesaj
    // baytlarina (`VersionedTransaction.sign` -> `message.serialize()`, bkz.
    // web3.js kaynagi) karsi gercekten dogrulanir.
    if (forBroadcast) {
        const mesajBaytlari = parsed.tx.message.serialize()
        const staticAnahtarlar = parsed.tx.message.staticAccountKeys
        const eksikVeyaGecersiz = parsed.tx.signatures.some((imza, i) => {
            if (!imza || imza.every((b) => b === 0)) return true
            return !nacl.sign.detached.verify(mesajBaytlari, imza, staticAnahtarlar[i].toBytes())
        })
        if (eksikVeyaGecersiz) throw new Error('SOLANA_MISSING_COSIGNER')
    }

    return Buffer.from(parsed.tx.serialize()).toString('base64')
}
