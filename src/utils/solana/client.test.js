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

    // S11-SEC-11-1: sunucu ust akis 401/403'unu 502 + sabit mesajla cevirir. Bu KESIN
    // redtir (istek dugume gitmedi); duz SOLANA_RPC_HTTP_502 olarak gecerse yayin
    // yolunda "BELIRSIZ" sanilir (sahte basari / sahte bekleyen kayit).
    it('502 + "solana upstream rejected request" govdesi ayri, BELIRSIZ OLMAYAN kodla firlatilir', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false, status: 502,
            json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'solana upstream rejected request' } }),
        })))
        await expect(solanaRpc('sendTransaction', ['AQAB'])).rejects.toThrow('SOLANA_RPC_UPSTREAM_REJECTED')
    })

    it('baska 502 govdeleri (proxy hatasi, okunamayan govde) SOLANA_RPC_HTTP_502 olarak KALIR', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false, status: 502,
            json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'solana proxy error' } }),
        })))
        await expect(solanaRpc('sendTransaction', ['AQAB'])).rejects.toThrow('SOLANA_RPC_HTTP_502')

        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('html') } })))
        await expect(solanaRpc('sendTransaction', ['AQAB'])).rejects.toThrow('SOLANA_RPC_HTTP_502')
    })

    it('ayni mesaj 502 disi durumda yorumlanmaz (403 -> SOLANA_RPC_HTTP_403)', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false, status: 403,
            json: async () => ({ error: { message: 'solana upstream rejected request' } }),
        })))
        await expect(solanaRpc('sendTransaction', ['AQAB'])).rejects.toThrow('SOLANA_RPC_HTTP_403')
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
    // Harici iptal sinyali: istek GERCEKTEN kesilmeli (Promise.race ile taklit
    // istegi 15 sn acik birakir ve paylasimli IP sinirini harcar), hata kodu
    // zaman asimindan AYRI olmali.
    describe('harici iptal sinyali ve zaman asimi secenegi', () => {
        // Gercek fetch'in abort davranisi: sinyal tetiklenince AbortError.
        const askidaFetch = () => vi.fn((_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
                const err = new Error('')
                err.name = 'AbortError'
                reject(err)
            })
        }))

        it('harici signal iptal edince fetch e verilen sinyal iptal olur ve SOLANA_RPC_ABORTED ile reddedilir', async () => {
            const fetchMock = askidaFetch()
            vi.stubGlobal('fetch', fetchMock)
            const harici = new AbortController()

            const cagri = solanaRpc('getBalance', ['abc'], { signal: harici.signal })
            const beklenti = expect(cagri).rejects.toThrow('SOLANA_RPC_ABORTED')
            const fetchSignal = fetchMock.mock.calls[0][1].signal
            expect(fetchSignal.aborted).toBe(false)

            harici.abort()

            await beklenti
            expect(fetchSignal.aborted).toBe(true)
        })

        it('onceden iptal edilmis sinyalde fetch HIC cagrilmaz', async () => {
            const fetchMock = vi.fn(async () => httpOk({ jsonrpc: '2.0', id: 1, result: 1 }))
            vi.stubGlobal('fetch', fetchMock)
            const harici = new AbortController()
            harici.abort()

            await expect(solanaRpc('getBalance', ['abc'], { signal: harici.signal }))
                .rejects.toThrow('SOLANA_RPC_ABORTED')
            expect(fetchMock).not.toHaveBeenCalled()
        })

        it('timeoutMs verilince o sure sonra SOLANA_RPC_TIMEOUT ile duser', async () => {
            vi.useFakeTimers()
            try {
                vi.stubGlobal('fetch', askidaFetch())

                const cagri = solanaRpc('getBalance', ['abc'], { timeoutMs: 50 })
                const beklenti = expect(cagri).rejects.toThrow('SOLANA_RPC_TIMEOUT')
                await vi.advanceTimersByTimeAsync(50)
                await beklenti
            } finally {
                vi.useRealTimers()
            }
        })

        it('timeoutMs verilince varsayilan 15 sn BEKLENMEZ ve harici sinyal yokken kod ABORTED degil TIMEOUT olur', async () => {
            vi.useFakeTimers()
            try {
                const fetchMock = askidaFetch()
                vi.stubGlobal('fetch', fetchMock)
                const cagri = solanaRpc('getBalance', ['abc'], { signal: new AbortController().signal, timeoutMs: 50 })
                const beklenti = expect(cagri).rejects.toThrow('SOLANA_RPC_TIMEOUT')
                await vi.advanceTimersByTimeAsync(50)
                await beklenti
            } finally {
                vi.useRealTimers()
            }
        })

        it('ucuncu parametre yokken eski 15 sn davranisi korunur (14.9 sn dusmez, 15 sn duser)', async () => {
            vi.useFakeTimers()
            try {
                vi.stubGlobal('fetch', askidaFetch())
                let sonuc = 'bekliyor'
                const cagri = solanaRpc('getBalance', ['abc']).then(() => { sonuc = 'ok' }, (e) => { sonuc = e.message })
                await vi.advanceTimersByTimeAsync(14900)
                expect(sonuc).toBe('bekliyor')
                await vi.advanceTimersByTimeAsync(100)
                await cagri
                expect(sonuc).toBe('SOLANA_RPC_TIMEOUT')
            } finally {
                vi.useRealTimers()
            }
        })

        it('basarili cagridan sonra harici sinyalin dinleyicisi ve zamanlayici BIRAKILMAZ', async () => {
            vi.useFakeTimers()
            try {
                vi.stubGlobal('fetch', vi.fn(async () => httpOk({ jsonrpc: '2.0', id: 1, result: 1 })))
                const harici = new AbortController()
                const kaldirilan = vi.spyOn(harici.signal, 'removeEventListener')

                await solanaRpc('getBalance', ['abc'], { signal: harici.signal })

                expect(vi.getTimerCount()).toBe(0)
                expect(kaldirilan).toHaveBeenCalledWith('abort', expect.any(Function))
            } finally {
                vi.useRealTimers()
            }
        })
    })
})
