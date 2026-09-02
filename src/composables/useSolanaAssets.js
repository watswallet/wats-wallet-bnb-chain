import { fetchSolanaAssets } from '../utils/solana/balances'
import { SOLANA_CHAIN_ID, SOL_NATIVE_MARKER } from '../utils/solana/constants'
import { fetchTokenMetadata } from '../utils/solana/tokenMetadata'
import supported_chains from '../data/supported_chains.json'

const SOLANA_CHAIN = supported_chains.find(c => c.chainId === SOLANA_CHAIN_ID)
const DEFAULT_TOKEN_IMAGE = '/default-token.png'

/** Metadata bulunamayan tokeni kullaniciya tanitmak icin mint kisaltmasi. */
function shortMint(mint) {
    return `${mint.slice(0, 4)}...${mint.slice(-4)}`
}

/**
 * `token.image.large` Home.vue'de GUARD'SIZ okunuyor (`token.image.large ||
 * '/default-token.png'`): `token.image` kendisi undefined ise bu satir THROW
 * eder ve butun render coker — client/src/utils/nativeToken.js:67-69 ile AYNI
 * kural ("image ASLA null/undefined olmaz"). O dosyadan import ETMEK yerine
 * burada tekrarlaniyor: nativeToken.js'in import listesi kendi testinde (T6)
 * BIREBIR kilitli, buraya bir bagimlilik eklemek o kilidi kirar.
 *
 * `large`de '/large/' gecmiyorsa (yerel bir yol ya da Solana token listesi
 * URL'i CoinGecko bicimde OLMAYABILIR) replace no-op'tur, ucu de large ile
 * ayni kalir — cokme riski yok, yalnizca ayni gorseli tekrar eder.
 */
function cgImage(large) {
    return {
        large,
        small: large.replace('/large/', '/small/'),
        thumb: large.replace('/large/', '/thumb/'),
    }
}

/**
 * Home ve SelectAssets icin Solana varlik satirlari.
 *
 * `chainId` METIN kalir. Number()'a sokulursa NaN olur ve token kovasi anahtari
 * ('NaN_...') mevcut hicbir kayitla eslesmez.
 *
 * Metadata bulunamayan token LISTEDEN DUSURULMEZ: kullanicinin gercekten sahip
 * oldugu bir bakiye gorunmez olursa parasi kaybolmus sanir. Mint kisaltmasiyla
 * gosterilir ve fiyati (coingecko_id yok) hesaplanmaz.
 */
export async function useSolanaAssets(address) {
    if (typeof address !== 'string' || address.length === 0) return []

    const raw = await fetchSolanaAssets(address)
    if (raw.length === 0) return []

    const splMints = raw.filter(a => a.mint !== SOL_NATIVE_MARKER).map(a => a.mint)
    const metadata = await fetchTokenMetadata(splMints)

    return raw.map((asset) => {
        if (asset.mint === SOL_NATIVE_MARKER) {
            const logo = SOLANA_CHAIN.logoURI || DEFAULT_TOKEN_IMAGE
            return {
                chainId: SOLANA_CHAIN_ID,
                address: SOL_NATIVE_MARKER,
                symbol: SOLANA_CHAIN.nativeCurrency.symbol,
                name: SOLANA_CHAIN.nativeCurrency.name,
                decimals: SOLANA_CHAIN.nativeCurrency.decimals,
                amount: asset.amount,
                logoURI: SOLANA_CHAIN.logoURI,
                image: cgImage(logo),
                coingecko_id: SOLANA_CHAIN.nativeCoingeckoId,
            }
        }

        const meta = metadata.get(asset.mint)
        const logo = meta?.logoURI || DEFAULT_TOKEN_IMAGE
        return {
            chainId: SOLANA_CHAIN_ID,
            address: asset.mint,
            symbol: meta?.symbol || shortMint(asset.mint),
            name: meta?.name || shortMint(asset.mint),
            decimals: asset.decimals,
            amount: asset.amount,
            logoURI: meta?.logoURI || null,
            image: cgImage(logo),
            coingecko_id: meta?.coingecko_id || null,
        }
    })
}
