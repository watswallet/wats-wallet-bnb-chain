// i18n-delta -- mevcut dil dosyalarina YALNIZ eksik anahtarlari ekleyen delta araci (K25).
//
// i18n-chunk.mjs tum dil dosyasini en.json'dan yeniden uretir (split / merge) ve delta modu yoktur: yeni birkac
// anahtar icin 10 dilin ~1500 cevirisini yeniden birlestirmek hem gereksiz hem riskli. Bu arac ayni
// mergeChunks cekirdegini kullanir (eksik / fazla / yinelenen anahtar noktali yolla bildirilir, sonuc en
// sirasindadir) ama yalniz eksik yapraklari ceviri icin disari cikarir ve cevrilmis hallerini geri ekler.
//
//   node scripts/i18n-delta.mjs extract <dizin>        -> <dizin>/delta.en.json
//        10 hedef dilin (en ve tr haric) eksik anahtar kumesi AYNI olmalidir; tr tam olmalidir.
//   node scripts/i18n-delta.mjs apply <kod> <dizin>    -> src/i18n/locales/<kod>.json
//        <dizin>/delta.<kod>.json (extract ciktisiyla ayni yapi, cevrilmis degerler) mevcut dosyaya eklenir;
//        mevcut cevirilere DOKUNULMAZ.
//
// Dil dosyasinin satir sonu korunur (CRLF dosya CRLF, LF dosya LF kalir); girinti 2 bosluk, sonda satir sonu.
// delta.en.json gecici dosyadir ve her zaman LF yazilir.
//
// Yalnizca dogrudan calistirildiginda devreye girer; ice aktarilinca yan etkisi yoktur.
// Cikis kodu: 0 basari, 1 islem hatasi (anahtar uyusmazligi, bozuk dosya, gecersiz dil kodu),
// 2 kullanim hatasi (eksik/bilinmeyen arguman).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { flatten } from '../src/i18n/messageTools.js'
import { SUPPORTED_LANGS } from '../src/i18n/languages.js'
import { mergeChunks } from './i18n-chunk.mjs'

const DEFAULT_EN_PATH = fileURLToPath(new URL('../src/i18n/locales/en.json', import.meta.url))
const DEFAULT_LOCALES_DIR = fileURLToPath(new URL('../src/i18n/locales/', import.meta.url))

// Ceviri hedefi olabilen diller: kaynak (en) ve elle yazilmis mevcut dil (tr) haric katalog.
const TARGET_LANGS = SUPPORTED_LANGS.filter((kod) => kod !== 'en' && kod !== 'tr')

const USAGE = [
  'Kullanim:',
  '  node scripts/i18n-delta.mjs extract <dizin>',
  '  node scripts/i18n-delta.mjs apply <kod> <dizin>',
  `  <kod>: ${TARGET_LANGS.join(', ')}`,
].join('\n')

class UsageError extends Error {
  constructor(neden) {
    super(`${neden}\n${USAGE}`)
    this.name = 'UsageError'
  }
}

const isPlainObject = (deger) => deger !== null && typeof deger === 'object' && !Array.isArray(deger)
const toJsonText = (nesne) => JSON.stringify(nesne, null, 2) + '\n'
const pathsOf = (nesne) => flatten(nesne).map(([yol]) => yol)
const bulletList = (baslik, yollar) => (yollar.length ? [`${baslik} (${yollar.length}):`, ...yollar.map((yol) => `  - ${yol}`)] : [])

const readJson = (dosya) => {
  try {
    return JSON.parse(readFileSync(dosya, 'utf8'))
  } catch (hata) {
    throw new Error(`${dosya} okunamadi: ${hata.message}`)
  }
}

/**
 * `en`'de olup `locale`'de olmayan yapraklar: ic ice, `en` sirasinda. `locale`'de `en`'de olmayan bir anahtar
 * varsa FIRLATIR (fazla anahtar, delta'nin sessizce gecmesine izin verilmez). Girdiler degistirilmez.
 * @param {Record<string, unknown>} en
 * @param {Record<string, unknown>} locale
 * @returns {Record<string, unknown>}
 */
export function extractMissing(en, locale) {
  const enYollari = new Set(pathsOf(en))
  const dilYollari = new Set(pathsOf(locale))
  const fazla = [...dilYollari].filter((yol) => !enYollari.has(yol))
  if (fazla.length) {
    throw new Error(['Dil dosyasi en.json ile uyusmuyor:', ...bulletList('Fazla anahtarlar', fazla)].join('\n'))
  }
  const kur = (kaynak, onek) => {
    const cikti = {}
    for (const [ad, deger] of Object.entries(kaynak)) {
      const yol = onek ? `${onek}.${ad}` : ad
      if (isPlainObject(deger)) {
        const alt = kur(deger, yol)
        if (Object.keys(alt).length) cikti[ad] = alt
      } else if (!dilYollari.has(yol)) {
        cikti[ad] = deger
      }
    }
    return cikti
  }
  return kur(en, '')
}

/**
 * Mevcut dile cevrilmis delta'yi ekler: `mergeChunks(en, [locale, delta])`. Eksik, fazla ya da yinelenen
 * (zaten dilde olan bir anahtari yeniden ceviren) anahtar HEPSI listelenerek FIRLATILIR. Sonuc `en` sirasindadir;
 * mevcut cevirilere dokunulmaz. Girdiler degistirilmez.
 * @param {Record<string, unknown>} en
 * @param {Record<string, unknown>} locale
 * @param {Record<string, unknown>} delta
 * @returns {Record<string, unknown>}
 */
export function applyDelta(en, locale, delta) {
  return mergeChunks(en, [locale, delta])
}

function runExtract(args, { log, localesDir, enPath }) {
  if (args.length !== 1) throw new UsageError('extract: <dizin> bekleniyor')
  const [dizin] = args
  const en = readJson(enPath)

  // tr elle yazilir ve TAM olmalidir: delta yalniz 10 hedef dil icindir.
  const trEksik = pathsOf(extractMissing(en, readJson(join(localesDir, 'tr.json'))))
  if (trEksik.length) {
    throw new Error(['tr.json en.json ile uyusmuyor; once tr ve en dosyalarina anahtarlari ekle:', ...bulletList('tr dosyasinda eksik', trEksik)].join('\n'))
  }

  const kumeler = TARGET_LANGS.map((kod) => {
    const eksik = extractMissing(en, readJson(join(localesDir, `${kod}.json`)))
    return { kod, eksik, yollar: pathsOf(eksik) }
  })
  const [ilk] = kumeler
  const ayrilan = kumeler.filter((k) => k.yollar.join('\n') !== ilk.yollar.join('\n'))
  if (ayrilan.length) {
    const ilkKume = new Set(ilk.yollar)
    throw new Error([
      `Hedef dillerin eksik anahtar kumesi AYNI degil (olcut: ${ilk.kod}, ${ilk.yollar.length} eksik):`,
      ...ayrilan.flatMap((k) => {
        const kendi = new Set(k.yollar)
        return [
          ...bulletList(`${k.kod}: yalniz ${k.kod}'de eksik`, k.yollar.filter((yol) => !ilkKume.has(yol))),
          ...bulletList(`${k.kod}: yalniz ${ilk.kod}'de eksik`, ilk.yollar.filter((yol) => !kendi.has(yol))),
        ]
      }),
    ].join('\n'))
  }

  if (!ilk.yollar.length) {
    log('extract: eksik anahtar yok')
    return
  }
  mkdirSync(dizin, { recursive: true })
  const hedef = join(dizin, 'delta.en.json')
  writeFileSync(hedef, toJsonText(ilk.eksik))
  log(`extract: ${ilk.yollar.length} yaprak -> ${resolve(hedef)}`)
}

function runApply(args, { log, localesDir, enPath }) {
  if (args.length !== 2) throw new UsageError('apply: <kod> <dizin> bekleniyor')
  const [kod, dizin] = args
  if (!TARGET_LANGS.includes(kod)) {
    throw new Error(`Gecersiz dil kodu: ${kod} (gecerli kodlar: ${TARGET_LANGS.join(', ')})`)
  }
  const hedef = join(localesDir, `${kod}.json`)
  const delta = readJson(join(dizin, `delta.${kod}.json`))
  const ham = readFileSync(hedef, 'utf8')
  const birlesik = applyDelta(readJson(enPath), readJson(hedef), delta)
  const metin = toJsonText(birlesik)
  writeFileSync(hedef, ham.includes('\r\n') ? metin.replace(/\n/g, '\r\n') : metin)
  log(`apply: ${flatten(birlesik).length} yaprak (+${flatten(delta).length} yeni) -> ${hedef}`)
}

/**
 * Komut satirini calistirir; hatada Error firlatir (UsageError = arguman hatasi).
 * @param {string[]} argv  `extract <dizin>` ya da `apply <kod> <dizin>`
 * @param {{log?: (satir: string) => void, localesDir?: string, enPath?: string}} [secenekler]
 *   `localesDir` ve `enPath`: dil dosyalarinin ve en.json'un konumu (yalniz testte degisir).
 */
export function runCli(argv, { log = console.log, localesDir = DEFAULT_LOCALES_DIR, enPath = DEFAULT_EN_PATH } = {}) {
  const [komut, ...args] = argv
  if (komut === 'extract') return runExtract(args, { log, localesDir, enPath })
  if (komut === 'apply') return runApply(args, { log, localesDir, enPath })
  throw new UsageError(komut ? `Bilinmeyen komut: ${komut}` : 'Komut verilmedi')
}

// Dogrudan calistirildiginda kosar; ice aktarildiginda (test) hicbir sey yapmaz.
const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    runCli(process.argv.slice(2))
  } catch (hata) {
    console.error(hata instanceof UsageError ? hata.message : `HATA: ${hata.message}`)
    process.exitCode = hata instanceof UsageError ? 2 : 1
  }
}
