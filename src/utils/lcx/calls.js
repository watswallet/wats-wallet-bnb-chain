// LCX YURUTME CAGRILARI -- arka planin (Gorev 7) imzadan once kullandigi saf yardimcilar. Chrome ve depo yok; ag
// yalniz verilen saglayici uzerinden (token izni okumasi).
//
// Akis (background.js prepareLcxSwap): mesajdaki `lcxQuote` kullanicinin YAZDIGI takasla bire bir eslesmeli
// (assertLcxQuoteMatches) -> sunucudan build -> routerGuard dogrulamasi -> cagri listesi (buildLcxCalls). Bu dosyanin
// hicbir yolu yedege (bugunku takas motoruna) DUSMEZ: kullanici LCX fiyatini gordu, baska bir motorun fiyatiyla imza
// atilmaz. Her ret bir LcxExecError'dur ve arayuze ALTI koddan biriyle gider: LCX_EXEC_CODES'un dordu + LCX_SHARED_CODES'un
// ikisi (asagida). ONCHAIN_FAILED disindakilerin hepsi imzadan ONCEDIR; ONCHAIN_FAILED normal yolda onay islemi zincirde dustugunde.
//
// ONAY KURALI (Global Constraints): yalniz TAM TUTAR. MaxUint256 hicbir zaman uretilmez. Izin `>0 && <amountIn` ise
// once `approve(target, 0)` (USDT gibi sifirlanmadan degistirilemeyen tokenler).

import { Interface, getAddress } from 'ethers'
import { LCX_NATIVE, LcxTxMismatchError } from './routerGuard.js'
import { LcxRefusalError, LcxUnavailableError } from './client.js'
import { lcxMinOutFloor, isUserSlippageBps } from './mapQuote.js'

// LCX'e OZGU dort kod (arayuzun ayirt ettigi alti kodun dordu; kalan ikisi LCX_SHARED_CODES). Islem karti metinleri
// utils/txErrors.js TX_ERRORS'ta.
export const LCX_EXEC_CODES = Object.freeze(['LCX_REQUOTE', 'LCX_QUOTE_MISMATCH', 'LCX_TX_MISMATCH', 'LCX_UNAVAILABLE'])
// LCX yolunun da urettigi MEVCUT islem karti kodlari (TX_ERRORS'ta zaten var; yeni metin yok):
//   INSUFFICIENT_BALANCE -- imzadan once bakiye kapisi (executeSwap'in "Insufficient balance" kapisinin karsiligi).
//   ONCHAIN_FAILED       -- normal yolda onay islemi zincirde dustu (ucret yandi, takas gonderilmedi).
export const LCX_SHARED_CODES = Object.freeze(['INSUFFICIENT_BALANCE', 'ONCHAIN_FAILED'])
const CODE_SET = new Set([...LCX_EXEC_CODES, ...LCX_SHARED_CODES])

// Teklif suresi dolmus / fiyat kaymis: yeniden teklif almak cozer. `stale` ve `store_unavailable` SAVUNMA AMACLI listededir:
// LCX `store_unavailable`'i 503 ile belgeler (F7) ve sunucumuz 5xx'i 503 lcx_unavailable'a cevirir, yani belgelenen yolda bu kod
// LcxUnavailableError (LCX_UNAVAILABLE) olarak gelir; `stale` ise belgede bir hata kodu degil (teklifteki boolean alan, F6).
// Ama lcxController.interpret 400/409/410/422'de LCX'in HER `code`unu red olarak gecirir, yani bu iki kodun red olarak gelmesi
// sunucu tarafinda dislanmaz; gelirlerse yeni teklif istemek (imza yok) dogru tepkidir.
const REQUOTE_REFUSALS = new Set(['QUOTE_EXPIRED', 'price_moved', 'stale', 'store_unavailable'])

export class LcxExecError extends Error {
    /**
     * @param {'LCX_REQUOTE'|'LCX_QUOTE_MISMATCH'|'LCX_TX_MISMATCH'|'LCX_UNAVAILABLE'|'INSUFFICIENT_BALANCE'|'ONCHAIN_FAILED'} code
     * @param {{ field?: string, lcxCode?: string }} [extra] field: uyusmayan alan (yalniz TX_MISMATCH yanita yazilir);
     *   lcxCode: LCX'in red kodu (yalniz red kaynakli LCX_UNAVAILABLE yanita yazilir).
     */
    constructor(code, { field, lcxCode } = {}) {
        if (!CODE_SET.has(code)) throw new TypeError(`LcxExecError: bilinmeyen kod ${code}`)
        // Mesaj KODUN KENDISIDIR: kart metni koddan cevrilir (txErrors.js), ham cumle tasinmaz.
        super(code)
        this.name = 'LcxExecError'
        this.code = code
        if (field !== undefined) this.field = field
        if (lcxCode !== undefined) this.lcxCode = lcxCode
    }
}

/**
 * LCX kaynakli hatayi yurutme koduna cevirir; LCX'e ait olmayan hata icin null (cagiran oldugu gibi firlatir).
 * @returns {LcxExecError|null}
 */
export function toLcxExecError(err) {
    if (err instanceof LcxExecError) return err
    if (err instanceof LcxTxMismatchError) return new LcxExecError('LCX_TX_MISMATCH', { field: err.field })
    if (err instanceof LcxRefusalError) {
        return REQUOTE_REFUSALS.has(err.code)
            ? new LcxExecError('LCX_REQUOTE')
            : new LcxExecError('LCX_UNAVAILABLE', { lcxCode: err.code })
    }
    if (err instanceof LcxUnavailableError) return new LcxExecError('LCX_UNAVAILABLE')
    return null
}

/** Mesaj yaniti: `{ error, code }` (+ TX_MISMATCH'te `field`, red kaynakli UNAVAILABLE'da `lcxCode`). */
export function lcxErrorBody(e) {
    return {
        error: e.message,
        code: e.code,
        ...(e.code === 'LCX_TX_MISMATCH' && e.field !== undefined ? { field: e.field } : {}),
        ...(e.code === 'LCX_UNAVAILABLE' && e.lcxCode !== undefined ? { lcxCode: e.lcxCode } : {}),
    }
}

const KINDS = new Set(['swap', 'stable', 'rwa'])
const DECIMAL_RE = /^\d+$/
const VALUE_RE = /^(0x[0-9a-fA-F]+|[0-9]+)$/

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function sameAddress(a, b) {
    try {
        return getAddress(a) === getAddress(b)
    } catch {
        return false
    }
}

// Ham tutar: ondalik dizge ya da negatif olmayan bigint -> bigint; baska her sey null.
function rawOf(v) {
    if (typeof v === 'bigint') return v >= 0n ? v : null
    if (typeof v === 'string' && DECIMAL_RE.test(v)) return BigInt(v)
    return null
}

/**
 * Mesajdaki teklif kullanicinin YAZDIGI takasla eslesiyor mu? Istek tarafi arka planin mesajdan YENIDEN turettigi
 * degerlerdir (zincirden okunan ondalikla ham tutar, LCX bicimli adresler, bps kayma).
 *   - kind/quoteId/amountOut/minOut/expiresAt bicimi bozuk, ya da chainId, tokenIn, tokenOut, amountIn farkli:
 *     LCX_QUOTE_MISMATCH.
 *   - KAYMA (I1; teklifteki lcxSwapData ile AYNI kural, HER tur): teklifin (LCX'in uyguladigi) kaymasi en az 1 ve
 *     kullanicinin YURUTME ANINDAKI kaymasindan genis degil; degilse LCX_QUOTE_MISMATCH. Daha siki kayma takasi yalniz
 *     basarisiz kilabilir; esitlik istemek LCX'in stable varsayilani (30) yuzunden sonsuz "fiyat degisti" dongusu uretirdi.
 *   - ALT SINIR (C1; teklifle AYNI kural): minOut >= floor(amountOut * (10000 - kullanicinin kaymasi) / 10000), ikisi de > 0;
 *     degilse LCX_QUOTE_MISMATCH (field 'minOut'). Kurcalanmis / eski bir teklif routerGuard'a gevsek bir alt sinir tasiyamaz.
 *   - expiresAt * 1000 <= now: LCX_REQUOTE.
 * @param {object} lcxQuote  SWAP_QUOTE yanitindan arayuzun geri gonderdigi teklif
 * @param {{ chainId: number, tokenIn: string, tokenOut: string, amountIn: string|bigint, slippageBps: number }} sent
 * @param {number} now milisaniye (Date.now() biciminde); verilmezse TypeError (cagiran hatasi)
 * @throws {LcxExecError}
 */
export function assertLcxQuoteMatches(lcxQuote, { chainId, tokenIn, tokenOut, amountIn, slippageBps } = {}, now) {
    if (typeof now !== 'number' || !Number.isFinite(now)) throw new TypeError('assertLcxQuoteMatches: now (ms) gerekli')
    const mismatch = (field) => new LcxExecError('LCX_QUOTE_MISMATCH', { field })
    if (!isObject(lcxQuote)) throw mismatch('lcxQuote')
    const q = lcxQuote

    if (!KINDS.has(q.kind)) throw mismatch('kind')
    if (typeof q.quoteId !== 'string' || q.quoteId === '') throw mismatch('quoteId')
    if (!Number.isInteger(chainId) || q.chainId !== chainId) throw mismatch('chainId')
    if (!sameAddress(q.tokenIn, tokenIn)) throw mismatch('tokenIn')
    if (!sameAddress(q.tokenOut, tokenOut)) throw mismatch('tokenOut')

    const sentAmount = rawOf(amountIn)
    const quotedAmount = rawOf(q.amountIn)
    if (sentAmount === null || quotedAmount === null || sentAmount <= 0n || quotedAmount !== sentAmount) {
        throw mismatch('amountIn')
    }
    // Alt sinir sifir olamaz: sifir, imzalanacak islemde kayma korumasi olmamasi demektir.
    const minOut = rawOf(q.minOut)
    if (minOut === null || minOut <= 0n) throw mismatch('minOut')
    // Kullanicinin gordugu cikti: alt sinir buna gore kurulur.
    const amountOut = rawOf(q.amountOut)
    if (amountOut === null || amountOut <= 0n) throw mismatch('amountOut')

    // I1: tek kural, her tur. Kullanicinin kaymasi teklifteki gibi 1..9999 tam sayi olmali.
    if (!isUserSlippageBps(slippageBps) || !Number.isInteger(q.slippageBps) || q.slippageBps < 1) throw mismatch('slippageBps')
    if (q.slippageBps > slippageBps) throw mismatch('slippageBps')
    // C1: alt sinir kullanicinin YURUTME ANINDAKI kaymasina gore.
    if (minOut < lcxMinOutFloor(amountOut, slippageBps)) throw mismatch('minOut')

    if (!Number.isSafeInteger(q.expiresAt) || q.expiresAt <= 0) throw mismatch('expiresAt')
    if (q.expiresAt * 1000 <= now) throw new LcxExecError('LCX_REQUOTE')
}

const ERC20 = new Interface([
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
])

/**
 * Imzalanacak cagri listesi: gerekli onay(lar) + takas. Takas cagrisi `tx`ten aynen kurulur (cagiran routerGuard'dan
 * gecmis tx'i ve SABIT router adresini verir).
 *   native girdi            -> [takas]                       (izin okunmaz)
 *   izin >= amountIn        -> [takas]
 *   izin == 0               -> [approve(target, amountIn), takas]
 *   0 < izin < amountIn     -> [approve(target, 0), approve(target, amountIn), takas]
 * Izin ZINCIRDEN okunur (provider.call ile allowance(owner, target)); okunamazsa firlatir, cagri uretilmez.
 * @param {{ provider: { call: Function }, owner: string, tokenIn: string, amountIn: bigint, target: string,
 *   tx: { to: string, data: string, value: string|bigint } }} p  tokenIn LCX bicimi (native = sifir adres)
 * @returns {Promise<Array<{ to: string, value: bigint, data: string }>>}
 */
export async function buildLcxCalls({ provider, owner, tokenIn, amountIn, target, tx }) {
    if (typeof amountIn !== 'bigint' || amountIn <= 0n) throw new TypeError('buildLcxCalls: amountIn pozitif bigint olmali')
    const value = tx?.value
    if (typeof value !== 'bigint' && !(typeof value === 'string' && VALUE_RE.test(value))) {
        throw new TypeError('buildLcxCalls: tx.value gecersiz')
    }
    const swapCall = { to: tx.to, value: BigInt(value), data: tx.data }

    const token = getAddress(tokenIn)
    if (token === LCX_NATIVE) return [swapCall]

    const spender = getAddress(target)
    const raw = await provider.call({ to: token, data: ERC20.encodeFunctionData('allowance', [getAddress(owner), spender]) })
    const [allowance] = ERC20.decodeFunctionResult('allowance', raw)
    if (allowance >= amountIn) return [swapCall]

    const approve = (amount) => ({ to: token, value: 0n, data: ERC20.encodeFunctionData('approve', [spender, amount]) })
    return allowance === 0n ? [approve(amountIn), swapCall] : [approve(0n), approve(amountIn), swapCall]
}
