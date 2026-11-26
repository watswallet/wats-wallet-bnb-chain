// Takas "Alinan" secicisinde sunucu aramasi (canli bulgu 2026-11-20): arama kutusu yalniz YUKLU sayfanin (populer
// siradaki ilk 50 token) icinde ariyordu; sunucunun /getChainTokens `search` alani hic kullanilmiyordu. BSC'de USDC
// "usdc" yazilinca bulunamadi, sunucuya ayni arama sorulunca bulundu.
import { describe, it, expect, vi } from 'vitest'
import {
    createRemoteTokenSearch, mergeTokenLists, combineSearchResults, REMOTE_SEARCH_MIN_LENGTH, REMOTE_SEARCH_DELAY_MS,
} from './remoteTokenSearch'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(fetchImpl) {
    vi.useFakeTimers()
    const results = []
    const fetchTokens = vi.fn(fetchImpl || (async (q) => [{ address: '0xAA', symbol: q }]))
    const search = createRemoteTokenSearch({ fetchTokens, onResult: (r) => results.push(r) })
    return { results, fetchTokens, search }
}

describe('createRemoteTokenSearch', () => {
    it('sabitler: en az 2 karakter, 300 ms bekleme', () => {
        expect(REMOTE_SEARCH_MIN_LENGTH).toBe(2)
        expect(REMOTE_SEARCH_DELAY_MS).toBe(300)
    })

    it('yazma bitene kadar bekler; yalniz SON sorgu sunucuya gider (bosluklar kirpilir)', async () => {
        const { results, fetchTokens, search } = setup()
        search.request('us')
        search.request('usd')
        search.request(' usdc ')
        await vi.advanceTimersByTimeAsync(REMOTE_SEARCH_DELAY_MS - 1)
        expect(fetchTokens).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        expect(fetchTokens).toHaveBeenCalledTimes(1)
        expect(fetchTokens).toHaveBeenCalledWith('usdc')
        expect(results.at(-1)).toEqual({ query: 'usdc', tokens: [{ address: '0xAA', symbol: 'usdc' }] })
        vi.useRealTimers()
    })

    it('2 karakterden kisa sorgu sunucuya gitmez ve sonucu HEMEN bosaltir', async () => {
        const { results, fetchTokens, search } = setup()
        search.request('u')
        search.request('')
        await vi.advanceTimersByTimeAsync(REMOTE_SEARCH_DELAY_MS * 2)
        expect(fetchTokens).not.toHaveBeenCalled()
        expect(results).toEqual([{ query: 'u', tokens: [] }, { query: '', tokens: [] }])
        vi.useRealTimers()
    })

    it('gec gelen ESKI yanit yeni aramanin sonucunu ezmez', async () => {
        let release
        const slow = new Promise((resolve) => { release = resolve })
        const { results, search } = setup(async (q) => (q === 'usdt' ? slow : [{ address: '0xBB', symbol: q }]))
        search.request('usdt')
        await vi.advanceTimersByTimeAsync(REMOTE_SEARCH_DELAY_MS)   // usdt istegi basladi, yanit bekliyor
        search.request('usdc')
        await vi.advanceTimersByTimeAsync(REMOTE_SEARCH_DELAY_MS)
        release([{ address: '0xOLD', symbol: 'usdt' }])
        await vi.advanceTimersByTimeAsync(0)
        expect(results.map((r) => r.query)).toEqual(['usdc'])
        vi.useRealTimers()
    })

    it('sunucu hatasi bos sonuc verir, firlatmaz', async () => {
        const { results, search } = setup(async () => { throw new Error('ag') })
        search.request('usdc')
        await vi.advanceTimersByTimeAsync(REMOTE_SEARCH_DELAY_MS)
        expect(results).toEqual([{ query: 'usdc', tokens: [] }])
        vi.useRealTimers()
    })

    it('dizi olmayan yanit bos sonuc sayilir', async () => {
        const { results, search } = setup(async () => ({ tokens: 'x' }))
        search.request('usdc')
        await vi.advanceTimersByTimeAsync(REMOTE_SEARCH_DELAY_MS)
        expect(results).toEqual([{ query: 'usdc', tokens: [] }])
        vi.useRealTimers()
    })

    it('cancel bekleyen ve suren aramanin sonucunu dusurur', async () => {
        const { results, fetchTokens, search } = setup()
        search.request('usdc')
        search.cancel()
        await vi.advanceTimersByTimeAsync(REMOTE_SEARCH_DELAY_MS * 2)
        expect(fetchTokens).not.toHaveBeenCalled()
        expect(results).toEqual([])
        vi.useRealTimers()
        await flush()
    })
})

describe('mergeTokenLists', () => {
    it('once birinci liste, sonra ikincinin yenileri; adres harf duyarsiz tekil', () => {
        const a = [{ address: '0xAbC', symbol: 'a' }, { address: '0x1', symbol: 'b' }]
        const b = [{ address: '0xabc', symbol: 'a-kopya' }, { address: '0x2', symbol: 'c' }]
        expect(mergeTokenLists(a, b).map((t) => t.symbol)).toEqual(['a', 'b', 'c'])
    })

    it('adressiz / bos satirlar atlanir, null listeler bos sayilir', () => {
        expect(mergeTokenLists(null, [null, { symbol: 'x' }, { address: '0x3', symbol: 'y' }]).map((t) => t.symbol)).toEqual(['y'])
    })
})

describe('combineSearchResults', () => {
    const USDC = { address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', symbol: 'usdc', name: 'USDC' }
    const VUSDC = { address: '0xeca88125a5adbe82614ffc12d0db554e2e2867c8', symbol: 'vusdc', name: 'Venus USDC' }
    const LOCAL = { address: '0x1111111111111111111111111111111111111111', symbol: 'usdcx', name: 'Yerel' }

    it('canli vaka: yerelde yok, sunucu buldu -> USDC listede ve tam eslesme en ustte', () => {
        const r = combineSearchResults({ localMatches: [LOCAL], remote: { query: 'usdc', tokens: [VUSDC, USDC] }, query: 'USDC ' })
        expect(r.map((t) => t.symbol)).toEqual(['usdc', 'usdcx', 'vusdc'])
    })

    it('sunucu sonucu BASKA bir sorguya aitse (yazma suruyor) yalniz yerel eslesmeler', () => {
        const r = combineSearchResults({ localMatches: [LOCAL], remote: { query: 'usd', tokens: [USDC] }, query: 'usdc' })
        expect(r).toEqual([LOCAL])
    })

    it('secicinin suzgeci (keep) sunucu satirlarina da uygulanir', () => {
        const r = combineSearchResults({
            localMatches: [], remote: { query: 'usdc', tokens: [USDC, VUSDC] }, query: 'usdc', keep: (t) => t.symbol !== 'vusdc',
        })
        expect(r).toEqual([USDC])
    })

    it('yerelde zaten olan satir sunucudan ikinci kez gelmez (adres harf duyarsiz)', () => {
        const yerelUsdc = { ...USDC, address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' }
        const r = combineSearchResults({ localMatches: [yerelUsdc], remote: { query: 'usdc', tokens: [USDC] }, query: 'usdc' })
        expect(r).toEqual([yerelUsdc])
    })

    it('bozuk remote (null, dizi olmayan tokens) yerel eslesmelere duser', () => {
        expect(combineSearchResults({ localMatches: [LOCAL], remote: null, query: 'usdc' })).toEqual([LOCAL])
        expect(combineSearchResults({ localMatches: [LOCAL], remote: { query: 'usdc', tokens: 'x' }, query: 'usdc' })).toEqual([LOCAL])
    })
})
