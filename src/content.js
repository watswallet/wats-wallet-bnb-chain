import { isPagePayloadAllowed } from './utils/messageGate'

// Saglayici artik buradan ENJEKTE EDILMIYOR: manifest.config.js'teki
// world: MAIN content script kaydi sayfa dunyasinda, sayfanin hicbir betigi
// calismadan once yurutulur. <script src> eklemek asenkron yukleniyor ve
// window.ethereum sayfa betiklerinden sonra olusabiliyordu.

window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.target !== 'wats_content_script') return

    // IKINCI KATMAN. Buradaki tek kontrol eskiden 'target' metniydi ve o metni
    // HERHANGI bir sayfa yazabilir; payload ise oldugu gibi arka plana gidiyordu.
    // Ic aksiyonlar (SIGN, SEND_TRANSACTION, SWAP...) arka planda dapp metotlariyla
    // AYNI switch'te oturdugu icin bu, kilidi acik bir cuzdanda keyfi imza demekti.
    //
    // Asil kapi arka plandadir (utils/messageGate.js); burasi zararli payload'in
    // service worker'a HIC ulasmamasi icin. Gercek dapp saglayicisi yalnizca
    // { method, params } gonderir (src/injected.js), o yuzden bu fren mesru
    // trafigi kesmez ve ileride eklenecek EIP-1193 metotlarini de kirmaz.
    // Engellenen istek YANITSIZ BIRAKILMAZ: injected.js request()'i yaniti
    // gelene kadar {resolve,reject}'i saklar; sessiz dusurme dapp'in await'ini
    // sonsuza dek askida birakir ve callback sizdirir. 4200: EIP-1193
    // "desteklenmeyen metot".
    // Yanit, istegin GELDIGI hatta doner. TonConnect ya da Solana istegi EVM hattina
    // yanitlanirsa saglayici onu EIP-1193 yaniti sanip callback tablosunda arar ve
    // bulamaz -- dapp'in await'i sonsuza dek asili kalir.
    const metot = String(event.data.payload?.method || '')
    const hedef = metot.startsWith('tonconnect_')
        ? 'wats_ton_inpage'
        : metot.startsWith('solana_')
            ? 'wats_solana_inpage'
            : 'wats_inpage'

    if (!isPagePayloadAllowed(event.data.payload)) {
        if (event.data.id) {
            window.postMessage({
                target: hedef,
                id: event.data.id,
                error: { code: 4200, message: 'Method not supported.' }
            }, '*')
        }
        return
    }

    chrome.runtime.sendMessage(event.data.payload, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Background script hatası:", chrome.runtime.lastError)
            window.postMessage({
                target: hedef,
                id: event.data.id,
                error: { message: "Could not establish communication with the wallet background service." }
            }, '*')
            return
        }

        window.postMessage({
            target: hedef,
            id: event.data.id,
            result: response.result,
            error: response?.error
        }, '*')
    })
})

// Listen for events from background script and forward them to the page.
// UC AYRI HEDEF: EVM olaylari (chainChanged/accountsChanged) `wats_inpage`,
// TonConnect olaylari `wats_ton_inpage`, Solana olaylari `wats_solana_inpage`.
// Tek hedef paylasilsaydi bir protokolun olayi digerinin olay hattina duser
// ve kaybolurdu.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === 'wats_inpage' && message.method) {
        window.postMessage({
            target: 'wats_inpage',
            method: message.method,
            result: message.result
        }, '*')
        return
    }

    if (message.target === 'wats_ton_inpage' && message.event) {
        // CERCEVE FILTRESI (Gorev 14 -- daha once acilan bir defektin duzeltmesi).
        // notifyTonDapp artik frameId VERMEDEN TUM sekmelere yolluyor (bkz.
        // utils/tonDappFunctions.js basindaki not): bu sekmenin HER cercevesi
        // (iframe'ler DAHIL) bu mesaji alir. Hedef hostname mesajin ICINDE
        // tasinir; yalniz KENDI cercevemizin `location.hostname`iyle eslesirse
        // sayfaya iletiriz. Eslesmezse SESSIZCE yutulur -- baska bir cercevenin
        // (or. ust sayfanin, ya da sayfadaki baska bir iframe'in) olayini
        // yanlislikla bu dapp'e vermek, cuzdanin hic konusmadigi bir baglantiyi
        // kesilmis/kurulmus gostermek olurdu.
        if (message.hostname !== window.location.hostname) return
        window.postMessage({
            target: 'wats_ton_inpage',
            event: message.event
        }, '*')
    }

    if (message.target === 'wats_solana_inpage' && message.event) {
        // TON dalindaki cerceve filtresinin ORIGIN surumu (K5). `hostname` YETMEZ:
        // `https://app.x.com` ile `http://app.x.com` ve o host'un her portu ayni
        // yetkiyi paylasirdi. Solana oturumlari TAM ORIGIN ile anahtarlanir, suzgec
        // de AYNI birimle olculmelidir. Eslesmezse SESSIZCE yutulur -- baska bir
        // origin'in olayini bu dapp'e vermek, cuzdanin hic konusmadigi bir
        // baglantiyi kesilmis gostermek olurdu.
        if (message.origin !== window.location.origin) return
        window.postMessage({
            target: 'wats_solana_inpage',
            event: message.event
        }, '*')
    }
})