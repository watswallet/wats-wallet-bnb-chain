// Wallet Standard metadata blogunu SAYFA BETIGINE yazar.
//
// Calistirma:  cd client && npm run gen:wallet-standard   (build oncesi otomatik)
// Kaynak:      src/utils/solana/walletStandardFeatures.js
// Hedef:       src/solanaInjected.js -- isaretciler arasi blok
//
// NEDEN VAR: src/solanaInjected.js HICBIR SEY IMPORT EDEMEZ. @crxjs/vite-plugin v2,
// import tasiyan MAIN-world betiklerini `await import(...)` yapan ASENKRON bir
// yukleyiciye sariyor (dist/manifest.json'da tonInjected.js boyle cikiyor). Sarilmis
// betikte window.solana document_start'ta SENKRON var olmaz -- yani senkron yoklayan
// dapp kuyrugu cuzdani hic goremez. Bu kusur vitest'te GORUNMEZ, yalnizca gercek
// tarayicida cikar.
//
// Sonuc: metadata sayfa betigine import edilmez, derleme oncesi BURADAN yazilir.
// Bu, tonConnectDevice.js'in olum-sonrasi incelemesindeki "ikinci kopya" desenini
// bilerek yeniden yaratir; tek koruma src/solanaProviderConformance.test.js'tir ve
// ayrismada kirmizi yanar. Elle duzenlemeyin.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { walletStandardMetadata } from '../src/utils/solana/walletStandardFeatures.js'

export const MARKER = '// GENERATED — do not edit'
export const TARGET = fileURLToPath(new URL('../src/solanaInjected.js', import.meta.url))

// Dosya hic yoksa YALNIZCA iskelet kurulur; sayfa betiginin gercek govdesi elle
// yazilir ve bu betik ona bir daha dokunmaz.
const SEED = [
    '// Solana sayfa betigi -- HICBIR SEY IMPORT ETMEZ (bkz. tasarim belgesi 4.1).',
    '// Asagidaki blok CODEGEN ile yazilir: scripts/gen-wallet-standard-metadata.mjs',
    '',
    MARKER,
    MARKER,
    '',
].join('\n')

/**
 * Bloku BASTAN SONA uretir -- iki isaretci DAHIL. Test bu ciktiyi dosyadan
 * cikarilan blokla bayt-birebir karsilastirir, o yuzden bicimlendirme burada
 * tek bir yerde tanimlidir.
 */
export function renderMetadataBlock(metadata = walletStandardMetadata()) {
    return [
        MARKER,
        '// Kaynak: src/utils/solana/walletStandardFeatures.js',
        '// Yeniden uretmek icin: cd client && npm run gen:wallet-standard',
        `const WALLET_STANDARD_METADATA = ${JSON.stringify(metadata, null, 4)}`,
        MARKER,
    ].join('\n')
}

export function extractBlock(source) {
    const bas = source.indexOf(MARKER)
    const son = source.lastIndexOf(MARKER)
    if (bas === -1 || son === bas) throw new Error('SOLANA_INJECTED_MARKERS_MISSING')
    return source.slice(bas, son + MARKER.length)
}

/**
 * Isaretciler YOKSA firlatir, dosyayi bastan YAZMAZ: sessiz bir yeniden yazim,
 * elle yazilmis butun sayfa-kopru kodunu silerdi ve bunu ancak tarayicida fark
 * ederdik.
 */
export function applyBlock(source, block) {
    const bas = source.indexOf(MARKER)
    const son = source.lastIndexOf(MARKER)
    if (bas === -1 || son === bas) throw new Error('SOLANA_INJECTED_MARKERS_MISSING')
    return source.slice(0, bas) + block + source.slice(son + MARKER.length)
}

export function writeMetadataBlock() {
    const source = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : SEED
    const next = applyBlock(source, renderMetadataBlock())
    // Degismediyse YAZMA: her build'de dosyaya dokunmak sahte bir diff ve gereksiz
    // bir HMR turu uretir.
    if (existsSync(TARGET) && readFileSync(TARGET, 'utf8') === next) return false
    writeFileSync(TARGET, next, 'utf8')
    return true
}

// Dogrudan `node scripts/gen-wallet-standard-metadata.mjs` ile calistirildiginda
// yazar; test import ettiginde YAZMAZ (test yazimi kendisi tetikler).
// Elle `file://` + yol birlestirmek Windows'ta (surucu harfi, ters bolu) ve
// bosluklu yollarda kirilir; pathToFileURL tam da bunun icin var.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    const yazildi = writeMetadataBlock()
    console.log(`${yazildi ? 'guncellendi' : 'zaten guncel'} -> ${TARGET}`)
}
