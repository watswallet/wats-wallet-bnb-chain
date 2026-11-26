import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    LcxUnavailableError,
    LcxRefusalError,
    fetchLcxQuote,
    fetchLcxBuild,
    fetchLcxStablecoins,
    fetchLcxStocks,
    evictLcxQuote,
    _resetLcxCaches,
} from './client.js'
import { LCX_NATIVE } from './routerGuard.js'
import quoteEthUsdc from './fixtures/quote-base-eth-usdc.json'
import stablecoinsFixture from './fixtures/stablecoins.json'
import buildEthUsdc from './fixtures/build-base-eth-usdc.json'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USDT = '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2'
const ROUTER = '0x0000000000b1ae06c96aB73FF4360d7AeAaB56F0'
const RECIPIENT = '0x1111111111111111111111111111111111111111'

const QUOTE_PARAMS = Object.freeze({
    kind: 'swap',
    chainId: 8453,
    tokenIn: LCX_NATIVE,
    tokenOut: USDC,
    amountIn: '1000000000000000',
    slippageBps: 50,
})
const BUILD_PARAMS = Object.freeze({ kind: 'swap', quoteId: 'q_abc', recipient: RECIPIENT, slippageBps: 50 })

const BUILD_BODY = {
    success: true,
    tx: { to: ROUTER, data: '0xfc54261d00', value: '1000000000000000' },
    approval: null,
}

// Sahte Response: yalniz kullanilan yuzey (status + json()).
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })
const notJson = (status) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
    },
})
const quoteOk = () => reply(200, { success: true, kind: 'swap', data: quoteEthUsdc.data })
const unavailable503 = (reason) => reply(503, { success: false, code: 'lcx_unavailable', reason })
const networkFail = async () => {
    throw new TypeError('Failed to fetch')
}
// Her cagriya sirayla bir yanit verir.
const fetchOf = (...responses) => {
    const fn = vi.fn()
    for (const r of responses) fn.mockImplementationOnce(async () => r)
    return fn
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.unstubAllEnvs()
    vi.stubEnv('VITE_API_URL', 'https://api.example.test')
    _resetLcxCaches()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

describe('hata siniflari', () => {
    it('LcxUnavailableError reason tasir', () => {
        const e = new LcxUnavailableError('timeout')
        expect(e).toBeInstanceOf(Error)
        expect(e.name).toBe('LcxUnavailableError')
        expect(e.reason).toBe('timeout')
    })

    it('LcxRefusalError code ve details tasir', () => {
        const e = new LcxRefusalError('off_peg', { parDeviationBps: 120 })
        expect(e).toBeInstanceOf(Error)
        expect(e.name).toBe('LcxRefusalError')
        expect(e.code).toBe('off_peg')
        expect(e.details).toEqual({ parDeviationBps: 120 })
    })

    it('iki sinif birbirinin altsinifi degil: yedege dusme ve red ayri yakalanir', () => {
        expect(new LcxUnavailableError('network')).not.toBeInstanceOf(LcxRefusalError)
        expect(new LcxRefusalError('x')).not.toBeInstanceOf(LcxUnavailableError)
    })
})

describe('fetchLcxQuote', () => {
    it('POST {VITE_API_URL}/lcx/quote, govde YALNIZ 6 alan, 200 -> data', async () => {
        const fetchImpl = fetchOf(quoteOk())
        const data = await fetchLcxQuote({ ...QUOTE_PARAMS, ekstra: 'sizmamali', apiKey: 'x' }, { fetchImpl })
        expect(data).toEqual(quoteEthUsdc.data)
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        const [url, init] = fetchImpl.mock.calls[0]
        expect(url).toBe('https://api.example.test/lcx/quote')
        expect(init.method).toBe('POST')
        expect(init.headers['Content-Type']).toBe('application/json')
        expect(JSON.parse(init.body)).toEqual(QUOTE_PARAMS)
        expect(Object.keys(JSON.parse(init.body)).sort()).toEqual([
            'amountIn',
            'chainId',
            'kind',
            'slippageBps',
            'tokenIn',
            'tokenOut',
        ])
    })

    it('VITE_API_URL yoksa varsayilan http://localhost:8000; sondaki egik cizgi tekrarlanmaz', async () => {
        vi.stubEnv('VITE_API_URL', '')
        const f1 = fetchOf(quoteOk())
        await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: f1 })
        expect(f1.mock.calls[0][0]).toBe('http://localhost:8000/lcx/quote')

        _resetLcxCaches()
        vi.stubEnv('VITE_API_URL', 'https://api.example.test/')
        const f2 = fetchOf(quoteOk())
        await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: f2 })
        expect(f2.mock.calls[0][0]).toBe('https://api.example.test/lcx/quote')
    })

    it('bigint amountIn ondalik dizge olarak gonderilir', async () => {
        const fetchImpl = fetchOf(quoteOk())
        await fetchLcxQuote({ ...QUOTE_PARAMS, amountIn: 1000000000000000n }, { fetchImpl })
        expect(JSON.parse(fetchImpl.mock.calls[0][1].body).amountIn).toBe('1000000000000000')
    })

    it('fetchImpl verilmezse global fetch kullanilir', async () => {
        const globalFetch = vi.fn(async () => quoteOk())
        vi.stubGlobal('fetch', globalFetch)
        try {
            await fetchLcxQuote(QUOTE_PARAMS)
            expect(globalFetch).toHaveBeenCalledTimes(1)
        } finally {
            vi.unstubAllGlobals()
        }
    })

    describe('ulasilamazlik -> LcxUnavailableError', () => {
        it('503 lcx_unavailable: reason sunucudan gecer', async () => {
            for (const reason of ['disabled', 'quota_exceeded', 'auth', 'upstream_5xx', 'timeout', 'network']) {
                await expect(fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: fetchOf(unavailable503(reason)) })).rejects.toMatchObject({
                    name: 'LcxUnavailableError',
                    reason,
                })
            }
        })

        it('429 (bizim IP limiter): rate_limited', async () => {
            const body = { success: false, code: 'lcx_unavailable', reason: 'rate_limited' }
            await expect(fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: fetchOf(reply(429, body)) })).rejects.toMatchObject({
                name: 'LcxUnavailableError',
                reason: 'rate_limited',
            })
        })

        it('429 govdesi JSON degilse de rate_limited', async () => {
            await expect(fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: fetchOf(notJson(429)) })).rejects.toMatchObject({
                name: 'LcxUnavailableError',
                reason: 'rate_limited',
            })
        })

        it('503 govdesi JSON degil ya da reason yok -> upstream_5xx', async () => {
            await expect(fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: fetchOf(notJson(503)) })).rejects.toMatchObject({
                reason: 'upstream_5xx',
            })
            await expect(
                fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: fetchOf(reply(503, { success: false })) }),
            ).rejects.toMatchObject({ reason: 'upstream_5xx' })
        })

        it('baska durum kodlari (500, 502, 401, 404, 413, 302) -> upstream_5xx', async () => {
            for (const status of [500, 502, 401, 404, 413, 302]) {
                _resetLcxCaches()
                await expect(
                    fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: fetchOf(reply(status, { success: false, code: 'x' })) }),
                ).rejects.toMatchObject({ name: 'LcxUnavailableError', reason: 'upstream_5xx' })
            }
        })

        it('200 ama JSON degil -> upstream_5xx', async () => {
            await expect(fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: fetchOf(notJson(200)) })).rejects.toMatchObject({
                name: 'LcxUnavailableError',
                reason: 'upstream_5xx',
            })
        })

        it('200 ama success:true degil / data yok -> upstream_5xx', async () => {
            for (const body of [
                { success: false, data: quoteEthUsdc.data },
                { data: quoteEthUsdc.data },
                { success: true },
                { success: true, data: null },
                { success: true, data: 'x' },
                null,
                [],
            ]) {
                await expect(fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: fetchOf(reply(200, body)) })).rejects.toMatchObject({
                    name: 'LcxUnavailableError',
                    reason: 'upstream_5xx',
                })
            }
        })

        it('red durum kodunda ama govde bicimi bozuk -> upstream_5xx (kod yok, RED sayilmaz)', async () => {
            for (const body of [{ success: false }, { success: true, code: 'x' }, { success: false, code: 5 }, null]) {
                await expect(fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: fetchOf(reply(409, body)) })).rejects.toMatchObject({
                    name: 'LcxUnavailableError',
                    reason: 'upstream_5xx',
                })
            }
        })

        it('fetch reddi -> network', async () => {
            await expect(fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: vi.fn(networkFail) })).rejects.toMatchObject({
                name: 'LcxUnavailableError',
                reason: 'network',
            })
        })

        it('4000 ms icinde yanit gelmezse timeout (3999 ms de beklenir, 4000 de dusurur)', async () => {
            let signal
            const fetchImpl = vi.fn((_url, init) => {
                signal = init.signal
                return new Promise(() => {})
            })
            let settled = false
            const p = fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            p.catch(() => {}).finally(() => {
                settled = true
            })
            await vi.advanceTimersByTimeAsync(3999)
            expect(settled).toBe(false)
            expect(signal.aborted).toBe(false)
            const assertion = expect(p).rejects.toMatchObject({ name: 'LcxUnavailableError', reason: 'timeout' })
            await vi.advanceTimersByTimeAsync(1)
            await assertion
            expect(signal.aborted).toBe(true)
        })

        it('govde okunurken asilan sure de timeout (baslik geldi, govde gelmedi)', async () => {
            const fetchImpl = vi.fn(async () => ({ status: 200, ok: true, json: () => new Promise(() => {}) }))
            const p = fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            const assertion = expect(p).rejects.toMatchObject({ reason: 'timeout' })
            await vi.advanceTimersByTimeAsync(4000)
            await assertion
        })

        it('zaman asimi sayaci basarida ve hatada temizlenir (sizinti yok)', async () => {
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: fetchOf(quoteOk()) })
            expect(vi.getTimerCount()).toBe(0)
            await expect(
                fetchLcxQuote({ ...QUOTE_PARAMS, amountIn: '2' }, { fetchImpl: fetchOf(unavailable503('auth')) }),
            ).rejects.toBeInstanceOf(LcxUnavailableError)
            expect(vi.getTimerCount()).toBe(0)
        })
    })

    describe('red -> LcxRefusalError', () => {
        it('409 off_peg: code ve details gecer', async () => {
            const details = { parDeviationBps: 120, maxParDeviationBps: 50 }
            const body = { success: false, code: 'off_peg', details }
            const err = await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: fetchOf(reply(409, body)) }).catch((e) => e)
            expect(err).toBeInstanceOf(LcxRefusalError)
            expect(err.code).toBe('off_peg')
            expect(err.details).toEqual(details)
        })

        it.each([400, 409, 410, 422])('%i durumu RED sayilir', async (status) => {
            const body = { success: false, code: 'use_rwa', details: {} }
            await expect(fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: fetchOf(reply(status, body)) })).rejects.toMatchObject({
                name: 'LcxRefusalError',
                code: 'use_rwa',
                details: {},
            })
        })

        it('400 bad_request { field }: red olarak, field details icinde', async () => {
            const body = { success: false, code: 'bad_request', field: 'amountIn' }
            const err = await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: fetchOf(reply(400, body)) }).catch((e) => e)
            expect(err).toBeInstanceOf(LcxRefusalError)
            expect(err.code).toBe('bad_request')
            expect(err.details).toEqual({ field: 'amountIn' })
        })

        it('details yoksa undefined (hata kodu yine gecer)', async () => {
            const err = await fetchLcxQuote(QUOTE_PARAMS, {
                fetchImpl: fetchOf(reply(422, { success: false, code: 'no_route' })),
            }).catch((e) => e)
            expect(err).toBeInstanceOf(LcxRefusalError)
            expect(err.code).toBe('no_route')
            expect(err.details).toBeUndefined()
        })
    })

    describe('onbellek (18 000 ms, anahtar: tum teklif parametreleri)', () => {
        it('ayni arguman 18 000 ms icinde fetch e gitmez; 18 001 ms de gider', async () => {
            const fetchImpl = vi.fn(async () => quoteOk())
            const a = await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            await vi.advanceTimersByTimeAsync(17999)
            const b = await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            expect(fetchImpl).toHaveBeenCalledTimes(1)
            expect(b).toEqual(a)
            await vi.advanceTimersByTimeAsync(1) // 18 000 ms
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            expect(fetchImpl).toHaveBeenCalledTimes(1)
            await vi.advanceTimersByTimeAsync(1) // 18 001 ms
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            expect(fetchImpl).toHaveBeenCalledTimes(2)
        })

        it('yenilenen girdinin suresi yeniden 18 000 ms sayilir', async () => {
            const fetchImpl = vi.fn(async () => quoteOk())
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            await vi.advanceTimersByTimeAsync(18001)
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            await vi.advanceTimersByTimeAsync(10000)
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            expect(fetchImpl).toHaveBeenCalledTimes(2)
        })

        it.each([
            ['amountIn', { amountIn: '2000000000000000' }],
            ['kind', { kind: 'stable' }],
            ['chainId', { chainId: 10 }],
            ['tokenIn', { tokenIn: USDT }],
            ['tokenOut', { tokenOut: USDT }],
            ['slippageBps', { slippageBps: 100 }],
        ])('farkli %s fetch e gider', async (_ad, fark) => {
            const fetchImpl = vi.fn(async () => quoteOk())
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            await fetchLcxQuote({ ...QUOTE_PARAMS, ...fark }, { fetchImpl })
            expect(fetchImpl).toHaveBeenCalledTimes(2)
        })

        it('adres harf buyuklugu farki ayni teklif sayilir', async () => {
            const fetchImpl = vi.fn(async () => quoteOk())
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            await fetchLcxQuote({ ...QUOTE_PARAMS, tokenOut: USDC.toLowerCase() }, { fetchImpl })
            expect(fetchImpl).toHaveBeenCalledTimes(1)
        })

        it('basarisiz yanit (503, red, ag, bozuk) onbellege YAZILMAZ', async () => {
            const fetchImpl = vi
                .fn()
                .mockImplementationOnce(async () => unavailable503('upstream_5xx'))
                .mockImplementationOnce(async () => reply(409, { success: false, code: 'off_peg', details: {} }))
                .mockImplementationOnce(networkFail)
                .mockImplementationOnce(async () => notJson(200))
                .mockImplementationOnce(async () => quoteOk())
            for (let i = 0; i < 4; i += 1) {
                await expect(fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })).rejects.toBeDefined()
            }
            await expect(fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })).resolves.toEqual(quoteEthUsdc.data)
            expect(fetchImpl).toHaveBeenCalledTimes(5)
        })

        it('enjekte edilen now kullanilir (sahte saat)', async () => {
            let t = 1_000_000
            const now = () => t
            const fetchImpl = vi.fn(async () => quoteOk())
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl, now })
            t += 18000
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl, now })
            expect(fetchImpl).toHaveBeenCalledTimes(1)
            t += 1
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl, now })
            expect(fetchImpl).toHaveBeenCalledTimes(2)
        })

        it('_resetLcxCaches teklif onbellegini bosaltir', async () => {
            const fetchImpl = vi.fn(async () => quoteOk())
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            _resetLcxCaches()
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            expect(fetchImpl).toHaveBeenCalledTimes(2)
        })

        // R27: yurutmede LCX_REQUOTE alinca arka plan bu girdiyi siler; yoksa ekranin yeniden teklifi bayat teklifi alir.
        it('evictLcxQuote YALNIZ o anahtari siler: baska teklif ve build onbellegi kalir', async () => {
            const fetchImpl = vi.fn(async () => quoteOk())
            const baska = { ...QUOTE_PARAMS, amountIn: '2000000000000000' }
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            await fetchLcxQuote(baska, { fetchImpl })
            const buildFetch = fetchOf(reply(200, BUILD_BODY))
            await fetchLcxBuild(BUILD_PARAMS, { fetchImpl: buildFetch })
            expect(fetchImpl).toHaveBeenCalledTimes(2)

            evictLcxQuote(QUOTE_PARAMS)

            await fetchLcxQuote(baska, { fetchImpl })
            expect(fetchImpl).toHaveBeenCalledTimes(2) // baska girdi hala onbellekte
            await fetchLcxBuild(BUILD_PARAMS, { fetchImpl: buildFetch })
            expect(buildFetch).toHaveBeenCalledTimes(1) // build onbellegine dokunulmadi
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            expect(fetchImpl).toHaveBeenCalledTimes(3) // silinen girdi yeniden sunucuya gitti
        })

        it('evictLcxQuote fetchLcxQuote ile AYNI anahtari kullanir: bigint tutar ve adres harf buyuklugu farki ayni girdidir', async () => {
            const fetchImpl = vi.fn(async () => quoteOk())
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            evictLcxQuote({ ...QUOTE_PARAMS, tokenIn: LCX_NATIVE.toUpperCase().replace('0X', '0x'), tokenOut: USDC.toLowerCase(), amountIn: 1000000000000000n })
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            expect(fetchImpl).toHaveBeenCalledTimes(2)
        })

        it('evictLcxQuote: kind, zincir, tutar, kayma ya da token farkliysa o girdi SILINMEZ; olmayan girdi hata vermez', async () => {
            const fetchImpl = vi.fn(async () => quoteOk())
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            for (const fark of [{ kind: 'stable' }, { chainId: 1 }, { amountIn: '1' }, { slippageBps: 100 }, { tokenOut: USDT }]) {
                expect(() => evictLcxQuote({ ...QUOTE_PARAMS, ...fark })).not.toThrow()
            }
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl })
            expect(fetchImpl).toHaveBeenCalledTimes(1)
        })

        it('onbellek sinirsiz buyumez: cok sayida farkli teklifte eski girdiler atilir', async () => {
            const fetchImpl = vi.fn(async () => quoteOk())
            for (let i = 1; i <= 200; i += 1) {
                await fetchLcxQuote({ ...QUOTE_PARAMS, amountIn: String(i) }, { fetchImpl })
            }
            expect(fetchImpl).toHaveBeenCalledTimes(200)
            // En yeni girdi hala onbellekte, en eski atilmis.
            await fetchLcxQuote({ ...QUOTE_PARAMS, amountIn: '200' }, { fetchImpl })
            expect(fetchImpl).toHaveBeenCalledTimes(200)
            await fetchLcxQuote({ ...QUOTE_PARAMS, amountIn: '1' }, { fetchImpl })
            expect(fetchImpl).toHaveBeenCalledTimes(201)
        })
    })
})

describe('fetchLcxBuild', () => {
    const buildOk = (body = BUILD_BODY) => reply(200, body)

    it('POST {VITE_API_URL}/lcx/build, govde YALNIZ 4 alan, 200 -> { tx, approval }', async () => {
        const fetchImpl = fetchOf(buildOk())
        const out = await fetchLcxBuild({ ...BUILD_PARAMS, ekstra: 1 }, { fetchImpl })
        expect(out).toEqual({ tx: BUILD_BODY.tx, approval: null })
        const [url, init] = fetchImpl.mock.calls[0]
        expect(url).toBe('https://api.example.test/lcx/build')
        expect(init.method).toBe('POST')
        expect(init.headers['Content-Type']).toBe('application/json')
        expect(JSON.parse(init.body)).toEqual(BUILD_PARAMS)
        expect(Object.keys(JSON.parse(init.body)).sort()).toEqual(['kind', 'quoteId', 'recipient', 'slippageBps'])
    })

    it('approval { target } oldugu gibi gecer; yoksa null', async () => {
        const withApproval = await fetchLcxBuild(BUILD_PARAMS, {
            fetchImpl: fetchOf(buildOk({ ...BUILD_BODY, approval: { target: ROUTER } })),
        })
        expect(withApproval.approval).toEqual({ target: ROUTER })
        _resetLcxCaches()
        const bodyWithoutApproval = { success: true, tx: BUILD_BODY.tx }
        const without = await fetchLcxBuild(BUILD_PARAMS, { fetchImpl: fetchOf(buildOk(bodyWithoutApproval)) })
        expect(without.approval).toBeNull()
    })

    it('gercek build fikstur govdesi sunucu bicimine sarilarak parse edilir', async () => {
        const swap = buildEthUsdc.data.swap
        const body = { success: true, tx: { to: swap.to, data: swap.data, value: swap.value }, approval: null }
        const out = await fetchLcxBuild(BUILD_PARAMS, { fetchImpl: fetchOf(buildOk(body)) })
        expect(out.tx).toEqual({ to: swap.to, data: swap.data, value: swap.value })
    })

    describe('tx ve approval sekil denetimi (R17): bozuksa upstream_5xx, onbellege yazilmaz', () => {
        const upstream = (body) => fetchLcxBuild(BUILD_PARAMS, { fetchImpl: fetchOf(reply(200, body)) })
        const withTx = (tx) => ({ success: true, tx, approval: null })
        const withApproval = (approval) => ({ success: true, tx: BUILD_BODY.tx, approval })

        it.each([
            ['to yok', { data: '0xfc54261d', value: '0' }],
            ['data yok', { to: ROUTER, value: '0' }],
            ['value yok', { to: ROUTER, data: '0xfc54261d' }],
            ['to sayi', { to: 5, data: '0xfc54261d', value: '0' }],
            ['data null', { to: ROUTER, data: null, value: '0' }],
            ['value sayi', { to: ROUTER, data: '0xfc54261d', value: 0 }],
            ['value bigint benzeri nesne', { to: ROUTER, data: '0xfc54261d', value: {} }],
            ['tx dizi', []],
            ['tx dizge', '0xfc54261d'],
        ])('tx bozuk (%s) -> upstream_5xx', async (_ad, tx) => {
            await expect(upstream(withTx(tx))).rejects.toMatchObject({ name: 'LcxUnavailableError', reason: 'upstream_5xx' })
        })

        it('gecerli tx (string to, data, value) gecer; value "0" ve hex de string sayilir', async () => {
            await expect(upstream(withTx({ to: ROUTER, data: '0xfc54261d', value: '0' }))).resolves.toMatchObject({ approval: null })
            _resetLcxCaches()
            await expect(upstream(withTx({ to: ROUTER, data: '0xfc54261d', value: '0x0' }))).resolves.toBeDefined()
        })

        it.each([
            ['dizge', 'router'],
            ['dizi', [{ target: ROUTER }]],
            ['sayi', 5],
            ['true', true],
            ['bos nesne', {}],
            ['target yok (baska alan)', { spender: ROUTER }],
            ['target sayi', { target: 5 }],
            ['target null', { target: null }],
            ['target adres degil', { target: 'router' }],
            ['target kisa adres', { target: '0x1234' }],
            ['target fazla hane', { target: `${ROUTER}00` }],
            ['target 0x siz', { target: ROUTER.slice(2) }],
        ])('approval bozuk (%s) -> upstream_5xx', async (_ad, approval) => {
            await expect(upstream(withApproval(approval))).rejects.toMatchObject({
                name: 'LcxUnavailableError',
                reason: 'upstream_5xx',
            })
        })

        it('approval null / yok / undefined gecerli (null olarak doner); { target: adres } gecer', async () => {
            expect((await upstream(withApproval(null))).approval).toBeNull()
            _resetLcxCaches()
            expect((await upstream({ success: true, tx: BUILD_BODY.tx })).approval).toBeNull()
            _resetLcxCaches()
            expect((await upstream(withApproval(undefined))).approval).toBeNull()
            _resetLcxCaches()
            expect((await upstream(withApproval({ target: ROUTER }))).approval).toEqual({ target: ROUTER })
            _resetLcxCaches()
            expect((await upstream(withApproval({ target: ROUTER.toLowerCase() }))).approval).toEqual({ target: ROUTER.toLowerCase() })
        })

        it('bozuk build onbellege YAZILMAZ: ayni anahtarla sonraki cagri yeniden fetch eder', async () => {
            const fetchImpl = vi
                .fn()
                .mockImplementationOnce(async () => reply(200, withApproval({ target: 'router' })))
                .mockImplementationOnce(async () => reply(200, withTx({ to: ROUTER, data: '0x' })))
                .mockImplementationOnce(async () => buildOk())
            await expect(fetchLcxBuild(BUILD_PARAMS, { fetchImpl })).rejects.toBeInstanceOf(LcxUnavailableError)
            await expect(fetchLcxBuild(BUILD_PARAMS, { fetchImpl })).rejects.toBeInstanceOf(LcxUnavailableError)
            await expect(fetchLcxBuild(BUILD_PARAMS, { fetchImpl })).resolves.toMatchObject({ tx: BUILD_BODY.tx })
            expect(fetchImpl).toHaveBeenCalledTimes(3)
        })
    })

    it('503 / 429 -> LcxUnavailableError; red -> LcxRefusalError; bozuk -> upstream_5xx', async () => {
        await expect(fetchLcxBuild(BUILD_PARAMS, { fetchImpl: fetchOf(unavailable503('timeout')) })).rejects.toMatchObject({
            name: 'LcxUnavailableError',
            reason: 'timeout',
        })
        await expect(
            fetchLcxBuild(BUILD_PARAMS, {
                fetchImpl: fetchOf(reply(429, { success: false, code: 'lcx_unavailable', reason: 'rate_limited' })),
            }),
        ).rejects.toMatchObject({ name: 'LcxUnavailableError', reason: 'rate_limited' })
        await expect(
            fetchLcxBuild(BUILD_PARAMS, { fetchImpl: fetchOf(reply(410, { success: false, code: 'quote_expired', details: {} })) }),
        ).rejects.toMatchObject({ name: 'LcxRefusalError', code: 'quote_expired' })
        for (const body of [{ success: true }, { success: true, tx: null }, { success: false, tx: BUILD_BODY.tx }, null]) {
            await expect(fetchLcxBuild(BUILD_PARAMS, { fetchImpl: fetchOf(reply(200, body)) })).rejects.toMatchObject({
                name: 'LcxUnavailableError',
                reason: 'upstream_5xx',
            })
        }
        await expect(fetchLcxBuild(BUILD_PARAMS, { fetchImpl: vi.fn(networkFail) })).rejects.toMatchObject({
            reason: 'network',
        })
    })

    it('4000 ms zaman asimi -> timeout', async () => {
        const fetchImpl = vi.fn(() => new Promise(() => {}))
        const p = fetchLcxBuild(BUILD_PARAMS, { fetchImpl })
        const assertion = expect(p).rejects.toMatchObject({ name: 'LcxUnavailableError', reason: 'timeout' })
        await vi.advanceTimersByTimeAsync(4000)
        await assertion
    })

    describe('onbellek (18 000 ms, anahtar: quoteId|recipient|slippageBps)', () => {
        it('ayni anahtar 18 000 ms icinde fetch e gitmez; 18 001 ms de gider', async () => {
            const fetchImpl = vi.fn(async () => buildOk())
            const a = await fetchLcxBuild(BUILD_PARAMS, { fetchImpl })
            await vi.advanceTimersByTimeAsync(18000)
            const b = await fetchLcxBuild(BUILD_PARAMS, { fetchImpl })
            expect(fetchImpl).toHaveBeenCalledTimes(1)
            expect(b).toEqual(a)
            await vi.advanceTimersByTimeAsync(1)
            await fetchLcxBuild(BUILD_PARAMS, { fetchImpl })
            expect(fetchImpl).toHaveBeenCalledTimes(2)
        })

        it.each([
            ['quoteId', { quoteId: 'q_baska' }],
            ['recipient', { recipient: '0x2222222222222222222222222222222222222222' }],
            ['slippageBps', { slippageBps: 100 }],
        ])('farkli %s fetch e gider', async (_ad, fark) => {
            const fetchImpl = vi.fn(async () => buildOk())
            await fetchLcxBuild(BUILD_PARAMS, { fetchImpl })
            await fetchLcxBuild({ ...BUILD_PARAMS, ...fark }, { fetchImpl })
            expect(fetchImpl).toHaveBeenCalledTimes(2)
        })

        it('basarisiz build onbellege yazilmaz', async () => {
            const fetchImpl = vi
                .fn()
                .mockImplementationOnce(async () => unavailable503('timeout'))
                .mockImplementationOnce(async () => buildOk())
            await expect(fetchLcxBuild(BUILD_PARAMS, { fetchImpl })).rejects.toBeInstanceOf(LcxUnavailableError)
            await expect(fetchLcxBuild(BUILD_PARAMS, { fetchImpl })).resolves.toMatchObject({ tx: BUILD_BODY.tx })
            expect(fetchImpl).toHaveBeenCalledTimes(2)
        })

        it('build ve teklif onbellekleri birbirinden bagimsiz; _resetLcxCaches ikisini de bosaltir', async () => {
            const buildFetch = vi.fn(async () => buildOk())
            const quoteFetch = vi.fn(async () => quoteOk())
            await fetchLcxBuild(BUILD_PARAMS, { fetchImpl: buildFetch })
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: quoteFetch })
            await fetchLcxBuild(BUILD_PARAMS, { fetchImpl: buildFetch })
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: quoteFetch })
            expect(buildFetch).toHaveBeenCalledTimes(1)
            expect(quoteFetch).toHaveBeenCalledTimes(1)
            _resetLcxCaches()
            await fetchLcxBuild(BUILD_PARAMS, { fetchImpl: buildFetch })
            await fetchLcxQuote(QUOTE_PARAMS, { fetchImpl: quoteFetch })
            expect(buildFetch).toHaveBeenCalledTimes(2)
            expect(quoteFetch).toHaveBeenCalledTimes(2)
        })
    })
})

describe('fetchLcxStablecoins', () => {
    const body = (chains) => ({ success: true, chains })
    const BASE_COINS = [
        { address: USDC, symbol: 'USDC', decimals: 6, currency: 'USD' },
        { address: USDT, symbol: 'USDT', decimals: 6, currency: 'USD' },
    ]

    it('GET {VITE_API_URL}/lcx/stablecoins; Map(chainId -> Set(kucuk harf adresler))', async () => {
        const fetchImpl = fetchOf(reply(200, body([{ chainId: 8453, coins: BASE_COINS }])))
        const map = await fetchLcxStablecoins({ fetchImpl })
        const [url, init] = fetchImpl.mock.calls[0]
        expect(url).toBe('https://api.example.test/lcx/stablecoins')
        expect(init.method).toBe('GET')
        expect(map).toBeInstanceOf(Map)
        expect([...map.keys()]).toEqual([8453])
        expect(map.get(8453)).toEqual(new Set([USDC.toLowerCase(), USDT.toLowerCase()]))
    })

    it('gercek fikstur: sarilmis govde, her agin kumesi, adresler kucuk harf', async () => {
        const map = await fetchLcxStablecoins({
            fetchImpl: fetchOf(reply(200, body(stablecoinsFixture.data.chains))),
        })
        expect(map.size).toBe(stablecoinsFixture.data.chains.length)
        const base = stablecoinsFixture.data.chains.find((c) => c.chainId === 8453)
        expect(map.get(8453).size).toBe(base.coins.length)
        expect(map.get(8453).has(USDC.toLowerCase())).toBe(true)
        expect(map.get(8453).has(USDC)).toBe(false)
        for (const set of map.values()) for (const a of set) expect(a).toBe(a.toLowerCase())
    })

    it('1 saat onbellek: 3 600 000 ms icinde fetch e gitmez, 3 600 001 ms de gider', async () => {
        const fetchImpl = vi.fn(async () => reply(200, body([{ chainId: 8453, coins: BASE_COINS }])))
        const a = await fetchLcxStablecoins({ fetchImpl })
        await vi.advanceTimersByTimeAsync(3_600_000)
        const b = await fetchLcxStablecoins({ fetchImpl })
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(b).toEqual(a)
        await vi.advanceTimersByTimeAsync(1)
        await fetchLcxStablecoins({ fetchImpl })
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('hata -> bos Map (stable yolu kapanir, genel takas surer); firlatmaz', async () => {
        const cases = [
            vi.fn(async () => unavailable503('disabled')),
            vi.fn(async () => reply(429, { success: false, code: 'lcx_unavailable', reason: 'rate_limited' })),
            vi.fn(async () => reply(500, {})),
            vi.fn(async () => notJson(200)),
            vi.fn(async () => reply(200, { success: true })),
            vi.fn(async () => reply(200, { success: true, chains: 'x' })),
            vi.fn(async () => reply(409, { success: false, code: 'nope' })),
            vi.fn(networkFail),
        ]
        for (const fetchImpl of cases) {
            _resetLcxCaches()
            const map = await fetchLcxStablecoins({ fetchImpl })
            expect(map).toBeInstanceOf(Map)
            expect(map.size).toBe(0)
        }
    })

    it('zaman asimi (4000 ms) -> bos Map', async () => {
        const fetchImpl = vi.fn(() => new Promise(() => {}))
        const p = fetchLcxStablecoins({ fetchImpl })
        await vi.advanceTimersByTimeAsync(4000)
        const map = await p
        expect(map).toBeInstanceOf(Map)
        expect(map.size).toBe(0)
    })

    it('basarisizlik onbellege yazilmaz: sonraki cagri yeniden dener ve basarirsa onbellekler', async () => {
        const fetchImpl = vi
            .fn()
            .mockImplementationOnce(async () => unavailable503('timeout'))
            .mockImplementationOnce(async () => reply(200, body([{ chainId: 8453, coins: BASE_COINS }])))
        expect((await fetchLcxStablecoins({ fetchImpl })).size).toBe(0)
        const ok = await fetchLcxStablecoins({ fetchImpl })
        expect(ok.get(8453).size).toBe(2)
        await fetchLcxStablecoins({ fetchImpl })
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('gecerli ama bos liste onbellege yazilmaz (bir saat boyunca stable yolunu kapatmasin)', async () => {
        const fetchImpl = vi.fn(async () => reply(200, body([])))
        expect((await fetchLcxStablecoins({ fetchImpl })).size).toBe(0)
        await fetchLcxStablecoins({ fetchImpl })
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('bozuk ag/kayit satirlari atlanir, gecerli olanlar kalir', async () => {
        const map = await fetchLcxStablecoins({
            fetchImpl: fetchOf(
                reply(
                    200,
                    body([
                        { chainId: 'x', coins: BASE_COINS },
                        { chainId: 10, coins: 'yok' },
                        null,
                        { chainId: 8453, coins: [null, { symbol: 'X' }, { address: 5 }, BASE_COINS[0]] },
                    ]),
                ),
            ),
        })
        expect([...map.keys()]).toEqual([8453])
        expect(map.get(8453)).toEqual(new Set([USDC.toLowerCase()]))
    })

    it('_resetLcxCaches stablecoin kaydini da bosaltir', async () => {
        const fetchImpl = vi.fn(async () => reply(200, body([{ chainId: 8453, coins: BASE_COINS }])))
        await fetchLcxStablecoins({ fetchImpl })
        _resetLcxCaches()
        await fetchLcxStablecoins({ fetchImpl })
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })
})

describe('fetchLcxStocks', () => {
    const ROW = {
        chainId: 8453,
        address: '0xb2000000000000000000001e800a7f5189430cD0',
        symbol: 'TSLAC',
        name: 'Tesla (Coinbase Tokenized Stocks)',
        decimals: 8,
        issuer: 'coinbase',
        underlying: 'TSLA',
        category: 'stocks',
        priceUsd: 388.61280861,
        priceSource: 'Chainlink Coinbase TSLA on Base',
        priceUpdatedAt: 1795071867,
        marketHours: 'us_equities',
        depthUsd: 252144.395038,
    }
    const body = (extra = {}) => ({ success: true, usEquitiesOpen: true, asOf: 1795100000000, rows: [ROW], ...extra })

    it('GET {VITE_API_URL}/lcx/stocks (govde yok); 200 -> { usEquitiesOpen, asOf, rows } aynen', async () => {
        const fetchImpl = fetchOf(reply(200, body()))
        const out = await fetchLcxStocks({ fetchImpl })
        const [url, init] = fetchImpl.mock.calls[0]
        expect(url).toBe('https://api.example.test/lcx/stocks')
        expect(init.method).toBe('GET')
        expect(init.body).toBeUndefined()
        expect(out).toEqual({ usEquitiesOpen: true, asOf: 1795100000000, rows: [ROW] })
    })

    it('usEquitiesOpen false ve bos satir listesi gecerli govdedir', async () => {
        const out = await fetchLcxStocks({ fetchImpl: fetchOf(reply(200, body({ usEquitiesOpen: false, rows: [] }))) })
        expect(out).toEqual({ usEquitiesOpen: false, asOf: 1795100000000, rows: [] })
    })

    it('asOf yoksa ya da sayi degilse null (eski sunucu)', async () => {
        for (const asOf of [undefined, null, 'x', NaN]) {
            const out = await fetchLcxStocks({ fetchImpl: fetchOf(reply(200, body({ asOf }))) })
            expect(out.asOf, String(asOf)).toBeNull()
        }
    })

    it('200 ama bozuk govde (success:true degil, rows dizi degil, usEquitiesOpen mantiksal degil, JSON degil) -> LcxUnavailableError', async () => {
        const bad = [
            reply(200, { success: false, usEquitiesOpen: true, rows: [] }),
            reply(200, { usEquitiesOpen: true, rows: [] }),
            reply(200, body({ rows: 'x' })),
            reply(200, body({ rows: undefined })),
            reply(200, body({ rows: null })),
            reply(200, body({ rows: {} })),
            reply(200, body({ usEquitiesOpen: 'yes' })),
            reply(200, body({ usEquitiesOpen: undefined })),
            reply(200, null),
            notJson(200),
        ]
        for (const res of bad) {
            await expect(fetchLcxStocks({ fetchImpl: fetchOf(res) })).rejects.toMatchObject({ name: 'LcxUnavailableError' })
        }
    })

    it('200 olmayan durumlar -> LcxUnavailableError (reason sunucudan: 503, 429; digerleri upstream_5xx)', async () => {
        await expect(fetchLcxStocks({ fetchImpl: fetchOf(unavailable503('disabled')) })).rejects.toMatchObject({
            name: 'LcxUnavailableError',
            reason: 'disabled',
        })
        await expect(
            fetchLcxStocks({ fetchImpl: fetchOf(reply(429, { success: false, code: 'lcx_unavailable', reason: 'rate_limited' })) }),
        ).rejects.toMatchObject({ name: 'LcxUnavailableError', reason: 'rate_limited' })
        for (const status of [500, 502, 401, 404, 302]) {
            await expect(fetchLcxStocks({ fetchImpl: fetchOf(reply(status, { success: false })) })).rejects.toMatchObject({
                name: 'LcxUnavailableError',
                reason: 'upstream_5xx',
            })
        }
    })

    it('bilincli red durum kodlari (400/409/410/422) bu uc icin de LcxUnavailableError olur (LcxRefusalError DEGIL)', async () => {
        for (const status of [400, 409, 410, 422]) {
            const err = await fetchLcxStocks({
                fetchImpl: fetchOf(reply(status, { success: false, code: 'bad_request' })),
            }).catch((e) => e)
            expect(err).toBeInstanceOf(LcxUnavailableError)
            expect(err).not.toBeInstanceOf(LcxRefusalError)
            expect(err.reason).toBe('upstream_5xx')
        }
    })

    it('ag hatasi -> network; 4000 ms asimi -> timeout', async () => {
        await expect(fetchLcxStocks({ fetchImpl: vi.fn(networkFail) })).rejects.toMatchObject({
            name: 'LcxUnavailableError',
            reason: 'network',
        })
        const fetchImpl = vi.fn(() => new Promise(() => {}))
        const p = fetchLcxStocks({ fetchImpl })
        const assertion = expect(p).rejects.toMatchObject({ name: 'LcxUnavailableError', reason: 'timeout' })
        await vi.advanceTimersByTimeAsync(4000)
        await assertion
    })

    it('onbellek YOK: iki ardisik cagri iki fetch', async () => {
        const fetchImpl = vi.fn(async () => reply(200, body()))
        await fetchLcxStocks({ fetchImpl })
        await fetchLcxStocks({ fetchImpl })
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('basarisizlik sonraki cagriyi etkilemez; _resetLcxCaches gerekmez', async () => {
        const fetchImpl = vi
            .fn()
            .mockImplementationOnce(async () => unavailable503('timeout'))
            .mockImplementationOnce(async () => reply(200, body()))
        await expect(fetchLcxStocks({ fetchImpl })).rejects.toBeInstanceOf(LcxUnavailableError)
        expect((await fetchLcxStocks({ fetchImpl })).rows).toHaveLength(1)
    })
})
