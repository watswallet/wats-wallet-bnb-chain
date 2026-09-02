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
    'SEND_TRANSACTION',
    'SEND_TON_TRANSACTION','SEND_TON_JETTON',
    'TON_FEE_IDENTITY',
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
    'GASLESS_TOKEN_OPTIONS',
    'ATS_FUEL_BALANCE',
    'ATS_FEE_QUOTE',
    'ATS_SWAP_FEE_QUOTE',
    'ATS_BRIDGE_FEE_QUOTE',
    'ATS_RUN_ONBOARDING',
    'REVOKE_DELEGATION',
    'CHECK_TX_STATUS',
])

// Sayfanin (dapp) mesru olarak cagirabildigi EIP-1193 metotlari. Bu kume yalnizca
// "switch'teki her ad siniflandirilmis mi" testini beslemek icin var — kapi bu
// listeye BAKMAZ, bilinmeyen bir metot da gecer (bkz. tasarim karari 1).
export const DAPP_METHODS = new Set([
    'eth_requestAccounts',
    'eth_accounts',
    'eth_sendTransaction',
    'personal_sign',
    'eth_chainId',
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
