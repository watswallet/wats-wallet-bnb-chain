// `wallet_switchEthereumChain` isteginin SAF karar katmani (EIP-3326).
//
// NEDEN AYRI DOSYA: bu uc karar -- (1) parametre bicimi gecerli mi, (2) istenen
// zincir bizde var mi, (3) zaten o agda miyiz -- hem service worker'da (istek
// geldiginde) hem de onay ekraninda (kullanici Onayla'ya bastiginda, ARADA gecen
// surede ag degismis olabilir) SORULMAK ZORUNDA. Ayni karari iki yerde ayri ayri
// yazmak, bu depoda daha once TON'un `deviceInfo`sunda uc kopyaya yol acti ve
// ikisi sessizce ayristi. Burasi tek kaynak.
//
// SAF: chrome'a, pinia'ya, aga DOKUNMAZ -- service worker'da da popup'ta da ayni
// sekilde calisir ve testten dogrudan cagrilir.

import { ALL_CHAINS } from '../data/chains'
import { isEvm } from './chainKind'
import { isSameChainId } from './vm'

/**
 * `current_request.type`. Kendi kumesinde tasiniyor cunku `dappRequestGuard.js`
 * bu tipi TON/SOLANA kumelerinin YANINA, UCUNCU bir kume olarak almak zorunda
 * (o dosyanin kendi kurali: "EVM tipi degilse muaftir" DENMEZ).
 */
export const SWITCH_CHAIN_TYPE = 'SWITCH_CHAIN'

/**
 * EIP-3326 `params`: `[{ chainId: '0x38' }]` -- 0x onekli, KUCUK harf, basinda
 * sifir OLMAYAN onaltilik bir metin.
 *
 * NEDEN BU KADAR SIKI: dapp'in gonderdigi metni `Number()`a verip gerisini
 * varsaymak bu depoda YASAKLI bir kalibin aynasi (background.js:1217, hex'i ham
 * degerden uretme yasagi). `Number('56')` da 56 dondurur -- yani 0x'siz bir metni
 * kabul etsek, '56' gonderen bir dapp Ethereum'un onaltilik 0x56'sini (86) degil
 * ondalik 56'yi (BSC) alirdi ve HANGISINI istedigini asla bilemezdik. Belirsizlik
 * sessizce cozulmez, -32602 ile reddedilir.
 *
 * @returns {number|null} zincir kimligi, bicim gecersizse null
 */
export function parseRequestedChainId(params) {
    const ham = Array.isArray(params) ? params[0]?.chainId : undefined
    if (typeof ham !== 'string') return null
    if (!/^0x[0-9a-fA-F]+$/.test(ham)) return null
    const sayi = Number.parseInt(ham, 16)
    if (!Number.isInteger(sayi) || sayi <= 0) return null
    return sayi
}

/**
 * Istenen zincirin BIZDEKI kaydi -- yoksa null (cagiran 4902 doner).
 *
 * IKI SORU BIRDEN, ve ikisi de gerekli:
 *   - `ALL_CHAINS` icinde var mi? `isSupportedChain` (store/network.js) bu soruyu
 *     cevaplar ama BIR EVM KAPISI DEGILDIR: TON (-239) ve Solana ('solana-mainnet')
 *     icin de true doner. Tek basina kullanilsaydi bir dapp `wallet_switchEthereumChain`
 *     ile cuzdani TON'a surukleyebilirdi.
 *   - EVM mi? `isEvm` bunu cevaplar ama "destekleniyor mu" sorusunu SORMAZ:
 *     chainKind.js bilinmeyen POZITIF bir sayiyi 'evm' sayar, yani tek basina
 *     kullanilsaydi listede olmayan her zincir gecerli gorunurdu.
 *
 * Karsilastirma `isSameChainId` ile: `getNetworkByChainId` katı `===` kullanir ve
 * kayitlardaki sayi ile gelen metni ESLESTIREMEZ (store/network.js:235).
 */
export function findSwitchTarget(chainId) {
    if (chainId === null || chainId === undefined) return null
    const kayit = ALL_CHAINS.find((c) => isSameChainId(c.chainId, chainId))
    if (!kayit || !isEvm(kayit)) return null
    return kayit
}

/**
 * Zaten istenen agda miyiz? EIP-3326 bu durumda da `null` donmeyi bekler; onay
 * penceresi ACMAK yanlis olurdu -- kullaniciya hicbir sey degistirmeyen bir soru
 * sorulmus olurdu. `currentNetwork` diske HIC yazilmamis olabilir (taze kurulum,
 * bkz. dappFunctions.js'teki F1 notu); o durumda "hayir" denir ve normal onay
 * yolu isler.
 */
export function alreadyOnChain(currentNetwork, chainId) {
    if (!currentNetwork?.chainId) return false
    return isSameChainId(currentNetwork.chainId, chainId)
}
