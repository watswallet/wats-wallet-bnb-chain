import { describe, it, expect } from 'vitest'
import { formatUnits } from 'ethers'
import { lcxSwapData } from './mapQuote.js'
import { LcxUnavailableError } from './client.js'
import { LCX_NATIVE } from './routerGuard.js'
import ethUsdc from './fixtures/quote-base-eth-usdc.json'
import usdcWeth from './fixtures/quote-base-usdc-weth.json'
import stableQuote from './fixtures/stable-quote-base-usdc-usdt.json'
import rwaQuote from './fixtures/rwa-quote-base.json'
import rwaSell from './fixtures/rwa-quote-base-sell.json'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USDT = '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2'
const WETH = '0x4200000000000000000000000000000000000006'
const TSLA = '0xb2000000000000000000001e800a7f5189430cD0'
const ROUTER = '0x0000000000b1ae06c96aB73FF4360d7AeAaB56F0'

// Fiksturler LCX'in ham govdesi { success, data }; sunucumuz yalniz `data`yi tasir.
const clone = (x) => JSON.parse(JSON.stringify(x))
const dataOf = (fixture) => clone(fixture.data)

// Arka plan LCX'e GONDERDIGI degerleri (chainId, LCX bicimli tokenIn/tokenOut, ham amountIn) ve zincirden okudugu
// ondaliklari buraya acikca verir (R14); yanit bunlarla bire bir ortusmek zorundadir.
// ETH -> USDC (0.001 ETH).
const ETH_USDC = Object.freeze({
    kind: 'swap',
    chainId: 8453,
    tokenIn: LCX_NATIVE,
    tokenOut: USDC,
    amountIn: '1000000000000000',
    slippagePercent: 0.5,
    slippageBps: 50,
    nativeSymbol: 'ETH',
    inDecimals: 18,
    outDecimals: 6,
})
// USDC -> WETH (2 USDC).
const USDC_WETH = Object.freeze({
    kind: 'swap',
    chainId: 8453,
    tokenIn: USDC,
    tokenOut: WETH,
    amountIn: '2000000',
    slippagePercent: 0.5,
    slippageBps: 50,
    nativeSymbol: 'ETH',
    inDecimals: 6,
    outDecimals: 18,
})
// USDC -> USDT (2 USDC, stable).
const USDC_USDT = Object.freeze({ ...USDC_WETH, kind: 'stable', tokenOut: USDT, outDecimals: 6 })
// USDC -> TSLAc (2 USDC, rwa).
const USDC_TSLA = Object.freeze({ ...USDC_WETH, kind: 'rwa', tokenOut: TSLA, outDecimals: 8 })

describe('lcxSwapData -- Swap.vue nin okudugu alanlar', () => {
    it('expectedOutput ve minimumReceived: ham tutar, CAGIRANIN verdigi ondaliklarla bicimlenir', () => {
        const data = dataOf(ethUsdc)
        const out = lcxSwapData(data, ETH_USDC)
        expect(out.expectedOutput).toBe(formatUnits(data.quote.output.amount, 6))
        expect(out.expectedOutput).toBe('1.803908')
        expect(out.minimumReceived).toBe(formatUnits(data.quote.output.minimumAmount, 6))
        expect(out.minimumReceived).toBe('1.794888')
    })

    it('ondaliklar LCX yanitindaki decimals alanindan DEGIL, cagirandan gelir (R3)', () => {
        // Yanit decimals alanlarini hic tasimasa da gosterim cagirandaki ondaliklarla bicimlenir. (Yanit ONLARI tasiyip
        // cagirandakinden FARKLIysa teklif reddedilir: R18, asagida.)
        const data = dataOf(ethUsdc)
        delete data.quote.output.decimals
        delete data.quote.input.decimals
        const out = lcxSwapData(data, ETH_USDC)
        expect(out.expectedOutput).toBe('1.803908')
        // Cagirandaki deger degisince cikti degisir: ondalik GERCEKTEN kullaniliyor.
        expect(lcxSwapData(data, { ...ETH_USDC, outDecimals: 8 }).expectedOutput).toBe(formatUnits('1803908', 8))
    })

    it('USDC -> WETH: 6 ondalik girdi, 18 ondalik cikti', () => {
        const data = dataOf(usdcWeth)
        const out = lcxSwapData(data, USDC_WETH)
        expect(out.expectedOutput).toBe(formatUnits('1109639748685926', 18))
        expect(out.minimumReceived).toBe(formatUnits('1104091549942496', 18))
        expect(out.exchangeRate).toBe((Number(out.expectedOutput) / 2).toFixed(6))
        expect(out.reverseExchangeRate).toBe((2 / Number(out.expectedOutput)).toFixed(6))
    })

    it('exchangeRate ve reverseExchangeRate toFixed(6) dizgesi (girdi = formatUnits(amountIn, inDecimals))', () => {
        const out = lcxSwapData(dataOf(ethUsdc), ETH_USDC)
        const rate = Number('1.803908') / Number('0.001')
        expect(out.exchangeRate).toBe(rate.toFixed(6))
        expect(out.exchangeRate).toBe('1803.908000')
        expect(out.reverseExchangeRate).toBe((Number('0.001') / Number('1.803908')).toFixed(6))
        expect(out.exchangeRate).toMatch(/^\d+\.\d{6}$/)
        expect(out.reverseExchangeRate).toMatch(/^\d+\.\d{6}$/)
    })

    it('inDecimals kuru ETKILER (R14: olu parametre degil): yanlis ondalik yanlis kur uretir', () => {
        const data = dataOf(ethUsdc)
        // Yanit decimals tasimiyor: tutarlilik denetimi (R18) devre disi, parametrenin kura etkisi ayri olculur.
        delete data.quote.input.decimals
        delete data.quote.output.decimals
        const dogru = lcxSwapData(data, ETH_USDC)
        const yanlis = lcxSwapData(data, { ...ETH_USDC, inDecimals: 17 }) // 1e15 / 1e17 = 0.01
        expect(dogru.exchangeRate).toBe('1803.908000')
        expect(yanlis.exchangeRate).toBe((Number('1.803908') / 0.01).toFixed(6))
        expect(yanlis.exchangeRate).not.toBe(dogru.exchangeRate)
        expect(yanlis.reverseExchangeRate).not.toBe(dogru.reverseExchangeRate)
        // Girdi ondaligi yalniz kura girer; cikti miktari degismez.
        expect(yanlis.expectedOutput).toBe(dogru.expectedOutput)
    })

    it('kur hesaplanamazsa (miktar 0) NaN/Infinity yazilmaz', () => {
        const data = dataOf(ethUsdc)
        data.quote.input.amount = '0'
        const out = lcxSwapData(data, { ...ETH_USDC, amountIn: '0' })
        expect(out.exchangeRate).toBe('0')
        expect(out.reverseExchangeRate).toBe('0.000000')
    })

    describe('priceImpact', () => {
        it('priceImpactPct sayiysa `${toFixed(2)}%`', () => {
            const data = dataOf(ethUsdc)
            expect(data.quote.priceImpactPct).toBe(0.111)
            expect(lcxSwapData(data, ETH_USDC).priceImpact).toBe(`${(0.111).toFixed(2)}%`)
            expect(lcxSwapData(data, ETH_USDC).priceImpact).toBe('0.11%')
        })

        it('negatif etki de oldugu gibi bicimlenir (WETH teklifi -0.195)', () => {
            const data = dataOf(usdcWeth)
            const out = lcxSwapData(data, USDC_WETH)
            expect(out.priceImpact).toBe(`${(-0.195).toFixed(2)}%`)
        })

        it.each([[undefined], [null], ['0.111'], [NaN], [Infinity]])(
            'priceImpactPct %p ise "N/A%%" (Swap.vue nun "olculemedi" satiri devreye girer)',
            (deger) => {
                const data = dataOf(ethUsdc)
                if (deger === undefined) delete data.quote.priceImpactPct
                else data.quote.priceImpactPct = deger
                expect(lcxSwapData(data, ETH_USDC).priceImpact).toBe('N/A%')
            },
        )
    })

    it('depthGateWarning her zaman false (etki olculemediyse satir genel "olculemedi" metnini gosterir)', () => {
        expect(lcxSwapData(dataOf(ethUsdc), ETH_USDC).depthGateWarning).toBe(false)
        const data = dataOf(ethUsdc)
        delete data.quote.priceImpactPct
        expect(lcxSwapData(data, ETH_USDC).depthGateWarning).toBe(false)
    })

    describe('estimatedGasFee', () => {
        it('gasEstimateWei doluysa: totalCost = formatUnits(wei, 18), formatted = "<deger> <native>", USD = gasFeeUSD', () => {
            const data = dataOf(ethUsdc)
            const fee = lcxSwapData(data, ETH_USDC).estimatedGasFee
            expect(fee.totalCost).toBe(formatUnits(data.quote.gasEstimateWei, 18))
            expect(fee.totalCost).toBe('0.0000018')
            expect(fee.totalCostFormatted).toBe(`${fee.totalCost} ETH`)
            expect(fee.totalCostUSD).toBe(data.quote.gasFeeUSD)
        })

        it('nativeSymbol agdan gelir (BNB, POL...)', () => {
            const fee = lcxSwapData(dataOf(ethUsdc), { ...ETH_USDC, nativeSymbol: 'BNB' }).estimatedGasFee
            expect(fee.totalCostFormatted).toBe(`${fee.totalCost} BNB`)
        })

        it('totalCost Swap.vue nun Number() ile okuyabilecegi ondalik dizge', () => {
            const fee = lcxSwapData(dataOf(ethUsdc), ETH_USDC).estimatedGasFee
            expect(typeof fee.totalCost).toBe('string')
            expect(Number(fee.totalCost)).toBeCloseTo(1.8e-6, 12)
        })

        it.each([[null], [undefined], ['']])('gasEstimateWei %p ise totalCost null (uydurma gaz gosterilmez)', (bos) => {
            const data = dataOf(ethUsdc)
            if (bos === undefined) delete data.quote.gasEstimateWei
            else data.quote.gasEstimateWei = bos
            const fee = lcxSwapData(data, ETH_USDC).estimatedGasFee
            // TAM null (0 ya da bos dizge degil): Swap.vue `totalCost == null` gorunce native gaz uyarisini SWAP_GAS_FALLBACK x gaz
            // fiyatiyla kurar (M1; SwapLcx.ssr.test.js), swapReserve de ayni sabite duser.
            expect(fee.totalCost).toBeNull()
            expect(fee.totalCostFormatted).toBeNull()
        })

        it('gasFeeUSD yoksa totalCostUSD null', () => {
            const data = dataOf(ethUsdc)
            delete data.quote.gasFeeUSD
            expect(lcxSwapData(data, ETH_USDC).estimatedGasFee.totalCostUSD).toBeNull()
        })
    })

    it('slippageTolerance kullanicinin sectigi yuzdeden: 0.5 -> "0.50%"', () => {
        expect(lcxSwapData(dataOf(ethUsdc), ETH_USDC).slippageTolerance).toBe('0.50%')
        expect(lcxSwapData(dataOf(ethUsdc), { ...ETH_USDC, slippagePercent: 1 }).slippageTolerance).toBe('1.00%')
        expect(lcxSwapData(dataOf(ethUsdc), { ...ETH_USDC, slippagePercent: '0.3' }).slippageTolerance).toBe('0.30%')
    })

    it('routerType { name: "lcx" }, liquidityProviderFee "N/A"', () => {
        const out = lcxSwapData(dataOf(ethUsdc), ETH_USDC)
        expect(out.routerType).toEqual({ name: 'lcx' })
        expect(out.liquidityProviderFee).toBe('N/A')
    })
})

describe('lcxSwapData -- lcxQuote (yurutmeye AYNEN geri gelen yuk)', () => {
    it('swap: tum alanlar fikstur degerleriyle', () => {
        const { lcxQuote } = lcxSwapData(dataOf(ethUsdc), ETH_USDC)
        expect(lcxQuote).toEqual({
            kind: 'swap',
            quoteId: ethUsdc.data.quote.quoteId,
            chainId: 8453,
            tokenIn: LCX_NATIVE,
            tokenOut: USDC,
            amountIn: '1000000000000000',
            amountOut: '1803908',
            minOut: '1794888',
            slippageBps: 50,
            expiresAt: ethUsdc.data.quote.expiresAt,
            spender: ROUTER,
        })
    })

    it('minOut swap ve stable icin quote.output.minimumAmount (ham, dizge)', () => {
        const data = dataOf(ethUsdc)
        expect(lcxSwapData(data, ETH_USDC).lcxQuote.minOut).toBe(data.quote.output.minimumAmount)
    })

    it('sayilar ondalik dizge; yalniz chainId, slippageBps, expiresAt sayi', () => {
        const { lcxQuote } = lcxSwapData(dataOf(ethUsdc), ETH_USDC)
        for (const alan of ['quoteId', 'tokenIn', 'tokenOut', 'amountIn', 'amountOut', 'minOut', 'spender', 'kind']) {
            expect(typeof lcxQuote[alan], alan).toBe('string')
        }
        for (const alan of ['amountIn', 'amountOut', 'minOut']) expect(lcxQuote[alan], alan).toMatch(/^\d+$/)
        for (const alan of ['chainId', 'slippageBps', 'expiresAt']) {
            expect(typeof lcxQuote[alan], alan).toBe('number')
        }
    })

    it('ham sayi alanlari gelse bile ondalik dizgeye cevrilir (amountIn, amountOut, minOut)', () => {
        const data = dataOf(ethUsdc)
        data.quote.input.amount = 1000
        data.quote.output.amount = 1000
        data.quote.output.minimumAmount = 999
        const { lcxQuote } = lcxSwapData(data, { ...ETH_USDC, amountIn: '1000' })
        expect(lcxQuote.amountIn).toBe('1000')
        expect(lcxQuote.amountOut).toBe('1000')
        expect(lcxQuote.minOut).toBe('999')
    })

    it('adresler LCX bicimine (checksum) normalize edilir; yanit ve cagiran adresleri harf duyarsiz eslesir', () => {
        const data = dataOf(usdcWeth)
        data.quote.input.token = data.quote.input.token.toLowerCase()
        data.quote.output.token = data.quote.output.token.toLowerCase()
        data.quote.spender = data.quote.spender.toLowerCase()
        const { lcxQuote } = lcxSwapData(data, {
            ...USDC_WETH,
            tokenIn: USDC.toLowerCase(),
        })
        expect(lcxQuote.tokenIn).toBe(USDC)
        expect(lcxQuote.tokenOut).toBe(WETH)
        expect(lcxQuote.spender).toBe(ROUTER)
    })

    it('amountIn bigint olarak verilebilir; ondalik dizgeye normalize edilir', () => {
        const { lcxQuote } = lcxSwapData(dataOf(ethUsdc), { ...ETH_USDC, amountIn: 1000000000000000n })
        expect(lcxQuote.amountIn).toBe('1000000000000000')
    })

    it('lcxQuote.slippageBps LCX nin UYGULADIGI degerdir (build onu ister); kullanicininkinden SIKI ise kabul edilir', () => {
        // Kullanici 0.5% (50 bps) istedi, LCX 30 uyguladi: daha siki kayma takasi yalniz basarisiz kilabilir, para kaybettirmez.
        const data = dataOf(ethUsdc)
        data.quote.slippageBps = 30
        const out = lcxSwapData(data, { ...ETH_USDC, slippagePercent: 0.5, slippageBps: 50 })
        expect(out.lcxQuote.slippageBps).toBe(30)
    })

    it('stable: kind, slippageBps (30) ve minOut yanittan; 6/6 ondalik', () => {
        const data = dataOf(stableQuote)
        const out = lcxSwapData(data, USDC_USDT)
        expect(out.lcxQuote.kind).toBe('stable')
        expect(out.lcxQuote.slippageBps).toBe(30)
        expect(out.lcxQuote.minOut).toBe('1996340')
        expect(out.lcxQuote.tokenIn).toBe(USDC)
        expect(out.lcxQuote.tokenOut).toBe(USDT)
        expect(out.expectedOutput).toBe('2.002348')
        expect(out.minimumReceived).toBe('1.99634')
    })

    describe('rwa (Bolum 2 icin simdiden)', () => {
        it('fikstur: minOut data.rwa.minOut, slippageBps data.rwa.slippageBps', () => {
            const data = dataOf(rwaQuote)
            const out = lcxSwapData(data, USDC_TSLA)
            expect(out.lcxQuote.kind).toBe('rwa')
            expect(out.lcxQuote.minOut).toBe(data.rwa.minOut)
            expect(out.lcxQuote.minOut).toBe('510712')
            expect(out.lcxQuote.slippageBps).toBe(data.rwa.slippageBps)
            expect(out.expectedOutput).toBe(formatUnits('513279', 8))
        })

        it('rwa.minOut ve rwa.slippageBps quote nunkilerden FARKLIYSA rwa nunkiler kazanir; gosterilen minimumReceived da yurutulecek minOut', () => {
            const data = dataOf(rwaQuote)
            data.rwa.minOut = '510000'
            data.rwa.slippageBps = 77
            // Kullanici %1 (100 bps) istedi: LCX'in 77'si ondan siki, 510000 >= floor(513279 * 0.99) = 508146.
            const out = lcxSwapData(data, { ...USDC_TSLA, slippagePercent: 1, slippageBps: 100 })
            expect(out.lcxQuote.minOut).toBe('510000')
            expect(out.lcxQuote.slippageBps).toBe(77)
            expect(out.minimumReceived).toBe(formatUnits('510000', 8))
            expect(data.quote.output.minimumAmount).not.toBe('510000')
        })

        it('kind rwa degilken data.rwa dikkate alinmaz', () => {
            const data = dataOf(rwaQuote)
            data.rwa.minOut = '1'
            data.rwa.slippageBps = 1
            const out = lcxSwapData(data, { ...USDC_TSLA, kind: 'swap' })
            expect(out.lcxQuote.minOut).toBe(data.quote.output.minimumAmount)
            expect(out.lcxQuote.slippageBps).toBe(data.quote.slippageBps)
        })
    })

    // Gorev 5: yalniz rwa teklifi `lcxQuote.rwa` tasir; arka plan ihracci eslesmesini (teklif ihraccisi == katalog satiri) buradan kurar.
    describe('rwa alanlari (lcxQuote.rwa)', () => {
        const TSLA_SELL = Object.freeze({ ...USDC_TSLA, tokenIn: TSLA, tokenOut: USDC, amountIn: '500000', inDecimals: 8, outDecimals: 6 })

        it('alim fiksturu: ihracci normallesir, referans cikis tarafindan, alti alan tam', () => {
            const out = lcxSwapData(dataOf(rwaQuote), USDC_TSLA)
            expect(out.lcxQuote.rwa).toEqual({
                issuer: 'coinbase', // data.rwa.asset.issuer 'Coinbase' -> normalizeLcxIssuer
                marketOpen: false,
                refDeviationBps: -26.66,
                referenceUsd: 388.61280861, // referenceOut.usd
                symbol: 'TSLAC',
                underlying: 'TSLA',
            })
        })

        it('satis fiksturu: referans giris tarafindan (referenceOut null)', () => {
            const out = lcxSwapData(dataOf(rwaSell), TSLA_SELL)
            expect(out.lcxQuote.rwa).toEqual({
                issuer: 'coinbase', marketOpen: false, refDeviationBps: 41.05, referenceUsd: 346.905, symbol: 'TSLAC', underlying: 'TSLA',
            })
        })

        it('iki referans da varsa cikis tarafi kazanir; ikisi de yoksa referenceUsd null', () => {
            const both = dataOf(rwaSell)
            both.rwa.referenceOut = { source: 'x', updatedAt: 1, usd: 111 }
            expect(lcxSwapData(both, TSLA_SELL).lcxQuote.rwa.referenceUsd).toBe(111)

            const none = dataOf(rwaSell)
            none.rwa.referenceIn = null
            none.rwa.referenceOut = null
            expect(lcxSwapData(none, TSLA_SELL).lcxQuote.rwa.referenceUsd).toBeNull()
        })

        it('sonlu olmayan / sayi olmayan alanlar null olur (uydurma deger yok)', () => {
            const d = dataOf(rwaSell)
            d.rwa.referenceIn.usd = 'abc'
            d.rwa.refDeviationBps = '41.05'
            d.rwa.marketOpen = 'yes'
            d.rwa.asset.symbol = 7
            d.rwa.asset.underlying = null
            expect(lcxSwapData(d, TSLA_SELL).lcxQuote.rwa).toEqual({
                issuer: 'coinbase', marketOpen: null, refDeviationBps: null, referenceUsd: null, symbol: null, underlying: null,
            })
        })

        it('ihracci normallestirilemezse (eksik, dize degil, gecersiz) issuer null: teklif kurulur ama ihracci eslesmesi (arka plan) onu reddeder', () => {
            for (const bad of [undefined, null, 5, '', '--', 'x']) {
                const d = dataOf(rwaSell)
                if (bad === undefined) delete d.rwa.asset.issuer
                else d.rwa.asset.issuer = bad
                expect(lcxSwapData(d, TSLA_SELL).lcxQuote.rwa.issuer, String(bad)).toBeNull()
            }
            const noAsset = dataOf(rwaSell)
            delete noAsset.rwa.asset
            expect(lcxSwapData(noAsset, TSLA_SELL).lcxQuote.rwa.issuer).toBeNull()
        })

        it('ihracci adi sunucudaki normallestirmeyle ayni: bosluk / noktalama / buyuk harf', () => {
            for (const [raw, want] of [['Coinbase', 'coinbase'], ['Backed (xStocks)', 'backed-xstocks'], [' Ondo  Finance ', 'ondo-finance']]) {
                const d = dataOf(rwaSell)
                d.rwa.asset.issuer = raw
                expect(lcxSwapData(d, TSLA_SELL).lcxQuote.rwa.issuer, raw).toBe(want)
            }
        })

        it('swap ve stable tekliflerde lcxQuote.rwa YOK (anahtar bile yok)', () => {
            expect('rwa' in lcxSwapData(dataOf(ethUsdc), ETH_USDC).lcxQuote).toBe(false)
            expect('rwa' in lcxSwapData(dataOf(stableQuote), USDC_USDT).lcxQuote).toBe(false)
            // data.rwa tasiyan bir yanit swap kind iken de rwa alani uretmez.
            expect('rwa' in lcxSwapData(dataOf(rwaQuote), { ...USDC_TSLA, kind: 'swap' }).lcxQuote).toBe(false)
        })

        it('ham yanit nesnesi degismez ve lcxQuote.rwa onunla paylasilmaz', () => {
            const data = dataOf(rwaQuote)
            const before = JSON.stringify(data)
            const out = lcxSwapData(data, USDC_TSLA)
            expect(JSON.stringify(data)).toBe(before)
            out.lcxQuote.rwa.symbol = 'X'
            expect(data.rwa.asset.symbol).toBe('TSLAC')
        })
    })
})

describe('lcxSwapData -- yanit cagiranin gonderdigiyle eslesmek zorunda (R14)', () => {
    const mutated = (mutate, source = ethUsdc) => {
        const d = dataOf(source)
        mutate(d)
        return d
    }
    const throwsError = (fn) => {
        try {
            fn()
        } catch (e) {
            return e
        }
        return null
    }
    const expectBadQuote = (fn, field) => {
        const err = throwsError(fn)
        expect(err, `${field} icin hata bekleniyordu`).toBeInstanceOf(LcxUnavailableError)
        expect(err.reason).toBe('bad_quote')
        expect(err.field).toBe(field)
        expect(err.message).toContain(field)
    }

    it('eslesen fikstur gecer (uc teklif turu)', () => {
        expect(() => lcxSwapData(dataOf(ethUsdc), ETH_USDC)).not.toThrow()
        expect(() => lcxSwapData(dataOf(usdcWeth), USDC_WETH)).not.toThrow()
        expect(() => lcxSwapData(dataOf(stableQuote), USDC_USDT)).not.toThrow()
        expect(() => lcxSwapData(dataOf(rwaQuote), USDC_TSLA)).not.toThrow()
    })

    it('chainId uyusmazligi -> bad_quote (chainId)', () => {
        expectBadQuote(() => lcxSwapData(dataOf(ethUsdc), { ...ETH_USDC, chainId: 10 }), 'chainId')
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.quote.chainId = 1)), ETH_USDC), 'chainId')
    })

    it('giris tokeni uyusmazligi -> bad_quote (input.token)', () => {
        // Cagiran ETH (native) gonderdi, yanit USDC girdisi diyor ve tersi.
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.quote.input.token = USDC)), ETH_USDC), 'input.token')
        expectBadQuote(() => lcxSwapData(dataOf(ethUsdc), { ...ETH_USDC, tokenIn: USDC }), 'input.token')
    })

    it('cikis tokeni uyusmazligi -> bad_quote (output.token)', () => {
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.quote.output.token = USDT)), ETH_USDC), 'output.token')
        expectBadQuote(() => lcxSwapData(dataOf(ethUsdc), { ...ETH_USDC, tokenOut: USDT }), 'output.token')
        // Kullanici USDC bekliyor, yanit baska bir token'a cikiyor: gosterilen cikti dogru token'in degil.
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.quote.output.token = WETH)), ETH_USDC), 'output.token')
    })

    it('girdi tutari uyusmazligi -> bad_quote (input.amount): kullanicinin yazmadigi tutar icin cikti/kur gosterilmez', () => {
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.quote.input.amount = '1000000000000001')), ETH_USDC), 'input.amount')
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.quote.input.amount = '2000000000000000')), ETH_USDC), 'input.amount')
        expectBadQuote(() => lcxSwapData(dataOf(ethUsdc), { ...ETH_USDC, amountIn: '999999999999999' }), 'input.amount')
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.quote.input.amount = 1000)), ETH_USDC), 'input.amount')
    })

    it('uyusmayan teklif hicbir alan dondurmez: istisna firlar, yari esleme yok', () => {
        let out
        const err = throwsError(() => {
            out = lcxSwapData(mutated((d) => (d.quote.input.amount = '1')), ETH_USDC)
        })
        expect(err).toBeInstanceOf(LcxUnavailableError)
        expect(out).toBeUndefined()
    })

    it('lcxQuote.amountIn cagiranin gonderdigi tutardir (yanittaki degil)', () => {
        const { lcxQuote } = lcxSwapData(dataOf(ethUsdc), ETH_USDC)
        expect(lcxQuote.amountIn).toBe(ETH_USDC.amountIn)
        // Yanit ayni DEGERI baska bicimde yazsa da (ondeki sifir) lcxQuote cagiranin kanonik dizgesini tasir.
        const out = lcxSwapData(mutated((d) => (d.quote.input.amount = '01000000000000000')), ETH_USDC)
        expect(out.lcxQuote.amountIn).toBe('1000000000000000')
    })
})

describe('lcxSwapData -- ondalik tutarliligi (R18)', () => {
    // Gosterim HER ZAMAN cagirandaki ondaliklarla bicimlenir (R3); LCX'in decimals alanlari yalniz TUTARLILIK denetimidir:
    // arka planin zincir okumasi sessizce 18'e dustuyse (6 ondalikli token icin amountIn 10^12 kat buyur) yanit bunu ele verir.
    const mutated = (mutate, source = ethUsdc) => {
        const d = dataOf(source)
        mutate(d)
        return d
    }
    const throwsError = (fn) => {
        try {
            fn()
        } catch (e) {
            return e
        }
        return null
    }
    const expectBadQuote = (fn, field) => {
        const err = throwsError(fn)
        expect(err, `${field} icin hata bekleniyordu`).toBeInstanceOf(LcxUnavailableError)
        expect(err.reason).toBe('bad_quote')
        expect(err.field).toBe(field)
        expect(err.message).toContain(field)
    }

    it('fiksturlerdeki ondaliklar (Base USDC 6 / WETH 18 / native 18) cagirandakilerle eslesince gecer', () => {
        expect(() => lcxSwapData(dataOf(ethUsdc), ETH_USDC)).not.toThrow()
        expect(() => lcxSwapData(dataOf(usdcWeth), USDC_WETH)).not.toThrow()
        expect(() => lcxSwapData(dataOf(stableQuote), USDC_USDT)).not.toThrow()
        expect(() => lcxSwapData(dataOf(rwaQuote), USDC_TSLA)).not.toThrow()
    })

    it('input.decimals cagirandaki inDecimals ile ayni degilse -> bad_quote (input.decimals)', () => {
        // Cagiran 6 ondalikli USDC icin 18 okudu (sessiz yedek); yanit 6 diyor.
        expectBadQuote(() => lcxSwapData(dataOf(usdcWeth), { ...USDC_WETH, inDecimals: 18 }), 'input.decimals')
        // Yanit tarafi degisse de ayni sonuc.
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.quote.input.decimals = 6)), ETH_USDC), 'input.decimals')
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.quote.input.decimals = 0)), ETH_USDC), 'input.decimals')
    })

    it('output.decimals cagirandaki outDecimals ile ayni degilse -> bad_quote (output.decimals)', () => {
        expectBadQuote(() => lcxSwapData(dataOf(ethUsdc), { ...ETH_USDC, outDecimals: 18 }), 'output.decimals')
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.quote.output.decimals = 8)), ETH_USDC), 'output.decimals')
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.quote.output.decimals = 0)), ETH_USDC), 'output.decimals')
    })

    it('uyusmayan ondalikta hicbir alan dondurmez: istisna firlar, yari esleme yok', () => {
        let out
        const err = throwsError(() => {
            out = lcxSwapData(dataOf(usdcWeth), { ...USDC_WETH, inDecimals: 18 })
        })
        expect(err).toBeInstanceOf(LcxUnavailableError)
        expect(out).toBeUndefined()
    })

    it('yanit decimals alanlarini tasimiyorsa (yok / null / tam sayi degil) reddedilmez; gosterim cagirandan', () => {
        for (const absent of [undefined, null, '6', 6.5, NaN]) {
            const data = mutated((d) => {
                if (absent === undefined) {
                    delete d.quote.input.decimals
                    delete d.quote.output.decimals
                } else {
                    d.quote.input.decimals = absent
                    d.quote.output.decimals = absent
                }
            })
            const out = lcxSwapData(data, ETH_USDC)
            expect(out.expectedOutput).toBe('1.803908')
        }
    })

    it('yalniz biri eksikse digeri yine denetlenir', () => {
        expect(() => lcxSwapData(mutated((d) => delete d.quote.input.decimals), ETH_USDC)).not.toThrow()
        expectBadQuote(() => lcxSwapData(mutated((d) => { delete d.quote.input.decimals; d.quote.output.decimals = 8 }), ETH_USDC), 'output.decimals')
        expectBadQuote(() => lcxSwapData(mutated((d) => { delete d.quote.output.decimals; d.quote.input.decimals = 6 }), ETH_USDC), 'input.decimals')
    })
})

describe('lcxSwapData -- bozuk girdi', () => {
    const mutated = (mutate, source = ethUsdc) => {
        const d = dataOf(source)
        mutate(d)
        return d
    }
    const throwsError = (fn) => {
        try {
            fn()
        } catch (e) {
            return e
        }
        return null
    }

    it.each([
        ['data yok', () => undefined, 'quote'],
        ['data nesne degil', () => 'x', 'quote'],
        ['quote yok', () => ({}), 'quote'],
        ['output yok', () => mutated((d) => delete d.quote.output), 'input/output'],
        ['input yok', () => mutated((d) => delete d.quote.input), 'input/output'],
        ['output.amount sayi degil', () => mutated((d) => (d.quote.output.amount = 'abc')), 'output.amount'],
        ['output.amount ondalik degil', () => mutated((d) => (d.quote.output.amount = '1.5')), 'output.amount'],
        ['minimumAmount yok', () => mutated((d) => delete d.quote.output.minimumAmount), 'output.minimumAmount'],
        ['input.amount yok', () => mutated((d) => delete d.quote.input.amount), 'input.amount'],
        ['quoteId yok', () => mutated((d) => delete d.quote.quoteId), 'quoteId'],
        ['spender yok', () => mutated((d) => delete d.quote.spender), 'spender'],
        ['expiresAt yok', () => mutated((d) => delete d.quote.expiresAt), 'expiresAt'],
        ['chainId yok', () => mutated((d) => delete d.quote.chainId), 'chainId'],
        ['slippageBps yok', () => mutated((d) => delete d.quote.slippageBps), 'slippageBps'],
        ['cikis tokeni gecersiz adres', () => mutated((d) => (d.quote.output.token = '0x1234')), 'output.token'],
        ['giris tokeni yok', () => mutated((d) => delete d.quote.input.token), 'input.token'],
    ])('bozuk LCX yaniti (%s) LcxUnavailableError(bad_quote) firlatir: yedege dusulur, yarim veri gosterilmez', (_ad, build, field) => {
        const err = throwsError(() => lcxSwapData(build(), ETH_USDC))
        expect(err).toBeInstanceOf(LcxUnavailableError)
        expect(err.reason).toBe('bad_quote')
        expect(err.field).toBe(field)
    })

    it('kind rwa ama data.rwa yok / alanlari eksik -> bad_quote', () => {
        for (const data of [
            mutated((d) => delete d.rwa, rwaQuote),
            mutated((d) => delete d.rwa.minOut, rwaQuote),
            mutated((d) => delete d.rwa.slippageBps, rwaQuote),
        ]) {
            const err = throwsError(() => lcxSwapData(data, USDC_TSLA))
            expect(err).toBeInstanceOf(LcxUnavailableError)
            expect(err.reason).toBe('bad_quote')
        }
    })

    it.each([
        ['outDecimals yok', { outDecimals: undefined }],
        ['inDecimals yok', { inDecimals: undefined }],
        ['inDecimals negatif', { inDecimals: -1 }],
        ['outDecimals kesirli', { outDecimals: 1.5 }],
        ['kind bilinmeyen', { kind: 'bilinmeyen' }],
        ['kind yok', { kind: undefined }],
        ['chainId yok', { chainId: undefined }],
        ['chainId dizge', { chainId: '8453' }],
        ['chainId kesirli', { chainId: 8453.5 }],
        ['chainId sifir', { chainId: 0 }],
        ['tokenIn yok', { tokenIn: undefined }],
        ['tokenIn adres degil', { tokenIn: '0x1234' }],
        ['tokenIn "0x0" kisaltmasi (LCX bicimi degil)', { tokenIn: '0x0' }],
        ['tokenOut yok', { tokenOut: undefined }],
        ['tokenOut adres degil', { tokenOut: 'usdc' }],
        ['amountIn yok', { amountIn: undefined }],
        ['amountIn sayi', { amountIn: 1000000000000000 }],
        ['amountIn kesirli dizge', { amountIn: '0.001' }],
        ['amountIn negatif dizge', { amountIn: '-5' }],
        ['amountIn bos dizge', { amountIn: '' }],
        ['amountIn harf', { amountIn: 'abc' }],
        ['amountIn negatif bigint', { amountIn: -5n }],
        ['slippageBps yok', { slippageBps: undefined }],
        ['slippageBps sifir', { slippageBps: 0 }],
        ['slippageBps kesirli', { slippageBps: 50.5 }],
        ['slippageBps dizge', { slippageBps: '50' }],
        ['slippageBps 10000 (yuzde 100)', { slippageBps: 10000 }],
    ])('cagiran hatasi (%s) TypeError: yanit hatasi gibi gizlenmez', (_ad, fark) => {
        const err = throwsError(() => lcxSwapData(dataOf(ethUsdc), { ...ETH_USDC, ...fark }))
        expect(err).toBeInstanceOf(TypeError)
        expect(err).not.toBeInstanceOf(LcxUnavailableError)
    })

    it('girdi nesnesini degistirmez', () => {
        const data = dataOf(ethUsdc)
        const snapshot = clone(data)
        lcxSwapData(data, ETH_USDC)
        expect(data).toEqual(snapshot)
    })
})

// C1 + I1: imzalanacak alt sinir (lcxQuote.minOut) YALNIZ LCX'ten gelir; routerGuard calldata'yi ona karsi denetler. Bu yuzden
// minOut, kullanicinin GORDUGU ciktiya (output.amount) ve kullanicinin ISTEDIGI kaymaya baglanir:
//   output.amount > 0,  minOut > 0  ve  minOut >= floor(output.amount * (10000 - istenen bps) / 10000)
// (floor: LCX'in kendi yuvarlamasi; dort fikstur de tam bu sinirda.) LCX'in uyguladigi kayma istenenden GENIS olamaz (daha siki
// kayma takasi yalniz basarisiz kilabilir, para kaybettirmez). Ayni kural yurutmede (calls.js assertLcxQuoteMatches) tekrar
// uygulanir; iki taraf ayni kurali kullanmazsa stable takas sonsuz "fiyat degisti" dongusune girerdi.
describe('lcxSwapData -- alt sinir kullanicinin kaymasina bagli (C1) ve kayma kurali (I1)', () => {
    const mutated = (mutate, source = ethUsdc) => {
        const d = dataOf(source)
        mutate(d)
        return d
    }
    const expectBadQuote = (fn, field) => {
        let err = null
        try {
            fn()
        } catch (e) {
            err = e
        }
        expect(err, `${field} icin hata bekleniyordu`).toBeInstanceOf(LcxUnavailableError)
        expect(err.reason).toBe('bad_quote')
        expect(err.field).toBe(field)
    }
    const floorMin = (out, bps) => (BigInt(out) * BigInt(10000 - bps)) / 10000n

    it('dort fikstur de sinirda TAM gecer: minOut = floor(output.amount * (10000 - LCX bps) / 10000)', () => {
        expect(floorMin('1803908', 50)).toBe(1794888n)
        expect(floorMin('1109639748685926', 50)).toBe(1104091549942496n)
        expect(floorMin('2002348', 30)).toBe(1996340n)
        expect(floorMin('513279', 50)).toBe(510712n)
        expect(lcxSwapData(dataOf(ethUsdc), ETH_USDC).lcxQuote.minOut).toBe('1794888')
        expect(lcxSwapData(dataOf(usdcWeth), USDC_WETH).lcxQuote.minOut).toBe('1104091549942496')
        // Stable: LCX 30 uyguladi; kullanici da 30 isterse (esit) gecer.
        expect(lcxSwapData(dataOf(stableQuote), { ...USDC_USDT, slippagePercent: 0.3, slippageBps: 30 }).lcxQuote.minOut).toBe('1996340')
        expect(lcxSwapData(dataOf(rwaQuote), USDC_TSLA).lcxQuote.minOut).toBe('510712')
    })

    it('lcxQuote.amountOut = output.amount (ondalik dizge); yurutme ayni sinirla yeniden denetler', () => {
        expect(lcxSwapData(dataOf(ethUsdc), ETH_USDC).lcxQuote.amountOut).toBe('1803908')
        expect(lcxSwapData(dataOf(stableQuote), USDC_USDT).lcxQuote.amountOut).toBe('2002348')
        expect(lcxSwapData(dataOf(rwaQuote), USDC_TSLA).lcxQuote.amountOut).toBe('513279')
    })

    it('minimumAmount 1 (gevsek alt sinir) -> bad_quote (minOut): swap ve stable', () => {
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.quote.output.minimumAmount = '1')), ETH_USDC), 'minOut')
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.quote.output.minimumAmount = '1'), stableQuote), USDC_USDT), 'minOut')
    })

    it('rwa.minOut 1 -> bad_quote (minOut); kontrol output.amount a karsi', () => {
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.rwa.minOut = '1'), rwaQuote), USDC_TSLA), 'minOut')
    })

    it('sinirin bir alti reddedilir, kendisi gecer (KULLANICININ bps i ile)', () => {
        // Kullanici 50 bps: floor(1803908 * 0.995) = 1794888.
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.quote.output.minimumAmount = '1794887')), ETH_USDC), 'minOut')
        // Kullanici 100 bps (LCX 50 uyguladi, daha siki): sinir floor(1803908 * 0.99) = 1785868.
        const loose = { ...ETH_USDC, slippagePercent: 1, slippageBps: 100 }
        expect(lcxSwapData(mutated((d) => (d.quote.output.minimumAmount = '1785868')), loose).lcxQuote.minOut).toBe('1785868')
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.quote.output.minimumAmount = '1785867')), loose), 'minOut')
        // Stable: LCX 30 uyguladi ama sinir KULLANICININ 50'siyle: floor(2002348 * 0.995) = 1992336.
        expect(lcxSwapData(mutated((d) => (d.quote.output.minimumAmount = '1992336'), stableQuote), USDC_USDT).lcxQuote.minOut).toBe('1992336')
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.quote.output.minimumAmount = '1992335'), stableQuote), USDC_USDT), 'minOut')
        // RWA: floor(513279 * 0.995) = 510712; bir alti reddedilir.
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.rwa.minOut = '510711'), rwaQuote), USDC_TSLA), 'minOut')
    })

    it('output.amount 0 -> bad_quote (gosterilecek cikti yok)', () => {
        expectBadQuote(() => lcxSwapData(mutated((d) => {
            d.quote.output.amount = '0'
            d.quote.output.minimumAmount = '0'
        }), ETH_USDC), 'output.amount')
    })

    it('minOut 0 -> bad_quote (minOut): kayma korumasiz islem hic kurulmaz', () => {
        // output.amount 1, 50 bps: floor(0.995) = 0; esitsizlik 0'i gecirirdi, ayrica > 0 sarti var.
        expectBadQuote(() => lcxSwapData(mutated((d) => {
            d.quote.output.amount = '1'
            d.quote.output.minimumAmount = '0'
        }), ETH_USDC), 'minOut')
    })

    it('LCX in uyguladigi kayma kullanicinin istediginden GENISSE -> bad_quote (slippageBps): swap, stable, rwa', () => {
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.quote.slippageBps = 51)), ETH_USDC), 'slippageBps')
        // Stable fikstur 30 uyguladi: kullanici 29 isterse LCX'inki daha genis.
        expectBadQuote(() => lcxSwapData(dataOf(stableQuote), { ...USDC_USDT, slippagePercent: 0.29, slippageBps: 29 }), 'slippageBps')
        expectBadQuote(() => lcxSwapData(mutated((d) => (d.rwa.slippageBps = 51), rwaQuote), USDC_TSLA), 'slippageBps')
    })

    it('LCX in uyguladigi kayma 0 -> bad_quote (slippageBps): yurutme 1 den kucugu reddeder, teklif de gostermez', () => {
        expectBadQuote(() => lcxSwapData(mutated((d) => {
            d.quote.slippageBps = 0
            d.quote.output.minimumAmount = d.quote.output.amount
        }), ETH_USDC), 'slippageBps')
    })
})
