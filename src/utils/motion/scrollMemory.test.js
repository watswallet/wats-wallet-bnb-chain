// KAYMAK G13: kaydirma hafizasi saf hesabi (spec 7.10, K2, Review Focus 1).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { RESTORE_TABS, scrollKey, pickAnchor, captureScroll, shouldRestore, targetScrollTop } from './scrollMemory'

const kaynak = yorumsuz(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'scrollMemory.js'), 'utf8'))

const bellek = (ek = {}) => ({ key: 'acc1|0|all', tab: 'assets', top: 300, anchorKey: 'b', anchorOffset: 10, ...ek })

describe('RESTORE_TABS ve scrollKey', () => {
    it('yalniz Varliklar ve Hisseler geri yuklenir', () => {
        expect([...RESTORE_TABS]).toEqual(['assets', 'stocks'])
    })

    it("anahtar '<hesap>|<0/1>|<kapsam>'", () => {
        expect(scrollKey({ accountKey: 'acc1', privateMode: false, scope: 'all' })).toBe('acc1|0|all')
        expect(scrollKey({ accountKey: 'private-0xabc', privateMode: true, scope: 56 })).toBe('private-0xabc|1|56')
    })

    it('hesap, gizli mod ve kapsam anahtari ayri ayri degistirir', () => {
        const a = scrollKey({ accountKey: 'acc1', privateMode: false, scope: 'all' })
        expect(scrollKey({ accountKey: 'acc2', privateMode: false, scope: 'all' })).not.toBe(a)
        expect(scrollKey({ accountKey: 'acc1', privateMode: true, scope: 'all' })).not.toBe(a)
        expect(scrollKey({ accountKey: 'acc1', privateMode: false, scope: 56 })).not.toBe(a)
    })
})

describe('pickAnchor', () => {
    it('sinirin altindaki (top >= sinir) ilk satir; ofset = top - sinir', () => {
        const satirlar = [{ key: 'a', top: -10 }, { key: 'b', top: 60 }, { key: 'c', top: 120 }]
        expect(pickAnchor(satirlar, 50)).toEqual({ anchorKey: 'b', anchorOffset: 10 })
    })

    it('tam sinirdaki satir capa olur (ofset 0)', () => {
        expect(pickAnchor([{ key: 'a', top: 20 }, { key: 'b', top: 50 }], 50)).toEqual({ anchorKey: 'b', anchorOffset: 0 })
    })

    it('hicbir satir sinirin altinda degilse ya da liste bossa null', () => {
        expect(pickAnchor([{ key: 'a', top: -10 }, { key: 'b', top: 40 }], 50)).toBeNull()
        expect(pickAnchor([], 50)).toBeNull()
        expect(pickAnchor(null, 50)).toBeNull()
    })
})

describe('captureScroll', () => {
    it('anahtar, sekme, scrollTop ve capa', () => {
        const satirlar = [{ key: 'a', top: -10 }, { key: 'b', top: 60 }]
        expect(captureScroll({ key: 'k', tab: 'assets', top: 300, rows: satirlar, boundary: 50 }))
            .toEqual({ key: 'k', tab: 'assets', top: 300, anchorKey: 'b', anchorOffset: 10 })
    })

    it('capa yoksa iki alan null', () => {
        expect(captureScroll({ key: 'k', tab: 'stocks', top: 0, rows: [], boundary: 50 }))
            .toEqual({ key: 'k', tab: 'stocks', top: 0, anchorKey: null, anchorOffset: null })
    })
})

describe('shouldRestore', () => {
    it('bellek yoksa geri yukleme yok', () => {
        expect(shouldRestore(null, { key: 'acc1|0|all', tab: 'assets' })).toBe(false)
    })

    it('anahtar uyusmazligi (hesap, gizli mod, kapsam) -> yok', () => {
        expect(shouldRestore(bellek(), { key: 'acc2|0|all', tab: 'assets' })).toBe(false)
        expect(shouldRestore(bellek(), { key: 'acc1|1|all', tab: 'assets' })).toBe(false)
        expect(shouldRestore(bellek(), { key: 'acc1|0|56', tab: 'assets' })).toBe(false)
    })

    it('sekme uyusmazligi -> yok (disaridan degisen homeTab en ustten baslar)', () => {
        expect(shouldRestore(bellek(), { key: 'acc1|0|all', tab: 'stocks' })).toBe(false)
        expect(shouldRestore(bellek({ tab: 'stocks' }), { key: 'acc1|0|all', tab: 'activity' })).toBe(false)
    })

    it('Aktiviteler ve Gizli islemler sekme eslesse de geri yuklenmez', () => {
        expect(shouldRestore(bellek({ tab: 'activity' }), { key: 'acc1|0|all', tab: 'activity' })).toBe(false)
        expect(shouldRestore(bellek({ tab: 'private' }), { key: 'acc1|0|all', tab: 'private' })).toBe(false)
    })

    it('anahtar ve sekme eslesir, sekme assets ya da stocks -> geri yuklenir', () => {
        expect(shouldRestore(bellek(), { key: 'acc1|0|all', tab: 'assets' })).toBe(true)
        expect(shouldRestore(bellek({ tab: 'stocks' }), { key: 'acc1|0|all', tab: 'stocks' })).toBe(true)
    })
})

describe('targetScrollTop (Review Focus 1)', () => {
    it('capa bulundu: anchorTop - sinir - anchorOffset', () => {
        expect(targetScrollTop(bellek(), { anchorTop: 900, boundary: 50, maxTop: 5000 })).toBe(840)
    })

    it('capa bulunamadi (satir gizlendi/silindi): kayitli top', () => {
        expect(targetScrollTop(bellek({ top: 450 }), { anchorTop: null, boundary: 50, maxTop: 5000 })).toBe(450)
    })

    it('capa yok ve liste kisaldi: top [0, maxTop] icine kirpilir', () => {
        expect(targetScrollTop(bellek({ top: 2000, anchorKey: null, anchorOffset: null }), { anchorTop: null, boundary: 50, maxTop: 700 })).toBe(700)
    })

    it('capa hedefi de [0, maxTop] icine kirpilir; listenin sonundan oteye sicrama yok', () => {
        expect(targetScrollTop(bellek(), { anchorTop: 3000, boundary: 50, maxTop: 700 })).toBe(700)
    })

    it('negatif hedef 0', () => {
        expect(targetScrollTop(bellek(), { anchorTop: 20, boundary: 50, maxTop: 700 })).toBe(0)
        expect(targetScrollTop(bellek({ top: -40 }), { anchorTop: null, boundary: 50, maxTop: 700 })).toBe(0)
    })

    it('maxTop negatifse (icerik kaydiricidan kisa) 0', () => {
        expect(targetScrollTop(bellek({ top: 300 }), { anchorTop: null, boundary: 50, maxTop: -20 })).toBe(0)
    })

    it('sonuc tam sayiya yuvarlanir', () => {
        expect(targetScrollTop(bellek({ anchorOffset: 10.4 }), { anchorTop: 900.2, boundary: 50, maxTop: 5000 })).toBe(840)
    })
})

describe('kaynak kilidi (K2)', () => {
    it('scrollMemory.js store, chrome ve vue import etmez; chrome. gecmez', () => {
        expect(kaynak).not.toMatch(/from\s+['"][^'"]*store[^'"]*['"]/)
        expect(kaynak).not.toMatch(/from\s+['"]vue['"]/)
        expect(kaynak).not.toMatch(/\bchrome\b/)
    })
})
