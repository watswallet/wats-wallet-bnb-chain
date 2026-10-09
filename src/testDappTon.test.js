// test-dapp/ TON sekmesinin kaynak kilidi (testDappSolana.test.js ile ayni gerekce:
// sayfa CI'da calismaz, yalnizca bir insan tiklar).
//
// VARSAYILAN ALICI: sifir adres (0:000..) gecerli bir YAKMA adresidir; README'deki
// "1 mesaj -> imzala" satiri parayi kimsenin kontrol etmedigi adrese yollardi.
// Varsayilan bagli hesabin KENDISI olmali (tonconnect-test-sunucu.mjs gibi).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Address } from '@ton/core'

const HTML = readFileSync(new URL('../../test-dapp/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const README = readFileSync(new URL('../../test-dapp/README.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// Sayfadaki GERCEK yardimci calistirilir: kopyasi test edilseydi sayfa ayrisabilirdi.
function sayfaninHamdanUq() {
    const kaynak = HTML.match(/\nfunction hamdanUq\(ham\) \{[\s\S]*?\n\}\n/)
    expect(kaynak, 'hamdanUq tanimi bulunamadi').not.toBeNull()
    return new Function(kaynak[0] + '\nreturn hamdanUq')()
}

describe('test-dapp TON -- varsayilan alici', () => {
    it('alici alani bos baslar, yakma adresi YOK', () => {
        const etiket = HTML.match(/<input[^>]*id="toAddress"[^>]*>/)
        expect(etiket).not.toBeNull()
        expect(etiket[0]).not.toMatch(/value="[^"]+"/)
        expect(HTML).not.toContain('UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ')
        expect(HTML).not.toContain('UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    })

    it.each([
        ['0:' + '11'.repeat(32)],
        ['0:' + 'ab'.repeat(32)],
        ['0:' + 'AB'.repeat(32)],
        ['-1:' + '55'.repeat(32)],
        ['0:779dcc815138d9500e449c5291e7f12738c23d575b5310000f6a253bd607384e'],
        ['  0:' + '22'.repeat(32) + ' '],
    ])('hamdanUq(%s) @ton/core UQ bicimiyle AYNI', (ham) => {
        const beklenen = Address.parse(ham.trim()).toString({ bounceable: false })
        expect(beklenen.startsWith('UQ') || beklenen.startsWith('Uf')).toBe(true)
        expect(sayfaninHamdanUq()(ham)).toBe(beklenen)
    })

    it.each([[''], ['0:123'], ['UQAREREREREREREREREREREREREREREREREREREREREREbvW'], [undefined], ['x:' + '11'.repeat(32)]])(
        'gecersiz girdi %j bos dize doner',
        (ham) => { expect(sayfaninHamdanUq()(ham)).toBe('') },
    )

    // Baglaninca (ve restore'da) alici bagli hesabin UQ adresiyle dolar;
    // kullanicinin yazdigi adres ezilmez.
    it('ConnectEvent alici alanini bagli hesabin KENDI adresiyle doldurur', () => {
        expect(HTML).toMatch(/session = res\.payload\n[\s\S]{0,300}?aliciyiDoldur\(\)/)
        expect(HTML).toContain("const uq = addr ? hamdanUq(addr.address) : ''")
        expect(HTML).toContain('if (uq && (!alan.value || alan.value === otoAlici)) alan.value = uq')
    })

    it('alici bossa mesajli sendTransaction gonderilmez', () => {
        expect(HTML).toMatch(/if \(opts\.n > 0 && !\$\('toAddress'\)\.value\.trim\(\)\) \{\n\s*banner\('warn'/)
    })
})

describe('test-dapp/README TON -- alici', () => {
    it('1 mesaj satiri kendine gonderimi anlatir', () => {
        expect(README).toMatch(/^\| 4 \| 1 mesaj \|[^\n]*kendi[^\n]*\|$/m)
    })

    // Test dosyasi ASCII kalir: Turkce harfler tek-karakter joker ile eslenir.
    it('alicinin degistirilmesi gercek para uyarisi tasir', () => {
        expect(README).toMatch(/Al.c.y. de.i.tirirsen para ger.ekten gider[\s\S]{0,80}testnet/)
    })
})
