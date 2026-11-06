// i18n-chunk -- ceviri bolme/birlestirme araci (Dil destegi, Bolum C).
//
// en.json (~1500 yaprak) bir ceviri ajaninin tek seferde cevirebilecegi kadar kucuk degildir.
// Arac onu ic ice yapiyi koruyan ~150 yaprakli parcalara boler; her parca ayri cevrilir;
// sonra parcalar birlestirilip src/i18n/locales/<kod>.json yazilir.
//
//   node scripts/i18n-chunk.mjs split <dizin> [boyut=150]   -> <dizin>/NN.en.json
//   node scripts/i18n-chunk.mjs merge <kod> <dizin>         -> src/i18n/locales/<kod>.json
//                                                              (<dizin>/NN.<kod>.json dosyalarindan)
//
// Birlestirme en.json ile anahtar kumesini karsilastirir: eksik, fazla ya da yinelenen anahtar
// varsa HEPSINI noktali yolla listeleyen bir hatayla durur ve hicbir dosya yazmaz. Sonuc her
// zaman en.json'un anahtar sirasindadir.
//
// Ceviri dosyalari yalniz LF + 2 bosluk girintiyle yazilir (JSON.stringify(x, null, 2) + '\n').
// Anahtar adlarinda nokta yoktur (messageTools.flatten ayni varsayima dayanir).
//
// Yalnizca dogrudan calistirildiginda devreye girer; ice aktarilinca yan etkisi yoktur.
// Cikis kodu: 0 basari, 1 islem hatasi (anahtar uyusmazligi, bozuk dosya, gecersiz dil kodu),
// 2 kullanim hatasi (eksik/bilinmeyen arguman).

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { flatten } from '../src/i18n/messageTools.js'
import { SUPPORTED_LANGS } from '../src/i18n/languages.js'

const DEFAULT_SIZE = 150
const EN_PATH = fileURLToPath(new URL('../src/i18n/locales/en.json', import.meta.url))
const DEFAULT_LOCALES_DIR = fileURLToPath(new URL('../src/i18n/locales/', import.meta.url))

// Ceviri hedefi olabilen diller: kaynak (en) ve elle yazilmis mevcut dil (tr) haric katalog.
const TARGET_LANGS = SUPPORTED_LANGS.filter((kod) => kod !== 'en' && kod !== 'tr')

const USAGE = [
  'Kullanim:',
  `  node scripts/i18n-chunk.mjs split <dizin> [boyut=${DEFAULT_SIZE}]`,
  '  node scripts/i18n-chunk.mjs merge <kod> <dizin>',
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

/**
 * Ic ice nesneyi, her biri en fazla `size` yaprak tasiyan kismi nesnelere boler. Her parca
 * ic ice yapiyi korur; yaprak sirasi korunur; bir ad alani birden fazla parcaya bolunebilir.
 * @param {Record<string, unknown>} obj
 * @param {number} size  Parca basina en fazla yaprak (pozitif tam sayi).
 * @returns {object[]}
 */
export function splitLeaves(obj, size) {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`size pozitif bir tam sayi olmali: ${String(size)}`)
  }
  const leaves = flatten(obj)
  const chunks = []
  for (let start = 0; start < leaves.length; start += size) {
    const chunk = {}
    for (const [path, value] of leaves.slice(start, start + size)) {
      const names = path.split('.')
      let node = chunk
      for (const name of names.slice(0, -1)) {
        if (!Object.hasOwn(node, name)) node[name] = {}
        node = node[name]
      }
      node[names[names.length - 1]] = value
    }
    chunks.push(chunk)
  }
  return chunks
}

const bulletList = (baslik, yollar) => (yollar.length ? [`${baslik} (${yollar.length}):`, ...yollar.map((yol) => `  - ${yol}`)] : [])

/**
 * Parcalari `en` ile karsilastirip birlestirir. Sonuc `en` anahtar sirasindadir.
 * Eksik, fazla ya da birden cok parcada gecen (yinelenen) anahtar varsa HEPSINI noktali
 * yolla listeleyen bir Error firlatir. Girdiler degistirilmez.
 * @param {Record<string, unknown>} en
 * @param {object[]} chunks
 * @returns {Record<string, unknown>}
 */
export function mergeChunks(en, chunks) {
  const incoming = new Map()
  const duplicated = []
  chunks.forEach((chunk, index) => {
    if (!isPlainObject(chunk)) {
      throw new Error(`parca ${index + 1} bir nesne degil`)
    }
    for (const [path, value] of flatten(chunk)) {
      if (incoming.has(path)) duplicated.push(path)
      else incoming.set(path, value)
    }
  })

  const expected = new Set(flatten(en).map(([path]) => path))
  const missing = [...expected].filter((path) => !incoming.has(path))
  const extra = [...incoming.keys()].filter((path) => !expected.has(path))
  if (missing.length || extra.length || duplicated.length) {
    throw new Error(
      [
        'Ceviri parcalari en.json ile uyusmuyor:',
        ...bulletList('Eksik anahtarlar', missing),
        ...bulletList('Fazla anahtarlar', extra),
        ...bulletList('Yinelenen anahtarlar', [...new Set(duplicated)]),
      ].join('\n'),
    )
  }

  const rebuild = (source, prefix) =>
    Object.fromEntries(
      Object.entries(source).map(([name, value]) => {
        const path = prefix ? `${prefix}.${name}` : name
        return [name, isPlainObject(value) ? rebuild(value, path) : incoming.get(path)]
      }),
    )
  return rebuild(en, '')
}

const readJson = (dosya) => {
  try {
    return JSON.parse(readFileSync(dosya, 'utf8'))
  } catch (hata) {
    throw new Error(`${dosya} okunamadi: ${hata.message}`)
  }
}

function runSplit(args, { log }) {
  if (args.length < 1 || args.length > 2) throw new UsageError('split: <dizin> [boyut] bekleniyor')
  const [dizin, sizeArg = String(DEFAULT_SIZE)] = args
  if (!/^\d+$/.test(sizeArg) || Number(sizeArg) < 1) {
    throw new UsageError(`split: boyut pozitif tam sayi olmali: ${sizeArg}`)
  }
  const en = readJson(EN_PATH)
  const chunks = splitLeaves(en, Number(sizeArg))
  const width = Math.max(2, String(chunks.length).length)
  mkdirSync(dizin, { recursive: true })
  chunks.forEach((chunk, index) => {
    writeFileSync(join(dizin, `${String(index + 1).padStart(width, '0')}.en.json`), toJsonText(chunk))
  })
  log(`split: ${flatten(en).length} yaprak -> ${chunks.length} parca (${resolve(dizin)})`)
}

function runMerge(args, { log, localesDir }) {
  if (args.length !== 2) throw new UsageError('merge: <kod> <dizin> bekleniyor')
  const [kod, dizin] = args
  if (!TARGET_LANGS.includes(kod)) {
    throw new Error(`Gecersiz dil kodu: ${kod} (gecerli kodlar: ${TARGET_LANGS.join(', ')})`)
  }
  let isDirectory = false
  try {
    isDirectory = statSync(dizin).isDirectory()
  } catch {
    // asagidaki hata mesaji yeterli
  }
  if (!isDirectory) throw new Error(`Dizin bulunamadi: ${dizin}`)

  const pattern = new RegExp(`^(\\d+)\\.${kod}\\.json$`)
  const files = readdirSync(dizin)
    .map((ad) => ({ ad, eslesme: pattern.exec(ad) }))
    .filter(({ eslesme }) => eslesme)
    .sort((a, b) => Number(a.eslesme[1]) - Number(b.eslesme[1]))
    .map(({ ad }) => ad)
  if (!files.length) throw new Error(`${dizin} icinde NN.${kod}.json dosyasi yok`)

  const en = readJson(EN_PATH)
  const merged = mergeChunks(en, files.map((ad) => readJson(join(dizin, ad))))
  mkdirSync(localesDir, { recursive: true })
  const hedef = join(localesDir, `${kod}.json`)
  writeFileSync(hedef, toJsonText(merged))
  log(`merge: ${flatten(merged).length} yaprak, ${files.length} parca -> ${hedef}`)
}

/**
 * Komut satirini calistirir; hatada Error firlatir (UsageError = arguman hatasi).
 * @param {string[]} argv  `split <dizin> [boyut]` ya da `merge <kod> <dizin>`
 * @param {{log?: (satir: string) => void, localesDir?: string}} [secenekler]
 *   `localesDir`: merge'in yazdigi dizin (yalniz testte degisir; en.json her zaman gercek konumdan okunur).
 */
export function runCli(argv, { log = console.log, localesDir = DEFAULT_LOCALES_DIR } = {}) {
  const [komut, ...args] = argv
  if (komut === 'split') return runSplit(args, { log })
  if (komut === 'merge') return runMerge(args, { log, localesDir })
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
