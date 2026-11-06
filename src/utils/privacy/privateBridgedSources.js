import { getAddress } from 'ethers'

// Koprulu kaynaklar (BSC + USDC disindaki zincir/varliklar) YALNIZ Relay Depository rotasinda ACIK.
//
// Koprulu rotada deposit.to (islem hedefi VE izin spender'i) ile calldata sunucu cevabindan gelir. SilentSwap bir
// yonlendirici listesi yayimlamiyor; ama koprulu her teklifte `bridge.protocol` "relay" ve deposit.to Relay'in
// YAYIMLADIGI bir sozlesmedir (api.relay.link/chains). Iki sekil olculdu (2026-10-26, bos test adresiyle 24 teklif,
// imza ve para hareketi yok):
//  - RelayDepository (`protocol.v2.depository`): cagri `depositErc20(depositor, token, amount, id)` ya da
//    `depositNative(depositor, id)`. Dogrulanmis kaynakta depositErc20 YALNIZ msg.sender'dan `amount` ceker,
//    depositNative yalniz gonderilen value'yu alir; sozlesme proxy degildir. Calldata cozulup depositor, token ve
//    tutar istekle BIREBIR denetlenebilir: imzalanan cagri kartta gosterilen tutardan fazlasini hareket ettiremez.
//  - Relay yonlendiricisi (v3 erc20Router `multicall`, approvalProxy `transferAndMulticall`): cagri sunucunun
//    sectigi KEYFI bir cagri listesidir, icerigi denetlenemez. Bu rota KAPALI kalir.
// Asagidaki tablo yalniz Depository'ye giden (zincir, varlik) ikililerini acar; tabloda olmayan her ikili
// (BSC USDT/DAI/BNB, Depository olmayan zincirlerde DAI, Polygon POL) sunulmaz ve teklifte reddedilir
// (assertQuoteMatches 'bridged.route'). Rota sunucunun karari oldugu icin degisebilir: tablodaki bir ikili icin
// sunucu baska bir hedef donerse teklif 'bridge.to' ile reddedilir (fail-closed, para hareketi olmaz).
// Relay yeni bir Depository dagitirsa ya da SilentSwap rotayi degistirirse tablo yeniden olculur.
//
// NEDEN AYRI DOSYA: kapi yardimcilari (privateSourceSupported, privateAssetsFor, privateSourceChains) sabiti
// modul-ici degisken olarak okurdu ve testler acik durumu yardimcilara "bridgedOpen" argumani vererek sinardi:
// arka plan sinirindaki bir cagrinin dorduncu argumani kapiyi acabilirdi (T23 M1). Simdi sabiti okuyan HER yer
// (kapi yardimcilari silentswapConfig.js'te, assertQuoteMatches silentswap.js'te) onu BU modulden okur ve
// silentswapConfig.js onu yeniden disa aktarmaz (T26 M3: tek dikis). Testler yalniz bu modulu vi.mock'layarak
// sabiti degistirir, yardimcilarin imzasinda test deligi kalmaz.
export const PRIVATE_BRIDGED_SOURCES = true

// Relay Chains API `protocol.v2.depository` (2026-10-26). Mantle ve Cronos'ta adres farklidir.
const DEPOSITORY = '0x4cd00e387622c35bddb9b4c962c136462338bc31'
const DEPOSITORY_ALT = '0x59916da825d2d2ec1bf878d71c88826f6633ecca'

// Zincir -> Depository adresi ve o adrese giden (olculen) varliklar. Varlik adlari SDK kayit defterindeki sembollerdir.
const DEPOSITORY_ROUTES = Object.freeze({
    1: { depository: DEPOSITORY, assets: ['USDC', 'USDT', 'DAI', 'ETH'] },
    10: { depository: DEPOSITORY, assets: ['USDC', 'USDT', 'ETH'] },
    25: { depository: DEPOSITORY_ALT, assets: ['USDC'] },
    100: { depository: DEPOSITORY, assets: ['USDC'] },
    137: { depository: DEPOSITORY, assets: ['USDC', 'USDT'] },
    5000: { depository: DEPOSITORY_ALT, assets: ['USDC'] },
    8453: { depository: DEPOSITORY, assets: ['USDC', 'ETH'] },
    42161: { depository: DEPOSITORY, assets: ['USDC', 'USDT', 'ETH'] },
    42220: { depository: DEPOSITORY, assets: ['USDC'] },
})

/**
 * (zincir, varlik) Depository rotasindaysa o zincirin Depository adresi (checksum), degilse null.
 * Zincir sayisal dizge de olabilir; varlik birebir (buyuk/kucuk harf duyarli) aranir.
 */
export function bridgedDepositoryFor(chainId, asset) {
    const id = Number(chainId)
    if (!Number.isInteger(id) || !Object.hasOwn(DEPOSITORY_ROUTES, id)) return null
    const route = DEPOSITORY_ROUTES[id]
    return typeof asset === 'string' && route.assets.includes(asset) ? getAddress(route.depository) : null
}

// BIR AGIN GONDER KAYNAGI VAR MI (SDK'siz, saf): derleme kapisi (manifest.config.js, Node) bunu kullanir. Gonder kaynagi = o agdan
// Gizli siparise girebilen en az bir varlik: BSC'de dogrudan rota (USDC) ya da, sabit aciksa, Depository tablosunda satiri olan ag.
// privateAssetsFor(chain).length > 0 ile BIREBIR esit olmak zorundadir; esitligi privateFundDelivery.test.js on agin hepsinde kilitler
// (yeni ag eklenir ya da tablo degisirse iki taraf ayrisamaz). Kimlik KANONIK olmali: '56 ' gibi yazimlar false.
const DIRECT_SOURCE_CHAIN_ID = 56
const CANONICAL_ID_RE = /^[1-9]\d{0,14}$/
export function hasPrivateSendSource(chainId) {
    const id = typeof chainId === 'number' ? chainId : (typeof chainId === 'string' && CANONICAL_ID_RE.test(chainId) ? Number(chainId) : NaN)
    if (!Number.isSafeInteger(id) || id <= 0) return false
    if (id === DIRECT_SOURCE_CHAIN_ID) return true
    return PRIVATE_BRIDGED_SOURCES && Object.hasOwn(DEPOSITORY_ROUTES, id) && DEPOSITORY_ROUTES[id].assets.length > 0
}
