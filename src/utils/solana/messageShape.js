// Imzasiz Solana islem MESAJI tarayicisi (E1) -- SAF katman.
// import YOK, Buffer YOK, chrome YOK. (Test vektorleri web3.js ile uretilir;
// bu dosya hicbir kutuphaneye bagli degildir.)
//
// NEDEN VAR: `signMessage` ham bayt imzalar. Bir dapp, kullanicinin gercek bir
// ISLEM MESAJINI "metin" diye imzalatabilir; ayni ed25519 imzasi zincirde
// gecerli bir islem imzasidir (kor transfer/yetki devri). Bu tarayici bir bayt
// dizisinin bir Solana islem mesajinin on eki gibi AYRISTIRILIP
// AYRISTIRILAMAYACAGINI soyler. Yalnizca bicim bakar; mesajin ne yaptigini
// yorumlamaz.
//
// BILEREK GEVSEK KOSULLAR: her ek kosul, saldirganin kacmasi icin bir yoldur.
//   - `programIdIndex != 0` kosulu EKLENMEZ (ilk hesap payer'dir; gercek
//     ayristirici onu program olarak reddeder, ama biz reddetmeyi ona birakmayiz).
//   - nReq <= 19 ve talimat sayisi >= 1 YALNIZ mesru metin/ikili yuklerin
//     buyuk cogunlugunu disarida birakmak icindir (rastgele bir yukun bu iki
//     kosulu birden gecmesi cok dusuk olasilik); bunlarin disinda kosul eklenmez.
//
// BILINEN ACIK (kasitli, izleme maddesi: Gorev 31 belgesi): ilk bayti 0x82 ve
// uzeri olan gelecek islem formatlari taranmaz (fail-open). Solana yeni bir
// surum onekini etkinlestirince bu tarayici guncellenir. 0x81 icin yalniz
// `looksLikeFutureVersionedMessage` vardir (varsayim: baslik yapisi v0 ile ayni
// degildir, bu yuzden uzunluk ipucuyla yetinilir).

// YUMUSAK BASLIK KURALI (P-G-2). Talimat/ALT bolumu saldirgan kontrolundedir:
// tam ayristirma Agave ayristiricisindan en kucuk sapmada `null` donerse kapi
// acik kalir. Baslik makulse (bkz. `hasPlausibleHeader`) mesaj yine de supheli
// sayilir. Kapali/acik karari yanlis-pozitif OLCUMUNE baglidir (task-1-report):
// UTF-8 metin ve ikili yuklerin IKISINDE de oran %0,5'in altinda oldugu icin ACIK.
// Yetki: patron hukmu Q9 (progress.md 'Patron kararlari': olcume bagli AC, iki oran
// < %0,5 ise true; olculen ~%0,02-0,03). Oran sinirin ustune cikarsa false'a don.
// Sabit fonksiyona/store'a cevrilmez.
export const SOFT_HEADER_RULE = true

const MAX_REQUIRED_SIGNATURES = 19
const V0_PREFIX = 0x80

// Kanonik shortvec (u16, 1..3 bayt). Basarisizsa null; gereksiz devam baytlari
// (ornegin 0x80 0x00) kanonik DEGILDIR.
function readShortVec(bytes, pos) {
    if (pos >= bytes.length) return null
    const b0 = bytes[pos]
    if (b0 < 0x80) return { value: b0, size: 1 }
    if (pos + 1 >= bytes.length) return null
    const b1 = bytes[pos + 1]
    if (b1 < 0x80) {
        if (b1 === 0) return null
        return { value: (b0 & 0x7f) | (b1 << 7), size: 2 }
    }
    if (pos + 2 >= bytes.length) return null
    const b2 = bytes[pos + 2]
    if (b2 === 0 || b2 > 3) return null
    return { value: (b0 & 0x7f) | ((b1 & 0x7f) << 7) | (b2 << 14), size: 3 }
}

// Mesaj govdesini (baslik dahil) `offset`ten tarar. v0 ise talimatlardan sonra
// adres arama tablosu (ALT) bolumunu da okur. Tuketilen toplam bayt sayisini
// (offset dahil mutlak konum) ya da null doner.
function scan(bytes, offset, v0) {
    const len = bytes.length
    if (offset + 3 > len) return null
    const nReq = bytes[offset]
    const nRoS = bytes[offset + 1]
    const nRoU = bytes[offset + 2]
    if (nReq < 1 || nReq > MAX_REQUIRED_SIGNATURES) return null
    if (nRoS >= nReq) return null

    const hesapSv = readShortVec(bytes, offset + 3)
    if (hesapSv === null) return null
    const statik = hesapSv.value
    if (statik > 255) return null
    if (statik < nReq + nRoU) return null

    let pos = offset + 3 + hesapSv.size + 32 * statik + 32 // hesaplar + blockhash
    if (pos > len) return null

    const talimatSv = readShortVec(bytes, pos)
    if (talimatSv === null) return null
    if (talimatSv.value < 1) return null
    pos += talimatSv.size

    // v0'da hesap indeksinin gercek siniri (statik + ALT) talimatlardan SONRA
    // okunan ALT bolumunden bilinir; o ana kadar yalniz u8 (<=255) denetlenir ve
    // en buyuk indeks kaydedilir.
    let enBuyukIndeks = -1
    for (let i = 0; i < talimatSv.value; i++) {
        if (pos >= len) return null
        const programIdIndex = bytes[pos]
        pos += 1
        // Program kimligi ALT'tan GELEMEZ: statik hesaplardan biri olmali.
        if (programIdIndex >= statik) return null

        const hesapIdxSv = readShortVec(bytes, pos)
        if (hesapIdxSv === null) return null
        pos += hesapIdxSv.size
        if (pos + hesapIdxSv.value > len) return null
        for (let j = 0; j < hesapIdxSv.value; j++) {
            const idx = bytes[pos + j]
            if (!v0 && idx >= statik) return null
            if (idx > enBuyukIndeks) enBuyukIndeks = idx
        }
        pos += hesapIdxSv.value

        const veriSv = readShortVec(bytes, pos)
        if (veriSv === null) return null
        pos += veriSv.size
        if (pos + veriSv.value > len) return null
        pos += veriSv.value
    }

    if (!v0) return pos

    const lookupSv = readShortVec(bytes, pos)
    if (lookupSv === null) return null
    pos += lookupSv.size
    let altToplam = 0
    for (let i = 0; i < lookupSv.value; i++) {
        pos += 32 // tablo anahtari
        if (pos > len) return null
        const yazilabilirSv = readShortVec(bytes, pos)
        if (yazilabilirSv === null) return null
        pos += yazilabilirSv.size + yazilabilirSv.value
        if (pos > len) return null
        const salt = readShortVec(bytes, pos)
        if (salt === null) return null
        pos += salt.size + salt.value
        if (pos > len) return null
        altToplam += yazilabilirSv.value + salt.value
    }
    if (enBuyukIndeks >= statik + altToplam) return null
    return pos
}

/**
 * @param {Uint8Array} bytes
 * @returns {'legacy-exact'|'legacy-trailing'|'v0-exact'|'v0-trailing'|null}
 */
export function classifyTxMessageShape(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) return null
    const ilk = bytes[0]
    let tuketilen
    let onek
    if (ilk >= 1 && ilk <= 0x7f) {
        onek = 'legacy'
        tuketilen = scan(bytes, 0, false)
    } else if (ilk === V0_PREFIX) {
        onek = 'v0'
        tuketilen = scan(bytes, 1, true)
    } else {
        return null
    }
    if (tuketilen === null) return null
    return `${onek}-${tuketilen === bytes.length ? 'exact' : 'trailing'}`
}

// Tam ayristirma olmadan yalniz BASLIK makul mu: ilk bayt 1..19 (legacy) ya da
// 0x80 (v0), nRoS < nReq, hesap sayisi >= nReq+nRoU ve uzunluk
// >= baslik + 32*hesap + 32 (blockhash).
function hasPlausibleHeader(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) return false
    const ilk = bytes[0]
    let offset
    if (ilk >= 1 && ilk <= MAX_REQUIRED_SIGNATURES) offset = 0
    else if (ilk === V0_PREFIX) offset = 1
    else return false
    if (offset + 3 > bytes.length) return false
    const nReq = bytes[offset]
    const nRoS = bytes[offset + 1]
    const nRoU = bytes[offset + 2]
    if (nReq < 1 || nReq > MAX_REQUIRED_SIGNATURES) return false
    if (nRoS >= nReq) return false
    const sv = readShortVec(bytes, offset + 3)
    if (sv === null || sv.value > 255) return false
    if (sv.value < nReq + nRoU) return false
    return bytes.length >= offset + 3 + sv.size + 32 * sv.value + 32
}

/**
 * TEST/OLCUM ICIN: yumusak baslik kurali ACIKCA verilir. Uretim kodu bunu
 * KULLANMAZ -- karar tek yerden (SOFT_HEADER_RULE) gelir (final SU-4).
 *
 * @param {Uint8Array} bytes
 * @param {boolean} softHeaderRule
 * @returns {boolean}
 */
export function looksLikeTransactionMessageWith(bytes, softHeaderRule) {
    if (classifyTxMessageShape(bytes) !== null) return true
    return softHeaderRule === true && hasPlausibleHeader(bytes)
}

/**
 * Bayt dizisi bir islem mesajina benziyor mu (tam sekil, ya da yumusak baslik
 * kurali ACIKSA makul baslik).
 *
 * TEK ARGUMANLIDIR (final SU-4): onceden ikinci arguman kurali cagri noktasindan
 * degistirebiliyordu ve dizi yardimcilari (`some`/`filter`/`map`) islevi
 * (oge, indeks, dizi) ile cagirdigi icin indeks `softHeaderRule` olup kurali SESSIZCE
 * kapatiyordu. Fazla argumanlar yok sayilir; kural her zaman SOFT_HEADER_RULE'dur.
 *
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function looksLikeTransactionMessage(bytes) {
    return looksLikeTransactionMessageWith(bytes, SOFT_HEADER_RULE)
}

/**
 * Gelecekteki versiyonlu mesaj (0x81 onekli) ipucu: yalniz ilk bayt ve uzunluk.
 *
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function looksLikeFutureVersionedMessage(bytes) {
    return bytes instanceof Uint8Array && bytes[0] === 0x81 && bytes.length >= 70
}
