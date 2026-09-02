import { computed, ref } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { configStore } from '../store/config'
import { DEFAULT_NEWS } from '../data/defaultNews'
import {
    normalizeNews, visibleNews,
    readDismissedNews, dismissNewsItem, readNewsCache, writeNewsCache,
} from '../utils/news'

// Duyuru serdi ana ekranin YAN bir ogesi; agir bir istekmis gibi beklenmemeli.
// Sunucu yavassa kullanici gomulu/onbellekteki listeyi gorur ve hicbir sey kaybetmez.
const NEWS_TIMEOUT_MS = 6000

/** Sunucu govdesinden HAM listeyi cikarir; `null` = "gecerli bir liste gelmedi". */
function extractRawNews(data) {
    if (Array.isArray(data)) return data
    if (Array.isArray(data?.news)) return data.news
    return null
}

/**
 * Ana ekran "Gelismeler" seridinin durumu.
 *
 * UC KATMANLI liste, bu sirayla ve her katman bir oncekinin UZERINE yazar:
 *   1) gomulu varsayilanlar (data/defaultNews.js) -- ilk boyama, HER ZAMAN dolu
 *   2) son basarili yanitin onbellegi        -- popup acilisinda ziplama olmasin
 *   3) canli `GET /news`                     -- tek yetkili kaynak
 *
 * NEDEN 1. KATMAN VAR: sunucu ELLE guncelleniyor (bkz. data/defaultNews.js). `/news`
 * ucu sunucuya cikana kadar yalnizca canliya guvenen bir tasarim ozelligi kullaniciya
 * HIC gostermezdi.
 *
 * NEDEN LISTE HAM TUTULUYOR: `items` HAM listeden + AKTIF DILDEN hesaplanir. Dil
 * calisma aninda degisebiliyor (Tercihler) ve normalize edilmis metni saklasaydik
 * kartlar eski dilde donup kalirdi.
 */
export function useNews() {
    const config = configStore()
    const { locale } = useI18n()

    const raw = ref(DEFAULT_NEWS)
    const dismissed = ref([])
    const loading = ref(false)

    const items = computed(() => visibleNews(normalizeNews(raw.value, locale.value), dismissed.value))

    /**
     * Kartin ✕ dugmesi. Depoya YAZILDIKTAN sonra ekrani gunceller -- ters sirada
     * yazma sessizce basarisiz olursa kart popup yeniden acilinca geri gelirdi ve
     * kullanici kapatmanin calismadigini ancak o zaman anlardi.
     */
    async function dismiss(id) {
        dismissed.value = await dismissNewsItem(id)
    }

    async function load() {
        dismissed.value = await readDismissedNews()

        const cached = await readNewsCache()
        if (cached && cached.length) raw.value = cached

        loading.value = true
        try {
            const resp = await axios.get(config.api + '/news', { timeout: NEWS_TIMEOUT_MS })
            const fresh = extractRawNews(resp?.data)
            // BOS dizi de gecerli bir yanittir: sunucu duyurulari KALDIRABILMELI.
            // `null` ise (bicimi taninmayan govde) elimizdekini korumak daha dogru.
            if (fresh) {
                raw.value = fresh
                await writeNewsCache(fresh)
            }
        } catch {
            // Uc yok / 404 / zaman asimi: gomulu ya da onbellekteki liste EKRANDA KALIR.
            // Bir duyuru seridi ugruna ana ekranda hata gostermenin kullaniciya faydasi yok.
        } finally {
            loading.value = false
        }
    }

    return { items, loading, dismiss, load }
}
