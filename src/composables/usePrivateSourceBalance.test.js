import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, nextTick } from 'vue'

vi.mock('./useTokenBalance', () => ({ useTokenBalance: vi.fn() }))

import { useTokenBalance } from './useTokenBalance'
import { usePrivateSourceBalance } from './usePrivateSourceBalance'

const FUND = '0x1111111111111111111111111111111111111111'
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
const ZERO = '0x0000000000000000000000000000000000000000'
const BSC = { chainId: 56, rpc: [{ url: 'https://rpc-1.example' }, { url: 'https://rpc-2.example' }] }
const BASE = { chainId: 8453, rpc: [{ url: 'https://base-1.example' }, { url: 'https://base-2.example' }] }

const flush = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); await nextTick() } }
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

beforeEach(() => { useTokenBalance.mockReset() })

describe('usePrivateSourceBalance', () => {
    it('fund adresi + BSC USDC: (adres, USDC adresi, ilk RPC, 56) ile bir kez cagrilir', async () => {
        useTokenBalance.mockResolvedValue(42.5)
        const { balance, loading } = usePrivateSourceBalance({ address: ref(FUND), chain: ref(BSC), asset: ref('USDC') })
        expect(loading.value).toBe(true)
        await flush()
        expect(useTokenBalance).toHaveBeenCalledTimes(1)
        expect(useTokenBalance).toHaveBeenCalledWith(FUND, USDC_BSC, 'https://rpc-1.example', 56)
        expect(balance.value).toBe(42.5)
        expect(loading.value).toBe(false)
    })

    it('yerel varlik sifir adresle sorgulanir', async () => {
        useTokenBalance.mockResolvedValue(1.25)
        const { balance } = usePrivateSourceBalance({ address: ref(FUND), chain: ref(BASE), asset: ref('ETH') })
        await flush()
        expect(useTokenBalance).toHaveBeenCalledWith(FUND, ZERO, 'https://base-1.example', 8453)
        expect(balance.value).toBe(1.25)
    })

    it('ikinci RPC hic sorgulanmaz (yalniz ilk RPC)', async () => {
        useTokenBalance.mockResolvedValue(3)
        const { refresh } = usePrivateSourceBalance({ address: ref(FUND), chain: ref(BSC), asset: ref('USDC') })
        await flush()
        await refresh()
        expect(useTokenBalance).toHaveBeenCalledTimes(2)
        for (const call of useTokenBalance.mock.calls) expect(call[2]).toBe('https://rpc-1.example')
    })

    it('girdi eksikse (chain null, adres yok, varlik bos, bilinmeyen varlik, RPC yok) cagri yok ve balance null', async () => {
        const cases = [
            { address: ref(FUND), chain: ref(null), asset: ref('USDC') },
            { address: ref(null), chain: ref(BSC), asset: ref('USDC') },
            { address: ref(FUND), chain: ref(BSC), asset: ref('') },
            { address: ref(FUND), chain: ref(BSC), asset: ref('YOKTOKEN') },
            { address: ref(FUND), chain: ref({ chainId: 56, rpc: [] }), asset: ref('USDC') },
        ]
        for (const c of cases) {
            const { balance, loading } = usePrivateSourceBalance(c)
            await flush()
            expect(balance.value).toBeNull()
            expect(loading.value).toBe(false)
        }
        expect(useTokenBalance).not.toHaveBeenCalled()
    })

    it('taklit reddedilirse balance null ve loading kapanir', async () => {
        useTokenBalance.mockRejectedValue(new Error('rpc down'))
        const { balance, loading } = usePrivateSourceBalance({ address: ref(FUND), chain: ref(BSC), asset: ref('USDC') })
        await flush()
        expect(balance.value).toBeNull()
        expect(loading.value).toBe(false)
    })

    it('iki ardisik refresh (ilki yavas): yalniz ikincinin degeri kalir', async () => {
        useTokenBalance.mockResolvedValueOnce(1)
        const { balance, refresh } = usePrivateSourceBalance({ address: ref(FUND), chain: ref(BSC), asset: ref('USDC') })
        await flush()
        expect(balance.value).toBe(1)
        const slow = deferred()
        const fast = deferred()
        useTokenBalance.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)
        const p1 = refresh()
        const p2 = refresh()
        fast.resolve(7)
        await p2
        expect(balance.value).toBe(7)
        slow.resolve(99)
        await p1
        await flush()
        expect(balance.value).toBe(7)
    })

    it('girdi degisince balance hemen null olur, iki girdi ayni tikte degisirse tek okuma yapilir (X3)', async () => {
        const first = deferred()
        const second = deferred()
        useTokenBalance.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
        const chain = ref(BSC)
        const asset = ref('USDC')
        const { balance } = usePrivateSourceBalance({ address: ref(FUND), chain, asset })
        await flush()
        first.resolve(10)
        await flush()
        expect(balance.value).toBe(10)
        chain.value = BASE
        asset.value = 'ETH'
        // Esgudumlu: izleyici henuz kosmadan eski deger gorunmemeli.
        expect(balance.value).toBeNull()
        await flush()
        expect(useTokenBalance).toHaveBeenCalledTimes(2)
        expect(useTokenBalance).toHaveBeenLastCalledWith(FUND, ZERO, 'https://base-1.example', 8453)
        second.resolve(0.5)
        await flush()
        expect(balance.value).toBe(0.5)
    })

    it('girdi degisince uctaki eski yanit sonradan gelirse yazilmaz', async () => {
        const old = deferred()
        const fresh = deferred()
        useTokenBalance.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
        const asset = ref('USDC')
        const { balance } = usePrivateSourceBalance({ address: ref(FUND), chain: ref(BASE), asset })
        await flush()
        asset.value = 'ETH'
        await flush()
        fresh.resolve(2)
        await flush()
        expect(balance.value).toBe(2)
        old.resolve(500)
        await flush()
        expect(balance.value).toBe(2)
    })

    it('ComputedRef girdileri de calisir', async () => {
        useTokenBalance.mockResolvedValue(5)
        const idx = ref(0)
        const chain = computed(() => [BSC, BASE][idx.value])
        const asset = computed(() => ['USDC', 'ETH'][idx.value])
        const { balance } = usePrivateSourceBalance({ address: computed(() => FUND), chain, asset })
        await flush()
        expect(useTokenBalance).toHaveBeenCalledTimes(1)
        idx.value = 1
        await flush()
        expect(useTokenBalance).toHaveBeenCalledTimes(2)
        expect(useTokenBalance).toHaveBeenLastCalledWith(FUND, ZERO, 'https://base-1.example', 8453)
        expect(balance.value).toBe(5)
    })
})
