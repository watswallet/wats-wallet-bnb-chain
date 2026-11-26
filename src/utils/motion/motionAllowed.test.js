import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { motionAllowed } from './motionAllowed.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'

const belge = (vis, matches, withMM = true) => ({
    visibilityState: vis,
    defaultView: withMM ? { matchMedia: () => ({ matches }) } : {},
})

describe('motionAllowed', () => {
    it('normal -> true', () => expect(motionAllowed(belge('visible', false))).toBe(true))
    it('reduce -> false', () => expect(motionAllowed(belge('visible', true))).toBe(false))
    it('hidden -> false', () => expect(motionAllowed(belge('hidden', false))).toBe(false))
    it('matchMedia yok -> false', () => expect(motionAllowed(belge('visible', false, false))).toBe(false))
    it('doc undefined -> false', () => expect(motionAllowed(undefined, undefined)).toBe(false))
    it('SSR sahtesi (defaultView ve window yok) hata atmaz', () => {
        const doc = { addEventListener() {}, removeEventListener() {} }
        expect(motionAllowed(doc)).toBe(false)
    })
    it('her cagrida yeniden okur', () => {
        let m = false
        const doc = { visibilityState: 'visible', defaultView: { matchMedia: () => ({ matches: m }) } }
        expect(motionAllowed(doc)).toBe(true)
        m = true
        expect(motionAllowed(doc)).toBe(false)
    })
    it('kaynak: store/chrome/vue yok', () => {
        const k = yorumsuz(readFileSync(new URL('./motionAllowed.js', import.meta.url), 'utf8'))
        expect(k).not.toMatch(/from\s+['"][^'"]*(store|chrome|vue)/)
        expect(k).not.toContain('chrome.')
    })
})
