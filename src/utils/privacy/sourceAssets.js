import { getAssetOnChain, isAssetSymbol } from '@silentswap/sdk'
import { privateAssetsFor, privateSourceChains } from './silentswapConfig'

// GIZLI MOD KAYNAK CIFTLERI (sade ekran plani T8; K1, K2). Kaynak = (zincir, varlik) cifti: ekranin ust cipi, birlesik
// secici ve kaynak bakiyesi ayni tabloyu okur. Popup modulu: silentswap.js ve privateOrderExec.js import EDILMEZ
// (privatePopupImports.test.js); SDK'dan yalniz kayit okuyuculari alinir. Ag yok. LOGOLAR burada DEGIL: privateTokenLogo.js (tek cozucu).

// Cift anahtari: '56:USDC'. Zincir sayiya cevrilir ('0x38' ya da '56' ile 56 ayni anahtar).
export const pairKey = (chainId, asset) => `${Number(chainId)}:${asset}`

// Secicinin satirlari: kaynak olarak acik zincirler (listedeki sirayla), her birinin varliklari privateAssetsFor sirasiyla.
export function sourcePairs(chains) {
    const out = []
    for (const chain of privateSourceChains(chains)) {
        const chainId = Number(chain.chainId)
        for (const asset of privateAssetsFor(chain)) {
            out.push({ key: pairKey(chainId, asset), chainId, chainName: chain.name, asset })
        }
    }
    return out
}

// Varligin o zincirdeki sozlesme adresi (yerel coin icin sifir adres); kayitta yoksa null.
// isAssetSymbol korumasi: 'constructor' gibi prototip adlari getAssetOnChain'e hic ulasmaz.
export function sourceAssetAddress(chainId, asset) {
    if (typeof asset !== 'string' || !isAssetSymbol(asset)) return null
    return getAssetOnChain(asset, Number(chainId))?.address ?? null
}

// Secicinin arama suzmesi: sorgu kirpilir, buyuk/kucuk harf duyarsiz; varlik sembolu ya da ag adinda gecen ciftler kalir.
// Bos/bosluk sorgu tum cifti (ayni sira) doner; liste degilse bos dizi. Girdiyi degistirmez.
export function filterSourcePairs(pairs, query) {
    if (!Array.isArray(pairs)) return []
    const q = String(query ?? '').trim().toLowerCase()
    if (q === '') return pairs.slice()
    return pairs.filter((p) => String(p.asset ?? '').toLowerCase().includes(q) || String(p.chainName ?? '').toLowerCase().includes(q))
}
