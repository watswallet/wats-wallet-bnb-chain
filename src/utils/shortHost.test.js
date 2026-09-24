// Kimlik satirindaki dapp alan adinin kisaltmasi.
//
// NEDEN CSS `truncate` YETMEZ (inceleme bulgusu): o SONDAN kirpar ve bir alan
// adinin ayirt edici parcasi -- kayitli alan adi -- tam da sonda durur. 280px'lik
// satirda "app.marketplace.getgems.io" -> "app.marketplace.get…" olur ve kullanici
// hangi siteye baktigini soyleyemez. Kirpma BASTAN yapilmali.
import { describe, it, expect } from 'vitest'
import { shortHost } from './shortHost'

describe('shortHost', () => {
    it('sigan alan adina DOKUNMAZ', () => {
        expect(shortHost('getgems.io')).toBe('getgems.io')
        expect(shortHost('ston.fi')).toBe('ston.fi')
    })

    // 'www.' yer kaplar, bilgi tasimaz.
    it('www onekini atar', () => {
        expect(shortHost('www.getgems.io')).toBe('getgems.io')
        expect(shortHost('WWW.Getgems.io')).toBe('Getgems.io')
    })

    // ASIL DERT: uzun alan adinda KAYITLI alan adi gorunur kalmali.
    it('uzun alan adini BASTAN kirpar, kayitli alan adi GORUNUR kalir', () => {
        const kisa = shortHost('app.marketplace.getgems.io', 24)
        expect(kisa).toContain('getgems.io')
        expect(kisa.startsWith('…')).toBe(true)
        expect(kisa).not.toBe('app.marketplace.getgems.io')
    })

    // Sigdigi kadar etiket eklenir: bilgi bosuna atilmaz.
    it('sigan ara etiketleri KORUR', () => {
        expect(shortHost('a.b.getgems.io', 24)).toBe('a.b.getgems.io')
    })

    it('sigmayan ara etiketleri ATAR', () => {
        const kisa = shortHost('cok-uzun-bir-alt-alan.baska-bir-alt-alan.getgems.io', 24)
        expect(kisa.replace('…', '').length).toBeLessThanOrEqual(24)
        expect(kisa).toContain('getgems.io')
    })

    // Son IKI etiket max'i assa bile korunur: alternatifi, alan adini taninmaz
    // bir harf dizisine indirmek olurdu ki bu onu hic basmamaktan farksiz.
    it('son iki etiket max i assa bile KORUNUR, harf harf kesilmez', () => {
        const kisa = shortHost('cokcokcokuzunalanadi.example', 10)
        expect(kisa).toContain('cokcokcokuzunalanadi.example')
    })

    it('bos/gecersiz girdide BOS DIZE doner', () => {
        expect(shortHost('')).toBe('')
        expect(shortHost(null)).toBe('')
        expect(shortHost(undefined)).toBe('')
        expect(shortHost(42)).toBe('')
    })
})
