// Gunluk kullanim istatistigi ping'i.
//
// SERT KURALLAR (degistirmeden once spec'e bak):
//   - ONAY MODELI: analytics_enabled === true ise kabul edilmistir. false = reddetti/kapatti,
//     KAYIT YOK = KARAR VERMEDI ve KAPALI. Karar verilmeden HICBIR istek gitmez, sayac
//     yazilmaz, kimlik uretilmez (Chrome Web Store: toplamadan once acik eylemle onay).
//   - Govde { installId, version, locale, counts? }. `counts` YALNIZ islem ADETLERI
//     (transfer, swap, bridge, walletImport, walletCreate; her biri 1..10000 tam sayi).
//     Adres, tutar, token, zincir, tx hash, dapp origin, zaman damgasi, anahtar,
//     bakiye ASLA gonderilmez ve saklanmaz. Sifir olan anahtar gonderilmez; hepsi
//     sifirsa `counts` alani HIC yoktur. (Kullanici bu genislemeyi onayladi; eski
//     "yalniz uc alan" kurali bu yuzden degisti. Spec: 2026-11-06-analytics-sayaclar-design.md)
//   - Fazla sayim kabul edilmez, eksik sayim kabul edilir (sayilar ALT SINIRDIR).
//   - Kullanici kapatti ise HICBIR istek gitmez, sayac artmaz ve kimlik, birikmis
//     sayilar, bekleyen parti SILINIR (yeniden acinca sifirdan: kapatma gercekten
//     "unut" anlamina gelsin).
//   - Gizli hesap aktifken HICBIR istek gitmez, sayac ARTMAZ ve kimlik bile URETILMEZ. Kapi IKI KATMANLIDIR: cagiran
//     (arka plan) kimlikle hesaplanmis `privateMode` verir (isPrivateIdentity: `private` bayragi YA DA kasadaki
//     kayitla ayni adres / key / turetme yolu; bayragi dusmus eski bir Gizli Hesap kaydi da durdurur) ve modul
//     depodaki `active_account.private === true` bayragina ayrica bakar (countAction da ayni iki katman: cagiran
//     `privateMode` verir, modul bayraga ayrica bakar). Ikisinden biri yeter; bu modul hesap adresine ve kasaya
//     DOKUNMAZ (privacy/privacyAnalyticsPing.test.js kilitler).
//   - Ag hatasi sessizdir: ping yan bir ozellik, hicbir akisi bozmamali. Gun
//     ilerletilmez; son deneme ani kalici tutulur ve 30 dk sonra tekrar denenir.
//   - Kalici 4xx (408/429 haric) -> retryNotBefore ile 24 saat beklenir.
//   - Sayac TEK YAZARLI: yalniz service worker (countAction) ve ping'in cikarmasi
//     yazar, ikisi de ayni seri kuyruktan gecer. UI baglamlari ANALYTICS_COUNT
//     mesaji yollar, sayaca dogrudan yazmaz.
//
// Depolanan durum:
//   analytics_state  = { installId, lastPingDay?, lastAttemptAt?, retryNotBefore?, pendingBatch? }
//   analytics_counts = { transfer?, swap?, bridge?, walletImport?, walletCreate? }
//   pendingBatch     = { day, counts }: o UTC gununde gonderilmeye calisilan AYNI goruntu
//                      (yeniden denemede guncel sayac degil bu gider; basarida YALNIZ bu
//                      sayidan cikarilir, aradaki artis korunur).
//
// Bu dosyada ag/Chrome yok: `storage` ve `post` disaridan verilir (test icin).

export const ANALYTICS_ENABLED_KEY = 'analytics_enabled'
export const ANALYTICS_STATE_KEY = 'analytics_state'
export const ANALYTICS_COUNTS_KEY = 'analytics_counts'

// Sunucudaki COUNT_KINDS ile AYNI olmali. Bilinmeyen anahtar govdeye girmez.
export const COUNT_KINDS = ['transfer', 'swap', 'bridge', 'walletImport', 'walletCreate']
export const MAX_COUNT = 10000

// Sayac ve ping cikarmasi icin TEK seri kuyruk (txStorage.withStorageList deseni, nesne
// icin). Amac: artirma ile ping'in cikarmasi birbirinin degerini ezmesin.
let countQueue = Promise.resolve()
function enqueue(job) {
    const run = countQueue.then(job)
    countQueue = run.catch(() => {})
    return run
}

// Depodan gelen her degere guvenilmez: yalniz bilinen anahtarlar, 1..MAX_COUNT tam sayilar.
function cleanCounts(raw) {
    const out = {}
    if (!raw || typeof raw !== 'object') return out
    for (const k of COUNT_KINDS) {
        const v = raw[k]
        if (Number.isInteger(v) && v >= 1) out[k] = Math.min(v, MAX_COUNT)
    }
    return out
}

function subtractCounts(current, taken) {
    const out = {}
    for (const k of COUNT_KINDS) {
        const left = (current[k] || 0) - (taken[k] || 0)
        if (left >= 1) out[k] = left
    }
    return out
}

const isEmpty = (o) => Object.keys(o).length === 0

// Sayaci VE durumu TEK storage.set ile yaz (atomik). NEDEN: iki ayri yazim arasinda
// service worker olurse, gonderilen parti sayacta kalir ve ertesi gun TEKRAR giderdi
// (fazla sayim). Sayac bossa anahtar silinmez, bos nesne yazilir (cleanCounts bos okur);
// silmek ikinci bir adim olurdu.
async function writeCounts(storage, counts, extra = {}) {
    await storage.set({ ...extra, [ANALYTICS_COUNTS_KEY]: counts })
}

// Bir islem GONDERILDI (hash / emir kimligi alindi) anini say. Kapilar (biri tutarsa
// HICBIR sey yazilmaz): derleme bayragi, kullanici tercihi, gizli hesap. Gizli kontrolu
// ping'inkiyle AYNI (active_account.private === true). Asla firlatmaz.
export function countAction({ storage, kind, buildEnabled = true, privateMode = false }) {
    if (privateMode) return Promise.resolve(false)
    if (!buildEnabled || !COUNT_KINDS.includes(kind)) return Promise.resolve(false)
    return enqueue(async () => {
        const stored = await storage.get([ANALYTICS_ENABLED_KEY, 'active_account', ANALYTICS_COUNTS_KEY])
        if (stored[ANALYTICS_ENABLED_KEY] !== true) return false
        if (stored.active_account?.private === true) return false
        const counts = cleanCounts(stored[ANALYTICS_COUNTS_KEY])
        counts[kind] = Math.min((counts[kind] || 0) + 1, MAX_COUNT)
        await storage.set({ [ANALYTICS_COUNTS_KEY]: counts })
        return true
    }).catch(() => false)
}

// Gizlilik politikasi baglantisi (onay popup'indaki 'Politikayi oku').
export const PRIVACY_POLICY_URL = 'https://watswallet.github.io/privacy-policy/'

// Sunucudaki LOCALE regex'iyle AYNI olmali (server/utils/analytics.js); uymayan
// bir deger ping'i 400 ile REDDETTIRIR ve sessizce hic sayilmazdi.
const LOCALE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/

export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10)

export const pingLocale = (raw) => (typeof raw === 'string' && LOCALE.test(raw) ? raw : 'en')

// `enabled` YALNIZ `true` ise acik sayilir: kayit yok (undefined) = karar yok = KAPALI.
export function shouldPing({ enabled, privateMode, lastPingDay, today }) {
    if (enabled !== true) return false
    if (privateMode) return false
    return lastPingDay !== today
}

// Kimlik, bekleyen parti VE birikmis sayilar birlikte silinir.
async function forget(storage) {
    await storage.remove(ANALYTICS_STATE_KEY)
    await storage.remove(ANALYTICS_COUNTS_KEY)
}

export async function readAnalyticsEnabled(storage) {
    const stored = await storage.get(ANALYTICS_ENABLED_KEY)
    return stored[ANALYTICS_ENABLED_KEY] === true
}

// Kullanici bir karar verdi mi (kabul VEYA ret)? Onay popup'u yalniz karar yokken cikar.
export async function readAnalyticsDecided(storage) {
    const stored = await storage.get(ANALYTICS_ENABLED_KEY)
    return typeof stored[ANALYTICS_ENABLED_KEY] === 'boolean'
}

export async function setAnalyticsEnabled(storage, enabled) {
    await storage.set({ [ANALYTICS_ENABLED_KEY]: enabled === true })
    if (!enabled) await forgetQueued(storage)
}

// Silme, sayac yazimlariyla AYNI seri kuyruktan gecer: kuyruktaki bir artis kapatmadan
// sonra sayaci geri yazamaz. Baska bir baglamdan (UI) kapatilirsa service worker
// storage.onChanged ile bunu cagirir (background.js).
export function forgetQueued(storage) {
    return enqueue(() => forget(storage)).catch(() => {})
}

// Ag hatasindan sonra yeniden deneme beklemesi. NEDEN KALICI (storage'da): tetik
// dakikalik ve service worker her dakika olup dogabilir; bellekteki bir sayac her
// dogusta sifirlanir, ag hatasinda dakikada bir istek atilirdi. Export EDILMEZ:
// yalniz bu modulun politikasi.
const RETRY_AFTER_MS = 30 * 60 * 1000

// Kalici 4xx (sozlesme kaymasi, uc kaldirilmis) sonrasi bekleme. NEDEN: yayimlanan
// istemci davranisi sonradan degistirilemez; sunucu kalici reddederse tum filo
// 30 dk'da bir (gunde 48 kez) dener. Export EDILMEZ: yalniz bu modulun politikasi.
const PERMANENT_RETRY_MS = 24 * 60 * 60 * 1000

// 408 (zaman asimi) ve 429 (hiz siniri) gecicidir; geri kalan 4xx kalicidir.
// NEDEN yanitsiz hata kalici sayilmaz: durum kodu yoksa ag/SW sorunudur, 30 dk yeter.
function isPermanentRejection(err) {
    const status = err?.response?.status
    return typeof status === 'number' && status >= 400 && status <= 499 && status !== 408 && status !== 429
}

// Kullanici okuma ile yazma arasinda ya da gonderim sirasinda kapattiysa,
// gonderim oncesi yazilan durumu da sil: 'kapatinca kimlik silinir' kurali
// ucustaki bir ping'le yarisabilir.
async function forgetIfDisabled(storage) {
    return !(await enqueueIfEnabled(storage, async () => {}))
}

// Kuyrukta, tercihi YENIDEN okuyarak calistirir; kapaliysa her sey silinir, is calismaz.
async function enqueueIfEnabled(storage, job) {
    return enqueue(async () => {
        const latest = await storage.get(ANALYTICS_ENABLED_KEY)
        if (latest[ANALYTICS_ENABLED_KEY] !== true) {
            await forget(storage)
            return false
        }
        await job()
        return true
    })
}

export async function runAnalyticsPing({
    storage, post, version, locale, privateMode = false, now = new Date(), makeId = () => crypto.randomUUID(),
}) {
    const stored = await storage.get([ANALYTICS_ENABLED_KEY, ANALYTICS_STATE_KEY, 'active_account'])
    const today = utcDay(now)
    const state = stored[ANALYTICS_STATE_KEY] && typeof stored[ANALYTICS_STATE_KEY] === 'object'
        ? stored[ANALYTICS_STATE_KEY] : {}

    const go = shouldPing({
        enabled: stored[ANALYTICS_ENABLED_KEY],
        privateMode: Boolean(privateMode) || stored.active_account?.private === true,
        lastPingDay: state.lastPingDay,
        today,
    })
    if (!go) return { sent: false }

    // Son (basarisiz/askidaki) denemeden bu yana 30 dk gecmediyse bekle. NEDEN
    // `since >= 0`: saat geri alinirsa (since < 0) bekleme uzamasin; aksi halde
    // ping geri alma suresi kadar durabilirdi.
    const since = now.getTime() - state.lastAttemptAt
    if (typeof state.lastAttemptAt === 'number' && since >= 0 && since < RETRY_AFTER_MS) {
        return { sent: false }
    }

    // Kalici ret beklemesi. NEDEN fark <= PERMANENT_RETRY_MS: saat geri alinmissa
    // retryNotBefore 24 saatten uzak gelecekte kalir; yok sayilir (lastAttemptAt ile
    // ayni ruh), yoksa ping geri alma suresi kadar durabilirdi.
    if (typeof state.retryNotBefore === 'number') {
        const wait = state.retryNotBefore - now.getTime()
        if (wait > 0 && wait <= PERMANENT_RETRY_MS) return { sent: false }
    }

    // Kimlik, deneme ani ve bekleyen parti gonderimden ONCE, HER denemede yazilir:
    //   1) yanit yolda kaybolursa sunucu bu kimligi kaydetmis olabilir; yeniden
    //      denemede yeni kimlik uretmek ayni kurulumu iki kez saydirirdi,
    //   2) `lastAttemptAt` yeniden deneme beklemesini kalici kilar (RETRY_AFTER_MS),
    //   3) `pendingBatch` yeniden denemede AYNI goruntunun gitmesini saglar.
    // Parti kurulumu sayac kuyrugunda: arada gelen artis goruntuye girmez, kaybolmaz.
    const installId = typeof state.installId === 'string' && state.installId ? state.installId : makeId()
    const keep = state.lastPingDay ? { lastPingDay: state.lastPingDay } : {}
    const batch = await enqueue(async () => {
        const fresh = await storage.get([ANALYTICS_ENABLED_KEY, ANALYTICS_COUNTS_KEY, ANALYTICS_STATE_KEY])
        if (fresh[ANALYTICS_ENABLED_KEY] !== true) {
            await forget(storage)
            return null
        }
        const current = cleanCounts(fresh[ANALYTICS_COUNTS_KEY])
        const old = fresh[ANALYTICS_STATE_KEY]?.pendingBatch
        const oldOk = old && typeof old === 'object' && typeof old.day === 'string'
        let counts
        let remaining = current
        if (oldOk && old.day === today) {
            counts = cleanCounts(old.counts)
        } else {
            // Gun degisti: yanit kaybolduysa sunucu eski partiyi yazmis olabilir; ulasip
            // ulasmadigi bilinmez. Parti ATILIR, goruntusu sayactan CIKARILIR (en fazla
            // bir parti eksik sayilir, fazla sayim olmaz).
            if (oldOk) remaining = subtractCounts(current, cleanCounts(old.counts))
            counts = { ...remaining }
        }
        const statePatch = {
            [ANALYTICS_STATE_KEY]: {
                installId,
                ...keep,
                lastAttemptAt: now.getTime(),
                ...(isEmpty(counts) ? {} : { pendingBatch: { day: today, counts } }),
            },
        }
        if (oldOk && old.day !== today) await writeCounts(storage, remaining, statePatch)
        else await storage.set(statePatch)
        return counts
    })

    if (batch === null) return { sent: false }

    const body = { installId, version, locale, ...(isEmpty(batch) ? {} : { counts: batch }) }

    try {
        await post(body)
    } catch (err) {
        if (await forgetIfDisabled(storage)) return { sent: false, error: true }
        if (isPermanentRejection(err)) {
            // Kuyrukta ve kapatma kontroluyle: arada kapatilirsa kimlik geri yazilmaz.
            const yazildi = await enqueueIfEnabled(storage, () => storage.set({
                [ANALYTICS_STATE_KEY]: {
                    installId,
                    ...keep,
                    lastAttemptAt: now.getTime(),
                    retryNotBefore: now.getTime() + PERMANENT_RETRY_MS,
                    ...(isEmpty(batch) ? {} : { pendingBatch: { day: today, counts: batch } }),
                },
            }))
            if (!yazildi) return { sent: false, error: true }
            return { sent: false, error: true, permanent: true }
        }
        return { sent: false, error: true }
    }

    // Gonderim sirasinda kullanici kapatmis olabilir: kapatma kimligi SILER, ama
    // asagidaki yazim onu geri getirirdi -- "kapatinca kimlik silinir" sozu
    // ucustaki bir ping'le yarisirdi. Tercih yeniden okunur; kapaliysa durum ve
    // sayac (gonderim oncesi yazilan dahil) temizlenir ve geri yazilmaz.
    // Basari: yalniz GONDERILEN goruntu sayactan cikarilir; arada gelen artis kalir.
    // Kapatma kontrolu YAZIMLA AYNI kuyruk isinde: kontrol ile yazim arasina kapatma
    // giremez. Durum + sayac tek set ile gider (kesintide fazla sayim yok).
    await enqueueIfEnabled(storage, async () => {
        const fresh = await storage.get(ANALYTICS_COUNTS_KEY)
        const left = subtractCounts(cleanCounts(fresh[ANALYTICS_COUNTS_KEY]), batch)
        await writeCounts(storage, left, { [ANALYTICS_STATE_KEY]: { installId, lastPingDay: today } })
    })
    return { sent: true }
}
