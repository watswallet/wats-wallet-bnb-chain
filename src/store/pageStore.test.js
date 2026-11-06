import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { pageStore } from './pageStore'

// Bu dosya pageStore'un setup-store return listesini kilitler: tuketici testleri, yeni bir ref return { ... } listesinden
// dusse bile gecer (ref bu durumda duz bir ozellik gibi davranir ve $state'te gorunmez).

beforeEach(() => { setActivePinia(createPinia()) })

describe('pageStore.privateSwapSource', () => {
    it('varsayilan null', () => {
        expect(pageStore().privateSwapSource).toBeNull()
    })

    it('store durumunda (state) yer alir: return listesinden dusmemis', () => {
        expect(Object.keys(pageStore().$state)).toContain('privateSwapSource')
    })

    it('yazilan deger ayni store ornegini kullanan ikinci cagirana gorunur ve null a cekilince temizlenir', () => {
        pageStore().privateSwapSource = { chainId: 137, asset: 'USDC' }
        expect(pageStore().privateSwapSource).toEqual({ chainId: 137, asset: 'USDC' })
        pageStore().privateSwapSource = null
        expect(pageStore().privateSwapSource).toBeNull()
    })
})
