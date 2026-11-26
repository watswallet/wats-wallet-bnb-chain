import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createPageNavController, NAV_DURATION_MS } from './pageNav'
import { yorumsuz } from '../test-utils/kaynakTarama'

function sahteDoc({ reduce = false, sinif = [] } = {}) {
    const attrs = {}
    return {
        attrs,
        visibilityState: 'visible',
        defaultView: { matchMedia: () => ({ matches: reduce }) },
        documentElement: {
            setAttribute: (k, v) => { attrs[k] = v },
            classList: { contains: (c) => sinif.includes(c) },
        },
    }
}

const kur = (opts = {}) => {
    const doc = opts.doc ?? sahteDoc()
    const page = { navIntent: null }
    let reset = 0
    const gizli = { v: opts.gizli ?? false }
    const c = createPageNavController({
        doc, page, getPrivacyActive: () => gizli.v, onReset: () => { reset++ }, pickNav: opts.pickNav,
        approvalPages: ['dapp_router'],
    })
    return { c, doc, page, gizli, resets: () => reset }
}

describe('createPageNavController', () => {
    it('acilis: none, 120', () => {
        const { c, doc } = kur()
        const r = c.onPageChange('home', '')
        expect(r).toEqual({ nav: 'none', duration: 120 })
        expect(doc.attrs['data-nav']).toBe('none')
    })
    it('ileri ve geri', () => {
        const { c, doc } = kur()
        c.onPageChange('home', '')
        expect(c.onPageChange('send', 'home')).toEqual({ nav: 'fwd', duration: 200 })
        expect(doc.attrs['data-nav']).toBe('fwd')
        expect(c.onPageChange('home', 'send')).toEqual({ nav: 'back', duration: 200 })
        expect(doc.attrs['data-nav']).toBe('back')
        expect(c.stack()).toEqual(['home'])
    })
    it('niyet tuketilir', () => {
        const { c, page } = kur()
        c.onPageChange('home', '')
        page.navIntent = 'back'
        c.onPageChange('send', 'home')
        expect(page.navIntent).toBeNull()
    })
    it('geri niyeti ziyaret edilmemis ust sayfayi geri yapar (7.4 yol 1)', () => {
        const { c, page } = kur()
        c.onPageChange('home', '')
        c.onPageChange('token', 'home')
        c.onPageChange('send', 'token')
        page.navIntent = 'back'
        expect(c.onPageChange('select_asset', 'send').nav).toBe('back')
        expect(c.stack()).toEqual(['home', 'token', 'select_asset'])
    })
    it('notr niyet: none, yigin yine guncellenir (7.4 yol 6)', () => {
        const { c, page } = kur()
        c.onPageChange('home', '')
        c.onPageChange('swap', 'home')
        page.navIntent = 'neutral'
        expect(c.onPageChange('home', 'swap')).toEqual({ nav: 'none', duration: 120 })
        expect(c.stack()).toEqual(['home'])
    })
    it('onay sayfalari: none, reset yok', () => {
        const { c, resets } = kur()
        c.onPageChange('home', '')
        expect(c.onPageChange('dapp_router', 'home').nav).toBe('none')
        expect(resets()).toBe(0)
    })
    it('gizli mod degisimi sayfa degisimiyle: none + reset', () => {
        const { c, gizli, resets } = kur()
        c.onPageChange('private_send', '')
        gizli.v = true
        expect(c.onPageChange('home', 'private_send').nav).toBe('none')
        expect(resets()).toBe(1)
    })
    it.each(['privacy-switching', 'privacy-arriving'])('%s sinifi: none + reset', (sinif) => {
        const { c, resets } = kur({ doc: sahteDoc({ sinif: [sinif] }) })
        c.onPageChange('home', '')
        expect(c.onPageChange('send', 'home').nav).toBe('none')
        expect(resets()).toBe(1)
    })
    it('mod sayfa degismeden degisti: notePrivacy sonrasi ilk gezinme ileri', () => {
        const { c, gizli, resets } = kur()
        c.onPageChange('home', '')
        const once = resets()
        gizli.v = true
        c.notePrivacy()
        expect(c.onPageChange('send', 'home')).toEqual({ nav: 'fwd', duration: 200 })
        expect(resets()).toBe(once)
    })
    it('kilit gidis ve cikis reset', () => {
        const { c, resets } = kur()
        c.onPageChange('home', '')
        const n0 = resets()
        expect(c.onPageChange('welcome', 'home').nav).toBe('none')
        expect(resets()).toBe(n0 + 1)
        expect(c.stack()).toEqual([])
        expect(c.onPageChange('home', 'welcome').nav).toBe('none')
        expect(resets()).toBe(n0 + 2)
        c.reset()
        expect(resets()).toBe(n0 + 3)
        expect(c.stack()).toEqual([])
    })
    it('reset sonrasi ilk gezinme yigini sifirdan kurar', () => {
        const { c } = kur()
        c.onPageChange('home', '')
        c.onPageChange('token', 'home')
        c.reset()
        expect(c.stack()).toEqual([])
        expect(c.onPageChange('send', 'token').nav).toBe('fwd')
        expect(c.stack()).toEqual(['send'])
    })
    it('hareket azalt: her yonde sure 0', () => {
        const { c, doc } = kur({ doc: sahteDoc({ reduce: true }) })
        expect(c.onPageChange('home', '')).toEqual({ nav: 'none', duration: 0 })
        expect(c.onPageChange('send', 'home')).toEqual({ nav: 'fwd', duration: 0 })
        expect(c.onPageChange('home', 'send')).toEqual({ nav: 'back', duration: 0 })
        expect(doc.attrs['data-nav']).toBe('back')
        const u = kur({ doc: sahteDoc({ reduce: true }), pickNav: () => 'flight' })
        u.c.onPageChange('home', '')
        expect(u.c.onPageChange('token', 'home')).toEqual({ nav: 'flight', duration: 0 })
    })
    it('gizli belge: sure 0', () => {
        const doc = sahteDoc()
        doc.visibilityState = 'hidden'
        const { c } = kur({ doc })
        expect(c.onPageChange('home', '').duration).toBe(0)
    })
    it('pickNav flight', () => {
        const yonler = []
        const { c, doc } = kur({ pickNav: (next, prev, dir) => { yonler.push([next, prev, dir]); return 'flight' } })
        c.onPageChange('home', '')
        expect(c.onPageChange('token', 'home')).toEqual({ nav: 'flight', duration: 140 })
        expect(doc.attrs['data-nav']).toBe('flight')
        expect(yonler.at(-1)).toEqual(['token', 'home', 'fwd'])
    })
    it('doc yok: hata atmaz, sure 0', () => {
        const page = { navIntent: 'back' }
        const c = createPageNavController({ doc: undefined, page })
        expect(c.onPageChange('home', '').duration).toBe(0)
        expect(page.navIntent).toBeNull()
        expect(() => c.reset()).not.toThrow()
    })
    it('stack() kopya doner', () => {
        const { c } = kur()
        c.onPageChange('home', '')
        c.stack().push('x')
        expect(c.stack()).toEqual(['home'])
    })
    it('NAV_DURATION_MS', () => {
        expect(NAV_DURATION_MS).toEqual({ none: 120, fwd: 200, back: 200, flight: 140 })
        expect(Object.isFrozen(NAV_DURATION_MS)).toBe(true)
    })
    it('kaynak kilidi (K2): store ve chrome import yok, chrome. yok', () => {
        const k = yorumsuz(readFileSync(fileURLToPath(new URL('./pageNav.js', import.meta.url)), 'utf8'))
        expect(k).not.toMatch(/from\s+['"][^'"]*(store|chrome)/)
        expect(k).not.toMatch(/(import|require)\s*\(\s*['"][^'"]*(store|chrome)/)
        expect(k).not.toContain('chrome.')
        expect(k).not.toMatch(/localStorage|sessionStorage|indexedDB/)
    })
})
