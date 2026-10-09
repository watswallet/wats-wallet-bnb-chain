import { describe, it, expect, vi } from 'vitest'
import supportedChains from './supported_chains.json'
import { isEvm, isTon, isSolana } from '../utils/chainKind'
import { RECEIPT_PROBE_HASH } from '../utils/testRPC'
import {
  SMOKE_CHAIN_IDS,
  SMOKE_TIMEOUT_MS,
  probeUrl,
  evaluateChain,
  runSmoke,
  formatTable,
} from '../../scripts/walletconnect-qa/rpc-smoke.mjs'

// Bu dosya yalnizca EVM'in ethers.JsonRpcProvider uclarini denetler. EVM DISI iki
// zincir tipinin de `rpc` listesi bilerek bostur ve bunun sebepleri AYRI:
//   - TON: istemci DOGRUDAN RPC kullanmaz, erisim kendi backend proxy'mizden gecer
//     ve toncenter anahtari sunucuda kalir.
//   - Solana: kaydin `rpc` ALANI HIC YOK (bkz. vm.js/rpcUrlsOf) -- boylece hicbir
//     ethers.JsonRpcProvider Solana icin acilamaz.
// Ikisi de asagida AYRI testlerle kilitli; buradaki filtre yalnizca EVM listesini
// ayirir. Kapi isEvm: TON kaydi `kind:'ton'`, Solana kaydi `vm:'solana'` tasir --
// tek bir alana bakan bir filtre otekini EVM sayardi.
const evmChains = supportedChains.filter((c) => isEvm(c))

// 2026-08-05 canli ariza: Arbitrum One'da basarili bir 7702 bootstrap islemi ekranda
// "ISLEM BASARISIZ ... islem sonucu dogrulanamadi (timeout)" olarak gorundu ve ATS
// transferi hic gonderilmedi. Sebep zincir ya da imza degil, RPC idi:
// *-rpc.publicnode.com uclari yuksek hacimli zincirlerde eth_getTransactionReceipt'i
// ucretli token arkasina almis:
//   {"code":-32602,"message":"Archive requests require a personal token..."}
// (42161, 8453 ve 56'da dogrulandi; 1, 10, 137, 100, 25, 5000, 42220'de makbuz calisiyor.)
//
// ethers v6 waitForTransaction bu hatayi YUTAR ve her blokta yeniden dener; sonuc
// TX_WAIT_TIMEOUT_MS sonunda code=TIMEOUT'tur. Yani zincirde BASARILI olan islem
// istemcide "dogrulanamadi" olur — hem ATS akisi (transfer atlanir) hem de normal
// islemler ("Transaction failed or dropped") bundan etkilenir.
//
// Cuzdan yalnizca rpc[0]'i kullanir (background.js `found.rpc[0].url`), bu yuzden
// listenin ilerisinde calisan bir uc bulunmasi kurtarmaz.
// 2026-10-03 olcumu (WalletConnect QA calismasi, N5): optimism-rpc.publicnode.com da
// ayni kapiya girdi -- eth_getTransactionReceipt bos hash icin bile
// -32602 "Archive requests require a personal token" donduruyor. Yukaridaki
// "10'da makbuz calisiyor" notu 2026-08-05 icin dogruydu, artik GECERSIZ.
// OP'nin tek ucu buydu: testRPC bunu NO_RECEIPTS sayar, findFastestRPC null doner ve
// "RPC ulasilamaz" uyarisi cikardi. Yerine mainnet.optimism.io ve optimism.drpc.org
// geldi; eski uc buraya girerek listeye geri donmesi engellendi.
const RECEIPT_GATED_HOSTS = [
  'arbitrum-one-rpc.publicnode.com',
  'base-rpc.publicnode.com',
  'bsc-rpc.publicnode.com',
  'optimism-rpc.publicnode.com',
]

describe('desteklenen zincir RPC leri', () => {
  it('her EVM zincirinin en az bir https RPC si var', () => {
    expect(evmChains.length, 'EVM kaydi sayisi degisti').toBe(10)
    for (const c of evmChains) {
      expect(Array.isArray(c.rpc), `${c.chainId} rpc dizi degil`).toBe(true)
      expect(c.rpc.length, `${c.chainId} rpc bos`).toBeGreaterThan(0)
      for (const r of c.rpc) expect(r.url.startsWith('https://')).toBe(true)
    }
  })

  it('TON zincirlerinin rpc listesi BOS kalir', () => {
    const tonChains = supportedChains.filter((c) => isTon(c))
    expect(tonChains.length, 'TON kaydi yok').toBe(2)
    for (const c of tonChains) {
      expect(Array.isArray(c.rpc), `${c.chainId} rpc dizi degil`).toBe(true)
      // Buraya bir uc eklenirse toncenter API anahtari uzanti paketine gomulmus olur.
      expect(c.rpc.length, `${c.chainId} rpc dolu — anahtar sizabilir`).toBe(0)
    }
  })

  it('Solana kaydinda rpc ALANI HIC YOK', () => {
    const solana = supportedChains.filter((c) => isSolana(c))
    expect(solana.length, 'Solana kaydi yok').toBe(1)
    // BOS DIZI DE YETMEZ: rpcUrlsOf bos diziyi zaten bos donduruyor ama alanin
    // VAR olmasi, ileride birinin oraya bir uc yazmasini davet eder ve o uc
    // ethers.JsonRpcProvider'a beslenirse Solana JSON-RPC'si EVM istemcisiyle
    // konusturulmus olur (sessiz, anlasilmasi zor bir ariza).
    expect(solana[0].rpc, 'Solana kaydina rpc eklenmis').toBeUndefined()
  })

  it('makbuz vermeyen uclar HIC listelenmez', () => {
    for (const c of evmChains) {
      for (const r of c.rpc) {
        const host = new URL(r.url).host
        expect(RECEIPT_GATED_HOSTS, `${c.chainId} icin makbuz vermeyen RPC: ${r.url}`)
          .not.toContain(host)
      }
    }
  })
})

// WalletConnect QA calismasi, N5 (2026-10-03 olcumu): OP ve Polygon'un ilk ucu makbuz
// veren, calisan uc olmali; cuzdan yalnizca rpc[0]'i kullanir (bkz. dosya basi notu).
describe('OP ve Polygon RPC verisi (N5)', () => {
  const urlsOf = (chainId) => supportedChains.find((c) => c.chainId === chainId).rpc.map((r) => r.url)

  it('Optimism: ilk uc mainnet.optimism.io, optimism.drpc.org da listede', () => {
    const urls = urlsOf(10)
    expect(urls[0]).toBe('https://mainnet.optimism.io')
    expect(urls).toContain('https://optimism.drpc.org')
  })

  it('Optimism: makbuz kapisina giren publicnode ucu listede YOK ve kilit listesinde', () => {
    expect(urlsOf(10)).not.toContain('https://optimism-rpc.publicnode.com')
    expect(RECEIPT_GATED_HOSTS).toContain('optimism-rpc.publicnode.com')
  })

  it('Polygon: ilk uc polygon.drpc.org, yedek olarak en az bir uc daha var', () => {
    const urls = urlsOf(137)
    expect(urls[0]).toBe('https://polygon.drpc.org')
    expect(urls.length).toBeGreaterThan(1)
  })

  it('hicbir EVM zincirinde ayni URL iki kez listelenmez', () => {
    for (const c of evmChains) {
      const urls = c.rpc.map((r) => r.url)
      expect(new Set(urls).size, `${c.chainId} yinelenen RPC`).toBe(urls.length)
    }
  })
})

// ---------------------------------------------------------------------------
// scripts/walletconnect-qa/rpc-smoke.mjs -- duman betiginin KARARLARI (agsiz).
// Betik canli ucleri yoklar; burada her sey sahte fetch ile surulur. Canli kosu
// yalnizca elle yapilir (yayin oncesi ve G-5 guncelleme gunu, bkz. N5).
// ---------------------------------------------------------------------------
const jsonRes = (body, init = {}) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  json: async () => body,
})
const NULL_RECEIPT = { jsonrpc: '2.0', id: 1, result: null }
const GATED_ERROR = {
  jsonrpc: '2.0',
  id: 1,
  error: { code: -32602, message: 'Archive requests require a personal token' },
}

describe('rpc-smoke: probeUrl', () => {
  it('yalnizca eth_getTransactionReceipt + RECEIPT_PROBE_HASH ile POST atar', async () => {
    const fetchImpl = vi.fn(async () => jsonRes(NULL_RECEIPT))
    await probeUrl('https://rpc.example.test', { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://rpc.example.test')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.jsonrpc).toBe('2.0')
    expect(body.method).toBe('eth_getTransactionReceipt')
    expect(body.params).toEqual([RECEIPT_PROBE_HASH])
  })

  it('result:null (makbuz yok) SAGLIKLI uctur: OK', async () => {
    const r = await probeUrl('https://a.test', { fetchImpl: async () => jsonRes(NULL_RECEIPT) })
    expect(r.status).toBe('OK')
    expect(typeof r.ms).toBe('number')
  })

  it('result dolu bir nesne de OK', async () => {
    const r = await probeUrl('https://a.test', {
      fetchImpl: async () => jsonRes({ jsonrpc: '2.0', id: 1, result: { status: '0x1' } }),
    })
    expect(r.status).toBe('OK')
  })

  it('HTTP 200 + JSON-RPC error alani: RPC_ERROR, kod ve mesaj ayrintida', async () => {
    const r = await probeUrl('https://a.test', { fetchImpl: async () => jsonRes(GATED_ERROR) })
    expect(r.status).toBe('RPC_ERROR')
    expect(r.detail).toContain('-32602')
    expect(r.detail).toContain('Archive requests')
  })

  it('HTTP 429: HTTP_ERROR (hiz siniri), firlatmaz', async () => {
    const r = await probeUrl('https://a.test', {
      fetchImpl: async () => jsonRes({}, { ok: false, status: 429 }),
    })
    expect(r.status).toBe('HTTP_ERROR')
    expect(r.detail).toBe('HTTP 429')
  })

  it('result alani hic yoksa NO_RESULT', async () => {
    const r = await probeUrl('https://a.test', { fetchImpl: async () => jsonRes({ jsonrpc: '2.0', id: 1 }) })
    expect(r.status).toBe('NO_RESULT')
  })

  it('govde JSON degilse BAD_JSON', async () => {
    const r = await probeUrl('https://a.test', {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <')
        },
      }),
    })
    expect(r.status).toBe('BAD_JSON')
  })

  it('fetch firlatirsa (ag yok) NETWORK doner, betik cokmez', async () => {
    const r = await probeUrl('https://a.test', {
      fetchImpl: async () => {
        throw new TypeError('fetch failed')
      },
    })
    expect(r.status).toBe('NETWORK')
    expect(r.detail).toContain('fetch failed')
  })

  it('zaman asiminda TIMEOUT doner (signal abort edilir)', async () => {
    const fetchImpl = (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
        )
      })
    const r = await probeUrl('https://slow.test', { fetchImpl, timeoutMs: 20 })
    expect(r.status).toBe('TIMEOUT')
  })

  it('varsayilan zaman asimi 10 sn ve zincir listesi OP, Base, Arbitrum, Polygon', () => {
    expect(SMOKE_TIMEOUT_MS).toBe(10000)
    expect(SMOKE_CHAIN_IDS).toEqual([10, 8453, 42161, 137])
    for (const id of SMOKE_CHAIN_IDS) {
      expect(supportedChains.some((c) => c.chainId === id), `${id} supported_chains.json'da yok`).toBe(true)
    }
  })
})

describe('rpc-smoke: evaluateChain (gecti/kaldi kurali)', () => {
  const ok = { status: 'OK', detail: 'x', ms: 1 }
  const bad = { status: 'RPC_ERROR', detail: '-32602 gated', ms: 1 }
  const urls = ['https://first.test', 'https://second.test']

  it('ilk URL OK + ikinci hatali: GECTI, ikinci icin yalnizca UYARI', () => {
    const v = evaluateChain({ chainId: 10, name: 'Optimism', urls, results: [ok, bad] })
    expect(v.pass).toBe(true)
    expect(v.reasons).toEqual([])
    expect(v.warnings).toHaveLength(1)
    expect(v.warnings[0]).toContain('https://second.test')
  })

  it('ilk URL hatali, ikincisi OK: KALDI (cuzdan rpc[0] kullanir)', () => {
    const v = evaluateChain({ chainId: 10, name: 'Optimism', urls, results: [bad, ok] })
    expect(v.pass).toBe(false)
    expect(v.reasons.join(' ')).toContain('https://first.test')
  })

  it('hicbir URL OK degil: KALDI', () => {
    const v = evaluateChain({ chainId: 137, name: 'Polygon', urls, results: [bad, bad] })
    expect(v.pass).toBe(false)
    expect(v.reasons.length).toBeGreaterThanOrEqual(1)
  })

  it('bos rpc listesi: KALDI', () => {
    const v = evaluateChain({ chainId: 8453, name: 'Base', urls: [], results: [] })
    expect(v.pass).toBe(false)
  })
})

describe('rpc-smoke: runSmoke', () => {
  // Gercek supported_chains.json + sahte fetch: her URL icin cevap tablodan gelir.
  const allOk = () => vi.fn(async () => jsonRes(NULL_RECEIPT))

  it('hepsi OK ise cikis kodu 0; her zincirin her URL si bir satir', async () => {
    const fetchImpl = allOk()
    const { rows, verdicts, exitCode } = await runSmoke({ chains: supportedChains, fetchImpl })
    const expectedRows = SMOKE_CHAIN_IDS.reduce(
      (n, id) => n + supportedChains.find((c) => c.chainId === id).rpc.length,
      0,
    )
    expect(exitCode).toBe(0)
    expect(rows).toHaveLength(expectedRows)
    expect(fetchImpl).toHaveBeenCalledTimes(expectedRows)
    expect(verdicts.map((v) => v.chainId)).toEqual(SMOKE_CHAIN_IDS)
    expect(rows.every((r) => r.status === 'OK')).toBe(true)
  })

  it('sorgulanan TEK yontem eth_getTransactionReceipt (yalnizca okuma)', async () => {
    const fetchImpl = allOk()
    await runSmoke({ chains: supportedChains, fetchImpl })
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body).method).toBe('eth_getTransactionReceipt')
    }
  })

  it('bir zincirin ILK ucu makbuz kapisindaysa cikis kodu 1', async () => {
    const op = supportedChains.find((c) => c.chainId === 10)
    const fetchImpl = vi.fn(async (url) =>
      url === op.rpc[0].url ? jsonRes(GATED_ERROR) : jsonRes(NULL_RECEIPT),
    )
    const { verdicts, exitCode } = await runSmoke({ chains: supportedChains, fetchImpl })
    expect(exitCode).toBe(1)
    expect(verdicts.find((v) => v.chainId === 10).pass).toBe(false)
    expect(verdicts.filter((v) => v.pass)).toHaveLength(SMOKE_CHAIN_IDS.length - 1)
  })

  it('yedek ucun hatasi UYARIdir: cikis kodu 0', async () => {
    const base = supportedChains.find((c) => c.chainId === 8453)
    const fetchImpl = vi.fn(async (url) =>
      url === base.rpc[1].url ? jsonRes({}, { ok: false, status: 429 }) : jsonRes(NULL_RECEIPT),
    )
    const { verdicts, exitCode } = await runSmoke({ chains: supportedChains, fetchImpl })
    expect(exitCode).toBe(0)
    expect(verdicts.find((v) => v.chainId === 8453).warnings.length).toBe(1)
  })

  it('ag hic yoksa (her fetch firlatir) cokmez: cikis kodu 1, her satir NETWORK', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const { rows, exitCode } = await runSmoke({ chains: supportedChains, fetchImpl })
    expect(exitCode).toBe(1)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.status === 'NETWORK')).toBe(true)
  })

  it('zincir supported_chains.json icinde yoksa KALDI (sessizce atlanmaz)', async () => {
    const { verdicts, exitCode } = await runSmoke({
      chains: supportedChains.filter((c) => c.chainId !== 137),
      fetchImpl: allOk(),
    })
    expect(exitCode).toBe(1)
    const missing = verdicts.find((v) => v.chainId === 137)
    expect(missing.pass).toBe(false)
    expect(missing.reasons.join(' ')).toContain('supported_chains.json')
  })
})

describe('rpc-smoke: formatTable ve iceri aktarma', () => {
  it('tablo her satirda zincir, URL ve sonucu gosterir', () => {
    const text = formatTable([
      { chainId: 10, name: 'Optimism', position: 1, url: 'https://mainnet.optimism.io', status: 'OK', detail: 'result:null', ms: 123 },
      { chainId: 10, name: 'Optimism', position: 2, url: 'https://optimism.drpc.org', status: 'RPC_ERROR', detail: '-32602 gated', ms: 45 },
    ])
    expect(text).toContain('ZINCIR')
    expect(text).toContain('Optimism (10)')
    expect(text).toContain('https://mainnet.optimism.io')
    expect(text).toContain('RPC_ERROR')
    expect(text.split('\n')).toHaveLength(4) // baslik + ayirici + 2 satir
  })

  it('modulu ice aktarmak aga GITMEZ ve cikis kodunu degistirmez', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const before = process.exitCode
    vi.resetModules()
    await import('../../scripts/walletconnect-qa/rpc-smoke.mjs')
    expect(spy).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(before)
    vi.unstubAllGlobals()
  })
})
