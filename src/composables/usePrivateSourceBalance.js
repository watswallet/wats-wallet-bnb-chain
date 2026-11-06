import { ref, watch } from 'vue'
import { useTokenBalance } from './useTokenBalance'
import { sourceAssetAddress } from '../utils/privacy/sourceAssets'

// GIZLI MOD KAYNAK BAKIYESI (sade ekran plani T8; sT13): kaynak hesabin SECILI (zincir, varlik) bakiyesi.
// Hesap, zincir ya da varlik degisince BIR kez okunur; seciciler satir basina bakiye OKUMAZ. YALNIZ ilk RPC
// sorgulanir (hiz yarisi yok: ikinci uc nokta icin ayri bir RPC gorunurlugu acilmaz).
//
// Girdiler Ref ya da ComputedRef: address (dizge|null), chain (zincir nesnesi|null), asset (sembol).
// Eksik girdi, bilinmeyen varlik ya da RPC yoksa balance null. Hata balance null. Istek sayaci: sonradan baslayan
// okuma eskisinin yanitini yok sayar. Girdi degisince balance ayni anda null olur (eski hesabin sayisi yeni
// secimin altinda gorunmez); iki girdi ayni tikte degisirse tek okuma yapilir.
export function usePrivateSourceBalance({ address, chain, asset }) {
    const balance = ref(null)
    const loading = ref(false)
    let seq = 0

    async function refresh() {
        const id = ++seq
        const owner = address.value
        const c = chain.value
        const symbol = asset.value
        const url = c?.rpc?.[0]?.url
        const tokenAddress = c ? sourceAssetAddress(c.chainId, symbol) : null
        if (!owner || !c || !url || tokenAddress === null) {
            balance.value = null
            loading.value = false
            return
        }
        loading.value = true
        try {
            const value = await useTokenBalance(owner, tokenAddress, url, Number(c.chainId))
            if (id === seq) balance.value = value
        } catch {
            if (id === seq) balance.value = null
        } finally {
            if (id === seq) loading.value = false
        }
    }

    // Esgudumlu izleyici: girdi degisir degismez eski sayiyi at ve uctaki okumayi gecersiz kil.
    watch([address, chain, asset], () => {
        seq++
        balance.value = null
        loading.value = false
    }, { flush: 'sync' })
    // Okuma izleyicisi (varsayilan kuyruk): ayni tikteki birden cok degisim tek okumaya iner.
    watch([address, chain, asset], refresh, { immediate: true })

    return { balance, loading, refresh }
}
