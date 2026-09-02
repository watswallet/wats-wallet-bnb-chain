// Swap ekraninin girdi tokeni ile AKTIF ZINCIR arasindaki uzlasma — saf katman.
//
// Iki kok neden buraya bakiyor:
//   1. Acilista token cozulemiyordu (bkz. nativeToken.js) ve sonuc SESSIZCE
//      `undefined` kaliyordu: buton bos, bakiye satiri dolu.
//   2. Ekranin ICINDE ag degistirilebiliyor (Swap.vue'daki ChangeNetwork);
//      applyNetworkChange inToken'i null yapiyor ve onMounted bir daha
//      calismadigi icin buton bosalip bakiye bayat kaliyordu.
// Ikisi de ayni soruyu soruyor: "bu zincirde girdi tokeni ne olmali".
//
// SINIFLANDIRMA BURADA DEGIL: `assetChain.js`'te. Ayni karari Gonder kapisi da
// veriyor; iki kopya ayrisirsa biri sessizce korumasiz kalir.

import { buildNativeToken } from './nativeToken'
import { classifyAssetChain } from './assetChain'

/**
 * @returns {{ token, reason }}
 *   reason null | 'seeded'          -> elde duran token gecerli
 *   'chain-suspect'                 -> token KORUNUR, yalnizca uyarilir (kesinlik yok)
 *   'chain-mismatch' | 'foreign-asset' | 'unsupported-chain' -> token DUSURULUR
 */
export function reconcileSwapToken(token, chainId) {
    const native = buildNativeToken(chainId)
    // Zincir cozulemedi: tohumlanacak bir varlik da yok. Sebep ADLANDIRILIR ki
    // ekran "token secin" yerine gercegi soyleyebilsin.
    if (native == null) return { token: null, reason: 'unsupported-chain' }

    if (token == null) return { token: native, reason: 'seeded' }

    const reason = classifyAssetChain(token, chainId)

    // SUPHE tokeni DUSURMEZ. Kesinlik yoksa kullanicinin secimini silmek, calisan
    // bir takasi oldurur (ayni adresi paylasan cok zincirli tokenler); uyarmak
    // hicbir seyi oldurmez.
    if (reason === 'chain-suspect') return { token, reason }

    // Swap TEK ZINCIRDE calisir (motor zincir basina kurulur); baska zincirin
    // tokeniyle teklif istemek gonderim aninda oluyor. Bridge'den ayrilan yer burasi.
    if (reason) return { token: null, reason }

    // Kullanicinin secimi tohum tarafindan ASLA ezilmez.
    return { token, reason: null }
}
