// GET /paymaster/ton/routers - opak yuk tasiyan eylemlerin gidebilecegi hedefler.
//
// NE ISE YARAR: sunucu `payloadBoc` tasiyan bir eylemin hedefini bu listeye karsi
// denetler ve listede degilse `ton-payload-not-allowed` ile REDDEDER. O red
// /quote'un basinda, ucret hesaplanmadan duser - yani "ATS'i gosterip sonra
// reddetme" riski YOK. Bu modulun isi daha erken bir soru: gazsiz secenegi
// KULLANICIYA HIC GOSTERMEMEK icin listeye onceden bakmak. Odenemeyecek bir ucreti
// ekrana yazmak, kullanicinin donebilecegi hicbir secenegi olmayan bir cikmazdir.
//
// AYRICA BIR YETENEK YOKLAMASIDIR: bu uc `kind:"raw"` ile AYNI surumde geldi.
// 404 donmesi sunucunun ham yuku HIC tanimadigi anlamina gelir; o durumda dapp
// yolunda relay TEKLIF EDILMEZ. Bu tek kontrol, istemciyi eski ve yeni sunucuda
// dogru davranmaya zorlar.
import { tonFeePaymasterBase } from './tonFeeConfig'

// Yanit YAPILANDIRMANIN KENDISIDIR - zincire cikilmiyor ve uc hiz sinirinin
// arkasinda. Sunucu `max-age=300` gonderiyor; ayni pencereyi burada da tutuyoruz
// ki her gonderimde istek atilmasin.
export const TON_ROUTERS_TTL_MS = 300_000

let onbellek = null // { at, routers: Set<string>, limits }

/**
 * Adresleri KANONIK RAW bicime indirger.
 *
 * `toLowerCase()` KULLANILMAZ: TON'un friendly yaziminda base64 karakterlerinin
 * BUYUK/kucuk hali ANLAMLIDIR ve kucultmek adresi ayristirilamaz yapar. Iki taraf
 * da `Address.parse(x).toRawString()` ile indirgenir; cozulemeyen adres `null`
 * doner ve `null` hicbir sey ile eslesmez (kapali taraf).
 */
export function rawAdres(Address, adres) {
    try { return Address.parse(String(adres).trim()).toRawString() } catch { return null }
}

/**
 * Listeyi getirir. BASARISIZLIK `null` DONER, FIRLATMAZ: cagiran taraf icin
 * "liste okunamadi" ile "liste bos" AYNI sonuca varmali (yuk tasiyan gonderim
 * icin relay teklif edilmez), ama biri arizayi ekrana tasiyacak bir hata degil.
 *
 * BOS LISTE "her sey serbest" DEGIL, "hicbir sey" demektir - sunucu da boyle
 * davraniyor. Kurulum hatasini sessiz bir aciga cevirmemek icin.
 */
export async function tonRouterListesi({ force = false } = {}) {
    if (!force && onbellek && (Date.now() - onbellek.at) < TON_ROUTERS_TTL_MS) return onbellek

    let base
    try { base = tonFeePaymasterBase() } catch { return null }

    try {
        const res = await fetch(`${base}/paymaster/ton/routers`, { method: 'GET' })
        // 404 = ESKI SUNUCU. Yeni bir hata sinifi acmiyoruz: yetenek yok demek,
        // relay teklif edilmemesi demek.
        if (!res.ok) return null
        const json = await res.json()
        const liste = Array.isArray(json?.routers) ? json.routers : null
        if (!liste) return null
        onbellek = {
            at: Date.now(),
            routers: new Set(liste.map((a) => String(a).trim())),
            limits: json?.limits ?? null,
        }
        return onbellek
    } catch {
        return null
    }
}

/** Test/oturum sinirlari icin: onbellegi bosaltir. */
export function tonRouterOnbelleginiTemizle() { onbellek = null }
