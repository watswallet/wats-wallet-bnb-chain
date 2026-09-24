// TonConnect isteklerinin ARKA PLAN tarafi -- dappFunctions.js'in kardesi.
//
// Neden ayri dosya: iki protokolun ortak kodu YOK ve background.js zaten 2700+
// satir. Onay PENCERESI ise PAYLASILIR (openApprovalWindow): ikinci bir pencere
// yoneticisi, EVM ve TON isteklerinin birbirinin penceresini kapatmasina yol acardi.

import { openApprovalWindow, resolveSenderOrigin } from './dappFunctions'
import { tonSignerReady } from './ton/tonIdentity'
import { validateManifest, MANIFEST_NOT_FOUND } from './ton/tonConnectManifest'
import { validateSendTransactionRequest, tonNetworkId } from './ton/tonConnectMessages'
import { grantedTonSession, removeTonSession, orphanTonHostnames } from './ton/tonConnectAuthz'
import { buildSignDataInput } from './ton/tonSignDataSchemes'
import { tonConnectDeviceInfo } from './ton/tonConnectDevice'
import { flattenVaultAccounts } from './knownRecipients'

const BAD_REQUEST = 1
const UNKNOWN_APP = 100
const METHOD_NOT_SUPPORTED = 400

// TonConnect protokolunun kendi kodu (USER_REJECTS_ERROR). "Bu cuzdanda TON
// hesabi yok" durumunda BILEREK bu kod ve kullanici reddiyle AYNI mesaj
// donulur: 0/1 gibi ayirt edici bir kod, anonim bir sayfaya cuzdanin hesap
// bilesimini soran bir ORACLE verirdi. TonConnectApprove.vue'nun reddet()'i de
// zaten 300 gonderiyor -- dapp icin iki yol AYIRT EDILEMEZ.
const USER_REJECTS = 300

/**
 * Bu oturum icin GERCEKTEN imzalayacak hesap.
 *
 * `active_account` DEGIL: TonConnect oturumu `session.accountKey`e SABITLENIR,
 * kullanici arada baska bir hesaba gecmis olabilir. Cozumleme TonSendTx.vue:146
 * ile BIREBIR ayni: once vaults'ta anahtarla ara, bulunamazsa aktif hesaba dus.
 * Yedek YALNIZCA gonderim/imza yolunda verilir (onay ekrani da oyle yapiyor);
 * restoreConnection'in ekrani YOKTUR ve yedegi de yoktur -- orada cozulemeyen
 * bir accountKey yetim oturumdur ve kapida duser.
 */
function tonImzalayanHesap(vaults, session, aktifHesap) {
    return flattenVaultAccounts(vaults).find((a) => a.key === session?.accountKey) || aktifHesap || null
}

// Manifest indirmesine tanidigimiz UST SINIR. Yaniti hic vermeyen bir sunucu
// suresiz beklense sendResponse HICBIR ZAMAN cagrilmaz -- dapp'in promise'i
// SONSUZA KADAR askida kalir ve mesaj portu acik kalir. Bu bir nezaket degil,
// KILITLENMEYI (hang) onlemek icin: onay penceresi de zaten bu cagrinin
// donmesini bekliyor, o da beraberinde askida kalirdi.
const MANIFEST_FETCH_TIMEOUT_MS = 8000

const connectError = (code, message) => ({ event: 'connect_error', id: Date.now(), payload: { code, message } })
const sendError = (code, message, id) => ({ error: { code, message }, id })

function hasHttpsScheme(value) {
    if (typeof value !== 'string') return false
    try {
        const u = new URL(value)
        return u.protocol === 'http:' || u.protocol === 'https:'
    } catch (e) {
        return false
    }
}

/**
 * Manifest ARKA PLANDA indirilir. Sayfada indirilseydi dapp kendi manifest'ini
 * uydurabilirdi -- gosterdigimiz ad/ikonun bir anlami kalmazdi.
 */
export async function fetchManifest(manifestUrl) {
    // SEMA KONTROLU AGA CIKMADAN ONCE: http(s) disi bir deger (file:, javascript:,
    // ic aga isaret eden baska bir sema) icin fetch'i HIC denememek gerekir --
    // yetkisiz bir sayfaya "bu host erisilebilir mi/kapali mi" diye soran bir
    // ORACLE vermemek icin. Denenip basarisiz olsaydi bile MANIFEST_NOT_FOUND (2)
    // ile icerik hatasi (3) arasindaki fark, sayfanin dis kaynaklari PROB'lamasina
    // yeterdi.
    if (!hasHttpsScheme(manifestUrl)) {
        return { ok: false, code: MANIFEST_NOT_FOUND, message: 'Manifest could not be fetched' }
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), MANIFEST_FETCH_TIMEOUT_MS)
    try {
        const res = await fetch(manifestUrl, { method: 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal })
        if (!res.ok) return { ok: false, code: MANIFEST_NOT_FOUND, message: 'Manifest could not be fetched' }
        return { ok: true, raw: await res.json() }
    } catch (e) {
        // AbortError DAHIL: zaman asimi da "indirilemedi" (kod 2) sayilir --
        // dapp'e "yaniti bekleyemedik" ile "sunucu yok" arasinda fark yok.
        return { ok: false, code: MANIFEST_NOT_FOUND, message: 'Manifest could not be fetched' }
    } finally {
        clearTimeout(timeoutId)
    }
}

/**
 * Cuzdandan sayfaya olay (TonConnect'te tek yon: `disconnect`).
 *
 * GOREV 14 DUZELTMESI (daha once acilan bir defekt): eskiden burasi sekmeleri
 * `tab.url`in (UST cercevenin adresi) hostname'iyle SUZUYORDU. Oysa oturumlar
 * GONDEREN cercevenin hostname'iyle anahtarlanir (resolveSenderOrigin bunu
 * KASITLI olarak boyle cozer) -- bir dapp iframe icinde calisiyorsa tab.url
 * dapp'in adresini HIC TASIMAZ (aggregator/wrapper sitesinin adresidir). Sonuc:
 * iframe'deki dapp bu olayi ASLA almiyordu -- cuzdan oturumu unutuyor, dapp
 * hala bagli saniyordu.
 *
 * Yeni permission EKLEMEDEN duzeltme: `chrome.tabs.sendMessage(tabId, msg)`
 * frameId VERILMEDEN o sekmenin TUM cercevelerine ulasir ve content.js zaten
 * HER cercevede calisiyor. Bu yuzden burasi artik hostname'i SUZMEZ, TUM
 * sekmelere yollar; hedef hostname mesajin ICINDE tasinir ve hangi cercevenin
 * bunu sayfaya iletecegine content.js kendi `window.location.hostname`iyle
 * karsilastirarak karar verir (bkz. content.js, content.test.js).
 */
export async function notifyTonDapp(hostname, event) {
    try {
        const tabs = await chrome.tabs.query({})
        for (const tab of tabs) {
            if (tab.id === undefined || tab.id === null) continue
            chrome.tabs.sendMessage(tab.id, { target: 'wats_ton_inpage', hostname, event }).catch(() => {})
        }
    } catch (e) {
        console.error('notifyTonDapp error:', e)
    }
}

/**
 * Bagli hesabi ARTIK VAR OLMAYAN TON oturumlarini temizler ve dapp'lere haber
 * verir. TonConnect'te accountsChanged YOK (tasarim belgesi bolum 7.1): oturum
 * ADRESE bagli, bagli hesap silinince imzalayacak anahtar kalmaz -- oturumu
 * tutmak dapp'e kullanilamayan bir baglanti gostermek olurdu.
 *
 * `vaults` DOGRUDAN parametre: hesap anahtarlarinin TEK gercek kaynagi budur
 * (kontrolor karari, Gorev 14 brief duzeltmesi) -- `active_account` yalniz
 * SECILI hesabi bilir, TUMUNU degil. `orphanTonHostnames` zaten FAIL-OPEN
 * (bos/gecersiz liste -> [] doner, tonConnectAuthz.test.js'te kilitli), o
 * yuzden burada AYRICA bir bos-liste kontrolu YOK.
 *
 * NOT: bu depoda su an hesap/kasa SILME akisi YOK (bkz. tonFlowWiring.test.js
 * -- "depoda kasa/hesap SILME akisi YOK" kaydi). Bu fonksiyon HENUZ hicbir
 * cagirandan tetiklenmiyor; ileride bir hesap silme ekrani eklendiginde
 * DOGRUDAN buraya baglanmasi icin disari verilip test edildi.
 */
export async function disconnectOrphanedTonSessions(vaults) {
    try {
        const accountKeys = (vaults || []).flatMap((v) => (v?.accounts || []).map((a) => a?.key)).filter(Boolean)
        const { ton_dapps = {} } = await chrome.storage.local.get('ton_dapps')
        const yetimler = orphanTonHostnames(ton_dapps, accountKeys)
        if (!yetimler.length) return

        let sonraki = ton_dapps
        for (const hostname of yetimler) {
            sonraki = removeTonSession(sonraki, hostname)
            await notifyTonDapp(hostname, { event: 'disconnect', id: Date.now(), payload: {} })
        }
        await chrome.storage.local.set({ ton_dapps: sonraki })
    } catch (e) {
        console.error('disconnectOrphanedTonSessions error:', e)
    }
}

export async function handleTonConnect(message, sender, sendResponse) {
    try {
        const request = message.params?.[0]
        const manifestUrl = request?.manifestUrl
        if (!manifestUrl || typeof manifestUrl !== 'string') {
            sendResponse({ result: connectError(BAD_REQUEST, 'manifestUrl is missing') })
            return
        }

        const { origin, hostname } = resolveSenderOrigin(sender)

        // HESAP KAPISI, MANIFEST INDIRMESINDEN ONCE (§8 R4 / adim 10). Sirasi
        // pazarlik konusu degil: manifest indirmesi bir AG TURUDUR ve hicbir
        // zaman baglanamayacak bir istek icin dis bir sunucuya gitmek, sayfaya
        // "bu URL ulasilabilir mi" diye soran bir ORACLE verir -- fetchManifest'in
        // kendi sema kontrolunun onlemek icin yazildigi seyin AYNISI -- ve
        // ustelik 8 saniyeye kadar bosuna bekler.
        //
        // FAIL-CLOSED: kanit yoksa TON yok. TON imzasi uretebildigini
        // KANITLAYAMAYAN bir hesap TonConnect oturumu ACAMAZ (§5'in tonSupported
        // kuralinin ayni yonu).
        //
        // 2026-09-11'DE DUZELTILDI. Burada `?.type !== 'ton'` yaziyordu ve o tur
        // artik HICBIR akis tarafindan uretilmiyor (R6): TonConnect cuzdanin
        // olusturabildigi HER hesapta oluydu -- kullanici hicbir sey reddetmeden
        // `code 300 / "User rejected the request"` aliyordu. Kapi artik TURE
        // degil YETENEGE bakiyor (`tonSignerReady`) ve `tonIdentityForAccount`in
        // kendi kapisiyla AYNI uc adimi kullaniyor. FAIL-CLOSED korunuyor:
        // dangling `tonFingerprint` tasiyan eski hibrit kayit hala REDDEDILIYOR.
        const { active_account, vaults } = await chrome.storage.local.get(['active_account', 'vaults'])
        if (!tonSignerReady(vaults, active_account)) {
            sendResponse({ result: connectError(USER_REJECTS, 'User rejected the request') })
            return
        }

        const fetched = await fetchManifest(manifestUrl)
        if (!fetched.ok) {
            sendResponse({ result: connectError(fetched.code, fetched.message) })
            return
        }

        const validated = validateManifest(fetched.raw, { manifestUrl, dappOrigin: origin })
        if (!validated.ok) {
            sendResponse({ result: connectError(validated.code, validated.message) })
            return
        }

        // ton_proof ISTEGI onay ekranina TASINIR: kullanici yalnizca adres mi
        // paylastigini, yoksa imza mi attigini bilmeli (tasarim belgesi 5.1).
        const proofItem = Array.isArray(request.items)
            ? request.items.find((i) => i && i.name === 'ton_proof')
            : null

        const { currentNetwork } = await chrome.storage.local.get('currentNetwork')

        const requestId = crypto.randomUUID()
        await openApprovalWindow(requestId, sendResponse, {
            type: 'TON_CONNECT',
            id: requestId,
            origin,
            hostname,
            favicon: sender.tab?.favIconUrl,
            manifest: validated.manifest,
            proofPayload: proofItem ? (proofItem.payload ?? '') : null,
            network: tonNetworkId(currentNetwork),
        })
    } catch (error) {
        console.error('handleTonConnect error:', error)
        sendResponse({ result: connectError(0, 'Internal error') })
    }
}

export async function handleTonRestore(message, sender, sendResponse) {
    try {
        const { hostname } = resolveSenderOrigin(sender)
        const { ton_dapps = {}, vaults = [] } = await chrome.storage.local.get(['ton_dapps', 'vaults'])
        const session = grantedTonSession(ton_dapps, hostname)

        if (!session) {
            sendResponse({ result: connectError(UNKNOWN_APP, 'No stored session for this app') })
            return
        }

        // HESAP KAPISI, DEPOLANAN YANITTAN ONCE (adim 10). Bu yol manifest
        // CEKMEZ, o yuzden kapinin yeri "fetch'ten once" degil "yanittan once".
        // Oturumun sabitlendigi hesap artik TON imzalayamiyorsa (eski hibrit
        // kayit ya da silinmis hesap), saklanan adresi geri vermek dapp'e
        // KULLANILAMAYAN bir baglanti gostermek olurdu: dapp bagli sanir, ilk
        // imza istegine kadar bunu ogrenemez. Cevap "oturum yok" ile AYNI --
        // dapp'in dogru tepkisi yeniden baglanmaktir.
        //
        // Kapi TURE degil YETENEGE bakar (bkz. handleTonConnect'teki ayni not,
        // 2026-09-11 duzeltmesi).
        if (!tonSignerReady(vaults, tonImzalayanHesap(vaults, session))) {
            sendResponse({ result: connectError(UNKNOWN_APP, 'No stored session for this app') })
            return
        }

        // KILIT SORULMAZ: adres aleni bir veri ve dapp bunu HER sayfa yuklemesinde
        // cagiriyor. Kilit istemek her TON dapp'ini acilista parola ekranina dusururdu.
        sendResponse({
            result: {
                event: 'connect',
                id: Date.now(),
                payload: {
                    items: [{
                        name: 'ton_addr',
                        address: session.address,
                        network: session.chain,
                        publicKey: session.publicKey,
                        walletStateInit: session.walletStateInit ?? '',
                    }],
                    // Kaynak tonConnectDevice.js (final inceleme K1): burada `features: []`
                    // sabit yazmak dapp'in SDK'sini sendTransaction/signData'yi
                    // WalletNotSupportFeatureError ile HIC bize sormadan reddetmesine
                    // yol aciyordu -- bkz. tonConnectDevice.js basindaki not.
                    device: tonConnectDeviceInfo(),
                },
            },
        })
    } catch (error) {
        console.error('handleTonRestore error:', error)
        sendResponse({ result: connectError(0, 'Internal error') })
    }
}

export async function handleTonSend(message, sender, sendResponse) {
    const appRequest = message.params?.[0] || {}
    const requestId = appRequest.id
    try {
        const { hostname } = resolveSenderOrigin(sender)
        const { ton_dapps = {}, vaults = [], active_account } = await chrome.storage.local.get(['ton_dapps', 'vaults', 'active_account'])

        if (appRequest.method === 'disconnect') {
            // OKU-DEGISTIR-YAZ yalnizca SILINECEK bir oturum GERCEKTEN VARSA
            // yapilir. Hostname icin kayit yoksa butun ton_dapps haritasini
            // GERI YAZMAK, TAM O ANDA onay ekranindan gelen bir putTonSession'i
            // (kullanici baglantiyi o an onayliyorken) EZEBILIR -- klasik
            // kayip-guncelleme yarisi (bkz. tonIdentity.js:ensureTonAddress'teki
            // ayni gerekce). Yaziya hic GEREK yoksa yazma.
            if (ton_dapps[hostname]) {
                await chrome.storage.local.set({ ton_dapps: removeTonSession(ton_dapps, hostname) })
            }
            sendResponse({ result: { result: {}, id: requestId } })
            return
        }

        // BILINMEYEN METOT, YETKI KAPISINDAN ONCE elenir: tanimadigimiz bir metot
        // yetkili bir dapp icin bile 100 (yetkisiz) degil 400 (desteklenmiyor)
        // olmali -- aksi halde hata mesaji "baglantiniz kesildi" gibi yanlis bir
        // sonuca isaret ederdi.
        if (appRequest.method !== 'sendTransaction' && appRequest.method !== 'signData') {
            sendResponse({ result: sendError(METHOD_NOT_SUPPORTED, 'Method not supported', requestId) })
            return
        }

        // YETKI KAPISI: imza isteyen her metot kayitli bir oturum GEREKTIRIR.
        // Aksi halde cuzdana hic baglanmamis bir sayfa imza penceresi actirabilir.
        const session = grantedTonSession(ton_dapps, hostname)
        if (!session) {
            sendResponse({ result: sendError(UNKNOWN_APP, 'App is not connected', requestId) })
            return
        }

        // HESAP KAPISI (adim 10). Oturum kapisi "bu site bagli mi" diye
        // soruyor; bu kapi "baglandigi hesap HALA imzalayabiliyor mu" diye.
        // Ikisi birbirini KAPSAMAZ ve bugun yalnizca birincisi vardi: eski
        // hibrit bir oturum onay penceresini ACIYOR, is icerideki
        // createTonKeyPair'da -- kullanici "Onayla"ya bastiktan SONRA --
        // eslenmemis bir hatayla oluyordu. Onay penceresi acmadan reddetmek,
        // "her redde sifir pencere" kuralinin geregi.
        //
        // Kapi TURE degil YETENEGE bakar (bkz. handleTonConnect'teki ayni not,
        // 2026-09-11 duzeltmesi).
        if (!tonSignerReady(vaults, tonImzalayanHesap(vaults, session, active_account))) {
            sendResponse({ result: sendError(UNKNOWN_APP, 'App is not connected', requestId) })
            return
        }

        if (appRequest.method === 'sendTransaction') {
            await handleTonSendTransaction({ appRequest, session, sender, hostname }, sendResponse)
        } else {
            await handleTonSignData({ appRequest, session, sender, hostname }, sendResponse)
        }
    } catch (error) {
        console.error('handleTonSend error:', error)
        sendResponse({ result: sendError(0, 'Internal error', requestId) })
    }
}

async function handleTonSendTransaction({ appRequest, session, sender, hostname }, sendResponse) {
    const { currentNetwork } = await chrome.storage.local.get('currentNetwork')
    const walletNetwork = tonNetworkId(currentNetwork)

    const validated = validateSendTransactionRequest(appRequest.params?.[0], {
        nowSec: Math.floor(Date.now() / 1000),
        walletNetwork,
    })
    if (!validated.ok) {
        sendResponse({ result: sendError(validated.code, validated.message, appRequest.id) })
        return
    }

    // `from` VERILMISSE oturumunkiyle AYNI olmali. Farkli bir adres, dapp'e hic
    // verilmemis bir hesaptan islem hazirlatmak demek (bolum 7.1).
    const raw = typeof appRequest.params?.[0] === 'string'
        ? JSON.parse(appRequest.params[0])
        : (appRequest.params?.[0] || {})
    if (raw.from && !grantedTonSession({ [hostname]: session }, hostname, raw.from)) {
        sendResponse({ result: sendError(UNKNOWN_APP, 'Requested address is not authorized for this app', appRequest.id) })
        return
    }

    const requestId = crypto.randomUUID()
    await openApprovalWindow(requestId, sendResponse, {
        type: 'TON_SEND_TX',
        id: requestId,
        // ORIGIN `sender`DAN, manifest'ten DEGIL (K5). Manifest'in `url` alanini
        // origin olarak kullanmak, tam da onlemeye calistigimiz kimlik taklidini
        // ekranin en ust satirina yazmak olurdu.
        origin: resolveSenderOrigin(sender).origin,
        hostname,
        favicon: sender.tab?.favIconUrl,
        manifest: session.manifest,
        from: session.address,
        // Onay ekraninin TON_DAPP_SEND'e geri gondermesi icin: hangi kasa hesabinin
        // imzalamasi gerektigini soyler. YALNIZCA KOLAYLIK -- gercek kilit
        // tonDappSend'deki `from` dogrulamasidir (imzalayanin adresi burasi DEGIL,
        // COZULEN anahtarla karsilastirilir); bu alan eksik/yanlis olsa bile o
        // dogrulama yine de yanlis hesabi durdurur.
        accountKey: session.accountKey,
        network: walletNetwork,
        validUntil: validated.validUntil,
        messages: validated.messages,
        appRequestId: appRequest.id,
    })
}

async function handleTonSignData({ appRequest, session, sender, hostname }, sendResponse) {
    const raw = typeof appRequest.params?.[0] === 'string'
        ? (() => { try { return JSON.parse(appRequest.params[0]) } catch (e) { return null } })()
        : appRequest.params?.[0]

    if (!raw || typeof raw !== 'object') {
        sendResponse({ result: sendError(BAD_REQUEST, 'Malformed signData params', appRequest.id) })
        return
    }

    // `from` VERILMISSE oturumunkiyle AYNI olmali (sendTransaction'daki AYNI kural,
    // bolum 7.1): farkli bir adres, dapp'e hic verilmemis bir hesaptan imza istemek demek.
    if (raw.from && !grantedTonSession({ [hostname]: session }, hostname, raw.from)) {
        sendResponse({ result: sendError(UNKNOWN_APP, 'Requested address is not authorized for this app', appRequest.id) })
        return
    }

    // Yuk TAMAMEN ekran ACILMADAN dogrulanir -- handleTonSendTransaction'daki AYNI
    // desen (validateSendTransactionRequest, yukarida): cozemeyecegimiz bir sey icin
    // kullaniciya onay ekrani gostermek, imzalanamayacak bir seyi onaylatmak olurdu.
    // Bos `text`, gecersiz base64 `binary`, ayristirilamayan `cell` -- hepsi burada,
    // onay ekrani hic acilmadan 1 (BAD_REQUEST) ile doner.
    //
    // addressHash SIFIR DOLGULU (gercek adres DEGIL): bu asamada kasa henuz
    // ACILMADI (anahtar yok, kilitli de olabilir) ve olmamali -- probe yukun
    // YAPISINI dogruluyor, imza URETMIYOR. Gercek adres yalnizca `tonDappSign`
    // (background.js, onaydan SONRA, kasa acikken) icinde bilinir. Sifir dolgu
    // 'cell' dalinda adresi hucreye GERCEKTEN gomdugu icin (storeAddress) donen
    // hash nihai imzada kullanilanla AYNI DEGIL -- bu FARKETMEZ, cunku bu deger
    // hicbir yere yazilmiyor/imzalanmiyor, yalnizca `ok`/`code` okunuyor. BURAYI
    // "gercek" bir adresle degistirmek kasayi kilit sormadan acmaya zorlar --
    // yapmayin.
    const probe = buildSignDataInput(raw, {
        workchain: 0,
        addressHash: new Uint8Array(32),
        domain: hostname,
        timestamp: Math.floor(Date.now() / 1000),
    })
    if (!probe.ok) {
        sendResponse({ result: sendError(probe.code, probe.message, appRequest.id) })
        return
    }

    const requestId = crypto.randomUUID()
    await openApprovalWindow(requestId, sendResponse, {
        type: 'TON_SIGN_DATA',
        id: requestId,
        // ORIGIN `sender`DAN, manifest'ten DEGIL (sendTransaction'daki AYNI kural, K5).
        origin: resolveSenderOrigin(sender).origin,
        hostname,
        favicon: sender.tab?.favIconUrl,
        manifest: session.manifest,
        from: session.address,
        // KAPSAM GENISLEMESI (kontrolor karari, gorev 13): handleTonSendTransaction'daki
        // AYNI alan, AYNI gerekce -- onay ekraninin TON_DAPP_SIGN'e geri gondermesi
        // icin hangi kasa hesabinin imzalamasi gerektigini soyler. YALNIZCA
        // KOLAYLIK -- gercek kilit tonDappSign'daki `from` dogrulamasidir (bkz.
        // background.js), bu alan eksik/yanlis olsa bile o dogrulama yine de
        // yanlis hesabi durdurur.
        accountKey: session.accountKey,
        payload: raw,
        appRequestId: appRequest.id,
    })
}
