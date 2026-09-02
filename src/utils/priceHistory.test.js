import { describe, it, expect, beforeEach, vi } from 'vitest'
import axios from 'axios'
import { toChartPoints, fetchPriceHistory } from './priceHistory'

vi.mock('axios', () => ({ default: { post: vi.fn() } }))

const API = 'https://api.test'

beforeEach(() => { axios.post.mockReset() })

describe('toChartPoints', () => {
    it('[ms, fiyat] ciftlerini grafik noktalarina cevirir', () => {
        const points = toChartPoints([[1700000000000, 1.5], [1700086400000, 1.75]])
        expect(points).toHaveLength(2)
        expect(points[0].close).toBe(1.5)
        expect(typeof points[0].date).toBe('string')
    })

    // Asil hata: saglayici bos/bozuk govde dondugunde map() TypeError firlatiyor,
    // onMounted'daki yakalanmayan promise reddi grafik alanini BOS canvas birakiyordu.
    it('bozuk govdede bos dizi doner, firlatmaz', () => {
        expect(toChartPoints(null)).toEqual([])
        expect(toChartPoints(undefined)).toEqual([])
        expect(toChartPoints('nope')).toEqual([])
        expect(toChartPoints([{ close: 1 }])).toEqual([])
    })

    it('sayisal olmayan noktalari atar', () => {
        expect(toChartPoints([[1, 1], ['x', 2], [3, null], [4, 4]]).map(p => p.close)).toEqual([1, 4])
    })
})

describe('fetchPriceHistory', () => {
    it('sunucudaki fiyat gecmisi ucuna coingecko kimligiyle gider', async () => {
        axios.post.mockResolvedValue({ status: 200, data: { success: true, prices: [[1, 2]] } })

        const points = await fetchPriceHistory(API, 'bitcoin')

        expect(axios.post).toHaveBeenCalledWith(
            API + '/getTokenPriceHistory',
            expect.objectContaining({ id: 'bitcoin' }),
            expect.anything()
        )
        expect(points).toHaveLength(1)
    })

    // Ice aktarilan uzun kuyruk tokenlerin coingecko kimligi olmayabiliyor:
    // bu durumda ag istegi HIC yapilmamali.
    it('kimlik yoksa istek atmaz', async () => {
        expect(await fetchPriceHistory(API, null)).toEqual([])
        expect(await fetchPriceHistory(API, '')).toEqual([])
        expect(await fetchPriceHistory('', 'bitcoin')).toEqual([])
        expect(axios.post).not.toHaveBeenCalled()
    })

    it('ag hatasinda bos dizi doner', async () => {
        axios.post.mockRejectedValue(new Error('network down'))
        expect(await fetchPriceHistory(API, 'bitcoin')).toEqual([])
    })

    it('basarisiz/bos yanitta bos dizi doner', async () => {
        axios.post.mockResolvedValue({ status: 200, data: { success: false } })
        expect(await fetchPriceHistory(API, 'bitcoin')).toEqual([])

        axios.post.mockResolvedValue({ status: 500, data: {} })
        expect(await fetchPriceHistory(API, 'bitcoin')).toEqual([])
    })
})
