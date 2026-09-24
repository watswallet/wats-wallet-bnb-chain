import { ref } from 'vue'
import axios from 'axios'
import { buildNativeToken, NATIVE_TOKEN_ADDRESS } from '../utils/nativeToken'

/**
 * BIR VARLIGIN DOLAR FIYATI - ekrandaki ikincil "≈ $x.xx" satirlari icin.
 *
 * Mevcut fiyat okuyucu (utils/assetPrice.js) bir VARLIK KAYDINDAN okur
 * (`market`/`market_data`). Bu dosya onun yerine GECMEZ; okunacak bir kayit
 * OLMADIGI iki durumu cozer:
 *
 *   - GAZ UCRETI aktif zincirin NATIVE varliginda olculur, ama onay ekranindaki
 *     kayit GONDERILEN tokenindir (jetton gonderirken jettonun fiyati gelirdi).
 *   - ATS UCRETI her zaman ATS'te olculur ve ATS ekranda hicbir yerde bir varlik
 *     kaydi olarak durmuyor - yalnizca atsConfig'de bir sabit olarak var.
 *
 * FIYAT BILINMIYORSA `null`. 0 DONDURULMEZ: assetPrice.js'in bas yorumundaki
 * ayni kural -- "$0.00" bir ucret kartinda "bedava" demek olurdu.
 */

// Modul kapsaminda onbellek, coingecko KIMLIGI basina. Ekranlar surekli sokulup
// yeniden kuruluyor (Gonder <-> Onayla arasinda gidip gelmek bileseni her
// seferinde yeniden yaratiyor); her acilista ayni fiyati sormak bosa tur.
const onbellek = new Map()
const TAZELIK_MS = 60_000

export function _onbellegiTemizle() {
    onbellek.clear()
}

/** Kullanilabilir bir fiyat mi? assetPriceUSD ile AYNI kapi. */
function gecerliFiyat(raw) {
    if (raw === null || raw === undefined || raw === '') return null
    const price = Number(raw)
    if (!Number.isFinite(price) || price <= 0) return null
    return price
}

/** Coingecko kimliginden fiyat: once onbellek, sonra sunucu. */
async function kimlikleCoz(id, { http, apiBase, now }) {
    if (!id) return null

    const kayit = onbellek.get(id)
    if (kayit && now() - kayit.at <= TAZELIK_MS) return kayit.price
    if (kayit) onbellek.delete(id)

    const base = String(typeof apiBase === 'function' ? apiBase() : apiBase || '').trim()
    if (!base) return null

    try {
        const { data } = await http.post(base + '/getTokensDataById', { ids: [id] })
        const token = Array.isArray(data?.tokens) ? data.tokens[0] : null
        const bulunan = gecerliFiyat(token?.market_data?.priceUSD ?? token?.market?.priceUSD)

        // Basarisiz cozum de onbelleklenir: uc 404/403 donuyorsa (canli olculdu:
        // bu backend'de /news 404, /solana/rpc 403) ekrani her acista yeniden
        // denemek, gelmeyecek bir cevap icin tur harcamak olurdu. Sure dolunca
        // yine denenir.
        onbellek.set(id, { price: bulunan, at: now() })
        return bulunan
    } catch (e) {
        onbellek.set(id, { price: null, at: now() })
        console.warn('Fiyat okunamadi (' + id + '):', e.message)
        return null
    }
}

/**
 * @param {object} deps
 * @param {() => object} [deps.tokenBalances] Home'un yazdigi bakiye/fiyat kovasi
 * @param {() => string} deps.apiBase         config.api
 * @param {typeof axios} [deps.http]
 * @param {() => number} [deps.now]
 */
export function useUsdPrice({ tokenBalances = () => ({}), apiBase, http = axios, now = () => Date.now() } = {}) {
    const price = ref(null)
    const deps = { http, apiBase, now }

    /**
     * Aktif zincirin NATIVE varliginin fiyati.
     *
     * Once bellekte hazir olana bakar: Home satirlari cizerken her token icin
     * `user.tokenBalances[chainId_address].price` yaziyor -- zaten odenmis bir
     * istek, tekrar sormak gereksiz tur olurdu.
     */
    const loadNative = async (chainId) => {
        if (chainId === null || chainId === undefined) { price.value = null; return }

        const kova = (typeof tokenBalances === 'function' ? tokenBalances() : tokenBalances) || {}
        const bellekten = gecerliFiyat(kova[`${chainId}_${NATIVE_TOKEN_ADDRESS}`]?.price)
        if (bellekten !== null) { price.value = bellekten; return }

        // Kimlik zincirin KANONIK native kaydindan gelir (buildNativeToken),
        // ekranda duran kayittan DEGIL: o kayit gonderilen tokenindir.
        price.value = await kimlikleCoz(buildNativeToken(chainId)?.coingecko_id, deps)
    }

    /** Coingecko kimligi BILINEN bir varligin fiyati (ATS gibi). */
    const loadById = async (id) => {
        price.value = await kimlikleCoz(id, deps)
    }

    return { price, loadNative, loadById }
}
