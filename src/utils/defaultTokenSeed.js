// Varsayilan tokenlarin (ETH+USDT / ATS+BNB) TEK kurali ve TEK yazicisi.
//
// KOK NEDEN (kullanici raporu: "yeni import edilen cuzdanda hicbir token gelmiyor"):
// varsayilanlar yalniz App.vue acilisinda, `!imported_tokens[hesap]` kapisiyla
// tohumlaniyordu ve bu kapi iki yoldan yanlis kapaniyordu:
//   - Home.vue'nun TON tohumu (ensureTonNativeToken) bos kovayi `{'-239':[GRAM]}`
//     olarak YARATIP diske yazar. Kova artik "var" sayilir, varsayilanlar bir daha
//     hic gelmez. Yani KOVANIN VARLIGI sinyal olamaz: baska bir tohum da onu yaratir.
//   - Yan panel varsayilan oldugundan (2026-09-12) Ekle > import > Home yolunda App
//     yeniden kurulmaz; acilis tohumu zaten calismaz. Import ekranlari tohumlamaz.
//
// KURAL (bucketNeedsDefaults): kovada NE '1' NE '56' anahtari varsa varsayilan gerekir.
// Sunucu varsayilani HER ZAMAN iki anahtari birden yaratir (getImportedTokens
// `{1:[ETH,USDT], 56:[ATS,BNB]}` doner) ve token silmek anahtari SILMEZ, BOSALTIR
// (SearchTokens.saveTokens `{[chainId]: []}` yazar; ImportToken yalniz ekler; hicbir
// yazici zincir anahtarini kaldirmaz -- depoyu yalniz Sifirla/Forgot password temizler).
// Yani kullanici tum varsayilanlari silse de kova "saglikli" kalir ve onun KASITLI
// secimi geri alinmaz.
//
// BASARISIZLIK POLITIKASI: sunucu ulasilamaz, zaman asimi ya da govde bozuksa HICBIR
// sey yazilmaz ve firlatilmaz; durum `failed` doner. Bos ya da yarim bir kova yazmak
// kapiyi (yukaridaki gibi) kalici kapatirdi. Govde YALNIZCA beklenen zincirlerde
// (1/56) en az bir satir tasiyorsa kullanilir: bos veritabani `{1:[],56:[]}` ile 200
// doner ve yazilirsa hesaplar "saglikli ama bos" sayilip sunucu dolsa bile bir daha
// tohumlanmazdi.
//
// BASARISIZLIK ONBELLEGI: hasarli bir hesapta her yukleme (acilis, ag/hesap degisimi)
// ayni basarisiz istegi tekrarlar ve her seferinde en fazla 8 sn bekletirdi. Gercek bir
// basarisizliktan sonra 60 sn boyunca o hesap icin ag istegine CIKILMAZ (`failed`
// hemen doner); sure dolunca bir sonraki yukleme yeniden dener. Kova yine de OKUNUR:
// bu sure icinde baska bir yoldan iyilesmisse `healthy` doner ve kayit silinir. Onbellekten
// donen cagri sureyi YENILEMEZ (yenileseydi pencere hic kapanmazdi).
//
// YAZMA: depo yazmadan hemen ONCE taze okunur ve YALNIZ bu hesabin kovasi yazilir.
// Eskiden App.vue ve CreateAccount.vue acilista okunan anlik goruntuden TUM haritayi
// geri yaziyordu (ag istegi suresince baska bir baglamda yapilan yazimlar sessizce
// ezilirdi). Birlestirme ANAHTAR BASINA ve MEVCUT KAZANIR: kullanicinin satirlari ve
// TON ('-239') satiri korunur.
//
// GIZLILIK: istek bir GET'tir ve sorgu dizesi, params, headers ya da govde TASIMAZ --
// hesap adresi ya da anahtari sunucumuza gitmez.
import axios from 'axios'

// Kuralin aradigi iki zincir anahtari (Ethereum, BSC).
export const DEFAULT_CHAIN_KEYS = ['1', '56']

// Home acilisi bu cagriyi BEKLER: sinirsiz bir istek ana ekrani asili tutardi
// (eskiden App.vue'daki cagrinin zaman asimi YOKTU). priceHistory.js ile ayni sinir.
export const DEFAULT_TOKENS_TIMEOUT_MS = 8000

// Gercek bir basarisizliktan sonra ayni hesap icin yeniden denemeden once beklenen sure.
export const DEFAULT_TOKENS_RETRY_MS = 60_000

export const SEED_STATUS = Object.freeze({
    HEALTHY: 'healthy', // kova zaten saglikli: ag istegi/yazim yok
    SEEDED: 'seeded',   // varsayilanlar yazildi
    FAILED: 'failed',   // hicbir sey yazilmadi; sonraki yukleme yeniden dener
})

// API tabani store/config.js ile AYNI degisken ve AYNI yedek. Pinia burada okunmaz:
// bu modul bilesen disindan da cagriliyor (bkz. utils/solana/client.js notu).
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Kova varsayilan token gerektiriyor mu? TEK kaynak -- App, Home ve CreateAccount
 * AYNI karari bunun uzerinden verir.
 *
 * Anahtar, token LISTESI tasiyorsa (bos dizi dahil) "var" sayilir. Dizi ya da nesne
 * olmayan kova (eski CreateAccount'un cevrimdisi yolu `[hesap]: []` yaziyordu)
 * hasarlidir ve gerektirir.
 */
export function bucketNeedsDefaults(bucket) {
    if (!isPlainObject(bucket)) return true
    return !DEFAULT_CHAIN_KEYS.some((key) => Array.isArray(bucket[key]))
}

// Sunucu govdesindeki `importedTokens` kullanilabilir mi? Kullanilabilirse yalnizca
// LISTE tasiyan anahtarlari doner. `{news: []}` bicimli, kuralin aradigi iki anahtardan
// hicbirini icermeyen ya da bu zincirlerde TOPLAM sifir satir tasiyan (`{1:[],56:[]}`: bos
// veritabani) bir govde yazilsa bile kovayi "bos" birakir ya da "saglikli ama bos" yapardi.
function usableDefaults(importedTokens) {
    if (!isPlainObject(importedTokens)) return null

    const lists = {}
    for (const [chainKey, rows] of Object.entries(importedTokens)) {
        if (Array.isArray(rows)) lists[chainKey] = rows
    }

    const ruleRows = DEFAULT_CHAIN_KEYS.reduce((sum, key) => sum + (lists[key]?.length ?? 0), 0)
    return ruleRows > 0 ? lists : null
}

// hesap anahtari -> son GERCEK basarisizligin ani (Date.now()). Basari/iyilesme kaydi siler.
const failedAt = new Map()

// Saat geriye alinirsa (negatif sure) kayit GECERSIZ sayilir: aksi halde saat sicramasi bir
// hesabi saatlerce yeniden denemeden mahrum birakirdi.
function cooling(accountKey) {
    const at = failedAt.get(accountKey)
    if (at === undefined) return false
    const elapsed = Date.now() - at
    return elapsed >= 0 && elapsed < DEFAULT_TOKENS_RETRY_MS
}

// Taze okuma -> birlestirme -> yazma bolumu HESAPLAR ARASINDA da sirayla kosar. Aksi
// halde iki hesabin tohumu ayni anda biterse ikisi de yazmadan ONCE okur ve ikincisi
// birincinin kovasini ezerdi (hesap degistirirken yavas bir agda gercekci: iki istek
// birlikte doner). Baska yazicilari (ImportToken, SearchTokens) kapsamaz -- onlar bu
// kilidi kullanmaz; kapsami yalniz bu modulun kendi cagrilaridir.
let commitQueue = Promise.resolve()

function serialized(task) {
    const run = commitQueue.then(task)
    // Bir bolumun hatasi kuyrugu tikamasin: sonraki hesap yine calisir.
    commitQueue = run.catch(() => {})
    return run
}

// Yazmadan hemen ONCE taze okuma: ag istegi suresince baska bir baglam (ImportToken,
// SearchTokens, baska bir hesabin tohumu) depoyu degistirmis olabilir. YALNIZ bu
// hesabin kovasi yazilir; digerleri okunan haliyle geri yazilir.
async function commit(accountKey, defaults) {
    const { imported_tokens: fresh } = await chrome.storage.local.get('imported_tokens')
    const all = isPlainObject(fresh) ? fresh : {}
    const current = isPlainObject(all[accountKey]) ? all[accountKey] : {}

    // Mevcut anahtar KAZANIR (sirasi onemli: `current` sonda).
    const merged = { ...defaults, ...current }
    if (Object.keys(merged).length === Object.keys(current).length) return SEED_STATUS.HEALTHY

    await chrome.storage.local.set({ imported_tokens: { ...all, [accountKey]: merged } })
    return SEED_STATUS.SEEDED
}

async function seed(accountKey) {
    try {
        const { imported_tokens: stored } = await chrome.storage.local.get('imported_tokens')
        if (!bucketNeedsDefaults(stored?.[accountKey])) return { status: SEED_STATUS.HEALTHY }

        // Yakin zamanda GERCEK bir basarisizlik oldu: ag istegine cikilmaz. Kova yukarida
        // OKUNDU (iyilesmisse healthy donerdi); `cooled` onbellekten donuldugunu isaretler.
        if (cooling(accountKey)) return { status: SEED_STATUS.FAILED, cooled: true }

        const response = await axios.get(`${API_BASE}/getImportedTokens`, { timeout: DEFAULT_TOKENS_TIMEOUT_MS })
        const defaults = usableDefaults(response?.data?.importedTokens)
        if (!defaults) {
            console.warn('Varsayilan token yaniti kullanilamaz, yazilmadi')
            return { status: SEED_STATUS.FAILED }
        }

        return { status: await serialized(() => commit(accountKey, defaults)) }
    } catch (error) {
        console.warn('Varsayilan tokenlar eklenemedi:', error?.message)
        return { status: SEED_STATUS.FAILED }
    }
}

const inFlight = new Map()

/**
 * Hesabin kovasi varsayilan gerektiriyorsa sunucudan alip yazar. ASLA firlatmaz.
 *
 * Ayni hesap icin eszamanli cagrilar (App acilisi + Home yuklemesi ayni sayfada)
 * TEK istege iner: devam eden is paylasilir ve bitince kayit silinir.
 *
 * @param {string} accountKey `active_account.key`
 * @returns {Promise<{ status: 'healthy' | 'seeded' | 'failed' }>}
 */
export function ensureDefaultTokens(accountKey) {
    if (!accountKey) return Promise.resolve({ status: SEED_STATUS.FAILED })

    const running = inFlight.get(accountKey)
    if (running) return running

    const job = seed(accountKey)
        .then(({ status, cooled }) => {
            // Basari/iyilesme kaydi siler; yalniz GERCEK bir basarisizlik pencereyi baslatir
            // (onbellekten donen sonuc sureyi yenilemez).
            if (status !== SEED_STATUS.FAILED) failedAt.delete(accountKey)
            else if (!cooled) failedAt.set(accountKey, Date.now())
            return { status }
        })
        .finally(() => { if (inFlight.get(accountKey) === job) inFlight.delete(accountKey) })
    inFlight.set(accountKey, job)
    return job
}

/** Yalniz testler icin: devam eden isleri ve basarisizlik onbellegini sifirlar. */
export function resetDefaultTokenSeed() {
    inFlight.clear()
    failedAt.clear()
}
