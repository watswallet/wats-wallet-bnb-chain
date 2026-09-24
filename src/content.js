import { isPagePayloadAllowed } from './utils/messageGate'
import { SOLANA_ENABLED } from './utils/featureFlags'

// Saglayici artik buradan ENJEKTE EDILMIYOR: manifest.config.js'teki
// world: MAIN content script kaydi sayfa dunyasinda, sayfanin hicbir betigi
// calismadan once yurutulur. <script src> eklemek asenkron yukleniyor ve
// window.ethereum sayfa betiklerinden sonra olusabiliyordu.

/**
 * Solana serit gonderen kapisi -- SAVUNMA DERINLIGI (nihai inceleme C1.3).
 *
 * Bu dosya <all_urls> uzerinde all_frames:true ile kayitlidir; solanaInjected.js
 * (manifest.config.js) ise yalnizca https/localhost/127.0.0.1 + top-frame'e
 * enjekte edilir. Yani mesru bir Solana istegi HER ZAMAN bu kosullari
 * saglayan bir cerceveden gelir -- ama BU dosyanin kendisi o kisitlamaya TABI
 * DEGILDIR: kotu niyetli bir iframe ya da http sayfasi `wats_content_script`
 * mesajini dogrudan gonderip bu dinleyiciye ulasabilir. ASIL kapi arka planda
 * solanaSayfaKapisi'dir (utils/solanaDappFunctions.js) -- bu yalnizca ayni
 * istegin arka plana HIC gitmemesini saglar.
 */
function solanaCerceveIzinli() {
    if (window !== window.top) return false
    try {
        const u = new URL(window.location.origin)
        return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))
    } catch (e) {
        return false
    }
}

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

    // OZELLIK KAPISI -- UCUNCU katman (manifest kaydi ve arka plan kapisindan
    // sonra). Bayrak kapaliyken solanaInjected.js manifest'e hic yazilmaz, yani
    // mesru bir Solana istegi zaten DOGMAZ; ama `wats_content_script` hedefini
    // HERHANGI bir sayfa yazabilir ve bu dosya <all_urls> uzerinde calisir.
    //
    // Sessizce DUSURULMEZ: injected.js request() yaniti gelene kadar
    // {resolve,reject} saklar -- yanitsiz istek sayfadaki await'i sonsuza dek
    // asili birakir ve callback sizdirir. 4200 = EIP-1193 "desteklenmeyen metot",
    // kapali bir ozellik icin dogru kod (4100 "yetkisiz" DEGIL: sorun yetki degil,
    // metodun bu derlemede hic var olmamasi).
    if (hedef === 'wats_solana_inpage' && !SOLANA_ENABLED) {
        if (event.data.id) {
            window.postMessage({ target: hedef, id: event.data.id, error: { code: 4200, message: 'Method not supported.' } }, '*')
        }
        return
    }

    // C1.3 -- SAVUNMA DERINLIGI: Solana seridi ust cerceve + https/localhost
    // disinda HIC arka plana gitmez. Arka plandaki solanaSayfaKapisi zaten
    // fail-closed reddeder; burasi ayni reddi PAYLASILAN service worker'a
    // hic ulasmadan verir.
    if (hedef === 'wats_solana_inpage' && !solanaCerceveIzinli()) {
        if (event.data.id) {
            window.postMessage({ target: hedef, id: event.data.id, error: { code: 4100, message: 'Unauthorized.' } }, '*')
        }
        return
    }

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

    // OKSUZ ICERIK BETIGI KAPISI (2026-09-11, tarayicida OLCULDU).
    //
    // Uzanti yeniden yuklendiginde (chrome://extensions > yenile, ya da bir
    // surum guncellemesi) ACIK sayfalardaki icerik betigi eski baglamda KALIR.
    // O baglamda `chrome.runtime.sendMessage` SENKRON FIRLAR ("Extension
    // context invalidated") -- callback HIC cagrilmaz, dolayisiyla asagidaki
    // butun korumalar da calismaz.
    //
    // OLCULDU: yeniden yuklemeden ONCE `eth_chainId` -> "0x1"; SONRA ayni
    // istek 2.5 sn icinde HIC cevaplanmadi (injected.js'te zaman asimi YOK,
    // yani sonsuza kadar). Kullanicinin gordugu sey "dapp dondu"dur ve
    // konsolda bunu acikliyan HICBIR SEY yoktur.
    //
    // Dogru davranis: dapp'e sekli dogru bir hata donmek ve ne yapmasi
    // gerektigini SOYLEMEK -- sayfayi yenilemek yeni icerik betigini yukler.
    try {
        chrome.runtime.sendMessage(event.data.payload, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Background script hatasi:", chrome.runtime.lastError)
                window.postMessage({
                    target: hedef,
                    id: event.data.id,
                    error: { message: "Could not establish communication with the wallet background service." }
                }, '*')
                return
            }

            // BOS YANIT KAPISI (2026-09-11, canli hata).
            //
            // Gorulen: "Error handling response: TypeError: Cannot read properties
            // of null (reading 'result')" -- yani `response` NULL geldi ve
            // `lastError` BOSTU (yukaridaki dal calismadi). Eski satir `error` icin
            // `?.` kullaniyor ama `result` icin KULLANMIYORDU, dolayisiyla callback
            // FIRLIYORDU. Ve firladigi icin asagidaki postMessage HIC calismiyordu:
            // sayfaya hicbir sey gitmiyor, injected.js'in `_callbacks` kaydi hicbir
            // zaman cozulmuyor (orada zaman asimi YOK) ve dapp'in await'i SONSUZA
            // asili kaliyordu. Yani gorunur belirti bir konsol hatasi, gercek zarar
            // olu kilitlenmis bir dapp.
            //
            // Iki sebebi de ayni sekilde ele alinir: (a) uzanti yeniden yuklenip
            // sayfadaki icerik betigi OKSUZ kalmis olabilir, (b) bir isleyici
            // `return true` deyip yanit vermemis olabilir. Ikisinde de dogru
            // davranis SUSMAK DEGIL, dapp'e EIP-1193 sekilli bir hata dondurmektir.
            // Metot adi konsola YAZILIR: tekrar ederse hangi yolun sustugu
            // dogrudan gorulsun.
            if (!response || typeof response !== 'object') {
                console.error('Wats: arka plandan bos yanit', event.data.payload?.method, response)
                window.postMessage({
                    target: hedef,
                    id: event.data.id,
                    error: { code: -32603, message: 'The wallet returned an empty response. Reload the page and try again.' }
                }, '*')
                return
            }

            window.postMessage({
                target: hedef,
                id: event.data.id,
                result: response.result,
                error: response.error
            }, '*')
        })
    } catch (e) {
        console.error('Wats: uzanti baglami gecersiz (sayfayi yenileyin)', event.data.payload?.method, e)
        window.postMessage({
            target: hedef,
            id: event.data.id,
            error: { code: -32603, message: 'The wallet extension was reloaded. Refresh the page and try again.' }
        }, '*')
    }
})

// Listen for events from background script and forward them to the page.
// UC AYRI HEDEF: EVM olaylari (chainChanged/accountsChanged) `wats_inpage`,
// TonConnect olaylari `wats_ton_inpage`, Solana olaylari `wats_solana_inpage`.
// Tek hedef paylasilsaydi bir protokolun olayi digerinin olay hattina duser
// ve kaybolurdu.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === 'wats_inpage' && message.method) {
        // CERCEVE FILTRESI -- asagidaki TON dalindaki desenin EVM ikizi, IKI
        // defekti birden kapatir:
        //
        // (a) ULASMAYAN OLAY: notifyConnectedDapps artik frameId VERMEDEN TUM
        //     sekmelere yolluyor (bkz. background.js'teki not), cunku eski "ust
        //     cerceve hostname'i" suzgeci iframe icinde calisan dapp'i HIC
        //     bulamiyordu -- `tab.url` sarmalayici sitenin adresidir. Hedef
        //     hostname artik mesajin ICINDE; hangi cercevenin sayfaya
        //     ileteceginе BURASI karar verir.
        //
        // (b) SIZAN OLAY: bu dalda HICBIR suzgec YOKTU ve content.js
        //     `all_frames:true` ile calisiyor. Bagli bir dapp sayfasindaki
        //     ucuncu taraf iframe'ler (reklam/widget/analitik)
        //     `window.ethereum.on('accountsChanged')` dinleyerek kullanicinin
        //     EVM adresini ogrenebiliyordu -- kullanici hicbir sey gormeden.
        //     TON ve Solana seritlerinde bu en bastan onlenmisti.
        //
        // FAIL-CLOSED: hedef listesi TASIMAYAN mesaj da DUSER. Eslesme sorusunu
        // cevaplayamayan bir mesaji iletmek, (b)'yi eski haliyle geri getirirdi.
        //
        // LISTE (tekil `hostname` DEGIL): arka plan sekme BASINA TEK mesaj
        // yolluyor, bagli hostname basina ayri ayri DEGIL -- gerekce ve kabul
        // edilen odun background.js'teki notta. Buradaki karar degismiyor:
        // yalnizca KENDI cercevemizin adi listedeyse sayfaya iletiriz.
        if (!Array.isArray(message.hostnames)) return
        if (!message.hostnames.includes(window.location.hostname)) return
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