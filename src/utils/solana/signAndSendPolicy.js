// signAndSendTransaction'a OZGU saf politika katmani -- AG YOK, CHROME YOK.
// signTransaction yolu bu dosyayi KULLANMAZ: orada yayini dapp yapar, eksik
// ortak imzaci onun sorunudur (§6.2 tablosu).

/**
 * Islemde BIZIM DISIMIZDA imzasiz kalan zorunlu imzacilar (§4.3.1 kapi 8).
 *
 * `missingCosigners` BIZI DE icerir -- kendi imzamizi bu asamada henuz atmadik.
 * Kendimizi elemezsek her mesru istek SOLANA_MISSING_COSIGNER ile reddedilir.
 *
 * Karsilastirma TAM (K8): base58'de buyuk/kucuk harf ANLAMLIDIR ve
 * `toLowerCase()` iki farkli adresi ayni sayardi -- bu depodaki her EVM
 * aliskanligi adresi kuculttugu icin buraya ACIK bir not dusuldu.
 */
export function foreignMissingCosigners(parsed, ourAddress) {
    const eksik = Array.isArray(parsed?.missingCosigners) ? parsed.missingCosigners : []
    const biz = typeof ourAddress === 'string' && ourAddress ? ourAddress : null
    return eksik.filter((a) => typeof a === 'string' && a !== '' && a !== biz)
}

// Yayin denemesi ust siniri: send.js'in KENDI transferinde kullandigi degerle
// AYNI (3). Dapp'in istedigi deger bunu ASAMAZ -- yuksek bir maxRetries,
// proxy'nin dakikalik kotasini (120 istek, §7.7) tek istekle tuketebilir.
export const MAX_BROADCAST_RETRIES = 3

/**
 * Dapp'in `options` nesnesini yayina GIRMEDEN once temizler (§6.4).
 *
 * Cikti KAPALI bir kumedir: gelen nesne yayilmaz (`...options` YOK), yalnizca
 * ACIKCA izin verilen dort alan uretilir. Yayma yapilsaydi bugun bilmedigimiz
 * bir RPC opsiyonu (yarin eklenecek olan) sessizce dugume gecerdi.
 *
 * Alan alan gerekce:
 *   skipPreflight       -> HER ZAMAN false. Preflight yetersiz bakiye/yanlis
 *                          hesap gibi sessiz basarisizliklari YAYINDAN ONCE
 *                          yakalar; atlanirsa islem zincire gider, duser ve
 *                          ucreti kullanici oder. Dusman bir dapp'ten gelen
 *                          `true` bu yuzden guvenlik meselesidir.
 *   preflightCommitment -> SABIT 'confirmed'. 'processed' ile preflight henuz
 *                          kesinlesmemis bir duruma bakar ve yanlis gecer.
 *   maxRetries          -> Sayisal ve >= 0 ise [0, MAX_BROADCAST_RETRIES]
 *                          araligina kirpilir (ust sinirin UZERI asagi
 *                          yuvarlanir; negatif veya sayisal olmayan deger 0'a
 *                          KIRPILMEZ, dogrudan VARSAYILANA -- MAX_BROADCAST_RETRIES
 *                          -- duser). 0 acikca verilirse KORUNUR: "hic
 *                          tekrarlama" mesru bir dapp tercihidir.
 *   minContextSlot      -> YOK SAYILIR (cikti nesnesine hic girmez).
 */
export function sanitizeSendOptions(options) {
    const src = options && typeof options === 'object' && !Array.isArray(options) ? options : {}

    let maxRetries = MAX_BROADCAST_RETRIES
    // TEK okuma: src.maxRetries bir accessor (getter) olsaydi typeof/isFinite/
    // >=0/Math.trunc gibi tekrar tekrar okumak her seferinde FARKLI bir deger
    // dondurebilirdi (TOCTOU). raw'a bir kez alip hepsini onun uzerinden
    // degerlendirmek bu sinifi bastan kapatir.
    const raw = src.maxRetries
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
        maxRetries = Math.min(Math.trunc(raw), MAX_BROADCAST_RETRIES)
    }

    return { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries }
}

/**
 * 64 baytlik GERCEK bir imza mi? web3.js imzasiz yuvalari SIFIRLA doldurur.
 *
 * `ArrayBuffer.isView` kapisi ONCE gelir: yalnizca `.length === 64` bakan bir
 * kontrol, `{ length: 64 }` gibi bir nesnede veya 64 karakterlik bir dizgede
 * `for...of` ile PATLAR -- bu fonksiyonun sozlesmesi HICBIR ZAMAN firlatmamak.
 */
function gercekImza(bytes) {
    if (!ArrayBuffer.isView(bytes) || bytes.length !== 64) return false
    for (const b of bytes) if (b !== 0) return true
    return false
}

/**
 * Imzalamadan SONRA bizim 64 baytlik imzamiz (§6.4: imza YAYINDAN ONCE bilinir).
 *
 * signDappTransaction imzayi `parsed.tx` uzerinde YERINDE uretir (partialSign /
 * sign), bu yuzden deger serilestirilmis base64'u YENIDEN COZMEDEN buradan
 * okunabilir -- ve bu dosya @solana/* import etmek ZORUNDA KALMAZ.
 *
 * legacy'de eslesme ANAHTARLA yapilir, INDEKSLE degil: `signatures` dizisi
 * mesajin imzaci sirasini izler ama bu bir uygulama detayidir; yanlis yuvadan
 * okunan bir imza, dapp'e BASKA birinin imzasini islem kimligi olarak
 * dondururdu.
 *
 * v0'da yuvalar ham bayt dizileridir, kimlik tasimazlar -- eslesme bu yuzden
 * `parsed.requiredSigners` DEGIL, web3.js'in KENDI `tx.message.staticAccountKeys`
 * dizisi uzerinden yapilir: ikisi ayni index uzayini paylasir (VersionedTransaction
 * kurucusu `signatures.length === numRequiredSignatures` dogrular, `sign()` ve
 * `addSignature` `staticAccountKeys`i AYNI indeksle okur -- @solana/web3.js
 * index.cjs.js). `requiredSigners` ise parseDappTransaction'in TURETTIGI AYRI
 * bir dizidir; ona guvenmek bu fonksiyonu o modulun ic detaylarina (siralama,
 * filtreleme) baglardi -- versionedSigners yarin degisirse bu fonksiyon BASKA
 * bir imzacinin baytlarini sessizce dondururdu. staticAccountKeys'e dogrudan
 * bakmak bu fonksiyonu KENDI ayaklarinda durdurur.
 */
export function ownSignatureBytes(parsed, address) {
    const signatures = parsed?.tx?.signatures
    if (!Array.isArray(signatures) || typeof address !== 'string' || !address) return null

    if (parsed.version === 'legacy') {
        const giris = signatures.find((s) => {
            try { return s?.publicKey?.toBase58?.() === address } catch (e) { return false }
        })
        return gercekImza(giris?.signature) ? giris.signature : null
    }

    const staticAccountKeys = parsed?.tx?.message?.staticAccountKeys
    let i = -1
    if (Array.isArray(staticAccountKeys)) {
        for (let idx = 0; idx < signatures.length; idx += 1) {
            let eslesti = false
            try { eslesti = staticAccountKeys[idx]?.toBase58?.() === address } catch (e) { eslesti = false }
            if (eslesti) { i = idx; break }
        }
    }
    if (i < 0) return null
    return gercekImza(signatures[i]) ? signatures[i] : null
}
