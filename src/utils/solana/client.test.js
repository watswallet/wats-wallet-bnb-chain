import { describe, it, expect, vi, afterEach } from 'vitest'
import { solanaRpc, SOLANA_API_BASE } from './client'

afterEach(() => { vi.unstubAllGlobals() })

const httpOk = (payload) => ({ ok: true, status: 200, json: async () => payload })

describe('solanaRpc', () => {
    it('KENDI backend imize gider, dogrudan bir duguma DEGIL', async () => {
        const fetchMock = vi.fn(async () => httpOk({ jsonrpc: '2.0', id: 1, result: 5 }))
        vi.stubGlobal('fetch', fetchMock)

        await solanaRpc('getBalance', ['abc'])

        const [url, options] = fetchMock.mock.calls[0]
        expect(url).toBe(`${SOLANA_API_BASE}/solana/rpc`)
        expect(url).not.toMatch(/solana\.com|helius|quicknode/)
        expect(JSON.parse(options.body)).toMatchObject({ method: 'getBalance', params: ['abc'] })
    })

    it('result i cikarip dondurur', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => httpOk({ jsonrpc: '2.0', id: 1, result: { value: 7 } })))
        await expect(solanaRpc('getBalance', ['abc'])).resolves.toEqual({ value: 7 })
    })

    // JSON-RPC hatasi HTTP 200 ile gelir. Kontrol edilmezse `undefined` result
    // sessizce akar ve bakiye 0 gorunur.
    it('JSON-RPC hatasi mesajiyla firlatilir', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => httpOk({
            jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid param' }
        })))
        await expect(solanaRpc('getBalance', ['x'])).rejects.toThrow('Invalid param')
    })

    it('HTTP hatasi firlatilir', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })))
        await expect(solanaRpc('getProgramAccounts')).rejects.toThrow(/403/)
    })

    // fetch'in VARSAYILAN ZAMAN ASIMI YOKTUR. Sinyal gecirilmezse takilmis bir
    // proxy cagriyi SONSUZA DEK askida birakir; arka plandaki kurtarma turu de,
    // bir gonderim de o tek cagriya bagli kalir.
    it('istege bir abort sinyali baglanir', async () => {
        const fetchMock = vi.fn(async () => httpOk({ jsonrpc: '2.0', id: 1, result: 1 }))
        vi.stubGlobal('fetch', fetchMock)

        await solanaRpc('getBalance', ['abc'])

        const [, options] = fetchMock.mock.calls[0]
        expect(options.signal).toBeInstanceOf(AbortSignal)
        expect(options.signal.aborted).toBe(false)
    })

    // Sure dolunca cagri DUSER. Hatanin mesaji ASLA bos olamaz: AbortError'in
    // kendi `message`'i bazi ortamlarda bostur ve bos bir mesaj sinir otesine
    // FALSY bir hata olarak gecip cagiranin `if (err)` dalini atlatir.
    it('sure dolarsa SOLANA_RPC_TIMEOUT ile duser', async () => {
        vi.useFakeTimers()
        try {
            vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
                // Gercek fetch'in abort davranisi: sinyal tetiklenince AbortError.
                options.signal.addEventListener('abort', () => {
                    const err = new Error('')
                    err.name = 'AbortError'
                    reject(err)
                })
            })))

            const cagri = solanaRpc('getSignatureStatuses', [['sig']])
            const beklenti = expect(cagri).rejects.toThrow('SOLANA_RPC_TIMEOUT')
            await vi.advanceTimersByTimeAsync(15000)
            await beklenti
        } finally {
            vi.useRealTimers()
        }
    })

    // Zamanlayici basarili yolda da temizlenmeli; aksi halde her cagri, hicbir
    // ise yaramayan bir zamanlayiciyi saniyelerce canli tutar (service worker'i
    // gereksiz yere uyanik tutmanin da yolu budur).
    it('basarili cagridan sonra bekleyen zamanlayici BIRAKILMAZ', async () => {
        vi.useFakeTimers()
        try {
            vi.stubGlobal('fetch', vi.fn(async () => httpOk({ jsonrpc: '2.0', id: 1, result: 1 })))
            await solanaRpc('getBalance', ['abc'])
            expect(vi.getTimerCount()).toBe(0)
        } finally {
            vi.useRealTimers()
        }
    })
})
