// TonConnect 2 injected kopru -- SAYFA dunyasinda (world: MAIN) calisir.
//
// @tonconnect/sdk sayfadaki `window` anahtarlarini gezip `tonconnect` alani tasiyan
// nesneleri cuzdan listesine ekliyor; bu yuzden resmi listeye kayitli olmasak da
// dapp bizi gorur. Anahtar `wats`: EVM saglayicisiyla AYNI nesne, cunku tek cuzdanin
// tek jsBridgeKey'i olmali (resmi liste kaydi da o anahtara yapilacak).
//
// EVM KANALIYLA AYRI: istekler ayni `wats_content_script` hattindan gider ama
// yanitlar `wats_ton_inpage` hedefiyle gelir. Ayni hedefi paylassalardi TON'un
// disconnect olayi EVM saglayicisinin EIP-1193 olay hattina duser ve kaybolurdu.

import { tonConnectDeviceInfo } from './utils/ton/tonConnectDevice'

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
    walletInfo: {
        name: 'Wats Wallet',
        image: 'https://watswallet.com/icon.png',
        about_url: 'https://watswallet.com',
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
