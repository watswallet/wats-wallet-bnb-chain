// MV3 SERVICE WORKER GUVENLIGI — yapisal kilit.
//
// Neden davranissal bir test BUNU GOREMEZ (ve neden bu kusur on bir gozden
// gecirmeden gecti):
//
//   `@ton/crypto`nun mnemonic fonksiyonlari `@ton/crypto-primitives`e iner. O
//   paketin package.json'i yalnizca `main` (./dist/node.js) ve `browser`
//   (./dist/browser.js) tasir; `module` ve `exports` YOKTUR. Vite tarayici
//   derlemesini secer ve o derlemedeki hmac_sha512/pbkdf2_sha512/getSecureRandom
//   `window.crypto` OKUR. MV3'te arka plan bir service worker'dir ve orada
//   `window` TANIMSIZDIR -> ReferenceError.
//
//   Ama vitest node ortaminda kosuyor ve node cozumlemesi AYNI paketin `main`
//   alanini secer: testte calisan kod `dist/node.js`tir, window'a hic ugramaz.
//   Yani hatali surum de, dogru surum de davranissal testlerde YESIL gecer.
//   Fark yalnizca PAKETLEME sirasinda ortaya cikar.
//
// Bu yuzden burada kaynak metin degil, GERCEK MODUL GRAFI cozumleniyor:
// `@ton/crypto`nun hangi disa aktarimlarinin tarayici derlemesinde `window`a
// ULASTIGI hesaplaniyor ve src/ icindeki dosyalarin o isimlerden HICBIRINI
// ice aktarmadigi dogrulaniyor. Kutuphane degisirse hesap da degisir; elle
// tutulan bir kara liste degildir.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { tonKeyPairFromTonMnemonic, isTonMnemonic } from './tonMnemonic'
import { tonWalletAddress } from './tonAccount'
import { toFriendlyTon } from './tonAddress'

const abs = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const read = (file) => readFileSync(file, 'utf8')

const CRYPTO_PKG = abs('../../../node_modules/@ton/crypto/package.json')
const CRYPTO_DIST_INDEX = abs('../../../node_modules/@ton/crypto/dist/index.js')
const PRIMITIVES_PKG = abs('../../../node_modules/@ton/crypto-primitives/package.json')

// Kurulum yoksa test ATLANMAZ, PATLAR: sessizce gecen bir kapi, olmayan bir
// korumayi "dogrulanmis" gosterir - bu depoda tam olarak bu hata yasandi.
for (const file of [CRYPTO_PKG, CRYPTO_DIST_INDEX, PRIMITIVES_PKG]) {
    if (!existsSync(file)) throw new Error(`SW guvenlik testi icin gerekli dosya yok: ${file}`)
}

// `window` KULLANIMI: `window.x` ya da `window[...]`. `typeof window` bir
// OZELLIK TESPITIDIR (guvenli) ve sayilmaz.
const WINDOW_RE = /(?<!typeof\s)\bwindow\s*[.[]/

// YORUMLAR SAYILMAZ. Bu depoda tuzagi ANLATAN yorumlar var (tonAccount.js ve
// tonMnemonic.js bas yorumlari `window.crypto.subtle` yaziyor) - onlari kullanim
// saymak, dogru duzeltmeyi belgeleyen yorumu yazmayi cezalandirirdi.
const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const usesWindow = (source) => WINDOW_RE.test(stripComments(source))

const REQUIRE_RE = /require\(\s*["']([^"']+)["']\s*\)/g

const primitivesPkg = JSON.parse(read(PRIMITIVES_PKG))
const PRIMITIVES_ROOT = path.dirname(PRIMITIVES_PKG)

/**
 * Bir `require(...)` belirtecini gercek dosyaya cevirir.
 *
 * @ton/* DISINDAKI paketler (tweetnacl, jssha) YAPRAK sayilir: ikisi de saf JS,
 * WebCrypto'ya ve window'a dokunmaz. Kilitlenen tehlike @ton/crypto-primitives'in
 * TARAYICI derlemesidir ve o grafik tamamen taraniyor.
 */
function resolveRequire(fromFile, spec) {
    if (spec.startsWith('.')) return resolveFile(path.resolve(path.dirname(fromFile), spec))

    if (spec === '@ton/crypto-primitives') {
        // Vite'in sececegi alan: `browser`. Testin butun anlami bu satirda.
        return resolveFile(path.resolve(PRIMITIVES_ROOT, primitivesPkg.browser))
    }
    if (spec.startsWith('@ton/crypto-primitives/')) {
        return resolveFile(path.resolve(PRIMITIVES_ROOT, spec.slice('@ton/crypto-primitives/'.length)))
    }
    return null
}

function resolveFile(base) {
    for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    }
    return null
}

const reachCache = new Map()

/** Dosya, tarayici derlemesinde `window`a ULASIYOR MU (kendisi ya da bagimliliklari). */
function reachesWindow(file, stack = new Set()) {
    if (!file) return false
    if (reachCache.has(file)) return reachCache.get(file)
    if (stack.has(file)) return false // dongu: bu daldan katki yok

    stack.add(file)
    const source = read(file)
    let result = usesWindow(source)

    if (!result) {
        for (const match of source.matchAll(REQUIRE_RE)) {
            if (reachesWindow(resolveRequire(file, match[1]), stack)) {
                result = true
                break
            }
        }
    }

    stack.delete(file)
    reachCache.set(file, result)
    return result
}

/** `@ton/crypto` disa aktarim adi -> onu saglayan dist dosyasi. */
function exportSources() {
    const index = read(CRYPTO_DIST_INDEX)
    const alias = {}
    const map = {}

    for (const line of index.split('\n')) {
        const req = line.match(/var\s+(\w+)\s*=\s*require\(["']([^"']+)["']\)/)
        if (req) {
            alias[req[1]] = resolveRequire(CRYPTO_DIST_INDEX, req[2])
            continue
        }
        const name = line.match(/Object\.defineProperty\(exports,\s*["']([^"']+)["']/)
        const from = line.match(/return\s+(\w+)\./)
        if (name && from) map[name[1]] = alias[from[1]] ?? null
    }
    return map
}

const EXPORT_SOURCES = exportSources()
const UNSAFE_EXPORTS = new Set(
    Object.entries(EXPORT_SOURCES)
        .filter(([, file]) => reachesWindow(file))
        .map(([name]) => name)
)

/** src/ icindeki bir dosyanin '@ton/crypto'dan ice aktardigi isimler. */
function tonCryptoImports(source) {
    const names = []
    for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@ton\/crypto['"]/g)) {
        for (const part of match[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/)[0].trim()
            if (name) names.push(name)
        }
    }
    return names
}

// Service worker'da (background.js) CALISAN ve '@ton/crypto'ya dokunan her dosya.
const SW_FILES = {
    'tonMnemonic.js': read(abs('./tonMnemonic.js')),
    'tonAccount.js': read(abs('./tonAccount.js')),
}

describe('@ton/crypto-primitives cozumlemesi — tehlikenin kendisi', () => {
    // Bu ucu birden dogru oldugu icin Vite tarayici derlemesini secer. Biri
    // degisirse (upstream `exports` eklerse) tehlike de degisir ve asagidaki
    // hesap yeniden gozden gecirilmelidir - test o gun kirilarak haber verir.
    it('paket `browser` alani tasir, `module`/`exports` TASIMAZ', () => {
        expect(primitivesPkg.browser).toBe('./dist/browser.js')
        expect(primitivesPkg.main).toBe('./dist/node.js')
        expect(primitivesPkg.module).toBeUndefined()
        expect(primitivesPkg.exports).toBeUndefined()
    })

    it('tarayici derlemesindeki hmac/pbkdf2 GERCEKTEN window okur', () => {
        const hmac = read(path.resolve(PRIMITIVES_ROOT, 'dist/browser/hmac_sha512.js'))
        const pbkdf2 = read(path.resolve(PRIMITIVES_ROOT, 'dist/browser/pbkdf2_sha512.js'))
        expect(usesWindow(hmac)).toBe(true)
        expect(usesWindow(pbkdf2)).toBe(true)
    })

    it('vite.config.js bu secimi bir mainFields/alias ile DEGISTIRMIYOR', () => {
        // Cozumlemeyi node derlemesine ceviren bir ayar olsaydi bu testin
        // dayandigi butun varsayim cokerdi. Yoklugu acikca kilitleniyor.
        const config = read(abs('../../../vite.config.js'))
        expect(config).not.toMatch(/mainFields/)
        expect(config).not.toMatch(/@ton\/crypto-primitives/)
    })
})

describe('window a ULASAN disa aktarimlar dogru hesaplaniyor', () => {
    // Cozumleyici bos bir kume dondurseydi asagidaki asil kapi HER ZAMAN gecerdi
    // - yani olmayan bir korumayi dogrulamis olurduk. Iki yonlu sabitleniyor.
    it('mnemonic fonksiyonlari TEHLIKELI sayilir', () => {
        expect(UNSAFE_EXPORTS.has('mnemonicValidate')).toBe(true)
        expect(UNSAFE_EXPORTS.has('mnemonicToPrivateKey')).toBe(true)
        expect(UNSAFE_EXPORTS.has('hmac_sha512')).toBe(true)
        expect(UNSAFE_EXPORTS.has('pbkdf2_sha512')).toBe(true)
        expect(UNSAFE_EXPORTS.has('deriveEd25519Path')).toBe(true)
    })

    it('saf (tweetnacl/veri) disa aktarimlar TEHLIKELI SAYILMAZ', () => {
        expect(UNSAFE_EXPORTS.has('keyPairFromSeed')).toBe(false)
        expect(UNSAFE_EXPORTS.has('mnemonicWordList')).toBe(false)
        expect(UNSAFE_EXPORTS.has('sign')).toBe(false)
    })
})

describe('service worker yolundaki dosyalar window a bagimli degil', () => {
    for (const [name, source] of Object.entries(SW_FILES)) {
        it(`${name} window a ULASAN hicbir @ton/crypto disa aktarimini ice aktarmaz`, () => {
            const imported = tonCryptoImports(source)
            const unsafe = imported.filter((n) => UNSAFE_EXPORTS.has(n))
            expect(unsafe).toEqual([])
        })

        it(`${name} @ton/crypto-primitives e DOGRUDAN dokunmaz`, () => {
            expect(source).not.toMatch(/from\s*['"]@ton\/crypto-primitives/)
        })

        it(`${name} kendisi window kullanmaz`, () => {
            expect(usesWindow(source)).toBe(false)
        })
    }

    // tonMnemonic.js'in TON semasini KENDI hesapladiginin kaniti: iki ilkel de
    // ciplak crypto.subtle uzerinden geciyor. Bu iddia silinirse dosya sessizce
    // kutuphane fonksiyonuna geri donebilir ve yukaridaki kapi (import YOK) yine
    // gecerdi - cunku o zaman import da olmazdi, cagri da olmazdi.
    it('tonMnemonic.js iki ilkeli de ciplak crypto.subtle ile kurar', () => {
        const source = SW_FILES['tonMnemonic.js']
        expect(source).toMatch(/crypto\.subtle\.importKey\(\s*'raw'[\s\S]*?HMAC/)
        expect(source).toMatch(/crypto\.subtle\.deriveBits\(/)
        expect(source).toMatch(/name:\s*'PBKDF2',\s*hash:\s*'SHA-512'/)
    })
})

describe('turetme `window` OLMAYAN bir ortamda ucdan uca calisir', () => {
    // vitest node ortaminda kosuyor: `window` GLOBAL OLARAK YOKTUR - MV3 service
    // worker'daki durumun aynisi. Asagidaki cagrilar tamamlaniyorsa o yolda
    // hicbir `window` erisimi yok demektir (bare `window.x` ReferenceError atardi).
    //
    // TEK BASINA YETMEZ ve yetmedigini bilerek yaziyoruz: eski surumde de bu blok
    // GECERDI, cunku node cozumlemesi kutuphanenin `main` (dist/node.js)
    // derlemesini seciyordu - yani calisan kod uretimdekinden BASKAYDI. Anlamli
    // olmasini saglayan sey yukaridaki grafik kilidi: kod artik o kutuphane
    // daliyla hic ilgilenmiyor, sema bu dosyanin kendisinde.
    const DUAL = 'logic service expect film garbage twist fabric shop grow patient toe furnace index certain gym occur rabbit caution injury zero language brother minimum water'
    const GOLDEN = 'UQB1-bGBpFuFl8Ho83XCuq1dJUYcMgBu2zSobPATzsSjCm7q'

    it('ortamda window GERCEKTEN yok (testin on kosulu)', () => {
        expect(typeof globalThis.window).toBe('undefined')
    })

    it('dogrulama window siz calisir', async () => {
        expect(await isTonMnemonic(DUAL)).toBe(true)
    })

    it('anahtar turetme window siz calisir ve ALTIN VEKTORU uretir', async () => {
        const keyPair = await tonKeyPairFromTonMnemonic(DUAL)
        expect(toFriendlyTon(tonWalletAddress(keyPair.publicKey))).toBe(GOLDEN)
    })
})
