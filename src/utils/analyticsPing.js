// Gunluk kullanim istatistigi ping'i.
//
// SERT KURALLAR (degistirmeden once spec'e bak):
//   - Govde YALNIZ { installId, version, locale }. Adres/anahtar/bakiye ASLA.
//   - Kullanici kapatti ise HICBIR istek gitmez ve kimlik SILINIR (yeniden acinca
//     yeni kimlik: kapatma gercekten "unut" anlamina gelsin).
//   - Gizli hesap aktifken HICBIR istek gitmez ve kimlik bile URETILMEZ.
//   - Ag hatasi sessizdir: ping yan bir ozellik, hicbir akisi bozmamali. Gun
//     ilerletilmez; son deneme ani kalici tutulur ve 30 dk sonra tekrar denenir.
//   - Kalici 4xx (408/429 haric) -> retryNotBefore ile 24 saat beklenir.
//
// Depolanan durum: analytics_state = { installId, lastPingDay?, lastAttemptAt?, retryNotBefore? }
//
// Bu dosyada ag/Chrome yok: `storage` ve `post` disaridan verilir (test icin).

export const ANALYTICS_ENABLED_KEY = 'analytics_enabled'
export const ANALYTICS_STATE_KEY = 'analytics_state'

// Bir kerelik bilgilendirme kartinin 'goruldu' isareti. NEDEN ayri anahtar ve
// tercihten bagimsiz: 'Tamam' tercihi degistirmez, 'Kapat' ise ikisini birden yazar.
// storage.clear (cuzdan sifirlama) bunu da siler -> kart yeniden gosterilir (beklenen).
export const ANALYTICS_NOTICE_KEY = 'analytics_notice_seen'

// Sunucudaki LOCALE regex'iyle AYNI olmali (server/utils/analytics.js); uymayan
// bir deger ping'i 400 ile REDDETTIRIR ve sessizce hic sayilmazdi.
const LOCALE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/

export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10)

export const pingLocale = (raw) => (typeof raw === 'string' && LOCALE.test(raw) ? raw : 'en')

// `enabled` YALNIZ `false` ise kapali sayilir: kayit yok (undefined) = varsayilan ACIK.
export function shouldPing({ enabled, privateMode, lastPingDay, today }) {
    if (enabled === false) return false
    if (privateMode) return false
    return lastPingDay !== today
}

export async function readAnalyticsEnabled(storage) {
    const stored = await storage.get(ANALYTICS_ENABLED_KEY)
    return stored[ANALYTICS_ENABLED_KEY] !== false
}

export async function setAnalyticsEnabled(storage, enabled) {
    await storage.set({ [ANALYTICS_ENABLED_KEY]: enabled === true })
    if (!enabled) await storage.remove(ANALYTICS_STATE_KEY)
}

// NEDEN yalniz `true` goruldu sayilir: bozuk bir deger karti sessizce gizlemesin;
// kullanici bilgilendirilmeden ping surerdi.
export async function readAnalyticsNoticeSeen(storage) {
    const stored = await storage.get(ANALYTICS_NOTICE_KEY)
    return stored[ANALYTICS_NOTICE_KEY] === true
}

export async function markAnalyticsNoticeSeen(storage) {
    await storage.set({ [ANALYTICS_NOTICE_KEY]: true })
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
    const latest = await storage.get(ANALYTICS_ENABLED_KEY)
    if (latest[ANALYTICS_ENABLED_KEY] !== false) return false
    await storage.remove(ANALYTICS_STATE_KEY)
    return true
}

export async function runAnalyticsPing({
    storage, post, version, locale, now = new Date(), makeId = () => crypto.randomUUID(),
}) {
    const stored = await storage.get([ANALYTICS_ENABLED_KEY, ANALYTICS_STATE_KEY, 'active_account'])
    const today = utcDay(now)
    const state = stored[ANALYTICS_STATE_KEY] && typeof stored[ANALYTICS_STATE_KEY] === 'object'
        ? stored[ANALYTICS_STATE_KEY] : {}

    const go = shouldPing({
        enabled: stored[ANALYTICS_ENABLED_KEY],
        privateMode: stored.active_account?.private === true,
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

    // Kimlik ve deneme ani gonderimden ONCE, HER denemede yazilir:
    //   1) yanit yolda kaybolursa sunucu bu kimligi kaydetmis olabilir; yeniden
    //      denemede yeni kimlik uretmek ayni kurulumu iki kez saydirirdi,
    //   2) `lastAttemptAt` yeniden deneme beklemesini kalici kilar (RETRY_AFTER_MS).
    const installId = typeof state.installId === 'string' && state.installId ? state.installId : makeId()
    await storage.set({
        [ANALYTICS_STATE_KEY]: {
            installId,
            ...(state.lastPingDay ? { lastPingDay: state.lastPingDay } : {}),
            lastAttemptAt: now.getTime(),
        },
    })

    try {
        await post({ installId, version, locale })
    } catch (err) {
        if (await forgetIfDisabled(storage)) return { sent: false, error: true }
        if (isPermanentRejection(err)) {
            await storage.set({
                [ANALYTICS_STATE_KEY]: {
                    installId,
                    ...(state.lastPingDay ? { lastPingDay: state.lastPingDay } : {}),
                    lastAttemptAt: now.getTime(),
                    retryNotBefore: now.getTime() + PERMANENT_RETRY_MS,
                },
            })
            return { sent: false, error: true, permanent: true }
        }
        return { sent: false, error: true }
    }

    // Gonderim sirasinda kullanici kapatmis olabilir: kapatma kimligi SILER, ama
    // asagidaki yazim onu geri getirirdi -- "kapatinca kimlik silinir" sozu
    // ucustaki bir ping'le yarisirdi. Tercih yeniden okunur; kapaliysa durum
    // (gonderim oncesi yazilan dahil) temizlenir ve geri yazilmaz.
    if (await forgetIfDisabled(storage)) return { sent: true }

    await storage.set({ [ANALYTICS_STATE_KEY]: { installId, lastPingDay: today } })
    return { sent: true }
}
