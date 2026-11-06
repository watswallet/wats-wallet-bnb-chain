import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extractSwitchCases } from './switchCases'

// extractSwitchCases'in saglamlik sayimi (T23 M5): cikarilamayan HER case bicimi sessizce kilidin disinda
// kalmak yerine HATA verir; hata yolu kendi testine sahiptir.
describe('extractSwitchCases', () => {
    it('tirnakli case adlarini kaynak sirasiyla cikarir', () => {
        const kaynak = [
            'switch (type) {',
            "    case 'A_ONE':",
            '    case "B_TWO": {',
            '        break',
            '    }',
            '}',
        ].join('\n')
        expect(extractSwitchCases(kaynak)).toEqual(['A_ONE', 'B_TWO'])
    })

    it('CRLF satir sonlarinda da calisir', () => {
        expect(extractSwitchCases("switch (t) {\r\n    case 'X':\r\n        break\r\n}\r\n")).toEqual(['X'])
    })

    it('yorumdaki case sayilmaz', () => {
        const kaynak = "switch (t) {\n    // case 'GIZLI':\n    /* case 'BASKA': */\n    case 'GERCEK':\n        break\n}"
        expect(extractSwitchCases(kaynak)).toEqual(['GERCEK'])
    })

    it('SABIT adli case (tirnaksiz) HATA verir: adi cikarilamaz, kilidin disinda kalirdi', () => {
        const kaynak = "switch (t) {\n    case 'A':\n    case SOME_CONST:\n        break\n}"
        expect(() => extractSwitchCases(kaynak)).toThrow(/2 case belirteci var ama 1 tanesi/)
    })

    it('sablon dizgeli (backtick) case HATA verir', () => {
        const kaynak = 'switch (t) {\n    case `A_B`:\n        break\n}'
        expect(() => extractSwitchCases(kaynak)).toThrow(/1 case belirteci var ama 0 tanesi/)
    })

    it('tek satirda iki case ya da satir ortasinda case HATA verir', () => {
        expect(() => extractSwitchCases("switch (t) {\n    case 'A': case 'B': break\n}")).toThrow(/extractSwitchCases/)
        expect(() => extractSwitchCases("switch (t) {\n    default: foo(); case 'A':\n        break\n}")).toThrow(/extractSwitchCases/)
        expect(() => extractSwitchCases("switch (t) {\n    case 'A': break; case 'B': break\n}")).toThrow(/extractSwitchCases/)
    })

    it('gercek background.js: tum case adlari cikarilir (hata yok, bos degil)', () => {
        const kaynak = readFileSync(fileURLToPath(new URL('../background.js', import.meta.url)), 'utf8')
        const adlar = extractSwitchCases(kaynak)
        expect(adlar.length).toBeGreaterThan(30)
        expect(adlar).toContain('PRIVATE_ORDER')
    })
})
