// Islem sayaci DAVRANIS testleri: background.js GERCEKTEN calistirilir (harness
// background.analyticsCounts.test.js ten). Kaynak taramasi degil: mesaj gonderilir, sayac
// deposuna (analytics_counts) bakilir. Sinanan: Gonder `countAs:'transfer'` ile +1, Dapp yolu
// (countAs yok) 0; takas basarisi +1 ve onay adimi AYRI sayilmaz; kopru basarisi +1;
// basarisiz islem 0. Ag/zincir hicbir yerde yok: ethers saglayicisi bos sinif, imza+yayin,
// takas, kopru ve ATS paymaster mock'lanir.
import { describe, it, expect, vi } from 'vitest'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'
import { BRIDGE_QUOTES_KEY, bridgeQuoteKey } from './utils/bridgeQuoteGuard'
import supported_chains from './data/supported_chains.json'

vi.mock('./utils/featureFlags', async (importOriginal) => ({
  ...(await importOriginal()),
  get XSTOCKS_ENABLED() { return true },
  get ANALYTICS_ENABLED() { return true },
}))

const h = vi.hoisted(() => ({
  sendTx: vi.fn(),
  executeSwap: vi.fn(),
  buildSwapCalls: vi.fn(),
  crossChainSwap: vi.fn(),
  buildBridgeCalls: vi.fn(),
  executeAts: vi.fn(),
}))

vi.mock('ethers', async (importOriginal) => {
  const real = await importOriginal()
  // Ag yok: saglayici bos sinif; imza sahibinin sendTransaction'i mock'a gider.
  real.HDNodeWallet.prototype.sendTransaction = (...a) => h.sendTx(...a)
  real.Wallet.prototype.sendTransaction = (...a) => h.sendTx(...a)
  return { ...real, ethers: { ...real.ethers, JsonRpcProvider: class {} }, JsonRpcProvider: class {} }
})
vi.mock('./utils/swap', () => ({
  MultiChainSwapManager: class {
    executeSwap(...a) { return h.executeSwap(...a) }
    buildSwapCalls(...a) { return h.buildSwapCalls(...a) }
  },
}))
vi.mock('./utils/bridge', async (importOriginal) => ({
  ...(await importOriginal()),
  crossChainSwap: (...a) => h.crossChainSwap(...a),
  buildBridgeCalls: (...a) => h.buildBridgeCalls(...a),
}))
vi.mock('./utils/atsPaymaster', async (importOriginal) => ({
  ...(await importOriginal()),
  executeAtsTransfer: (...a) => h.executeAts(...a),
}))
vi.mock('./utils/processTransaction', async (importOriginal) => ({
  ...(await importOriginal()),
  buildPendingSkeleton: () => ({ id: 'p1' }),
  saveOrUpdateTxInStorage: vi.fn(async () => {}),
  watchTransactionResolution: () => new Promise(() => {}),
}))

// Kasa: gercek BIP-39 ifadesi (hardhat #0); m/44'/60'/0'/0/0 -> HESAP.
const MNEMONIC = 'test test test test test test test test test test test junk'
vi.mock('./utils/crypto-utils', () => ({ unlockVault: vi.fn(async () => MNEMONIC), decryptSecret: vi.fn() }))

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const BSC = supported_chains.find((c) => c.chainId === 56)
const HESAP = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

let messageListener
let sessionStore
let localStore
let onChangedListeners

function installChromeStub() {
  const listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [] }
  const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })
  onChangedListeners = []
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
      onChanged: { addListener: (fn) => onChangedListeners.push(fn) },
      local: {
        get: vi.fn(async (keys) => {
          const wanted = keys === undefined ? Object.keys(localStore) : (Array.isArray(keys) ? keys : [keys])
          return Object.fromEntries(wanted.map((k) => [k, localStore[k]]))
        }),
        set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
        remove: vi.fn(async (k) => { for (const key of [].concat(k)) delete localStore[key] }),
      },
      session: {
        get: vi.fn(async () => sessionStore),
        set: vi.fn(async (obj) => { Object.assign(sessionStore, obj) }),
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
  return new Promise((resolve) => {
    const returned = messageListener(message, sender, (v) => resolve(v))
    if (returned !== true) resolve(undefined)
  })
}
const send = (message, sender) => callHandler(message, sender)

const flush = () => new Promise((r) => setTimeout(r, 0))
const bekle = async (kosul) => {
  for (let i = 0; i < 50 && !kosul(); i++) await flush()
}

async function boot({ depo = {} } = {}) {
  vi.resetModules()
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
  localStore = {
    active_account: { key: 'k1', type: 'hd', index: 0, derivationPath: "m/44'/60'/0'/0/0", address: HESAP },
    vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: HESAP }] }],
    currentNetwork: BSC,
    dapps: {},
    current_transactions: [],
    analytics_enabled: true, // onay modeli: kayit yok = KAPALI; testler kabul edilmis varsayar
    ...depo,
  }
  const listeners = installChromeStub()
  globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
  await import('./background.js')
  messageListener = listeners.onMessage[0]
}

const SAYAC = 'analytics_counts'
const sayac = async () => { await flush(); await flush(); return localStore[SAYAC] }

heavyBackgroundTimeouts()

const HASH = '0x' + 'ab'.repeat(32)
const sonsuz = () => new Promise(() => {})
const ILK = '0x' + '11'.repeat(20)
const IKI = '0x' + '22'.repeat(20)

const gonder = (extra = {}) => ({
  type: 'SEND_TRANSACTION',
  message: { tx: { to: IKI, value: '0x0', data: '0x' }, amount: '1', chainId: 56, ...extra },
})
const takas = (extra = {}) => ({
  type: 'SWAP',
  message: { chainId: 56, inTokenAddress: ILK, outTokenAddress: IKI, amount: '1', slippage: 1, ...extra },
})
const kopru = (extra = {}) => ({
  type: 'BRIDGE',
  message: { to: IKI, from: ILK, data: '0x', value: '0', chain: 56, toChain: 1, amount: '1', amount_raw: '1', ...extra },
})

describe('SEND_TRANSACTION sayimi', () => {
  it("countAs:'transfer' ile transfer +1", async () => {
    await boot()
    h.sendTx.mockResolvedValue({ hash: HASH })
    const r = await send(gonder({ countAs: 'transfer' }))
    expect(r).toEqual({ success: true, hash: HASH })
    expect(await sayac()).toEqual({ transfer: 1 })
  })

  it('countAs OLMADAN (Dapp yolu) 0', async () => {
    await boot()
    h.sendTx.mockResolvedValue({ hash: HASH })
    const r = await send(gonder())
    expect(r).toEqual({ success: true, hash: HASH })
    expect(await sayac()).toBeUndefined()
  })

  it("countAs baska bir deger ('swap') transfer SAYMAZ", async () => {
    await boot()
    h.sendTx.mockResolvedValue({ hash: HASH })
    await send(gonder({ countAs: 'swap' }))
    expect(await sayac()).toBeUndefined()
  })

  it('yayin basarisiz -> 0', async () => {
    await boot()
    h.sendTx.mockRejectedValue(new Error('insufficient funds'))
    const r = await send(gonder({ countAs: 'transfer' }))
    expect(r.error).toBeTruthy()
    expect(await sayac()).toBeUndefined()
  })

  it('ATS yolu: hash alininca transfer +1, ATS hata verirse 0', async () => {
    await boot()
    h.executeAts.mockResolvedValue({ hash: '0xop', txHash: HASH })
    await send(gonder({ countAs: 'transfer', atsTransfer: true, atsQuoted: {} }))
    expect(await sayac()).toEqual({ transfer: 1 })
    await boot()
    h.executeAts.mockRejectedValue(new Error('ats revert'))
    const r = await send(gonder({ countAs: 'transfer', atsTransfer: true, atsQuoted: {} }))
    expect(r.error).toBeTruthy()
    expect(await sayac()).toBeUndefined()
  })
})

describe('SWAP sayimi', () => {
  it('basari -> swap +1', async () => {
    await boot()
    h.executeSwap.mockResolvedValue({ hash: HASH, waitPromise: sonsuz() })
    expect(await send(takas())).toEqual({ success: true, hash: HASH })
    expect(await sayac()).toEqual({ swap: 1 })
  })

  it('onay (approve) adimi + takas adimi TEK swap sayilir (ATS iki adimli islem)', async () => {
    await boot()
    h.buildSwapCalls.mockResolvedValue({ calls: [] })
    h.executeAts.mockImplementation(async ({ onProgress }) => {
      onProgress({ step: 1, total: 2, kind: 'approve' })
      onProgress({ step: 2, total: 2, kind: 'swap' })
      return { hash: '0xop', txHash: HASH }
    })
    const r = await send(takas({ atsSwap: true, atsQuoted: {} }))
    expect(r.success).toBe(true)
    expect(h.executeAts).toHaveBeenCalledTimes(1)
    expect(await sayac()).toEqual({ swap: 1 })
  })

  it('basarisiz takas -> 0', async () => {
    await boot()
    h.executeSwap.mockRejectedValue(new Error('slippage'))
    const r = await send(takas())
    expect(r.error).toBeTruthy()
    expect(await sayac()).toBeUndefined()
  })

  it('SWAP_QUOTE (teklif) SAYILMAZ', async () => {
    await boot()
    await send({ type: 'SWAP_QUOTE', message: { chainId: 56, inTokenAddress: ILK, outTokenAddress: IKI, amount: '1', slippage: 1 } })
    expect(await sayac()).toBeUndefined()
  })
})

describe('BRIDGE sayimi', () => {
  it('basari -> bridge +1', async () => {
    await boot()
    h.crossChainSwap.mockResolvedValue({ hash: HASH, waitPromise: sonsuz() })
    // Kopru alici korumasi (P10): BRIDGE, getBridgeQuote'un yazdigi teklif kaydini ister; kayit oturum deposunda
    // bu cuzdan (HESAP) icin hazir bulunur.
    sessionStore[BRIDGE_QUOTES_KEY] = {
      [bridgeQuoteKey(56, IKI, '0x', '0')]: { signer: HESAP, approval: IKI, createdAt: Date.now() },
    }
    expect((await send(kopru())).success).toBe(true)
    expect(await sayac()).toEqual({ bridge: 1 })
  })

  it('basarisiz kopru -> 0', async () => {
    await boot()
    h.crossChainSwap.mockRejectedValue(new Error('lifi'))
    const r = await send(kopru())
    expect(r.success).toBe(false)
    expect(await sayac()).toBeUndefined()
  })
})

describe('kapatma service worker uzerinden', () => {
  it('analytics_enabled false olunca (storage.onChanged) sayac ve kimlik silinir', async () => {
    await boot({ depo: { analytics_counts: { swap: 2 }, analytics_state: { installId: 'x' } } })
    expect(onChangedListeners.length).toBeGreaterThan(0)
    localStore.analytics_enabled = false
    for (const fn of onChangedListeners) fn({ analytics_enabled: { newValue: false } }, 'local')
    await bekle(() => localStore.analytics_counts === undefined)
    expect(localStore.analytics_counts).toBeUndefined()
    expect(localStore.analytics_state).toBeUndefined()
  })

  it('baska anahtar degisince ya da deger true iken silinmez', async () => {
    await boot({ depo: { analytics_counts: { swap: 2 }, analytics_state: { installId: 'x' } } })
    for (const fn of onChangedListeners) {
      fn({ analytics_enabled: { newValue: true } }, 'local')
      fn({ vaults: { newValue: [] } }, 'local')
    }
    await flush(); await flush()
    expect(localStore.analytics_counts).toEqual({ swap: 2 })
  })
})
