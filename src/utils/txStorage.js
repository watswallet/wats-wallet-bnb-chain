/**
 * chrome.storage.local uzerinde islem listelerini oku-degistir-yaz.
 *
 * Hem popup hem background AYNI anahtarlara kendi get-then-set'ini yapiyordu ve
 * hicbiri digerine karsi siraya girmiyordu: en son inen `set` digerinin
 * degisikligini eziyordu. Ozellikle background'in yazdigi txHash kaybolabiliyor,
 * islem sonsuza dek 'processing' kaliyor ve kurtarma da onu cozemiyordu
 * (recovery meta.txHash olmayan kayitlari atlar).
 *
 * Buradaki kuyruk, AYNI baglamdaki tum yazmalari seri hale getirir; ayrica her
 * degisiklik depodan TAZE okunan liste uzerinde yapilir, bellekteki eski bir
 * anlik goruntu uzerinde degil. Baglamlar arasi (popup <-> background) yaris
 * penceresi boylece "saniyeler" yerine tek bir get->set araligina iner.
 * chrome.storage islemsel (transactional) bir API sunmadigi icin bu pencere
 * tamamen kapatilamaz.
 */

const queues = new Map()

export function withStorageList(key, mutate) {
    const previous = queues.get(key) || Promise.resolve()

    const run = previous.then(async () => {
        const result = await chrome.storage.local.get(key)
        const current = Array.isArray(result[key]) ? result[key] : []

        const next = await mutate(current)
        if (next === undefined) return current

        await chrome.storage.local.set({ [key]: next })
        return next
    })

    // Kuyrugu canli tut: bir cagrinin hatasi sonrakileri bloke etmemeli.
    queues.set(key, run.catch(() => {}))
    return run
}

export const CURRENT_TRANSACTIONS = 'current_transactions'
export const PENDING_TRANSACTIONS = 'pending_transactions'
