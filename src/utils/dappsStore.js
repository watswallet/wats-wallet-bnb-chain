// `dapps` kaydinin TEK yazicisi (spec 7.1 madde 1, 7.2 "dapps yazicisi").
//
// NEDEN: `dapps` haritasini hem service worker hem dort popup bileseni
// (ConnectDapp, Header, DappPermissions, Dapps) "tum haritayi oku, bir anahtari
// degistir, tum haritayi geri yaz" diye yaziyordu. Bayat bir anlik goruntuden
// yazan bilesen, arada baska bir baglamda yapilan bir iptali (wallet_revokePermissions)
// ya da hesap degisimini SESSIZCE GERI ALIR -- iptal icin bu bir guvenlik gerilemesidir.
//
// COZUM: tum yazimlar `updateDapps(mutator)` ile, `navigator.locks` altinda,
// kilidin ICINDE taze okuma -> degistirme -> yazma olarak yapilir. Web Locks
// kapsami origin'dir; popup, yan panel ve service worker ayni
// chrome-extension:// origin'ini paylasir, yani ayni kilit adi hepsini seri
// hale getirir. (Service worker icinde calistigi DOGRULANMADI: spec R-18;
// dappsStore.test.js sahte `locks` ile, T16 gercek eklentide olcer.)
//
// KILIT YOKSA (eski tarayici, test ortami): modul-ici bir promise kuyrugu AYNI
// baglamdaki yazimlari yine seri yapar. Baglamlar arasi korumayi vermez ama
// bayat-goruntu yarisinin en sik yolunu (ayni popup'ta iki hizli yazim) kapatir.
//
// YENIDEN GIRIS YASAK: mutator'in icinde tekrar updateDapps cagrilirsa kilit
// kendini bekler ve KILITLENIR. Mutator kisa olmali: depodan okuyup yazmak
// disinda yavas is (ag, mesaj) yapmamali.

export const DAPPS_LOCK_NAME = 'wats-dapps'

let fallbackQueue = Promise.resolve()

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

async function readModifyWrite(mutator) {
    const { dapps } = await chrome.storage.local.get('dapps')
    const before = isPlainObject(dapps) ? dapps : {}
    const beforeJson = JSON.stringify(before)

    // Mutator DISKTEN gelen nesneyi degil, DERIN KOPYASINI alir: mutator
    // ortasinda firlatirsa ya da yarim kalirsa elde tutulan nesne bozulmaz.
    const draft = JSON.parse(beforeJson)

    const returned = await mutator(draft)
    // Duz nesne donerse O yazilir; baska her sey (undefined, `delete d[x]`
    // ifadesinin true'su, null) YOK SAYILIR ve yerinde degistirilen taslak yazilir.
    const next = isPlainObject(returned) ? returned : draft

    // Degismediyse YAZMA: bos bir yazim storage.onChanged tetikler, dinleyen her
    // baglam (Header, Dapps.vue, arka plan) bosuna uyanir.
    if (JSON.stringify(next) === beforeJson) return next

    await chrome.storage.local.set({ dapps: next })
    return next
}

/**
 * `dapps` haritasini kilit altinda okur, `mutator`'a derin kopyasini verir, sonucu yazar.
 *
 * @param {(dapps: object) => (void | object | Promise<void | object>)} mutator
 *        Haritayi YERINDE degistirebilir ya da yeni bir duz nesne dondurebilir.
 * @returns {Promise<object>} yazilmis (ya da degismedigi icin yazilmamis) son harita
 */
export function updateDapps(mutator) {
    if (typeof mutator !== 'function') {
        return Promise.reject(new TypeError('updateDapps: mutator bir fonksiyon olmali'))
    }

    const locks = globalThis.navigator?.locks
    if (locks && typeof locks.request === 'function') {
        return locks.request(DAPPS_LOCK_NAME, () => readModifyWrite(mutator))
    }

    const result = fallbackQueue.then(() => readModifyWrite(mutator))
    // Bir yazimin basarisizligi kuyrugu tikamasin: sonraki cagri yine calisir.
    fallbackQueue = result.catch(() => {})
    return result
}
