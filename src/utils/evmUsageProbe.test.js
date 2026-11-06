import { describe, it, expect, vi, afterEach } from 'vitest'
import { Interface } from 'ethers'
import { scanChains, probeEvmAddress, PROBE_CALL_TIMEOUT_MS } from './evmUsageProbe'
import { MULTICALL3_ADDRESS, usageTokenAddressesFor } from './evmUsageTokens'

// Sahte fetch: plan(url, method) -> '0x0' | '0x1' | ... (hex sonuc) ya da bir hata turu:
//   'throw'   fetch reddeder
//   'http500' !res.ok
//   'rpcerror' JSON-RPC error govdesi
//   'nothex'  result hex degil
//   'hang'    init.signal iptal olunca reddeden asili istek
function fakeFetch(plan) {
    return vi.fn((url, init) => {
        const { method, params } = JSON.parse(init.body)
        const kind = plan(url, method, params)
        if (kind === 'throw') return Promise.reject(new Error('network down'))
        if (kind === 'hang') {
            return new Promise((_, reject) => {
                if (init.signal.aborted) return reject(new Error('aborted'))
                init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
            })
        }
        if (kind === 'http500') return Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
        if (kind === 'rpcerror') {
            return Promise.resolve({ ok: true, status: 200, json: async () => ({ error: { code: -32005 } }) })
        }
        if (kind === 'nothex') {
            return Promise.resolve({ ok: true, status: 200, json: async () => ({ result: 'oops' }) })
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: kind }) })
    })
}

const A = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const TWO = [
    { chainId: 1, urls: ['https://a1', 'https://a2'] },
    { chainId: 56, urls: ['https://b1'] },
]

function run(plan, chains = TWO, extra = {}) {
    const fetchImpl = fakeFetch(plan)
    return { fetchImpl, promise: probeEvmAddress(A, { chains, fetchImpl, ...extra }) }
}

afterEach(() => {
    vi.useRealTimers()
})

describe('scanChains', () => {
    it('scanChains gercek veride tam 10 EVM agi verir', () => {
        expect(
            scanChains()
                .map((c) => c.chainId)
                .sort((a, b) => a - b)
        ).toEqual([1, 10, 25, 56, 100, 137, 5000, 8453, 42161, 42220])
        expect(scanChains().every((c) => c.urls.length >= 1)).toBe(true)
    })

    it('gercek 10 agin hepsi sabit token listesini (adres dizisi) tasir', () => {
        for (const c of scanChains()) {
            expect(c.tokens, `zincir ${c.chainId}`).toEqual(usageTokenAddressesFor(c.chainId))
            expect(c.tokens.length).toBeGreaterThanOrEqual(1)
            expect(c.tokens.length).toBeLessThanOrEqual(6)
        }
    })

    it('Solana, TON ve RPC si olmayan kayitlari eler', () => {
        const chains = [
            { chainId: 1, rpc: [{ url: 'https://eth.example' }] },
            { chainId: 'solana-mainnet', vm: 'solana', rpc: [{ url: 'https://sol.example' }] },
            { chainId: -239, kind: 'ton', rpc: [{ url: 'https://ton.example' }] },
            { chainId: 99, rpc: [] },
        ]
        expect(scanChains(chains)).toEqual([
            { chainId: 1, urls: ['https://eth.example'], tokens: usageTokenAddressesFor(1) },
        ])
    })
})

describe('probeEvmAddress', () => {
    it('istek bicimi: POST, JSON-RPC 2.0, iki yontem, [adres, "latest"]', async () => {
        const { fetchImpl, promise } = run(() => '0x0')
        await promise
        const bodies = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body))
        expect(fetchImpl.mock.calls.every(([, init]) => init.method === 'POST')).toBe(true)
        expect(bodies.map((b) => b.method).sort()).toEqual([
            'eth_getBalance',
            'eth_getBalance',
            'eth_getTransactionCount',
            'eth_getTransactionCount',
        ])
        expect(bodies.every((b) => b.jsonrpc === '2.0' && b.params[0] === A && b.params[1] === 'latest')).toBe(true)
    })

    it("nonce > 0 olan tek ag 'used' yapar", async () => {
        expect(
            await run((u, m) => (u === 'https://b1' && m === 'eth_getTransactionCount' ? '0x1' : '0x0')).promise
        ).toBe('used')
    })

    it("yalniz bakiye > 0 ise 'used'", async () => {
        expect(await run((u, m) => (m === 'eth_getBalance' ? '0x1bc16d674ec80000' : '0x0')).promise).toBe('used')
    })

    it("hepsi 0x0 ise 'unused'", async () => {
        expect(await run(() => '0x0').promise).toBe('unused')
    })

    it("bir ag tamamen hata verse de digerleri 0x0 diyorsa 'unused'", async () => {
        expect(await run((u) => (u === 'https://b1' ? 'throw' : '0x0')).promise).toBe('unused')
    })

    it('birinci URL tamamen hata verirse ikinci URL denenir', async () => {
        const { fetchImpl, promise } = run((u) => (u === 'https://a1' ? 'throw' : u === 'https://a2' ? '0x1' : '0x0'))
        expect(await promise).toBe('used')
        expect(fetchImpl.mock.calls.some(([u]) => u === 'https://a2')).toBe(true)
    })

    it("'used' bulununca bekleyen istekler iptal edilir", async () => {
        const { fetchImpl, promise } = run((u, m) =>
            u === 'https://b1' ? 'hang' : m === 'eth_getTransactionCount' ? '0x1' : '0x0'
        )
        expect(await promise).toBe('used')
        const hung = fetchImpl.mock.calls.find(([u]) => u === 'https://b1')
        expect(hung[1].signal.aborted).toBe(true)
    })

    it("her agin her URL'si hata verirse 'failed' (reddetme, HTTP 500, rpc hatasi, hex olmayan)", async () => {
        const plan = (u, m) =>
            u === 'https://a1' ? 'throw' : u === 'https://a2' ? 'http500' : m === 'eth_getBalance' ? 'rpcerror' : 'nothex'
        expect(await run(plan).promise).toBe('failed')
    })

    it('zaman asimi: asili istek PROBE_CALL_TIMEOUT_MS sonra hata sayilir', async () => {
        vi.useFakeTimers()
        const { promise } = run(() => 'hang', [{ chainId: 1, urls: ['https://a1', 'https://a2'] }])
        await vi.advanceTimersByTimeAsync(PROBE_CALL_TIMEOUT_MS * 2 + 50)
        await expect(promise).resolves.toBe('failed')
    })

    it("cagiranin signal'i iptal edilirse asili istekler birakilir ve 'failed' doner", async () => {
        const ctrl = new AbortController()
        const { promise } = run(() => 'hang', TWO, { signal: ctrl.signal })
        ctrl.abort()
        expect(await promise).toBe('failed')
    })

    // --- Defter karari: iptal edilmis sinyalle yeni URL/istek denenmez ---------------------

    it('onceden iptal edilmis signal ile hic istek atilmaz ve failed doner', async () => {
        const ctrl = new AbortController()
        ctrl.abort()
        const { fetchImpl, promise } = run(() => '0x0', TWO, { signal: ctrl.signal })
        expect(await promise).toBe('failed')
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('iptal sonrasi ikinci URL denenmez (birinci URL iptalle dusunce)', async () => {
        const ctrl = new AbortController()
        const { fetchImpl, promise } = run(() => 'hang', [{ chainId: 1, urls: ['https://a1', 'https://a2'] }], {
            signal: ctrl.signal,
        })
        // Birinci URL'ye istek gitmis olsun, sonra iptal et.
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(fetchImpl.mock.calls.some(([u]) => u === 'https://a1')).toBe(true)
        ctrl.abort()
        expect(await promise).toBe('failed')
        expect(fetchImpl.mock.calls.some(([u]) => u === 'https://a2')).toBe(false)
    })

    it("iptal edilince baska agin 'unused' demis olmasi sonucu 'unused' yapmaz (yarim yoklama)", async () => {
        const ctrl = new AbortController()
        const { promise } = run((u) => (u === 'https://b1' ? 'hang' : '0x0'), TWO, { signal: ctrl.signal })
        // Ethereum agi (0x0) bitsin, BSC asili kalsin; sonra iptal et.
        await new Promise((resolve) => setTimeout(resolve, 0))
        ctrl.abort()
        expect(await promise).toBe('failed')
    })

    // --- Sozlesme: asla firlatmaz ---------------------------------------------------------

    it('fetchImpl senkron firlatsa bile firlatmaz, failed doner', async () => {
        const fetchImpl = vi.fn(() => {
            throw new Error('boom')
        })
        await expect(probeEvmAddress(A, { chains: TWO, fetchImpl })).resolves.toBe('failed')
    })

    it("fetchImpl yalin fonksiyon olarak cagrilir (this yok): tarayici fetch'i baska nesne uzerinden cagrilirsa 'Illegal invocation' firlatir", async () => {
        const seen = []
        const fetchImpl = function (url, init) {
            seen.push(this)
            return Promise.resolve({ ok: true, status: 200, json: async () => ({ result: '0x0' }) })
        }
        expect(await probeEvmAddress(A, { chains: TWO, fetchImpl })).toBe('unused')
        expect(seen.length).toBeGreaterThan(0)
        expect(seen.every((t) => t === undefined || t === globalThis)).toBe(true)
    })

    it('bozuk chains girdisi firlatmaz, failed doner', async () => {
        await expect(probeEvmAddress(A, { chains: null, fetchImpl: fakeFetch(() => '0x0') })).resolves.toBe('failed')
    })

    it('ag listesi bos ise failed (hicbir sey sorulamadi)', async () => {
        const { fetchImpl, promise } = run(() => '0x0', [])
        expect(await promise).toBe('failed')
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('hex olmayan sonuc (0x, bos ya da bosluklu) hata sayilir', async () => {
        expect(await run(() => '0x').promise).toBe('failed')
        expect(await run(() => '0x1 ').promise).toBe('failed')
    })

    it('zaman asimi ozel timeoutMs ile kisaltilabilir', async () => {
        vi.useFakeTimers()
        const { promise } = run(() => 'hang', [{ chainId: 1, urls: ['https://a1'] }], { timeoutMs: 100 })
        await vi.advanceTimersByTimeAsync(150)
        await expect(promise).resolves.toBe('failed')
    })

    it('fetch signal i yok sayan bir fetchImpl bile zaman asiminda birakilir', async () => {
        vi.useFakeTimers()
        const fetchImpl = vi.fn(() => new Promise(() => {})) // iptali dinlemez, hic donmez
        const promise = probeEvmAddress(A, { chains: [{ chainId: 1, urls: ['https://a1'] }], fetchImpl })
        await vi.advanceTimersByTimeAsync(PROBE_CALL_TIMEOUT_MS + 50)
        await expect(promise).resolves.toBe('failed')
    })
})

// --- Token bakiyesi sinyali (kullanici karari 2026-11-03: "bulunsun") ---------------------------
// nonce 0 + yerli bakiye 0 olsa bile sabit listedeki bir tokenden balanceOf > 0 ise hesap
// KULLANILMISTIR. Ag basina tek ek RPC cagrisi: Multicall3.aggregate3 (allowFailure=true) tek eth_call.

const MC = new Interface([
    'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)',
])
const word = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0')
const aggResult = (entries) => MC.encodeFunctionResult('aggregate3', [entries])
const ok = (n) => [true, word(n)]
const callCount = (params) => MC.decodeFunctionData('aggregate3', params[0].data)[0].length
const methodOf = ([, init]) => JSON.parse(init.body).method

const T1 = usageTokenAddressesFor(1)
const TOK = [{ chainId: 1, urls: ['https://a1'], tokens: T1 }] // 3 token
const zeros = (n) => aggResult(Array.from({ length: n }, () => ok(0)))

// plan: nonce/bakiye 0; eth_call icin `tokenKind` (hex sonuc ya da hata turu).
const tokPlan = (tokenKind, base = '0x0') => (u, m) => (m === 'eth_call' ? tokenKind : base)

describe('probeEvmAddress: token bakiyesi sinyali', () => {
    it("YALNIZ TOKEN: nonce 0, yerli bakiye 0, USDT > 0 -> 'used'", async () => {
        const plan = tokPlan(aggResult([ok(2_500_000), ok(0), ok(0)]))
        expect(await run(plan, TOK).promise).toBe('used')
    })

    it('ucuncu tokendeki bakiye de yeter (listenin herhangi bir elemani)', async () => {
        expect(await run(tokPlan(aggResult([ok(0), ok(0), ok(1)])), TOK).promise).toBe('used')
    })

    it("hic token bakiyesi yoksa (hepsi 0) 'unused'", async () => {
        expect(await run(tokPlan(zeros(3)), TOK).promise).toBe('unused')
    })

    it('istek bicimi: Multicall3 adresine, aggregate3 verisiyle, [{to,data}, "latest"] eth_call; tokenler sabit listeden', async () => {
        const { fetchImpl, promise } = run(tokPlan(zeros(3)), TOK)
        await promise
        const bodies = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body))
        const ec = bodies.filter((b) => b.method === 'eth_call')
        expect(ec.length).toBe(1)
        expect(ec[0].jsonrpc).toBe('2.0')
        expect(ec[0].params[1]).toBe('latest')
        expect(ec[0].params[0].to).toBe(MULTICALL3_ADDRESS)
        expect(ec[0].params[0].data.startsWith('0x82ad56cb')).toBe(true)
        const calls = MC.decodeFunctionData('aggregate3', ec[0].params[0].data)[0]
        expect(calls.map((c) => c[0])).toEqual(T1)
        expect(calls.every((c) => c[1] === true)).toBe(true)
        // balanceOf(adres) verisi hesap adresini tasir.
        expect(calls[0][2].toLowerCase()).toContain(A.slice(2).toLowerCase())
    })

    it('allowFailure: basarisiz alt cagri yok sayilir; yalniz basarisizlar varsa unused, yanina pozitif varsa used', async () => {
        const failing = aggResult([
            [false, '0x'],
            [false, word(5)],
            [true, '0x'],
        ])
        expect(await run(tokPlan(failing), TOK).promise).toBe('unused')
        const mixed = aggResult([[false, word(9)], ok(7), [true, '0x']])
        expect(await run(tokPlan(mixed), TOK).promise).toBe('used')
    })

    it("bozuk yanit (hex olmayan, kisa, kesik, yanlis eleman sayisi, cop veri) 'used' YAPMAZ ve 'failed' da yapmaz", async () => {
        const good = aggResult([ok(1), ok(1), ok(1)])
        const bad = [
            'oops',
            '0x',
            '0x1234',
            '0xdeadbeef',
            good.slice(0, good.length - 64),
            aggResult([ok(1)]),
            aggResult([ok(1), ok(1)]),
            '0x' + 'ff'.repeat(200),
        ]
        for (const b of bad) {
            expect(await run(tokPlan(b), TOK).promise, String(b).slice(0, 18)).toBe('unused')
        }
    })

    it('token cagrisi hata verirse (reddetme, HTTP 500, rpc hatasi, hex degil) nonce/bakiye sonucu korunur', async () => {
        for (const kind of ['throw', 'http500', 'rpcerror', 'nothex']) {
            expect(await run(tokPlan(kind), TOK).promise, kind).toBe('unused')
            const nonceUsed = (u, m) => (m === 'eth_getTransactionCount' ? '0x1' : m === 'eth_call' ? kind : '0x0')
            expect(await run(nonceUsed, TOK).promise, kind).toBe('used')
        }
    })

    it('token cagrisi zaman asimina ugrarsa sonuc nonce/bakiyeye gore (unused) belirlenir', async () => {
        vi.useFakeTimers()
        const { promise } = run(tokPlan('hang'), TOK)
        await vi.advanceTimersByTimeAsync(PROBE_CALL_TIMEOUT_MS + 50)
        await expect(promise).resolves.toBe('unused')
    })

    it("nonce > 0 ise asili token cagrisi BEKLENMEZ: 'used' hemen doner ve asili istek iptal edilir", async () => {
        vi.useFakeTimers()
        const plan = (u, m) => (m === 'eth_call' ? 'hang' : m === 'eth_getTransactionCount' ? '0x1' : '0x0')
        const { fetchImpl, promise } = run(plan, TOK)
        await vi.advanceTimersByTimeAsync(0) // zaman asimi ILERLETILMEDI
        await expect(promise).resolves.toBe('used')
        const hung = fetchImpl.mock.calls.find((c) => methodOf(c) === 'eth_call')
        expect(hung[1].signal.aborted).toBe(true)
    })

    it("tum aglarin nonce+bakiyesi hata ise token cagrisi basarili/bos olsa da sonuc 'failed' kalir (davranis degismez)", async () => {
        const plan = (u, m) => (m === 'eth_call' ? zeros(3) : 'throw')
        expect(await run(plan, TOK).promise).toBe('failed')
        const plan2 = (u, m) => (m === 'eth_call' ? 'throw' : 'http500')
        expect(await run(plan2, TOK).promise).toBe('failed')
    })

    it("nonce/bakiye hata verirken token bakiyesi POZITIF ise 'used' (pozitif kanit)", async () => {
        const plan = (u, m) => (m === 'eth_call' ? aggResult([ok(0), ok(4), ok(0)]) : 'throw')
        expect(await run(plan, TOK).promise).toBe('used')
    })

    it('bir agda yalniz token var, digerleri bos -> used (cok agli)', async () => {
        const chains = [
            { chainId: 1, urls: ['https://a1'], tokens: T1 },
            { chainId: 56, urls: ['https://b1'], tokens: usageTokenAddressesFor(56) },
        ]
        const plan = (u, m, params) =>
            m === 'eth_call'
                ? u === 'https://b1'
                    ? aggResult([ok(10n ** 18n), ok(0), ok(0)])
                    : zeros(callCount(params))
                : '0x0'
        expect(await run(plan, chains).promise).toBe('used')
    })

    it("Atla: token cagrisi asiliyken iptal -> 'failed' ve asili istek birakilir", async () => {
        const ctrl = new AbortController()
        const plan = (u, m) => (m === 'eth_call' ? 'hang' : '0x0')
        const { fetchImpl, promise } = run(plan, TOK, { signal: ctrl.signal })
        await new Promise((resolve) => setTimeout(resolve, 0))
        ctrl.abort()
        expect(await promise).toBe('failed')
        const hung = fetchImpl.mock.calls.find((c) => methodOf(c) === 'eth_call')
        expect(hung[1].signal.aborted).toBe(true)
    })

    it('token listesi olmayan/bos ag icin eth_call GONDERILMEZ (Multicall3 dogrulanmamis ag atlanir)', async () => {
        for (const chains of [
            [{ chainId: 1, urls: ['https://a1'] }],
            [{ chainId: 1, urls: ['https://a1'], tokens: [] }],
            [{ chainId: 1, urls: ['https://a1'], tokens: null }],
        ]) {
            const { fetchImpl, promise } = run(() => '0x0', chains)
            expect(await promise).toBe('unused')
            expect(fetchImpl.mock.calls.some((c) => methodOf(c) === 'eth_call')).toBe(false)
            expect(fetchImpl.mock.calls.length).toBe(2)
        }
    })

    it('gecersiz hesap adresi: token cagrisi kurulamaz, atlanir (firlatmaz; nonce/bakiye yine sorulur)', async () => {
        const fetchImpl = fakeFetch(() => '0x0')
        const r = await probeEvmAddress('not-an-address', { chains: TOK, fetchImpl })
        expect(r).toBe('unused')
        expect(fetchImpl.mock.calls.some((c) => methodOf(c) === 'eth_call')).toBe(false)
    })

    it('CAGRI SAYISI: gercek 10 agda her ag icin tam 3 cagri (nonce + bakiye + multicall), toplam 30', async () => {
        const chains = scanChains()
        const owner = new Map()
        for (const c of chains) for (const u of c.urls) owner.set(u, c.chainId)
        const plan = (u, m, params) => (m === 'eth_call' ? zeros(callCount(params)) : '0x0')
        const { fetchImpl, promise } = run(plan, chains)
        expect(await promise).toBe('unused')
        const perChain = new Map()
        const methods = new Map()
        for (const c of fetchImpl.mock.calls) {
            const id = owner.get(c[0])
            perChain.set(id, (perChain.get(id) ?? 0) + 1)
            methods.set(methodOf(c), (methods.get(methodOf(c)) ?? 0) + 1)
        }
        expect(perChain.size).toBe(10)
        for (const [id, n] of perChain) expect(n, `zincir ${id}`).toBe(3)
        expect(fetchImpl.mock.calls.length).toBe(30)
        expect(methods.get('eth_call')).toBe(10)
        // eth_call hep o agin Multicall3 adresine.
        for (const [, init] of fetchImpl.mock.calls) {
            const b = JSON.parse(init.body)
            if (b.method === 'eth_call') expect(b.params[0].to).toBe(MULTICALL3_ADDRESS)
        }
    })

    it('yedek URL: birinci URL nonce+bakiyede dusup token cagrisi cevap verdiyse ikinci URL token cagrisini TEKRARLAMAZ', async () => {
        const chains = [{ chainId: 1, urls: ['https://a1', 'https://a2'], tokens: T1 }]
        const plan = (u, m, params) => {
            if (m === 'eth_call') return zeros(callCount(params))
            return u === 'https://a1' ? 'throw' : '0x0'
        }
        const { fetchImpl, promise } = run(plan, chains)
        expect(await promise).toBe('unused')
        const toA2 = fetchImpl.mock.calls.filter(([u]) => u === 'https://a2').map(methodOf)
        expect(toA2.sort()).toEqual(['eth_getBalance', 'eth_getTransactionCount'])
        expect(fetchImpl.mock.calls.filter((c) => methodOf(c) === 'eth_call').length).toBe(1)
    })

    it('yedek URL: birinci URL token cagrisi da basarisizsa ikinci URL token cagrisini DENER', async () => {
        const chains = [{ chainId: 1, urls: ['https://a1', 'https://a2'], tokens: T1 }]
        const plan = (u, m) => {
            if (u === 'https://a1') return 'throw'
            if (m === 'eth_call') return aggResult([ok(3), ok(0), ok(0)])
            return '0x0'
        }
        expect(await run(plan, chains).promise).toBe('used')
    })
})
