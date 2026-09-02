import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
    MARKER,
    TARGET,
    renderMetadataBlock,
    extractBlock,
    applyBlock,
} from '../scripts/gen-wallet-standard-metadata.mjs'
import { walletStandardMetadata } from './utils/solana/walletStandardFeatures.js'

const BETIK = fileURLToPath(new URL('../scripts/gen-wallet-standard-metadata.mjs', import.meta.url))

// KOMIT EDILMIS dosyanin anlik goruntusu -- modul YUKLENIRKEN, herhangi bir it()
// govdesi calismadan ONCE okunur. Asagidaki describe'lardan biri betigi CALISTIRIR
// ve TARGET farkliysa SESSIZCE onarir; bu anlik goruntu o testlerden BAGIMSIZDIR
// (diskten degil, bu degiskenden okur), o yuzden hicbir it() sira varsayimina
// dayanmaz. Onarici testler dosyayi duzeltmeden ONCE komit edilmis halin GERCEKTEN
// dogru oldugunu kilitlemenin tek yolu budur.
const KOMIT_EDILMIS_KAYNAK = readFileSync(TARGET, 'utf8')

// Bu describe betigi HICBIR ZAMAN calistirmaz. Amaci: src/solanaInjected.js icindeki
// gomulu blogu elle bozmak (orn. supportedTransactionVersions icindeki 0'i "0" yapmak,
// bir ozelligi silmek) `npm test` ile YAKALANMALI -- asagidaki betik-calistiran
// testler gibi TARGET'i sessizce onarip YESIL donmemeli. tonConnectDevice.js'teki
// olum-sonrasi inceleme tam bu senaryoyu kaydediyor: elle ayrisan kopyalardan ikisi
// `features: []` ile kaldi ve hicbir test bunu fark etmedi.
describe('commit edilmis src/solanaInjected.js (betik CALISTIRILMAZ)', () => {
    it('komit edilmis blok jeneratorun ciktisiyla BAYT-BIREBIR aynidir', () => {
        let komitEdilmisBlok
        try {
            komitEdilmisBlok = extractBlock(KOMIT_EDILMIS_KAYNAK)
        } catch (err) {
            throw new Error(
                `src/solanaInjected.js isaretcileri okunamadi (${err.message}). ` +
                    'Duzeltmek icin: cd client && npm run gen:wallet-standard'
            )
        }
        const beklenenBlok = renderMetadataBlock(walletStandardMetadata())
        expect(
            komitEdilmisBlok,
            'Komit edilmis src/solanaInjected.js blogu jenerator ciktisindan SAPMIS. ' +
                'Duzeltmek icin: cd client && npm run gen:wallet-standard'
        ).toBe(beklenenBlok)
    })
})

describe('gen-wallet-standard-metadata betigi', () => {
    // Betik dosyayi GERCEKTEN yazmali: sadece fonksiyonlarini test etmek, npm
    // prebuild adiminin calistigini hic dogrulamaz.
    it('duz node ile calisir ve IDEMPOTENT tir', () => {
        execFileSync(process.execPath, [BETIK], { stdio: 'pipe' })
        const birinci = readFileSync(TARGET, 'utf8')
        execFileSync(process.execPath, [BETIK], { stdio: 'pipe' })
        expect(readFileSync(TARGET, 'utf8')).toBe(birinci)
    })

    // Bu, tasarim belgesinin BILINCLI BORCUNU koruyan tek testtir: sayfa betigi
    // hicbir sey import edemedigi icin metadata'nin ikinci bir kopyasi dosyaya
    // gomulur. tonConnectDevice.js'teki olum-sonrasi inceleme, ikinci kopyanin
    // sessizce ayrisip her islemi reddettirdigini kaydediyor.
    it('uretilen blok jeneratorun ciktisiyla BAYT-BIREBIR aynidir', () => {
        execFileSync(process.execPath, [BETIK], { stdio: 'pipe' })
        const source = readFileSync(TARGET, 'utf8')
        expect(extractBlock(source)).toBe(renderMetadataBlock(walletStandardMetadata()))
    })

    it('blok iki isaretci arasindadir ve gomulu literal ayristirilabilir', () => {
        const source = readFileSync(TARGET, 'utf8')
        expect(source.indexOf(MARKER)).toBeGreaterThanOrEqual(0)
        expect(source.lastIndexOf(MARKER)).toBeGreaterThan(source.indexOf(MARKER))

        const blok = extractBlock(source)
        const literal = blok.slice(blok.indexOf('{'), blok.lastIndexOf('}') + 1)
        expect(JSON.parse(literal)).toEqual(walletStandardMetadata())
    })

    // Uretilen metinde 0 TIRNAKSIZ kalmali: '0' ya da 'v0' yazmak adaptoru
    // sessizce legacy-only'ye dusurur ve v0 destegi bildirilmemis olur.
    it('uretilen metinde supportedTransactionVersions icindeki 0 tirnaksizdir', () => {
        const blok = extractBlock(readFileSync(TARGET, 'utf8'))
        expect(blok).toMatch(/"legacy",\s*\n?\s*0/)
        expect(blok).not.toContain('"v0"')
        expect(blok).not.toMatch(/"legacy",\s*\n?\s*"0"/)
    })

    it('isaretciler arasi metin yerine konur, disi KORUNUR', () => {
        const kaynak = `once\n${MARKER}\neski\n${MARKER}\nsonra\n`
        const sonuc = applyBlock(kaynak, renderMetadataBlock(walletStandardMetadata()))
        expect(sonuc.startsWith('once\n')).toBe(true)
        expect(sonuc.endsWith('\nsonra\n')).toBe(true)
        expect(sonuc).not.toContain('eski')
    })

    // Sayfa betiginin govdesini ASLA ezmemeli: isaretciler kayboldugunda sessizce
    // dosyayi bastan yazmak, elle yazilmis butun kopru kodunu silerdi.
    it('isaretci yoksa yazmaz, HATA firlatir', () => {
        expect(() => applyBlock('isaretcisiz dosya\n', 'x'))
            .toThrow(/SOLANA_INJECTED_MARKERS_MISSING/)
    })
})
