// Chrome `_locales/<klasor>/messages.json` yapi ve uzunluk denetimi (mağaza metinleri).
//
// Chrome Web Store sinirlari: extDescription (manifest `description`) <= 132, extName <= 45,
// extShortName <= 12 karakter. Sinir asilirsa mağaza yuklemesi reddedilir; bu yuzden her
// `_locales` klasoru ayni kurala tabidir (test gevsetilmez, metin kisaltilir).
//
// Describe adi `_locales/%s` DEGISMEZ: ceviri gorevleri `-t "_locales/<klasor>"` ile suzer.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CHROME_LOCALE_DIR } from './languages'

const here = dirname(fileURLToPath(import.meta.url))
const LOCALES_DIR = join(here, '..', '..', '_locales')

const klasorler = readdirSync(LOCALES_DIR).filter((ad) => statSync(join(LOCALES_DIR, ad)).isDirectory())

const read = (klasor) => JSON.parse(readFileSync(join(LOCALES_DIR, klasor, 'messages.json'), 'utf8'))

describe('_locales klasorleri', () => {
    it('en az en ve tr var', () => {
        expect(klasorler).toEqual(expect.arrayContaining(['en', 'tr']))
    })
})

describe.each(klasorler)('_locales/%s', (klasor) => {
    const messages = read(klasor)

    it('klasor adi desteklenen bir Chrome yerel ayar klasorudur', () => {
        expect(Object.values(CHROME_LOCALE_DIR)).toContain(klasor)
    })

    it.each(['extName', 'extShortName', 'extDescription'])('%s var ve bos degil', (anahtar) => {
        expect(messages[anahtar]).toBeTruthy()
        expect(typeof messages[anahtar].message).toBe('string')
        expect(messages[anahtar].message.trim()).not.toBe('')
    })

    it("marka adlari cevrilmez (extName 'WATS Wallet', extShortName 'WATS')", () => {
        expect(messages.extName.message).toBe('WATS Wallet')
        expect(messages.extShortName.message).toBe('WATS')
    })

    it('extDescription en fazla 132 karakter (Chrome Web Store siniri)', () => {
        const uzunluk = [...messages.extDescription.message].length
        expect(uzunluk, `extDescription ${uzunluk} karakter`).toBeLessThanOrEqual(132)
    })

    it('extName en fazla 45, extShortName en fazla 12 karakter', () => {
        expect([...messages.extName.message].length).toBeLessThanOrEqual(45)
        expect([...messages.extShortName.message].length).toBeLessThanOrEqual(12)
    })
})
