import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../../test-utils/kaynakTarama'

// POPUP PAKETI KILIDI (T25 M3): popup ve yan panel, arka plan yurutucusunu (privateOrderExec.js: imzalama,
// yayin) ve SDK istemcisini (silentswap.js: createSilentSwapClient, viem + bitcoin-psbt) paketine CEKMEMELI.
// Magaza derlemesi (bayrak kapali) bunlarla sismemeli ve acik derlemede de popup yalniz okuma sabitlerini
// bilmeli. Arayuzle arka planin ortak sabitleri importsuz privateConstants.js'te yasar.
const SRC = fileURLToPath(new URL('../../', import.meta.url))
const FORBIDDEN = ['utils/privacy/privateOrderExec.js', 'utils/privacy/silentswap.js'].map((p) => resolve(SRC, p))
const ENTRY_DIRS = ['components', 'popup', 'sidepanel', 'onboarding']

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.(vue|js)$/.test(name) && !/\.test\.js$/.test(name)) out.push(p)
    }
    return out
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g

function resolveSpecifier(spec, fromFile) {
    let base
    if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
    else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
    else return null // paket (node_modules): bu kilidin konusu degil
    for (const candidate of [base, `${base}.js`, `${base}.vue`, join(base, 'index.js')]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    }
    return null
}

const importsOf = (file) => {
    const text = yorumsuz(readFileSync(file, 'utf8'))
    return [...text.matchAll(IMPORT_RE)].map((m) => resolveSpecifier(m[1], file)).filter(Boolean)
}

describe('popup paketi arka plan yurutucusunu ve SDK istemcisini cekmez (T25 M3)', () => {
    const entries = ENTRY_DIRS.flatMap((d) => walk(join(SRC, d)))

    it('kaynak taramasi popup/yan panel/onboarding dosyalarini buluyor (bos tarama yesil sayilmaz)', () => {
        expect(entries.length).toBeGreaterThan(20)
        expect(entries.some((f) => f.endsWith('PrivateTransfer.vue'))).toBe(true)
    })

    it('hicbir popup/components dosyasi privateOrderExec.js ya da silentswap.js import etmez', () => {
        const direct = entries.filter((f) => importsOf(f).some((t) => FORBIDDEN.includes(t)))
        expect(direct).toEqual([])
    })

    it('import zincirinde de (gecisli) o iki dosyaya ulasilmaz', () => {
        const seen = new Set()
        const via = new Map()
        const stack = [...entries]
        while (stack.length) {
            const f = stack.pop()
            if (seen.has(f)) continue
            seen.add(f)
            for (const t of importsOf(f)) {
                if (!via.has(t)) via.set(t, f)
                stack.push(t)
            }
        }
        expect(FORBIDDEN.filter((f) => seen.has(f)).map((f) => `${f} <- ${via.get(f)}`)).toEqual([])
    })

    it('ortak sabitler importsuz modulde: privateConstants.js hicbir sey import etmez', () => {
        const source = yorumsuz(readFileSync(join(SRC, 'utils/privacy/privateConstants.js'), 'utf8'))
        expect(source).not.toMatch(/\bimport\b/)
        expect(source).not.toMatch(/\brequire\s*\(/)
    })
})

// SP2 (gizli-mod cok-ag spec 5.1): yeni teslim modulleri popup paketine girer ve SDK'yi ya da yurutucuyu cekmemelidir.
// deliveryChains.js ayrica hicbir sey import etmez (deliveryChains.test.js kilitler); deliveryChainSetting.js yalniz onu import eder.
describe('teslim agi modulleri SDK ve yurutucu icermez (SP2)', () => {
    it.each(['utils/privacy/deliveryChains.js', 'utils/privacy/deliveryChainSetting.js', 'utils/privacy/deliveredShare.js'])('%s @silentswap/*, silentswap.js ve privateOrderExec.js import etmez', (yol) => {
        const dosya = join(SRC, yol)
        expect(yorumsuz(readFileSync(dosya, 'utf8'))).not.toMatch(/@silentswap\//)
        expect(importsOf(dosya).filter((t) => FORBIDDEN.includes(t))).toEqual([])
    })
})

// DILIM D MODULLERI (gizli-mod cok-ag spec 5.1 `privatePopupImports.test.js` satiri): popup paketine girerler. SDK paketleri
// (@silentswap/*), silentswap.js ve privateOrderExec.js'e dogrudan ya da GECISLI olarak ulasamazlar. Yukaridaki kilit
// yalniz components/popup/sidepanel/onboarding giris dizinlerinden yurur; bu modullerin KENDI import zinciri burada taranir.
describe('Dilim D modulleri SDK ve arka plan yurutucusunu cekmez', () => {
    const MODULLER = [
        'utils/privacy/priceGate.js',
        'utils/privacy/privateDefaultTokens.js',
    ].map((p) => resolve(SRC, p))

    function kapanis(baslangic) {
        const gorulen = new Set()
        const yigin = [...baslangic]
        while (yigin.length) {
            const f = yigin.pop()
            if (gorulen.has(f)) continue
            gorulen.add(f)
            yigin.push(...importsOf(f))
        }
        return gorulen
    }

    it('modul dosyalari var (bos tarama yesil sayilmaz)', () => {
        for (const f of MODULLER) expect(existsSync(f), f).toBe(true)
    })

    it('import zincirinde silentswap.js ve privateOrderExec.js YOK', () => {
        const zincir = kapanis(MODULLER)
        expect(FORBIDDEN.filter((f) => zincir.has(f))).toEqual([])
    })

    it('import zincirindeki HICBIR dosya @silentswap/* paketini almaz', () => {
        const zincir = [...kapanis(MODULLER)]
        expect(zincir.length).toBeGreaterThanOrEqual(MODULLER.length)
        const sdkAlanlar = zincir.filter((f) => /@silentswap\//.test(yorumsuz(readFileSync(f, 'utf8'))))
        expect(sdkAlanlar).toEqual([])
    })
})
