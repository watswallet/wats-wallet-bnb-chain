// NORMAL MODDA TOKEN LOGOSU: TEK COZUCU (sahip karari 2026-11-03: "logosuz hicbir yer gormek istemiyorum, her seyin logosu tam olacak").
// Saf katman: ag yok, depo yok, `ethers` yok (47 test `ethers`i kismen taklit ediyor; bu modul onlari kirmasin diye checksum'u kendi
// keccak'iyle hesaplar, dogrulugu ethers.getAddress ile test edilir).
//
// SIRA (ilk bulunan kazanir; <img> hata verince bir sonrakine, sonuncu da hata verirse tokenin MONOGRAMI cizilir, gri yer tutucu ASLA):
//   1) PAKETLI dosya: (ag, sozlesme adresi) client/public/tokens altinda (gizli modun 542 logosu, localTokenLogos.js), agin USDC'si /usdc.png,
//      ATS /ats.png. Yerel coinin logosu COININ logosudur: ETH hangi L2'de olursa olsun ETH elmasi (/chains/1.png), L2 logosu degil; xDAI = Gnosis
//      sifir adres dosyasi; BNB/POL/CELO/MNT/CRO/SOL kendi agi ile ayni dosya.
//   2) UZAK gorsel: uygulamanin normal modda zaten kullandigi kaynaklar -- sunucu `image` (dize ya da large/small/thumb), `logoURI`, `logo`, `iconUrl`.
//   3) Trust Wallet varlik deposu: ag + CHECKSUM adres (raw.githubusercontent.com/trustwallet/assets). CSP karari: eklenti sayfalari CSP'sinde
//      `img-src` ve `default-src` YOK (manifest.config.js: yalniz script-src/object-src/frame-ancestors/connect-src), yani <img> her https kaynagina
//      zaten serbest ve host_permissions <all_urls>; gaslessConfig.tokenLogoURI ayni hosta zaten gidiyor. Manifest degismez.
//   4) hicbiri: bos dizi -> cagiran monogram cizer (ya da secici/arama listesinde satiri gizler: tokenLogoState.js).
//
// GIZLI MOD: bu cozucu gizli modun cozucusu DEGILDIR (o utils/privacy/privateTokenLogo.js, degismedi). Paylasilan bilesenler gizli moda dusse bile
// `localLogosOnly()` anahtari (tokenLogo.js, installPrivacySync cevirir) acikken yalniz yerel kaynaklar doner: uzak gorsel ve Trust Wallet YOK.

import { localTokenLogoPath } from './privacy/localTokenLogos'
import { DELIVERY_CHAINS } from './privacy/deliveryChains'
import { isNativeAsset } from './nativeAsset'
import { ATS_CHAINS, ATS_LOGO_URI } from './atsConfig'
import { chainLogo } from './chainLogo'
import { localLogosOnly } from './tokenLogo'
import { SOLANA_CHAIN_ID } from './solana/constants'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const USDC_LOGO = '/usdc.png'
const TRUST_BASE = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/'

// Yer tutucu dosyalar logo DEGILDIR: veri uretenler (useSolanaAssets, nativeToken) ve eski kayitlar bunlari `image`a damgalayabilir; cozucu
// onlari "logo yok" sayar ki satir gri yer tutucu yerine sonraki kaynaga / monograma dussun.
const PLACEHOLDER = /(^|\/)default-(token|dapp|chain)\.png(\?.*)?$/i
export const isLogoPlaceholder = (url) => typeof url === 'string' && PLACEHOLDER.test(url.trim())

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

// Kabul edilen adaylar: https/http, ayni kaynak yolu (`/x`, `//x` degil) ve data:image. Gizli mod anahtari aciksa yalniz yerel yol.
function accept(v) {
    const d = text(v)
    if (d === null || isLogoPlaceholder(d)) return null
    const local = d.startsWith('/') && !d.startsWith('//')
    if (local) return d
    if (localLogosOnly()) return null
    return /^(https?:\/\/|data:image\/)/i.test(d) ? d : null
}

// ---- yerel coin logolari ---------------------------------------------------------------------------------------------------------
// Coin sembolu -> coinin "evi" agi; dosya o aginin logosudur (ETH'in evi Ethereum: L2 logolari ETH degildir). xDAI Gnosis sifir adres dosyasidir.
const COIN_HOME_CHAIN = Object.freeze({ ETH: 1, BNB: 56, POL: 137, MATIC: 137, CELO: 42220, MNT: 5000, CRO: 25 })

/** Coin sembolunun paketli logosu (ag bilinmese de); yoksa null. */
export function coinLogoOfSymbol(symbol) {
    const sym = text(symbol)?.toUpperCase()
    if (!sym) return null
    if (Object.hasOwn(COIN_HOME_CHAIN, sym)) return chainLogo(COIN_HOME_CHAIN[sym], null)
    if (sym === 'XDAI') return localTokenLogoPath(100, ZERO_ADDRESS)
    return null
}

const idOf = (chainId) => {
    const n = Number(chainId)
    return chainId !== null && chainId !== undefined && chainId !== '' && Number.isInteger(n) ? n : null
}

/** Bir agin yerel coininin paketli logosu: once (ag, sifir adres) dosyasi, sonra coin sembolu, sonra agin kendi logosu. */
export function nativeCoinLogo(chainId, symbol) {
    const id = idOf(chainId)
    if (id !== null) {
        const exact = localTokenLogoPath(id, ZERO_ADDRESS)
        if (exact) return exact
    }
    // Sembol yoksa agin kendi coini (Base'te ETH): L2 logosuna dusmek yanlis coini gosterirdi.
    const bySymbol = coinLogoOfSymbol(text(symbol) ?? (id === null ? null : nativeSymbolOf.get(id)))
    if (bySymbol) return bySymbol
    return chainLogo(chainId, null)
}

const usdcOf = new Map(DELIVERY_CHAINS.map((c) => [c.chainId, c.usdcAddress.toLowerCase()]))
const nativeSymbolOf = new Map(DELIVERY_CHAINS.map((c) => [c.chainId, c.nativeSymbol]))

// ---- Trust Wallet -------------------------------------------------------------------------------------------------------------
const TRUST_CHAIN = Object.freeze({
    1: 'ethereum', 56: 'smartchain', 137: 'polygon', 10: 'optimism', 42161: 'arbitrum', 8453: 'base', 100: 'xdai', 42220: 'celo',
    25: 'cronos', 5000: 'mantle', 43114: 'avalanchec', 250: 'fantom', 59144: 'linea', 324: 'zksync', 534352: 'scroll', 81457: 'blast',
})

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/
const SOLANA_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

// Keccak-256 (SHA3 DEGIL: dolgu 0x01). Tek blok yeter (girdi 40 bayt). BigInt satirlari.
const MASK = (1n << 64n) - 1n
const rotl = (x, n) => (((x << n) | (x >> (64n - n))) & MASK)
const RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
    0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
    0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
]
const ROTC = [1n, 3n, 6n, 10n, 15n, 21n, 28n, 36n, 45n, 55n, 2n, 14n, 27n, 41n, 56n, 8n, 25n, 43n, 62n, 18n, 39n, 61n, 20n, 44n]
const PILN = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1]

function keccakF(st) {
    const bc = new Array(5)
    for (let round = 0; round < 24; round++) {
        for (let i = 0; i < 5; i++) bc[i] = st[i] ^ st[i + 5] ^ st[i + 10] ^ st[i + 15] ^ st[i + 20]
        for (let i = 0; i < 5; i++) {
            const t = bc[(i + 4) % 5] ^ rotl(bc[(i + 1) % 5], 1n)
            for (let j = 0; j < 25; j += 5) st[j + i] ^= t
        }
        let t = st[1]
        for (let i = 0; i < 24; i++) {
            const j = PILN[i]
            const b = st[j]
            st[j] = rotl(t, ROTC[i])
            t = b
        }
        for (let j = 0; j < 25; j += 5) {
            for (let i = 0; i < 5; i++) bc[i] = st[j + i]
            for (let i = 0; i < 5; i++) st[j + i] ^= ((~bc[(i + 1) % 5]) & MASK) & bc[(i + 2) % 5]
        }
        st[0] ^= RC[round]
    }
}

// 40 karakterlik kucuk harf hex adresin (0x'siz) keccak-256 ozetinin ilk 20 bayti, 40 hex hane.
function keccakHex40(lowerHex) {
    const block = new Uint8Array(136)
    for (let i = 0; i < lowerHex.length; i++) block[i] = lowerHex.charCodeAt(i)
    block[lowerHex.length] ^= 0x01
    block[135] ^= 0x80
    const st = new Array(25).fill(0n)
    for (let lane = 0; lane < 17; lane++) {
        let v = 0n
        for (let k = 7; k >= 0; k--) v = (v << 8n) | BigInt(block[lane * 8 + k])
        st[lane] = v
    }
    keccakF(st)
    let hex = ''
    for (let lane = 0; lane < 5; lane++) {
        for (let k = 0; k < 8; k++) hex += Number((st[lane] >> BigInt(8 * k)) & 0xffn).toString(16).padStart(2, '0')
    }
    return hex.slice(0, 40)
}

const checksumCache = new Map()
const CACHE_LIMIT = 4000

/** EIP-55 checksum'li adres; gecersiz girdi icin null. */
export function toChecksumAddress(address) {
    const a = text(address)
    if (a === null || !EVM_ADDRESS.test(a)) return null
    const lower = a.slice(2).toLowerCase()
    const hit = checksumCache.get(lower)
    if (hit) return hit
    const hash = keccakHex40(lower)
    let out = '0x'
    for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i]
    if (checksumCache.size >= CACHE_LIMIT) checksumCache.clear()
    checksumCache.set(lower, out)
    return out
}

/** Trust Wallet varlik deposundaki logo adresi; ag/adres desteklenmiyorsa null. */
export function trustWalletLogo(chainId, address) {
    if (String(chainId) === SOLANA_CHAIN_ID) {
        const mint = text(address)
        return mint !== null && SOLANA_MINT.test(mint) ? TRUST_BASE + 'solana/assets/' + mint + '/logo.png' : null
    }
    const id = idOf(chainId)
    const slug = id === null ? undefined : TRUST_CHAIN[id]
    if (!slug) return null
    const checksum = toChecksumAddress(address)
    return checksum === null ? null : TRUST_BASE + slug + '/assets/' + checksum + '/logo.png'
}

// ---- kaynak listesi ----------------------------------------------------------------------------------------------------------
const isNativeToken = (token) => token?.native === true || (typeof token?.address === 'string' && isNativeAsset(token.address))

function packagedSource(token, chainId) {
    const id = idOf(chainId)
    const symbol = text(token?.symbol)
    if (isNativeToken(token)) return nativeCoinLogo(chainId, symbol)
    if (id === null) return null
    const address = text(token?.address)?.toLowerCase()
    if (!address) return null
    const exact = localTokenLogoPath(id, address)
    if (exact) return exact
    if (usdcOf.get(id) === address) return USDC_LOGO
    const ats = ATS_CHAINS[id]?.token
    if (ats && typeof ats.address === 'string' && ats.address.toLowerCase() === address) return ATS_LOGO_URI
    return null
}

function remoteSources(token) {
    const out = []
    const im = token?.image
    if (typeof im === 'string') out.push(im)
    else if (im && typeof im === 'object') out.push(im.large, im.small, im.thumb)
    // `image` ONCE: API'nin TAZE verisi. `logoURI` cogunlukla diskteki ESKI kopyadir (tokenLogo.js ile ayni sira).
    out.push(token?.logoURI, token?.logo, token?.iconUrl)
    return out.map(accept).filter((v) => v !== null)
}

const chainOfToken = (token, chainId) => (chainId !== undefined && chainId !== null ? chainId : token?.chainId)

/**
 * Tokenin logo adaylari, ONCELIK sirasiyla (bos dizi = hicbir kaynak yok). Her zaman dizi doner, firlatmaz.
 * @param {object|null|undefined} token  { chainId?, address?, symbol?, native?, image?, logoURI?, logo?, iconUrl? }
 * @param {{chainId?: number|string}} [opts]  token kaydi chainId tasimiyorsa (ice aktarilmis kayitlar) aktif ag
 */
export function tokenLogoSources(token, { chainId } = {}) {
    if (!token || typeof token !== 'object') return []
    const cid = chainOfToken(token, chainId)
    const list = []
    const packaged = accept(packagedSource(token, cid))
    if (packaged) list.push(packaged)
    list.push(...remoteSources(token))
    if (!localLogosOnly() && !isNativeToken(token)) {
        const trust = trustWalletLogo(cid, token.address)
        if (trust) list.push(trust)
    }
    return [...new Set(list)]
}

/** Ucuz on kontrol (checksum hesaplamaz): en az bir kaynak adayi var mi? Listeleri suzmek icin. */
export function hasLogoSource(token, { chainId } = {}) {
    if (!token || typeof token !== 'object') return false
    const cid = chainOfToken(token, chainId)
    if (accept(packagedSource(token, cid))) return true
    if (remoteSources(token).length > 0) return true
    if (localLogosOnly() || isNativeToken(token)) return false
    const id = idOf(cid)
    if (String(cid) === SOLANA_CHAIN_ID) return SOLANA_MINT.test(text(token.address) ?? '')
    return id !== null && Object.hasOwn(TRUST_CHAIN, id) && EVM_ADDRESS.test(text(token.address) ?? '')
}
