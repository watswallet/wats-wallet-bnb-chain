// Zincirin native varligi, AGA CIKMADAN token nesnesi olarak kurulur.
//
// Uzak `POST /getTokenByName` ad anahtarliydi ve ad UCUNCU TARAFIN (CoinGecko)
// mulkiyetinde: Polygon'da `nativeCurrency.name === "POL"`, DB kaydi ise
// "POL (ex-MATIC)" -> 404. Cagiran (Swap.vue/Bridge.vue) 404'te sessizce
// `undefined` yaziyordu; ekranda token butonu BOS, bakiye satiri ise DOLU
// gorunuyordu (useTokenBalance `undefined` adresi native sayiyor). Ayni uc
// 100/5000/25'te 200 ile YANLIS VARLIK (WXDAI) ya da BASKA ZINCIRIN ERC-20
// adresini donuyordu — yani basarili yanit da guvenilir degildi.
//
// Uretilen sekil `server/utils/chainTokens.js` icindeki `nativeTokenFor` ile
// BIREBIR aynidir; `../data/native_tokens.json` o dosyadaki `NATIVE_TOKENS`
// tablosunun aynasidir ve `nativeToken.test.js` (T5) esitligi kilitler. Iki taraf
// ayrisirsa ayni varlik listede ve butonda farkli gorunur. (Kimlik uzaylari ayrisan
// tek zincir Solana; orada satir hic uretilmez -- gerekce asagida.)
//
// AG YOK: bu dosya yalnizca pakete gomulu JSON okur. axios / pinia / chrome /
// ethers BILEREK import EDILMEZ — bagimsizligi testle (T6) korunur.

import supported_chains from '../data/supported_chains.json'
import native_tokens from '../data/native_tokens.json'

// KATI '0x0': swap.js:507 `isNativeToken` tam esitlik yapar (toLowerCase YOK),
// yani '0xEeee…' motor tarafindan native SAYILMAZ — teklif calisir ama gonderim
// ERC-20 sanip revert eder. swapTo.vue'daki dislama kiyasi da duz string esitligi.
export const NATIVE_TOKEN_ADDRESS = '0x0'

// SUNUCUNUN EVM DISI KIMLIKLERI BURAYA CEVRILMEZ. Sunucu EVM disi zincirleri
// negatif SAYISAL kimlikle adresler (TON -239, Solana -101; bkz.
// server/utils/chainTokens.js CHAINS). TON'da iki taraf AYNI kimligi tasidigi icin
// sorun yok. Solana'da tasimiyor: cuzdanin Solana kimligi bilerek sayiya
// CEVRILEMEYEN bir metindir ('solana-mainnet'), cunku EVM kimlik uzayiyla
// cakismamasi gerekiyor.
//
// Bir donem burada `SERVER_CHAIN_ID_ALIASES = new Map([[-101, 'solana']])` duruyordu
// (birlesme cozumu) ve -101 ile cagrildiginda TAM bir SOL satiri uretip satiri
// SUNUCUNUN kimligiyle damgaliyordu. OLCUM: isEvm(-101) === true,
// isSolana(-101) === false -- yani uretilen SOL satiri deponun TEK tip kapisindan
// EVM olarak geciyordu. Satiri 'solana-mainnet' ile damgalamak da cozmuyor: adres
// '0x0' kalir ve Solana tarafinda '0x0' bir SPL MINT'i sayilir (Token.vue/Send.vue
// `address || SOL_NATIVE_MARKER`), yani satir bu kez Solana kapisindan gecip YANLIS
// VARLIK olurdu.
//
// Karar FAIL-CLOSED: hicbir Solana kimligi (ne -101 ne 'solana-mainnet') buradan
// satir uretmez. Solana'nin native SOL'u '0x0' ile degil kendi isaretcisiyle
// (solana/constants.js SOL_NATIVE_MARKER) temsil ediliyor ve ZINCIRDEN okunuyor
// (composables/useSolanaAssets.js). Sunucu satiriyla arasindaki gorunur alan
// parligi (sembol/ad/gorsel) native_tokens.json uzerinden T5'te kilitli.

// Sunucudaki `cgImage` ile ayni turetme.
const cgImage = (large) => ({
    large,
    small: large.replace('/large/', '/small/'),
    thumb: large.replace('/large/', '/thumb/'),
})

/**
 * Aktif zincirin native varligini token bicimine cevirir.
 *
 * Cozulemeyen zincirde THROW ETMEZ, `null` doner: nativeChainInfo.js'ten kasitli
 * ayrisma. Orasi bir DOGRULAMA kapisi (yanlis zincirde islem kurmasin), burasi bir
 * UI VARSAYILANI — bilinmeyen bir zincir ekrani cokertemez, yalnizca "token secin"
 * durumuna dusurur.
 */
export function buildNativeToken(chainId) {
    // SAYISAL arama: Number('solana-mainnet') NaN'dir ve NaN === NaN false oldugu
    // icin Solana kaydi HICBIR kimlikle eslesmez -- yukaridaki fail-closed karari
    // tam olarak burada uygulanir.
    const entry = supported_chains.find((chain) => Number(chain.chainId) === Number(chainId))
    if (!entry) return null

    // Tabloda olmayan yeni bir zincir: zincirin KENDI nativeCurrency'si yedek.
    // logoURI BURADA, yalnizca tablo bos oldugunda kullanilir — birincil gorsel
    // YAPILAMAZ: 10/8453/42161'de logoURI Optimism/Base/Arbitrum ZINCIR logosudur,
    // varlik ise ETH. Bugun calisan uc zincirde gorunur regresyon olurdu.
    const meta = native_tokens[entry.nativeCoingeckoId] || {
        symbol: entry.nativeCurrency.symbol,
        name: entry.nativeCurrency.name,
        image_large: entry.logoURI || '/default-token.png',
    }

    return {
        address: NATIVE_TOKEN_ADDRESS,
        chain: entry.chainSlug,
        // "Tum Aglar" modunda satirin zincirini bilmek zorunlu: ETH ayni slug'la
        // dort zincirin native'i, bakiye anahtari ve gonderim zinciri buna bagli.
        // Kimlik HER ZAMAN KAYITTAN alinir, cagiranin verdiginden DEGIL: satirin
        // chainId'si, ait oldugu zincirin VM kapisindan ayni cevabi almak zorunda.
        chainId: Number(entry.chainId),
        coingecko_id: entry.nativeCoingeckoId,
        symbol: meta.symbol,
        name: meta.name,
        // `?? 18`: sema disi bir kayitta decimals eksik olsa da parseUnits patlamasin.
        decimals: Number(entry.nativeCurrency.decimals ?? 18),
        // image ASLA null/undefined olmaz: `token.image.large` guard'siz okunan
        // yerler var ve orada undefined bir TypeError demek.
        image: cgImage(meta.image_large),
        native: true,
    }
}
