// TonConnect 2 injected kopru -- SAYFA dunyasinda (world: MAIN) calisir.
//
// Anahtar `wats`: EVM saglayicisiyla AYNI nesne, cunku tek cuzdanin tek
// jsBridgeKey'i olmali (resmi liste kaydi da o anahtara yapilacak).
//
// "RESMI LISTEYE GEREK YOK" VARSAYIMI OLCULDU VE YARIM CIKTI (2026-09-11).
// @tonconnect/sdk 3.x sayfadaki `window` anahtarlarini gezer ve bizi bulur --
// AMA yalnizca walletInfo bes alanini da tasiyorsa (asagi bak).
// @tonconnect/sdk 4.x bu taramayi TUMDEN kaldirdi: WalletsListManager'in
// getCurrentlyInjectedWallets'i `if (!isQaModeEnabled()) return []` ile basliyor.
// Yani 4.x kullanan dapp'lerde gorunmenin TEK yolu ton-blockchain/wallets-list
// kaydidir; buradaki alanlar o kaydi GEREKSIZ KILMAZ, onunla tutarli olmalidir.
//
// EVM KANALIYLA AYRI: istekler ayni `wats_content_script` hattindan gider ama
// yanitlar `wats_ton_inpage` hedefiyle gelir. Ayni hedefi paylassalardi TON'un
// disconnect olayi EVM saglayicisinin EIP-1193 olay hattina duser ve kaybolurdu.

// BU DOSYA HIC IMPORT ETMEZ -- ZORUNLU, tercih degil.
//
// crxjs bir icerik betiginde TEK bir `import` satiri gorurse onu dogrudan degil
// bir YUKLEYICI ile kaydeder; yukleyici calisma zamaninda dinamik yukleme yapip
// uzantidan ayri dosyalar ceker. Sonuc: kopru sayfaya GEC gelir (olculdu: ~82 ms) ve o dosyalarin
// indirilmesi engellenirse (korumali iframe, kati CSP) HIC gelmez. EVM saglayicisi
// ayni sayfada calismaya devam eder -- cunku injected.js de importsuzdur ve tek
// parca cikar. Iki koprunun ayni guvenilirlikte olmasi icin bu dosya da oyle kalmali.
//
// Cihaz betimi DERLEME ZAMANINDA gomulur: vite.config.js / vitest.config.js
// `utils/ton/tonConnectDevice.js`i import edip degeri __TON_DEVICE_INFO__ olarak
// yaziyor. Yani tek kaynak DEGISMEDI, yalnizca calisma zamani import'u kalkti.
// Kopya acmak yasak (o dosyanin bas yorumundaki olum-sonrasi incelemeye bak).
const tonConnectDeviceInfo = () => JSON.parse(JSON.stringify(__TON_DEVICE_INFO__))

const generateId = () => Math.random().toString(36).substring(2, 15)

const callbacks = new Map()
const eventListeners = new Set()

/**
 * TASIMA KATMANI hatasi (content.js'in 4200 engeli, chrome.runtime.lastError
 * dali, ya da arka planin dondugu response.error) da bir YANIT govdesidir,
 * atilan bir exception degil -- karar 3'un devami. Govde sekli METODA gore
 * degisir: TonConnect protokolu connect/restore icin AYRI bir OLAY
 * (`connect_error`) bekler, send icin ise AppRequest'in KENDI id'siyle
 * eslesen bir `{error}` govdesi bekler. Bu bicimlendirme yapilmazsa dapp'in
 * SDK'si `response.event` ya da `response.error` okurken UNDEFINED'a coker.
 *
 * Kod eslemesi (tasarim belgesi SS3.2):
 *   4200 (EIP-1193 "desteklenmeyen metot")            -> 400 METHOD_NOT_SUPPORTED
 *   4001 (dappFunctions.js: pencere kapatildi / istek
 *         yeni bir istekle degistirildi)              -> 300 USER_REJECTS_ERROR
 *   digerleri -- kodun HIC olmamasi dahil (lastError
 *         dalinda oldugu gibi)                        -> 0   UNKNOWN_ERROR
 *
 * FINAL INCELEME BULGUSU (K3): 4001 eskiden de UNKNOWN_ERROR'a (0) dusuyordu.
 * Onay penceresini KAPATMAK da (dappFunctions.js onRemoved) YENI bir istekle
 * DEGISTIRMEK de ayni 4001'i gonderir; acikca Reddet'e basmakla AYNI "kullanici
 * vazgecti" anlamina gelir (spec: "reddetti VEYA pencereyi kapatti"), 0 ile
 * degil. 0 donmek @tonconnect/ui'nin modalini HATA durumunda birakiyordu --
 * oysa bu temiz bir iptal, cozulmemis bir ariza degil.
 */
function tasimaHatasiniBicimlendir(error, method, appRequestId) {
    const code = tasimaKoduCoz(error && error.code)
    const message = (error && error.message) || 'Unknown error'
    if (method === 'tonconnect_send') {
        return { error: { code, message }, id: appRequestId }
    }
    return { event: 'connect_error', id: Date.now(), payload: { code, message } }
}

function tasimaKoduCoz(kod) {
    if (kod === 4200) return 400
    if (kod === 4001) return 300
    return 0
}

window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.target !== 'wats_ton_inpage') return

    // Cuzdanin KENDI baslattigi olaylar (kullanici baglantiyi kesti). Bir istegin
    // yaniti degil, o yuzden id TASIMAZ.
    if (event.data.event) {
        for (const fn of eventListeners) {
            try { fn(event.data.event) } catch (e) { /* bir dinleyicinin hatasi digerlerini kesmemeli */ }
        }
        return
    }

    const { id, result, error } = event.data
    if (!id || !callbacks.has(id)) return
    const { resolve, method, appRequestId } = callbacks.get(id)
    callbacks.delete(id)
    // TonConnect'te HATA DA BIR YANITTIR, atilan bir exception degil. reject
    // etmek dapp'in kendi hata isleyicisini atlar ve kullaniciya kirik bir
    // ekran gosterir -- bu yuzden HER ZAMAN resolve edilir.
    if (error) {
        resolve(tasimaHatasiniBicimlendir(error, method, appRequestId))
        return
    }
    resolve(result)
})

function callBackground(method, params) {
    return new Promise((resolve) => {
        const id = generateId()
        // send()'in hata govdesi AppRequest'in KENDI id'sini tasimali (TonConnect
        // protokolu boyle tanimliyor). Bunu saklamanin dogru yeri budur -- global
        // bir sayac degil, o an gonderilen mesajin kendisi.
        const appRequestId = method === 'tonconnect_send' ? params[0]?.id : undefined
        callbacks.set(id, { resolve, method, appRequestId })
        window.postMessage({ target: 'wats_content_script', id, payload: { method, params } }, '*')
    })
}

const bridge = {
    // BILDIRIM BAGLAYICIDIR: dapp buna bakip istegini kurar. maxMessages 4
    // bildirip 5. mesaji sessizce dusurmek, kullanicinin gormedigi bir islem
    // yayinlamak olurdu -- arka plan tarafi da bu sayiyi zorluyor. Kaynak
    // tonConnectDevice.js -- ConnectEvent'in `device` alaniyla (tonDappFunctions.js,
    // TonConnectApprove.vue) AYNI yerden okunur, ucuncu bir kopya ACILMAZ.
    deviceInfo: tonConnectDeviceInfo(),
    // BU BES ALAN SDK'NIN KESIF KAPISIDIR, suslemesi degil. @tonconnect/sdk
    // (3.2.0 ve 4.0.2, isJSBridgeWithMetadata) enjekte cuzdani listeye almadan
    // once `name, app_name, image, about_url, platforms` alanlarinin HEPSINI
    // arar; biri eksikse cuzdan SESSIZCE elenir -- ne exception atilir ne
    // konsola bir sey yazilir. `app_name` ve `platforms` eksikti ve dapp'lerin
    // cuzdan listesi bu yuzden bos donuyordu (2026-09-11 tarayicida olculdu).
    //
    // `app_name` jsBridgeKey ile AYNI ('wats'): kayit defteri (wallets-list)
    // kaydi geldigi gun ayrisirlarsa SDK ayni cuzdani IKI kez listeler.
    // `platforms` -> @tonconnect/ui supportsExtension() chrome/firefox/safari
    // arar; bu paket yalnizca Chrome icin uretiliyor (manifest.config.js'te
    // gecko/firefox dali YOK), o yuzden tek deger dogru degerdir.
    // `features` walletInfo'da AYRICA gerekir: dapp `walletsRequiredFeatures`
    // bildirirse @tonconnect/ui yetenegi deviceInfo'dan DEGIL buradan okur.
    walletInfo: {
        name: 'Wats Wallet',
        app_name: 'wats',
        // OLCULDU (2026-09-11): /icon.png 404 donuyor, /logo.png 200 ve gecerli
        // bir 500x500 PNG. Bu URL sussuz bir alan degil -- cuzdan modalinde
        // cizilen ikon ve kayit defterine gidecek deger odur; 404 bir URL hem
        // kirik ikon gosterir hem defter PR'ini reddettirir.
        image: 'https://watswallet.com/logo.png',
        about_url: 'https://watswallet.com',
        platforms: ['chrome'],
        features: tonConnectDeviceInfo().features,
    },
    protocolVersion: 2,
    // Cuzdan-ici tarayici DEGILIZ, bir uzantiyiz. true demek dapp'in "kullanici
    // zaten cuzdanin icinde" varsayimiyla baglanti ekranini atlamasina yol acar.
    isWalletBrowser: false,

    connect(protocolVersion, message) {
        return callBackground('tonconnect_connect', [message, protocolVersion])
    },

    restoreConnection() {
        return callBackground('tonconnect_restore', [])
    },

    send(message) {
        return callBackground('tonconnect_send', [message])
    },

    listen(callback) {
        eventListeners.add(callback)
        return () => { eventListeners.delete(callback) }
    },
}

// SAVUNMACI YAZIM: injected.js `window.wats`i DUZ ATAMA ile yaziyor. Iki MAIN-world
// betigin yuklenme sirasina GUVENILMEZ -- siraya bagli bir kurulum, yarin biri
// manifest dizisini yeniden duzenlediginde sessizce bozulur.
if (!window.wats) window.wats = {}
window.wats.tonconnect = bridge
