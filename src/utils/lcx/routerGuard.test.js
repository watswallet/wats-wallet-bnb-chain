import { describe, it, expect } from 'vitest'
import { Interface, getAddress } from 'ethers'
import {
    LCX_ROUTERS,
    LCX_NATIVE,
    SWAP_SPLIT_SELECTOR,
    LcxTxMismatchError,
    verifyLcxSwapTx,
    approvalTargetFor,
} from './routerGuard.js'
import buildEthUsdc from './fixtures/build-base-eth-usdc.json'
import buildUsdcWeth from './fixtures/build-base-usdc-weth.json'
import buildStable from './fixtures/stable-build-base-usdc-usdt.json'
import quoteEthUsdc from './fixtures/quote-base-eth-usdc.json'
import quoteUsdcWeth from './fixtures/quote-base-usdc-weth.json'
import quoteStable from './fixtures/stable-quote-base-usdc-usdt.json'

// Bagimsiz kopya: modul ABI'sini yanlis yazarsa secici degisir ve testler duser.
const SWAP_SPLIT_ABI =
    'function swapSplit(address tokenIn, address tokenOut, uint256 totalIn, uint256 minAmountOut, address recipient, uint256 deadline, (uint256 amountIn, (uint8 family, address pool, address tokenIn, address tokenOut, uint256 aux)[] hops)[] legs) payable returns (uint256 amountOut)'
const iface = new Interface([SWAP_SPLIT_ABI])

const ROUTER_A = '0x0000000000b1ae06c96aB73FF4360d7AeAaB56F0'
const ROUTER_B = '0x0000000000654902B6Ed6cC240cc81CB4c4a3dff'
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

const addr = (hex) => getAddress(hex.toLowerCase())
const USDC = addr('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
const WETH = addr('0x4200000000000000000000000000000000000006')
const OTHER_TOKEN = addr('0x1111111111111111111111111111111111111111')
const POOL = addr('0x2222222222222222222222222222222222222222')
const RECIPIENT = addr('0x3333333333333333333333333333333333333333')
const OTHER_RECIPIENT = addr('0x4444444444444444444444444444444444444444')

const NOW_SEC = 1_795_086_000
const NOW = NOW_SEC * 1000
const AMOUNT_IN = 2_000_000n
const MIN_OUT = 1_000n

function calldata(over = {}) {
    const a = {
        tokenIn: USDC,
        tokenOut: WETH,
        totalIn: AMOUNT_IN,
        minAmountOut: MIN_OUT,
        recipient: RECIPIENT,
        deadline: BigInt(NOW_SEC + 300),
        ...over,
    }
    const legs = a.legs ?? [
        {
            amountIn: a.totalIn,
            hops: [{ family: 2, pool: POOL, tokenIn: a.tokenIn, tokenOut: a.tokenOut, aux: 0n }],
        },
    ]
    return iface.encodeFunctionData('swapSplit', [
        a.tokenIn,
        a.tokenOut,
        a.totalIn,
        a.minAmountOut,
        a.recipient,
        a.deadline,
        legs,
    ])
}

function makeTx(opts = {}) {
    const { value = '0', data, over } = opts
    // 'to' acikca undefined verilebilsin diye varsayilan 'in' operatoruyle uygulanir.
    const to = 'to' in opts ? opts.to : ROUTER_A
    return { to, data: data ?? calldata(over), value }
}

const EXPECT = {
    tokenIn: USDC,
    tokenOut: WETH,
    amountIn: AMOUNT_IN,
    minOut: MIN_OUT,
    recipient: RECIPIENT,
}

function run(patch = {}) {
    // Anahtar varsa (undefined/null dahil) oldugu gibi gecer; yoksa varsayilan.
    const pick = (k, dflt) => (k in patch ? patch[k] : dflt)
    return verifyLcxSwapTx({
        chainId: pick('chainId', 8453),
        tx: pick('tx', makeTx()),
        expect: pick('expect', EXPECT),
        now: pick('now', NOW),
    })
}

function expectMismatch(fn, field) {
    let caught
    try {
        fn()
    } catch (e) {
        caught = e
    }
    expect(caught, `"${field}" icin hata beklendi`).toBeInstanceOf(LcxTxMismatchError)
    expect(caught).toBeInstanceOf(Error)
    expect(caught.code).toBe('LCX_TX_MISMATCH')
    expect(caught.field).toBe(field)
}

describe('sabitler', () => {
    it('router eslemesi: Global Constraints ile birebir, checksum li', () => {
        for (const id of [1, 8453, 42161, 10]) expect(LCX_ROUTERS[id]).toBe(ROUTER_A)
        for (const id of [56, 137, 100, 25]) expect(LCX_ROUTERS[id]).toBe(ROUTER_B)
        expect(Object.keys(LCX_ROUTERS).map(Number).sort((a, b) => a - b)).toEqual(
            [1, 56, 10, 137, 42161, 8453, 100, 25].sort((a, b) => a - b)
        )
        for (const v of Object.values(LCX_ROUTERS)) expect(getAddress(v)).toBe(v)
    })

    it('eslem donduruldu (calisma zamaninda degistirilemez)', () => {
        expect(Object.isFrozen(LCX_ROUTERS)).toBe(true)
    })

    it('native ve secici', () => {
        expect(LCX_NATIVE).toBe('0x0000000000000000000000000000000000000000')
        expect(SWAP_SPLIT_SELECTOR).toBe('0xfc54261d')
        expect(iface.getFunction('swapSplit').selector).toBe(SWAP_SPLIT_SELECTOR)
    })

    it('hata sinifi', () => {
        const e = new LcxTxMismatchError('to')
        expect(e).toBeInstanceOf(Error)
        expect(e.code).toBe('LCX_TX_MISMATCH')
        expect(e.field).toBe('to')
    })
})

describe('verifyLcxSwapTx: gecerli', () => {
    it('tum alanlar eslesir -> minAmountOut doner', () => {
        expect(run()).toEqual({ minAmountOut: MIN_OUT })
    })

    it('minAmountOut beklenenden buyukse de gecer ve gercek degeri doner', () => {
        const tx = makeTx({ over: { minAmountOut: MIN_OUT + 5n } })
        expect(run({ tx })).toEqual({ minAmountOut: MIN_OUT + 5n })
    })

    it('adresler kucuk harfle gelse de (LCX biçimi) eslesir', () => {
        const lower = {
            ...EXPECT,
            tokenIn: EXPECT.tokenIn.toLowerCase(),
            tokenOut: EXPECT.tokenOut.toLowerCase(),
            recipient: EXPECT.recipient.toLowerCase(),
        }
        const tx = makeTx({ to: ROUTER_A.toLowerCase() })
        expect(run({ tx, expect: lower })).toEqual({ minAmountOut: MIN_OUT })
    })

    it('her ag kendi router i ile gecer', () => {
        for (const [id, router] of Object.entries(LCX_ROUTERS)) {
            expect(run({ chainId: Number(id), tx: makeTx({ to: router }) })).toEqual({
                minAmountOut: MIN_OUT,
            })
        }
    })

    it('native girdi: value === amountIn gecer', () => {
        const over = { tokenIn: LCX_NATIVE }
        const exp = { ...EXPECT, tokenIn: LCX_NATIVE }
        const tx = makeTx({ over, value: AMOUNT_IN.toString() })
        expect(run({ tx, expect: exp })).toEqual({ minAmountOut: MIN_OUT })
    })

    it('ERC-20 girdi: value "0" gecer', () => {
        expect(run({ tx: makeTx({ value: '0' }) })).toEqual({ minAmountOut: MIN_OUT })
    })
})

describe('verifyLcxSwapTx: reddedilenler (her biri kendi field i ile)', () => {
    it('chainId 42220 -> chainId', () => {
        expectMismatch(() => run({ chainId: 42220 }), 'chainId')
    })

    it('to baska agin router i -> to', () => {
        expectMismatch(() => run({ tx: makeTx({ to: ROUTER_B }) }), 'to')
    })

    it('to rastgele adres / Permit2 / gecersiz -> to', () => {
        expectMismatch(() => run({ tx: makeTx({ to: OTHER_TOKEN }) }), 'to')
        expectMismatch(() => run({ tx: makeTx({ to: PERMIT2 }) }), 'to')
        expectMismatch(() => run({ tx: makeTx({ to: 'router' }) }), 'to')
        expectMismatch(() => run({ tx: makeTx({ to: undefined }) }), 'to')
    })

    it('secici swapSplitAllowance 0xfd0f402c -> selector', () => {
        const data = '0xfd0f402c' + '00'.repeat(32 * 8)
        expectMismatch(() => run({ tx: makeTx({ data }) }), 'selector')
    })

    it('secici permitBatchAndSwap 0x6ae1838b -> selector', () => {
        const data = '0x6ae1838b' + '00'.repeat(32 * 8)
        expectMismatch(() => run({ tx: makeTx({ data }) }), 'selector')
    })

    it('recipient farkli -> recipient', () => {
        const tx = makeTx({ over: { recipient: OTHER_RECIPIENT } })
        expectMismatch(() => run({ tx }), 'recipient')
    })

    it('tokenIn farkli -> tokenIn', () => {
        const tx = makeTx({ over: { tokenIn: OTHER_TOKEN } })
        expectMismatch(() => run({ tx }), 'tokenIn')
    })

    it('tokenOut farkli -> tokenOut', () => {
        const tx = makeTx({ over: { tokenOut: OTHER_TOKEN } })
        expectMismatch(() => run({ tx }), 'tokenOut')
    })

    it('tokenOut sifir adres beklenmezken -> tokenOut (ozel durum yok)', () => {
        const tx = makeTx({ over: { tokenOut: LCX_NATIVE } })
        expectMismatch(() => run({ tx }), 'tokenOut')
    })

    it('totalIn !== amountIn -> amountIn (fazla ve eksik)', () => {
        expectMismatch(() => run({ tx: makeTx({ over: { totalIn: AMOUNT_IN + 1n } }) }), 'amountIn')
        expectMismatch(() => run({ tx: makeTx({ over: { totalIn: AMOUNT_IN - 1n } }) }), 'amountIn')
    })

    it('minAmountOut < expect.minOut -> minOut', () => {
        const tx = makeTx({ over: { minAmountOut: MIN_OUT - 1n } })
        expectMismatch(() => run({ tx }), 'minOut')
    })

    it('deadline gecmis ya da simdiye esit -> deadline', () => {
        expectMismatch(
            () => run({ tx: makeTx({ over: { deadline: BigInt(NOW_SEC) } }) }),
            'deadline'
        )
        expectMismatch(
            () => run({ tx: makeTx({ over: { deadline: BigInt(NOW_SEC - 1) } }) }),
            'deadline'
        )
    })

    it('deadline now + 3600 sn den uzak -> deadline', () => {
        expectMismatch(
            () => run({ tx: makeTx({ over: { deadline: BigInt(NOW_SEC + 3601) } }) }),
            'deadline'
        )
    })

    it('deadline sinirlari: (now, now + 3600] araligi gecer', () => {
        expect(() => run({ tx: makeTx({ over: { deadline: BigInt(NOW_SEC + 1) } }) })).not.toThrow()
        expect(() =>
            run({ tx: makeTx({ over: { deadline: BigInt(NOW_SEC + 3600) } }) })
        ).not.toThrow()
    })

    it('deadline: now ms kesirli olsa da saniye karsilastirmasi bozulmaz', () => {
        // now = 1795086000.999 sn: deadline = 1795086000 hala gecmis.
        expectMismatch(
            () => run({ now: NOW + 999, tx: makeTx({ over: { deadline: BigInt(NOW_SEC) } }) }),
            'deadline'
        )
        // 1795086001 > 1795086000.999 -> gecer.
        expect(() =>
            run({ now: NOW + 999, tx: makeTx({ over: { deadline: BigInt(NOW_SEC + 1) } }) })
        ).not.toThrow()
    })

    it('deadline 300 sn e bagli degil: 1800 sn de gecer (F5)', () => {
        expect(() =>
            run({ tx: makeTx({ over: { deadline: BigInt(NOW_SEC + 1800) } }) })
        ).not.toThrow()
    })

    it('now sayi degilse kapali basarisiz -> deadline', () => {
        expectMismatch(() => run({ now: Number.NaN }), 'deadline')
    })

    it('native girdide value !== amountIn -> value (eksik, fazla, sifir)', () => {
        const over = { tokenIn: LCX_NATIVE }
        const exp = { ...EXPECT, tokenIn: LCX_NATIVE }
        for (const value of [(AMOUNT_IN - 1n).toString(), (AMOUNT_IN + 1n).toString(), '0']) {
            expectMismatch(() => run({ tx: makeTx({ over, value }), expect: exp }), 'value')
        }
    })

    it('ERC-20 girdide value sifir degil -> value', () => {
        expectMismatch(() => run({ tx: makeTx({ value: '1' }) }), 'value')
        expectMismatch(() => run({ tx: makeTx({ value: AMOUNT_IN.toString() }) }), 'value')
    })

    it('value sayiya cevrilemiyorsa -> value', () => {
        expectMismatch(() => run({ tx: makeTx({ value: 'abc' }) }), 'value')
        expectMismatch(() => run({ tx: makeTx({ value: '1.5' }) }), 'value')
    })

    it('data cozulemiyor -> data', () => {
        const trunc = SWAP_SPLIT_SELECTOR + 'ab'.repeat(10)
        expectMismatch(() => run({ tx: makeTx({ data: trunc }) }), 'data')
        expectMismatch(() => run({ tx: makeTx({ data: SWAP_SPLIT_SELECTOR }) }), 'data')
        expectMismatch(() => run({ tx: makeTx({ data: '0x' }) }), 'data')
        expectMismatch(() => run({ tx: makeTx({ data: 'zz-not-hex' }) }), 'data')
        expectMismatch(() => run({ tx: { to: ROUTER_A, data: undefined, value: '0' } }), 'data')
    })

    it('tx yok -> hata (sessizce gecmez)', () => {
        expect(() => run({ tx: null })).toThrow(LcxTxMismatchError)
        expect(() => run({ tx: undefined })).toThrow(LcxTxMismatchError)
    })

    it('expect adresi gecersizse kapali basarisiz', () => {
        expectMismatch(() => run({ expect: { ...EXPECT, recipient: 'nope' } }), 'recipient')
        expectMismatch(() => run({ expect: { ...EXPECT, tokenIn: undefined } }), 'tokenIn')
    })

    // Bozuk beklenti kapali basarisiz olmali: `x < undefined` / `x < 'abc'` / `x < -1n` karsilastirmasi
    // sessizce gecerdi (gercek USDC->WETH fiksturunde dogrulandi).
    it('expect.minOut bigint degilse ya da negatifse -> minOut', () => {
        for (const bad of [undefined, null, 'abc', '1000', 1000, -1n, {}]) {
            expectMismatch(() => run({ expect: { ...EXPECT, minOut: bad } }), 'minOut')
        }
        // 0n gecerli bir alt sinir (sinir degeri).
        expect(run({ expect: { ...EXPECT, minOut: 0n } })).toEqual({ minAmountOut: MIN_OUT })
    })

    it('expect.amountIn bigint degilse ya da pozitif degilse -> amountIn', () => {
        for (const bad of [undefined, null, 'abc', '2000000', 2_000_000, 0n, -1n, {}]) {
            expectMismatch(() => run({ expect: { ...EXPECT, amountIn: bad } }), 'amountIn')
        }
    })

    it('expect.minOut/amountIn eksik (alan hic yok) -> kapali basarisiz', () => {
        const { minOut, ...noMinOut } = EXPECT
        const { amountIn, ...noAmountIn } = EXPECT
        expectMismatch(() => run({ expect: noMinOut }), 'minOut')
        expectMismatch(() => run({ expect: noAmountIn }), 'amountIn')
    })
})

describe('verifyLcxSwapTx: kanonik calldata ve bacak toplami', () => {
    const goodData = () => calldata()

    it('calldata sonuna bayt eklenirse -> data', () => {
        expectMismatch(() => run({ tx: makeTx({ data: goodData() + 'deadbeef' }) }), 'data')
        expectMismatch(() => run({ tx: makeTx({ data: goodData() + '00'.repeat(32) }) }), 'data')
    })

    it('ofset boslugu (cozum ayni, bayt dizisi farkli) -> data', () => {
        // legs'in ofsetini (7. kelime) 32 artirip basliktan sonra 32 sifir bayt ekle: Solidity ve
        // ethers ayni degerleri cozer, ama kanonik kodlama degildir.
        const body = goodData().slice(10)
        const head = body.slice(0, 7 * 64)
        const tail = body.slice(7 * 64)
        const off = BigInt('0x' + head.slice(6 * 64, 7 * 64))
        const data =
            SWAP_SPLIT_SELECTOR +
            head.slice(0, 6 * 64) +
            (off + 32n).toString(16).padStart(64, '0') +
            '00'.repeat(32) +
            tail
        // Test anlamli olsun: bu bayt dizisi gercekten cozuluyor ve degerler ayni.
        const decoded = iface.decodeFunctionData('swapSplit', data)
        expect(decoded.totalIn).toBe(AMOUNT_IN)
        expect(decoded.recipient).toBe(RECIPIENT)
        expectMismatch(() => run({ tx: makeTx({ data }) }), 'data')
    })

    it('onaltilik harf boyutu fark etmez: buyuk harfli calldata gecer', () => {
        const upper = '0x' + goodData().slice(2).toUpperCase()
        expect(run({ tx: makeTx({ data: upper }) })).toEqual({ minAmountOut: MIN_OUT })
    })

    it('bacak toplami totalIn - 1 -> data', () => {
        const legs = [
            {
                amountIn: AMOUNT_IN - 1n,
                hops: [{ family: 2, pool: POOL, tokenIn: USDC, tokenOut: WETH, aux: 0n }],
            },
        ]
        expectMismatch(() => run({ tx: makeTx({ over: { legs } }) }), 'data')
    })

    it('bacak toplami totalIn + 1 ve bacaksiz -> data', () => {
        const hops = [{ family: 2, pool: POOL, tokenIn: USDC, tokenOut: WETH, aux: 0n }]
        expectMismatch(
            () => run({ tx: makeTx({ over: { legs: [{ amountIn: AMOUNT_IN + 1n, hops }] } }) }),
            'data'
        )
        expectMismatch(() => run({ tx: makeTx({ over: { legs: [] } }) }), 'data')
    })

    it('birden cok bacak toplami totalIn ise gecer', () => {
        const hops = [{ family: 2, pool: POOL, tokenIn: USDC, tokenOut: WETH, aux: 0n }]
        const legs = [
            { amountIn: AMOUNT_IN - 500n, hops },
            { amountIn: 500n, hops },
        ]
        expect(run({ tx: makeTx({ over: { legs } }) })).toEqual({ minAmountOut: MIN_OUT })
    })
})

describe('verifyLcxSwapTx: gercek LCX build fikstürleri (F5)', () => {
    const cases = [
        ['ETH -> USDC (native girdi)', buildEthUsdc, quoteEthUsdc],
        ['USDC -> WETH', buildUsdcWeth, quoteUsdcWeth],
        ['USDC -> USDT (stablecoin)', buildStable, quoteStable],
    ]

    for (const [name, build, quote] of cases) {
        it(name, () => {
            const swap = build.data.swap
            const q = quote.data.quote
            const decoded = iface.decodeFunctionData('swapSplit', swap.data)
            const exp = {
                tokenIn: q.input.token,
                tokenOut: q.output.token,
                amountIn: BigInt(q.input.amount),
                minOut: BigInt(q.output.minimumAmount),
                recipient: decoded.recipient,
            }
            const now = (Number(decoded.deadline) - 300) * 1000
            const res = verifyLcxSwapTx({ chainId: swap.chainId, tx: swap, expect: exp, now })
            expect(res).toEqual({ minAmountOut: BigInt(q.output.minimumAmount) })
            expect(approvalTargetFor({ chainId: swap.chainId, build: {}, quote: q })).toBe(
                LCX_ROUTERS[8453]
            )
        })
    }

    it('gercek fikstur + sona eklenen bayt reddedilir (deadbeef, 32 sifir bayt)', () => {
        const swap = buildUsdcWeth.data.swap
        const q = quoteUsdcWeth.data.quote
        const decoded = iface.decodeFunctionData('swapSplit', swap.data)
        const exp = {
            tokenIn: q.input.token,
            tokenOut: q.output.token,
            amountIn: BigInt(q.input.amount),
            minOut: BigInt(q.output.minimumAmount),
            recipient: decoded.recipient,
        }
        const now = (Number(decoded.deadline) - 300) * 1000
        for (const extra of ['deadbeef', '00'.repeat(32)]) {
            const tx = { ...swap, data: swap.data + extra }
            expectMismatch(
                () => verifyLcxSwapTx({ chainId: swap.chainId, tx, expect: exp, now }),
                'data'
            )
        }
    })

    it('ayni fikstur bir alan bozulunca reddedilir', () => {
        const swap = buildUsdcWeth.data.swap
        const q = quoteUsdcWeth.data.quote
        const decoded = iface.decodeFunctionData('swapSplit', swap.data)
        const exp = {
            tokenIn: q.input.token,
            tokenOut: q.output.token,
            amountIn: BigInt(q.input.amount),
            minOut: BigInt(q.output.minimumAmount),
            recipient: OTHER_RECIPIENT,
        }
        const now = (Number(decoded.deadline) - 300) * 1000
        expectMismatch(
            () => verifyLcxSwapTx({ chainId: swap.chainId, tx: swap, expect: exp, now }),
            'recipient'
        )
    })
})

describe('approvalTargetFor', () => {
    it('build.approval.target router ise doner', () => {
        const build = { approval: { target: ROUTER_A } }
        expect(approvalTargetFor({ chainId: 8453, build, quote: { spender: PERMIT2 } })).toBe(ROUTER_A)
    })

    it('approval yok, quote.spender router ise doner', () => {
        expect(approvalTargetFor({ chainId: 8453, build: { approval: null }, quote: { spender: ROUTER_A } })).toBe(
            ROUTER_A
        )
        expect(approvalTargetFor({ chainId: 56, build: {}, quote: { spender: ROUTER_B } })).toBe(ROUTER_B)
    })

    it('kucuk harfli router adresi kabul edilir, checksum li doner', () => {
        const quote = { spender: ROUTER_A.toLowerCase() }
        expect(approvalTargetFor({ chainId: 8453, build: null, quote })).toBe(ROUTER_A)
    })

    it('hedef Permit2 -> approval', () => {
        expectMismatch(
            () => approvalTargetFor({ chainId: 8453, build: { approval: { target: PERMIT2 } }, quote: { spender: ROUTER_A } }),
            'approval'
        )
        expectMismatch(
            () => approvalTargetFor({ chainId: 8453, build: null, quote: { spender: PERMIT2 } }),
            'approval'
        )
    })

    it('hedef rastgele adres -> approval', () => {
        expectMismatch(
            () => approvalTargetFor({ chainId: 8453, build: null, quote: { spender: OTHER_TOKEN } }),
            'approval'
        )
    })

    it('hedef baska agin router i -> approval', () => {
        expectMismatch(
            () => approvalTargetFor({ chainId: 8453, build: null, quote: { spender: ROUTER_B } }),
            'approval'
        )
    })

    it('hedef yok ya da gecersiz -> approval', () => {
        expectMismatch(() => approvalTargetFor({ chainId: 8453, build: {}, quote: {} }), 'approval')
        expectMismatch(
            () => approvalTargetFor({ chainId: 8453, build: null, quote: { spender: 'x' } }),
            'approval'
        )
    })

    it('desteklenmeyen ag -> chainId', () => {
        expectMismatch(
            () => approvalTargetFor({ chainId: 42220, build: null, quote: { spender: ROUTER_A } }),
            'chainId'
        )
    })
})
