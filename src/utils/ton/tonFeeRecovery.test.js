import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// tonFeeRelay AG'a cikar. BU DOSYADA ASLA GERCEK BIR /relay CAGRISI YAPILMAZ:
// basarili bir relay ~18 ATS tahsil eder VE gercek bir TON islemi gonderir.
// TonFeeError GERCEK kalir - kurtarmanin verdigi her karar onun
// `code`/`httpStatus`/`settlementId`/`receipt` alanlarindan okunuyor, sahte bir
// hata sinifi o sozlesmeyi sinamazdi.
vi.mock('./tonFeeClient', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, tonFeeRelay: vi.fn() }
})

import {
    recoverTonSettlements,
    RECOVERY_TX_MESSAGES,
    TON_FEE_TX_STATES,
    TON_RELAY_TX_FLAG,
    ORPHAN_MIN_AGE_MS,
    RELAY_INFLIGHT_MIN_AGE_MS,
} from './tonFeeRecovery'
import { tonFeeRelay, TonFeeError } from './tonFeeClient'
import {
    _setTonSettlementStore,
    saveTonSettlement,
    updateTonSettlement,
    loadAllTonSettlements,
    tonSettlementKey,
} from './tonFeeSettlement'
import { TON_MAINNET_ID } from '../chainKind'

const SRC = readFileSync(fileURLToPath(new URL('./tonFeeRecovery.js', import.meta.url)), 'utf8')

const NOW = 1_700_000_000_000               // ms - sabit referans; testler gercek saate bagli degil
const NOW_SEC = Math.floor(NOW / 1000)
const FUTURE = NOW_SEC + 300                // deadline GECMEMIS (relay penceresi acik)
const PAST = NOW_SEC - 300                  // deadline GECMIS

const WALLET = 'EQD4joKxbphnt0bFfsaCb-KyJaydnMiLTTltGfrQB0mjzgJ2'
const ACTION_HASH = '0xbc7e0f3a254ff14e90eeb7591e1bc9781214a57c74416b2b897ab8deb4539f7f'
const KEY = tonSettlementKey({ tonWallet: WALLET, actionHash: ACTION_HASH })
const TX_ID = 'tx-1'

// chrome.storage.local'in get/set imzasini taklit eder (T5 testlerindeki ayni sekil).
// `failAfter`: bu sayidan SONRAKI her set() FIRLAR - "yazma sessizce dusuyor" durumunu
// (kota asimi, IO hatasi) uretmek icin; updateTonSettlement/clearTonSettlement bunu
// YUTAR ve cagirana hicbir sey soylemez (Task 6'dan tasinan yukumluluk 2).
function fakeStore(initial = {}) {
    let data = { ...initial }
    const store = {
        sets: 0,
        failAfter: Infinity,
        async get(key) { return { [key]: data[key] } },
        async set(obj) {
            store.sets += 1
            if (store.sets > store.failAfter) throw new Error('kota asimi')
            data = { ...data, ...obj }
        },
    }
    return store
}

let store

const baseRec = (over = {}) => ({
    tonWallet: WALLET,
    actionHash: ACTION_HASH,
    quoteId: 'q-1',
    payloadBoc: 'te6ccgEB',
    signature: '0xaaaa',
    feeAuthSignature: '0xbbbb',
    atsFee: '18140000000000000000',
    seqno: 7,
    deadline: FUTURE,
    phase: 'relay-inflight',
    txId: TX_ID,
    ...over,
})

async function seed(rec = baseRec()) {
    store = fakeStore()
    _setTonSettlementStore(store)
    await saveTonSettlement(rec)
    // `savedAt`i saveTonSettlement GERCEK saatle damgaliyor; testler ise sabit
    // NOW kullaniyor. Ucus-korumasi (RELAY_INFLIGHT_MIN_AGE_MS) bu farki okudugu
    // icin kaydi BILEREK "yeterince eski" yapiyoruz: bu dosyadaki kurtarma
    // senaryolarinin TAMAMI "SW oldu, makbuz bir sure once diske indi" durumunu
    // anlatir. Koruma DAVRANISI kendi testlerinde ayrica olculur (asagida).
    // `saveTonSettlement` `savedAt`i HER ZAMAN kendi damgasiyla EZER, yani kayittaki
    // deger yazilmaz - bu yuzden yama KAYITTAN SONRA gelir.
    const savedAt = Object.prototype.hasOwnProperty.call(rec, 'savedAt')
        ? rec.savedAt
        : NOW - RELAY_INFLIGHT_MIN_AGE_MS - 1000
    await updateTonSettlement(tonSettlementKey(rec), { savedAt })
    store.sets = 0          // seed yazmasi sayilmaz: failAfter testleri kurtarmanin KENDI yazmalarini olcer
    return rec
}

function deps(over = {}) {
    return {
        // Varsayilan: seqno ILERLEMEDI (kayittaki ile ayni) - adim 2 tetiklenmez.
        getSeqnoFor: vi.fn(async () => 7),
        findActionOnChain: vi.fn(async () => 'unknown'),
        updateTxStatus: vi.fn(async () => {}),
        listTransactions: vi.fn(async () => []),
        now: NOW,
        ...over,
    }
}

const recOf = async () => (await loadAllTonSettlements())[KEY]
const wroteStatus = (fn, status) => fn.mock.calls.filter((c) => c[1] === status)
// Islem kartina giden meta: TransactionStatus.vue `tx.meta.tonFeeState` ve
// `tx.meta.settlementId` okuyor (Task 8).
const metaFor = (fn, status) => wroteStatus(fn, status).map((c) => c[2])
const relayError = (over = {}) => new TonFeeError('relay hatasi', { phase: 'relay', ...over })

const tonRelayTx = (over = {}) => ({
    id: TX_ID,
    status: 'processing',
    timestamp: NOW - ORPHAN_MIN_AGE_MS - 1000,
    ...over,
    meta: {
        chainId: TON_MAINNET_ID,
        amount: '1',
        type: 'Transaction',
        [TON_RELAY_TX_FLAG]: true,
        ...(over.meta || {}),
    },
})

beforeEach(async () => {
    vi.clearAllMocks()
    // YALNIZ Date dondurulur (`toFake: ['Date']`), zamanlayicilara DOKUNULMAZ:
    // withKeepAlive kendi araligini kuruyor ve setInterval'i de sahtelemek testi
    // asili birakirdi.
    //
    // NEDEN GEREKLI: bu dosya sabit bir NOW ile calisir ama depo katmani GERCEK
    // saati kullanir - `saveTonSettlement` `savedAt`i Date.now() ile damgalar ve
    // `pruneTonSettlements` yine Date.now() ile TTL uygular. Iki saat ayrisinca
    // NOW'a gore geriye alinmis bir kayit prune'a ~2.5 yil yasli gorunup SILINIYOR
    // (olculdu: yetim taramasi kaydi bulamayip islemi 'error' isaretledi).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    store = fakeStore()
    _setTonSettlementStore(store)
})

afterEach(() => {
    _setTonSettlementStore(undefined)
    vi.useRealTimers()
    vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Yapisal guvence
// ---------------------------------------------------------------------------
describe('yapisal guvence', () => {
    it('modul /quote import ETMEZ - ikinci tahsilat yapisal olarak imkansiz', () => {
        // Kurtarma yeni bir teklif ALMAZ. Alsaydi, ucreti ZATEN alinmis bir islem icin
        // IKINCI bir tahsilat baslatirdi.
        //
        // UC AYRI KAPI, cunku tek bir ad alt dize olarak yeterli degil:
        //   tonFeeQuote            - dogrudan teklif cagrisi
        //   tonFeeRelayer          - yonetmen: teklif ALIR ve relay EDER, yani ikinci
        //                            tahsilatin GERCEK yolu tam olarak budur
        //   paymaster/ton/quote    - istemciyi tumden atlayan ham fetch
        expect(SRC).not.toMatch(/tonFeeQuote|tonFeeRelayer|paymaster\/ton\/quote/)
    })
})

// ---------------------------------------------------------------------------
// 0. Yetim tarama
// ---------------------------------------------------------------------------
describe('0. yetim tarama - makbuzsuz, bekleyen, yaslanmis relay islemi', () => {
    it('makbuz YOK + yas > 10dk -> tx error, "ucret alinmadi"', async () => {
        const d = deps({ listTransactions: async () => [tonRelayTx()] })
        await recoverTonSettlements(d)
        expect(d.updateTxStatus).toHaveBeenCalledWith(TX_ID, 'error', expect.objectContaining({
            error: RECOVERY_TX_MESSAGES.notStarted,
        }))
    })

    it('yas < 10dk ise DOKUNULMAZ - relay hala devam ediyor olabilir', async () => {
        const tx = tonRelayTx({ timestamp: NOW - ORPHAN_MIN_AGE_MS + 1000 })
        const d = deps({ listTransactions: async () => [tx] })
        await recoverTonSettlements(d)
        expect(d.updateTxStatus).not.toHaveBeenCalled()
    })

    it('MAKBUZ VARSA dokunulmaz - "unresolved" bir kayit bile korur', async () => {
        // Cozulmus/cozulememis fark etmez: kayit varsa relay'e CIKILMIS demektir ve
        // "ucret alinmadi" demek KESIN YALAN olurdu.
        await seed(baseRec({ phase: 'unresolved' }))
        const d = deps({ listTransactions: async () => [tonRelayTx()] })
        await recoverTonSettlements(d)
        expect(d.updateTxStatus).not.toHaveBeenCalled()
    })

    it('bitmis islemler (success/error) dokunulmaz', async () => {
        const d = deps({
            listTransactions: async () => [
                tonRelayTx({ id: 'a', status: 'success' }),
                tonRelayTx({ id: 'b', status: 'error' }),
            ],
        })
        await recoverTonSettlements(d)
        expect(d.updateTxStatus).not.toHaveBeenCalled()
    })

    it('EVM islemleri hic gorulmez', async () => {
        const d = deps({
            listTransactions: async () => [tonRelayTx({ meta: { chainId: 56 } })],
        })
        await recoverTonSettlements(d)
        expect(d.updateTxStatus).not.toHaveBeenCalled()
    })

    it('SELF-PAY TON islemi (relay isareti YOK) dokunulmaz', async () => {
        // KRITIK: sendTonInternal, waitForSeqno dogrulayamadiginda islemi BILEREK
        // 'processing'te birakiyor ("`false` BASARISIZ DEGIL... 'error' yazmak
        // kullaniciyi tekrar gondermeye iter ve deger IKI KEZ gidebilir"). O kayda
        // "islem baslatilamadi, ucret alinmadi" yazmak hem YALAN olurdu (self-pay'de
        // ucret zaten alinmaz ve islem zincire gitmis OLABILIR) hem de tam olarak o
        // cift-gonderim riskini geri acardi.
        const selfPay = tonRelayTx({ meta: { [TON_RELAY_TX_FLAG]: undefined } })
        const d = deps({ listTransactions: async () => [selfPay] })
        await recoverTonSettlements(d)
        expect(d.updateTxStatus).not.toHaveBeenCalled()
    })

    it('timestamp i olmayan kayit dokunulmaz - yasini bilemeyiz', async () => {
        const tx = tonRelayTx()
        delete tx.timestamp
        const d = deps({ listTransactions: async () => [tx] })
        await recoverTonSettlements(d)
        expect(d.updateTxStatus).not.toHaveBeenCalled()
    })
})

// ---------------------------------------------------------------------------
// 1. deadline gecmis
// ---------------------------------------------------------------------------
describe('1. deadline gecmis', () => {
    it("phase 'collected' -> unresolved, relay HIC cagrilmaz", async () => {
        await seed(baseRec({ phase: 'collected', deadline: PAST, settlementId: 'stl-1' }))
        const d = deps()
        await recoverTonSettlements(d)

        expect(tonFeeRelay).not.toHaveBeenCalled()
        expect((await recOf()).phase).toBe('unresolved')
        expect((await recOf()).settlementId).toBe('stl-1')
    })

    it("phase 'relay-inflight' -> TEK sorgu; 400 ton-fee-already-settled -> unresolved + settlementId", async () => {
        await seed(baseRec({ deadline: PAST }))
        tonFeeRelay.mockRejectedValue(relayError({
            code: 'ton-fee-already-settled', httpStatus: 400, settlementId: 'stl-9',
        }))
        const d = deps()
        await recoverTonSettlements(d)

        expect(tonFeeRelay).toHaveBeenCalledTimes(1)
        expect(tonFeeRelay).toHaveBeenCalledWith({
            quoteId: 'q-1', signature: '0xaaaa', feeAuthSignature: '0xbbbb',
        })
        const rec = await recOf()
        expect(rec.phase).toBe('unresolved')
        expect(rec.settlementId).toBe('stl-9')
    })

    it("phase 'relay-inflight' -> 502 ton-collect-failed: kayit SILINIR, tx error", async () => {
        await seed(baseRec({ deadline: PAST }))
        tonFeeRelay.mockRejectedValue(relayError({ code: 'ton-collect-failed', httpStatus: 502 }))
        const d = deps()
        await recoverTonSettlements(d)

        expect(await recOf()).toBeUndefined()
        expect(d.updateTxStatus).toHaveBeenCalledWith(TX_ID, 'error', expect.objectContaining({
            error: RECOVERY_TX_MESSAGES.notSent,
        }))
    })

    it("phase 'relay-inflight' -> KODSUZ 400: unresolved, kayit DURUR", async () => {
        await seed(baseRec({ deadline: PAST }))
        tonFeeRelay.mockRejectedValue(relayError({ code: null, httpStatus: 400 }))
        const d = deps()
        await recoverTonSettlements(d)

        expect((await recOf()).phase).toBe('unresolved')
    })

    it('deadline gecmis bir sorgu 2xx donse bile SUCCESS YAZILMAZ', async () => {
        await seed(baseRec({ deadline: PAST }))
        tonFeeRelay.mockResolvedValue({ ok: true, settlementId: 'stl-2' })
        const d = deps()
        await recoverTonSettlements(d)

        expect(wroteStatus(d.updateTxStatus, 'success')).toHaveLength(0)
        expect((await recOf()).phase).toBe('unresolved')
    })

    it('deadline OKUNAMAZSA gecmis sayilir - belirsiz pencerede tekrar denenmez', async () => {
        await seed(baseRec({ phase: 'collected', deadline: 'bozuk' }))
        const d = deps()
        await recoverTonSettlements(d)

        expect(tonFeeRelay).not.toHaveBeenCalled()
        expect((await recOf()).phase).toBe('unresolved')
    })

    // --- "TEK sorgu" GERCEKTEN tek mi (inceleme turu 1, bulgu 1) ---
    // Sureli sorgunun tek cikisi markUnresolved ve o BILEREK dogrulanmiyor;
    // updateTonSettlement de yazma hatasini yutuyor. Kapi olmadan, yazmalar duserken
    // kayit 'relay-inflight' + sureli kalir ve HER tetikleyici (dakikalik alarm +
    // popup acikken ~5 sn'de bir HEARTBEAT) YENI bir sorgu gonderir.

    it('sureli sorgu ONCE sayaci artirir - attempts diske iner', async () => {
        await seed(baseRec({ deadline: PAST }))
        tonFeeRelay.mockRejectedValue(relayError({ code: null, httpStatus: 400 }))
        await recoverTonSettlements(deps())

        expect(tonFeeRelay).toHaveBeenCalledTimes(1)
        expect((await recOf()).attempts).toBe(1)
    })

    it('sayac diske INMEZSE sureli sorgu HIC yapilmaz', async () => {
        await seed(baseRec({ deadline: PAST }))
        store.failAfter = 0
        await recoverTonSettlements(deps())

        expect(tonFeeRelay).not.toHaveBeenCalled()
    })

    it('yazmalar duserken ard arda UC tetikleyici TEK sorguyu asamaz', async () => {
        await seed(baseRec({ deadline: PAST }))
        store.failAfter = 0
        tonFeeRelay.mockRejectedValue(relayError({ code: null, httpStatus: 400 }))

        await recoverTonSettlements(deps())
        await recoverTonSettlements(deps())
        await recoverTonSettlements(deps())

        expect(tonFeeRelay.mock.calls.length).toBeLessThanOrEqual(1)
    })

    it('attempts ZATEN harcanmissa sureli sorgu yapilmaz', async () => {
        await seed(baseRec({ deadline: PAST, attempts: 1 }))
        await recoverTonSettlements(deps())

        expect(tonFeeRelay).not.toHaveBeenCalled()
        expect((await recOf()).phase).toBe('unresolved')
    })
})

// ---------------------------------------------------------------------------
// 2. seqno ilerledi -> ONAY GEREKLI
// ---------------------------------------------------------------------------
describe('2. seqno ilerledi - tek basina "basarili" DEGIL', () => {
    it("findActionOnChain 'found' -> kayit silinir + tx success", async () => {
        await seed()
        const d = deps({ getSeqnoFor: async () => 8, findActionOnChain: async () => 'found' })
        await recoverTonSettlements(d)

        expect(await recOf()).toBeUndefined()
        expect(d.updateTxStatus).toHaveBeenCalledWith(TX_ID, 'success', {})
        expect(tonFeeRelay).not.toHaveBeenCalled()
    })

    it("findActionOnChain 'missing' -> unresolved + tx error, SUCCESS YAZILMAZ", async () => {
        // Kullanici ayni cuzdandan BASKA bir gonderim yapmis olabilir (self-pay,
        // Tonkeeper, baska cihaz). seqno artisi tek basina bizim eylemimizin
        // gittigini GOSTERMEZ.
        await seed()
        const d = deps({ getSeqnoFor: async () => 99, findActionOnChain: async () => 'missing' })
        await recoverTonSettlements(d)

        expect((await recOf()).phase).toBe('unresolved')
        expect(d.updateTxStatus).toHaveBeenCalledWith(TX_ID, 'error', expect.objectContaining({
            error: RECOVERY_TX_MESSAGES.notVerified,
        }))
        expect(wroteStatus(d.updateTxStatus, 'success')).toHaveLength(0)
    })

    it("findActionOnChain 'unknown' -> unresolved, SUCCESS YAZILMAZ", async () => {
        await seed()
        const d = deps({ getSeqnoFor: async () => 8, findActionOnChain: async () => 'unknown' })
        await recoverTonSettlements(d)

        expect((await recOf()).phase).toBe('unresolved')
        // Karar 'unresolved'; islem karti da bunu SOYLEMEK zorunda - yoksa kart
        // sonsuza kadar "isleniyor" kalir (Task 8'in adlandirdigi vaka).
        expect(metaFor(d.updateTxStatus, 'error')[0]).toMatchObject({
            tonFeeState: TON_FEE_TX_STATES.unresolved,
        })
        expect(wroteStatus(d.updateTxStatus, 'success')).toHaveLength(0)
    })

    it('findActionOnChain FIRLARSA -> unresolved, SUCCESS YAZILMAZ', async () => {
        await seed()
        const d = deps({
            getSeqnoFor: async () => 8,
            findActionOnChain: async () => { throw new Error('rpc coktu') },
        })
        await recoverTonSettlements(d)

        expect((await recOf()).phase).toBe('unresolved')
        expect(wroteStatus(d.updateTxStatus, 'success')).toHaveLength(0)
    })

    it("beklenmeyen bir donus degeri ('evet') SUCCESS SAYILMAZ", async () => {
        await seed()
        const d = deps({ getSeqnoFor: async () => 8, findActionOnChain: async () => 'evet' })
        await recoverTonSettlements(d)

        expect((await recOf()).phase).toBe('unresolved')
        expect(wroteStatus(d.updateTxStatus, 'success')).toHaveLength(0)
    })

    it('getSeqnoFor FIRLARSA hicbir karar verilmez - kayit AYNEN kalir', async () => {
        await seed()
        const d = deps({ getSeqnoFor: async () => { throw new Error('rpc coktu') } })
        await recoverTonSettlements(d)

        expect((await recOf()).phase).toBe('relay-inflight')
        expect(tonFeeRelay).not.toHaveBeenCalled()
        expect(d.updateTxStatus).not.toHaveBeenCalled()
    })

    it('getSeqnoFor enjekte EDILMEMISSE adim 2-4 hic calismaz', async () => {
        await seed()
        const d = deps({ getSeqnoFor: undefined })
        await recoverTonSettlements(d)

        expect((await recOf()).phase).toBe('relay-inflight')
        expect(tonFeeRelay).not.toHaveBeenCalled()
    })

    it('seqno AYNI ise adim 2 TETIKLENMEZ, zincire de sorulmaz', async () => {
        await seed()
        tonFeeRelay.mockRejectedValue(relayError({ code: null, httpStatus: 400 }))
        const d = deps()
        await recoverTonSettlements(d)

        expect(d.findActionOnChain).not.toHaveBeenCalled()
        expect(tonFeeRelay).toHaveBeenCalledTimes(1)   // adim 4'e dustu
    })

    it("'found' + kayitta txId YOKSA kayit yine de SILINIR", async () => {
        // Yanlis etiketlenecek bir islem kaydi yok; silinmezse cozulmus bir makbuz
        // cuzdani deadline'a kadar bosuna kilitler (hasUnsettledTonFee).
        await seed(baseRec({ txId: undefined }))
        const d = deps({ getSeqnoFor: async () => 8, findActionOnChain: async () => 'found' })
        await recoverTonSettlements(d)

        expect(await recOf()).toBeUndefined()
    })

    it("'found' ama tx durumu YAZILAMAZSA kayit SILINMEZ", async () => {
        // Sira: once tx 'success', SONRA makbuzun silinmesi. Ters sirada (ya da yazma
        // hatasi yutularak) kayit silinir, islem 'processing' kalir ve bir sonraki tur
        // yetim taramasi ona "ucret alinmadi" der - oysa ucret ALINDI, islem GITTI.
        await seed()
        const d = deps({
            getSeqnoFor: async () => 8,
            findActionOnChain: async () => 'found',
            updateTxStatus: vi.fn(async () => { throw new Error('depo kapali') }),
        })
        await recoverTonSettlements(d)

        expect(await recOf()).toBeTruthy()
    })
})

// ---------------------------------------------------------------------------
// 3. attempts >= 1
// ---------------------------------------------------------------------------
describe('3. attempts >= 1 - korlemesine dongu yok', () => {
    it('bir kez denenmis kayit tekrar denenmez, unresolved olur', async () => {
        await seed(baseRec({ attempts: 1 }))
        const d = deps()
        await recoverTonSettlements(d)

        expect(tonFeeRelay).not.toHaveBeenCalled()
        expect((await recOf()).phase).toBe('unresolved')
    })
})

// ---------------------------------------------------------------------------
// 4. tekrar deneme
// ---------------------------------------------------------------------------
describe('4. tekrar deneme', () => {
    it("phase 'collected' -> tek deneme; attempts artar; 2xx te bile SUCCESS YAZILMAZ", async () => {
        await seed(baseRec({ phase: 'collected', settlementId: 'stl-3' }))
        tonFeeRelay.mockResolvedValue({ ok: true })
        const d = deps()
        await recoverTonSettlements(d)

        expect(tonFeeRelay).toHaveBeenCalledTimes(1)
        const rec = await recOf()
        expect(rec.attempts).toBe(1)
        expect(rec.phase).toBe('unresolved')
        expect(wroteStatus(d.updateTxStatus, 'success')).toHaveLength(0)
    })

    it("phase 'relay-inflight' + already-settled -> 'collected'a yukselt, BIR KEZ daha dene", async () => {
        await seed()
        tonFeeRelay
            .mockRejectedValueOnce(relayError({ code: 'ton-fee-already-settled', httpStatus: 400, settlementId: 'stl-7' }))
            .mockResolvedValueOnce({ ok: true })
        const d = deps()
        await recoverTonSettlements(d)

        expect(tonFeeRelay).toHaveBeenCalledTimes(2)
        const rec = await recOf()
        expect(rec.settlementId).toBe('stl-7')
        expect(rec.phase).toBe('unresolved')
        expect(wroteStatus(d.updateTxStatus, 'success')).toHaveLength(0)
    })

    it("phase 'collected' + already-settled -> settlementId YAKALANIR (design R3 onarimi)", async () => {
        // Makbuzsuz olum penceresi: tahsilat oldu, yanit donmeden SW oldu, elimizde
        // settlementId YOK. Sunucunun 'ton-fee-already-settled' yaniti onu geri verir
        // ve bu kullanicinin elindeki TEK destek kaydidir - burada yakalanmazsa
        // kalici olarak kaybolur.
        await seed(baseRec({ phase: 'collected', settlementId: undefined }))
        tonFeeRelay.mockRejectedValue(relayError({
            code: 'ton-fee-already-settled', httpStatus: 400, settlementId: 'stl-r3',
        }))
        const d = deps()
        await recoverTonSettlements(d)

        expect(tonFeeRelay).toHaveBeenCalledTimes(1)
        const rec = await recOf()
        expect(rec.settlementId).toBe('stl-r3')
        expect(rec.phase).toBe('unresolved')
    })

    it("'clear' esemesi (ton-collect-failed) -> kayit SILINIR + tx error", async () => {
        await seed()
        tonFeeRelay.mockRejectedValue(relayError({ code: 'ton-collect-failed', httpStatus: 502 }))
        const d = deps()
        await recoverTonSettlements(d)

        expect(await recOf()).toBeUndefined()
        expect(d.updateTxStatus).toHaveBeenCalledWith(TX_ID, 'error', expect.objectContaining({
            error: RECOVERY_TX_MESSAGES.notSent,
        }))
    })

    it("phase 'collected' iken 'clear' esemesi kaydi SILEMEZ", async () => {
        // 'collected' = ucretin ALINDIGI KANITLANMIS. Sonraki bir yanit ne derse desin
        // o kanit silinmez; silinirse odenmis ucretin tek izi kalici olarak kaybolur.
        await seed(baseRec({ phase: 'collected', settlementId: 'stl-4' }))
        tonFeeRelay.mockRejectedValue(relayError({ code: 'ton-collect-failed', httpStatus: 502 }))
        const d = deps()
        await recoverTonSettlements(d)

        const rec = await recOf()
        expect(rec).toBeTruthy()
        expect(rec.phase).toBe('unresolved')
        expect(rec.settlementId).toBe('stl-4')
    })

    it("'keep' esemesi (ag hatasi) -> kayit DURUR, attempts artmis", async () => {
        await seed()
        tonFeeRelay.mockRejectedValue(relayError({ code: null, httpStatus: null }))
        const d = deps()
        await recoverTonSettlements(d)

        const rec = await recOf()
        expect(rec.phase).toBe('relay-inflight')
        expect(rec.attempts).toBe(1)
    })

    it('attempts sayaci DISKE INMEZSE relay HIC cagrilmaz', async () => {
        // Task 6'dan tasinan yukumluluk 2: updateTonSettlement yazma hatasini YUTUYOR.
        // Sayac artmadan tekrar denenirse her turda yeni bir relay cagrisi yapilir -
        // sonsuz dongu, her turu para riski.
        await seed()
        store.failAfter = 0
        const d = deps()
        await recoverTonSettlements(d)

        expect(tonFeeRelay).not.toHaveBeenCalled()
    })

    it("'collected'a yukseltme DISKE INMEZSE ikinci deneme YAPILMAZ", async () => {
        await seed()
        store.failAfter = 1      // 1: attempts yazmasi gecer; 2: faz yukseltmesi duser
        tonFeeRelay.mockRejectedValue(relayError({
            code: 'ton-fee-already-settled', httpStatus: 400, settlementId: 'stl-8',
        }))
        const d = deps()
        await recoverTonSettlements(d)

        expect(tonFeeRelay).toHaveBeenCalledTimes(1)
    })
})

// ---------------------------------------------------------------------------
// Genel guvenceler
// ---------------------------------------------------------------------------
describe('genel guvenceler', () => {
    it("'unresolved' TERMINALDIR - tekrar denenmez", async () => {
        await seed(baseRec({ phase: 'unresolved' }))
        const d = deps({ getSeqnoFor: async () => 99, findActionOnChain: async () => 'found' })
        await recoverTonSettlements(d)

        expect(tonFeeRelay).not.toHaveBeenCalled()
        expect((await recOf()).phase).toBe('unresolved')
    })

    it('es zamanli iki cagri TEK tur calisir - relay iki kez GITMEZ', async () => {
        await seed()
        tonFeeRelay.mockRejectedValue(relayError({ code: null, httpStatus: 400 }))
        const d = deps()

        await Promise.all([recoverTonSettlements(d), recoverTonSettlements(d)])
        expect(tonFeeRelay).toHaveBeenCalledTimes(1)
    })

    it('bir kaydin hatasi digerlerini engellemez', async () => {
        store = fakeStore()
        _setTonSettlementStore(store)
        await saveTonSettlement(baseRec({ actionHash: '0xaa', txId: 'tx-a', attempts: 1 }))
        await saveTonSettlement(baseRec({ actionHash: '0xbb', txId: 'tx-b', attempts: 1 }))
        store.sets = 0

        const d = deps({ getSeqnoFor: async () => { throw new Error('bum') } })
        await recoverTonSettlements(d)

        const all = await loadAllTonSettlements()
        expect(Object.keys(all)).toHaveLength(2)
    })

    it('HICBIR yol findActionOnChain ONAYI olmadan success YAZAMAZ', async () => {
        // Karar tablosunun success yazabilen TEK dali adim 2'nin 'found' dalidir.
        // Asagidaki matris o dal DISINDAKI her sonucu gezer.
        const verdicts = ['missing', 'unknown', 'evet', '', null, undefined]
        const relayOutcomes = [
            () => tonFeeRelay.mockResolvedValue({ ok: true }),
            () => tonFeeRelay.mockRejectedValue(relayError({ code: 'ton-fee-already-settled', httpStatus: 400 })),
            () => tonFeeRelay.mockRejectedValue(relayError({ code: 'ton-collect-failed', httpStatus: 502 })),
            () => tonFeeRelay.mockRejectedValue(relayError({ code: null, httpStatus: 400 })),
        ]
        const phases = ['relay-inflight', 'collected']
        const deadlines = [FUTURE, PAST]
        const seqnos = [7, 8]

        for (const verdict of verdicts) {
            for (const outcome of relayOutcomes) {
                for (const phase of phases) {
                    for (const deadline of deadlines) {
                        for (const seqno of seqnos) {
                            vi.clearAllMocks()
                            outcome()
                            await seed(baseRec({ phase, deadline }))
                            const d = deps({
                                getSeqnoFor: async () => seqno,
                                findActionOnChain: async () => verdict,
                            })
                            await recoverTonSettlements(d)
                            expect(wroteStatus(d.updateTxStatus, 'success')).toHaveLength(0)
                        }
                    }
                }
            }
        }
    })
})

// ---------------------------------------------------------------------------
// Islem kartina yazilan tonFeeState (Task 8 arayuzu)
// ---------------------------------------------------------------------------
// TransactionStatus.vue `tx.meta.tonFeeState` ve `tx.meta.settlementId` okuyor.
// Bu alanlar YAZILMAZSA kurtarmanin sonucu GORUNMEZ: ucreti alinmis ve
// dogrulanamamis bir islem kullaniciya hicbir sey soylemez. Ayrica bircok yol
// islem kaydina HIC dokunmuyordu - o kayitlar 'processing'te asili kaliyordu.
describe('islem kartina yazilan tonFeeState', () => {
    it('yetim tarama -> not-charged', async () => {
        const d = deps({ listTransactions: async () => [tonRelayTx()] })
        await recoverTonSettlements(d)

        expect(metaFor(d.updateTxStatus, 'error')[0]).toMatchObject({
            tonFeeState: TON_FEE_TX_STATES.notCharged,
            error: RECOVERY_TX_MESSAGES.notStarted,
        })
    })

    it('tahsilat YAPILMADI (ton-collect-failed) -> not-charged', async () => {
        await seed()
        tonFeeRelay.mockRejectedValue(relayError({ code: 'ton-collect-failed', httpStatus: 502 }))
        const d = deps()
        await recoverTonSettlements(d)

        expect(metaFor(d.updateTxStatus, 'error')[0]).toMatchObject({
            tonFeeState: TON_FEE_TX_STATES.notCharged,
            error: RECOVERY_TX_MESSAGES.notSent,
        })
    })

    it('zincirde BULUNAMADI -> unresolved + "islem dogrulanamadi"', async () => {
        await seed()
        const d = deps({ getSeqnoFor: async () => 8, findActionOnChain: async () => 'missing' })
        await recoverTonSettlements(d)

        expect(metaFor(d.updateTxStatus, 'error').at(-1)).toMatchObject({
            tonFeeState: TON_FEE_TX_STATES.unresolved,
            error: RECOVERY_TX_MESSAGES.notVerified,
        })
    })

    it('deadline gecmis collected -> unresolved (once HICBIR SEY yazilmiyordu)', async () => {
        await seed(baseRec({ phase: 'collected', deadline: PAST }))
        const d = deps()
        await recoverTonSettlements(d)

        expect(metaFor(d.updateTxStatus, 'error')[0]).toMatchObject({
            tonFeeState: TON_FEE_TX_STATES.unresolved,
        })
    })

    it('attempts harcanmis -> unresolved (once HICBIR SEY yazilmiyordu)', async () => {
        await seed(baseRec({ attempts: 1 }))
        const d = deps()
        await recoverTonSettlements(d)

        expect(metaFor(d.updateTxStatus, 'error')[0]).toMatchObject({
            tonFeeState: TON_FEE_TX_STATES.unresolved,
        })
    })

    it('2xx tekrar -> unresolved, success DEGIL', async () => {
        await seed(baseRec({ phase: 'collected' }))
        tonFeeRelay.mockResolvedValue({ ok: true })
        const d = deps()
        await recoverTonSettlements(d)

        expect(metaFor(d.updateTxStatus, 'error')[0]).toMatchObject({
            tonFeeState: TON_FEE_TX_STATES.unresolved,
        })
        expect(wroteStatus(d.updateTxStatus, 'success')).toHaveLength(0)
    })

    it('settlementId VARSA meta ile birlikte gider - destek kaydi kartta gorunur', async () => {
        await seed(baseRec({ phase: 'collected', deadline: PAST, settlementId: 'stl-42' }))
        const d = deps()
        await recoverTonSettlements(d)

        expect(metaFor(d.updateTxStatus, 'error')[0]).toMatchObject({
            tonFeeState: TON_FEE_TX_STATES.unresolved,
            settlementId: 'stl-42',
        })
    })

    it('settlementId YOKSA alan HIC yazilmaz - bos referans gosterilmez', async () => {
        // TransactionStatus.vue Kopyala butonunu yalnizca `tx.meta.settlementId`
        // VARKEN ciziyor; undefined yazmak kullaniciya goremeyecegi bir referansi
        // soylemek olurdu.
        await seed(baseRec({ phase: 'collected', deadline: PAST, settlementId: undefined }))
        const d = deps()
        await recoverTonSettlements(d)

        const meta = metaFor(d.updateTxStatus, 'error')[0]
        expect(meta.tonFeeState).toBe(TON_FEE_TX_STATES.unresolved)
        expect('settlementId' in meta).toBe(false)
    })

    it("'found' -> success, tonFeeState YAZILMAZ (kayit zaten siliniyor)", async () => {
        await seed()
        const d = deps({ getSeqnoFor: async () => 8, findActionOnChain: async () => 'found' })
        await recoverTonSettlements(d)

        const meta = metaFor(d.updateTxStatus, 'success')[0]
        expect(meta).toBeDefined()
        expect('tonFeeState' in meta).toBe(false)
    })

    it("karar VERILEMEYEN tur -> 'recovering', kart 'processing'te kalir", async () => {
        await seed()
        const d = deps({
            getSeqnoFor: async () => { throw new Error('rpc coktu') },
            listTransactions: async () => [tonRelayTx()],
        })
        await recoverTonSettlements(d)

        expect(metaFor(d.updateTxStatus, 'processing')[0]).toMatchObject({
            tonFeeState: TON_FEE_TX_STATES.recovering,
        })
        expect(wroteStatus(d.updateTxStatus, 'error')).toHaveLength(0)
    })

    it("islem artik BEKLEMIYORSA 'recovering' YAZILMAZ - bitmis kart geri alinmaz", async () => {
        await seed()
        const d = deps({
            getSeqnoFor: async () => { throw new Error('rpc coktu') },
            listTransactions: async () => [tonRelayTx({ status: 'success' })],
        })
        await recoverTonSettlements(d)

        expect(d.updateTxStatus).not.toHaveBeenCalled()
    })
})

// ---------------------------------------------------------------------------
// Bitmis bir islem kartini GERI ALMA
// ---------------------------------------------------------------------------
// clearTonSettlement yazma hatasini YUTUYOR: 'found' dogrulamasindan sonra kart dogru
// sekilde 'success' yazilmis ama kayit diskte KALMIS olabilir. Kayit hala canli fazda
// oldugu icin sonraki tur onu isler; deadline saniyeler-dakikalar mertebesinde ve
// tetikleyici dakikada bir (ustune her HEARTBEAT), yani bir sonraki tur cogunlukla
// dogrudan resolveExpired'a gider. Kapisiz birakilirsa DOGRU bir 'success' karti
// kalici olarak 'error' + 'unresolved'a cevrilir - ve 'unresolved' TERMINAL oldugu
// icin bir daha DUZELMEZ. Para kaybi yok; kullaniciya basarili isleminin
// dogrulanamadigini soylemek var, yani bu modulun amacinin TERSI.
describe('bitmis islem karti geri alinmaz', () => {
    it("islem ZATEN 'success' iken sureli kayit karti 'unresolved'a CEVIREMEZ", async () => {
        await seed(baseRec({ phase: 'collected', deadline: PAST, settlementId: 'stl-9' }))
        const d = deps({ listTransactions: async () => [tonRelayTx({ status: 'success' })] })
        await recoverTonSettlements(d)

        expect(d.updateTxStatus).not.toHaveBeenCalled()
        // Defter isini YAPAR - dokunulmayan tek sey KART.
        expect((await recOf()).phase).toBe('unresolved')
    })

    it("islem ZATEN 'success' iken 'ucret alinmadi' da yazilmaz", async () => {
        await seed()
        tonFeeRelay.mockRejectedValue(relayError({ code: 'ton-collect-failed', httpStatus: 502 }))
        const d = deps({ listTransactions: async () => [tonRelayTx({ status: 'success' })] })
        await recoverTonSettlements(d)

        expect(d.updateTxStatus).not.toHaveBeenCalled()
        expect(await recOf()).toBeUndefined()
    })

    it("islem 'error' ise ucret notu YINE yazilir - kapi fazla genis DEGIL", async () => {
        // Kapi YALNIZ 'success'i korur. 'error' bir kart icin 'unresolved' bir
        // IYILESTIRMEDIR: tasarim bolum 8 o durumda "basarisiz" denmemesini ve destek
        // kaydinin gosterilmesini istiyor. Bekleyen-olmayan HER karti korusaydik,
        // relay'i cagiran taraf 'error' yazdiginda kullanici ucretinin alindigini ve
        // destek kaydini HIC ogrenemezdi.
        await seed(baseRec({ phase: 'collected', deadline: PAST, settlementId: 'stl-5' }))
        const d = deps({ listTransactions: async () => [tonRelayTx({ status: 'error' })] })
        await recoverTonSettlements(d)

        expect(metaFor(d.updateTxStatus, 'error')[0]).toMatchObject({
            tonFeeState: TON_FEE_TX_STATES.unresolved,
            settlementId: 'stl-5',
        })
    })
})

// CANLI OLCUM 2026-09-01: relay BASARILI dondu, ama ekranda "DOGRULANAMADI --
// ucret alindi, islemin sonucu dogrulanamadi" yazdi. Network izi sebebi acikca
// gosterdi:
//     relay (200)  ->  rpc (seqno)  ->  relay (400)  ->  relay (400)
// Son iki cagri KURTARMANINDI ve ikisi de `ton-fee-already-settled` aldi.
//
// KOK NEDEN: makbuz relay cagrisindan ONCE diske iniyor ('relay-inflight' -- SW
// olurse kurtarilabilsin diye, dogru karar). Ama recoverOne'da "bu istek SU AN
// UCUSTA" korumasi yoktu: deadline gecmemis + seqno ilerlememis + attempts === 0
// -> dogrudan retryRelay. Tetikleyici de her yerde: alarm dakikada bir, HEARTBEAT
// ise popup acikken saniyeler icinde. Yani cuzdan KENDI istegini kopyaliyor,
// sunucu ikinciyi "zaten tahsil edildi" ile reddediyor ve kayit 'collected' ->
// 'unresolved' yoluna dusuyor: ucret gercekten alinmisken kullaniciya islem
// BASARISIZMIS gibi gorunuyor.
describe('ucus korumasi: taze bir relay-inflight kaydi TEKRAR DENENMEZ', () => {
    it('makbuz YENI yazilmissa relay HIC cagrilmaz (kendi istegimizi kopyalamayiz)', async () => {
        await seed(baseRec({ savedAt: NOW - 5_000 }))
        const d = deps()
        await recoverTonSettlements(d)

        expect(tonFeeRelay, 'ucustaki istek kopyalandi').not.toHaveBeenCalled()
        // Kart da DEGISMEZ: gonderim yolu kendi sonucunu yazacak.
        expect(d.updateTxStatus).not.toHaveBeenCalled()
        // Kayit DOKUNULMADAN kalir - sayac da harcanmaz.
        const rec = await recOf()
        expect(rec.phase).toBe('relay-inflight')
        expect(rec.attempts ?? 0).toBe(0)
    })

    it('esik GECILINCE tekrar deneme calisir (koruma kalici DEGIL)', async () => {
        await seed(baseRec({ savedAt: NOW - RELAY_INFLIGHT_MIN_AGE_MS - 1 }))
        tonFeeRelay.mockResolvedValueOnce({ ok: true })
        await recoverTonSettlements(deps())

        expect(tonFeeRelay, 'esik gecmisken kurtarma calismadi').toHaveBeenCalledTimes(1)
    })

    it('sinir DEGERI: tam esikte HENUZ denenmez', async () => {
        await seed(baseRec({ savedAt: NOW - RELAY_INFLIGHT_MIN_AGE_MS }))
        await recoverTonSettlements(deps())
        expect(tonFeeRelay).not.toHaveBeenCalled()
    })

    it("koruma YALNIZ 'relay-inflight'e -- TAZE bir 'collected' kaydi beklemez", async () => {
        // 'collected' = ucretin alindigi KANITLANMIS; o kayit tanim geregi
        // ucusta DEGILDIR (yanit ZATEN geldi). Korumayi oraya da uygulamak,
        // kullaniciyi sonucu belli bir kayit icin bosuna bekletirdi.
        await seed(baseRec({ phase: 'collected', savedAt: NOW - 5_000 }))
        tonFeeRelay.mockResolvedValueOnce({ ok: true })
        await recoverTonSettlements(deps())

        expect(tonFeeRelay, "taze 'collected' kaydi yanlislikla bekletildi").toHaveBeenCalledTimes(1)
    })
})
