// xStocks Faz 3 -- COW_FEE_* ic aksiyonlari (plan Task 10, spec 6.7).
//
// background.js GERCEKTEN ice aktarilir (harness background.cow.test.js ten). feeRuntime fabrikasi sahte ile
// degistirilir: burada sinanan DAGITIM katmanidir (koken kapisi, bayrak, aktif hesap, kasa, kuyruk, yanit bicimi).
// settler / claimer mantigi kendi dosyalarinda sinanir.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import supported_chains from './data/supported_chains.json'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from './test-utils/kaynakTarama.js'
import { unlockVault } from './utils/crypto-utils'
import { XSTOCKS } from './data/xStocks'
import { PAY_TOKENS } from './utils/cow/config'

const bayrak = vi.hoisted(() => ({ ana: true, ucret: true }))
vi.mock('./utils/featureFlags', async (importOriginal) => ({
  ...(await importOriginal()),
  get XSTOCKS_ENABLED() {
    return bayrak.ana
  },
  get XSTOCKS_ATS_FEE_ENABLED() {
    return bayrak.ana && bayrak.ucret
  },
}))

const ats = vi.hoisted(() => ({ execute: vi.fn(async () => ({ hash: '0xh', txHash: '0xt' })) }))
vi.mock('./utils/atsPaymaster', async (importOriginal) => ({
  ...(await importOriginal()),
  executeAtsTransfer: (...a) => ats.execute(...a),
}))

const rt = vi.hoisted(() => ({
  settler: { settleCowFees: vi.fn(), approveFeeChange: vi.fn() },
  claimer: { claimRefunds: vi.fn() },
  statusFor: vi.fn(),
  prepare: vi.fn(),
}))
const fabrika = vi.hoisted(() => ({ fee: vi.fn() }))
vi.mock('./utils/cow/feeRuntime', async (importOriginal) => ({
  ...(await importOriginal()),
  createFeeRuntime: (...a) => {
    fabrika.fee(...a)
    return rt
  },
}))

// Gercek servis kullanilir; yalniz fabrika argumanlari yakalanir (Faz 3 ucret baglantisi sinanir).
const fabrikaSvc = vi.hoisted(() => ({ args: vi.fn(), ek: null }))
vi.mock('./utils/cow/service', async (importOriginal) => {
  const orijinal = await importOriginal()
  return {
    ...orijinal,
    createCowService: (...a) => {
      fabrikaSvc.args(...a)
      // ek: yalniz ag bagimliliklari (api/chain/reference) sahtelenir; fee/feeEnabled baglantisi GERCEK kalir.
      return orijinal.createCowService(fabrikaSvc.ek ? { ...a[0], ...fabrikaSvc.ek } : a[0])
    },
  }
})

const MNEMONIC = 'test test test test test test test test test test test junk'
vi.mock('./utils/crypto-utils', () => ({ unlockVault: vi.fn(async () => MNEMONIC), decryptSecret: vi.fn() }))

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const BSC = supported_chains.find((c) => c.chainId === 56)
const HESAP = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const BASKA = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const uidOf = (n) => '0x' + n.toString(16).padStart(2, '0').repeat(56)
const SAYFA = { tab: { id: 7 }, url: 'https://evil.example/' }
const RED = { error: { code: 4100, message: 'Unauthorized' } }

let messageListener
let sessionStore
let localStore

function installChromeStub() {
  const listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [] }
  const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })
  globalThis.chrome = {
    alarms: { create: vi.fn(), onAlarm: add('onAlarm') },
    runtime: {
      getURL: () => EXTENSION_ORIGIN,
      onConnect: add('onConnect'),
      onStartup: add('onStartup'),
      onInstalled: add('onInstalled'),
      onMessage: add('onMessage'),
      sendMessage: vi.fn(() => Promise.resolve()),
      lastError: null,
    },
    storage: {
      local: {
        get: vi.fn(async (keys) => {
          const wanted = Array.isArray(keys) ? keys : [keys]
          return Object.fromEntries(wanted.map((k) => [k, localStore[k]]))
        }),
        set: vi.fn(async (obj) => {
          Object.assign(localStore, obj)
        }),
        remove: vi.fn(async () => {}),
      },
      session: {
        get: vi.fn(async () => sessionStore),
        set: vi.fn(async (obj) => {
          Object.assign(sessionStore, obj)
        }),
        remove: vi.fn(async () => {}),
      },
    },
    tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => {}), create: vi.fn() },
    windows: {
      create: vi.fn(async () => ({ id: 1 })),
      getLastFocused: vi.fn(async () => ({ width: 1000, left: 0, top: 0 })),
      get: vi.fn(async () => ({ id: 1 })),
      onRemoved: add('onConnect'),
      remove: vi.fn(),
    },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
  }
  return listeners
}

function callHandler(message, sender = { url: EXTENSION_ORIGIN }) {
  const out = { calls: 0 }
  out.promise = new Promise((resolve) => {
    const returned = messageListener(message, sender, (v) => {
      out.calls += 1
      resolve(v)
    })
    if (returned !== true) resolve(undefined)
  })
  return out
}
const send = (message, sender) => callHandler(message, sender).promise

const flush = () => new Promise((r) => setTimeout(r, 0))
const bekle = async (kosul) => {
  for (let i = 0; i < 50 && !kosul(); i++) await flush()
}

const bekleyenKayit = (n, owner) => ({
  uid: uidOf(n), owner, chainId: 56, status: 'fulfilled', createdAt: 1000 + n,
  fee: { mode: 'ats', state: 'blocked', blocker: 'FEE_CHANGED', quotedAtsRaw: '1' },
})

async function boot({ ana = true, ucret = true, kilitli = false } = {}) {
  bayrak.ana = ana
  bayrak.ucret = ucret
  vi.resetModules()
  vi.clearAllMocks()
  fabrikaSvc.ek = null
  vi.spyOn(console, 'error').mockImplementation(() => {})
  sessionStore = kilitli ? {} : { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
  localStore = {
    active_account: { key: 'k1', type: 'hd', index: 0, derivationPath: "m/44'/60'/0'/0/0", address: HESAP },
    vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: HESAP }] }],
    currentNetwork: BSC,
    dapps: {},
    current_transactions: [],
    cow_orders: [],
  }
  const listeners = installChromeStub()
  globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
  await import('./background.js')
  messageListener = listeners.onMessage[0]
  rt.settler.settleCowFees.mockResolvedValue({ outcome: 'NONE' })
  rt.settler.approveFeeChange.mockResolvedValue({ outcome: 'PENDING', uid: uidOf(1), code: 'APPROVED' })
  rt.statusFor.mockResolvedValue({ fees: [{ uid: uidOf(1), state: 'owed' }], debt: true })
}

const FEE_ACTIONS = ['COW_FEE_STATUS', 'COW_FEE_PAY', 'COW_FEE_APPROVE_CHANGE']
const govde = (type) => ({ type, message: { uid: uidOf(1) } })

describe('koken kapisi', () => {
  it.each(FEE_ACTIONS)('sayfa kokenli %s internal-only ile reddedilir, calisma zamani kurulmaz', async (type) => {
    await boot()
    expect(await send(govde(type), SAYFA)).toEqual(RED)
    expect(fabrika.fee).not.toHaveBeenCalled()
    expect(rt.statusFor).not.toHaveBeenCalled()
    expect(rt.settler.settleCowFees).not.toHaveBeenCalled()
    expect(rt.settler.approveFeeChange).not.toHaveBeenCalled()
  })

  it.each(FEE_ACTIONS)('sayfa kokenli istek %s adini `method` alanina saklasa da reddedilir', async (type) => {
    await boot()
    expect(await send({ method: type, message: { uid: uidOf(1) } }, SAYFA)).toEqual(RED)
    expect(rt.settler.settleCowFees).not.toHaveBeenCalled()
  })

  it.each(FEE_ACTIONS)('sayfa kokenli istek ucret bayragi KAPALIYKEN de %s icin internal-only (bayraktan bagimsiz)', async (type) => {
    await boot({ ucret: false })
    expect(await send(govde(type), SAYFA)).toEqual(RED)
  })
})

describe('bayraklar', () => {
  it('ucret bayragi KAPALIYKEN PAY ve APPROVE_CHANGE XSTOCKS_DISABLED; hicbir sey cagrilmaz', async () => {
    await boot({ ucret: false })
    expect(await send({ type: 'COW_FEE_PAY', message: {} })).toEqual({ success: false, code: 'XSTOCKS_DISABLED' })
    expect(await send(govde('COW_FEE_APPROVE_CHANGE'))).toEqual({ success: false, code: 'XSTOCKS_DISABLED' })
    expect(rt.settler.settleCowFees).not.toHaveBeenCalled()
    expect(rt.settler.approveFeeChange).not.toHaveBeenCalled()
  })

  it('ucret bayragi KAPALIYKEN STATUS yine calisir (kasa acilmaz)', async () => {
    await boot({ ucret: false, kilitli: true })
    const res = await send({ type: 'COW_FEE_STATUS', message: {} })
    expect(res).toEqual({ success: true, fees: [{ uid: uidOf(1), state: 'owed' }], debt: true })
    expect(rt.statusFor).toHaveBeenCalledWith(HESAP)
    expect(unlockVault).not.toHaveBeenCalled()
  })

  it.each(FEE_ACTIONS)('ANA bayrak kapaliyken %s XSTOCKS_DISABLED (COW_ onek kapisi)', async (type) => {
    await boot({ ana: false })
    expect(await send(govde(type))).toEqual({ success: false, code: 'XSTOCKS_DISABLED' })
    expect(fabrika.fee).not.toHaveBeenCalled()
  })
})

describe('COW_FEE_PAY', () => {
  it('aktif hesap adresi + flagOn:true + getSigner; mesajdaki account nesnesi YOK SAYILIR', async () => {
    await boot()
    rt.settler.settleCowFees.mockResolvedValue({ outcome: 'PAID', uid: uidOf(1) })
    const res = await send({
      type: 'COW_FEE_PAY',
      message: { account: { address: BASKA }, owner: BASKA, uid: uidOf(9) },
    })
    expect(res).toEqual({ success: true, outcome: { outcome: 'PAID', uid: uidOf(1) } })
    expect(rt.settler.settleCowFees).toHaveBeenCalledTimes(1)
    const arg = rt.settler.settleCowFees.mock.calls[0][0]
    expect(Object.keys(arg).sort()).toEqual(['flagOn', 'getSigner', 'owner'])
    expect(arg.owner).toBe(HESAP)
    expect(arg.flagOn).toBe(true)
    expect((await arg.getSigner()).address).toBe(HESAP)
  })

  it('KILITLI kasada WALLET_LOCKED; settleCowFees anahtar ALAMAZ (kasa acilmaz)', async () => {
    await boot({ kilitli: true })
    let alinan = 'denenmedi'
    rt.settler.settleCowFees.mockImplementation(async ({ getSigner }) => {
      try {
        alinan = await getSigner()
      } catch {
        alinan = null
      }
      return { outcome: 'PENDING', uid: uidOf(1), code: 'LOCKED' }
    })
    const res = await send({ type: 'COW_FEE_PAY', message: {} })
    expect(res).toEqual({ success: false, code: 'WALLET_LOCKED' })
    expect(alinan).toBeNull()
    expect(unlockVault).not.toHaveBeenCalled()
  })

  it('kilitli kasada anahtar GEREKMEYEN sonuc (ucret yok) normal basari doner', async () => {
    await boot({ kilitli: true })
    expect(await send({ type: 'COW_FEE_PAY', message: {} })).toEqual({ success: true, outcome: { outcome: 'NONE' } })
  })

  it('EVM tasimayan aktif hesapta UNSUPPORTED_CHAIN, ucret islenmez', async () => {
    await boot()
    localStore.active_account = { key: 'k9', type: 'ton', address: 'EQ...' }
    expect(await send({ type: 'COW_FEE_PAY', message: {} })).toEqual({ success: false, code: 'UNSUPPORTED_CHAIN' })
    expect(rt.settler.settleCowFees).not.toHaveBeenCalled()
  })

  it('cift tik: iki PAY kuyrukta SERI kosar', async () => {
    await boot()
    let birinciyiBitir
    rt.settler.settleCowFees.mockImplementationOnce(() => new Promise((r) => { birinciyiBitir = r }))
    rt.settler.settleCowFees.mockResolvedValueOnce({ outcome: 'NONE' })
    const a = callHandler({ type: 'COW_FEE_PAY', message: {} })
    const b = callHandler({ type: 'COW_FEE_PAY', message: {} })
    await bekle(() => rt.settler.settleCowFees.mock.calls.length >= 1)
    await flush()
    await flush()
    expect(rt.settler.settleCowFees).toHaveBeenCalledTimes(1)
    birinciyiBitir({ outcome: 'PAID', uid: uidOf(1) })
    await Promise.all([a.promise, b.promise])
    expect(rt.settler.settleCowFees).toHaveBeenCalledTimes(2)
    expect(a.calls).toBe(1)
    expect(b.calls).toBe(1)
  })

  it('settler firlatirsa UNKNOWN; hata govdesi yanita sizmaz, gunluge yalniz kod yazilir', async () => {
    await boot()
    rt.settler.settleCowFees.mockRejectedValue(Object.assign(new Error('gizli govde 0xabc'), { code: 'BOOM_1' }))
    const res = await send({ type: 'COW_FEE_PAY', message: {} })
    expect(res).toEqual({ success: false, code: 'UNKNOWN' })
    expect(console.error).toHaveBeenCalledWith('[cow]', 'BOOM_1')
    expect(JSON.stringify(console.error.mock.calls)).not.toContain('gizli')
  })

  it('yanit JSON + structuredClone gecer (BigInt toMessageSafe ile dize)', async () => {
    await boot()
    rt.settler.settleCowFees.mockResolvedValue({ outcome: 'PAID', uid: uidOf(1), atsRaw: 5n })
    const res = await send({ type: 'COW_FEE_PAY', message: {} })
    expect(() => JSON.stringify(res)).not.toThrow()
    expect(structuredClone(res).outcome.atsRaw).toBe('5')
  })
})

describe('COW_FEE_APPROVE_CHANGE', () => {
  it('kendi kaydi: approveFeeChange({owner, uid}) sonra settleCowFees; yanit outcome', async () => {
    await boot()
    localStore.cow_orders = [bekleyenKayit(1, HESAP)]
    rt.settler.settleCowFees.mockResolvedValue({ outcome: 'PAID', uid: uidOf(1) })
    const res = await send({ type: 'COW_FEE_APPROVE_CHANGE', message: { uid: uidOf(1), account: { address: BASKA } } })
    expect(res).toEqual({ success: true, outcome: { outcome: 'PAID', uid: uidOf(1) } })
    expect(rt.settler.approveFeeChange).toHaveBeenCalledWith({ owner: HESAP, uid: uidOf(1) })
    expect(rt.settler.settleCowFees).toHaveBeenCalledTimes(1)
    expect(rt.settler.settleCowFees.mock.calls[0][0].owner).toBe(HESAP)
    const sira = [
      rt.settler.approveFeeChange.mock.invocationCallOrder[0],
      rt.settler.settleCowFees.mock.invocationCallOrder[0],
    ]
    expect(sira[0]).toBeLessThan(sira[1])
  })

  it('BASKA hesabin uid i -> ACCOUNT_CHANGED; ne onay ne ucret cagrilir', async () => {
    await boot()
    localStore.cow_orders = [bekleyenKayit(2, BASKA)]
    const res = await send({ type: 'COW_FEE_APPROVE_CHANGE', message: { uid: uidOf(2) } })
    expect(res).toEqual({ success: false, code: 'ACCOUNT_CHANGED' })
    expect(rt.settler.approveFeeChange).not.toHaveBeenCalled()
    expect(rt.settler.settleCowFees).not.toHaveBeenCalled()
  })

  it('uygun olmayan kayit: onay NONE doner -> ucret gonderimi TETIKLENMEZ', async () => {
    await boot()
    localStore.cow_orders = [bekleyenKayit(1, HESAP)]
    rt.settler.approveFeeChange.mockResolvedValue({ outcome: 'NONE', code: 'NOT_ELIGIBLE' })
    const res = await send({ type: 'COW_FEE_APPROVE_CHANGE', message: { uid: uidOf(1) } })
    expect(res).toEqual({ success: true, outcome: { outcome: 'NONE', code: 'NOT_ELIGIBLE' } })
    expect(rt.settler.settleCowFees).not.toHaveBeenCalled()
  })

  it.each([
    ['eksik', undefined],
    ['dize degil', 5],
    ['kisa', '0x1234'],
    ['buyuk harf', '0x' + 'AB'.repeat(56)],
    ['0x oneksiz', 'ab'.repeat(56)],
    ['fazla uzun', '0x' + 'ab'.repeat(57)],
    ['hex disi', '0x' + 'zz'.repeat(56)],
  ])('bozuk uid (%s) -> INVALID_REQUEST', async (_ad, uid) => {
    await boot()
    const res = await send({ type: 'COW_FEE_APPROVE_CHANGE', message: { uid } })
    expect(res).toEqual({ success: false, code: 'INVALID_REQUEST' })
    expect(rt.settler.approveFeeChange).not.toHaveBeenCalled()
    expect(rt.settler.settleCowFees).not.toHaveBeenCalled()
  })

  it('KILITLI kasada onay sonrasi ucret anahtar isteyince WALLET_LOCKED', async () => {
    await boot({ kilitli: true })
    localStore.cow_orders = [bekleyenKayit(1, HESAP)]
    rt.settler.settleCowFees.mockImplementation(async ({ getSigner }) => {
      await getSigner().catch(() => {})
      return { outcome: 'PENDING', uid: uidOf(1), code: 'LOCKED' }
    })
    const res = await send({ type: 'COW_FEE_APPROVE_CHANGE', message: { uid: uidOf(1) } })
    expect(res).toEqual({ success: false, code: 'WALLET_LOCKED' })
    expect(unlockVault).not.toHaveBeenCalled()
  })
})

describe('COW_FEE_STATUS', () => {
  it('aktif hesap icin fees + debt doner; mesajdaki hesap yok sayilir', async () => {
    await boot()
    const res = await send({ type: 'COW_FEE_STATUS', message: { account: { address: BASKA }, owner: BASKA } })
    expect(res).toEqual({ success: true, fees: [{ uid: uidOf(1), state: 'owed' }], debt: true })
    expect(rt.statusFor).toHaveBeenCalledTimes(1)
    expect(rt.statusFor).toHaveBeenCalledWith(HESAP)
  })
})

describe('calisma zamani kurulumu', () => {
  it('fee calisma zamani TEMBEL kurulur; orders, baseUrl, bayrak ve ATS fonksiyonlari iletilir', async () => {
    await boot()
    expect(fabrika.fee).not.toHaveBeenCalled()
    await send({ type: 'COW_FEE_STATUS', message: {} })
    expect(fabrika.fee).toHaveBeenCalledTimes(1)
    const arg = fabrika.fee.mock.calls[0][0]
    expect(typeof arg.orders.loadOrders).toBe('function')
    expect(typeof arg.orders.patchOrder).toBe('function')
    expect(typeof arg.atsFns.quoteAtsTransfer).toBe('function')
    expect(typeof arg.atsFns.executeAtsTransfer).toBe('function')
    expect(typeof arg.atsFns.readAtsStatus).toBe('function')
    expect(typeof arg.rpcFor).toBe('function')
    expect(arg.rpcFor(56)).toBe(BSC.rpc[0].url)
    expect(arg.flag).toBe(true)
    expect(typeof arg.baseUrl).toBe('string')
    await send({ type: 'COW_FEE_STATUS', message: {} })
    expect(fabrika.fee).toHaveBeenCalledTimes(1) // tek ornek
  })
})

describe('anahtar noktasi', () => {
  it('ucret op u imzacidan ham anahtari TEK yerde cikarir; signer alani executeAtsTransfer a gecmez', async () => {
    await boot()
    await send({ type: 'COW_FEE_STATUS', message: {} }) // calisma zamani kurulur
    const { atsFns } = fabrika.fee.mock.calls[0][0]
    const call = { to: HESAP, value: 0n, data: uidOf(1) }
    const sonuc = await atsFns.executeAtsTransfer({
      chainId: 56, rpcUrl: 'http://x', call, quoted: { q: 1 }, opKind: 'cowFee', fixedNonce: '77',
      signer: { privateKey: '0xanahtar', address: HESAP },
    })
    expect(sonuc).toEqual({ hash: '0xh', txHash: '0xt' })
    expect(ats.execute).toHaveBeenCalledTimes(1)
    const arg = ats.execute.mock.calls[0][0]
    expect(arg).toEqual({
      privateKey: '0xanahtar', chainId: 56, rpcUrl: 'http://x', call, quoted: { q: 1 }, opKind: 'cowFee', fixedNonce: '77',
    })
    expect(arg.signer).toBeUndefined()
  })
})

describe('kaynak taramasi', () => {
  const BG = yorumsuz(readFileSync(fileURLToPath(new URL('./background.js', import.meta.url)), 'utf8')).replace(/\r\n/g, '\n')
  const blok = (isaret, kapanis = '\n}\n') => {
    const bas = BG.indexOf(isaret)
    expect(bas).toBeGreaterThan(-1)
    const son = BG.indexOf(kapanis, bas + isaret.length)
    return BG.slice(bas, son === -1 ? undefined : son)
  }

  it('uc isleyici de resolveAccount(message) KULLANMAZ', () => {
    for (const ad of ['function cowFeeStatus(', 'function cowFeePay(', 'function cowFeeApproveChange(']) {
      expect(blok(ad)).not.toMatch(/resolveAccount\s*\(/)
    }
  })

  it('PAY ve APPROVE_CHANGE isleyicileri ucret bayragini denetler, kuyrukta kosar; STATUS bayraga bakmaz', () => {
    for (const ad of ['function cowFeePay(', 'function cowFeeApproveChange(']) {
      const g = blok(ad)
      expect(g).toContain('XSTOCKS_ATS_FEE_ENABLED')
      expect(g).toContain('runCowQueued(')
    }
    const durum = blok('function cowFeeStatus(')
    expect(durum).not.toContain('XSTOCKS_ATS_FEE_ENABLED')
    expect(durum).not.toContain('runCowQueued(')
    expect(durum).not.toContain('getSigner')
  })
})


// ---------------------------------------------------------------------------
// Plan Task 11: settleCowFeesSafe (kilit acilisi kancasi) -- kuyruk, bayat tik, tek is
// ---------------------------------------------------------------------------
describe('settleCowFeesSafe (UNLOCK_WALLET sonrasi)', () => {
  const kilidiAc = () => send({ type: 'UNLOCK_WALLET', masterKeyJwk: { kty: 'oct', k: 'x' } })
  let simdi
  beforeEach(() => {
    simdi = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => simdi)
  })

  it('kilit acilisindan sonra aktif hesap + flagOn:true ile tetiklenir; yanit BEKLEMEZ', async () => {
    await boot()
    rt.settler.settleCowFees.mockImplementation(() => new Promise(() => {}))
    // Askidaki ucret isi kilit acilisi yanitini geciktirmez.
    expect(await kilidiAc()).toEqual({ success: true })
    await bekle(() => rt.settler.settleCowFees.mock.calls.length >= 1)
    expect(rt.settler.settleCowFees).toHaveBeenCalledTimes(1)
    const arg = rt.settler.settleCowFees.mock.calls[0][0]
    expect(arg.owner).toBe(HESAP)
    expect(arg.flagOn).toBe(true)
    expect((await arg.getSigner()).address).toBe(HESAP)
  })

  it('ucret bayragi KAPALI: kuyruga is girmez, settleCowFees cagrilmaz', async () => {
    await boot({ ucret: false })
    expect(await kilidiAc()).toEqual({ success: true })
    await flush()
    await flush()
    expect(rt.settler.settleCowFees).not.toHaveBeenCalled()
  })

  it('aktif hesap YOK: kuyruga is girmez', async () => {
    await boot()
    delete localStore.active_account
    expect(await kilidiAc()).toEqual({ success: true })
    await flush()
    await flush()
    expect(rt.settler.settleCowFees).not.toHaveBeenCalled()
  })

  it('31 sn kuyrukta bekleyen is CALISMADAN atilir; 29 sn bekleyen calisir', async () => {
    for (const [bekleyisMs, beklenen] of [[31_000, 1], [29_000, 2]]) {
      await boot()
      let birinciyiBitir
      rt.settler.settleCowFees.mockImplementationOnce(() => new Promise((r) => { birinciyiBitir = r }))
      rt.settler.settleCowFees.mockResolvedValue({ outcome: 'NONE' })
      // Kuyrugu kullanici islemi (PAY) mesgul eder; ucret isi arkasina girer.
      const pay = callHandler({ type: 'COW_FEE_PAY', message: {} })
      await bekle(() => rt.settler.settleCowFees.mock.calls.length >= 1)
      expect(await kilidiAc()).toEqual({ success: true })
      await flush()
      simdi += bekleyisMs
      birinciyiBitir({ outcome: 'NONE' })
      await pay.promise
      await bekle(() => rt.settler.settleCowFees.mock.calls.length >= 2)
      await flush()
      await flush()
      expect(rt.settler.settleCowFees).toHaveBeenCalledTimes(beklenen)
    }
  })

  it('kuyrukta ucret isi varken ikinci cagri yeni is EKLEMEZ', async () => {
    await boot()
    let birinciyiBitir
    rt.settler.settleCowFees.mockImplementationOnce(() => new Promise((r) => { birinciyiBitir = r }))
    rt.settler.settleCowFees.mockResolvedValue({ outcome: 'NONE' })
    const pay = callHandler({ type: 'COW_FEE_PAY', message: {} })
    await bekle(() => rt.settler.settleCowFees.mock.calls.length >= 1)
    await kilidiAc()
    await kilidiAc()
    await kilidiAc()
    birinciyiBitir({ outcome: 'NONE' })
    await pay.promise
    await bekle(() => rt.settler.settleCowFees.mock.calls.length >= 2)
    await flush()
    await flush()
    // PAY + TEK ucret isi.
    expect(rt.settler.settleCowFees).toHaveBeenCalledTimes(2)
  })

  it('settleCowFees firlatirsa (reddedilen soz ya da senkron) disari SIZMAZ ve sonraki cagri yine calisir', async () => {
    await boot()
    rt.settler.settleCowFees.mockRejectedValueOnce(new Error('boom'))
    expect(await kilidiAc()).toEqual({ success: true })
    await bekle(() => rt.settler.settleCowFees.mock.calls.length >= 1)
    await flush()
    rt.settler.settleCowFees.mockImplementationOnce(() => { throw new Error('senkron') })
    expect(await kilidiAc()).toEqual({ success: true })
    await bekle(() => rt.settler.settleCowFees.mock.calls.length >= 2)
    await flush()
    rt.settler.settleCowFees.mockResolvedValueOnce({ outcome: 'NONE' })
    expect(await kilidiAc()).toEqual({ success: true })
    await bekle(() => rt.settler.settleCowFees.mock.calls.length >= 3)
    expect(rt.settler.settleCowFees).toHaveBeenCalledTimes(3)
  })
})

// W1: Faz 3 ucret modulunun servise baglanmasi (Task 12 denetim notu). Gercek createCowService, sahte feeRuntime.
describe('servis baglantisi (fee + feeEnabled)', () => {
  const HISSE = XSTOCKS.find((x) => x.chains.includes(56))
  const USDT = PAY_TOKENS[56].find((t) => t.symbol === 'USDT')
  const teklifMsg = () => ({ side: 'buy', chainId: 56, stockAddress: HISSE.address, payToken: USDT.address, amount: '10' })
  const borclu = () => ({
    uid: uidOf(1), owner: HESAP, chainId: 56, status: 'fulfilled', createdAt: 1000,
    fee: { mode: 'ats', state: 'owed', quotedAtsRaw: '1' },
  })
  const svcArg = () => fabrikaSvc.args.mock.calls[0][0]
  const calis = async () => {
    // calisma zamani tembel kurulur; COW_FEE_STATUS bayraktan bagimsiz ve AG ACMAZ (servis fabrikasi yine calisir)
    await send({ type: 'COW_FEE_STATUS', message: {} })
    return svcArg()
  }

  it('bayrak ACIK: servise fee (prepare feeRuntime a iner) ve feeEnabled()=true verilir', async () => {
    await boot()
    rt.prepare.mockResolvedValue({ marker: 1 })
    localStore.cow_orders = [borclu()]
    const arg = await calis()
    expect(typeof arg.fee.prepare).toBe('function')
    expect(arg.feeEnabled()).toBe(true)
    expect(await arg.fee.prepare({ owner: HESAP, chainId: 56 })).toEqual({ marker: 1 })
    expect(rt.prepare).toHaveBeenCalledWith({ owner: HESAP, chainId: 56 })
  })

  it('bayrak ACIK + borc: COW_QUOTE servis uzerinden FEE_DEBT ile kilitlenir (uctan uca)', async () => {
    await boot()
    localStore.cow_orders = [borclu()]
    const res = await send({ type: 'COW_QUOTE', message: teklifMsg() })
    expect(res).toMatchObject({ success: true, locked: true, lockReason: 'FEE_DEBT' })
    expect(res.feeDebtUids).toEqual([uidOf(1)])
    expect(rt.prepare).not.toHaveBeenCalled()
  })

  it('ucret bayragi KAPALI: feeEnabled()=false, prepare cagrilmaz, borc kilidi YOK (Faz 2 davranisi)', async () => {
    await boot({ ucret: false })
    localStore.cow_orders = [borclu()]
    // Kapaliyken COW_QUOTE gercek RPC/CoW cagrilarina uzanir; baglanti kararini fabrika argumani gosterir.
    const arg = await calis()
    expect(arg.feeEnabled()).toBe(false)
    expect(rt.prepare).not.toHaveBeenCalled()
  })

  it('ANA bayrak kapali: servis hic kurulmaz', async () => {
    await boot({ ana: false })
    await send({ type: 'COW_QUOTE', message: teklifMsg() })
    expect(fabrikaSvc.args).not.toHaveBeenCalled()
  })
  // W1: bayrak ACIKKEN COW_QUOTE yaniti feePreview tasir (background -> gercek servis -> sahte feeRuntime.prepare).
  describe('feePreview uctan uca', () => {
    const ATS_1 = '1000000000000000000'
    const kotaBsc = () => ({
      quote: {
        sellToken: USDT.address, buyToken: HISSE.address, receiver: HESAP, kind: 'sell',
        sellAmount: '9900000000000000000', feeAmount: '100000000000000000', buyAmount: '26344786204164553',
      },
      id: 777, expiration: new Date(Date.now() + 60_000).toISOString(), verified: false, protocolFeeBps: '2',
    })
    const aga = () => {
      fabrikaSvc.ek = {
        api: { quote: vi.fn(async () => ({ ok: true, data: kotaBsc() })) },
        chain: {
          readDecimals: vi.fn(async () => 18),
          readBalance: vi.fn(async () => 10n ** 30n),
          readAllowance: vi.fn(async () => 0n),
          readPermitInfo: vi.fn(async () => ({ ok: false })),
        },
        reference: {
          getReference: vi.fn(async () => ({ reference: 380 })),
          getTrading: vi.fn(async () => ({
            ok: true,
            trading: { openNow: true, currentPeriod: 'market', nextChangeAt: '2099-01-01T00:00:00.000Z', limitsPerPeriod: { market: { maxOrderFiatValue: '100000' } } },
          })),
        },
        now: () => Date.now(),
      }
    }

    it('bayrak ACIK + hazir kullanici: yanit feePreview ats + quotedAtsRaw; prepare owner/chainId ile', async () => {
      await boot()
      aga()
      rt.prepare.mockResolvedValue({
        isEvm: true, status: { ready: true, mode: 'normal' }, balanceRaw: '10000000000000000000', quotedFeeRaw: ATS_1, decimals: 18,
      })
      const res = await send({ type: 'COW_QUOTE', message: teklifMsg() })
      expect(res).toMatchObject({ success: true, locked: false })
      expect(res.feePreview).toEqual({ mode: 'ats', quotedAtsRaw: ATS_1, decimals: 18, hint: false, lowNetworkFee: expect.any(Boolean) })
      expect(rt.prepare).toHaveBeenCalledWith({ owner: HESAP, chainId: 56 })
    })

    it('ucret bayragi KAPALI: ayni teklif feePreview none, prepare cagrilmaz', async () => {
      await boot({ ucret: false })
      aga()
      const res = await send({ type: 'COW_QUOTE', message: teklifMsg() })
      expect(res).toMatchObject({ success: true })
      expect(res.feePreview).toMatchObject({ mode: 'none', quotedAtsRaw: null })
      expect(rt.prepare).not.toHaveBeenCalled()
    })
  })
})
