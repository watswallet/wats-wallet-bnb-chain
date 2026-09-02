import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSolanaAssets } from './useSolanaAssets'
import { SOLANA_CHAIN_ID, SOL_NATIVE_MARKER } from '../utils/solana/constants'

const fetchSolanaAssets = vi.fn()
vi.mock('../utils/solana/balances', () => ({
    fetchSolanaAssets: (...a) => fetchSolanaAssets(...a)
}))

const ADDR = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = vi.fn(async () => ({
        ok: true, status: 200,
        json: async () => ({ success: true, tokens: [{
            mint: MINT, name: 'USD Coin', symbol: 'USDC', decimals: 6,
            logoURI: 'https://x/usdc.png', coingecko_id: 'usd-coin'
        }] })
    }))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('useSolanaAssets', () => {
    it('SOL satirini zincir kaydindan doldurur', async () => {
        fetchSolanaAssets.mockResolvedValue([{ mint: SOL_NATIVE_MARKER, amount: 2, decimals: 9 }])

        const rows = await useSolanaAssets(ADDR)

        expect(rows[0]).toMatchObject({
            chainId: SOLANA_CHAIN_ID,
            address: SOL_NATIVE_MARKER,
            symbol: 'SOL',
            decimals: 9,
            amount: 2,
            coingecko_id: 'solana',
        })
    })

    // chainId METIN kalmali: Number() ile NaN olur ve token kovasi anahtari
    // (`${chainId}_${address}`) 'NaN_...' olarak sessizce bozulur.
    it('chainId METIN olarak kalir', async () => {
        fetchSolanaAssets.mockResolvedValue([{ mint: SOL_NATIVE_MARKER, amount: 1, decimals: 9 }])
        const rows = await useSolanaAssets(ADDR)
        expect(typeof rows[0].chainId).toBe('string')
        expect(Number.isNaN(Number(rows[0].chainId))).toBe(true)
    })

    it('SPL satirini metadata ile zenginlestirir', async () => {
        fetchSolanaAssets.mockResolvedValue([{ mint: MINT, amount: 12.5, decimals: 6 }])

        const rows = await useSolanaAssets(ADDR)

        expect(rows[0]).toMatchObject({
            chainId: SOLANA_CHAIN_ID, address: MINT,
            symbol: 'USDC', name: 'USD Coin', decimals: 6,
            amount: 12.5, coingecko_id: 'usd-coin',
        })
    })

    // Metadata bilinmeyen token, LISTEDEN DUSURULMEZ: kullanicinin gercekten
    // sahip oldugu bir bakiye gorunmez olursa parasi kaybolmus sanir.
    it('metadata bulunamayan token mint kisaltmasiyla gosterilir', async () => {
        globalThis.fetch = vi.fn(async () => ({
            ok: true, status: 200, json: async () => ({ success: true, tokens: [] })
        }))
        fetchSolanaAssets.mockResolvedValue([{ mint: MINT, amount: 3, decimals: 6 }])

        const rows = await useSolanaAssets(ADDR)

        expect(rows).toHaveLength(1)
        expect(rows[0].address).toBe(MINT)
        expect(rows[0].amount).toBe(3)
        expect(rows[0].symbol).toBeTruthy()
        expect(rows[0].coingecko_id).toBe(null)
    })

    // Metadata ucu duserse bakiyeler YINE gosterilir.
    it('metadata cagrisi duserse satirlar kaybolmaz', async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }))
        fetchSolanaAssets.mockResolvedValue([{ mint: MINT, amount: 3, decimals: 6 }])

        const rows = await useSolanaAssets(ADDR)
        expect(rows).toHaveLength(1)
        expect(rows[0].amount).toBe(3)
    })

    it('adres yoksa bos liste, ag cagrisi yok', async () => {
        await expect(useSolanaAssets(null)).resolves.toEqual([])
        expect(fetchSolanaAssets).not.toHaveBeenCalled()
    })

    it('hic varlik yoksa SOL satiri bile yoksa bos doner', async () => {
        fetchSolanaAssets.mockResolvedValue([])
        await expect(useSolanaAssets(ADDR)).resolves.toEqual([])
    })
})

// FINDING 1 (review): Home.vue'nin varlik satiri sablonu `token.image.large` VE
// `token.symbol.toUpperCase()`'i GUARD'SIZ okuyor. `image` undefined ise ilk
// okuma, `symbol` undefined/null ise ikinci okuma THROW eder ve butun render
// coker — bir wiring testi (kaynak metnini regex'le tarayan) bunu YAKALAYAMAZ,
// cunku sorun DEGERIN KENDISI (calisma zamaninda undefined), metnin sekli degil.
// Bu yuzden burada GERCEK DONUS DEGERI dogrulanir.
describe('useSolanaAssets — satir sekli Home.vue sablonunun GUARD SIZ okudugu alanlari karsilar', () => {
    const expectRenderableRow = (row) => {
        expect(typeof row.symbol, 'symbol').toBe('string')
        expect(row.symbol.length, 'symbol bos olamaz').toBeGreaterThan(0)
        expect(typeof row.image, 'image bir NESNE olmali (undefined degil)').toBe('object')
        expect(row.image, 'image null olamaz').not.toBeNull()
        expect(typeof row.image.large, 'image.large bir DIZGE olmali').toBe('string')
    }

    it('SOL satiri render edilebilir sekilde doner', async () => {
        fetchSolanaAssets.mockResolvedValue([{ mint: SOL_NATIVE_MARKER, amount: 2, decimals: 9 }])
        const rows = await useSolanaAssets(ADDR)
        expectRenderableRow(rows[0])
        expect(rows[0].image.large.length).toBeGreaterThan(0)
    })

    it('metadatasi bilinen SPL satiri render edilebilir sekilde doner', async () => {
        fetchSolanaAssets.mockResolvedValue([{ mint: MINT, amount: 12.5, decimals: 6 }])
        const rows = await useSolanaAssets(ADDR)
        expectRenderableRow(rows[0])
        expect(rows[0].image.large).toBe('https://x/usdc.png')
    })

    // Metadatasi BULUNAMAYAN satir tam olarak bu findingin kok nedeni: eski
    // kodda `image` alani hic yoktu, yalniz burada degil HER satirda.
    it('metadatasi bulunamayan SPL satiri da render edilebilir sekilde doner', async () => {
        globalThis.fetch = vi.fn(async () => ({
            ok: true, status: 200, json: async () => ({ success: true, tokens: [] })
        }))
        fetchSolanaAssets.mockResolvedValue([{ mint: MINT, amount: 3, decimals: 6 }])
        const rows = await useSolanaAssets(ADDR)
        expectRenderableRow(rows[0])
        // Varsayilan gorsele duser, ama TANIMLI bir dizge olarak — undefined DEGIL.
        expect(rows[0].image.large).toBe('/default-token.png')
    })
})

// Minor (review): sunucu /solana/tokens'i 100 mint'te sinirliyor (400 uzerinde).
// Airdrop'la doldurulmus cuzdanlarda 100'den fazla SPL hesabi siradan; tek
// istekte hepsi gonderilirse eski kod TUM metadata haritasini bos birakirdi.
describe('useSolanaAssets — 100 mint sinirina karsi kumeleme', () => {
    const manyMints = (n) => Array.from({ length: n }, (_, i) => `${MINT.slice(0, -3)}${String(i).padStart(3, '0')}`)

    it('250 SPL hesabi 100luk kumeler halinde 3 istekte gonderilir', async () => {
        const mints = manyMints(250)
        fetchSolanaAssets.mockResolvedValue(mints.map((mint) => ({ mint, amount: 1, decimals: 6 })))

        const calls = []
        globalThis.fetch = vi.fn(async (_url, opts) => {
            const body = JSON.parse(opts.body)
            calls.push(body.mints.length)
            return {
                ok: true, status: 200,
                json: async () => ({
                    success: true,
                    tokens: body.mints.map((mint) => ({ mint, symbol: 'X', name: 'X', decimals: 6, coingecko_id: null })),
                }),
            }
        })

        const rows = await useSolanaAssets(ADDR)

        expect(calls).toEqual([100, 100, 50])
        expect(rows).toHaveLength(250)
        // Her 250 mint de gercek metadata aldi (kirpma sonrasi haritada kayip yok).
        expect(rows.every((r) => r.symbol === 'X')).toBe(true)
    })

    // Bir kumenin dusmesi DIGERLERININ metadata'sini SILMEMELI — eski TEK
    // istekli tasarimin asil kusuru buydu.
    it('bir kume 400/502 donse bile diger kumenin metadatasi kaybolmaz', async () => {
        const mints = manyMints(150)
        fetchSolanaAssets.mockResolvedValue(mints.map((mint) => ({ mint, amount: 1, decimals: 6 })))

        let callIndex = -1
        globalThis.fetch = vi.fn(async (_url, opts) => {
            callIndex += 1
            const body = JSON.parse(opts.body)
            if (callIndex === 0) return { ok: false, status: 502, json: async () => ({}) }
            return {
                ok: true, status: 200,
                json: async () => ({
                    success: true,
                    tokens: body.mints.map((mint) => ({ mint, symbol: 'OK', name: 'OK', decimals: 6, coingecko_id: 'ok' })),
                }),
            }
        })

        const rows = await useSolanaAssets(ADDR)

        expect(rows).toHaveLength(150)
        const failedBatch = rows.slice(0, 100)
        const okBatch = rows.slice(100)
        // Dusen kumenin tokenleri hala GORUNUR (mint kisaltmasiyla), fiyatsiz.
        expect(failedBatch.every((r) => r.coingecko_id === null)).toBe(true)
        // Basarili kume metadatasini KORUR.
        expect(okBatch.every((r) => r.symbol === 'OK')).toBe(true)
    })
})
