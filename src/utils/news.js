// Ana ekrandaki "Gelismeler" seridinin SAF karar katmani.
//
// Bu dosyada AG YOK, VUE YOK, DEPO YOK. Ic erik SUNUCUDAN geldigi icin (bkz.
// composables/useNews.js) burasi tek bir soruyu yanitlar: "sunucudan donen bu
// govdenin ekranda gosterilebilir hali nedir?".
//
// NEDEN AYRI DOSYA: haber metinleri istemcinin KONTROLU DISINDA. Sunucu bir gun
// eksik/bozuk bir kayit dondururse (yanlis dil anahtari, id'siz kayit, dizi yerine
// nesne) bunun sonucu ana ekranin COKMESI olmamali -- ve bu ancak bir birim testiyle
// garanti altina alinabilir. Bilesenin icine gomulu halde yalnizca canli sunucuyla
// dogrulanabilirdi.
//
// GUVENLIK NOTU: donen metinler sablonda YALNIZCA `{{ }}` ile basilir, `v-html` ILE
// DEGIL. Yani buradaki dogrulama bir XSS savunmasi DEGIL; bicim/duzen savunmasidir.

// Vurgu rengi kapali bir listedir: sablon `accent`i dogrudan bir Tailwind sinif
// haritasinda arar ve Tailwind sinif adlarini DERLEME aninda tarar. Sunucudan gelen
// serbest bir dize (orn. "fuchsia") derlenmis CSS'te KARSILIKSIZ kalir ve kart
// renksiz gorunur; bilinmeyen deger bu yuzden sessizce varsayilana duser.
export const NEWS_ACCENTS = ['indigo', 'blue', 'purple', 'amber', 'emerald']
const DEFAULT_ACCENT = 'indigo'

// Serit yatay kaydirilir; makul bir tavan olmadan sunucu tarafinda yapilan bir hata
// (orn. dongude eklenen kayit) ekrana yuzlerce kart basardi.
const MAX_ITEMS = 12

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Cok dilli bir metin alanindan GOSTERILECEK dizeyi secer.
 *
 * Alan IKI bicimde gelebilir ve ikisi de kasitlidir:
 *   - duz dize  -> her dilde AYNI metin (orn. bir surum numarasi)
 *   - { tr, en } -> dile gore secim
 *
 * Istenen dil yoksa 'en'e duser; o da yoksa nesnedeki ILK dolu degere duser.
 * Son adim onemli: yeni bir dil eklenip (orn. yalniz `de`) `en` unutulursa kullanici
 * BOS bir kart gormektense yabanci dilde bir baslik gorsun -- bos kart "bozuk"tur.
 */
export function pickText(field, locale) {
    if (typeof field === 'string') return field.trim()
    if (!field || typeof field !== 'object') return ''

    const candidates = [locale, 'en', ...Object.keys(field)]
    for (const key of candidates) {
        const value = field[key]
        if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return ''
}

/**
 * Tek bir ham kaydi ekranda gosterilebilir bicime cevirir; cevrilemiyorsa `null`.
 *
 * ZORUNLU alanlar yalnizca `id` ve `title`: id olmadan kayit KAPATILAMAZ (kapatma
 * id'ye yazilir, bkz. useNews.js) ve basliksiz bir kart hicbir sey anlatmaz. Govde
 * ve tarih opsiyoneldir -- eksikse sablon o satiri hic cizmez.
 */
export function normalizeNewsItem(raw, locale) {
    if (!raw || typeof raw !== 'object') return null

    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    if (!id) return null

    const title = pickText(raw.title, locale)
    if (!title) return null

    const date = typeof raw.date === 'string' && ISO_DATE_RE.test(raw.date.trim())
        ? raw.date.trim()
        : null

    return {
        id,
        title,
        body: pickText(raw.body, locale),
        date,
        accent: NEWS_ACCENTS.includes(raw.accent) ? raw.accent : DEFAULT_ACCENT,
    }
}

/**
 * Sunucu govdesini (ya da gomulu varsayilan listeyi) kart dizisine cevirir.
 *
 * Govde HEM `{ news: [...] }` HEM de ciplak bir dizi olabilir: ilki sunucunun bicimi,
 * ikincisi gomulu varsayilan listenin bicimi -- ikisini de kabul etmek cagiran
 * tarafta bir `if` daha az demek.
 *
 * Ayni `id` birden fazla gelirse ILKI kazanir: kapatma id'ye yazildigi icin kopya
 * kayit "kapattim ama hala duruyor" gibi gorunurdu.
 */
export function normalizeNews(payload, locale) {
    const raw = Array.isArray(payload) ? payload : (Array.isArray(payload?.news) ? payload.news : [])

    const seen = new Set()
    const items = []
    for (const entry of raw) {
        const item = normalizeNewsItem(entry, locale)
        if (!item || seen.has(item.id)) continue
        seen.add(item.id)
        items.push(item)
        if (items.length >= MAX_ITEMS) break
    }
    return items
}

/** Kullanicinin kapattigi kayitlari eler. `dismissed` dizi ya da Set olabilir. */
export function visibleNews(items, dismissed) {
    const set = dismissed instanceof Set ? dismissed : new Set(Array.isArray(dismissed) ? dismissed : [])
    return (Array.isArray(items) ? items : []).filter((item) => item && !set.has(item.id))
}

/**
 * "YENI" rozeti icin: kayit son `days` gun icinde mi?
 *
 * Rozet AYRI bir "okundu" kaydi TUTMAZ -- tutsaydi kapatma listesinin yaninda ikinci
 * bir kalici durum olurdu ve ikisi birbiriyle karisirdi. Tarih zaten kayitta var.
 * Tarihsiz kayit rozet ALMAZ: bilinmeyeni "yeni" saymak her acilista sahte bir
 * "yeni sey var" sinyali uretirdi.
 */
export function isRecent(date, nowMs, days = 14) {
    if (typeof date !== 'string' || !ISO_DATE_RE.test(date)) return false
    const stamp = Date.parse(date + 'T00:00:00Z')
    if (Number.isNaN(stamp) || !Number.isFinite(nowMs)) return false
    const age = nowMs - stamp
    // Gelecek tarihli kayit da "yeni"dir (yayin tarihi ileri alinmis olabilir);
    // eleme YALNIZCA eskiye dogrudur.
    return age < days * 24 * 60 * 60 * 1000
}

// --- kalici durum -----------------------------------------------------------------------
//
// Yukarisi saf; asagisi chrome.storage.local'a dokunur. Ikisi AYNI dosyada duruyor cunku
// depoda ayni desen zaten var (bkz. utils/atsFuel.js: bicimleyiciler + onbellek okuma/yazma)
// ve kapatma listesinin bicimi yalnizca burasini ilgilendiriyor.
//
// HER cagri kendi try/catch'i ile sarili: bu kod popup acilisinda kosuyor ve depo okumasi
// beklenmedik bir baglamda (orn. test, SSR, izin kisitli bir sayfa) patlarsa ANA EKRAN
// COKMEMELI -- kaybedilen tek sey bir seride hangi kartin gorunecegidir.

export const NEWS_DISMISSED_KEY = 'news_dismissed'
export const NEWS_CACHE_KEY = 'news_cache'

// Kapatma listesi SONSUZA kadar buyumesin. Yalniz yayinlanmis duyuru sayisi kadar
// buyudugu icin gercek bir risk degil, ama tavan bedavaya geliyor.
const MAX_DISMISSED = 100

const hasStorage = () => typeof chrome !== 'undefined' && chrome?.storage?.local

/** Kullanicinin kapattigi haber id'leri. Okunamazsa BOS: kart gostermek, gizlemekten iyidir. */
export async function readDismissedNews() {
    if (!hasStorage()) return []
    try {
        const store = await chrome.storage.local.get([NEWS_DISMISSED_KEY])
        const value = store?.[NEWS_DISMISSED_KEY]
        return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []
    } catch {
        return []
    }
}

/** Bir id'yi kapatilanlara ekler ve GUNCEL listeyi doner (cagiran ayrica okumasin diye). */
export async function dismissNewsItem(id) {
    const current = await readDismissedNews()
    if (!id || current.includes(id)) return current

    // Tavan asilirsa EN ESKI kayit dusurulur: o duyuru zaten cok once yayindan kalkmistir.
    const next = [...current, id].slice(-MAX_DISMISSED)
    if (hasStorage()) {
        try { await chrome.storage.local.set({ [NEWS_DISMISSED_KEY]: next }) } catch { /* yut */ }
    }
    return next
}

/**
 * Son basarili `/news` yaniti. Popup HER acilista yeniden mount olur; onbellekten
 * ANINDA boyamazsak kullanici her acilista once bos bir alan, sonra kartlarin "ziplayarak"
 * geldigini gorur.
 */
export async function readNewsCache() {
    if (!hasStorage()) return null
    try {
        const store = await chrome.storage.local.get([NEWS_CACHE_KEY])
        const value = store?.[NEWS_CACHE_KEY]
        return Array.isArray(value?.news) ? value.news : null
    } catch {
        return null
    }
}

/** HAM (normalize edilmemis) listeyi saklar: dil secimi okuma aninda yapilmali. */
export async function writeNewsCache(rawItems) {
    if (!hasStorage() || !Array.isArray(rawItems)) return
    try { await chrome.storage.local.set({ [NEWS_CACHE_KEY]: { news: rawItems } }) } catch { /* yut */ }
}
