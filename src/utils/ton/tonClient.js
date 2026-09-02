// Backend proxy'sine bagli TonClient.
//
// Uc DOGRUDAN toncenter DEGIL, kendi sunucumuzdur: API anahtari orada kalir.
// TonClient zaten JSON-RPC v2 konusuyor, ayri bir istemci yazmaya gerek yok.
//
// Ornek onbellege alinir: her bakiye turunda yeni TonClient kurmak, 10 saniyede bir
// calisan Home dongusunde gereksiz nesne yaratir.
import { TonClient } from '@ton/ton'

let cached = null

export function getTonClient(apiBase) {
    const base = String(apiBase || '').trim().replace(/\/+$/, '')
    if (!base) throw new Error('TON_API_BASE_MISSING')

    if (!cached || cached.base !== base) {
        cached = { base, client: new TonClient({ endpoint: `${base}/ton/rpc` }) }
    }
    return cached.client
}
