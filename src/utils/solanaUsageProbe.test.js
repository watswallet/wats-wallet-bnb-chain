import { describe, it, expect, vi } from 'vitest'
import { probeSolanaAddress } from './solanaUsageProbe'

const ADRES = '11111111111111111111111111111112'

// Gercek istemcinin (solana/client.js) hata bicimiyle ayni: Error(message).
const hata = (kod) => () => Promise.reject(new Error(kod))

// Sahte rpc: yontem -> yanit (deger ya da fonksiyon).
function sahteRpc(tablo) {
    return vi.fn(async (method, params, opts) => {
        const h = tablo[method]
        if (h === undefined) throw new Error(`beklenmeyen yontem ${method}`)
        return typeof h === 'function' ? h(params, opts) : h
    })
}

const tokenSatiri = (amount) => ({
    pubkey: 'x',
    account: { data: { parsed: { info: { tokenAmount: { amount, decimals: 6 } } } } },
})

describe('probeSolanaAddress', () => {
    it('SOL bakiyesi > 0 ise used (token cagrisi yapilmaz)', async () => {
        const rpc = sahteRpc({ getBalance: { value: 5 } })
        expect(await probeSolanaAddress(ADRES, { rpc })).toBe('used')
        expect(rpc).toHaveBeenCalledTimes(1)
        expect(rpc.mock.calls[0][0]).toBe('getBalance')
        expect(rpc.mock.calls[0][1]).toEqual([ADRES])
    })

    it('SOL 0 ve token hesabi yok ise unused', async () => {
        const rpc = sahteRpc({ getBalance: { value: 0 }, getTokenAccountsByOwner: { value: [] } })
        expect(await probeSolanaAddress(ADRES, { rpc })).toBe('unused')
        expect(rpc.mock.calls[1][0]).toBe('getTokenAccountsByOwner')
        expect(rpc.mock.calls[1][1][0]).toBe(ADRES)
        expect(rpc.mock.calls[1][1][2]).toEqual({ encoding: 'jsonParsed' })
    })

    it('SOL 0 ve tum token hesaplari bos (amount 0) ise unused', async () => {
        const rpc = sahteRpc({
            getBalance: { value: 0 },
            getTokenAccountsByOwner: { value: [tokenSatiri('0'), tokenSatiri('0')] },
        })
        expect(await probeSolanaAddress(ADRES, { rpc })).toBe('unused')
    })

    it('SOL 0 ve herhangi bir token hesabinda amount > 0 ise used', async () => {
        const rpc = sahteRpc({
            getBalance: { value: 0 },
            getTokenAccountsByOwner: { value: [tokenSatiri('0'), tokenSatiri('1500000')] },
        })
        expect(await probeSolanaAddress(ADRES, { rpc })).toBe('used')
    })

    it('u64 sinirini asan amount dizgesi de used (Number yuvarlamasina bagli degil)', async () => {
        const rpc = sahteRpc({
            getBalance: { value: 0 },
            getTokenAccountsByOwner: { value: [tokenSatiri('18446744073709551615')] },
        })
        expect(await probeSolanaAddress(ADRES, { rpc })).toBe('used')
    })

    it('getBalance reddedilirse failed', async () => {
        const rpc = sahteRpc({ getBalance: hata('SOLANA_RPC_TIMEOUT') })
        expect(await probeSolanaAddress(ADRES, { rpc })).toBe('failed')
    })

    it.each(['SOLANA_RPC_HTTP_429', 'SOLANA_RPC_HTTP_403', 'SOLANA_RPC_HTTP_502', 'SOLANA_RPC_UPSTREAM_REJECTED'])(
        'SOL cagrisi %s ile basarisiz olursa failed (token cagrisi yapilmaz)',
        async (kod) => {
            const rpc = sahteRpc({ getBalance: hata(kod) })
            expect(await probeSolanaAddress(ADRES, { rpc })).toBe('failed')
            expect(rpc).toHaveBeenCalledTimes(1)
        }
    )

    it.each(['SOLANA_RPC_HTTP_403', 'SOLANA_RPC_HTTP_502', 'SOLANA_RPC_UPSTREAM_REJECTED', 'SOLANA_RPC_HTTP_429', 'SOLANA_RPC_TIMEOUT'])(
        'SOL 0 + token cagrisi %s ise failed (unused DEGIL)',
        async (kod) => {
            const rpc = sahteRpc({ getBalance: { value: 0 }, getTokenAccountsByOwner: hata(kod) })
            expect(await probeSolanaAddress(ADRES, { rpc })).toBe('failed')
        }
    )

    it('SOL 0 + token yaniti bozuk (value dizi degil) ise failed', async () => {
        const rpc = sahteRpc({ getBalance: { value: 0 }, getTokenAccountsByOwner: { value: null } })
        expect(await probeSolanaAddress(ADRES, { rpc })).toBe('failed')
        const rpc2 = sahteRpc({ getBalance: { value: 0 }, getTokenAccountsByOwner: undefined })
        // tablo'da tanimsiz yontem sahte rpc'de firlatir -> yine failed
        expect(await probeSolanaAddress(ADRES, { rpc: rpc2 })).toBe('failed')
    })

    it('getBalance yaniti bozuksa (value sayi degil) failed', async () => {
        const rpc = sahteRpc({ getBalance: { value: 'abc' } })
        expect(await probeSolanaAddress(ADRES, { rpc })).toBe('failed')
        const rpc2 = sahteRpc({ getBalance: undefined })
        expect(await probeSolanaAddress(ADRES, { rpc: rpc2 })).toBe('failed')
    })

    it('onceden iptal edilmis sinyal: failed ve rpc hic cagrilmaz', async () => {
        const c = new AbortController()
        c.abort()
        const rpc = sahteRpc({ getBalance: { value: 5 } })
        expect(await probeSolanaAddress(ADRES, { rpc, signal: c.signal })).toBe('failed')
        expect(rpc).not.toHaveBeenCalled()
    })

    it('SOL cagrisi sirasinda iptal (SOLANA_RPC_ABORTED) failed', async () => {
        const c = new AbortController()
        const rpc = sahteRpc({
            getBalance: () => {
                c.abort()
                return Promise.reject(new Error('SOLANA_RPC_ABORTED'))
            },
        })
        expect(await probeSolanaAddress(ADRES, { rpc, signal: c.signal })).toBe('failed')
    })

    it('SOL 0 sonrasi iptal edilirse token cagrisi yapilmaz, failed', async () => {
        const c = new AbortController()
        const rpc = sahteRpc({
            getBalance: () => {
                c.abort()
                return { value: 0 }
            },
            getTokenAccountsByOwner: { value: [] },
        })
        expect(await probeSolanaAddress(ADRES, { rpc, signal: c.signal })).toBe('failed')
        expect(rpc).toHaveBeenCalledTimes(1)
    })

    it('signal ve timeoutMs her rpc cagrisina aktarilir (varsayilan 4000)', async () => {
        const c = new AbortController()
        const rpc = sahteRpc({ getBalance: { value: 0 }, getTokenAccountsByOwner: { value: [] } })
        await probeSolanaAddress(ADRES, { rpc, signal: c.signal })
        for (const cagri of rpc.mock.calls) {
            expect(cagri[2].signal).toBe(c.signal)
            expect(cagri[2].timeoutMs).toBe(4000)
        }
        const rpc2 = sahteRpc({ getBalance: { value: 1 } })
        await probeSolanaAddress(ADRES, { rpc: rpc2, timeoutMs: 1234 })
        expect(rpc2.mock.calls[0][2].timeoutMs).toBe(1234)
    })

    it('hicbir kosulda firlatmaz (rpc senkron firlatsa bile)', async () => {
        const rpc = vi.fn(() => {
            throw new Error('boom')
        })
        await expect(probeSolanaAddress(ADRES, { rpc })).resolves.toBe('failed')
    })
})
