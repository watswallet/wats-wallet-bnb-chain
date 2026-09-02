// Bundler proxy icin kisa omurlu bearer token. Cuzdan EOA'si bir mesaj imzalar (EIP-191);
// sunucu /bundler/auth ile dogrulayip JWT doner. Token adres bazli cache'lenir
// (in-memory hizli yol + chrome.storage.session: SW restart'a dayanir, diske YAZILMAZ).
// Suresi dolmadan SKEW_S kadar once yenilenir -> akis ortasinda 401 olmaz.
import axios from 'axios'

const SKEW_S = 60
const cache = new Map() // address(lower) -> { token, exp(saniye) }

function randomNonce() {
  const a = new Uint8Array(16)
  globalThis.crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

function fresh(entry) {
  return !!entry && typeof entry.exp === 'number' && entry.exp - SKEW_S > Math.floor(Date.now() / 1000)
}

async function readStored(addr) {
  try {
    const { bundlerTokens } = await chrome.storage.session.get('bundlerTokens')
    return (bundlerTokens && bundlerTokens[addr]) || null
  } catch { return null }
}

async function writeStored(addr, entry) {
  try {
    const { bundlerTokens } = await chrome.storage.session.get('bundlerTokens')
    await chrome.storage.session.set({ bundlerTokens: { ...(bundlerTokens || {}), [addr]: entry } })
  } catch { /* session storage yoksa yalnizca in-memory */ }
}

// signer: ethers Wallet/HDNodeWallet (.address + .signMessage). bundlerBase: proxy koku.
export async function getBundlerToken({ signer, bundlerBase }) {
  const addr = String(signer.address).toLowerCase()

  if (fresh(cache.get(addr))) return cache.get(addr).token
  const stored = await readStored(addr)
  if (fresh(stored)) { cache.set(addr, stored); return stored.token }

  const timestamp = Date.now()
  const nonce = randomNonce()
  const message = `watswallet-bundler-auth:${addr}:${timestamp}:${nonce}`
  const signature = await signer.signMessage(message)

  const { data } = await axios.post(`${bundlerBase}/bundler/auth`, { address: addr, timestamp, nonce, signature })
  if (!data || !data.success || !data.token) throw new Error((data && data.error) || 'bundler auth failed')

  const entry = { token: data.token, exp: data.exp }
  cache.set(addr, entry)
  await writeStored(addr, entry)
  return data.token
}

// Test / hesap degisimi icin cache temizleme (yalnizca in-memory).
export function _clearBundlerTokenCache() { cache.clear() }

// Cuzdan kilitlenince cagrilir: hem in-memory hem chrome.storage.session token'larini siler.
export async function clearBundlerTokens() {
  cache.clear()
  try { await chrome.storage.session.remove('bundlerTokens') } catch { /* session yoksa yok say */ }
}
