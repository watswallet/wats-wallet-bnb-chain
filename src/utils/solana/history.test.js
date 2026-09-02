import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchSolanaHistory } from './history'
import { SOLANA_API_BASE } from './client'

afterEach(() => { vi.unstubAllGlobals() })

const httpOk = (payload) => ({ ok: true, status: 200, json: async () => payload })

const ADDR = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

describe('fetchSolanaHistory', () => {
    it('KENDI backend imizdeki /solana/history a gider', async () => {
        const fetchMock = vi.fn(async () => httpOk({ success: true, history: [{ signature: 'sig1' }] }))
        vi.stubGlobal('fetch', fetchMock)

        const r = await fetchSolanaHistory(ADDR)

        expect(r).toEqual([{ signature: 'sig1' }])
        const [url, options] = fetchMock.mock.calls[0]
        expect(url).toBe(`${SOLANA_API_BASE}/solana/history`)
        expect(options.method).toBe('POST')
        expect(JSON.parse(options.body)).toEqual({ address: ADDR })
    })

    it('govde beklenmedikse (history dizi degil) bos liste doner', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => httpOk({ success: true })))
        expect(await fetchSolanaHistory(ADDR)).toEqual([])
    })

    it('HTTP hatasinda firlatir — cagiran (historyRecipients.js) fail-open uygular', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })))
        await expect(fetchSolanaHistory(ADDR)).rejects.toThrow('SOLANA_HISTORY_HTTP_502')
    })

    it('gecersiz adreste AG CAGRISI YAPMAZ, bos liste doner', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        expect(await fetchSolanaHistory('')).toEqual([])
        expect(await fetchSolanaHistory(null)).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })

    // KOD INCELEMESI (Task 13, onemli 5): bu cagri Send ekraninin onMounted
    // zincirine baglandi. fetch'in VARSAYILAN ZAMAN ASIMI YOKTUR — sinyal
    // gecirilmezse takilmis bir proxy Send ekranini SONSUZA DEK yari-yuklu
    // birakirdi (bakiye, ucret izleyici hicbiri hic gelmez).
    it('istege bir abort sinyali baglanir', async () => {
        const fetchMock = vi.fn(async () => httpOk({ success: true, history: [] }))
        vi.stubGlobal('fetch', fetchMock)

        await fetchSolanaHistory(ADDR)

        const [, options] = fetchMock.mock.calls[0]
        expect(options.signal).toBeInstanceOf(AbortSignal)
        expect(options.signal.aborted).toBe(false)
    })

    // Sure dolunca cagri DUSER, hata mesaji ASLA bos olamaz (AbortError'in kendi
    // `message`'i bazi ortamlarda bostur ve cagiranin `if (err)` dalini atlatir).
    it('sure dolarsa SOLANA_HISTORY_TIMEOUT ile duser', async () => {
        vi.useFakeTimers()
        try {
            vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () => {
                    const err = new Error('')
                    err.name = 'AbortError'
                    reject(err)
                })
            })))

            const cagri = fetchSolanaHistory(ADDR)
            const beklenti = expect(cagri).rejects.toThrow('SOLANA_HISTORY_TIMEOUT')
            await vi.advanceTimersByTimeAsync(6000)
            await beklenti
        } finally {
            vi.useRealTimers()
        }
    })

    // 2. TUR INCELEMESI: zaman asimi GOVDEYI DE kapsamali. `fetch` promise'i
    // BASLIKLAR gelir gelmez cozulur; clearTimeout orada calissaydi (ilk yazimda
    // oyleydi) baslik donduren ama govdeyi hic bitirmeyen bir proxy Send
    // ekranini yine SONSUZA DEK asili birakirdi -- onemli 5'in tam olarak
    // uzerine yazildigi hata. Iddia edilen "axios.post({ timeout }) ile ayni"
    // parite de ancak boyle GERCEK olur: axios'un timeout'u govdeyi kapsar.
    it('BASLIKLAR gelip GOVDE asili kalirsa da SOLANA_HISTORY_TIMEOUT ile duser', async () => {
        vi.useFakeTimers()
        try {
            vi.stubGlobal('fetch', vi.fn(async (_url, options) => ({
                ok: true,
                status: 200,
                // Basliklar GELDI; govde hicbir zaman settle etmiyor. Tek cikis
                // yolu abort: spec geregi sinyal govde akisini da hataya dusurur.
                json: () => new Promise((_resolve, reject) => {
                    options.signal.addEventListener('abort', () => {
                        const err = new Error('')
                        err.name = 'AbortError'
                        reject(err)
                    })
                }),
            })))

            const cagri = fetchSolanaHistory(ADDR)
            const beklenti = expect(cagri).rejects.toThrow('SOLANA_HISTORY_TIMEOUT')

            // Basliklar cozulur, govde okumasi baslar. Zamanlayici HALA CANLI
            // olmali: bu satir, clearTimeout'un govdeden ONCE calistigi
            // (yarim kapanmis) surumde HEMEN kirmizi duser -- test asili
            // kalarak degil, net bir beklenti ile.
            await vi.advanceTimersByTimeAsync(0)
            expect(vi.getTimerCount()).toBe(1)

            await vi.advanceTimersByTimeAsync(6000)
            await beklenti
        } finally {
            vi.useRealTimers()
        }
    })

    // Zamanlayici basarili yolda da temizlenmeli; aksi halde her cagri, hicbir
    // ise yaramayan bir zamanlayiciyi service worker'i gereksiz yere uyanik
    // tutarak saniyelerce canli tutar.
    it('basarili cagridan sonra bekleyen zamanlayici BIRAKILMAZ', async () => {
        vi.useFakeTimers()
        try {
            vi.stubGlobal('fetch', vi.fn(async () => httpOk({ success: true, history: [] })))
            await fetchSolanaHistory(ADDR)
            expect(vi.getTimerCount()).toBe(0)
        } finally {
            vi.useRealTimers()
        }
    })
})
