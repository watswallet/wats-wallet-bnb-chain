import { describe, it, expect, vi } from 'vitest'
import { Interface, AbiCoder, MaxUint256, getAddress } from 'ethers'
import {
    assertLcxQuoteMatches,
    buildLcxCalls,
    toLcxExecError,
    lcxErrorBody,
    LcxExecError,
    LCX_EXEC_CODES,
    LCX_SHARED_CODES,
} from './calls.js'
import { LcxTxMismatchError, LCX_NATIVE, LCX_ROUTERS } from './routerGuard.js'
import { LcxRefusalError, LcxUnavailableError } from './client.js'
import { TX_ERRORS, resolveTxError } from '../txErrors.js'

// Bagimsiz kopya: modul yanlis ABI kullanirsa onay verisi degisir ve testler duser.
const erc20 = new Interface([
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
])
const coder = AbiCoder.defaultAbiCoder()

const ROUTER = LCX_ROUTERS[8453]
const USDC = getAddress('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
const WETH = getAddress('0x4200000000000000000000000000000000000006')
const OWNER = getAddress('0x3333333333333333333333333333333333333333')
const SWAP_DATA = '0xfc54261d' + '00'.repeat(32)
const MAX_HEX = MaxUint256.toString(16) // 64 x 'f'

// Sahte saglayici: yalniz `call` (allowance okumasi). Her cagri kaydedilir.
function fakeProvider(allowance) {
    const call = vi.fn(async () => coder.encode(['uint256'], [allowance]))
    return { call }
}

const swapTx = (value = '0') => ({ to: ROUTER, data: SWAP_DATA, value })

describe('buildLcxCalls', () => {
    it('native girdi: tek cagri (takas), value === amountIn, zincirden izin OKUNMAZ', async () => {
        const provider = fakeProvider(0n)
        const calls = await buildLcxCalls({
            provider, owner: OWNER, tokenIn: LCX_NATIVE, amountIn: 1000n, target: ROUTER, tx: swapTx('1000'),
        })
        expect(calls).toEqual([{ to: ROUTER, value: 1000n, data: SWAP_DATA }])
        expect(calls[0].value).toBe(1000n)
        expect(provider.call).not.toHaveBeenCalled()
    })

    it('izin yeterli (>= amountIn): onay yok, tek cagri; izin zincirden allowance(owner, target) ile okunur', async () => {
        const provider = fakeProvider(5n)
        const calls = await buildLcxCalls({
            provider, owner: OWNER, tokenIn: USDC, amountIn: 5n, target: ROUTER, tx: swapTx(),
        })
        expect(calls).toEqual([{ to: ROUTER, value: 0n, data: SWAP_DATA }])
        expect(provider.call).toHaveBeenCalledTimes(1)
        const [req] = provider.call.mock.calls[0]
        expect(getAddress(req.to)).toBe(USDC)
        expect(req.data).toBe(erc20.encodeFunctionData('allowance', [OWNER, ROUTER]))
    })

    it('izin 0: approve(target, amountIn) + takas', async () => {
        const calls = await buildLcxCalls({
            provider: fakeProvider(0n), owner: OWNER, tokenIn: USDC, amountIn: 2_000_000n, target: ROUTER, tx: swapTx(),
        })
        expect(calls).toEqual([
            { to: USDC, value: 0n, data: erc20.encodeFunctionData('approve', [ROUTER, 2_000_000n]) },
            { to: ROUTER, value: 0n, data: SWAP_DATA },
        ])
    })

    it('izin 1n, amountIn 5n: approve(target, 0), approve(target, 5n), takas', async () => {
        const calls = await buildLcxCalls({
            provider: fakeProvider(1n), owner: OWNER, tokenIn: USDC, amountIn: 5n, target: ROUTER, tx: swapTx(),
        })
        expect(calls).toEqual([
            { to: USDC, value: 0n, data: erc20.encodeFunctionData('approve', [ROUTER, 0n]) },
            { to: USDC, value: 0n, data: erc20.encodeFunctionData('approve', [ROUTER, 5n]) },
            { to: ROUTER, value: 0n, data: SWAP_DATA },
        ])
    })

    it('hicbir cagrida MaxUint256 yok (her izin durumunda)', async () => {
        for (const allowance of [0n, 1n, 4n, 5n, MaxUint256]) {
            const calls = await buildLcxCalls({
                provider: fakeProvider(allowance), owner: OWNER, tokenIn: USDC, amountIn: 5n, target: ROUTER, tx: swapTx(),
            })
            for (const c of calls) expect(c.data.toLowerCase()).not.toContain(MAX_HEX)
        }
    })

    it('onay hedefi checksum li; kucuk harfli token/hedef verilse de veri ayni', async () => {
        const calls = await buildLcxCalls({
            provider: fakeProvider(0n), owner: OWNER.toLowerCase(), tokenIn: USDC.toLowerCase(), amountIn: 7n,
            target: ROUTER.toLowerCase(), tx: swapTx(),
        })
        expect(calls[0]).toEqual({ to: USDC, value: 0n, data: erc20.encodeFunctionData('approve', [ROUTER, 7n]) })
    })

    it('izin okunamadi (bos yanit / RPC hatasi): firlatir, hic cagri uretilmez', async () => {
        await expect(buildLcxCalls({
            provider: { call: async () => '0x' }, owner: OWNER, tokenIn: USDC, amountIn: 5n, target: ROUTER, tx: swapTx(),
        })).rejects.toThrow()
        await expect(buildLcxCalls({
            provider: { call: async () => { throw new Error('rpc down') } }, owner: OWNER, tokenIn: USDC, amountIn: 5n, target: ROUTER, tx: swapTx(),
        })).rejects.toThrow('rpc down')
    })

    it('amountIn bigint ve > 0 olmali; bozuk tx.value reddedilir', async () => {
        const base = { provider: fakeProvider(0n), owner: OWNER, tokenIn: USDC, target: ROUTER, tx: swapTx() }
        for (const amountIn of [0n, -1n, '5', 5, undefined]) {
            await expect(buildLcxCalls({ ...base, amountIn })).rejects.toThrow(TypeError)
        }
        for (const value of ['', ' 1', '1.5', '-1', null, undefined]) {
            await expect(buildLcxCalls({ ...base, amountIn: 5n, tx: { ...swapTx(), value } })).rejects.toThrow(TypeError)
        }
    })
})

const NOW = 1_795_086_000_000
const QUOTE = Object.freeze({
    kind: 'swap',
    quoteId: 'q_abc',
    chainId: 8453,
    tokenIn: USDC,
    tokenOut: WETH,
    amountIn: '2000000',
    // Fikstur (quote-base-usdc-weth): minOut = floor(amountOut * 0.995), yani 50 bps'te tam sinir.
    amountOut: '1109639748685926',
    minOut: '1104091549942496',
    slippageBps: 50,
    expiresAt: NOW / 1000 + 60,
    spender: ROUTER,
})
const SENT = Object.freeze({ chainId: 8453, tokenIn: USDC, tokenOut: WETH, amountIn: '2000000', slippageBps: 50 })

function codeOf(fn) {
    try {
        fn()
    } catch (e) {
        expect(e).toBeInstanceOf(LcxExecError)
        return e.code
    }
    return null
}

describe('assertLcxQuoteMatches', () => {
    it('eslesen teklif: hata yok (amountIn bigint de olabilir)', () => {
        expect(() => assertLcxQuoteMatches(QUOTE, SENT, NOW)).not.toThrow()
        expect(() => assertLcxQuoteMatches(QUOTE, { ...SENT, amountIn: 2_000_000n }, NOW)).not.toThrow()
        // Adres yazimi (kucuk harf) uyusmazlik sayilmaz; deger farki sayilir.
        expect(() => assertLcxQuoteMatches(QUOTE, { ...SENT, tokenIn: USDC.toLowerCase() }, NOW)).not.toThrow()
    })

    it('istek tarafinda her alan tek tek degisince LCX_QUOTE_MISMATCH', () => {
        const changes = {
            chainId: 1,
            tokenIn: WETH,
            tokenOut: USDC,
            amountIn: '2000001',
            // Kullanici teklifin uyguladigindan (50) SIKI bir kayma istiyor: teklif onun onayladigindan gevsek.
            slippageBps: 49,
        }
        for (const [field, value] of Object.entries(changes)) {
            expect(codeOf(() => assertLcxQuoteMatches(QUOTE, { ...SENT, [field]: value }, NOW)), field).toBe('LCX_QUOTE_MISMATCH')
        }
    })

    it('teklif tarafinda her alan tek tek degisince (ya da bozulunca) LCX_QUOTE_MISMATCH', () => {
        const changes = {
            chainId: 56,
            tokenIn: WETH,
            tokenOut: USDC,
            amountIn: '1999999',
            // Teklifin kaymasi kullanicininkinden (50) GENIS.
            slippageBps: 51,
            kind: 'otc',
            quoteId: '',
            minOut: '0',
            amountOut: '0',
        }
        for (const [field, value] of Object.entries(changes)) {
            expect(codeOf(() => assertLcxQuoteMatches({ ...QUOTE, [field]: value }, SENT, NOW)), field).toBe('LCX_QUOTE_MISMATCH')
        }
        for (const field of ['kind', 'quoteId', 'chainId', 'tokenIn', 'tokenOut', 'amountIn', 'amountOut', 'minOut', 'slippageBps', 'expiresAt']) {
            const broken = { ...QUOTE }
            delete broken[field]
            expect(codeOf(() => assertLcxQuoteMatches(broken, SENT, NOW)), `${field} yok`).toBe('LCX_QUOTE_MISMATCH')
        }
        for (const bad of [null, undefined, 'q', 42, []]) {
            expect(codeOf(() => assertLcxQuoteMatches(bad, SENT, NOW))).toBe('LCX_QUOTE_MISMATCH')
        }
        // chainId dizge olarak gelirse esit sayilmaz.
        expect(codeOf(() => assertLcxQuoteMatches({ ...QUOTE, chainId: '8453' }, SENT, NOW))).toBe('LCX_QUOTE_MISMATCH')
        // Sifir tutar hicbir zaman eslesmez.
        expect(codeOf(() => assertLcxQuoteMatches({ ...QUOTE, amountIn: '0' }, { ...SENT, amountIn: '0' }, NOW))).toBe('LCX_QUOTE_MISMATCH')
    })

    it('kayma (I1, teklifle AYNI kural): HER turde teklifin kaymasi <= kullanicinin kaymasi ve >= 1', () => {
        for (const kind of ['swap', 'stable', 'rwa']) {
            // LCX stable varsayilani 30 (F3): kullanici 50 istedi -> daha siki, kabul (stable artik "fiyat degisti" dongusune girmez).
            expect(() => assertLcxQuoteMatches({ ...QUOTE, kind, slippageBps: 30 }, SENT, NOW), kind).not.toThrow()
            expect(() => assertLcxQuoteMatches({ ...QUOTE, kind, slippageBps: 50 }, SENT, NOW), kind).not.toThrow()
            expect(codeOf(() => assertLcxQuoteMatches({ ...QUOTE, kind, slippageBps: 51 }, SENT, NOW)), kind).toBe('LCX_QUOTE_MISMATCH')
            expect(codeOf(() => assertLcxQuoteMatches({ ...QUOTE, kind, slippageBps: 0 }, SENT, NOW)), kind).toBe('LCX_QUOTE_MISMATCH')
        }
        // Kullanicinin kaymasi gecersizse (tam sayi degil) eslesme yok.
        expect(codeOf(() => assertLcxQuoteMatches(QUOTE, { ...SENT, slippageBps: null }, NOW))).toBe('LCX_QUOTE_MISMATCH')
        expect(codeOf(() => assertLcxQuoteMatches(QUOTE, { ...SENT, slippageBps: 50.5 }, NOW))).toBe('LCX_QUOTE_MISMATCH')
    })

    it('alt sinir (C1): minOut >= floor(amountOut * (10000 - KULLANICININ bps i) / 10000); gevsek minOut imzaya gitmez', () => {
        const field = (fn) => {
            try {
                fn()
            } catch (e) {
                return e.field
            }
            return null
        }
        // minOut 1: kurcalanmis / eski bir teklif gevsek alt sinir tasiyamaz.
        for (const kind of ['swap', 'stable', 'rwa']) {
            expect(codeOf(() => assertLcxQuoteMatches({ ...QUOTE, kind, minOut: '1' }, SENT, NOW)), kind).toBe('LCX_QUOTE_MISMATCH')
            expect(field(() => assertLcxQuoteMatches({ ...QUOTE, kind, minOut: '1' }, SENT, NOW)), kind).toBe('minOut')
        }
        // Tam sinir gecer, bir alti gecmez (fikstur 50 bps'te tam sinirda).
        expect(() => assertLcxQuoteMatches(QUOTE, SENT, NOW)).not.toThrow()
        expect(codeOf(() => assertLcxQuoteMatches({ ...QUOTE, minOut: '1104091549942495' }, SENT, NOW))).toBe('LCX_QUOTE_MISMATCH')
        // Sinir YURUTME ANINDAKI kullanici kaymasiyla kurulur: 100 bps'te floor(amountOut * 0.99) = 1098543351199066 yeter.
        expect(() => assertLcxQuoteMatches({ ...QUOTE, minOut: '1098543351199066' }, { ...SENT, slippageBps: 100 }, NOW)).not.toThrow()
        expect(codeOf(() => assertLcxQuoteMatches({ ...QUOTE, minOut: '1098543351199065' }, { ...SENT, slippageBps: 100 }, NOW))).toBe('LCX_QUOTE_MISMATCH')
        // Ayni minOut, kullanici 50 bps'e donunce gevsek kalir.
        expect(codeOf(() => assertLcxQuoteMatches({ ...QUOTE, minOut: '1098543351199066' }, SENT, NOW))).toBe('LCX_QUOTE_MISMATCH')
        // amountOut yok / sifir / bozuk: sinir kurulamaz.
        for (const amountOut of [undefined, '0', '', '1.5', -1, 1109639748685926]) {
            expect(codeOf(() => assertLcxQuoteMatches({ ...QUOTE, amountOut }, SENT, NOW)), String(amountOut)).toBe('LCX_QUOTE_MISMATCH')
        }
    })

    it('expiresAt gecmis ya da tam simdi: LCX_REQUOTE; bir saniye sonrasi gecerli', () => {
        expect(codeOf(() => assertLcxQuoteMatches({ ...QUOTE, expiresAt: NOW / 1000 - 1 }, SENT, NOW))).toBe('LCX_REQUOTE')
        expect(codeOf(() => assertLcxQuoteMatches({ ...QUOTE, expiresAt: NOW / 1000 }, SENT, NOW))).toBe('LCX_REQUOTE')
        expect(() => assertLcxQuoteMatches({ ...QUOTE, expiresAt: NOW / 1000 + 1 }, SENT, NOW)).not.toThrow()
    })

    it('now verilmezse cagiran hatasi (TypeError): sessizce gecmez', () => {
        expect(() => assertLcxQuoteMatches(QUOTE, SENT)).toThrow(TypeError)
    })
})

describe('toLcxExecError / lcxErrorBody', () => {
    it('yeniden teklif gerektiren redler LCX_REQUOTE', () => {
        for (const code of ['QUOTE_EXPIRED', 'price_moved', 'stale', 'store_unavailable']) {
            const e = toLcxExecError(new LcxRefusalError(code))
            expect(e.code, code).toBe('LCX_REQUOTE')
            expect(lcxErrorBody(e)).toEqual({ error: 'LCX_REQUOTE', code: 'LCX_REQUOTE' })
        }
    })

    it('diger redler LCX_UNAVAILABLE + lcxCode; ulasilamazlik LCX_UNAVAILABLE', () => {
        const refused = toLcxExecError(new LcxRefusalError('use_rwa'))
        expect(lcxErrorBody(refused)).toEqual({ error: 'LCX_UNAVAILABLE', code: 'LCX_UNAVAILABLE', lcxCode: 'use_rwa' })
        const down = toLcxExecError(new LcxUnavailableError('timeout'))
        expect(lcxErrorBody(down)).toEqual({ error: 'LCX_UNAVAILABLE', code: 'LCX_UNAVAILABLE' })
    })

    it('dogrulayici uyusmazligi LCX_TX_MISMATCH + field', () => {
        const e = toLcxExecError(new LcxTxMismatchError('recipient'))
        expect(lcxErrorBody(e)).toEqual({ error: 'LCX_TX_MISMATCH', code: 'LCX_TX_MISMATCH', field: 'recipient' })
    })

    it('teklif uyusmazliginin yaniti field TASIMAZ; LcxExecError oldugu gibi gecer; baska hata null', () => {
        let caught
        try { assertLcxQuoteMatches({ ...QUOTE, amountIn: '1' }, SENT, NOW) } catch (e) { caught = e }
        expect(toLcxExecError(caught)).toBe(caught)
        expect(lcxErrorBody(caught)).toEqual({ error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH' })
        expect(toLcxExecError(new Error('boom'))).toBeNull()
        expect(toLcxExecError(undefined)).toBeNull()
    })

    it('dort kod da islem karti tablosunda (jenerik metne dusmez)', () => {
        expect(LCX_EXEC_CODES).toEqual(['LCX_REQUOTE', 'LCX_QUOTE_MISMATCH', 'LCX_TX_MISMATCH', 'LCX_UNAVAILABLE'])
        for (const code of LCX_EXEC_CODES) {
            expect(Object.prototype.hasOwnProperty.call(TX_ERRORS, code), code).toBe(true)
            expect(resolveTxError(code), code).not.toBe('transactionStatus.errors.generic')
        }
        expect(() => new LcxExecError('BASKA')).toThrow(TypeError)
    })

    it('ortak (mevcut) kodlar INSUFFICIENT_BALANCE ve ONCHAIN_FAILED kabul edilir, tabloda var, yanit { error, code }', () => {
        expect(LCX_SHARED_CODES).toEqual(['INSUFFICIENT_BALANCE', 'ONCHAIN_FAILED'])
        for (const code of LCX_SHARED_CODES) {
            const e = new LcxExecError(code)
            expect(lcxErrorBody(e)).toEqual({ error: code, code })
            expect(toLcxExecError(e)).toBe(e)
            expect(Object.prototype.hasOwnProperty.call(TX_ERRORS, code), code).toBe(true)
        }
    })
})
