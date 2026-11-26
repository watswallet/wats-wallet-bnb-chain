// KAYMAK G6: sekme icerigi yonlu giris (spec 7.3, K9). Saf yon kurali.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TAB_ORDER, TAB_SLIDE_CLEAR_MS, tabSlideClass } from './tabSlide.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'

describe('tabSlide', () => {
    it('sira assets 0, stocks 1, activity 2, private 3 (spec 7.3)', () => {
        expect(TAB_ORDER).toEqual(['assets', 'stocks', 'activity', 'private'])
        expect(Object.isFrozen(TAB_ORDER)).toBe(true)
    })

    it.each([
        ['assets', 'stocks', 'kaymak-sekme-sag'],
        ['assets', 'activity', 'kaymak-sekme-sag'],
        ['activity', 'private', 'kaymak-sekme-sag'],
        ['stocks', 'activity', 'kaymak-sekme-sag'],
        ['activity', 'assets', 'kaymak-sekme-sol'],
        ['private', 'activity', 'kaymak-sekme-sol'],
        ['private', 'assets', 'kaymak-sekme-sol'],
        ['stocks', 'assets', 'kaymak-sekme-sol'],
    ])('%s -> %s = %s', (eski, yeni, beklenen) => {
        expect(tabSlideClass(eski, yeni)).toBe(beklenen)
    })

    it.each([
        ['assets', 'assets'],
        ['private', 'private'],
        ['xyz', 'assets'],
        ['assets', 'xyz'],
        [undefined, 'assets'],
        ['assets', undefined],
        ['', ''],
    ])('ayni ya da bilinmeyen (%s -> %s) bos', (eski, yeni) => {
        expect(tabSlideClass(eski, yeni)).toBe('')
    })

    it('sinif temizleme suresi 0,26 sn siniri icinde', () => {
        expect(TAB_SLIDE_CLEAR_MS).toBeGreaterThan(0)
        expect(TAB_SLIDE_CLEAR_MS).toBeLessThanOrEqual(260)
    })

    it('kaynak kilidi: store, chrome, vue import yok; chrome. gecmez', () => {
        const kaynak = yorumsuz(readFileSync(new URL('./tabSlide.js', import.meta.url), 'utf8'))
        expect(kaynak).not.toMatch(/from\s+['"][^'"]*store[^'"]*['"]/)
        expect(kaynak).not.toMatch(/from\s+['"]vue['"]/)
        expect(kaynak).not.toMatch(/\bchrome\b/)
    })
})
