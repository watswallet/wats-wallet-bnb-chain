import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createSecretGuard, SECRET_TIMEOUT_MS } from './useSecretScreenGuard'

// Sahte belge/pencere: composable'in kullandigi TEK yuzey.
function makeHost(initialState = 'visible') {
    const handlers = { visibilitychange: [], blur: [] }
    return {
        visibilityState: initialState,
        addEventListener: (t, fn) => { handlers[t]?.push(fn) },
        removeEventListener: (t, fn) => {
            const i = handlers[t]?.indexOf(fn)
            if (i > -1) handlers[t].splice(i, 1)
        },
        fire: (t) => handlers[t]?.forEach((fn) => fn()),
        count: (t) => handlers[t]?.length ?? 0,
    }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('createSecretGuard', () => {
    it('gizlendiginde onHide cagrilir', () => {
        const onHide = vi.fn()
        const host = makeHost()
        const g = createSecretGuard({ onHide, host, blurCounts: false })
        g.install()

        host.visibilityState = 'hidden'
        host.fire('visibilitychange')
        expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('gorunur kalirken visibilitychange onHide cagirmaz', () => {
        const onHide = vi.fn()
        const host = makeHost()
        const g = createSecretGuard({ onHide, host, blurCounts: false })
        g.install()

        host.fire('visibilitychange')   // visibilityState hala 'visible'
        expect(onHide).not.toHaveBeenCalled()
    })

    // PANELDE BLUR SAYILMAZ. Yan panel, kullanici web sayfasina tikladiginda
    // GORUNUR kalir ama blur alir. Blur'a baglamak, kullaniciyi kelimeleri
    // kagida yazarken her tikta geri sarardi -- S3.3'te "Hemen" icin
    // kacindigimiz hatanin aynisi.
    it('blurCounts=false iken blur onHide cagirmaz (panel modu)', () => {
        const onHide = vi.fn()
        const host = makeHost()
        const g = createSecretGuard({ onHide, host, blurCounts: false })
        g.install()

        host.fire('blur')
        expect(onHide).not.toHaveBeenCalled()
    })

    it('blurCounts=true iken blur onHide cagirir (popup / onay penceresi)', () => {
        const onHide = vi.fn()
        const host = makeHost()
        const g = createSecretGuard({ onHide, host, blurCounts: true })
        g.install()

        host.fire('blur')
        expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('60 saniye sonra onHide otomatik cagrilir', () => {
        const onHide = vi.fn()
        const host = makeHost()
        const g = createSecretGuard({ onHide, host, blurCounts: false })
        g.install()

        vi.advanceTimersByTime(SECRET_TIMEOUT_MS - 1)
        expect(onHide).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('teardown dinleyicileri ve sayaci kaldirir', () => {
        const onHide = vi.fn()
        const host = makeHost()
        const g = createSecretGuard({ onHide, host, blurCounts: true })
        g.install()
        expect(host.count('visibilitychange')).toBe(1)
        expect(host.count('blur')).toBe(1)

        g.teardown()
        expect(host.count('visibilitychange')).toBe(0)
        expect(host.count('blur')).toBe(0)

        vi.advanceTimersByTime(SECRET_TIMEOUT_MS * 2)
        host.fire('visibilitychange')
        expect(onHide).not.toHaveBeenCalled()
    })

    it('host yoksa (SSR / node) sessizce hicbir sey yapmaz', () => {
        const onHide = vi.fn()
        const g = createSecretGuard({ onHide, host: null, blurCounts: true })
        expect(() => { g.install(); g.teardown() }).not.toThrow()
        expect(onHide).not.toHaveBeenCalled()
    })
})

// IKI HEDEF, IKI HOST.
//
// `visibilitychange` `document`te, pencere seviyesindeki `blur` ise `window`da
// firlar ve DOM agacinda BUBBLE ETMEZ -- yani `document`e ULASMAZ. Guard'in
// host'u sabit `document` oldugu surece `blurCounts: true` SESSIZCE hicbir sey
// yapmazdi. Bugun zararsiz (hicbir cagiran gecmiyor), ama popup/onay penceresi
// icin acildigi gun sirri gosteren bir ekranda calismayan bir koruma olurdu.
//
// Tek-host cagrilari degismez: `blurHost` verilmezse `host`a duser.
describe('createSecretGuard -- blur ayri bir hostta dinlenir', () => {
    it('blur dinleyicisi blurHost a, visibilitychange host a baglanir', () => {
        const belge = makeHost()
        const pencere = makeHost()
        const g = createSecretGuard({ onHide: vi.fn(), host: belge, blurHost: pencere, blurCounts: true })
        g.install()

        expect(belge.count('visibilitychange')).toBe(1)
        expect(belge.count('blur')).toBe(0)
        expect(pencere.count('blur')).toBe(1)
    })

    it('blurHost taki blur onHide cagirir', () => {
        const onHide = vi.fn()
        const belge = makeHost()
        const pencere = makeHost()
        const g = createSecretGuard({ onHide, host: belge, blurHost: pencere, blurCounts: true })
        g.install()

        pencere.fire('blur')
        expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('teardown blurHost taki dinleyiciyi de kaldirir', () => {
        const belge = makeHost()
        const pencere = makeHost()
        const g = createSecretGuard({ onHide: vi.fn(), host: belge, blurHost: pencere, blurCounts: true })
        g.install()
        g.teardown()

        expect(belge.count('visibilitychange')).toBe(0)
        expect(pencere.count('blur')).toBe(0)
    })

    it('blurHost verilmezse host a duser (mevcut cagrilar degismez)', () => {
        const belge = makeHost()
        const g = createSecretGuard({ onHide: vi.fn(), host: belge, blurCounts: true })
        g.install()
        expect(belge.count('blur')).toBe(1)
    })

    // Vue sarmalayicisi node ortaminda davranissal olarak olculemez
    // (window/document YOK), bu yuzden kaynak kilidi.
    it('useSecretScreenGuard blur icin window, visibility icin document verir', () => {
        const kaynak = readFileSync(fileURLToPath(new URL('./useSecretScreenGuard.js', import.meta.url)), 'utf8')
        expect(kaynak).toMatch(/const host = typeof document === 'undefined' \? null : document/)
        expect(kaynak).toMatch(/const blurHost = typeof window === 'undefined' \? null : window/)
        expect(kaynak).toMatch(/createSecretGuard\(\{ onHide, host, blurHost, blurCounts, timeoutMs \}\)/)
    })
})
