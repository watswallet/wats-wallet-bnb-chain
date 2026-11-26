// ATS komisyonu icin ROUTER MANIFESTOSU uretir (backend'e teslim edilir).
//
// Calistirma:  cd client && npm run routers:manifest
// Cikti:       docs/ats-komisyon-router-listesi.json
//
// NEDEN VAR: bir op'un "swap" olup olmadigina — dolayisiyla komisyon uygulanip
// uygulanmayacagina — BACKEND kendi router listesinden karar veriyor (belge "Swap ve
// Bridge Komisyonu"). Istemci bu soruyu yanitlayamaz; `/quote` kosulsuz `callData` ile
// cagrilir. Listede olmayan bir router'dan gecen swap sradan bir op sayilir ve komisyon
// SESSIZCE tahsil edilmez — hata da vermez, yani ancak gelir raporunda fark edilir.
//
// Manifesto ELLE YAZILMAZ: kaynak CHAIN_CONFIG + LCX_ROUTERS'tir ve `routerManifest.test.js`
// ayrismada kirmizi yanar. Yeni bir DEX ekleyen kisi bu betigi calistirmadan testi gecemez.
//
// LCX (Liberty DEX) takasi CHAIN_CONFIG DEX'lerinden gecmez, kendi router'ina gider; o router
// burada olmazsa LCX takaslari komisyonsuz kalir (canli bulgu 2026-11-20). Her LCX aginda
// zincirin DEX listesinin SONUNA bir satir eklenir: { dex: 'LCX', version: 'swapSplit', router,
// factory: null }.
//
// swapChains.js ve lcx/routers.js HICBIR SEY IMPORT ETMEZ; bu betigin duz Node ile
// calisabilmesinin sebebi odur (Node ESM attribute'suz JSON import'unu reddeder). Oradaki
// notlari bozmayin.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CHAIN_CONFIG } from '../src/utils/swapChains.js'
import { LCX_ROUTERS } from '../src/utils/lcx/routers.js'
import chains from '../src/data/supported_chains.json' with { type: 'json' }

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '..', '..', 'docs', 'ats-komisyon-router-listesi.json')

const nameOf = (chainId) =>
  chains.find((c) => Number(c.chainId) === Number(chainId))?.name || String(chainId)

// Eslesme (chainId, adres) CIFTI uzerinden yapilmali, yalniz adres uzerinden DEGIL:
// ayni router adresi birden cok zincirde bulunuyor (Uniswap V3 0xE592…1564 dort agda,
// PancakeSwap V3 0x1b81…eB14 ikisinde, SushiSwap V2 0x1b02…7506 ucunde). Duz bir adres
// kumesi, o adresin bulunmadigi zincirlerde de eslesir.
export function buildManifest(config = CHAIN_CONFIG, lcxRouters = LCX_ROUTERS) {
  const lcxChains = Object.keys(lcxRouters)
  const missing = lcxChains.filter((id) => !config[id])
  // LCX agi CHAIN_CONFIG'te yoksa manifestoya sessizce girmezdi: oradaki takaslar komisyonsuz kalirdi.
  if (missing.length > 0) throw new Error(`LCX agi CHAIN_CONFIG'te yok: ${missing.join(', ')}`)
  const out = {}
  for (const [chainId, cfg] of Object.entries(config)) {
    const routers = cfg.dexes.map((d) => ({
      dex: d.NAME,
      version: d.VERSION,
      router: d.ROUTER_ADDRESS,
      factory: d.FACTORY_ADDRESS,
    }))
    if (lcxRouters[chainId]) {
      routers.push({ dex: 'LCX', version: 'swapSplit', router: lcxRouters[chainId], factory: null })
    }
    out[chainId] = { name: nameOf(chainId), routers }
  }
  return out
}

const zincirler = buildManifest()
const manifest = {
  aciklama:
    'Cuzdanin swap akisinda cagirdigi TUM router adresleri. Backend bir op u swap olarak ' +
    'siniflandirip komisyon uygularken bu listeyi kullanir. Eslesme (chainId, router) cifti ' +
    'uzerinden ve kucuk harfe cevrilerek yapilmalidir.',
  kaynak:
    'client/src/utils/swapChains.js (CHAIN_CONFIG) + client/src/utils/lcx/routers.js (LCX_ROUTERS) — elle duzenlemeyin',
  uretenBetik: 'client/scripts/gen-router-manifest.mjs (npm run routers:manifest)',
  zincirSayisi: Object.keys(zincirler).length,
  routerSayisi: Object.values(zincirler).reduce((n, c) => n + c.routers.length, 0),
  zincirler,
}

// Bu dosya git e giriyor; kayan bir zaman damgasi her uretimde sahte bir diff yaratir ve
// gercek degisikligi gorunmez kilar. Tarihi commit tutuyor.
writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log(`${manifest.zincirSayisi} zincir / ${manifest.routerSayisi} router -> ${OUT}`)
