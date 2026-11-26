import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../test-utils/kaynakTarama'
import { measureIndicator, indicatorStyle, INDICATOR_BASE_PX } from './useTabIndicator'

const kaynak = yorumsuz(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'useTabIndicator.js'), 'utf8'))

describe('useTabIndicator', () => {
    it('offsetLeft/offsetWidth kullanir (kaydirilmis satirda da icerik koordinati)', () =>
        expect(measureIndicator({ offsetLeft: 300, offsetWidth: 52 })).toEqual({ x: 300, w: 52 }))
    it('dugme yok ya da genislik 0 -> null', () => {
        expect(measureIndicator(null)).toBeNull()
        expect(measureIndicator({ offsetLeft: 4, offsetWidth: 0 })).toBeNull()
    })
    it('taban 48 px', () => expect(INDICATOR_BASE_PX).toBe(48))
    it('stil: animate true -> yalniz transform, olcek tabana (48 px) gore', () => {
        expect(indicatorStyle({ x: 12, w: 48 }, true)).toEqual({ transform: 'translateX(12px) scaleX(1)' })
        expect(indicatorStyle({ x: 0, w: 60 }, true)).toEqual({ transform: 'translateX(0px) scaleX(1.25)' })
    })
    it('stil: yerlesimden gelen olcum gecissiz', () =>
        expect(indicatorStyle({ x: 12, w: 48 }, false)).toEqual({ transform: 'translateX(12px) scaleX(1)', transition: 'none' }))
    it('olcum yoksa gosterge gorunmez', () => expect(indicatorStyle(null, true)).toEqual({ opacity: '0' }))
    it('kaynak: ResizeObserver yalniz ref dolu ve typeof ResizeObserver === function iken kurulur', () => {
        expect(kaynak).toContain("typeof ResizeObserver !== 'function' || !rowRef.value")
        expect(kaynak).not.toMatch(/\bchrome\b|store/)
    })
})
