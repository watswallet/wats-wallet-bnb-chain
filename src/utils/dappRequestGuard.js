import { evmOnlyFeatures } from './evmGates'

/**
 * TonConnect istek tipleri. Bunlar aktif agdan BAGIMSIZ (tasarim belgesi K3):
 * `window.wats.tonconnect` ile `window.ethereum` ayri ad alanlaridir ve kullanici
 * Ethereum'da dururken de bir TON dapp'ine baglanabilir.
 *
 * Kume ACIKCA sayilir, "EVM tipi degilse TON'dur" DENMEZ: yarin eklenecek
 * uctuncu bir VM'in istegi sessizce bu muafiyete girmemeli.
 */
export const TON_REQUEST_TYPES = new Set(['TON_CONNECT', 'TON_SEND_TX', 'TON_SIGN_DATA'])

/**
 * Solana onay istek tipleri. TON kumesiyle AYNI gerekce (K6): oturum aktif agdan
 * BAGIMSIZ, `window.solana` ile `window.ethereum` ayri ad alanlaridir.
 *
 * AYRI kume, TON'unkinin genisletilmesi DEGIL: "EVM tipi degilse muaftir" demek,
 * yarin eklenecek dorduncu bir VM'in istegini sessizce bu muafiyete sokardi
 * (yukaridaki ayni not). Zincir kapilari (chainSupportsFlow / evmOnlyFeatures)
 * GENISLETILMEZ -- onlar "EIP-1193 burada calisir" diyor ve dogru soyluyorlar.
 */
export const SOLANA_REQUEST_TYPES = new Set(['SOLANA_CONNECT', 'SOLANA_SIGN_TX', 'SOLANA_SIGN_MESSAGE'])

/**
 * Ag degistirme istegi (EIP-3326). UCUNCU bir kume, yukaridakilerin
 * GENISLETILMESI DEGIL -- bu dosyanin kendi kurali (yukaridaki iki not) "EVM
 * tipi degilse muaftir" demeyi acikca yasakliyor.
 *
 * NEDEN MUAF: asagidaki `isDappRequestStale`in dayandigi degismez su ---
 * "istek var AMA aktif ag EVM degil" HER ZAMAN bayat bir kayittir, cunku boyle
 * bir istek hicbir zaman YENI yazilamazdi. `wallet_switchEthereumChain` bu
 * degismezi BILEREK bozar: "Solana'dasin, BSC'ye gec" tam da EVM DISI bir agda
 * dogan ve TAMAMEN GECERLI bir istektir. Muafiyet olmasaydi kayit popup acilir
 * acilmaz silinir, kullanici bos bir pencere gorur ve dapp'in promise'i sonsuza
 * asili kalirdi -- yani ozellik tam da en cok gerektigi durumda calismazdi.
 *
 * Tek eleman olsa da KUME: dorduncu bir tip eklendiginde onun da ayni soruyu
 * acikca cevaplamasi icin.
 */
export const SWITCH_CHAIN_REQUEST_TYPES = new Set(['SWITCH_CHAIN'])

/**
 * Baglanti istegi (EIP-1193 `eth_requestAccounts`). DORDUNCU kume -- yukaridaki
 * uclunun GENISLETILMESI DEGIL; bu dosyanin kendi kurali "EVM tipi degilse
 * muaftir" demeyi acikca yasakliyor ve buranin gerekcesi otekilerden AYRI.
 *
 * NEDEN MUAF: asagidaki `isDappRequestStale`in dayandigi degismez CONNECT icin
 * COKTU. "Istek var AMA aktif ag EVM degil" bir zamanlar HER ZAMAN bayat bir
 * kayitti, cunku handleConnectWallet boyle bir istegi giriste CHAIN_NOT_EVM ile
 * reddeder, kayit HIC YAZILMAZDI. Artik reddetmiyor: pencereyi ACIYOR.
 *
 * Neden degisti (kullanici bildirimi: "cuzdan en son gram aginda kalmissa dapp
 * ile evm'lere gecemiyor"): red DOGRUYDU ama SESSIZDI -- cuzdan hicbir sey
 * gostermiyordu ve kullanici sorunun aktif ag oldugunu hicbir yerden
 * ogrenemiyordu. Onay ekrani artik aciliyor ve CIKISI gosteriyor ("EVM agina gec
 * ve baglan", ConnectDapp.vue). Yani EVM disi bir agda dogan CONNECT kaydi artik
 * TAMAMEN GECERLI bir kullanici akisidir -- tipki SWITCH_CHAIN gibi.
 *
 * Bu satir olmasaydi degisiklik HICBIR ISE YARAMAZDI: kayit yazilir, pencere
 * acilir ve App.vue onu acilir acilmaz bayat sayip SILERDI -- kullanici bos bir
 * pencere gorur, dapp'in promise'i asili kalirdi.
 *
 * KARDESLERI (SEND_TX / SIGN_MESSAGE) BILEREK DISARIDA: onlarin ekranlari
 * (Dapp.vue / Sign.vue) EVM'e ozeldir ve arka plandaki kapilari HALA firlatiyor,
 * yani o tipte EVM disi agda dogmus bir kayit hala imkansizdir -- eski degismez
 * onlar icin AYNEN gecerli ve bayat sayilmalari DOGRU.
 */
export const CONNECT_REQUEST_TYPES = new Set(['CONNECT'])

/**
 * Bekleyen bir dapp istegi (`current_request`: CONNECT/SEND_TX/SIGN_MESSAGE) hala
 * GECERLI mi -- saf katman.
 *
 * KOK NEDEN (F5, kod incelemesi): `current_request` diskte KALICI ve onu temizleyen
 * TEK yer (`resolvePendingRequest`, dappFunctions.js) yalniz modul-kapsamli
 * `pendingRequests` Map'inde bir kayit VARSA calisir. Bu Map bir MV3
 * service-worker yeniden baslatilmasinda (uzanti guncellemesi, tarayici uyku
 * modu...) BOSALIR -- yani eski bir istek diskte kalabilir. App.vue bunu SADECE
 * `current_request.type`e bakarak yonlendiriyordu (chain kontrolu YOKTU) ve
 * Dapp.vue TAMAMEN EVM'e ozel (`currentNetwork.rpc[0].url` guard'siz okur, bkz.
 * Dapp.vue'daki not) -- aktif ag Solana'ysa bu TypeError'a duserdi, dapp onay
 * ekraninin TAM ORTASINDA.
 *
 * Bu istek zaten hicbir zaman Solana aktifken YENI YAZILAMAZDI (eth_requestAccounts/
 * eth_sendTransaction giriste requireEvmChain ile reddeder, bkz. dappFunctions.js);
 * yani "istek var AMA aktif ag EVM degil" durumu HER ZAMAN bayat/gecersiz bir
 * kayittir, gecerli bir kullanici akisi degil.
 */
export function isDappRequestStale(currentRequest, currentNetwork) {
    if (!currentRequest) return false
    // TIP once sorulur: EVM kapisi TON istegine hic UYGULANMAZ. Sira ters olsaydi
    // evmOnlyFeatures(TON).dapp === false, gecerli bir TON istegini bayat sayardi.
    if (TON_REQUEST_TYPES.has(currentRequest.type)) return false
    // TON satirindaki AYNI sira gerekcesi: TIP once sorulur. Bu satir olmadan
    // evmOnlyFeatures(Solana).dapp === false, GECERLI bir Solana onay kaydini
    // popup acilir acilmaz bayat sayip siler.
    if (SOLANA_REQUEST_TYPES.has(currentRequest.type)) return false
    // Ayni SIRA gerekcesi, ters yonden: bu istek EVM DISI bir agdayken dogar ve
    // gecerlidir. Satir kaldirilirsa evmOnlyFeatures(Solana/TON).dapp === false
    // onu bayat sayar ve ozellik en cok gerektigi yerde olur.
    if (SWITCH_CHAIN_REQUEST_TYPES.has(currentRequest.type)) return false
    // Ayni SIRA gerekcesi: TIP once sorulur. Bu istek EVM disi bir agda dogabilir
    // ve GECERLIDIR -- onay ekrani kullaniciya cikisi gosteriyor (yukaridaki
    // CONNECT_REQUEST_TYPES notu). Satir kaldirilirsa kayit popup acilir acilmaz
    // silinir ve ozellik tam da en cok gerektigi yerde olur.
    if (CONNECT_REQUEST_TYPES.has(currentRequest.type)) return false
    return !evmOnlyFeatures(currentNetwork).dapp
}
