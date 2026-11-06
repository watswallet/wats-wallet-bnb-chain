// Gizli mod paketli token logolari MANIFEST URETICISI (public/tokens/<chainId>/<kucuk harf adres>.png -> src/utils/privacy/localTokenLogos.js).
// Kullanim: npm run gen:token-logos            (manifest blogunu yeniden yazar)
//           npm run gen:token-logos -- --check (yazmaz; dosya ile manifest ayrisirsa cikis kodu 1)
// Logo EKLEMEK = dosyayi public/tokens/<chainId>/<adres>.png olarak koymak (64x64 PNG, palet, <= 12 KB; kaynak URL ve sha256 SOURCES.txt'e) ve bunu calistirmak.
// Manifest bloku elle duzenlenmez; localTokenLogos.test.js klasoru ile manifesti birbirine ve BUTCEYE kilitler (dosya sayisi / toplam bayt tavani).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const TOKENS = fileURLToPath(new URL('../public/tokens', import.meta.url))
const MANIFEST = fileURLToPath(new URL('../src/utils/privacy/localTokenLogos.js', import.meta.url))
const BEGIN = '// <generated:begin>'
const END = '// <generated:end>'

const keys = []
for (const dir of readdirSync(TOKENS, { withFileTypes: true })) {
    if (!dir.isDirectory() || !/^[1-9]\d*$/.test(dir.name)) continue
    for (const f of readdirSync(join(TOKENS, dir.name))) {
        const m = /^(0x[0-9a-f]{40})\.png$/.exec(f)
        if (!m) throw new Error(`public/tokens/${dir.name}/${f}: dosya adi "<kucuk harf adres>.png" olmali`)
        keys.push([Number(dir.name), m[1]])
    }
}
keys.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1))
// Sira: once zincir (sayisal), sonra adres. Elle okumada ayni zincirin satirlari bir arada durur.
const src = readFileSync(MANIFEST, 'utf8')
const eol = src.includes('\r\n') ? '\r\n' : '\n'
const a = src.indexOf(BEGIN)
const b = src.indexOf(END)
if (a < 0 || b < a) throw new Error('localTokenLogos.js: uretilen blok isaretleri bulunamadi')
const block = keys.map(([id, addr]) => `    '${id}:${addr}',`).join(eol)
const next = src.slice(0, a + BEGIN.length) + eol + block + eol + '    ' + src.slice(b)
if (process.argv.includes('--check')) {
    if (next !== src) { console.error('localTokenLogos.js manifesti public/tokens ile ayrisiyor: npm run gen:token-logos'); process.exit(1) }
    console.log(`manifest guncel (${keys.length} logo)`)
} else {
    writeFileSync(MANIFEST, next)
    console.log(`${keys.length} logo yazildi`)
}
