// Okuma gecidi POLITIKASI: hangi RPC yontemi iletilir, hangisi reddedilir -- SAF katman
// (ag yok, chrome yok). net_version BURADA YOK: T14b onu default: dalinda yerelde cevaplar.
//
// VARSAYILAN RED. Bir yontem yalniz asagidaki kumede TAM ESLESME ile bulunursa iletilir;
// geri kalan her sey 'deny'dir:
//   - eth_sign*, eth_signTransaction, eth_sendTransaction, personal_*, eth_signTypedData*
//   - eth_accounts / eth_coinbase / eth_requestAccounts (cuzdan anlamlari var; Gnosis
//     publicnode eth_accounts'ta GERCEK bir dugum adresi doner -- iletilirse dapp'e
//     kullanicinin olmayan bir adres soylenirdi)
//   - wallet_*, eth_subscribe ve TUM filtre yontemleri (filtre kimligi tek dugumde yasar,
//     yedek dugum farkli), debug_* / trace_* / txpool_* / admin_* / engine_* ...
//   - eth_sendRawTransaction: cuzdan, kullanicinin IP'sinden keyfi imzali islem yayinlayan
//     UI'siz bir roleye DONMESIN ("gecit salt-okunur" degismezi)
//   - eth_chainId: dagiticida zaten kendi `case`i var; buraya hic dusmez
//   - net_version: T14b default: dalinda siniflandirmadan ONCE yerelde cevaplar (ikinci gerceklemesi yok)
//
// NEDEN Set VE ONEK ESLESMESI YOK: duz nesne `{eth_call: true}[name]` aramasi `constructor`,
// `__proto__`, `hasOwnProperty` gibi adlari "var" saydirir ve reddi/izni atlatir. Ayrica
// ad BUYUK/KUCUK HARF DUYARLI ve tam eslesmedir: ' eth_call', 'ETH_CALL', 'eth_call' + NUL (bos karakter)
// hepsi 'deny'. Kumeler modul-ozeldir ve dondurulmustur; disariya yalniz dondurulmus DIZI
// kopyasi cikar (bir Set'i Object.freeze etmek add()'i ENGELLEMEZ, o yuzden kume hic
// disari verilmez).

const FORWARD = Object.freeze(
    new Set([
        'eth_blockNumber',
        'eth_gasPrice',
        'eth_maxPriorityFeePerGas',
        'eth_feeHistory',
        'eth_blobBaseFee',
        'eth_getBalance',
        'eth_getCode',
        'eth_getStorageAt',
        'eth_getTransactionCount',
        'eth_getTransactionByHash',
        'eth_getTransactionReceipt',
        'eth_getBlockByNumber',
        'eth_getBlockByHash',
        'eth_getBlockReceipts',
        'eth_getBlockTransactionCountByNumber',
        'eth_getBlockTransactionCountByHash',
        'eth_getTransactionByBlockHashAndIndex',
        'eth_getTransactionByBlockNumberAndIndex',
        'eth_getUncleCountByBlockNumber',
        'eth_getUncleCountByBlockHash',
        'eth_call',
        'eth_estimateGas',
        'eth_createAccessList',
        'eth_getLogs',
        'eth_getProof',
        'eth_syncing',
        'eth_protocolVersion',
        'net_listening',
        'web3_clientVersion',
        'web3_sha3',
    ])
)

// Pahali yontemler: kova agirligi 5 (digerleri 1).
const HEAVY = Object.freeze(
    new Set(['eth_getLogs', 'eth_call', 'eth_getProof', 'eth_getBlockReceipts', 'eth_createAccessList'])
)

export const HEAVY_METHOD_WEIGHT = 5

// Testler ve gozden gecirme icin dondurulmus KOPYALAR (kumeyi degistirmez).
export const FORWARD_METHODS = Object.freeze([...FORWARD])

// 'forward' | 'deny'
export function classifyRpcMethod(name) {
    if (typeof name !== 'string') return 'deny'
    if (FORWARD.has(name)) return 'forward'
    return 'deny'
}

// Kova agirligi (>= 1). Yalniz 'forward' yontemleri icin anlamlidir.
export function rpcMethodWeight(name) {
    return typeof name === 'string' && HEAVY.has(name) ? HEAVY_METHOD_WEIGHT : 1
}

// 4200 hatasi. Sayfanin verdigi ad mesaja yansir; bu yuzden SIRAYLA: (1) kontrol (Cc), gorunmez
// bicim (Cf: sifir-genislik, bidi gecersiz kilma) ve satir/paragraf ayirici (Zl, Zp) karakterleri
// atilir, (2) en cok 64 karakter (kod noktasi) tutulur (atma-sonra-kesme: kirli karakterler sinir
// payini yemesin), (3) ad bos kaldiysa, metin degilse veya "user rejected/denied/cancelled"
// benzeri bir ifade tasiyorsa 'unknown' yazilir. Sebep: AppKit "kullanici reddi"ni mesajdaki
// ifadeden de anlar; sayfa kendi sectigi bir adla bu cuzdanin hatasini kullanici reddi gibi
// gosterememeli (spec 9 madde 15). background.js'teki T14a yardimcisiyla DAVRANIS-OZDES IKI kopya
// vardir (T4b kesilebilir ve T14a'dan sonra iner; capraz ice aktarma YOK, patron karariyla KABUL
// EDILDI); parite T14b'deki ortak-vektor testiyle kilitlidir. Birini degistiren digerini de degistirir.
const UNSUPPORTED_METHOD_NAME_MAX = 64
const UNSUPPORTED_METHOD_UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu
const USER_REJECT_LOOKALIKE = /user[\s_-]*(rejected|denied|cancell?ed)/i

export function unsupportedMethodError(name) {
    let clean =
        typeof name === 'string'
            ? Array.from(name.replace(UNSUPPORTED_METHOD_UNSAFE, ''))
                  .slice(0, UNSUPPORTED_METHOD_NAME_MAX)
                  .join('')
            : ''
    if (!clean || USER_REJECT_LOOKALIKE.test(clean)) clean = 'unknown'
    return { code: 4200, message: `The method ${clean} is not supported by this wallet.` }
}
