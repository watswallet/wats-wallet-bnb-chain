import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { atsPurchaseBlocked } from './atsPurchaseGate'

describe('atsPurchaseBlocked (gizleme noktalarinin TEK kosulu, K13)', () => {
    it('gizli mod + bayrak KAPALI -> kapali (bugunku davranis)', () => {
        expect(atsPurchaseBlocked({ active: true }, false)).toBe(true)
    })

    it('gizli mod + bayrak ACIK -> acik (Gizli Hesap kendi alimini yapar)', () => {
        expect(atsPurchaseBlocked({ active: true }, true)).toBe(false)
    })

    it('normal modda bayraktan bagimsiz hic kapanmaz', () => {
        expect(atsPurchaseBlocked({ active: false }, false)).toBe(false)
        expect(atsPurchaseBlocked({ active: false }, true)).toBe(false)
        expect(atsPurchaseBlocked(undefined, false)).toBe(false)
        expect(atsPurchaseBlocked(null, false)).toBe(false)
    })

    it('yalniz tam true acik sayilir: bayrak degeri true degilse gizli mod kapali (fail-closed)', () => {
        for (const deger of [null, 0, false, 'true', 1]) {
            expect(atsPurchaseBlocked({ active: true }, deger), `bayrak=${String(deger)}`).toBe(true)
        }
    })

    it('varsayilan bayrak derleme sabitidir (vitest test.env: acik)', () => {
        expect(atsPurchaseBlocked({ active: true })).toBe(false)
    })

    it('modul yalniz featureFlags i ice aktarir (saf; popup ve test taklitleri guvenle yukler)', () => {
        const kaynak = readFileSync(fileURLToPath(new URL('./atsPurchaseGate.js', import.meta.url)), 'utf8')
        const imports = [...kaynak.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
        expect(imports).toEqual(['./featureFlags'])
    })
})
