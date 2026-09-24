// Bir VARLIK KAYDI ile AKTIF ZINCIR arasindaki uzlasma — saf katman.
//
// Swap ve Gonder AYNI soruyu soruyor: "elimdeki kayit bu zincirde gecerli mi".
// Onceden yalniz Swap soruyordu (swapTokenState.js icinde, disa acilmadan) ve
// Gonder kapisi KORUMASIZDI: Home -> Token -> Gonder yolu kanonik kayittan gelen
// YABANCI ZINCIR adresini aktif zincirde kullaniyordu. Iki kapinin ayrisamamasi
// icin karar buraya tasindi.
//
// AG YOK, DEPO YOK: yalnizca pakete gomulu JSON okunur.
import { isNativeAsset } from './nativeAsset'
import { chainIdForSlug, isResolvableChainId, nativeOwnerChainIds } from './chainIdentity'
import { chainVm, isSameChainId } from './vm'
import supported_chains from '../data/supportedChains'

const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '')

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/

// Yalnizca `chainId` COZULEMEDIGINDE cagrilir; `chainId` varsa o TEK BELIRLEYICIDIR.
//
// DIKKAT — "ImportToken kayitlari chainId tasir" DIYE OKUMAYIN: ImportToken.vue kayda
// `chain` yazar, `chainId` YAZMAZ (kimlik yalnizca depo kovasinin anahtarinda).
// `/getTokenDataById` kaydi da chainId TASIMIYOR — olculdu: tether -> chain='ethereum',
// address=0xdac17f95…, chainId YOK, decimals YOK. Yani bu dal gercek bir yolda kosuyor.
function classifyWithoutChainId(token, active) {
    // (A) Kayit NATIVE oldugunu iddia ediyor (adres '0x0' / ZeroAddress / bos / 0xEeee…).
    // Boyle bir kayit YALNIZCA aktif zincirin native varligiysa dogrudur — tanim geregi.
    // Karsi ornegi yok: X zincirinin native bakiyesini Y varliginin etiketiyle
    // gostermek hicbir senaryoda dogru degil.
    if (isNativeAsset(token.address)) {
        const owners = nativeOwnerChainIds(token.coingecko_id)
        // isSameChainId: `owners` kaydin KENDI TIPINDEDIR (EVM->sayi, Solana->metin,
        // bkz. chainIdentity.js); `active` de artik hicbir Number() donusumunden
        // gecmiyor. Duz `.includes(active)` iki taraf tipçe uyusmadiginda (ör. "137"
        // ile 137) sessizce false donerdi.
        if (owners.some((o) => isSameChainId(o, active))) return null // ETH kaydi Base'de: MUAFIYET (zorunlu)
        if (owners.length > 0) return 'chain-mismatch'           // BNB kaydi Polygon'da: KESIN
        // 'bitcoin' / 'solana': hicbir desteklenen zincirin native'i degil.
        if (norm(token.coingecko_id)) return 'foreign-asset'
        return null                                              // id yok -> bilinmiyor -> muaf
    }

    // (B) ERC-20 bicimli adres.
    // Slug HIC yoksa muafiyet BIREBIR korunur.
    const slug = norm(token.chain)
    if (!slug) return null

    const slugId = chainIdForSlug(slug)
    if (slugId === null) {
        // Slug taninmiyor. Adres EVM bicimi bile DEGILSE (base58, ibc/…, 0x2::sui::SUI)
        // aktif zincirde kullanilmasi FIZIKSEN imkansiz; burada "bilmiyorum" demek yalan.
        if (!EVM_ADDRESS.test(norm(token.address))) return 'foreign-asset'

        // Taninmayan slug + EVM bicimli adres ('avalanche', 'zksync', ya da bir alias
        // yazim): BILEREK muaf. Tek yanlis pozitif vektoru burasi; en agir olcut yanlis
        // pozitif oldugu icin kapatilmiyor.
        return null
    }

    if (isSameChainId(slugId, active)) return null              // Home varsayilanlari (Tether@1, ATS@56)

    // Slug TANINAN bir zincire isaret ediyor ama AKTIF zincirden farkli. Iki
    // zincirin VM'i FARKLIYSA (biri EVM biri Solana) adres FORMATI diger zincirde
    // FIZIKSEN imkansizdir (hex 20 bayt <-> base58 32 bayt genel anahtar) — bu KESINDIR,
    // simetrik calisir: Solana slug'li kayit EVM aktifken de, EVM slug'li kayit Solana
    // aktifken de 'foreign-asset' doner (bkz. solanaChainRecord.test.js / assetChain.test.js).
    const slugChain = supported_chains.find((c) => isSameChainId(c.chainId, slugId))
    const activeChain = supported_chains.find((c) => isSameChainId(c.chainId, active))
    if (chainVm(slugChain) !== chainVm(activeChain)) return 'foreign-asset'

    // AYNI VM icindeki (iki EVM zinciri) durumda KESIN DEGIL, SUPHELI. Slug kaydin
    // ANA zincirini soyler; ayni ADRESIN baska bir desteklenen zincirde de gecerli
    // olmasi YAYGINDIR — depoda olculdu: 50 tokenin 7'si birden fazla desteklenen
    // zincirde AYNI adresi tasiyor (USDe 0x5d3a1ff2… 1/10/56/5000/42161'de, WETH
    // 0x4200…0006 10 ve 8453'te). Ayirt edecek alan (`contractAddresses`) CANLI
    // KAYITTA BOS — olculdu: /getTokenDataById 'tether' ve 'ethena-usde' icin 0
    // anahtar. Yani "bu adres aktif zincirde gecerli mi" sorusu bu katmanda
    // YANITLANAMIYOR.
    //
    // Bu yuzden dal YIKICI DEGIL: token KORUNUR, yalnizca uyari verilir. Yukaridaki
    // capraz-VM dali KESIN oldugu icin orada yikici davraniliyor.
    return 'chain-suspect'                                       // CAKE(56) @137 — muhtemelen yanlis
}

/**
 * @param {object|null} token  varlik kaydi
 * @param {number|string} chainId  AKTIF zincir
 * @returns {null|'chain-mismatch'|'chain-suspect'|'foreign-asset'}
 *   null            -> kayit aktif zincirde gecerli (ya da karar verilemiyor -> muaf)
 *   'chain-suspect' -> SUPHELI; cagiran token'i DUSURMEMELI, yalnizca uyarmali
 *   digerleri       -> KESIN yanlis
 */
export function classifyAssetChain(token, chainId) {
    if (token == null) return null

    // chainId ARTIK Number() ICINE SOKULMAZ. Eskiden `active = Number(chainId)`
    // vardi: Solana'nin kimligi METIN ('solana-mainnet') oldugu icin bu NaN
    // uretiyordu, `!Number.isFinite(active)` kapisi devreye girip Solana aktifken
    // HER varligi (EVM tokenleri DAHIL) sessizce muaf (null) sayiyordu — Gonder
    // kapisinin tum korumasi Solana secili oldugu surece etkisizdi. `chainId`
    // yalnizca bos/tanimsiz oldugunda elenir; geri kalan her deger asagida
    // isSameChainId ile kiyaslanir.
    if (chainId === null || chainId === undefined || chainId === '') return null
    const active = chainId

    // `Number.isFinite` TEK BASINA YETMEZ: Number(null) ve Number('') SIFIR doner ve
    // sonludur. Ag deposu daha yuklenmemisken (chainId null) kayit "zincir 0'da degil"
    // sayilip Gonder dugmesi sebepsiz kilitleniyordu — testle yakalandi.
    //
    // chainId BILINMIYOR demek YANLIS demek DEGILDIR: kanonik kayitlar ve ice
    // aktarilmis tokenler chainId TASIMIYOR, `Number(undefined) !== 137` her zaman
    // mismatch verirdi ve bugun CALISAN akislar kirilirdi.
    // `raw` tarafi: "SAYIYA CEVRILEBILIR mi" sorusu, "COZULEBILIYOR mu" sorusuyla
    // DEGISTIRILDI.
    //
    // Eskiden tek olcut `!Number.isFinite(Number(raw))` idi ve kendi chainId'si
    // 'solana-mainnet' OLAN bir kaydi "chainId'si yok" yoluna sokuyordu: kayit
    // kimligini ACIKCA soyluyorken karar slug/native tahminine birakiliyordu.
    // useSolanaAssets satirlarinda `chain` slug'i da YOK, yani o yol her SPL
    // kaydi icin "bilmiyorum -> muaf" donerdi.
    //
    // Sayiya cevrilemeyen ve DESTEKLENEN hicbir zincire de denk DUSMEYEN degerler
    // ('abc', NaN) eski yolunda BIRAKILIR — bu bilerek: o degerler bir kimlik
    // DEGIL, cozulememis bir alandir ve onlari 'chain-mismatch' saymak bugun
    // calisan (chainId tasimayan/bozuk kayitli) EVM akislarini kilitlerdi
    // (bkz. swapTokenState.test.js T11/T23).
    //
    // OLCUT PAYLASILIR (chainIdentity.isResolvableChainId): Token.vue AYNI soruyu
    // soruyor ve iki yer ayrisirsa ayni kayit bir ekranda gecerli, otekinde
    // gecersiz sayilir (kod incelemesi, Bulgu 4).
    if (!isResolvableChainId(token.chainId)) {
        return classifyWithoutChainId(token, active)
    }
    const raw = token.chainId

    return isSameChainId(raw, active) ? null : 'chain-mismatch'
}

/** Sebep KESIN mi (cagiran kaydi dusurebilir) yoksa SUPHELI mi (yalniz uyari). */
export const isCertainMismatch = (reason) => reason === 'chain-mismatch' || reason === 'foreign-asset'
