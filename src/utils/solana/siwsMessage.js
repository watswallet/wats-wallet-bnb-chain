// SIWS (Sign In With Solana) girdisi ve EIP-4361 govdesi -- saf katman.
// AG YOK, chrome YOK, @solana/* YOK.
//
// NEDEN "EZME", NEDEN "DOGRULAMA": SolanaSignInInput'un HER alani
// opsiyoneldir ve tamami saldirgan kontrolundedir. domain:'phantom.app'
// yazip evil.com'dan istek gonderen bir sayfa, kullaniciya "phantom.app'e
// giris yapiyorsunuz" diyen gercekten gecerli bir imza urettirebilirdi.
// Alani reddetmek yalnizca dikkatsiz dapp'leri kirardi; bu yuzden domain
// gercek origin'in host'uyla YENIDEN YAZILIR -- imzalanan metin her zaman
// kullanicinin adres cubugunda gordugu siteyi soyler (K9).
//
// `address` ise EZILMEZ, REDDEDILIR: baska bir hesap adina giris metni
// imzalamak, kullanicinin onayladigi seyden farkli bir seydir.
//
// CUZDAN BU IKI ALANIN DISINDA HICBIR ALAN UYDURMAZ (version, issuedAt
// dahil): dapp'in backend'i metni KENDI gonderdigi girdiden yeniden uretip
// karsilastirir, uydurulan her alan o karsilastirmayi sessizce dusurur.

import { MAX_MESSAGE_BYTES } from './walletStandardFeatures'

const KNOWN_FIELDS = [
    'domain', 'address', 'statement', 'uri', 'version', 'chainId', 'nonce',
    'issuedAt', 'expirationTime', 'notBefore', 'requestId', 'resources',
]

// domain HER ZAMAN gercek origin host'uyla EZILIR (asagida, kosulsuz), address
// HER ZAMAN kendi esitlik kapisinda ayrica dogrulanir (asagida, TAM esitlik) --
// ikisinin HAM tipi/degeri nihai govdeyi hicbir zaman ETKILEMEZ, o yuzden
// tip/uzunluk olcumu disi tutulurlar. resources kendi dizi+dizge filtresiyle
// ayri ele alinir (asagida). Geri kalan DOKUZ alan ise SERBEST METIN
// alanlaridir: sayfa BUNLARIN icine ISTEDIGINI koyar ve buildSiwsMessage
// hepsini sablon enterpolasyonuyla DOGRUDAN govdeye yazar.
const SERBEST_METIN_ALANLARI = KNOWN_FIELDS.filter(
    (alan) => alan !== 'domain' && alan !== 'address' && alan !== 'resources'
)

/**
 * Origin'in host'u -- PORT DAHIL. K5 geregi yetki kaynagi tam origin'dir;
 * portu dusurmek app.example.com:8443 ile app.example.com'a ayni domain
 * metnini imzalatirdi.
 */
function originHost(origin) {
    if (typeof origin !== 'string' || origin === '') return ''
    try {
        return new URL(origin).host
    } catch {
        return ''
    }
}

/**
 * Bilinen alanlarin HAM (birlestirilmeden ONCEKI) toplam karakter uzunlugu --
 * VE bir TIP GUVENLIGI kapisi. Ikisi TEK fonksiyonda birlesiktir cunku ayni
 * soruyu yanitlarlar: "bu alan govdeye GUVENLE (olculebilir sekilde) girebilir
 * mi?"
 *
 * NEDEN GOVDE KURULMADAN ONCE: buildSiwsMessage'in urettigi EIP-4361 govdesi
 * bu alanlarin uzerine etiket/satir-sonu EKLER, hicbirini KISALTMAZ -- yani
 * bu toplam govdenin nihai bayt sayisi icin bir ALT SINIRDIR. Bu satir asilirsa
 * kurulacak govde de KESINLIKLE MAX_MESSAGE_BYTES'i asar; erken red hicbir
 * zaman gecerli bir girdiyi YANLIS REDDETMEZ. Karakter sayisi (UTF-16 birimi)
 * kullanilir, bayt sayisi degil: cok baytli karakterler icin bayt sayisi bunun
 * ustunde kalir, yani bu olcum HER ZAMAN nihai govdenin ayni alanlardan gelen
 * bayt payindan kucuk ya da esittir -- asagidaki kontrol bu yuzden GUVENLIDIR.
 *
 * TIP GUVENLIGI (2. tur bulgu): SERBEST_METIN_ALANLARI'ndaki dokuz alan
 * buildSiwsMessage'da sablon enterpolasyonuyla (`${i.statement}` gibi)
 * DOGRUDAN govdeye girer. `typeof raw[field] === 'string'` kontrolu OLMADAN,
 * bir DIZI ya da NESNE bu toplama SESSIZCE 0 katardi -- oysa sablon
 * enterpolasyonu toString()'i TETIKLER ve bir dizi icin bu virgullu
 * BIRLESTIRMEDIR (Array.prototype.toString): Array(5_000_000).fill('a') gibi
 * bir girdi, govde KURULDUKTAN SONRA megabaytlarca bir metne donusur -- tam da
 * bu erken kapinin onlemesi gereken durum, sadece uzun bir dizge yerine yanlis
 * TIPTEKI bir deger uzerinden. NESNE varsayilan olarak "[object Object]" gibi
 * SABIT kisa bir dize uretir (DoS potansiyeli yok), ama YINE DE reddedilir:
 * kullanici sayfanin hic yazmadigi bir dizeyi imzalamis olurdu. Olcemedigimiz
 * (dizge OLMAYAN) bir deger bu yuzden GUVENLI (0 bayt) SAYILMAZ; Infinity
 * donup kapali basarisizlik (fail-closed) ile boyut asilmis SAYILIR.
 */
function rawFieldsLength(raw) {
    let total = 0
    for (const field of SERBEST_METIN_ALANLARI) {
        const deger = raw[field]
        if (deger === undefined || deger === null) continue
        if (typeof deger !== 'string') return Infinity
        total += deger.length
    }
    if (Array.isArray(raw.resources)) {
        // F3 -- HER eleman (BOS dize dahil) buildSiwsMessage'da EN AZ `- \n`
        // (3 karakter: "- " + satir-sonu) uretir; yalniz `.length` toplamak
        // Array(1_000_000).fill('') gibi COK SAYIDA bos/cok kisa dizgeyi
        // ucuz sayardi -- govde ~3 MB'a cikar, bu erken kapi onu KACIRIRDI.
        for (const kaynak of raw.resources) {
            if (typeof kaynak === 'string') total += kaynak.length + 3
        }
    }
    return total
}

/**
 * @param {object|null|undefined} input dapp'in verdigi SolanaSignInInput
 * @param {{origin: string, address: string}} context gercek origin + oturum adresi
 * @returns {{ok: true, input: object} | {ok: false, code: string}}
 */
export function validateSiwsInput(input, { origin, address } = {}) {
    const host = originHost(origin)
    // Origin'i cozemiyorsak domain'i ZORLAYAMAYIZ; zorlanamayan bir alani
    // sayfanin verdigi haliyle imzalamak yukaridaki deligi geri acar.
    if (!host) return { ok: false, code: 'SOLANA_SIGNIN_DOMAIN_MISMATCH' }
    if (typeof address !== 'string' || address === '') {
        return { ok: false, code: 'SOLANA_SIGNIN_ADDRESS_MISMATCH' }
    }

    const raw = (input && typeof input === 'object') ? input : {}

    // ERKEN VE UCUZ BOYUT + TIP KAPISI -- govde KURULMADAN once, TextEncoder
    // hic CAGRILMADAN. KOK NEDEN: signIn'e gate 2 (oturum sarti) UYGULANMAZ,
    // yani buraya baglantisi bile olmayan bir origin erisebilir; asagidaki
    // normalize + cagiran taraftaki buildSiwsMessage + TextEncoder zincirini
    // govde MAX_MESSAGE_BYTES kontrolunden GECMEDEN once calistirmak,
    // paylasilan arka plan servis calisanini (TUM zincirlerin imzalama yolu)
    // sayfa kontrolundeki sinirsiz VE/YA DA TIPI YANLIS statement/resources
    // alanlariyla mesgul edebilirdi (rawFieldsLength'in ust yorumuna bkz.).
    // Nihai 8192 baytlik kontrol (mesajYukKapisi) govde kurulduktan SONRA
    // YINE calisir -- bu yalnizca ONUNDEKI ucuz bir filtredir.
    if (rawFieldsLength(raw) > MAX_MESSAGE_BYTES) {
        return { ok: false, code: 'SOLANA_MESSAGE_TOO_LARGE' }
    }

    // TAM esitlik: base58'de buyuk/kucuk harf ANLAMLIDIR (K8). Tek bir
    // toLowerCase, baska bir anahtarin adresini gecerli sayardi.
    if (raw.address !== undefined && raw.address !== null && raw.address !== address) {
        return { ok: false, code: 'SOLANA_SIGNIN_ADDRESS_MISMATCH' }
    }

    // Tanimadigimiz alanlar DUSURULUR: girdi hem onay ekraninda render
    // ediliyor hem de imzalanan metne giriyor; gecirmedigimiz alan zarar
    // veremez.
    const normalized = {}
    for (const field of KNOWN_FIELDS) {
        if (raw[field] !== undefined) normalized[field] = raw[field]
    }
    if (Array.isArray(raw.resources)) {
        normalized.resources = raw.resources.filter((r) => typeof r === 'string')
    } else {
        delete normalized.resources
    }

    normalized.domain = host
    normalized.address = address

    return { ok: true, input: normalized }
}

/**
 * EIP-4361 govdesi.
 *
 * Duzen @solana/wallet-standard-util'in createSignInMessageText'i ile
 * BAYT-BIREBIR ayni olmak zorundadir: dapp'in backend'i imzayi tam olarak o
 * fonksiyonun urettigi metne karsi dogrular. Eksik alanlar SATIR OLARAK
 * CIKMAZ -- "Nonce: undefined" yazan bir govde hicbir yerde dogrulanamaz.
 * Bos bir `resources` dizisinin yalnizca basligi yazmasi da referans
 * uygulamanin davranisidir ve bilerek korunur.
 */
export function buildSiwsMessage(input) {
    const i = (input && typeof input === 'object') ? input : {}

    let message = `${i.domain} wants you to sign in with your Solana account:\n${i.address}`
    if (i.statement) message += `\n\n${i.statement}`

    const fields = []
    if (i.uri) fields.push(`URI: ${i.uri}`)
    if (i.version) fields.push(`Version: ${i.version}`)
    if (i.chainId) fields.push(`Chain ID: ${i.chainId}`)
    if (i.nonce) fields.push(`Nonce: ${i.nonce}`)
    if (i.issuedAt) fields.push(`Issued At: ${i.issuedAt}`)
    if (i.expirationTime) fields.push(`Expiration Time: ${i.expirationTime}`)
    if (i.notBefore) fields.push(`Not Before: ${i.notBefore}`)
    if (i.requestId) fields.push(`Request ID: ${i.requestId}`)
    if (Array.isArray(i.resources)) {
        fields.push('Resources:')
        for (const resource of i.resources) fields.push(`- ${resource}`)
    }
    if (fields.length) message += `\n\n${fields.join('\n')}`

    return message
}
