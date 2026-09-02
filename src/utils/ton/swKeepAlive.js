// MV3 service worker'ini UZUN bir is boyunca ayakta tutma DENEMESI.
//
// UYARI - BU BIR HEURISTIKTIR, GARANTI DEGIL (tasarim belgesi bolum 10, R4). Chrome'un
// 30 saniyelik atalet sayacinin bir uzanti API cagrisiyla sifirlanmasi YAYINLANMIS
// BIR SOZLESME DEGIL, gozlemlenmis bir davranistir. Chrome bunu her surumde
// degistirebilir ve HICBIR uyari vermez.
//
// Bu yuzden BU DOSYA TEK SAVUNMA OLARAK SAYILMAZ. TON ucret akisinda para kaybini
// gercekten onleyen sey, relay'e cikmadan ONCE DISKE yazilan makbuzdur
// (tonFeeSettlement.js + tonFeeRelayer.js adim 9). Bu sarmalayici yalnizca "makbuz
// yazildi ama yanit beklenirken SW oldu" penceresini DARALTMAYA calisir; kapatmaz.
// Buradaki bir gerileme sessizdir - o pencere biraz genisler, o kadar; kurtarma
// (tonFeeRecovery.js) yine de devreye girer.
//
// `chrome` yoksa (vitest'in node ortami, eklenti disi baglamlar) `fn` DUZ cagrilir
// ve HICBIR SEY firlatilmaz: bir canlilik hilesinin yoklugu, isin kendisini
// engellememeli.

// 20 sn: Chrome'un gozlemlenen ~30 sn'lik atalet penceresinin ALTINDA kalmak icin.
// 30'a yakin bir deger (orn. 29 sn) zamanlayici kaymasinda pencereyi kacirir.
export const KEEP_ALIVE_INTERVAL_MS = 20 * 1000

// Okunan anahtarin var olmasi GEREKMEZ - amac degeri degil, chrome.storage
// cagrisinin KENDISI. Bu yuzden gercek bir anahtari (ve onun okunma maliyetini)
// secmiyoruz.
export const KEEP_ALIVE_STORAGE_KEY = '__ka'

function keepAliveStore() {
    try {
        if (typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local) {
            return chrome.storage.local
        }
    } catch { /* eklenti disi baglam */ }
    return null
}

/**
 * `fn` calisirken KEEP_ALIVE_INTERVAL_MS'de bir chrome.storage.local.get cagirir,
 * `fn` biter bitmez (basarili ya da FIRLATARAK) durdurur.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>} `fn`in sonucu; `fn` firlatirsa AYNI hata firlatilir.
 */
export async function withKeepAlive(fn) {
    const store = keepAliveStore()
    if (!store) return await fn()

    const timer = setInterval(() => {
        // Yoklamanin hatasi cagirani ETKILEMEZ: depo mesgul/kapali olabilir. Burada
        // firlayan ya da REDDEDEN bir cagri, sarmaladigimiz gercek isi (relay yaniti
        // beklemek) yarida keserdi - oysa bu yalnizca bir canlilik hilesi.
        try {
            Promise.resolve(store.get(KEEP_ALIVE_STORAGE_KEY)).catch(() => {})
        } catch { /* senkron firlatan sahte/eski depo */ }
    }, KEEP_ALIVE_INTERVAL_MS)

    // `finally`: `fn` FIRLATSA da zamanlayici durur. Durmazsa SW sonsuza kadar
    // ayakta tutulmaya calisilir ve her hatali gonderim bir sizinti birakir.
    try {
        return await fn()
    } finally {
        clearInterval(timer)
    }
}
