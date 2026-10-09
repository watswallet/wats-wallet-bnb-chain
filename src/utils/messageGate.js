/**
 * Arka plan mesaj dagiticisinin KOKEN kapisi.
 *
 * KAPATTIGI ACIK:
 * content.js, sayfadan gelen mesajin payload'ini OLDUGU GIBI arka plana iletiyordu;
 * tek kontrol `event.data.target === 'wats_content_script'` idi, yani herhangi bir
 * sayfanin yazabilecegi duz bir metin. Arka plan dagitici ise
 * `action = message.method || message.type` diyor ve IC aksiyonlar (SIGN,
 * SEND_TRANSACTION, SEND_TON_TRANSACTION, SWAP, BRIDGE...) dapp metotlariyla AYNI
 * switch'te oturuyor. Isleyiciler `sender`i parametre olarak aliyor ama gövdelerinde
 * hic kullanmiyordu ve `createWalletInstance` yalnizca oturum anahtarina bakiyor.
 *
 * Sonuc: cuzdan kilidi acikken kullanicinin acik tuttugu HERHANGI bir site, tek bir
 * postMessage ile keyfi bir islemi imzalatip yayinlayabiliyordu - onay ekrani hic
 * acilmadan. Onay ekrani popup'ta yasiyor ve o mesaj zaten popup'in onaydan SONRA
 * gonderdigi mesaj.
 *
 * TASARIM KARARLARI:
 *
 * 1) RED LISTESI, izin listesi DEGIL. Kapi "bu ad bir ic aksiyon mu" diye sorar.
 *    Izin listesi yazilsaydi yarin eklenecek EIP-1193 metotlari (eth_accounts,
 *    wallet_switchEthereumChain, eth_signTypedData_v4) sessizce olurdu.
 *
 * 2) Ad NEREDEN geldigi onemli DEGIL. Dagitici `method || type` okudugu icin bir
 *    saldirgan ic aksiyon adini `type` yerine `method` alanina koyabilir. Bu yuzden
 *    "payload'da type varsa reddet" TEK BASINA YETMEZ; kapi ADIN KENDISINE bakar.
 *
 * 3) Iki katman. Arka plandaki kapi asil ve baglayici olandir (content.js atlansa
 *    bile calisir); content.js'teki fren, zararli payload'in service worker'a hic
 *    ulasmamasi icin ikinci katmandir.
 *
 * 4) Bu dosya SAFTIR: chrome API'si, ag, pinia yok. Hem popup hem service worker
 *    hem de vitest tarafindan ayni sekilde okunabilsin diye.
 */

// Yalnizca cuzdanin KENDI arayuzunden (eklenti kokeni) gelebilecek aksiyonlar.
// Hepsi `type` ile gonderilir ve gonderenleri dogrulandi: popup bilesenleri,
// popup/App.vue, popup/main.js ve popup'tan cagrilan utils. Hicbiri content
// script uzerinden gelmiyor, dolayisiyla bu kapi yanlis negatif uretmez.
export const INTERNAL_ACTIONS = new Set([
    'CHECK_UNLOCK',
    'UNLOCK_WALLET',
    'LOCK',
    'HEARTBEAT',
    'CHAIN_CHANGED',
    'ACCOUNT_CHANGED',
    'DISCONNECT_DAPP',
    // TON'un DISCONNECT_DAPP karsiligi: keyfi bir hostname alir ve o TON
    // oturumunu siler. Sayfadan gelebilseydi bir web sayfasi BASKA origin'lerin
    // TON baglantilarini kesebilirdi (kendi hostname'i disinda herhangi birini) --
    // DAPP_METHODS'a DEGIL buraya girer.
    'DISCONNECT_TON_DAPP',
    // DISCONNECT_TON_DAPP'in Solana karsiligi. FARKI: anahtar hostname degil TAM
    // ORIGIN (tasarim belgesi K5) -- ama tehlike AYNI: keyfi bir origin alir ve o
    // oturumu siler. DAPP_METHODS'a DEGIL buraya girer.
    'DISCONNECT_SOLANA_DAPP',
    // TON_CONNECT_IDENTITY'nin Solana karsiligi: kasayi ACAR (mnemonic -> ed25519
    // turetme) ve adres/publicKey doner. Bir web sayfasi bunu asla cagirabilmemeli.
    //
    // Bu iki ad, asagidaki background.js case'leriyle AYNI GOREVDE giriyor: bu
    // dosyanin senkron testi ("ic aksiyon listesindeki her ad background.js te
    // gercekten vardir") case'i olmayan bir ic aksiyon adini KIRMIZI yapar.
    // SOLANA_DAPP_SIGN_TX ve SOLANA_DAPP_SIGN_MESSAGE de kendi case'leriyle birlikte
    // M2/M3'te girer -- once ad, sonra case ASLA.
    'SOLANA_CONNECT_IDENTITY',
    'SWAP',
    'SWAP_QUOTE',
    'BRIDGE_QUOTE',
    'BRIDGE',
    'SIGN',
    // eth_signTypedData_v4 onay ekraninin imzalat aksiyonu (`personal_sign` icin `SIGN`in
    // ikizi). Kasayi ACAR ve imza uretir: sayfadan gelebilseydi kullanicinin hic gormedigi
    // bir yapilandirilmis veri imzalanirdi. Bu liste bir RED LISTESIDIR; ad background.js
    // teki `case` ile AYNI commit'te buraya girmek ZORUNDADIR.
    'SIGN_TYPED_DATA_CONFIRM',
    'SEND_TRANSACTION',
    'SEND_TON_TRANSACTION','SEND_TON_JETTON',
    'TON_FEE_IDENTITY',
    // Takasin role eylemini ONIZLEME icin uretir: kasayi acar (ed25519 acik
    // anahtar) ve zincirden jetton cuzdanini okur -- yani TON_FEE_IDENTITY ile
    // AYNI siniftan bir istek ve AYNI kapidan gecmeli.
    'TON_SWAP_FEE_ACTION',
    // TonConnect onay ekraninin kimlik kaynagi -- kasayi acar (createTonKeyPair),
    // raw adres/hex publicKey/walletStateInit doner. TON_FEE_IDENTITY'den AYRI:
    // o akis ucret onizlemesine ait ve ne raw adresi ne walletStateInit'i verir.
    // Bir web sayfasi bunu asla cagirabilmemeli -- DAPP_METHODS'a DEGIL, buraya girer.
    'TON_CONNECT_IDENTITY',
    // Solana aksiyonlari AYNI sinifa girer: ikisi de KASA ACAR (mnemonic'ten anahtar
    // turetme). Sayfadan gelebilselerdi SOLANA_SEND kullanicinin hic gormedigi bir
    // transferi imzalayip yayinlar, SOLANA_GET_ADDRESS ise gorunmeyen bir parola
    // istemi tetiklerdi - EVM tarafinda kapatilan acigin AYNISI.
    // Isleyicilerin kendi koken kontrolu (background.js) DURUYOR; bu kume onun yerine
    // gecmez, ustune biner. Asil kazanc senkron testi: switch'e yeni bir Solana
    // aksiyonu eklenip buraya yazilmazsa test kirilir - kapi sessizce delinemez.
    'SOLANA_GET_ADDRESS',
    'SOLANA_SEND',
    // Onay ekraninin imzalat-ve-yayinla aksiyonu. IC AKSIYON: sayfadan
    // gelebilseydi, kullanicinin hic gormedigi bir TON islemi imzalanip
    // yayinlanirdi -- EVM tarafinda kapatilan acigin AYNISI.
    'TON_DAPP_SEND',
    // Onay ekraninin imzalat aksiyonu (ton_proof + signData). TON_DAPP_SEND'in
    // ustundeki AYNI gerekce: sayfadan gelebilseydi, kullanicinin hic gormedigi
    // bir mesaj/kanit kasa acilarak imzalanirdi.
    'TON_DAPP_SIGN',
    // Kapat-yalniz onay ekraninin "kayit hala bir pencerede mi" sorusu. Bekleyen
    // isteklerin durumunu bir sayfa yoklayamamali.
    'TON_DAPP_REQUEST_STATE',
    // Solana onay ekraninin imzalat aksiyonu. TON_DAPP_SEND/TON_DAPP_SIGN ile
    // AYNI gerekce: kasayi ACAR ve sayfadan gelebilseydi kullanicinin hic
    // gormedigi bir Solana islemi imzalanip dapp'e teslim edilirdi.
    'SOLANA_DAPP_SIGN_TX',
    'GASLESS_TOKEN_OPTIONS',
    'ATS_FUEL_BALANCE',
    'ATS_FEE_QUOTE',
    'ATS_SWAP_FEE_QUOTE',
    'ATS_BRIDGE_FEE_QUOTE',
    'ATS_RUN_ONBOARDING',
    // ATS SATISI (spec docs/superpowers/specs/2026-10-04-ats-satin-alma-design.md §6.2).
    // ATS_SALE_EXECUTE kasayi ACAR ve kullanicinin USDT/USDC/BNB'sini harcayan bir op imzalayip
    // yayinlar -- sayfadan gelebilseydi kullanicinin hic gormedigi bir alim yapilirdi.
    // ATS_SALE_QUOTE yalniz okur ama ayni aileden: bir sayfa bizim adimiza teklif uretip
    // sunucunun hiz sinirini (IP basina dakikada 30) tuketemesin.
    'ATS_SALE_QUOTE',
    'ATS_SALE_EXECUTE',
    // Onay ekraninin imzalat aksiyonu (mesaj + SIWS). TON_DAPP_SIGN'in
    // ustundeki AYNI gerekce: sayfadan gelebilseydi kullanicinin hic gormedigi
    // bir mesaj kasa acilarak imzalanirdi.
    'SOLANA_DAPP_SIGN_MESSAGE',
    'CHECK_TX_STATUS',

    // Arayuz modu degistirme (yan panel <-> acilir pencere). Kapiya girmesi
    // SART: bu kume bir RED LISTESIDIR, burada olmayan ad kapidan GECER --
    // yani acik herhangi bir web sayfasi content.js uzerinden kullanicinin
    // arayuz modunu degistirebilirdi.
    //
    // Arka plandan ARAYUZE giden yayinlar (SW_READY) ve port uzerinden tasinan
    // sinyaller buraya YAZILMAZ: bu dosyanin senkron testi her ic aksiyon icin
    // background.js switch'inde bir `case` arar.
    'SET_UI_MODE',
])

// Sayfanin (dapp) mesru olarak cagirabildigi EIP-1193 metotlari. Bu kume yalnizca
// "switch'teki her ad siniflandirilmis mi" testini beslemek icin var — kapi bu
// listeye BAKMAZ, bilinmeyen bir metot da gecer (bkz. tasarim karari 1).
export const DAPP_METHODS = new Set([
    'eth_requestAccounts',
    'eth_accounts',
    'eth_sendTransaction',
    'personal_sign',
    // EIP-712 v4 (spec 6 G1). Bilgi amacli kume: kapi yine bu listeye BAKMAZ.
    'eth_signTypedData_v4',
    // EIP-2255 izinleri (spec 6 G3): wagmi disconnect'te `wallet_revokePermissions`i cagirir.
    // IKISI DE SAYFADAN gelir -> DAPP_METHODS, INTERNAL_ACTIONS DEGIL. `wallet_requestPermissions`
    // BILEREK yok ve case'siz: default: 4200 (wagmi o hatayi yutup eth_requestAccounts a gecer).
    'wallet_getPermissions',
    'wallet_revokePermissions',
    'eth_chainId',
    // EIP-3326 ag degistirme. IKISI DE SAYFADAN gelir, dolayisiyla DAPP_METHODS'a
    // girer -- INTERNAL_ACTIONS'a DEGIL. `wallet_addEthereumChain` bilerek
    // reddediliyor (4200) ama background.js'te bir `case`i oldugu icin burada da
    // siniflandirilmak ZORUNDA: siniflandirilmamis tek bir case testi kirar.
    'wallet_switchEthereumChain',
    'wallet_addEthereumChain',
    // TonConnect kopru metotlari. Kapi bir RED LISTESI oldugu icin bunlar zaten
    // geciyordu; kume "arka plandaki her case siniflandirilmis mi" testini besler.
    'tonconnect_connect',
    'tonconnect_restore',
    'tonconnect_send',
    // Solana Wallet Standard kopru metotlari. KUCUK HARF onekli olmalari
    // ZORUNLUDUR (tasarim belgesi 3.3): BUYUK_HARF bir ad sayfadan gelirse kapi
    // 'FORBIDDEN_ORIGIN' duz metnini dondurur, listede yoksa da "Unknown message
    // type" -- ikisi de dapp'in saglayicisinin tanidigi bir sekil DEGIL.
    'solana_connect',
    'solana_disconnect',
    'solana_signTransaction',
    'solana_signAndSendTransaction',
    'solana_signMessage',
    'solana_signIn',
])

// Popup'in arka plana "kullanici onayladi / reddetti" dedigi yanitlar. Bunlar switch'e
// GIRMEZ, dagiticinin basindaki `ignoredResponses` dalinda islenir - o yuzden ayri
// kume, ama AYNI kapidan gecerler.
//
// Neden onemli: resolvePendingRequest `status === 'success'` gorunce bekleyen dapp
// istegini cozer ve onay penceresini KAPATIR. Sayfa bunu taklit edebilirse kendi onay
// akisini atlatip kendine uydurma bir sonuc dondurebilir. Imza yolu kadar agir degil
// (para hareket etmiyor) ama bunlar da yalnizca cuzdanin kendi arayuzune aittir.
export const INTERNAL_RESPONSES = new Set([
    'SIGN_MESSAGE_SUCCESS',
    'SIGN_MESSAGE_REJECTED',
    'CONNECT_WALLET_SUCCESS',
    'CONNECT_WALLET_REJECTED',
    'SEND_TX_SUCCESS',
    'SEND_TX_REJECTED',
])

export function isInternalAction(action) {
    if (typeof action !== 'string') return false
    return INTERNAL_ACTIONS.has(action) || INTERNAL_RESPONSES.has(action)
}

/**
 * Arka plan dagiticisinin kapisi.
 * @returns {null|string} null ise mesaj islenebilir; 'internal-only' ise reddedilmeli.
 */
export function messageBlockReason(action, { fromWalletUi } = {}) {
    if (!isInternalAction(action)) return null
    return fromWalletUi ? null : 'internal-only'
}

/**
 * content.js'in kapisi: sayfadan gelen bir payload arka plana iletilebilir mi?
 *
 * Iki sey birden reddedilir: `type` tasiyan her payload (ic akislarin sekli) ve
 * `method` alanina ic aksiyon adi saklanmis payload (dagiticinin `method || type`
 * okumasindan dogan kacamak).
 */
export function isPagePayloadAllowed(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
    if ('type' in payload) return false
    return !isInternalAction(payload.method)
}

// Solana aksiyonlarinin TAM listesi -- SOLANA_ENABLED kapisinin okudugu kaynak
// (bkz. background.js dagiticisi ve utils/featureFlags.js).
//
// Liste ACIK yazildi ama tek basina birakilmadi: `solana_` oneki de kapatir.
// Sebep FAIL-CLOSED olmasi -- ileride eklenen bir `solana_signBlob` bu sete
// yazilmayi UNUTULURSA, onek kontrolu olmadan bayrak kapaliyken de ACIK kalirdi.
// Ters yon (yanlislikla EVM/TON aksiyonu kesmek) mumkun degil: hicbir EVM/TON
// aksiyonu bu onekle baslamiyor.
const SOLANA_ACTIONS = new Set([
    'SOLANA_GET_ADDRESS',
    'SOLANA_SEND',
    'SOLANA_CONNECT_IDENTITY',
    'SOLANA_DAPP_SIGN_MESSAGE',
    'SOLANA_DAPP_SIGN_TX',
    // Onekten DUSMEZ (DISCONNECT_ ile baslar): acikca yazilmali.
    'DISCONNECT_SOLANA_DAPP',
])

/**
 * Aksiyon Solana ozelligine mi ait?
 *
 * SAF: bayragi burada OKUMAZ. "Bu bir Solana aksiyonu mu" ile "Solana acik mi"
 * iki ayri sorudur; ikincisi cagiranin (dagitici) isidir ve boylece bu fonksiyon
 * bayraktan bagimsiz test edilebilir.
 */
export function isSolanaAction(action) {
    if (typeof action !== 'string') return false
    const a = action.trim()
    if (a.toLowerCase().startsWith('solana_')) return true
    return SOLANA_ACTIONS.has(a)
}
