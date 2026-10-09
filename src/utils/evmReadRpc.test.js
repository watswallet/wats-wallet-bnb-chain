import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import supported_chains from '../data/supported_chains.json'
import { rpcUrlsOf } from './vm'
import { FORWARD_METHODS } from './evmRpcPolicy'
import { forwardRead, createReadLimiter, READ_RPC_LIMITS } from './evmReadRpc'

// Sinirlayici SAATI DONDURULMUS verilir: gercek Date.now ile kovalar test kosarken dolar (yuk
// altinda bir durma "20 gecer, 21.si reddedilir" gibi testleri titretir). Opsiyon nesnesinin
// TAMAMI gecilir: frozenLimiter({ limits: { ... } }). Saat ilerlemesi gereken testler dogrudan
// createReadLimiter({ now: clock.now }) kullanir ("createReadLimiter (dogrudan)" blogu).
const frozenLimiter = (opts = {}) => createReadLimiter({ now: () => 1_000_000, ...opts })


// ---- Sabit zincir listesi ------------------------------------------------------------------
// Testler PAKETLI verinin degismesinden etkilenmesin diye (T6 OP/Polygon URL'lerini degistirir,
// ileride Ethereum'a ikinci URL eklenebilir) deps.chains ile SABIT bir liste verilir.
// PAKETLI veriye bagli testler ayri ve acikca adlandirilmistir ("paketli").
const FIXTURE_CHAINS = [
    { chainId: 1, rpc: [{ url: 'https://eth-1.rpc.example' }] }, // tek URL'li zincir
    { chainId: 56, rpc: [{ url: 'https://bsc-1.rpc.example' }, { url: 'https://bsc-2.rpc.example' }] },
    { chainId: 137, rpc: [{ url: 'https://poly-1.rpc.example' }] },
    { chainId: -239, kind: 'ton', rpc: [] },
]
const ETH = { chainId: 1 }
const BSC = { chainId: 56 }
const POLYGON = { chainId: 137 }
const TON = { chainId: -239, kind: 'ton' }
const ETH_URL = 'https://eth-1.rpc.example'
const BSC_URL_1 = 'https://bsc-1.rpc.example'
const BSC_URL_2 = 'https://bsc-2.rpc.example'
const POLYGON_URL = 'https://poly-1.rpc.example'

const bundled = (id) => supported_chains.find((c) => c.chainId === id)

const ORIGIN = 'https://dapp.example'

// ---- Sahte fetch ---------------------------------------------------------------------------
// handlers: url -> (call) => Response | 'NETWORK_ERROR' | 'HANG' | { ... } (duz nesne = govde yerine)
let calls
let handlers

const jsonRes = (body, init = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
const okRes = (result) => jsonRes({ jsonrpc: '2.0', id: 1, result })
const errRes = (error) => jsonRes({ jsonrpc: '2.0', id: 1, error })

const mockFetch = vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, init, body })
    const h = handlers[url]
    if (!h) throw new Error('beklenmeyen URL: ' + url)
    const out = await h({ url, init, body })
    if (out === 'NETWORK_ERROR') throw new TypeError('fetch failed')
    if (out === 'HANG') {
        // Gercek fetch gibi: iptal sinyalinde AbortError ile reddeder.
        return new Promise((_, reject) => {
            init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        })
    }
    return out
})

// Her test KENDI sinirlayicisini alir (paylasilan durum testler arasinda sizmasin).
const makeDeps = (extra = {}) => ({ fetch: mockFetch, limiter: frozenLimiter(), chains: FIXTURE_CHAINS, ...extra })

const read = (args, deps = makeDeps()) =>
    forwardRead({ method: 'eth_blockNumber', params: [], chain: ETH, origin: ORIGIN, deps, ...args })

beforeEach(() => {
    calls = []
    handlers = {}
    mockFetch.mockClear()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

// =============================================================================================
describe('forwardRead: iletme ve istek bicimi', () => {
    it('izinli yontemi aktif zincirin ILK URL\'sine TAZE govdeyle gonderir, sonucu aynen doner', async () => {
        handlers[ETH_URL] = () => okRes('0x10')

        const r = await read({ method: 'eth_getBalance', params: ['0xabc', 'latest'] })

        expect(r).toEqual({ ok: true, result: '0x10' })
        expect(calls).toHaveLength(1)
        expect(calls[0].url).toBe(ETH_URL)
        expect(Object.keys(calls[0].body).sort()).toEqual(['id', 'jsonrpc', 'method', 'params'])
        expect(calls[0].body).toMatchObject({ jsonrpc: '2.0', method: 'eth_getBalance', params: ['0xabc', 'latest'] })
        expect(typeof calls[0].body.id).toBe('number')
        const init = calls[0].init
        expect(init.method).toBe('POST')
        expect(init.credentials).toBe('omit')
        expect(init.referrerPolicy).toBe('no-referrer')
        expect(init.cache).toBe('no-store')
        expect(init.headers['Content-Type']).toBe('application/json')
        expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it('sonuc null da gecerli bir sonuctur (makbuz yok)', async () => {
        handlers[ETH_URL] = () => okRes(null)
        expect(await read({ method: 'eth_getTransactionReceipt', params: ['0x00'] })).toEqual({ ok: true, result: null })
    })

    it('izinli 30 yontemin HEPSI iletilir', async () => {
        handlers[ETH_URL] = () => okRes('0x1')
        for (const method of FORWARD_METHODS) {
            const r = await read({ method, params: [] }, makeDeps({ limiter: frozenLimiter({ limits: { globalBurst: 1000, originBurst: 1000 } }) }))
            expect(r.ok, method).toBe(true)
        }
        expect(calls.map((c) => c.body.method)).toEqual([...FORWARD_METHODS])
    })

    it('params yoksa [] gonderir; her cagri farkli id kullanir', async () => {
        handlers[ETH_URL] = () => okRes('0x1')
        await read({ params: undefined })
        await read({ params: undefined })

        expect(calls[0].body.params).toEqual([])
        expect(calls[1].body.id).not.toBe(calls[0].body.id)
    })

    it('varsayilan olarak global fetch ve PAKETLI zincir listesi kullanilir (deps verilmezse)', async () => {
        const stub = vi.fn(async () => okRes('0x2'))
        vi.stubGlobal('fetch', stub)

        const r = await forwardRead({
            method: 'eth_blockNumber',
            params: [],
            chain: ETH,
            origin: 'https://varsayilan-fetch.example',
        })

        expect(r).toEqual({ ok: true, result: '0x2' })
        expect(stub).toHaveBeenCalledTimes(1)
        expect(stub.mock.calls[0][0]).toBe(rpcUrlsOf(bundled(1))[0]) // paketli Ethereum ilk URL
    })
})

describe('forwardRead: yasak adlar (net_version dahil: yerel cevap T14b nindir)', () => {
    const DENIED = [
        'eth_sendRawTransaction',
        'eth_sendTransaction',
        'eth_sign',
        'eth_signTransaction',
        'personal_sign',
        'eth_signTypedData_v4',
        'eth_accounts',
        'eth_coinbase',
        'eth_requestAccounts',
        'eth_chainId',
        'net_version',
        'wallet_getCapabilities',
        'wallet_requestPermissions',
        'eth_subscribe',
        'eth_newFilter',
        'eth_getFilterChanges',
        'debug_traceTransaction',
        'trace_block',
        'txpool_content',
        'admin_peers',
        'constructor',
        '__proto__',
        ' eth_call',
        'ETH_CALL',
        'eth_call' + String.fromCharCode(0),
        '',
    ]

    it.each(DENIED)('%j -> 4200, fetch HIC cagrilmaz, kova tuketilmez', async (method) => {
        const acquire = vi.fn()
        const r = await read({ method }, makeDeps({ limiter: { acquire } }))

        expect(r.ok).toBe(false)
        expect(r.error.code).toBe(4200)
        expect(mockFetch).not.toHaveBeenCalled()
        expect(acquire).not.toHaveBeenCalled()
    })

    it('metin olmayan yontem adi 4200', async () => {
        for (const method of [undefined, null, 5, {}, ['eth_call']]) {
            const r = await read({ method })
            expect(r.error.code).toBe(4200)
        }
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('4200 mesaji sayfa adini en cok 64 karakter ve kontrolsuz yansitir', async () => {
        const r = await read({ method: 'x'.repeat(100) + '\n' })
        expect(r.error.message).toBe(`The method ${'x'.repeat(64)} is not supported by this wallet.`)
    })
})

describe('forwardRead: zincir secimi', () => {
    it('cagri anindaki zincirin URL\'lerini kullanir', async () => {
        handlers[BSC_URL_1] = () => okRes('0xb5c')
        handlers[POLYGON_URL] = () => okRes('0xp01')

        await read({ chain: BSC })
        await read({ chain: POLYGON })

        expect(calls.map((c) => c.url)).toEqual([BSC_URL_1, POLYGON_URL])
    })

    it('chainId metin/sayi farkini tolere eder ({chainId:"56"} -> BSC)', async () => {
        handlers[BSC_URL_1] = () => okRes('0x1')
        await read({ chain: { chainId: '56' } })
        expect(calls[0].url).toBe(BSC_URL_1)
    })

    it('depodaki `rpc` alani YOK SAYILIR: yalniz PAKETLI URL listesi kullanilir', async () => {
        const bundledEthUrl = rpcUrlsOf(bundled(1))[0]
        handlers[bundledEthUrl] = () => okRes('0x1')

        await read(
            { chain: { chainId: 1, rpc: [{ url: 'https://evil.example/rpc' }] } },
            { fetch: mockFetch, limiter: frozenLimiter() } // chains verilmedi -> paketli liste
        )

        expect(calls.map((c) => c.url)).toEqual([bundledEthUrl])
    })

    it('paketli listede TON ve Solana kayitlari EVM ucu vermez: fetch yok', async () => {
        const deps = { fetch: mockFetch, limiter: frozenLimiter() }
        for (const chain of [bundled(-239), bundled(-3), bundled('solana-mainnet'), { chainId: 'solana-mainnet' }]) {
            if (!chain) continue
            const r = await read({ chain }, deps)
            expect(r.error.code).toBe(-32603)
        }
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it.each([
        ['TON', TON],
        ['Solana kaydi', { chainId: 'solana-mainnet', vm: 'solana' }],
        ['bilinmeyen EVM kimligi', { chainId: 999999999 }],
        ['chain undefined', undefined],
        ['chain null', null],
        ['chainId yok', {}],
    ])('%s -> -32603, fetch yok', async (_ad, chain) => {
        const r = await read({ chain })
        expect(r.ok).toBe(false)
        expect(r.error.code).toBe(-32603)
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('deps.chains ile liste degistirilebilir (test enjeksiyonu)', async () => {
        handlers['https://ozel.example/rpc'] = () => okRes('0x7')
        const r = await read(
            { chain: { chainId: 4242 } },
            makeDeps({ chains: [{ chainId: 4242, rpc: [{ url: 'https://ozel.example/rpc' }] }] })
        )
        expect(r).toEqual({ ok: true, result: '0x7' })
    })
})

describe('forwardRead: yedek URL ve hata siniflamasi', () => {
    const INFRA_CASES = [
        ['ag hatasi', () => 'NETWORK_ERROR'],
        ['HTTP 429', () => new Response('slow down', { status: 429 })],
        ['HTTP 500', () => new Response('boom', { status: 500 })],
        ['HTTP 503', () => new Response('', { status: 503 })],
        ['HTTP 403', () => new Response('forbidden', { status: 403 })],
        ['JSON olmayan govde', () => new Response('<html>nope</html>', { status: 200 })],
        ['zarfta result/error yok', () => jsonRes({ jsonrpc: '2.0', id: 1 })],
        ['dizi govde', () => jsonRes([{ result: '0x1' }])],
        ['-32005 limit', () => errRes({ code: -32005, message: 'limit exceeded' })],
        ['-32602 archive requests (makbuz kapisi)', () => errRes({ code: -32602, message: 'Archive requests require a personal token. Get one at: x' })],
        ['-32601 yontem yok', () => errRes({ code: -32601, message: 'the method eth_call does not exist' })],
        ['-32600 forbidden method', () => errRes({ code: -32600, message: 'forbidden method' })],
        ['35 free plan', () => errRes({ code: 35, message: 'method is not available on the free plan' })],
        ['-32614', () => errRes({ code: -32614, message: 'x' })],
        ['hata govdesi metin', () => jsonRes({ jsonrpc: '2.0', id: 1, error: 'bad' })],
    ]

    it.each(INFRA_CASES)('%s -> ikinci URL\'ye duser ve onun sonucunu doner', async (_ad, first) => {
        handlers[BSC_URL_1] = first
        handlers[BSC_URL_2] = () => okRes('0xfeed')

        const r = await read({ chain: BSC })

        expect(r).toEqual({ ok: true, result: '0xfeed' })
        expect(calls.map((c) => c.url)).toEqual([BSC_URL_1, BSC_URL_2])
    })

    it('anlamsal hata (revert, kod 3) DUSMEZ: tek istek, kod/mesaj/data aynen', async () => {
        const data = '0x08c379a0' + '00'.repeat(64)
        handlers[BSC_URL_1] = () => errRes({ code: 3, message: 'execution reverted: nope', data })
        handlers[BSC_URL_2] = () => okRes('0xdont')

        const r = await read({ method: 'eth_call', params: [{}, 'latest'], chain: BSC })

        expect(r).toEqual({ ok: false, error: { code: 3, message: 'execution reverted: nope', data } })
        expect(calls).toHaveLength(1)
    })

    it.each([
        [-32602, 'invalid argument 0: hex string without 0x prefix'],
        [-32000, 'insufficient funds for gas * price + value'],
        [-32000, 'execution reverted'],
    ])('anlamsal hata %i "%s" DUSMEZ', async (code, message) => {
        handlers[BSC_URL_1] = () => errRes({ code, message })
        handlers[BSC_URL_2] = () => okRes('0xdont')

        const r = await read({ method: 'eth_estimateGas', params: [{}], chain: BSC })

        expect(r.ok).toBe(false)
        expect(r.error).toMatchObject({ code, message })
        expect(calls).toHaveLength(1)
    })

    it('hepsi basarisiz -> -32603 "RPC endpoint unavailable"; URL/ana makine sizmaz', async () => {
        handlers[BSC_URL_1] = () => 'NETWORK_ERROR'
        handlers[BSC_URL_2] = () => new Response('x', { status: 502 })

        const r = await read({ chain: BSC })

        expect(r).toEqual({ ok: false, error: { code: -32603, message: 'RPC endpoint unavailable' } })
        const text = JSON.stringify(r)
        for (const u of [BSC_URL_1, BSC_URL_2]) expect(text).not.toContain(new URL(u).hostname)
    })

    it('tek URL\'li zincirde altyapi hatasi: tek istek, dongu yok, -32603', async () => {
        handlers[ETH_URL] = () => 'NETWORK_ERROR'

        const r = await read({ chain: ETH })

        expect(r.error.code).toBe(-32603)
        expect(calls).toHaveLength(1)
    })
})

describe('forwardRead: zaman asimi', () => {
    it('10 sn yanit vermeyen uc iptal edilir ve ikinci URL denenir', async () => {
        vi.useFakeTimers()
        handlers[BSC_URL_1] = () => 'HANG'
        handlers[BSC_URL_2] = () => okRes('0x2')

        const p = read({ chain: BSC })
        await vi.advanceTimersByTimeAsync(9_999)
        expect(calls).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)

        expect(await p).toEqual({ ok: true, result: '0x2' })
        expect(calls.map((c) => c.url)).toEqual([BSC_URL_1, BSC_URL_2])
        expect(calls[0].init.signal.aborted).toBe(true)
    })

    it('toplam sure 25 sn ile sinirli: 3. uc yalniz kalan 5 sn alir; hepsi zaman asimi -> "timed out"', async () => {
        vi.useFakeTimers()
        const chains = [{ chainId: 77, rpc: ['a', 'b', 'c', 'd'].map((x) => ({ url: `https://${x}.rpc.example` })) }]
        for (const x of ['a', 'b', 'c', 'd']) handlers[`https://${x}.rpc.example`] = () => 'HANG'

        const p = read({ chain: { chainId: 77 } }, makeDeps({ chains }))
        await vi.advanceTimersByTimeAsync(25_000)
        const r = await p

        expect(r).toEqual({ ok: false, error: { code: -32603, message: 'RPC request timed out' } })
        expect(calls).toHaveLength(3) // 10 + 10 + 5 sn; 4. uca sure kalmadi
    })

    it('sinyali yok sayan fetch bile zaman asiminda birakilir (yaris)', async () => {
        vi.useFakeTimers()
        const neverEnding = vi.fn(() => new Promise(() => {}))

        const p = read({ chain: ETH }, makeDeps({ fetch: neverEnding }))
        await vi.advanceTimersByTimeAsync(10_000)

        expect((await p).error).toEqual({ code: -32603, message: 'RPC request timed out' })
    })
})

describe('forwardRead: hata suzme (spec 6 G2 / 9-15)', () => {
    const semantic = (error) => {
        handlers[ETH_URL] = () => errRes(error)
        return read({ method: 'eth_call', params: [{}, 'latest'] })
    }

    it.each([
        [4001, -32603],
        [4100, -32603],
        [4900, -32603],
        [4901, -32603],
        [1, -32603],
        [5000, -32603],
        [-31999, -32603],
        [-32769, -32603],
        ['3', -32603],
        [3.5, -32603],
        [null, -32603],
        [undefined, -32603],
        [-32768, -32768],
        [-32000, -32000],
        [-32602, -32602],
        [3, 3],
    ])('upstream kod %j -> %i (cuzdan karari taklit EDILEMEZ)', async (upstream, expected) => {
        const r = await semantic({ code: upstream, message: 'execution failed' })
        expect(r.error.code).toBe(expected)
    })

    it('kullanici reddi gibi gorunen mesaj DEGISTIRILIR (AppKit bunu 4001 sanar)', async () => {
        for (const m of ['User rejected the request', 'user denied transaction', 'User cancelled', 'USER CANCELED']) {
            const r = await semantic({ code: -32000, message: m })
            expect(r.error.message).toBe('RPC request failed.')
        }
    })

    it('mesaj 512 karakterle sinirlanir; mesaj yoksa/metin degilse genel mesaj', async () => {
        expect((await semantic({ code: -32000, message: 'a'.repeat(5000) })).error.message).toHaveLength(512)
        expect((await semantic({ code: -32000 })).error.message).toBe('RPC request failed.')
        expect((await semantic({ code: -32000, message: { x: 1 } })).error.message).toBe('RPC request failed.')
        expect((await semantic({ code: -32000, message: '' })).error.message).toBe('RPC request failed.')
    })

    it('mesajdaki URL ve RPC ana makine adlari supurulur (buyuk/kucuk harf fark etmez)', async () => {
        const host = new URL(ETH_URL).hostname
        const other = new URL(BSC_URL_1).hostname
        const r = await semantic({
            code: -32000,
            message: `failed at ${ETH_URL}/v1/SECRETKEY and ${host.toUpperCase()} via https://baska.example/x?key=1 also ${other}`,
        })

        expect(r.error.message).not.toContain(host)
        expect(r.error.message).not.toContain(other)
        expect(r.error.message).not.toContain('SECRETKEY')
        expect(r.error.message).not.toContain('baska.example')
        expect(r.error.message).toContain('[redacted]')
    })

    it('data korunur (revert verisi); ic ice metinlerdeki URL supurulur; anahtarlar da', async () => {
        const host = new URL(ETH_URL).hostname
        const r = await semantic({
            code: 3,
            message: 'execution reverted',
            data: { revert: '0xdeadbeef', note: `see https://x.example/y`, nested: [{ h: host }], [host]: 1 },
        })

        expect(r.error.data.revert).toBe('0xdeadbeef')
        expect(JSON.stringify(r.error.data)).not.toContain(host)
        expect(JSON.stringify(r.error.data)).not.toContain('x.example')
    })

    it('64 KB ustu data DUSURULUR (kesilmez); kod ve mesaj kalir', async () => {
        const r = await semantic({ code: 3, message: 'execution reverted', data: '0x' + 'ab'.repeat(40_000) })
        expect(r.error).toEqual({ code: 3, message: 'execution reverted' })

        const ok = await semantic({ code: 3, message: 'execution reverted', data: '0x' + 'ab'.repeat(30_000) })
        expect(ok.error.data).toBe('0x' + 'ab'.repeat(30_000))
    })

    it('data icindeki "__proto__" anahtari prototipi DEGISTIRMEZ', async () => {
        handlers[ETH_URL] = () =>
            new Response('{"jsonrpc":"2.0","id":1,"error":{"code":3,"message":"m","data":{"__proto__":{"polluted":true},"a":1}}}')
        const r = await read({ method: 'eth_call', params: [{}, 'latest'] })

        expect(r.error.data.polluted).toBeUndefined()
        expect(Object.getPrototypeOf(r.error.data)).toBe(Object.prototype)
        expect({}.polluted).toBeUndefined()
        expect(r.error.data.a).toBe(1)
    })

    it('cok derin data atilir (derinlik 8)', async () => {
        let deep = { leaf: 'x' }
        for (let i = 0; i < 20; i++) deep = { n: deep }
        const r = await semantic({ code: 3, message: 'm', data: deep })
        expect(JSON.stringify(r.error.data ?? null)).not.toContain('leaf')
    })

    it('basarili sonuca dokunulmaz (suzme yalniz hata icin)', async () => {
        handlers[ETH_URL] = () => okRes({ hash: '0xhttps://ornek.example', n: 1 })
        expect(await read({ method: 'eth_getTransactionByHash', params: ['0x1'] })).toEqual({
            ok: true,
            result: { hash: '0xhttps://ornek.example', n: 1 },
        })
    })
})

describe('forwardRead: parametre ve yanit sinirlari', () => {
    it('params dizi degilse -32602, fetch yok', async () => {
        for (const params of [{}, 'x', 5, null, true]) {
            const r = await read({ params })
            expect(r.error.code).toBe(-32602)
        }
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('serilestirilemeyen params (BigInt) -> -32602', async () => {
        const r = await read({ params: [10n] })
        expect(r.error.code).toBe(-32602)
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('params 256 KB siniri: sinirda gecer, bir bayt fazlasi -32005 (fetch yok)', async () => {
        handlers[ETH_URL] = () => okRes('0x1')
        // JSON.stringify(['a...']) = 2 tirnak + 2 koseli parantez = 4 bayt ek
        const atLimit = 'a'.repeat(READ_RPC_LIMITS.maxParamsBytes - 4)
        expect((await read({ params: [atLimit] })).ok).toBe(true)

        mockFetch.mockClear()
        const over = await read({ params: [atLimit + 'a'] })
        expect(over).toEqual({ ok: false, error: { code: -32005, message: 'Request too large' } })
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('yanit 2 MB siniri: tam sinirda gecer', async () => {
        const fits = 'x'.repeat(READ_RPC_LIMITS.maxResponseBytes - 100)
        handlers[ETH_URL] = () => okRes(fits)
        const r = await read({})
        expect(r.ok).toBe(true)
        expect(r.result).toHaveLength(fits.length)
    })

    it('yanit 2 MB\'i asarsa -32005 ve ikinci URL DENENMEZ; okuyucu iptal edilir', async () => {
        const chunk = new Uint8Array(512 * 1024).fill(97)
        let cancelled = false
        let sent = 0
        const stream = new ReadableStream({
            pull(controller) {
                sent += 1
                controller.enqueue(chunk)
            },
            cancel() {
                cancelled = true
            },
        })
        handlers[BSC_URL_1] = () => new Response(stream, { status: 200 })
        handlers[BSC_URL_2] = () => okRes('0xdont')

        const r = await read({ chain: BSC })

        expect(r).toEqual({ ok: false, error: { code: -32005, message: 'Response too large' } })
        expect(calls).toHaveLength(1)
        expect(cancelled).toBe(true)
        expect(sent).toBeLessThan(10) // sonsuz akis sonlandirildi
    })

    it('content-length 2 MB\'i asiyorsa govde hic okunmadan reddedilir', async () => {
        handlers[ETH_URL] = () =>
            new Response('{"result":"0x1"}', {
                status: 200,
                headers: { 'content-length': String(READ_RPC_LIMITS.maxResponseBytes + 1) },
            })
        const r = await read({})
        expect(r.error).toEqual({ code: -32005, message: 'Response too large' })
    })

    it('Response olmayan sade nesne (yalniz text()) de okunur ve ayni sinir uygulanir', async () => {
        handlers[ETH_URL] = () => ({ ok: true, status: 200, text: async () => JSON.stringify({ result: '0x9' }) })
        expect(await read({})).toEqual({ ok: true, result: '0x9' })

        handlers[ETH_URL] = () => ({ ok: true, status: 200, text: async () => 'x'.repeat(READ_RPC_LIMITS.maxResponseBytes + 1) })
        expect((await read({})).error.code).toBe(-32005)
    })
})

describe('forwardRead: hiz siniri (global + origin + eszamanlilik)', () => {
    it('origin kovasi: eth_getLogs agirligi 5, 20 patlamada 4 cagri; 5.si -32005 "Rate limited"', async () => {
        handlers[ETH_URL] = () => okRes([])
        const deps = makeDeps()

        for (let i = 0; i < 4; i++) expect((await read({ method: 'eth_getLogs', params: [{}] }, deps)).ok).toBe(true)
        const r = await read({ method: 'eth_getLogs', params: [{}] }, deps)

        expect(r).toEqual({ ok: false, error: { code: -32005, message: 'Rate limited' } })
        expect(calls).toHaveLength(4)
    })

    it('hafif yontemler 1 jeton: 20 gecer, 21.si reddedilir', async () => {
        handlers[ETH_URL] = () => okRes('0x1')
        const deps = makeDeps()
        for (let i = 0; i < 20; i++) expect((await read({}, deps)).ok).toBe(true)
        expect((await read({}, deps)).error.code).toBe(-32005)
    })

    it('origin\'ler birbirinin kovasini yemez', async () => {
        handlers[ETH_URL] = () => okRes('0x1')
        // Global kova genis: bu test YALNIZ origin yalitimini olcer.
        const deps = makeDeps({ limiter: frozenLimiter({ limits: { globalBurst: 1000 } }) })
        for (let i = 0; i < 20; i++) await read({ origin: 'https://a.example' }, deps)

        expect((await read({ origin: 'https://a.example' }, deps)).ok).toBe(false)
        expect((await read({ origin: 'https://b.example' }, deps)).ok).toBe(true)
    })

    it('GLOBAL kova: cok sayida origin toplamda saniyede 20\'yi asamaz', async () => {
        handlers[ETH_URL] = () => okRes('0x1')
        const deps = makeDeps()
        let ok = 0
        for (let i = 0; i < 40; i++) {
            const r = await read({ origin: `https://site${i}.example` }, deps)
            if (r.ok) ok += 1
        }
        expect(ok).toBe(20)
    })

    it('Unknown origin (cozumlenemeyen gonderen) TEK paylasilan ve daha siki: 5 gecer, 6. reddedilir', async () => {
        handlers[ETH_URL] = () => okRes('0x1')
        const deps = makeDeps()
        const results = []
        for (const origin of ['Unknown', undefined, '', null, 7, 'Unknown', 'Unknown', 'Unknown']) {
            results.push((await read({ origin }, deps)).ok)
        }
        expect(results).toEqual([true, true, true, true, true, false, false, false])
    })

    it('origin basina 8 eszamanli istek: 9.su -32005; biri bitince yer acilir', async () => {
        vi.useFakeTimers()
        handlers[ETH_URL] = () => 'HANG'
        const deps = makeDeps({ limiter: frozenLimiter({ limits: { originBurst: 100, globalBurst: 100 } }) })

        const inflight = []
        for (let i = 0; i < 8; i++) inflight.push(read({}, deps))
        await vi.advanceTimersByTimeAsync(0)
        expect(calls).toHaveLength(8)

        const ninth = await read({}, deps)
        expect(ninth).toEqual({ ok: false, error: { code: -32005, message: 'Rate limited' } })
        expect(calls).toHaveLength(8)

        await vi.advanceTimersByTimeAsync(10_000) // sekiz istek zaman asimina ugrar, yerler bosalir
        await Promise.all(inflight)

        handlers[ETH_URL] = () => okRes('0x1')
        expect((await read({}, deps)).ok).toBe(true)
    })

    it('sinirlayici HER yolda serbest birakilir (hata, red, zaman asimi sonrasi)', async () => {
        const limiter = frozenLimiter({ limits: { maxConcurrentPerOrigin: 1, originBurst: 100, globalBurst: 100 } })
        const deps = makeDeps({ limiter })

        handlers[ETH_URL] = () => 'NETWORK_ERROR'
        expect((await read({}, deps)).error.code).toBe(-32603)
        expect((await read({ params: 'x' }, deps)).error.code).toBe(-32602)
        handlers[ETH_URL] = () => errRes({ code: 3, message: 'revert' })
        expect((await read({}, deps)).error.code).toBe(3)
        handlers[ETH_URL] = () => okRes('0x1')
        expect((await read({}, deps)).ok).toBe(true) // eszamanlilik 1: onceki hicbiri sizmadi
    })
})

describe('createReadLimiter (dogrudan)', () => {
    function fakeClock(start = 1_000_000) {
        let t = start
        return { now: () => t, advance: (ms) => { t += ms } }
    }

    it('kovalar zamanla dolar: saat ilerleyince reddedilen origin yeniden gecer', () => {
        const clock = fakeClock()
        const lim = createReadLimiter({ now: clock.now })
        for (let i = 0; i < 20; i++) lim.acquire('https://a.example', 1).release()

        const denied = lim.acquire('https://a.example', 1)
        expect(denied).toMatchObject({ ok: false, reason: 'origin' })
        expect(denied.retryAfterMs).toBeGreaterThan(0)

        clock.advance(200) // origin hizi 5/sn -> 1 jeton
        expect(lim.acquire('https://a.example', 1).ok).toBe(true)
    })

    it('global kova reddederse origin jetonu IADE edilir (origin haksiz yere yanmaz)', () => {
        const clock = fakeClock()
        const lim = createReadLimiter({ now: clock.now, limits: { globalBurst: 1, globalRate: 1 } })

        expect(lim.acquire('https://a.example', 1).ok).toBe(true) // global bos
        for (let i = 0; i < 25; i++) {
            expect(lim.acquire('https://b.example', 1)).toMatchObject({ ok: false, reason: 'global' })
        }

        clock.advance(1000) // global 1 jeton yeniden dolar
        // 25 red (origin patlamasi 20) sonrasi bile b'nin origin kovasi harcanmadi.
        expect(lim.acquire('https://b.example', 1).ok).toBe(true)
    })

    it('eszamanlilik: reason "concurrency"; release idempotent (cift cagri sayaci bozmaz)', () => {
        const lim = createReadLimiter({ limits: { maxConcurrentPerOrigin: 2, originBurst: 100, globalBurst: 100 } })
        const a = lim.acquire('https://a.example')
        const b = lim.acquire('https://a.example')
        expect(lim.acquire('https://a.example')).toMatchObject({ ok: false, reason: 'concurrency' })

        a.release()
        a.release() // ikinci cagri etkisiz
        expect(lim.acquire('https://a.example').ok).toBe(true)
        expect(lim.acquire('https://a.example')).toMatchObject({ ok: false, reason: 'concurrency' })
        b.release()
    })

    it('izlenen origin sayisi sinirli: dolunca eszamanli istegi OLMAYAN kayit atilir, mesgul olan korunur', () => {
        const lim = createReadLimiter({ limits: { maxTrackedOrigins: 2, maxConcurrentPerOrigin: 1 } })
        lim.acquire('https://busy.example', 1) // serbest birakilmaz: eszamanli istek suruyor
        lim.acquire('https://x.example', 1).release()
        lim.acquire('https://y.example', 1).release() // 3. origin: bosta olan x atilir

        // busy en eski kayit ama eszamanli istegi var -> ATILMADI; sayaci hala 1.
        expect(lim.acquire('https://busy.example', 1)).toMatchObject({ ok: false, reason: 'concurrency' })
    })

    it('sabitler spec ile birebir', () => {
        expect(READ_RPC_LIMITS).toMatchObject({
            maxParamsBytes: 262144,
            maxResponseBytes: 2097152,
            endpointTimeoutMs: 10000,
            totalTimeoutMs: 25000,
            globalRate: 20,
            originRate: 5,
            originBurst: 20,
            maxConcurrentPerOrigin: 8,
            maxErrorMessageChars: 512,
            maxErrorDataChars: 65536,
        })
        expect(Object.isFrozen(READ_RPC_LIMITS)).toBe(true)
    })
})
