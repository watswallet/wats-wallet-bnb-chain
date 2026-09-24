import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createUiRegistry, isUiPortName, UI_PORT_PREFIX } from './uiRegistry'

// Sahte port: gercek chrome.runtime.Port'un kayit defterinin kullandigi
// TEK yuzeyini taklit eder (name + onDisconnect.addListener).
function makePort(name = UI_PORT_PREFIX + 'a') {
    const dcs = []
    return {
        name,
        onDisconnect: { addListener: (fn) => dcs.push(fn) },
        disconnect: () => dcs.forEach((fn) => fn()),
    }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('isUiPortName', () => {
    it('kimlikli arayuz portlarini tanir', () => {
        expect(isUiPortName('wats_ui:abc-123')).toBe(true)
    })

    it('eski popup port adini da tanir (guncelleme sirasinda acik kalan popup)', () => {
        expect(isUiPortName('wats_popup')).toBe(true)
    })

    it('yabanci port adlarini reddeder', () => {
        expect(isUiPortName('cs')).toBe(false)
        expect(isUiPortName('')).toBe(false)
        expect(isUiPortName(undefined)).toBe(false)
    })
})

describe('createUiRegistry', () => {
    it('tek arayuz kapaninca ve bekleme dolunca onEmpty cagrilir', () => {
        const onEmpty = vi.fn()
        const reg = createUiRegistry({ onEmpty, graceMs: 3000 })
        const p = makePort()
        reg.add(p)
        expect(reg.size()).toBe(1)

        p.disconnect()
        expect(onEmpty).not.toHaveBeenCalled()   // bekleme suresi doldu mu?
        vi.advanceTimersByTime(2999)
        expect(onEmpty).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(onEmpty).toHaveBeenCalledTimes(1)
    })

    // COKLU PENCERE: panel N pencerede birden acik olabilir. Birini kapatmak
    // digerindeki acik cuzdani KILITLEMEMELI.
    it('ikiden biri kapaninda onEmpty CAGRILMAZ', () => {
        const onEmpty = vi.fn()
        const reg = createUiRegistry({ onEmpty, graceMs: 3000 })
        const a = makePort(UI_PORT_PREFIX + 'a')
        const b = makePort(UI_PORT_PREFIX + 'b')
        reg.add(a)
        reg.add(b)

        a.disconnect()
        vi.advanceTimersByTime(10000)
        expect(onEmpty).not.toHaveBeenCalled()
        expect(reg.size()).toBe(1)
    })

    // YENIDEN YUKLEME: Chrome paneli pencere kapanisinda ve uzanti
    // guncellemesinde yeniden yukler. Bu bir port kopmasi uretir ama kullanici
    // hala ekranin onundedir.
    it('bekleme icinde yeni port gelirse kilit IPTAL olur', () => {
        const onEmpty = vi.fn()
        const reg = createUiRegistry({ onEmpty, graceMs: 3000 })
        const a = makePort(UI_PORT_PREFIX + 'a')
        reg.add(a)

        a.disconnect()
        vi.advanceTimersByTime(1500)
        expect(reg.pending()).toBe(true)

        reg.add(makePort(UI_PORT_PREFIX + 'b'))
        expect(reg.pending()).toBe(false)

        vi.advanceTimersByTime(10000)
        expect(onEmpty).not.toHaveBeenCalled()
    })

    // `kontrolEt()`in bastaki `ports.size > 0` kontrolu: son OLMAYAN bir kopma
    // hic zamanlayici KURMAMALI. Asagidaki `setTimeout` icindeki son kontrol
    // bunu sonucta yakalasa da, gereksiz bir zamanlayici kurmak kararin 3 saniye
    // boyunca "bekliyor" gorunmesine yol acardi -- pending() bunu olcer.
    it('son olmayan kopma zamanlayici KURMAZ (pending false kalir)', () => {
        const reg = createUiRegistry({ onEmpty: vi.fn(), graceMs: 3000 })
        const a = makePort(UI_PORT_PREFIX + 'a')
        const b = makePort(UI_PORT_PREFIX + 'b')
        reg.add(a)
        reg.add(b)

        a.disconnect()
        expect(reg.pending()).toBe(false)
        expect(reg.size()).toBe(1)
    })

    it('ayni port iki kez eklenirse bir kez sayilir', () => {
        const reg = createUiRegistry({ onEmpty: vi.fn(), graceMs: 3000 })
        const a = makePort()
        reg.add(a)
        reg.add(a)
        expect(reg.size()).toBe(1)
    })

    it('kopan port kumeden dusurulur', () => {
        const reg = createUiRegistry({ onEmpty: vi.fn(), graceMs: 3000 })
        const a = makePort()
        reg.add(a)
        a.disconnect()
        expect(reg.size()).toBe(0)
    })

    // ACILIS KONTROLU. `onDisconnect` yalnizca SW YASIYORSA calisir; SW ~30 sn
    // atalette olurken portlar kopar ve kullanici tam o pencerede arayuzu
    // kapatirsa kopmayi duyacak kimse kalmaz. Kayit defteri her SW dogusunda
    // BOS dogdugu icin acilista bekleme kontrolunu baslatmak bu boslugu kapatir.
    it('bootCheck: hic port gelmezse bekleme sonunda onEmpty cagrilir', () => {
        const onEmpty = vi.fn()
        const reg = createUiRegistry({ onEmpty, graceMs: 3000 })

        reg.bootCheck()
        expect(reg.pending()).toBe(true)

        vi.advanceTimersByTime(2999)
        expect(onEmpty).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(onEmpty).toHaveBeenCalledTimes(1)
    })

    // GERCEKTEN ACIK bir arayuz bekleme icinde yeniden baglanir
    // (utils/popupPort.js ~250 ms): karar DUSER. Iptal yolu `add()`in mevcut
    // `iptalEt()` cagrisidir -- ikinci bir kod yolu yok.
    it('bootCheck: bekleme icinde bir port gelirse onEmpty CAGRILMAZ', () => {
        const onEmpty = vi.fn()
        const reg = createUiRegistry({ onEmpty, graceMs: 3000 })

        reg.bootCheck()
        vi.advanceTimersByTime(1500)
        reg.add(makePort())
        expect(reg.pending()).toBe(false)

        vi.advanceTimersByTime(10000)
        expect(onEmpty).not.toHaveBeenCalled()
    })

    it('bootCheck: kume zaten doluysa zamanlayici KURMAZ', () => {
        const onEmpty = vi.fn()
        const reg = createUiRegistry({ onEmpty, graceMs: 3000 })
        reg.add(makePort())

        reg.bootCheck()
        expect(reg.pending()).toBe(false)
        vi.advanceTimersByTime(10000)
        expect(onEmpty).not.toHaveBeenCalled()
    })

    it('onEmpty firlatirsa kayit defteri bozulmaz', () => {
        const onEmpty = vi.fn(() => { throw new Error('patladi') })
        const reg = createUiRegistry({ onEmpty, graceMs: 10 })
        const a = makePort()
        reg.add(a)
        a.disconnect()
        expect(() => vi.advanceTimersByTime(10)).not.toThrow()
        expect(reg.pending()).toBe(false)
    })
})
