// LCX takas islemi DOGRULAYICISI -- eklentinin son savunma hatti. Saf modul: ag yok, chrome yok.
//
// Sunucumuz LCX'in build cevabini `{ tx: { to, data, value }, approval }` diye aktarir; arka plan
// imzalamadan ONCE her tx'i buradan gecirir ve herhangi bir uyumsuzlukta imzalamaz. Sebep: tx'in
// icerigi bizim degil LCX'in (ve sunucumuzun) elinden geliyor; kullanicinin gordugu/onayladigi
// teklifle (token, miktar, alici, alt sinir) calldata'nin bire bir ayni oldugunu cihazda biz
// kanitlamaliyiz.
//
// Kabul edilen TEK router fonksiyonu swapSplit'tir. swapSplitAllowance ve permitBatchAndSwap
// Permit2 yoludur (0xfd0f402c / 0x6ae1838b): onay hedefi router degil Permit2 olurdu, reddedilir.
//
// Deadline kurali (F5): yalniz `now < deadline <= now + 3600`. LCX'in 300 sn kullandigi bir
// fikstur gozlemidir, sozlesme degil; 300'e ya da teklif zamanina cipalanmaz.

import { Interface, getAddress, isHexString } from 'ethers'
import { LCX_ROUTERS } from './routers.js'

// Router adresleri routers.js'te (tek kaynak; ATS komisyon manifestosu da oradan uretilir).
export { LCX_ROUTERS }

export const LCX_NATIVE = '0x0000000000000000000000000000000000000000'
export const SWAP_SPLIT_SELECTOR = '0xfc54261d'

const SWAP_SPLIT_ABI =
    'function swapSplit(address tokenIn, address tokenOut, uint256 totalIn, uint256 minAmountOut, address recipient, uint256 deadline, (uint256 amountIn, (uint8 family, address pool, address tokenIn, address tokenOut, uint256 aux)[] hops)[] legs) payable returns (uint256 amountOut)'

const iface = new Interface([SWAP_SPLIT_ABI])

// Bir teklifin gecerlilik ust siniri: imzalanan tx en fazla bu kadar sure sonra bile gecerli
// kalabilir (saniye).
const MAX_DEADLINE_AHEAD_SEC = 3600n

export class LcxTxMismatchError extends Error {
    constructor(field, detail) {
        super(`LCX islemi dogrulanamadi: ${field}${detail ? ` (${detail})` : ''}`)
        this.name = 'LcxTxMismatchError'
        this.code = 'LCX_TX_MISMATCH'
        this.field = field
    }
}

// Gecersiz adres (undefined, bozuk dizge, kotu checksum) false doner: kapali basarisizlik.
function sameAddress(a, b) {
    try {
        return getAddress(a) === getAddress(b)
    } catch {
        return false
    }
}

// tx.value: ondalik dizge ("1000") ya da 0x onekli hex; yoksa 0. Baska her sey gecersiz.
function parseValue(raw) {
    if (raw === undefined || raw === null) return 0n
    if (typeof raw === 'bigint') return raw >= 0n ? raw : null
    if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw >= 0 ? BigInt(raw) : null
    if (typeof raw === 'string' && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(raw)) return BigInt(raw)
    return null
}

/**
 * @param {{ chainId: number, tx: { to: string, data: string, value?: string },
 *   expect: { tokenIn: string, tokenOut: string, amountIn: bigint, minOut: bigint, recipient: string },
 *   now?: number }} p  `now` milisaniye (Date.now() biciminde).
 * @returns {{ minAmountOut: bigint }} calldata'daki gercek alt sinir (>= expect.minOut).
 * @throws {LcxTxMismatchError} herhangi bir alan uymazsa; `field` hangisi oldugunu soyler.
 */
export function verifyLcxSwapTx({ chainId, tx, expect, now = Date.now() }) {
    const router = LCX_ROUTERS[chainId]
    if (!router) throw new LcxTxMismatchError('chainId')
    if (!tx || typeof tx !== 'object') throw new LcxTxMismatchError('tx')
    if (!expect || typeof expect !== 'object') throw new LcxTxMismatchError('expect')

    if (!sameAddress(tx.to, router)) throw new LcxTxMismatchError('to')

    const data = tx.data
    if (typeof data !== 'string' || !isHexString(data) || data.length < 10) {
        throw new LcxTxMismatchError('data')
    }
    if (data.slice(0, 10).toLowerCase() !== SWAP_SPLIT_SELECTOR) {
        throw new LcxTxMismatchError('selector')
    }

    let d
    try {
        d = iface.decodeFunctionData('swapSplit', data)
        // KANONIK calldata: ethers fazladan bayti (sona eklenen, ofset boslugu) sessizce yutar; ayni
        // cozumu veren baska bir bayt dizisi imzalatilmasin diye yeniden kodlayip birebir esit mi bakilir.
        if (iface.encodeFunctionData('swapSplit', d).toLowerCase() !== data.toLowerCase()) {
            throw new LcxTxMismatchError('data')
        }
    } catch {
        throw new LcxTxMismatchError('data')
    }

    // Bacak toplami totalIn'e esit olmali (F5: uc fiksturde esit); eksik/fazla bolme mesru degil.
    let legsSum = 0n
    for (const leg of d.legs) legsSum += leg.amountIn
    if (legsSum !== d.totalIn) throw new LcxTxMismatchError('data')

    if (!sameAddress(d.recipient, expect.recipient)) throw new LcxTxMismatchError('recipient')
    if (!sameAddress(d.tokenIn, expect.tokenIn)) throw new LcxTxMismatchError('tokenIn')
    if (!sameAddress(d.tokenOut, expect.tokenOut)) throw new LcxTxMismatchError('tokenOut')
    // Beklenen degerler bigint olmali: undefined/null/dizge/negatif karsilastirmayi sessizce
    // gecirirdi (`x < undefined` false). Bozuk beklenti kapali basarisizlik sayilir.
    if (typeof expect.amountIn !== 'bigint' || expect.amountIn <= 0n || d.totalIn !== expect.amountIn) {
        throw new LcxTxMismatchError('amountIn')
    }
    if (typeof expect.minOut !== 'bigint' || expect.minOut < 0n || d.minAmountOut < expect.minOut) {
        throw new LcxTxMismatchError('minOut')
    }

    if (typeof now !== 'number' || !Number.isFinite(now)) throw new LcxTxMismatchError('deadline')
    // deadline tam sayi oldugundan `deadline > now/1000` ile `deadline > floor(now/1000)` ayni,
    // ust sinir icin de oyle: karsilastirma BigInt saniyede, kesirli ms yuzunden kaymaz.
    const nowSec = BigInt(Math.floor(now / 1000))
    if (d.deadline <= nowSec || d.deadline > nowSec + MAX_DEADLINE_AHEAD_SEC) {
        throw new LcxTxMismatchError('deadline')
    }

    // Native girdi: router msg.value ile ceker, tam amountIn gonderilmeli. ERC-20 girdi: hicbir
    // native deger gonderilmemeli (aksi halde fazlasi router'da kalir).
    const value = parseValue(tx.value)
    const nativeIn = sameAddress(d.tokenIn, LCX_NATIVE)
    if (value === null || value !== (nativeIn ? expect.amountIn : 0n)) {
        throw new LcxTxMismatchError('value')
    }

    return { minAmountOut: d.minAmountOut }
}

/**
 * ERC-20 onayinin hedefi: `build.approval?.target ?? quote.spender`. O agin router'i degilse
 * (Permit2 dahil) imzalanmaz.
 * @returns {string} checksum'li router adresi.
 */
export function approvalTargetFor({ chainId, build, quote }) {
    const router = LCX_ROUTERS[chainId]
    if (!router) throw new LcxTxMismatchError('chainId')
    const target = build?.approval?.target ?? quote?.spender
    if (!sameAddress(target, router)) throw new LcxTxMismatchError('approval')
    return router
}
