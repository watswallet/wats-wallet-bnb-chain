import { bucketNeedsDefaults } from '../defaultTokenSeed'
import { isNativeAsset } from '../nativeAsset'
import { isNativeDeliveryToken, normalizeDeliveryToken } from './deliveryTokens'
import { isStockDeliveryToken } from './stockDelivery'

// Gizli aktarma sonrasi teslim edilen token Gizli Hesabin varlik listesinde gorunsun (spec 2026-10-10 teslim tokenleri, 7. bolum;
// gizli-mod cok-ag spec 4.7 "Teslim yazicisi", P12, E13). Home.vue aktif hesabin `imported_tokens[hesap][zincir]` kovasini genel
// bicimde okur ve Gizli Hesap da aktif hesaptir; satir ImportToken.vue'nun yazdigi bicimde eklenir. Token teslim agini TASIR
// (DeliveryToken.chainId): kova anahtari String(token.chainId)'dir, yani Base'e teslim edilen token Base kovasina yazilir. Satir:
// ad sembolden, logo bos (satir varsayilan simgeyle cizilir; ozel modda yerel logo politikasi Dilim D'dedir), fiyat kimligi
// bilinmiyor (null: uydurma kimlik yazilmaz). YEREL COIN DE KABUL EDILIR (o agin yerel coin satiri, sifir adres, sembol tablodan) ve
// isNativeAsset ile tekillestirilir: Base'e gelen ETH "kayboldu" gorunmesin.
//
// Eklenmez: kovada zaten olan token (harf boyutu sayilmaz; yerel coinde sifir adres / '0x0' / 0xeeee... esdegerdir) ve varsayilan
// tohum bekleyen kova (`bucketNeedsDefaults`): o kovaya yazmak tohum kapisini kalici kapatir ve ETH/USDT/ATS/BNB hic gelmezdi
// (Home.seedOwnedBStocks ile ayni kural). Bu kapi, yerel tohum (privateDefaultTokens.js) gelene dek (Dilim D) KALIR.
// YALNIZ verilen hesabin ilgili ag kovasi yazilir; digerleri okunan haliyle kalir. ASLA firlatmaz: siparis sonucunu etkilemez.
// Tek yazici ARKA PLANDIR (runPrivateOrder, recordDeposit sonrasi, Gizli Hesap'a teslim eden her yolda: Para yukle, kendine Takas, kendine Kopru): popup yazimi popup kapaninca kaybolurdu.
// Donus: 'added' | 'skipped' | 'failed'.
export async function addDeliveredTokenToPrivateBucket({ privateAccountKey, token, storage = globalThis.chrome?.storage?.local } = {}) {
    try {
        if (typeof privateAccountKey !== 'string' || !privateAccountKey) return 'skipped'
        let delivered
        try { delivered = normalizeDeliveryToken(token) } catch { return 'skipped' }
        // Hisse tokeni Gizli Hesap kovasina HIC yazilmaz (teslimi zaten reddedilir; eski/bozuk kayit yine de yazmasin).
        if (isStockDeliveryToken(delivered.chainId, delivered.address)) return 'skipped'

        const { imported_tokens: stored } = await storage.get('imported_tokens')
        const all = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
        const byAccount = all[privateAccountKey]
        if (bucketNeedsDefaults(byAccount)) return 'skipped'

        const chainKey = String(delivered.chainId)
        const current = Array.isArray(byAccount[chainKey]) ? byAccount[chainKey] : []
        const native = isNativeDeliveryToken(delivered)
        const same = (row) => typeof row?.address === 'string'
            && (native ? isNativeAsset(row.address) : row.address.toLowerCase() === delivered.address.toLowerCase())
        if (current.some(same)) return 'skipped'

        const row = {
            name: delivered.symbol,
            symbol: delivered.symbol,
            decimals: delivered.decimals,
            address: delivered.address,
            image: { thumb: '', small: '', large: '' },
            chain: null,
            coingecko_id: null,
        }
        await storage.set({ imported_tokens: { ...all, [privateAccountKey]: { ...byAccount, [chainKey]: [...current, row] } } })
        return 'added'
    } catch {
        return 'failed'
    }
}
