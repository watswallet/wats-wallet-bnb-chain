import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// @solana/web3.js MODUL DEGERLENDIRME aninda Buffer global'ini okur. Eklenti
// sayfalarinda ve MV3 service worker'inda boyle bir global YOKTUR: ilk import
// ReferenceError atar ve cuzdan HER agda (EVM dahil) bos acilir.
//
// vitest `environment: 'node'` ile calisiyor ve orada Buffer gercek bir global,
// yani davranis testi bu hatayi YAKALAYAMAZ. Bu yuzden kaynak uzerinden kilitlenir.
//
// TARAMA, ELLE LISTE DEGIL. Bu dosya eskiden sabit bir uc adlik dizi
// (['address.js','derive.js','buildTransferPlan.js']) uzerinde donuyordu ve o
// liste OLCULDUGUNDE ZATEN EKSIKTI: balances.js ve send.js de @solana iceri
// aliyor ama kilitli DEGILDI. Elle tutulan bir liste, kurali yeni dosyalarda
// hic uygulamaz -- ve unutulacagi kesin olan an tam olarak yeni bir dosyanin
// eklendigi andir. Artik `client/src` altindaki HER .js/.vue taraniyor.
const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..', '..')

// .ts/.mjs de taraniyor: utils/sdk/*.ts derleme hattina paketleniyor (bugun
// @solana import eden bir .ts YOK, bu yuzden tarama sessizce yesil kalir --
// ama dosya UZANTISI degil PAKETLENME kural sinirini cizer, ve bir sonraki
// .ts/.mjs dosyasi kurali sessizce atlamamali).
function walk(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full, out)
        else if (/\.(js|vue|ts|mjs)$/.test(entry.name)) out.push(full)
    }
    return out
}

const ALL_FILES = walk(SRC)

// TEST DOSYALARI KAPSAM DISI ve bu bir bosluk DEGIL, kuralin kendisidir:
// kural, eklentinin CALISMA ANINDAKI modul degerlendirmesini korur (popup
// giris parcasi + MV3 service worker). Bir .test.js dosyasi eklentiye HIC
// paketlenmez; vitest'in node ortaminda ise Buffer zaten gercek bir global.
// (Olculdu: bugun kurali "ihlal eden" dort dosyanin DORDU de .test.js.)
const SOURCE_FILES = ALL_FILES.filter((f) => !f.endsWith('.test.js'))

// Cift tirnakli bir import (`from "@solana/web3.js"`) tek tirnakli bir regex'ten
// KACARDI ve kural o dosyada sessizce uygulanmazdi -- iki tirnak da kabul edilir.
//
// SATIR BASI `import` sarti (`^\s*import`, `m` bayragiyla): YORUM TUZAGI --
// eskiden ham metin eslestirici "from '@solana/" iceren HER satiri importer
// sayardi, bir ACIKLAMA yorumundaki ayni dizeyi (orn. "eskiden `import x from
// '@solana/web3.js'` seklindeydi") de YANLIS POZITIF olarak isaretlerdi.
const SOLANA_IMPORT_RE = /^\s*import[^;]*from ['"]@solana\//m
const SOLANA_IMPORTERS = SOURCE_FILES.filter((f) => SOLANA_IMPORT_RE.test(readFileSync(f, 'utf8')))

describe('bufferGlobal', () => {
    it('globalThis.Buffer tanimli hale gelir', async () => {
        await import('./bufferGlobal.js')
        expect(typeof globalThis.Buffer).toBe('function')
    })

    // EMNIYET KEMERI: tarama kirilirsa (yol degisir, readdirSync sessizce bos
    // doner, regex bozulur) dongu SIFIR dosyayla "gecer" ve kural SESSIZCE
    // ortadan kalkar -- eski elle listenin yaptigi hatanin ta kendisi.
    it('taramanin KENDISI kirilmamis', () => {
        expect(ALL_FILES.length).toBeGreaterThan(300)
        // TABAN OLCULDU: bu spec'ten ONCE `client/src` altinda `@solana/` iceri
        // alan BES kaynak dosya var -- asagidaki listedekiler (address.js,
        // balances.js, buildTransferPlan.js, derive.js, send.js);
        // background.js `@solana/`yi yalnizca YORUMDA aniyor, importer SAYILMAZ.
        // Taban 6 yazilsaydi, yeni dosyalarin biri eksik indiginde emniyet
        // kemeri patlar ve isci saglam bir tarayiciyi ayiklamaya yollanirdi.
        expect(SOLANA_IMPORTERS.length).toBeGreaterThanOrEqual(5)

        // Bilinen bes kaynak dosyanin taramada GORUNDUGU ayrica dogrulanir:
        // boylece regex'in kendisi de dolayli olarak sinanir.
        const bulunan = SOLANA_IMPORTERS.map((f) => relative(SRC, f).replace(/\\/g, '/'))
        for (const bilinen of [
            'utils/solana/address.js',
            'utils/solana/balances.js',
            'utils/solana/buildTransferPlan.js',
            'utils/solana/derive.js',
            'utils/solana/send.js',
        ]) {
            expect(bulunan, bilinen).toContain(bilinen)
        }
    })

    // SS4.1 NEGATIF KILIDI: solanaInjected.js hicbir sey import etmez (sayfa
    // baglamina enjekte edilen izole dunya betigi). Tarama onu SOLANA_IMPORTERS
    // icine sokarsa ya dosya bir seyi kirmis ya da tarama regex'i yanlis
    // pozitif uretiyordur -- ikisi de sessizce gecmemeli.
    it('SOLANA_IMPORTERS listesinde solanaInjected.js YOK', () => {
        // Negatif kilit taban KONTROLU: solanaInjected.js dosyasi TASINIR/
        // yeniden ADLANDIRILIRSA `walk()` onu artik hic BULMAZ ve asagidaki
        // not.toContain iddiasi SESSIZCE (ve anlamsizca) gecmeye devam eder --
        // once dosyanin SOURCE_FILES icinde VAR OLDUGU dogrulanir.
        expect(SOURCE_FILES.some((f) => f.endsWith('solanaInjected.js'))).toBe(true)
        const bulunan = SOLANA_IMPORTERS.map((f) => relative(SRC, f).replace(/\\/g, '/'))
        expect(bulunan).not.toContain('solanaInjected.js')
    })

    // YORUM TUZAGI regresyonu: satir basi `import` sarti eklenmeden once ham
    // metin eslestirici bir ACIKLAMA yorumundaki "from '@solana/" dizesini de
    // importer sayardi. Gercek bir dosya diskte olusturmadan, PRODUKSIYONDA
    // kullanilan AYNI regex nesnesine (SOLANA_IMPORT_RE) karsi bir prob
    // icerigi calistirilir.
    it('yorum SATIRINDAKI bir @solana import u IHLAL SAYILMAZ (satir basi kosulu)', () => {
        const prob = "// import x from '@solana/web3.js'\nexport const x = 1\n"
        expect(SOLANA_IMPORT_RE.test(prob)).toBe(false)
    })

    it('@solana iceri alan HER kaynak dosyanin ILK import u bufferGlobal', () => {
        const ihlaller = []
        for (const file of SOLANA_IMPORTERS) {
            const src = readFileSync(file, 'utf8')
            const firstImport = src.match(/^import .*$/m)?.[0] ?? '(hic import yok)'
            if (!/bufferGlobal/.test(firstImport)) {
                ihlaller.push(`${relative(SRC, file).replace(/\\/g, '/')} -> ${firstImport}`)
            }
        }
        expect(ihlaller).toEqual([])
    })
})
