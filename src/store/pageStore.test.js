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

describe('pageStore.navIntent / navigate', () => {
    it('navIntent varsayilan null ve state te yer alir', () => {
        expect(pageStore().navIntent).toBeNull()
        expect(Object.keys(pageStore().$state)).toContain('navIntent')
    })

    it("navigate('send','back') sayfayi ve niyeti yazar", () => {
        const p = pageStore()
        p.navigate('send', 'back')
        expect(p.currentPage).toBe('send')
        expect(p.navIntent).toBe('back')
    })

    it('acik sayfaya navigate yalniz niyeti null a ceker', () => {
        const p = pageStore()
        p.currentPage = 'send'
        p.navIntent = 'back'
        p.navigate('send', 'back')
        expect(p.currentPage).toBe('send')
        expect(p.navIntent).toBeNull()
    })
})

describe('pageStore.balanceVisible (kaymak D4)', () => {
    it('varsayilan null (henuz okunmadi) ve state te yer alir', () => {
        expect(pageStore().balanceVisible).toBeNull()
        expect(Object.keys(pageStore().$state)).toContain('balanceVisible')
    })

    it('yazilan deger ayni store ornegini kullanan ikinci cagirana gorunur', () => {
        pageStore().balanceVisible = false
        expect(pageStore().balanceVisible).toBe(false)
    })
})

describe('pageStore.stockChip (kaymak D5)', () => {
    it('varsayilan null (henuz secilmedi) ve state te yer alir', () => {
        expect(pageStore().stockChip).toBeNull()
        expect(Object.keys(pageStore().$state)).toContain('stockChip')
    })

    it('yazilan deger ayni store ornegini kullanan ikinci cagirana gorunur', () => {
        pageStore().stockChip = 56
        expect(pageStore().stockChip).toBe(56)
        pageStore().stockChip = 'all'
        expect(pageStore().stockChip).toBe('all')
    })
})

describe('pageStore.homeScroll (kaymak G13, spec 7.10)', () => {
    it('varsayilan null ve state te yer alir', () => {
        expect(pageStore().homeScroll).toBeNull()
        expect(Object.keys(pageStore().$state)).toContain('homeScroll')
    })

    it('yazilan deger ayni store ornegini kullanan ikinci cagirana gorunur ve null a cekilince temizlenir', () => {
        const kayit = { key: 'acc1|0|all', tab: 'assets', top: 120, anchorKey: '56_0xabc', anchorOffset: 4 }
        pageStore().homeScroll = kayit
        expect(pageStore().homeScroll).toEqual(kayit)
        pageStore().homeScroll = null
        expect(pageStore().homeScroll).toBeNull()
    })
})
