// readSolanaBalanceOrThrow: Send ve Onay ekranlarinin Solana bakiye okumasinin TEK noktasi
// (final cuzdan-istemci-1). KOK NEDEN: fetchSolanaAssets iki RPC hatasini kendi icinde yutar ve
// yalniz dizinin numaralandirilamaz splFailed/solFailed ozelligini isaretler; cagirani
// `find(...)?.amount || 0` ile okuyan ekran okuma hatasini "0 bakiye" diye gosteriyordu.
// KURAL: okuma hatasi ASLA 0 bakiye olmaz; hedef varligin okumasi dustuyse FIRLATIR.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchSolanaAssetsMock = vi.fn()
vi.mock('./balances', () => ({
    fetchSolanaAssets: (...args) => fetchSolanaAssetsMock(...args),
}))

import { readSolanaBalanceOrThrow } from './readBalance'
import { SOL_NATIVE_MARKER } from './constants'

const ADDRESS = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

/** fetchSolanaAssets'in gercek cikti sekli: satir dizisi + numaralandirilamaz hata bayraklari. */
function assetsWith(rows, { splFailed, solFailed } = {}) {
    const out = [...rows]
    if (splFailed !== undefined) Object.defineProperty(out, 'splFailed', { value: splFailed, enumerable: false })
    if (solFailed !== undefined) Object.defineProperty(out, 'solFailed', { value: solFailed, enumerable: false })
    return out
}

const SOL_ROW = { mint: SOL_NATIVE_MARKER, amount: 10, decimals: 9 }
const USDC_ROW = { mint: USDC, amount: 12.5, decimals: 6 }

beforeEach(() => {
    fetchSolanaAssetsMock.mockReset()
})

describe('readSolanaBalanceOrThrow', () => {
    it('SPL hedef: satir varsa miktari doner, adresi fetchSolanaAssets e verir', async () => {
        fetchSolanaAssetsMock.mockResolvedValue(assetsWith([SOL_ROW, USDC_ROW], { splFailed: false, solFailed: false }))
        expect(await readSolanaBalanceOrThrow(ADDRESS, USDC)).toBe(12.5)
        expect(fetchSolanaAssetsMock).toHaveBeenCalledWith(ADDRESS)
    })

    it('native hedef: SOL satirinin miktarini doner', async () => {
        fetchSolanaAssetsMock.mockResolvedValue(assetsWith([SOL_ROW, USDC_ROW], { splFailed: false, solFailed: false }))
        expect(await readSolanaBalanceOrThrow(ADDRESS, SOL_NATIVE_MARKER)).toBe(10)
    })

    it('SPL hedef, okuma BASARILI ama satir yok (ATA yok / bakiye 0): gercek 0 doner, firlatmaz', async () => {
        fetchSolanaAssetsMock.mockResolvedValue(assetsWith([SOL_ROW], { splFailed: false, solFailed: false }))
        expect(await readSolanaBalanceOrThrow(ADDRESS, USDC)).toBe(0)
    })

    it('SPL hedef + splFailed: SOL satiri gelse de FIRLATIR (0 bakiye DEGIL)', async () => {
        fetchSolanaAssetsMock.mockResolvedValue(assetsWith([SOL_ROW], { splFailed: true, solFailed: false }))
        await expect(readSolanaBalanceOrThrow(ADDRESS, USDC)).rejects.toThrow('SOLANA_BALANCE_UNAVAILABLE')
    })

    it('native hedef + solFailed: SPL satirlari gelse de FIRLATIR (0 bakiye DEGIL)', async () => {
        fetchSolanaAssetsMock.mockResolvedValue(assetsWith([USDC_ROW], { splFailed: false, solFailed: true }))
        await expect(readSolanaBalanceOrThrow(ADDRESS, SOL_NATIVE_MARKER)).rejects.toThrow('SOLANA_BALANCE_UNAVAILABLE')
    })

    it('hedefle ILGISIZ okuma hatasi firlatmaz: SPL hedef + yalniz solFailed -> SPL miktari; native hedef + yalniz splFailed -> SOL miktari', async () => {
        fetchSolanaAssetsMock.mockResolvedValue(assetsWith([USDC_ROW], { splFailed: false, solFailed: true }))
        expect(await readSolanaBalanceOrThrow(ADDRESS, USDC)).toBe(12.5)

        fetchSolanaAssetsMock.mockResolvedValue(assetsWith([SOL_ROW], { splFailed: true, solFailed: false }))
        expect(await readSolanaBalanceOrThrow(ADDRESS, SOL_NATIVE_MARKER)).toBe(10)
    })

    it('bayraksiz duz dizi (balances modulunu yalniz fetchSolanaAssets ile mock leyen testler) hata sayilmaz', async () => {
        fetchSolanaAssetsMock.mockResolvedValue([SOL_ROW])
        expect(await readSolanaBalanceOrThrow(ADDRESS, SOL_NATIVE_MARKER)).toBe(10)
    })

    it('fetchSolanaAssets firlatirsa hata aynen yukari cikar', async () => {
        fetchSolanaAssetsMock.mockRejectedValue(new Error('SOLANA_RPC_TIMEOUT'))
        await expect(readSolanaBalanceOrThrow(ADDRESS, SOL_NATIVE_MARKER)).rejects.toThrow('SOLANA_RPC_TIMEOUT')
    })

    it('bos adres okunamaz sayilir: firlatir, ag cagrisi yapilmaz', async () => {
        await expect(readSolanaBalanceOrThrow('', SOL_NATIVE_MARKER)).rejects.toThrow('SOLANA_BALANCE_UNAVAILABLE')
        expect(fetchSolanaAssetsMock).not.toHaveBeenCalled()
    })
})
