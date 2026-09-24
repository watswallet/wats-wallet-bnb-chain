/**
 * Paneller arasi durum koprusu.
 *
 * Yan panel ayni anda N pencerede acik olabilir ve her biri AYRI bir Vue
 * ornegidir. Bugune kadar bu bir sorun degildi: tek ve kisa omurlu bir arayuz
 * vardi. Panelde, bir pencerede hesap degistirmek digerini ESKI adreste birakir.
 *
 * Bugun senkron olan TEK sey islem verisi (store/transaction.js). Hesap, ag,
 * dil ve tema hicbir store'da durmuyor ve yalnizca acilista bir kez okunuyor.
 *
 * TASARIM: bu modul store bilmez. Isleyiciler cagri yerinden ENJEKTE edilir --
 * boylece modul chrome stub'iyla tek basina test edilebilir ve store zinciri
 * testlere sizmaz.
 *
 * IDEMPOTENT: `start()` iki kez cagrilsa da tek dinleyici birakir.
 * store/transaction.js'teki mevcut sizinti (initListener her cagrildiginda YENI
 * dinleyici ekliyor) tam olarak bunun eksikligiydi.
 */
export function createUiSync({ handlers = {} } = {}) {
    let kayitli = null

    const dinleyici = (changes, area) => {
        if (area !== 'local') return

        for (const [anahtar, isleyici] of Object.entries(handlers)) {
            const degisim = changes[anahtar]
            if (degisim === undefined) continue
            try {
                isleyici(degisim.newValue, degisim.oldValue)
            } catch (e) {
                // Bir isleyicinin patlamasi digerlerini goturmemeli: bunlar
                // bagimsiz senkron yollari.
                console.error(`uiSync isleyicisi basarisiz (${anahtar}):`, e)
            }
        }
    }

    return {
        start() {
            if (kayitli) return
            kayitli = dinleyici
            chrome.storage?.onChanged?.addListener?.(kayitli)
        },
        stop() {
            if (!kayitli) return
            chrome.storage?.onChanged?.removeListener?.(kayitli)
            kayitli = null
        },
    }
}

/**
 * Gercek kablolama noktasi. `createUiSync` chrome'u bilir ama store'lari ve
 * i18n'i BILMEZ; bu fonksiyon ikisini bir araya getirir. Store'lar ve i18n
 * hala cagri yerinden (bootstrap.js) ENJEKTE edilir -- burada import EDILMEZ --
 * boylece uiSync.js store zincirine bagli kalmadan node ortaminda test edilir.
 *
 * PANELLER ARASI SENKRON: panel N pencerede acik olabilir ve her biri ayri bir
 * Vue ornegidir; bir pencerede yapilan degisiklik digerine ULASMALI.
 *
 * @param {{userStore: Function, networkStore: Function, i18n: object}} deps
 * @returns {() => void} teardown -- dinleyiciyi kaldirir.
 */
export function installUiSync({ userStore, networkStore, i18n }) {
    const sync = createUiSync({
        handlers: {
            // ADRES TEK BASINA YETMEZ. Header'in gosterdigi ad, avatar ve profil
            // `address`ten TUREMEZ -- hesap NESNESINDEN gelir ve o nesne Header'da
            // yalnizca `onMounted`ta bir kez dolduruluyor. Sadece adres
            // senkronlandiginda B paneli Home'da YENI hesabin bakiyelerini,
            // basliginda ise ONCEKI hesabin adini gosteriyordu.
            //
            // IKI ALAN AYRI AYRI KAPILI: adres degismemis olsa bile hesap kaydinin
            // KENDISI degismis olabilir (yeniden adlandirma, profil).
            active_account: (yeni) => {
                if (!yeni?.address) return
                const user = userStore()
                if (user.address !== yeni.address) user.address = yeni.address
                if (user.activeAccount?.key !== yeni.key) user.activeAccount = yeni
            },
            // AG icin DONGU UYARISI: networkStore.setCurrentNetwork currentNetwork'u
            // diske yaziyor. Buradan geri `setCurrentNetwork` cagirmak sonsuz
            // ping-pong uretirdi -- bu yuzden chainId esitse ERKEN CIKIS var.
            //
            // ALAN ATAMASI DEGIL, DEPO EYLEMI: `network.currentNetwork = yeni`
            // agin YARISINI senkronlardi. Zincir kaydi degisir, `rpc` ONCEKI
            // zincirin ucunda kalir ve `rpcChainId` da oyle -- alan depoda tam
            // bu yuzden var ("bu alan olmadan bakiyeler yanlis zincirden
            // okunuyordu"). `adoptNetwork` ayni degismezi `setCurrentNetwork`
            // ile AYNI kuralla korur, tek farki diske geri YAZMAMASIDIR.
            // Mantik depoda durur: bu modul store BILMEZ, yalnizca eylemi cagirir.
            currentNetwork: (yeni) => {
                if (!yeni?.chainId) return
                const network = networkStore()
                if (network.currentNetwork?.chainId === yeni.chainId) return
                network.adoptNetwork(yeni)
            },
            language: (yeni) => {
                if (!yeni) return
                // i18n ornegi UYGULAMA BASINA: global locale yazilir.
                // Bilesen icindeki `useI18n().locale` de ayni global'e baglidir.
                if (i18n.global.locale.value !== yeni) {
                    i18n.global.locale.value = yeni
                }
            },
        },
    })
    sync.start()
    return () => sync.stop()
}
