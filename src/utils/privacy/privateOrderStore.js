import { withStorageList } from '../txStorage'

// Gizli siparis kayitlari (spec 5.4) YALNIZ bu cihazda: chrome.storage.local.
// Sunucumuza HICBIR alan gitmez -- normal hesap ile Gizli Hesap arasindaki bag
// bizim sunucumuzda birikmemeli.
export const ORDERS_KEY = 'private_orders'
// Teklifler arka planda, oturum deposunda: PRIVATE_ORDER arayuzden yalniz ticket alir.
export const QUOTES_KEY = 'private_quotes'
export const PRIVATE_ORDERS_ALARM = 'private_orders'
// Iade uygunlugu zamanla dogar: sure dolunca rozeti yenileyen tek seferlik alarm (yoklama alarmindan ayri).
export const PRIVATE_BADGE_ALARM = 'private_orders_badge'
const QUOTE_TTL_MS = 30 * 60 * 1000

// Oturum deposu withStorageList kuyrugunun disindadir (o yalniz storage.local'i
// siralar): es zamanli iki teklif ayni eski haritayi okuyup birbirinin kaydini
// silerdi. Okuma-degistirme-yazma bu modul ici kuyrukta seri yapilir; bir cagrinin
// hatasi sonrakini tikamaz.
let quoteQueue = Promise.resolve()

export function saveQuoteRecord(session, record, now = Date.now()) {
    const run = quoteQueue.then(() => saveQuoteRecordNow(session, record, now))
    quoteQueue = run.catch(() => {})
    return run
}

async function saveQuoteRecordNow(session, record, now) {
    // ticket depo anahtari ve getOrder/iade argumanidir: bos ya da dizge olmayan deger
    // '' ya da 'undefined' adli bir kayit yazardi (T5 M4).
    const ticket = record?.quote?.ticket
    if (typeof ticket !== 'string' || !ticket) throw new Error('PRIVATE_UNSUPPORTED')
    const { [QUOTES_KEY]: all } = await session.get(QUOTES_KEY)
    const fresh = Object.fromEntries(
        Object.entries(all && typeof all === 'object' ? all : {})
            .filter(([, r]) => now - (r?.createdAt || 0) < QUOTE_TTL_MS))
    // defineProperty: `fresh['__proto__'] = ...` prototipi degistirir, kaydi OZ ozellik olarak
    // yazmaz (ticket sunucudan gelir; miras alinan adlar da kayit adi olabilir).
    Object.defineProperty(fresh, ticket, {
        value: { ...record, createdAt: now }, enumerable: true, writable: true, configurable: true,
    })
    await session.set({ [QUOTES_KEY]: fresh })
}

// Var olan teklif kaydina alan ekler/ustune yazar (ATS ucret teklifinin dondurdugu atsAllowanceRaw icin). saveQuoteRecord ile AYNI
// kuyrukta seri: es zamanli bir kayit okuma-degistirme-yazmayi bozmaz. Kayit yoksa ya da suresi dolmussa (loadQuoteRecord ile ayni
// kural) hicbir sey yazmaz ve false doner; yamalanirsa true. Var olan alanlar ve createdAt korunur.
export function patchQuoteRecord(session, ticket, patch, now = Date.now()) {
    const run = quoteQueue.then(() => patchQuoteRecordNow(session, ticket, patch, now))
    quoteQueue = run.catch(() => {})
    return run
}

async function patchQuoteRecordNow(session, ticket, patch, now) {
    if (typeof ticket !== 'string' || !ticket || !patch || typeof patch !== 'object') return false
    const { [QUOTES_KEY]: all } = await session.get(QUOTES_KEY)
    // Miras alinan ozellikler ('constructor', '__proto__') kayit degildir.
    if (!all || typeof all !== 'object' || !Object.prototype.hasOwnProperty.call(all, ticket)) return false
    const rec = all[ticket]
    if (!rec || typeof rec !== 'object') return false
    // Fail-closed: createdAt eksik/sayi degilse yas kanitlanamaz, kayit eski sayilir.
    if (!(now - rec.createdAt < QUOTE_TTL_MS)) return false
    const fresh = Object.fromEntries(Object.entries(all))
    Object.defineProperty(fresh, ticket, {
        value: { ...rec, ...patch, createdAt: rec.createdAt }, enumerable: true, writable: true, configurable: true,
    })
    await session.set({ [QUOTES_KEY]: fresh })
    return true
}

// Teklifin calistirilabilirligi sunucunun verdigi expiresAt'e TEK basina baglanmaz: kayit
// QUOTE_TTL_MS'ten eskiyse (ya da yasi bilinmiyorsa) yok sayilir. Sunucu degeri pinlenmedigi icin
// (cok ileri ya da yanlis birimli olabilir) bu, oturum sonuna dek calistirilabilir teklifi onler.
export async function loadQuoteRecord(session, ticket, now = Date.now()) {
    if (typeof ticket !== 'string' || !ticket) return null
    const { [QUOTES_KEY]: all } = await session.get(QUOTES_KEY)
    // Miras alinan ozellikler ('constructor', '__proto__') kayit degildir.
    if (!all || typeof all !== 'object' || !Object.prototype.hasOwnProperty.call(all, ticket)) return null
    const rec = all[ticket]
    if (!rec || typeof rec !== 'object') return null
    // Fail-closed: createdAt eksik/sayi degilse yas kanitlanamaz, kayit eski sayilir.
    if (!(now - rec.createdAt < QUOTE_TTL_MS)) return null
    return rec
}

// Depodaki bozuk girdiler (null, ilkel, ticket'siz) kayit yollarini ve rozeti bozmasin: yalniz
// dizge ticket tasiyan duz nesneler siparistir (B:M5).
const isOrderEntry = (o) => !!o && typeof o === 'object' && !Array.isArray(o) && typeof o.ticket === 'string'

export async function listOrders(storage = chrome.storage.local) {
    const { [ORDERS_KEY]: list } = await storage.get(ORDERS_KEY)
    return Array.isArray(list) ? list.filter(isOrderEntry) : []
}

// Bos/eksik bir guncelleme bu alanlari ASLA silmez: eski bir anlik goruntuden
// gelen refundTxHash:null iadesi yapilmis siparisi yeniden iade edilebilir
// gosterirdi; accessToken kaybi yoklamayi, depositTxHash kaybi DROPPED
// kurtarmasini keserdi.
const STICKY_FIELDS = ['refundTxHash', 'depositTxHash', 'accessToken']

// Birlestirme kurali (upsert ve updateOrder ortak): yapiskan alanlar bos yamayla silinmez;
// depositFailed bir kez true olduysa HICBIR yama onu silmez ya da false yapmaz. Kayit okunurken
// baslamis bir yoklama AWAITING_DEPOSIT ile donse de basarisiz yatirma terminal kalir (T14 M2).
function mergeOrder(existing, patch) {
    const merged = { ...existing, ...patch }
    for (const k of STICKY_FIELDS) if (existing[k] && !patch[k]) merged[k] = existing[k]
    if (existing.depositFailed === true) merged.depositFailed = true
    return merged
}

export function upsertOrder(order) {
    return withStorageList(ORDERS_KEY, (list) => {
        const i = list.findIndex((o) => o?.ticket === order.ticket)
        if (i === -1) {
            list.unshift(order)
        } else {
            list[i] = mergeOrder(list[i], order)
        }
        return list
    })
}

// Var olan kaydi yamalar; kayit YOKSA olusturmaz (upsertOrder'in tersi) ve hic yazmaz.
// Para yolunda yatirma basarisiz olunca "depositFailed" isareti icin ve yoklama icin: kayit hic
// yoksa (yazimi basarisiz olmus ya da sifirlama ile silinmis) hayalet bir siparis dogmamali.
// Kayit bulunup yamalandiysa true doner.
export async function updateOrder(ticket, patch) {
    if (typeof ticket !== 'string' || !ticket || !patch || typeof patch !== 'object') return false
    let found = false
    await withStorageList(ORDERS_KEY, (list) => {
        const i = list.findIndex((o) => o?.ticket === ticket)
        if (i === -1) return undefined
        found = true
        list[i] = { ...mergeOrder(list[i], patch), ticket }
        return list
    })
    return found
}

// Iade kaydini TEMIZLER (refundTxHash yapiskan oldugu icin updateOrder ile silinemez): iade
// islemi dusmedi/revert oldu, Iade dugmesi geri gelmeli. refundFailed:true yazilir ve kayittaki
// durum goruntusunun refundTxHash'i de null'lanir (yoksa iade uygunlugu "settled" kalirdi).
// Geri alinan iadenin hash'i tanilama/gosterim icin lastFailedRefundTxHash alaninda KALIR (yapiskan
// degildir, ancak updateOrder yamasi onu silmez; bir sonraki basarisiz iade uzerine yazar).
// Kayit yoksa hic yazmaz, false doner.
//
// `expectedHash` (makbuzu sorgulanan iadenin hash'i) verilirse TEMIZLE-VE-KARSILASTIR calisir: kayit
// SU AN baska bir iade hash'i tasiyorsa (H1 temizlendi, kullanici H2'yi gonderdi, H1'in gec gelen
// makbuzu) hicbir sey yazilmaz ve false doner; yoksa gec gelen sonuc H2'yi, refundFailed bayragini ve
// cagiranin bellek isaretini ezerdi. Kayit hash tasimiyorsa (kayit yazimi basarisiz olmustu ya da
// onceki iade zaten temizlendi) temizleme zararsizdir ve yapilir. Verilmezse kosulsuz temizler.
export async function clearRefund(ticket, expectedHash) {
    if (typeof ticket !== 'string' || !ticket) return false
    let found = false
    await withStorageList(ORDERS_KEY, (list) => {
        const i = list.findIndex((o) => o?.ticket === ticket)
        if (i === -1) return undefined
        if (expectedHash && list[i].refundTxHash && list[i].refundTxHash !== expectedHash) return undefined
        found = true
        // Ham iade baytlari da silinir: basarisiz iade bir daha yayinlanmaz.
        const cleared = { ...list[i], refundTxHash: null, rawRefundTx: null, refundAtsPendingAt: null, refundFailed: true, updatedAt: Date.now() }
        // Hash yoksa onceki tanilama degeri korunur (ikinci temizleme onu silmez).
        if (list[i].refundTxHash) cleared.lastFailedRefundTxHash = list[i].refundTxHash
        if (cleared.state && typeof cleared.state === 'object') cleared.state = { ...cleared.state, refundTxHash: null }
        list[i] = cleared
        return list
    })
    return found
}

const PROCESSING = new Set(['OPEN', 'FULFILLING', 'FULFILLED', 'CLAIM_READY'])

// Terminal olmayan bir siparis bu sureyi (createdAt'ten) asarsa kapanir: yoklama, rozet ve
// 'bekliyor' etiketi sonsuza dek surmesin. SDK'nin kendi izleyicisi 2 saatte birakir; DROPPED
// gec yatirmayla canlanabilir, bu yuzden 72 saat tanidik. Kapsadigi: hash'li DROPPED, kimsenin
// kapatmadigi AWAITING_DEPOSIT (reverted/belirsiz ATS yatirmasi), olu erisim anahtari.
export const ORDER_HORIZON_MS = 72 * 60 * 60 * 1000

// TEK siniflandirici: faz ve aciklik buradan turer (isOpenOrder ve orderPhase ayri kural
// tasimaz). Kurallar sirayla:
//  - bozuk girdi: problem, kapali
//  - refundTxHash: 'refunded', kapali
//  - depositFailed: durumdan bagimsiz 'problem', kapali (yatirma zincirde revert oldu)
//  - COMPLETED 'done'; FAILED/ABORTED 'problem' (terminal; iade dugmesi saklanan durumdan
//    gosterilir, YETKI ise iade aninda taze getOrder ile verilir)
//  - createdAt'ten 72 saat gecmis (gecerli sayi ise): 'problem', kapali. createdAt yoksa yas
//    bilinmez ve siparis KAPATILMAZ.
//  - DROPPED: hash'siz 'problem' kapali; hash'li ufuk icinde 'pending' acik (gec yatirma canlandirir)
//  - PROCESSING 'processing' acik; gerisi 'pending' acik
function classifyOrder(order, now) {
    const closed = (phase) => ({ phase, open: false })
    if (!order || typeof order !== 'object') return closed('problem')
    if (order.refundTxHash) return closed('refunded')
    if (order.depositFailed === true) return closed('problem')
    const s = order.status
    if (s === 'COMPLETED') return closed('done')
    if (s === 'FAILED' || s === 'ABORTED') return closed('problem')
    if (typeof order.createdAt === 'number' && Number.isFinite(order.createdAt) && now - order.createdAt > ORDER_HORIZON_MS) {
        return closed('problem')
    }
    if (s === 'DROPPED') return order.depositTxHash ? { phase: 'pending', open: true } : closed('problem')
    return { phase: PROCESSING.has(s) ? 'processing' : 'pending', open: true }
}

// `now` yalniz epoch MILISANIYE gibi gorunen sonlu sayi ise kullanilir (> 1e12, 2001'den sonrasi).
// Aksi halde Date.now(): `orders.filter(isOpenOrder)` / `.some(isOpenOrder)` kaliplari ikinci
// argumana dizi INDEKSINI verir; onu saat sanmak (now - createdAt hugely negatif) 72 saat
// ufkunu sessizce kapatirdi (T16 M2).
const EPOCH_MS_FLOOR = 1e12
const safeNow = (now) => (typeof now === 'number' && Number.isFinite(now) && now > EPOCH_MS_FLOOR ? now : Date.now())

export const orderPhase = (order, now) => classifyOrder(order, safeNow(now)).phase
export const isOpenOrder = (order, now) => classifyOrder(order, safeNow(now)).open

export function pickOrderState(s) {
    return {
        status: s?.status ?? null,
        signer: s?.signer ?? null,
        gateway: s?.gateway ?? null,
        expirationUnix: s?.expirationUnix ?? null,
        fulfilledOnchain: !!s?.fulfilledOnchain,
        refundTxHash: s?.refundTxHash ?? null,
        sourceChainKind: s?.sourceChainKind ?? 'evm',
        depositTxHash: s?.depositTxHash ?? null,
        recipients: (Array.isArray(s?.recipients) ? s.recipients : [])
            .map((r) => ({ status: r?.status ?? null, recipientTxHash: r?.recipientTxHash ?? null })),
    }
}

// SDK'nin executeRefund on kosullarinin birebir kopyasi (sdk/dist/client.js). Durum
// HER ZAMAN taze getOrder'dan gelmeli; yerel sayac yetki kaynagi DEGILDIR.
// nowSec SANIYE cinsinden (Date.now() / 1000) olmali. Sure kontrolu fail-closed:
// iki taraf da sonlu sayi degilse ya da nowSec > expirationUnix saglanmiyorsa iade
// acilmaz (NaN karsilastirmalari false doner; erken iade zincirde revert olup gaz yakar).
// 1e11 ustu nowSec milisaniye hatasi sayilir (saniye cinsinden yil ~5138'e denk gelir).
export function refundEligibility(state, signerAddress, nowSec) {
    const no = (reason) => ({ ok: false, reason })
    if (!state) return no('no-state')
    if ((state.sourceChainKind ?? 'evm') !== 'evm') return no('not-evm')
    if (state.refundTxHash || state.fulfilledOnchain) return no('settled')
    if (state.status !== 'OPEN' && state.status !== 'FAILED') return no('status')
    const recipients = Array.isArray(state.recipients) ? state.recipients : []
    if (recipients.some((r) => !(r.status === 'PENDING' || r.status === 'FAILED') || r.recipientTxHash)) {
        return no('recipient-in-flight')
    }
    if (!state.gateway || !state.expirationUnix) return no('missing-fields')
    const exp = Number(state.expirationUnix)
    const now = typeof nowSec === 'number' ? nowSec : NaN
    if (!Number.isFinite(exp) || !Number.isFinite(now) || now > 1e11 || !(now > exp)) {
        return no('not-expired')
    }
    if (typeof state.signer !== 'string' || state.signer.toLowerCase() !== String(signerAddress).toLowerCase()) {
        return no('signer')
    }
    return { ok: true }
}

const REFRESH_CONCURRENCY = 3

// Acik siparisleri en fazla 3 getOrder ile es zamanli yoklar. Ag/sunucu hatasi: kayit oldugu
// gibi kalir, sonraki turda yeniden denenir. Depo hatasi ise console.error ile gorunur olur
// (sessizce yutulmaz). Yazim YALNIZ var olan kaydi gunceller (updateOrder): sifirlama yarisinda
// silinmis kayit yeniden dogmaz.
export async function refreshOpenOrders({ client }) {
    const queue = (await listOrders()).filter((o) => isOpenOrder(o))
    const refreshOne = async (o) => {
        let raw
        try {
            raw = await client.getOrder({ id: o.ticket, privacy: true, accessToken: o.accessToken || undefined })
        } catch {
            return
        }
        // Nesne olmayan ya da status dizgesi tasimayan yanit durumu bozmasin (status null yazip kaydi silmesin).
        if (!raw || typeof raw !== 'object' || typeof raw.status !== 'string') return
        const state = pickOrderState(raw)
        try {
            await updateOrder(o.ticket, {
                status: state.status || o.status,
                state,
                refundTxHash: state.refundTxHash || null,
                updatedAt: Date.now(),
            })
        } catch (e) {
            console.error('[private] siparis durumu yazilamadi:', e)
        }
    }
    const worker = async () => {
        for (let o = queue.shift(); o; o = queue.shift()) await refreshOne(o)
    }
    await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, queue.length) }, worker))
    return listOrders()
}
