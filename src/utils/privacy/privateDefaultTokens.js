// GIZLI HESAP YEREL TOKEN TOHUMU ve yerel coin satiri uretici (gizli-mod cok-ag spec 4.7 "Varsayilan token tohumu
// (P12)", E16).
//
// NEDEN: normal hesaplarin tohumu sunucudan gelir (`GET /getImportedTokens`, utils/defaultTokenSeed.js) ve
// {1: [ETH, USDT], 56: [ATS, BNB]} doner: Gizli Hesap icin bu hem bir istek (IP) hem de Ethereum'u HER 10 sn
// sorgulatan bir kova demekti. Gizli Hesap'in kovasi artik YEREL tohumlanir: {'56': [BNB, USDC, ATS]}, ag istegi YOK,
// Ethereum tohumu YOK. Satirlar yerel logo tasir (/chains/56.png, /usdc.png, /ats.png) ve `coingecko_id: null`
// (fiyat istekleri ozel modda kapali).
//
// IDEMPOTENT ve DAR: `imported_tokens[hesap]` icinde '56' dizisi varsa (bos dizi dahil: kullanici hepsini
// silmis olabilir) hicbir sey yazilmaz; yoksa YALNIZ bu hesabin kovasina '56' eklenir, baska zincir anahtarina
// ve baska hesaba dokunulmaz. Eski sunucu tohumu olan gelistirme profilleri icin goc YOKTUR (ozellik magazada
// karanlik). Basarisizlik ASLA firlatmaz: `failed` doner ve sonraki yukleme yeniden dener.
//
// BSC USDC adresi/ondaligi ve USDC logosu teslim tablolarindan okunur (deliveryChains.js, deliveryTokens.js: Dilim C
// ile geldi); burada kopya sabit YOKTUR. Iki modul da saf ve SDK'siz oldugu icin popup paketine girmeleri guvenlidir.
//
// Popup paketine girer: SDK, silentswap.js ve privateOrderExec.js import ETMEZ (privatePopupImports.test.js).
import { buildNativeToken } from '../nativeToken'
import { ATS_CHAINS } from '../atsConfig'
import { deliveryChainOf } from './deliveryChains'
import { USDC_LOGO } from './deliveryTokens'
import { nativeCoinLogo } from './privateCoinLogo'

// Tohum zinciri: BSC (Para yukle / ATS kapisi hep orada). Anahtar `imported_tokens` kova anahtaridir.
export const PRIVATE_SEED_CHAIN_ID = 56
const SEED_CHAIN_KEY = String(PRIVATE_SEED_CHAIN_ID)
const BSC_SLUG = 'binance-smart-chain'

const localImage = (path) => ({ thumb: path, small: path, large: path })

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Bir ag icin YEREL coin satiri: `buildNativeToken` (agsiz) uzerine `coingecko_id: null` ve YEREL COIN logosu
 * (privateCoinLogo.js: ETH hangi ETH agi olursa olsun ETH logosu, L2 zincir logosu degil; xDAI kendi logosu). Cozulemeyen ag (Solana, bilinmeyen kimlik) icin null. Gizli Hesap EVM-yalnizdir: EVM disi
 * aglar icin bu islev CAGRILMAZ. Adres `'0x0'`dir; native eslemesi `isNativeAsset` ile yapilir (sunucu satirlari
 * sifir adres kullanir, uretici '0x0').
 */
export function privateNativeRow(chainId) {
    const base = buildNativeToken(chainId)
    if (!base) return null
    return { ...base, coingecko_id: null, image: localImage(nativeCoinLogo(base.chainId, base.symbol)) }
}

/** Tohum satirlari, sirayla: BNB (yerel coin), USDC, ATS. Her cagri TAZE nesneler doner. */
export function privateSeedRows() {
    const ats = ATS_CHAINS[PRIVATE_SEED_CHAIN_ID].token
    const bsc = deliveryChainOf(PRIVATE_SEED_CHAIN_ID)
    return [
        privateNativeRow(PRIVATE_SEED_CHAIN_ID),
        {
            name: 'USD Coin',
            symbol: 'USDC',
            address: bsc.usdcAddress,
            decimals: bsc.usdcDecimals,
            chain: BSC_SLUG,
            coingecko_id: null,
            image: localImage(USDC_LOGO),
        },
        {
            name: 'Alltoscan',
            symbol: 'ATS',
            address: ats.address,
            decimals: ats.decimals,
            chain: BSC_SLUG,
            coingecko_id: null,
            image: localImage('/ats.png'),
        },
    ]
}

export const PRIVATE_SEED_STATUS = Object.freeze({
    HEALTHY: 'healthy', // kova zaten tohumlu: yazim yok
    SEEDED: 'seeded',   // '56' yerel olarak yazildi
    FAILED: 'failed',   // hicbir sey yazilmadi; sonraki yukleme yeniden dener
})

async function seed(accountKey, storage) {
    try {
        const { imported_tokens: stored } = await storage.get('imported_tokens')
        const all = isPlainObject(stored) ? stored : {}
        const current = isPlainObject(all[accountKey]) ? all[accountKey] : null
        if (current && Array.isArray(current[SEED_CHAIN_KEY])) return { status: PRIVATE_SEED_STATUS.HEALTHY }

        const next = { ...(current ?? {}), [SEED_CHAIN_KEY]: privateSeedRows() }
        await storage.set({ imported_tokens: { ...all, [accountKey]: next } })
        return { status: PRIVATE_SEED_STATUS.SEEDED }
    } catch {
        return { status: PRIVATE_SEED_STATUS.FAILED }
    }
}

const inFlight = new Map()

/**
 * Gizli Hesap kovasi tohumsuzsa YEREL tohumu yazar. ASLA firlatmaz, AG ISTEGI YOKTUR.
 * Ayni hesap icin eszamanli cagrilar (App acilisi + Home yuklemesi) TEK ise iner.
 *
 * @param {string} accountKey `active_account.key`
 * @returns {Promise<{ status: 'healthy' | 'seeded' | 'failed' }>}
 */
export function ensurePrivateDefaultTokens(accountKey, { storage = globalThis.chrome?.storage?.local } = {}) {
    if (typeof accountKey !== 'string' || !accountKey || !storage) {
        return Promise.resolve({ status: PRIVATE_SEED_STATUS.FAILED })
    }

    const running = inFlight.get(accountKey)
    if (running) return running

    const job = seed(accountKey, storage).finally(() => {
        if (inFlight.get(accountKey) === job) inFlight.delete(accountKey)
    })
    inFlight.set(accountKey, job)
    return job
}
