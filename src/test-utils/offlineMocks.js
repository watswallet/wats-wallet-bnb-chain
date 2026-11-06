// "Teste ag YOK" taklitleri (T28 M2): ekranlar ONMOUNTED'ta fiyat/token verisi ister; bu istekler testte
// varsayilan API adresine (localhost:8000) gidip ECONNREFUSED yaziyordu. Testler gercek aga HIC cikmaz.
//
// KULLANIM (vi.mock hoist edilir; factory icinden dinamik import):
//   vi.mock('../composables/useUsdPrice', async () => (await import('../test-utils/offlineMocks.js')).usdPriceOfflineModule())
//   vi.mock('axios', async () => (await import('../test-utils/offlineMocks.js')).axiosOfflineModule())
import { ref } from 'vue'

// useUsdPrice: fiyat BILINMIYOR (null) kalir; ag olmayan ortamdaki gercek sonuc de budur (kimlikleCoz null doner).
export function usdPriceOfflineModule() {
    return { useUsdPrice: () => ({ price: ref(null), loadNative: async () => {}, loadById: async () => {} }) }
}

// axios: her istek bos ama gecerli bir govdeyle cozulur (ekranlar `data.tokens` bekler); ag kullanilmaz.
export function axiosOfflineModule() {
    const bos = async () => ({ status: 200, data: { tokens: [] } })
    const axios = { post: bos, get: bos, put: bos, delete: bos, request: bos, create: () => axios, interceptors: { request: { use() {} }, response: { use() {} } }, defaults: { headers: { common: {} } } }
    return { default: axios, ...axios }
}
