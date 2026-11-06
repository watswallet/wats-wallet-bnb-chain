import { formatUnits } from 'ethers'
import { deliveryChainOf } from './deliveryChains'
import { DELIVERY_VERSION } from './deliveryTokens'

// GIZLI ISLEMLER SATIRININ TESLIM PROJEKSIYONU (gizli-mod cok-ag spec 4.3 "Okuma kurallari", siparis kaydi sutunu). Kalici
// siparis kaydindan arayuze giden dort alan: teslim agi (deliveryChainId), teslim varligi sembolu (outputAsset), beklenen tutar
// (expectedAmount, insan birimi) ve tahmin bayragi (estimated). Arka plan ve testler ayni islevi kullanir.
//
// SURUM 2 (deliveryVersion === 2): summary.dest.chainId/asset/decimals SECIMDEN yazilmistir (K6, sunucu yankisindan degil).
// Bozuk chainId satiri ASLA 56'ya dusurmez (deliveryChainId: null: para yanlis aga gitmis gibi gosterilmez, rozet cizilmez);
// bozuk ya da eksik asset/decimals sembol ve tutari gostermez (outputAsset: null, expectedAmount: null): "BNB" ya da "USDC"
// yedegi YOKTUR.
// SURUMSUZ KAYIT (alan yok ya da null): ACIK eski-kayit yolu, yalniz GOSTERIM icin: ag 56; dest.asset yoksa BNB (2026-10-10'dan
// once dest yalniz BNB teslimi icin gonderiliyordu), dest yoksa USDC kesin tutar (payoutUsdc; ust belge bolum 16.6.6).
// BILINMEYEN SURUM (2 disinda bir deger): guvenle yorumlanamaz, hicbir alan uydurulmaz.
const UNKNOWN = Object.freeze({ deliveryChainId: null, outputAsset: null, expectedAmount: null, estimated: true })

// BigInt('') ve BigInt('  ') 0n verir: bos tutar "0.0" degil BILINMEYEN (null) olmali.
function expectedHuman(raw, decimals) {
    try {
        if (raw == null || String(raw).trim() === '') return null
        return formatUnits(BigInt(raw), decimals)
    } catch {
        return null
    }
}

function fromVersion2(summary) {
    const dest = summary?.dest && typeof summary.dest === 'object' ? summary.dest : null
    if (!dest) return { ...UNKNOWN }
    const chain = deliveryChainOf(dest.chainId)
    const deliveryChainId = chain ? chain.chainId : null
    const asset = typeof dest.asset === 'string' && dest.asset.trim() !== '' ? dest.asset : null
    const decimals = Number.isInteger(dest.decimals) && dest.decimals >= 0 && dest.decimals <= 36 ? dest.decimals : null
    if (asset === null || decimals === null) return { deliveryChainId, outputAsset: null, expectedAmount: null, estimated: true }
    return { deliveryChainId, outputAsset: asset, expectedAmount: expectedHuman(dest.expectedDestAmount, decimals), estimated: true }
}

function fromLegacy(summary) {
    if (!summary?.dest) return { deliveryChainId: 56, outputAsset: 'USDC', expectedAmount: summary?.payoutUsdc || null, estimated: false }
    const outputAsset = typeof summary.dest.asset === 'string' && summary.dest.asset ? summary.dest.asset : 'BNB'
    const decimals = Number.isInteger(summary.dest.decimals) ? summary.dest.decimals : 18
    return { deliveryChainId: 56, outputAsset, expectedAmount: expectedHuman(summary.dest.expectedDestAmount, decimals), estimated: true }
}

export function privateOrderDelivery(order) {
    const version = order?.deliveryVersion
    if (version === undefined || version === null) return fromLegacy(order?.summary)
    if (version === DELIVERY_VERSION) return fromVersion2(order?.summary)
    return { ...UNKNOWN }
}
