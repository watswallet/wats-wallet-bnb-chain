// WalletConnect QA harness'i -- atilabilir kasa tohumlama (spec bolum 12, S3).
//
// Onboarding'in CreateUsername adimi URETIM sunucusuna yazar ve HIC CALISTIRILMAZ. Bunun
// yerine kasa, cuzdanin KENDI saf kripto modulu (`src/utils/crypto-utils.js`) ile Node'da
// uretilir ve eklentinin depolamasina CDP ile yazilir; kilit GERCEK Login ekranindan acilir.
//
// GUVENLIK: her kosuda RASTGELE mnemonic ve rastgele parola uretilir; bellekte kalir, ASLA
// diske/kanita/gunluge yazilmaz (yalniz adresler). Hicbir fon yoktur; atilabilir tohum.
//
// crypto-utils.js uzantisiz iceri aktarmalar kullanir (./ton/tonMnemonic) ve duz Node ESM
// bunlari cozemez; bu yuzden vite'in SSR yukleyicisi kullanilir (client/node_modules/vite).
import { randomBytes } from 'node:crypto'
import { createServer } from 'vite'
import { Wallet, HDNodeWallet } from 'ethers'

// Vite SSR yukleyicisi: istemci modullerini (JS/TS, uzantisiz import) Node'da yukler.
// cacheDir istemci agacinin DISINDA tutulur (WT'de `node_modules/.vite` yazilmasin).
export async function createClientLoader({ clientRoot, cacheDir }) {
  const vite = await createServer({
    root: clientRoot,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    cacheDir,
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  return { load: (path) => vite.ssrLoadModule(path), close: () => vite.close() }
}

const rand = (n) => randomBytes(n).toString('hex')

// accountCount hesap AYNI kasaya eklenir (hesap-degistirme vakasi icin >= 2).
// Hesap nesnesi CreatePassword.vue create() / CreateAccount.vue ile AYNI sekilde.
export async function createSeedPlan({ loader, accountCount = 2 }) {
  const cu = await loader.load('/src/utils/crypto-utils.js')
  const uq = await loader.load('/src/utils/uniqueKey.js')
  const wallet = Wallet.createRandom()
  const mnemonic = wallet.mnemonic.phrase
  const password = `qa-${rand(9)}-Zz9!`
  const salt = randomBytes(32)
  const masterKey = await cu.deriveMasterKey(password, new Uint8Array(salt))

  const makeAccount = (index) => {
    const path = `m/44'/60'/0'/0/${index}`
    const w = HDNodeWallet.fromPhrase(mnemonic, '', path)
    return {
      name: index === 0 ? 'Wats 1' : `Wats ${index + 1}`,
      type: 'hd',
      derivationPath: path,
      index,
      address: w.address,
      createdAt: new Date().toISOString(),
      key: uq.uniqueKey(),
    }
  }
  const first = makeAccount(0)
  // createVault ilk hesabi `fingerprint` ile damgalar ve `accounts: [first]` yazar.
  const vault = await cu.createVault(masterKey, mnemonic, first)
  const accounts = [first]
  for (let i = 1; i < accountCount; i += 1) {
    const acc = makeAccount(i)
    acc.fingerprint = vault.fingerprint
    vault.accounts.push(acc)
    accounts.push(acc)
  }
  // Depolamaya yazilacak tek paket. `walletSalt` ethers.hexlify ile AYNI bicim (0x onekli).
  const storage = {
    walletSalt: `0x${salt.toString('hex')}`,
    vaults: [vault],
    active_account: first,
    language: 'en',
  }
  return {
    password,
    storage,
    accounts,
    // Kanita/gunluge girebilecek TEK gorunum: yalniz adresler.
    redacted: () => ({ accounts: accounts.map((a) => ({ name: a.name, address: a.address, index: a.index })), vaultId: vault.id }),
    // Kilidi test icin dogrular (Login ekranindan ONCE hizli saglik kontrolu).
    verify: async () => (await cu.unlockVault(masterKey, vault)) === mnemonic,
    // Hesap-2 olusturma yedegi (F8 varyanti, UI yolu calismazsa): CreateAccount.vue'nun yazdigi
    // sekilde yeni HD hesap uretir ve {vaults, active_account} paketini dondurur.
    // `base` (istege bagli): onceki bir nextAccount().vaults[0]; verilirse ONUN uzerine bir hesap daha eklenir
    // (F8 varyanti B ikinci bir sessiz hesap ister). Verilmezse ilk kasanin uzerine ekler (eski davranis).
    nextAccount: (base = vault) => {
      const acc = makeAccount(base.accounts.length)
      acc.fingerprint = vault.fingerprint
      const nextVault = { ...base, accounts: [...base.accounts, acc] }
      return { account: acc, vaults: [nextVault], active_account: acc }
    },
    // Test imza dogrulamasi icin viem/ethers ile adres eslemesi (yalniz adres, anahtar DEGIL).
    signerFor: (address) => {
      const acc = accounts.find((a) => a.address.toLowerCase() === String(address).toLowerCase())
      if (!acc) return null
      return HDNodeWallet.fromPhrase(mnemonic, '', acc.derivationPath)
    },
  }
}

// SW baglaminda chrome.storage.local'i yazar. `getSw()` -> guncel SW oturumu (SW yeniden baslarsa
// oturum degisir). SW'de `chrome.storage` hazir olana kadar bekler (baslangic yarisi, 2026-10-05 olcumu:
// bazen "Cannot read properties of undefined (reading 'local')").
export async function seedExtension(getSw, seed) {
  let sw = null
  const end = Date.now() + 30000
  for (;;) {
    sw = getSw()
    try {
      if (sw && (await sw.evaluate(`typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local`, { timeout: 5000 }))) break
    } catch { /* yeniden dene */ }
    if (Date.now() > end) throw new Error('uzanti service worker icinde chrome.storage hazir olmadi (30 sn)')
    await new Promise((r) => setTimeout(r, 300))
  }
  await sw.evaluate(`chrome.storage.local.set(${JSON.stringify(seed.storage)}).then(() => 'seeded')`)
  const keys = await sw.evaluate(`chrome.storage.local.get(null).then((o) => Object.keys(o).sort().join(','))`)
  for (const k of ['active_account', 'language', 'vaults', 'walletSalt']) {
    if (!String(keys).split(',').includes(k)) throw new Error(`tohumlama eksik: ${k} yok (anahtarlar: ${keys})`)
  }
  return keys
}

// GERCEK Login ekranindan kilidi acar (popup sayfasi; `page.evaluate`/`page.waitFor`).
export async function unlockViaLogin(page, password) {
  await page.waitFor(`!!document.getElementById('login-password')`, { timeout: 30000, label: 'login-password alani' })
  await page.evaluate(`(() => {
    const i = document.getElementById('login-password')
    i.focus()
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(i, ${JSON.stringify(password)})
    i.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await page.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Unlock' && !b.disabled)`, { timeout: 10000, label: 'Unlock dugmesi hazir' })
  await page.evaluate(`(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Unlock').click(); return true })()`)
  await page.waitFor(`!document.getElementById('login-password')`, { timeout: 60000, label: 'Login ekrani kapandi (kilit acildi)' })
  const state = await page.evaluate(`chrome.runtime.sendMessage({ type: 'CHECK_UNLOCK' })`)
  if (!state || state.unlocked !== true) throw new Error(`kilit acilmadi: CHECK_UNLOCK -> ${JSON.stringify(state)}`)
  return state
}

// ---------------------------------------------------------------------------
// Kendi kendini sinama: kasa uretilir, ayni kripto modulu ile geri acilir, hicbir sir sizmaz.
// ---------------------------------------------------------------------------
export async function selfTest({ clientRoot, cacheDir }) {
  const assert = (await import('node:assert/strict')).default
  const loader = await createClientLoader({ clientRoot, cacheDir })
  try {
    const seed = await createSeedPlan({ loader, accountCount: 2 })
    assert.equal(await seed.verify(), true)
    assert.equal(seed.accounts.length, 2)
    assert.equal(seed.storage.vaults[0].accounts.length, 2)
    assert.equal(seed.accounts[0].fingerprint, seed.storage.vaults[0].fingerprint)
    assert.equal(seed.accounts[1].fingerprint, seed.storage.vaults[0].fingerprint)
    assert.ok(/^0x[0-9a-f]{64}$/.test(seed.storage.walletSalt))
    assert.equal(seed.storage.active_account.address, seed.accounts[0].address)
    assert.equal(seed.accounts[1].derivationPath, "m/44'/60'/0'/0/1")
    assert.equal(seed.signerFor(seed.accounts[1].address).address, seed.accounts[1].address)
    // gizlilik: kanit gorunumu mnemonic/parola/sifreli kasa ICERMEZ
    const shown = JSON.stringify(seed.redacted())
    assert.ok(!shown.includes(seed.password))
    assert.ok(!shown.includes(seed.storage.vaults[0].mnemonic))
    // ikinci kosu farkli tohum uretir
    const other = await createSeedPlan({ loader, accountCount: 1 })
    assert.notEqual(other.accounts[0].address, seed.accounts[0].address)
    const next = seed.nextAccount()
    assert.equal(next.account.index, 2)
    const third = seed.nextAccount(next.vaults[0])
    assert.equal(third.account.index, 3)
    assert.equal(third.vaults[0].accounts.length, 4)
    assert.notEqual(third.account.address, next.account.address)
    return 'seed-vault: tum sinama vakalari gecti'
  } finally {
    await loader.close()
  }
}
