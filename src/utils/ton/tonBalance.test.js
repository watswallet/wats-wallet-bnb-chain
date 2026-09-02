import { describe, it, expect, vi } from 'vitest'
import { getTonBalance } from './tonBalance'

const UQ = 'UQAgPlDEUtqTMAJ1fpGT0AFebk85pdtOYKq72I5Eq9VIIy1P'

describe('getTonBalance', () => {
    it('nanoton u 9 ondalikla TON a cevirir', async () => {
        const client = { getBalance: vi.fn(async () => 2500000000n) }
        expect(await getTonBalance(client, UQ)).toBe(2.5)
    })

    it('sifir bakiye sifir doner', async () => {
        const client = { getBalance: vi.fn(async () => 0n) }
        expect(await getTonBalance(client, UQ)).toBe(0)
    })

    it('adres ayristirilip client a Address olarak verilir', async () => {
        const client = { getBalance: vi.fn(async () => 1n) }
        await getTonBalance(client, `  ${UQ}  `)
        const [arg] = client.getBalance.mock.calls[0]
        expect(typeof arg.toString).toBe('function')
        expect(arg.toString({ bounceable: false })).toBe(UQ)
    })

    it('ag hatasi YUTULMAZ', async () => {
        // Hata 0'a cevrilirse kullanici parasi gitmis sanir. Hata yuzeye cikmali.
        const client = { getBalance: vi.fn(async () => { throw new Error('proxy down') }) }
        await expect(getTonBalance(client, UQ)).rejects.toThrow('proxy down')
    })

    it('gecersiz adres hata atar', async () => {
        const client = { getBalance: vi.fn() }
        await expect(getTonBalance(client, '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d'))
            .rejects.toThrow('TON_ADDRESS_IS_EVM')
        expect(client.getBalance).not.toHaveBeenCalled()
    })
})
