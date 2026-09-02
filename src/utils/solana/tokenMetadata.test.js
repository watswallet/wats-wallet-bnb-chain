import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchTokenMetadata } from './tokenMetadata'
import { SOLANA_API_BASE } from './client'

afterEach(() => { vi.unstubAllGlobals() })

const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

describe('fetchTokenMetadata', () => {
    it('bos/dizi-disi girdi ag cagrisi yapmadan bos harita doner', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        expect(await fetchTokenMetadata([])).toEqual(new Map())
        expect(await fetchTokenMetadata(null)).toEqual(new Map())
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('KENDI backend imizdeki /solana/tokens a gider ve mint->metadata haritasi doner', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true, status: 200,
            json: async () => ({ success: true, tokens: [{ mint: MINT, symbol: 'USDC', name: 'USD Coin', decimals: 6, coingecko_id: 'usd-coin' }] }),
        }))
        vi.stubGlobal('fetch', fetchMock)

        const map = await fetchTokenMetadata([MINT])

        expect(map.get(MINT)).toMatchObject({ symbol: 'USDC', name: 'USD Coin' })
        const [url, options] = fetchMock.mock.calls[0]
        expect(url).toBe(`${SOLANA_API_BASE}/solana/tokens`)
        expect(JSON.parse(options.body)).toEqual({ mints: [MINT] })
    })

    // Metadata YARDIMCIDIR: bir ag hatasi cagiranin (Home bakiye listesi de,
    // Gecmis listesi de) TAMAMEN bos kalmasina yol ACMAMALI.
    it('HTTP hatasinda bos harita doner, firlatmaz', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })))
        expect(await fetchTokenMetadata([MINT])).toEqual(new Map())
    })

    it('fetch FIRLATIRSA da bos harita doner, cokmez', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
        expect(await fetchTokenMetadata([MINT])).toEqual(new Map())
    })

    // Sunucunun 100 mint sinirinin AYNASI (bkz. solanaController.js). Bu test
    // useSolanaAssets.test.js'teki AYNI senaryoyu, artik PAYLASILAN modulun
    // KENDISINE karsi dogrudan kilitler.
    it('100u asan mint listesi kumelere bolunur, bir kumenin dusmesi digerini SILMEZ', async () => {
        const mints = Array.from({ length: 150 }, (_, i) => `${MINT.slice(0, -3)}${String(i).padStart(3, '0')}`)
        let callIndex = -1
        const fetchMock = vi.fn(async (_url, opts) => {
            callIndex += 1
            const body = JSON.parse(opts.body)
            if (callIndex === 0) return { ok: false, status: 502, json: async () => ({}) }
            return {
                ok: true, status: 200,
                json: async () => ({ success: true, tokens: body.mints.map((m) => ({ mint: m, symbol: 'OK' })) }),
            }
        })
        vi.stubGlobal('fetch', fetchMock)

        const map = await fetchTokenMetadata(mints)

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).mints).toHaveLength(100)
        expect(JSON.parse(fetchMock.mock.calls[1][1].body).mints).toHaveLength(50)
        // Ilk kume (0-99) dustu -> haritada YOK. Ikinci kume (100-149) hayatta.
        expect(map.has(mints[0])).toBe(false)
        expect(map.get(mints[100])).toMatchObject({ symbol: 'OK' })
    })

    // Mint adresleri HARF KASASI KORUNARAK gonderilir/dolasir.
    it('mint adresleri kucultulmez', async () => {
        const fetchMock = vi.fn(async (_url, opts) => {
            const body = JSON.parse(opts.body)
            return { ok: true, status: 200, json: async () => ({ success: true, tokens: body.mints.map((m) => ({ mint: m, symbol: 'X' })) }) }
        })
        vi.stubGlobal('fetch', fetchMock)

        const map = await fetchTokenMetadata([MINT])
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).mints).toEqual([MINT])
        expect(map.has(MINT)).toBe(true)
        expect(map.has(MINT.toLowerCase())).toBe(false)
    })
})
