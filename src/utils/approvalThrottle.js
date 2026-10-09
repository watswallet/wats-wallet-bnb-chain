// Onay penceresi ACMA kisitlayicisi (origin basina) -- SAF katman.
//
// NEDEN: bagli olmayan HER sayfa imza/gonderim penceresi actirabilir. Yuksek degerli
// ekranda (Permit, Seaport) bu bir tiklama yarisidir: kullanici A penceresinde "Imzala"yi
// hedeflerken B penceresi imlecin altinda acilir; kotu bir sekme mesru imzayi oldurebilir.
// Ayristirma (256 KiB JSON) mutex'ten ONCE kostugu icin spam CPU da yer. Bu modul
// ayristirmadan ONCE cagrilir (cagiran: typed data / imza / gonderim isleyicileri).
//
// KURAL:
//   1) Kayan pencere: ayni origin 10 sn icinde EN FAZLA 3 pencere acabilir.
//   2) Ret sonrasi geri cekilme: kullanici bir istegi GERCEKTEN REDDEDINCE (Reddet
//      dugmesi veya pencereyi kendisi kapatir; cagiran noteApprovalRejected'i cagirir)
//      o origin 2 sn engellenir; art arda her ret (120 sn icinde) engeli ikiye katlar,
//      ust sinir 60 sn. Ayni origin'in yeni isteginin eskiyi 4001 ile ezmesi, programatik
//      ret ve zaman asimi kullanici reti DEGILDIR: noteApprovalRejected'i CAGIRMAZLAR.
//
// KARARLAR (bozulursa sessiz kayma olur):
//   - checkApprovalThrottle KONTROL ETTIGI GIBI KAYDEDER: ok:true donen cagri bir pencere
//     hakkini TUKETIR. Reddedilen (ok:false) cagri hicbir sey kaydetmez; yani bir saldirgan
//     kendi engelini istek yagdirarak UZATAMAZ.
//   - 'Unknown' origin (cozumlenemeyen gonderen) TEK paylasilan kayittir.
//   - Durum BELLEKTEDIR (service worker yeniden baslarsa sifirlanir; kabul edilen sinir).
//   - Bellek sinirli: en fazla 500 origin izlenir; asinca once bosta kalanlar, sonra en eski
//     kayit atilir. Atilan origin'in sayaci sifirlanir (bu sinirin bedeli).
//   - Saat geriye giderse kayitli zamanlar yeni saate cekilir (kalici engel olusmaz).
//   - Gecersiz saat okumasi (NaN, sonsuz) yok sayilir: son gecerli okuma kullanilir
//     (hic gecerli okuma yoksa 0). Aksi halde NaN damgasi budanamaz, origin sonsuza dek engellenirdi.
//
// Hata cevabini CAGIRAN kurar: { code: -32005, message: 'Rate limited' }.

export const APPROVAL_THROTTLE_LIMITS = Object.freeze({
    windowMs: 10_000,
    maxInWindow: 3,
    backoffBaseMs: 2_000,
    backoffMaxMs: 60_000,
    streakResetMs: 120_000,
    maxTrackedOrigins: 500,
    maxOriginLength: 256,
})

export function createApprovalThrottle({ now = () => Date.now(), limits = {} } = {}) {
    const cfg = { ...APPROVAL_THROTTLE_LIMITS, ...limits }
    // origin -> { stamps: number[], blockedUntil, streak, lastRejectAt, lastSeen }
    const states = new Map()
    // Son gecerli saat okumasi (modul kapanisi; tum origin'ler icin ortak).
    let lastGoodNow = null

    // Saati okur; gecersiz (NaN/sonsuz/sayi degil) okuma son gecerli okumayla degistirilir.
    function readClock() {
        const t = now()
        if (Number.isFinite(t)) {
            lastGoodNow = t
            return t
        }
        return lastGoodNow === null ? 0 : lastGoodNow
    }

    const keyOf = (origin) =>
        typeof origin === 'string' && origin !== '' ? origin.slice(0, cfg.maxOriginLength) : 'Unknown'

    function newState() {
        return { stamps: [], blockedUntil: 0, streak: 0, lastRejectAt: 0, lastSeen: 0 }
    }

    // Saat geri gittiyse "gelecekteki" zamanlari simdiye cek.
    function normalizeClock(s, t) {
        if (t < s.lastSeen) {
            s.stamps = s.stamps.map((x) => Math.min(x, t))
            s.blockedUntil = Math.min(s.blockedUntil, t + cfg.backoffMaxMs)
            s.lastRejectAt = Math.min(s.lastRejectAt, t)
        }
        s.lastSeen = t
    }

    function pruneStamps(s, t) {
        while (s.stamps.length > 0 && s.stamps[0] <= t - cfg.windowMs) s.stamps.shift()
    }

    // Bosta = su an hicbir kisit uretmeyen kayit; atilirsa davranis degismez.
    function isIdle(s, t) {
        const lastStamp = s.stamps.length > 0 ? s.stamps[s.stamps.length - 1] : -Infinity
        return (
            lastStamp + cfg.windowMs <= t &&
            s.blockedUntil <= t &&
            (s.streak === 0 || t - s.lastRejectAt >= cfg.streakResetMs)
        )
    }

    function touch(key, s, t) {
        states.delete(key)
        states.set(key, s)
        if (states.size <= cfg.maxTrackedOrigins) return
        for (const [k, v] of states) {
            if (k !== key && isIdle(v, t)) states.delete(k)
        }
        for (const k of states.keys()) {
            if (states.size <= cfg.maxTrackedOrigins) break
            if (k !== key) states.delete(k)
        }
    }

    function check(origin) {
        const t = readClock()
        const key = keyOf(origin)
        const s = states.get(key) || newState()
        normalizeClock(s, t)
        pruneStamps(s, t)

        if (s.blockedUntil > t) {
            touch(key, s, t)
            return { ok: false, retryAfterMs: Math.ceil(s.blockedUntil - t) }
        }
        if (s.stamps.length >= cfg.maxInWindow) {
            touch(key, s, t)
            return { ok: false, retryAfterMs: Math.ceil(s.stamps[0] + cfg.windowMs - t) }
        }
        s.stamps.push(t)
        touch(key, s, t)
        return { ok: true }
    }

    function noteRejected(origin) {
        const t = readClock()
        const key = keyOf(origin)
        const s = states.get(key) || newState()
        normalizeClock(s, t)
        pruneStamps(s, t)

        if (s.streak > 0 && t - s.lastRejectAt >= cfg.streakResetMs) s.streak = 0
        s.streak += 1
        s.lastRejectAt = t
        const backoff = Math.min(cfg.backoffBaseMs * 2 ** (s.streak - 1), cfg.backoffMaxMs)
        s.blockedUntil = Math.max(s.blockedUntil, t + backoff)
        touch(key, s, t)
    }

    return {
        check,
        noteRejected,
        reset() {
            states.clear()
        },
    }
}

// Tek paylasilan ornek: service worker'in tum onay yollari ayni sayaci kullanir.
const shared = createApprovalThrottle()

// -> { ok: true } | { ok: false, retryAfterMs }
export function checkApprovalThrottle(origin) {
    return shared.check(origin)
}

// Kullanici bu origin'in istegini GERCEKTEN REDDETTI (Reddet dugmesi veya pencereyi kendisi
// kapatti): geri cekilmeyi baslat. Yeni istegin eskiyi ezmesi / zaman asimi icin CAGRILMAZ.
export function noteApprovalRejected(origin) {
    shared.noteRejected(origin)
}

// Yalniz testler icin: paylasilan sayaci sifirlar.
export function resetApprovalThrottle() {
    shared.reset()
}
