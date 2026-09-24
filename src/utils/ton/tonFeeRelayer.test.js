import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Address } from '@ton/core'
import GOLDEN from './__fixtures__/tonQuote.golden.json'
import JETTON from './__fixtures__/tonQuoteJetton.golden.json'

// Cagri sirasi casusu: TEK bir diziye push edilir. Bir sonraki testin degerlerini
// gormemesi icin beforeEach'te sifirlanir. Sadece "gecti mi" degil, "hangi sirada
// gecti"yi de kanitlamak icin varligini AYRICA dogruluyoruz (bkz. asagidaki testler) -
// yoksa `indexOf` bulunamayan bir cagriyi -1 dondurur ve -1 < N HER ZAMAN dogru olur;
// silinen bir cagriyi bu sekilde fark etmeden gecebilirdik (gorev talimatinin uyardigi tuzak).
const { calls } = vi.hoisted(() => ({ calls: [] }))

// verifyTonQuote GERCEK calisir (spy sadece sira icin bir iz birakir) - bu dosyanin
// dogrulama MANTIGINI degil, dogrulamayi COGRU SIRADA cagirip cagirmadigini sinamak
// istiyoruz. Ayni sebeple saveTonSettlement de GERCEK depoya yazar.
vi.mock('./tonQuoteVerify', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        verifyTonQuote: (...args) => {
            calls.push('verify')
            return actual.verifyTonQuote(...args)
        },
    }
})

vi.mock('./tonFeeSettlement', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        saveTonSettlement: (...args) => {
            calls.push('save')
            return actual.saveTonSettlement(...args)
        },
        // Gorev 10, yukumluluk 2: BASARI yolunda bu fonksiyon bu dosyadan HIC
        // cagrilmamali (silme cagirana ait, islem durumu YAZILDIKTAN SONRA). HATA
        // yolunda ise disposition'a gore hala cagrilir - bu yuzden casus GERCEK
        // fonksiyona devreder, susturmaz.
        clearTonSettlement: (...args) => {
            calls.push('clear')
            return actual.clearTonSettlement(...args)
        },
    }
})

// withKeepAlive'in relay cagrisini GERCEKTEN sardigini olcmek icin: sahte sarmalayici
// girisi ve cikisi ayri ayri isaretler, boylece "relay ONUN ICINDE mi cagrildi"
// sorusu sira uzerinden cevaplanabilir. Gercek swKeepAlive node ortaminda `chrome`
// olmadigi icin `fn`i duz cagirir ve hicbir iz birakmazdi.
vi.mock('./swKeepAlive', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        withKeepAlive: async (fn) => {
            calls.push('ka-basla')
            try {
                return await fn()
            } finally {
                calls.push('ka-bitir')
            }
        },
    }
})

// readTonFeeStatus/tonFeeQuote/tonFeeRelay AG'a cikar - testte gercek ag cagrisi YASAK
// (relay ~18 ATS tahsil eder). tonFeeRelayActive/TonFeeError GERCEK kalir: bolge kapisinin
// gercek mantigini ve hata sekli sozlesmesini sinamak istiyoruz, yalniz HTTP'yi kesiyoruz.
vi.mock('./tonFeeStatus', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, readTonFeeStatus: vi.fn() }
})

vi.mock('./tonFeeClient', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, tonFeeQuote: vi.fn(), tonFeeRelay: vi.fn() }
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { executeTonViaRelayer, TonRelayerError, evmVaultResolvable } from './tonFeeRelayer'
import { readTonFeeStatus } from './tonFeeStatus'
import { tonFeeQuote, tonFeeRelay, TonFeeError } from './tonFeeClient'
import { _setTonSettlementStore, saveTonSettlement, loadAllTonSettlements, tonSettlementKey } from './tonFeeSettlement'

// Ayni cuzdanin IKI GECERLI yazimi - "cuzdan adresi kanonik" testinin kalbi. SELF_UQ
// Address.parse ile TURETILIR (elle yazilan bir string, yanlislikla GECERSIZ bir adres
// olup "her zaman farkli" gorunerek testi anlamsizlastirabilirdi).
const SELF = GOLDEN.sign.feeAuth.tonWallet // 'EQ...' (bounce eden)
const SELF_UQ = Address.parse(SELF).toString({ bounceable: false }) // ayni cuzdan, 'UQ...'
const CANONICAL_WALLET = SELF_UQ // canonicalTonWallet'in urettigi bicimle AYNI (bounceable:false)
const AMOUNT = '1000000'

const ACTIVE_STATUS = { ton: { enabled: true, rateFresh: true, wallet: 'W5' } }

const account = { key: 'acc-1', address: '0x00000000000000000000000000000000000A1', type: 'hd' }
const vaults = [{ id: 'v1', accounts: [account] }]

const goldenClone = () => JSON.parse(JSON.stringify(GOLDEN))
const plainActions = () => [{ kind: 'ton', to: SELF, amountNano: AMOUNT }]
const baseIntent = () => ({
    tonWallet: SELF,
    tonPublicKey: GOLDEN.sign.feeAuth.tonPublicKey,
    seqno: GOLDEN.sign.feeAuth.seqno,
    now: GOLDEN.validUntil - 60,
})
const settlementKeyFor = (actionHash = GOLDEN.sign.feeAuth.actionHash) =>
    tonSettlementKey({ tonWallet: CANONICAL_WALLET, actionHash })

function fakeStore(initial = {}) {
    let data = { ...initial }
    return {
        async get(key) { return { [key]: data[key] } },
        async set(obj) { data = { ...data, ...obj } },
    }
}

// Review bulgusu 4: chrome.storage.local kota asimi gibi bir yazma hatasini taklit eder.
// saveTonSettlement bu depoda `false` doner - tonFeeRelayer bunu GORMEZDEN GELIP relay'e
// devam ederse, ucret alinir ve diskte hicbir kanit kalmaz.
function throwingStore() {
    return {
        async get() { return {} },
        async set() { throw new Error('QuotaExceededError') },
    }
}

function makeSigners() {
    return {
        tonSign: vi.fn(async () => { calls.push('tonSign'); return Buffer.from('sig-a') }),
        evmSignTypedData: vi.fn(async () => { calls.push('evmSign'); return '0xsig-b' }),
    }
}

// Tum "mutlu yol" testlerinin ortak ceridesi. Her cagri kendi mockImplementationOnce'ini
// kurar - boylece bir onceki testin kuyruga birakip TUKETMEDIGI bir deger sonraki teste
// SIZMAZ (asagidaki beforeEach ayrica vi.resetAllMocks() ile bunu garanti eder).
async function run({
    statusResult = ACTIVE_STATUS,
    quoteResult,
    relayResult = { success: true },
    relayError = null,
    acc = account,
    vlts = vaults,
    intentOverride = {},
    acts = plainActions(),
    txId = 'tx-1',
    signers = makeSigners(),
} = {}) {
    readTonFeeStatus.mockImplementationOnce(async () => { calls.push('status'); return statusResult })
    tonFeeQuote.mockImplementationOnce(async () => { calls.push('quote'); return quoteResult ?? goldenClone() })
    if (relayError) {
        tonFeeRelay.mockImplementationOnce(async () => { calls.push('relay'); throw relayError })
    } else {
        tonFeeRelay.mockImplementationOnce(async () => { calls.push('relay'); return relayResult })
    }

    return executeTonViaRelayer({
        account: acc,
        vaults: vlts,
        masterKey: 'unused-in-this-file',
        actions: acts,
        intent: { ...baseIntent(), ...intentOverride },
        approvedAtsFee: BigInt(GOLDEN.atsFee),
        txId,
        signers,
    })
}

beforeEach(() => {
    calls.length = 0
    vi.resetAllMocks()
    _setTonSettlementStore(fakeStore())
})

describe('sira degistirilemez', () => {
    it('verifyTonQuote HER IKI imzadan ONCE cagrilir', async () => {
        await run()

        // Once ONCE hepsinin GERCEKTEN cagrildigini kanitla - yoksa asagidaki indexOf
        // karsilastirmasi eksik bir cagriyi (-1) "once" sanip yanlislikla YESIL kalabilir.
        expect(calls).toContain('verify')
        expect(calls).toContain('tonSign')
        expect(calls).toContain('evmSign')

        expect(calls.indexOf('verify')).toBeLessThan(calls.indexOf('tonSign'))
        expect(calls.indexOf('verify')).toBeLessThan(calls.indexOf('evmSign'))
    })

    it('saveTonSettlement, tonFeeRelay den ONCE cagrilir', async () => {
        await run()

        expect(calls).toContain('save')
        expect(calls).toContain('relay')
        expect(calls.indexOf('save')).toBeLessThan(calls.indexOf('relay'))
    })

    it('verifyTonQuote firlatirsa HICBIR imza fonksiyonu cagrilmaz', async () => {
        const bad = goldenClone()
        bad.sign.feeAuth.actionHash = '0x' + 'ff'.repeat(32) // V1'i kirar: actionHash artik hash(payloadBoc) ile uyusmuyor
        const signers = makeSigners()

        await expect(run({ quoteResult: bad, signers })).rejects.toThrow()

        expect(signers.tonSign).not.toHaveBeenCalled()
        expect(signers.evmSignTypedData).not.toHaveBeenCalled()
        expect(tonFeeRelay).not.toHaveBeenCalled()
    })

    it('dogrulama duserse makbuz YAZILMAZ', async () => {
        const bad = goldenClone()
        bad.sign.feeAuth.actionHash = '0x' + 'ff'.repeat(32)

        await expect(run({ quoteResult: bad })).rejects.toThrow()

        const all = await loadAllTonSettlements()
        expect(Object.keys(all)).toHaveLength(0)
    })
})

describe('on kapilar', () => {
    it('relayActive false ise quote a bile gidilmez', async () => {
        const inactive = { ton: { enabled: false, rateFresh: true, wallet: 'W5' } }

        await expect(run({ statusResult: inactive })).rejects.toMatchObject({ code: 'TON_RELAY_UNAVAILABLE' })

        expect(tonFeeQuote).not.toHaveBeenCalled()
    })

    it('EVM kasasi yoksa evmSignTypedData a HIC gidilmez', async () => {
        const signers = makeSigners()

        // Bos `vaults`: findVaultForAccount hicbir kasa bulamaz - TON'a kilitli hesabin
        // gercek dunyadaki hali (EVM anahtari olmayan bir kasa).
        await expect(run({ vlts: [], signers })).rejects.toMatchObject({ code: 'TON_RELAY_NO_EVM_VAULT' })

        expect(signers.evmSignTypedData).not.toHaveBeenCalled()
        expect(tonFeeQuote).not.toHaveBeenCalled()
    })

    it('cozulmemis makbuz varsa DUR - ikinci kez odetmeyiz', async () => {
        // Baska bir islemden kalma, suresi henuz gecmemis bir makbuz. hasUnsettledTonFee
        // moddan/cuzdandan BAGIMSIZ kilitler (T5 sozlesmesi) - farkli bir cuzdan/hash olmasi
        // yeterli.
        await saveTonSettlement({
            tonWallet: 'baska-cuzdan',
            actionHash: '0x' + 'ab'.repeat(32),
            phase: 'relay-inflight',
            deadline: Math.floor(Date.now() / 1000) + 600,
        })
        calls.length = 0

        await expect(run()).rejects.toMatchObject({ code: 'TON_RELAY_PENDING_SETTLEMENT' })

        expect(tonFeeQuote).not.toHaveBeenCalled()
    })
})

// Review bulgusu 4: saveTonSettlement artik `true`/`false` doner (T5 degisikligi). Yazma
// basarisiz olursa (kota asimi, IO hatasi, depo yok) relay'e HIC gidilmemeli - aksi halde
// ucret alinir ama diskte hicbir kanit kalmaz, tam da bu siranin onlemeye calistigi durum.
describe('makbuz diske inmezse relay HIC cagrilmaz', () => {
    it('saveTonSettlement false donerse TON_RELAY_NO_RECEIPT_STORE firlatir, relay cagrilmaz', async () => {
        _setTonSettlementStore(throwingStore())

        await expect(run()).rejects.toMatchObject({ code: 'TON_RELAY_NO_RECEIPT_STORE' })

        expect(tonFeeRelay).not.toHaveBeenCalled()
    })
})

describe('yalniz TANINAN eylem turleri', () => {
    it('TANINMAYAN kind FIRLATIR, hicbir ag cagrisi yapilmaz', async () => {
        // Sunucunun olculen sozlesmesinde `kind` yalniz 'ton' ve 'jetton' (design 2.2).
        // TON takasi bir DEX yonlendiricisine giden forward_payload'a ihtiyac duyar; ne
        // sunucu sozlesmesi onu ifade edebiliyor ne de dogrulama kapisi acabiliyor
        // (parseJettonBody dolu forward_payload'da duser). Bu yuzden buradan GECMEZ.
        const signers = makeSigners()
        const swapActions = [{ kind: 'swap', to: SELF, amount: AMOUNT }]

        await expect(executeTonViaRelayer({
            account, vaults, actions: swapActions, intent: baseIntent(),
            approvedAtsFee: BigInt(GOLDEN.atsFee), txId: 't', signers,
        })).rejects.toMatchObject({ code: 'TON_RELAY_UNSUPPORTED_ACTION' })

        expect(readTonFeeStatus).not.toHaveBeenCalled()
        expect(tonFeeQuote).not.toHaveBeenCalled()
    })

    // Review bulgusu 1: `Array.isArray(actions) ? actions : []` bir NESNE (dizi degil)
    // gecirilirse sessizce BOS diziye duser, dongu hic calismaz ve "sorun yok" sanilir.
    it('actions DIZI DEGILSE (tek bir nesne) FIRLATIR, hicbir ag cagrisi yapilmaz', async () => {
        const signers = makeSigners()
        const notAnArray = { kind: 'jetton', to: SELF, amount: AMOUNT }

        await expect(executeTonViaRelayer({
            account, vaults, actions: notAnArray, intent: baseIntent(),
            approvedAtsFee: BigInt(GOLDEN.atsFee), txId: 't', signers,
        })).rejects.toMatchObject({ code: 'TON_RELAY_UNSUPPORTED_ACTION' })

        expect(readTonFeeStatus).not.toHaveBeenCalled()
        expect(tonFeeQuote).not.toHaveBeenCalled()
    })

    // Review bulgusu 1: BOS dizi de ayni sekilde sessizce gecerdi - verifyTonQuote'un V5'i
    // intent.actions'i da [] kabul edip payload.messages.length===0 ile eslestirir, yani
    // SIFIR eylemli bir W5 govdesi HER kontrolden gecer, iki imza uretilir ve relay
    // hicbir sey yapmayan bir govde icin ~18 ATS tahsil eder.
    it('actions BOS DIZI ise FIRLATIR (sifir eylemli govde her kontrolden gecerdi)', async () => {
        const signers = makeSigners()

        await expect(executeTonViaRelayer({
            account, vaults, actions: [], intent: baseIntent(),
            approvedAtsFee: BigInt(GOLDEN.atsFee), txId: 't', signers,
        })).rejects.toMatchObject({ code: 'TON_RELAY_UNSUPPORTED_ACTION' })

        expect(readTonFeeStatus).not.toHaveBeenCalled()
        expect(tonFeeQuote).not.toHaveBeenCalled()
    })
})

// GOREV 10, YUKUMLULUK 2 - SIRA: once ISLEM DURUMU, sonra MAKBUZUN SILINMESI.
//
// Bu dosya artik basarida makbuzu SILMEZ; `{ status: 'sent', settlementKey }` doner ve
// silme CAGIRANA aittir - cagiran once `updateTxStatus(..., 'success')` yazar. Ters
// sirada service worker tam aradaki bosluktan olurse islem 'processing'te makbuzsuz
// kalir; bu tam olarak YETIM taramasinin imzasidir ve ucreti ALINMIS bir islem
// "ucret alinmadi" diye etiketlenir. Bayat makbuz kurtarilabilir (kurtarma zincirden
// dogrulayip siler); yanlis etiketlenmis islem 'unresolved' terminal oldugu icin
// DUZELMEZ.
describe('basarida makbuz BU DOSYADAN silinmez (yukumluluk 2)', () => {
    it('200 + DOLU govde -> makbuz DURUR, status "sent", settlementKey doner', async () => {
        const res = await run({ relayResult: { success: true, txHash: '0xdeadbeef' } })

        // Cagiranin silebilmesi icin ihtiyaci olan iki alan.
        expect(res.status).toBe('sent')
        expect(res.settlementKey).toBe(settlementKeyFor())

        // ESLENMIS IDDIA 1: kayit HALA orada (silinseydi bu duserdi).
        const all = await loadAllTonSettlements()
        expect(all[settlementKeyFor()].phase).toBe('relay-inflight')
        // ESLENMIS IDDIA 2: silme fonksiyonuna HIC dokunulmadi (kayit baska bir
        // sebeple orada duruyor olsa bile bu duser).
        expect(calls).not.toContain('clear')
    })

    it('200 ama govde BOS -> status "sent" DEGIL (cagiran silmemeli)', async () => {
        // Asimetrik risk kurali (review bulgusu 3) KORUNUR: bos/null bir 2xx
        // govdesi belirsizdir. Silme karari artik cagiranda oldugu icin belirsizlik
        // de ONA tasinmali - yoksa cagiran her 2xx'te silerdi.
        const res = await run({ relayResult: null })
        expect(res.status).toBe('unconfirmed')
    })
})

// GOREV 10, YUKUMLULUK 5: ILK relay cagrisi da withKeepAlive ile sarilir. Asil
// service worker olum penceresi BURADA - kurtarmadaki tekrar denemede (attemptRelay,
// zaten sarili) degil. Sarmalayici bir HEURISTIKTIR (swKeepAlive.js), asil savunma
// diske yazilan makbuz; ama pencereyi daraltmayi ilk cagrida yapmamak, en genis
// pencereyi acikta birakmak demekti.
describe('relay cagrisi withKeepAlive ile sarili (yukumluluk 5)', () => {
    it('relay, keep-alive sarmalayicisinin ICINDE cagrilir', async () => {
        await run()

        // VARLIK once (yoklukla saglanan sira iddiasi tuzagi): eksik bir dize
        // indexOf'ta -1 doner ve -1 < N her zaman dogrudur.
        const basla = calls.indexOf('ka-basla')
        const relay = calls.indexOf('relay')
        const bitir = calls.indexOf('ka-bitir')
        expect(basla).toBeGreaterThan(-1)
        expect(relay).toBeGreaterThan(-1)
        expect(bitir).toBeGreaterThan(-1)
        expect(basla).toBeLessThan(relay)
        expect(relay).toBeLessThan(bitir)
    })

    it('sarmalayici /quote ve IMZALARI kapsamaz - yalniz relay', async () => {
        // Tum akisi sarmak SW'i gereksiz yere uzun sure ayakta tutmaya calisirdi;
        // ustelik sarmalayicinin kapsami buyudukce hangi adimin korundugunu
        // soylemek zorlasir. Olculen sey: keep-alive imzalardan SONRA basliyor.
        await run()
        expect(calls.indexOf('evmSign')).toBeGreaterThan(-1)
        expect(calls.indexOf('ka-basla')).toBeGreaterThan(calls.indexOf('evmSign'))
    })
})

describe('sonuc eslemesi', () => {

    // Review bulgusu 3 (asimetrik risk kurali): /relay'in tam govde sekli olculmedi (design
    // 10 R1). BOS/null bir 2xx govdesi GERCEKTEN belirsizdir - "basarili" sayip SILMEK,
    // alinmis bir ucretin TEK kanitini KALICI olarak yok edebilir; oysa GEREKENDEN FAZLA
    // saklamak kendi kendini iyilestirir (Task 7'nin kurtarmasi zincirden actionHash'i
    // dogrulayip siler). Bu yuzden yalniz govde DOLU bir nesneyse silinir.
    it('200 ama govde NULL -> makbuz SILINMEZ (belirsiz, kurtarma karar verir)', async () => {
        await run({ relayResult: null })

        const all = await loadAllTonSettlements()
        const rec = all[settlementKeyFor()]
        expect(rec.phase).toBe('relay-inflight')
    })

    it('200 ama govde BOS NESNE ({}) -> makbuz SILINMEZ (belirsiz, kurtarma karar verir)', async () => {
        await run({ relayResult: {} })

        const all = await loadAllTonSettlements()
        const rec = all[settlementKeyFor()]
        expect(rec.phase).toBe('relay-inflight')
    })

    it('502 + receipt -> phase collected, receipt ve settlementId saklanir', async () => {
        const err = new TonFeeError('gateway hatasi', {
            httpStatus: 502,
            code: 'ton-fee-already-settled',
            receipt: { txHash: '0xabc' },
            settlementId: 'S-502',
        })

        await expect(run({ relayError: err })).rejects.toThrow()

        const all = await loadAllTonSettlements()
        const rec = all[settlementKeyFor()]
        expect(rec.phase).toBe('collected')
        expect(rec.receipt).toEqual({ txHash: '0xabc' })
        expect(rec.settlementId).toBe('S-502')
    })

    it('400 ton-fee-already-settled -> collected, settlementId yakalanir', async () => {
        const err = new TonFeeError('zaten tahsil edildi', {
            httpStatus: 400,
            code: 'ton-fee-already-settled',
            settlementId: 'S-400',
        })

        await expect(run({ relayError: err })).rejects.toThrow()

        const all = await loadAllTonSettlements()
        const rec = all[settlementKeyFor()]
        expect(rec.phase).toBe('collected')
        expect(rec.settlementId).toBe('S-400')
    })

    it('502 ton-collect-failed -> makbuz SILINIR (tahsilat YAPILMADI)', async () => {
        const err = new TonFeeError('tahsilat basarisiz', { httpStatus: 502, code: 'ton-collect-failed' })

        await expect(run({ relayError: err })).rejects.toThrow()

        const all = await loadAllTonSettlements()
        expect(Object.keys(all)).toHaveLength(0)
    })

    it('400 KODSUZ -> makbuz SILINMEZ', async () => {
        const err = new TonFeeError('bilinmeyen', { httpStatus: 400, code: null })

        await expect(run({ relayError: err })).rejects.toThrow()

        const all = await loadAllTonSettlements()
        const rec = all[settlementKeyFor()]
        expect(rec.phase).toBe('relay-inflight')
    })

    it('ag hatasi -> makbuz SILINMEZ', async () => {
        const err = new TonFeeError('ag hatasi', { phase: 'relay' }) // httpStatus/code YOK

        await expect(run({ relayError: err })).rejects.toThrow()

        const all = await loadAllTonSettlements()
        const rec = all[settlementKeyFor()]
        expect(rec.phase).toBe('relay-inflight')
    })
})

// Review bulgusu 2: signers.tonSign ham bayt (Buffer/Uint8Array) doner. JSON.stringify bir
// Buffer'i {"type":"Buffer","data":[...]} yazar - hem /relay govdesinde kardesi
// feeAuthSignature ('0x...' string) ile TUTARSIZ bir sekil olusur, hem de chrome.storage.local
// diske AYNI nesneyi yazar ve kilitliyken calismasi gereken kurtarma (Task 7) bayt yerine
// bir nesne okur.
describe('ed25519 imzasi hex string olarak tasinir (review bulgusu 2)', () => {
    it('/relay govdesine giden signature STRING (Buffer/nesne DEGIL)', async () => {
        await run()

        const relayBody = tonFeeRelay.mock.calls[0][0]
        expect(typeof relayBody.signature).toBe('string')
        expect(relayBody.signature).toMatch(/^0x[0-9a-f]+$/)
        // JSON.stringify UZERINDEN gercekten ayni string kaliyor mu - bir Buffer bu
        // turdan gecseydi {"type":"Buffer","data":[...]} olurdu.
        expect(JSON.parse(JSON.stringify(relayBody)).signature).toBe(relayBody.signature)
    })

    it('diske yazilan makbuzdaki signature STRING (Buffer/nesne DEGIL)', async () => {
        const err = new TonFeeError('kodsuz', { httpStatus: 400, code: null }) // kayit BIRAKILSIN
        await expect(run({ relayError: err })).rejects.toThrow()

        const all = await loadAllTonSettlements()
        const rec = all[settlementKeyFor()]
        expect(typeof rec.signature).toBe('string')
        expect(rec.signature).toMatch(/^0x[0-9a-f]+$/)
    })
})

describe('cuzdan adresi kanonik', () => {
    it('EQ... ve UQ... yazimlari AYNI makbuz kaydina duser', async () => {
        // Ikisi de KODSUZ 400 ile biter - kayit HER IKI kosuda da SILINMEZ, bu yuzden
        // asagida her iki cagrinin AYNI kayda yazip yazmadigini inceleyebiliyoruz.
        const codeless = () => new TonFeeError('kodsuz', { httpStatus: 400, code: null })

        await expect(run({ intentOverride: { tonWallet: SELF }, relayError: codeless(), txId: 'run-1' }))
            .rejects.toThrow()
        await expect(run({ intentOverride: { tonWallet: SELF_UQ }, relayError: codeless(), txId: 'run-2' }))
            .rejects.toThrow()

        const all = await loadAllTonSettlements()
        // Kanoniklestirme OLMASAYDI iki farkli yazim iki farkli anahtar uretirdi ve burada
        // 2 kayit gorulurdu - biri asla guncellenip silinemeyen bir "hayalet" makbuz olarak
        // kalici olarak diskte kalirdi (T5 incelemesinin bulgusu, gorev 6 brief'i).
        expect(Object.keys(all)).toHaveLength(1)
        expect(Object.values(all)[0].txId).toBe('run-2')
        expect(Object.keys(all)[0]).toBe(settlementKeyFor())
    })
})

describe('TonRelayerError', () => {
    it('.code alanini tasir', () => {
        const e = new TonRelayerError('TON_RELAY_UNAVAILABLE')
        expect(e).toBeInstanceOf(Error)
        expect(e.code).toBe('TON_RELAY_UNAVAILABLE')
    })
})

// ---------------------------------------------------------------------------
// JETTON EYLEM SEKLI
//
// Sunucunun OLCULEN sozlesmesinde tutar alaninin adi TURE GORE DEGISIR ve sunucu
// TANIMADIGI alani REDDEDER (`actions[0].amountNano bilinmiyor`). Bu yuzden /quote
// govdesi `actions`in KENDISI olamaz: `jettonWallet` yalniz istemcinin dogrulama
// girdisidir ve sunucuya GITMEMELIDIR.
// ---------------------------------------------------------------------------
// Jetton master YALNIZ /quote govdesine tasinir - bu dosyadaki hicbir kod onu
// COZMEZ, o yuzden gecerli bicimli herhangi bir adres yeterlidir.
const JETTON_MASTER = 'EQAREREREREREREREREREREREREREREREREREREREREREeYT'
const JETTON_WALLET = 'EQDWTpfN3Bw5DC_yENjpItwdG1d9BqhvsScTpxTquIF5XnCq'
const jettonClone = () => JSON.parse(JSON.stringify(JETTON))
const jettonActions = (over = {}) => [{
    kind: 'jetton',
    jettonMaster: JETTON_MASTER,
    jettonWallet: JETTON_WALLET,
    to: SELF,
    amount: '1000',
    ...over,
}]
// Olculen jetton quote'unun kendi zaman penceresi: GOLDEN'in `now`u ile V11
// (pencere 180sn) duserdi.
const jettonIntentOverride = { now: JETTON.validUntil - 60 }

describe('jetton eylemleri', () => {
    it('jetton eylemi TUM akistan gecer (dogrulama dahil)', async () => {
        const res = await run({
            acts: jettonActions(),
            quoteResult: jettonClone(),
            intentOverride: jettonIntentOverride,
        })

        expect(calls).toContain('verify')
        expect(res.settlementKey).toBe(settlementKeyFor(JETTON.sign.feeAuth.actionHash))
    })

    // Sunucu `amountNano`yu jetton eyleminde REDDEDIYOR (olculdu). Alan adi yanlissa
    // /quote hic donmez ve akis kullaniciya anlamsiz bir hatayla duser.
    it('/quote govdesi jetton icin `amount` gonderir, `amountNano` GONDERMEZ', async () => {
        await run({ acts: jettonActions(), quoteResult: jettonClone(), intentOverride: jettonIntentOverride })

        const istek = tonFeeQuote.mock.calls[0][0]
        expect(istek.actions).toEqual([
            { kind: 'jetton', jettonMaster: JETTON_MASTER, to: SELF, amount: '1000' },
        ])
    })

    // `jettonWallet` ISTEMCI TARAFININ dogrulama girdisidir (hangi tokenin gittigi).
    // Sunucu tanimadigi alani reddettigi icin /quote govdesine SIZMAMALI.
    it('/quote govdesine jettonWallet SIZMAZ', async () => {
        await run({ acts: jettonActions(), quoteResult: jettonClone(), intentOverride: jettonIntentOverride })

        expect(tonFeeQuote.mock.calls[0][0].actions[0]).not.toHaveProperty('jettonWallet')
    })

    // Tutarlar bigint olabilir ve JSON.stringify bigint'te FIRLATIR - /quote istegi
    // ag katmanina hic ulasmadan patlardi.
    it('bigint tutar /quote govdesine STRING olarak gider', async () => {
        await run({ acts: [{ kind: 'ton', to: SELF, amountNano: 1000000n }] })

        const istek = tonFeeQuote.mock.calls[0][0]
        expect(istek.actions).toEqual([{ kind: 'ton', to: SELF, amountNano: '1000000' }])
        expect(() => JSON.stringify(istek)).not.toThrow()
    })

    // `jettonWallet` OLMADAN hangi jetton cuzdanindan gectigi dogrulanamaz - yani
    // gonderilen TOKENIN hangisi oldugu dogrulanamaz. Kapali tarafa duseriz.
    it('jettonWallet YOKSA FIRLATIR, hicbir ag cagrisi yapilmaz', async () => {
        const signers = makeSigners()
        const eksik = jettonActions()
        delete eksik[0].jettonWallet

        await expect(executeTonViaRelayer({
            account, vaults, actions: eksik, intent: baseIntent(),
            approvedAtsFee: BigInt(GOLDEN.atsFee), txId: 't', signers,
        })).rejects.toMatchObject({ code: 'TON_RELAY_UNSUPPORTED_ACTION' })

        expect(readTonFeeStatus).not.toHaveBeenCalled()
        expect(tonFeeQuote).not.toHaveBeenCalled()
    })

    it('jettonMaster YOKSA FIRLATIR', async () => {
        const eksik = jettonActions()
        delete eksik[0].jettonMaster

        await expect(executeTonViaRelayer({
            account, vaults, actions: eksik, intent: baseIntent(),
            approvedAtsFee: BigInt(GOLDEN.atsFee), txId: 't', signers: makeSigners(),
        })).rejects.toMatchObject({ code: 'TON_RELAY_UNSUPPORTED_ACTION' })

        expect(tonFeeQuote).not.toHaveBeenCalled()
    })

    // Tutari OLMAYAN eylem: `String(undefined)` sunucuya 'undefined' gonderirdi.
    it('tutar YOKSA FIRLATIR', async () => {
        const eksik = jettonActions({ amount: undefined })

        await expect(executeTonViaRelayer({
            account, vaults, actions: eksik, intent: baseIntent(),
            approvedAtsFee: BigInt(GOLDEN.atsFee), txId: 't', signers: makeSigners(),
        })).rejects.toMatchObject({ code: 'TON_RELAY_UNSUPPORTED_ACTION' })

        expect(tonFeeQuote).not.toHaveBeenCalled()
    })

    // TANIMADIGIMIZ ALAN SESSIZCE SILINEMEZ. `quoteAction` eylemi sabit bir beyaz
    // listeden yeniden kurar; listede olmayan bir alan /quote'a HIC gitmez, sunucu
    // onsuz bir govde kurar ve V5 o govdeyi "niyetle birebir" diye DOGRULAR.
    // Bunun bedeli somut: memosuz bir borsa yatirimi KAYIP sayilir (bkz.
    // jettonTransfer.js kapi 1). Sessiz dusurme yerine kapali kapi.
    //
    // ORNEK DEGISTI, KURAL DEGISMEDI (2026-09-15). Bu test eskiden `comment`i
    // "taninmayan alan" ornegi olarak kullaniyordu; `comment` ARTIK jetton
    // eyleminde de TANINIYOR (asagidaki testler). Yerine gelen ornek UYDURMA
    // DEGIL, OLCULEN alan: ayni gunku ayirt edici olcumde canli sunucu
    // `comment`i KABUL, `gasTonNano`yu REDDETTI ("actions[0].gasTonNano is
    // unknown") -- yani gonderilseydi /quote istegin TAMAMINI dusururdu.
    it('TANINMAYAN alan (gasTonNano) tasiyan jetton eylemi FIRLATIR', async () => {
        const yabanci = jettonActions({ gasTonNano: '5000000' })

        await expect(executeTonViaRelayer({
            account, vaults, actions: yabanci, intent: baseIntent(),
            approvedAtsFee: BigInt(GOLDEN.atsFee), txId: 't', signers: makeSigners(),
        })).rejects.toMatchObject({ code: 'TON_RELAY_UNSUPPORTED_ACTION' })

        expect(tonFeeQuote).not.toHaveBeenCalled()
    })

    // JETTON NOTU ARTIK GECER -- ve SESSIZCE DUSMEDEN gecer.
    //
    // Eski kisit ("jetton eyleminde yorum alani yok") olculdu ve yanlis cikti.
    // Ama acilan kapinin TEK basina degeri yok: asil gereksinim notun /quote'a
    // GERCEKTEN gitmesi. Duz TON dalindaki ayni test, ayni sebeple.
    it('jetton eyleminde yorum KABUL EDILIR ve /quote a TASINIR', async () => {
        // JETTON altin vektorunun govdesinde forward_payload YOK. Niyet
        // yorumluyken bu bir SAPMADIR, yani bu tek test IKI seyi birden
        // kanitliyor: (a) alan eylem kapisindan gecip /quote'a tasiniyor,
        // (b) notu YOK SAYAN bir sunucu V5'te reddediliyor.
        await expect(run({
            acts: jettonActions({ comment: 'memo-123' }),
            quoteResult: jettonClone(),
            intentOverride: jettonIntentOverride,
        })).rejects.toMatchObject({ code: 'TON_QUOTE_INTENT_MISMATCH' })

        expect(tonFeeQuote).toHaveBeenCalled()
        expect(tonFeeQuote.mock.calls[0][0].actions[0]).toMatchObject({ kind: 'jetton', comment: 'memo-123' })
    })

    // TAKAS ALANLARI. Sunucunun jetton kumesi (sozlesme ss04) `forwardTonNano` ve
    // `forwardPayloadBoc` tasiyor; ikisi 2026-09-15'te AYIRT EDICI bir olcumle
    // dogrulandi (ayni turda `gasTonNano` ve uydurma bir alan REDDEDILDI).
    it('takas alanlari /quote a TASINIR', async () => {
        await expect(run({
            acts: jettonActions({ forwardTonNano: '240000000', forwardPayloadBoc: 'te6cckEBAQEAAgAAAEysuc0=' }),
            quoteResult: jettonClone(),
            intentOverride: jettonIntentOverride,
        })).rejects.toMatchObject({ code: 'TON_QUOTE_INTENT_MISMATCH' })

        expect(tonFeeQuote.mock.calls[0][0].actions[0]).toMatchObject({
            kind: 'jetton', forwardTonNano: '240000000', forwardPayloadBoc: 'te6cckEBAQEAAgAAAEysuc0=',
        })
    })

    // AYNI SLOT - sunucu da reddediyor ("comment and forwardPayloadBoc cannot be
    // given together"). Istemci ONCE duser: sunucunun reddettigi bir istegi
    // gondermek, kullaniciya odeyemeyecegi bir ucret gosterme riskidir.
    it('yorum ve yuk BIRLIKTE gelirse FIRLATIR, ag cagrisi yapilmaz', async () => {
        await expect(executeTonViaRelayer({
            account, vaults,
            actions: jettonActions({
                comment: 'x', forwardTonNano: '240000000',
                forwardPayloadBoc: 'te6cckEBAQEAAgAAAEysuc0=',
            }),
            intent: baseIntent(),
            approvedAtsFee: BigInt(GOLDEN.atsFee), txId: 't', signers: makeSigners(),
        })).rejects.toMatchObject({ code: 'TON_RELAY_UNSUPPORTED_ACTION' })

        expect(tonFeeQuote).not.toHaveBeenCalled()
    })

    // YUK VARSA FORWARD PAYI ZORUNLU. Sunucunun varsayilani 1 nanoton ve o bir
    // DEX cagrisini FONLAMAZ: swap router'da gazsiz kalir, zincirde sessizce
    // duser -- ucret ise coktan alinmistir. Sozlesme ss04 bunu acikca bize
    // birakiyor: "Backend alt sinir dayatmaz; DEX'in istedigi duzeye siz cikarin".
    it('yuk VARKEN forward payi YOKSA FIRLATIR', async () => {
        await expect(executeTonViaRelayer({
            account, vaults,
            actions: jettonActions({ forwardPayloadBoc: 'te6cckEBAQEAAgAAAEysuc0=' }),
            intent: baseIntent(),
            approvedAtsFee: BigInt(GOLDEN.atsFee), txId: 't', signers: makeSigners(),
        })).rejects.toMatchObject({ code: 'TON_RELAY_UNSUPPORTED_ACTION' })

        expect(tonFeeQuote).not.toHaveBeenCalled()
    })

    it('forward payi SIFIR ise FIRLATIR', async () => {
        await expect(executeTonViaRelayer({
            account, vaults,
            actions: jettonActions({ forwardTonNano: '0', forwardPayloadBoc: 'te6cckEBAQEAAgAAAEysuc0=' }),
            intent: baseIntent(),
            approvedAtsFee: BigInt(GOLDEN.atsFee), txId: 't', signers: makeSigners(),
        })).rejects.toMatchObject({ code: 'TON_RELAY_UNSUPPORTED_ACTION' })

        expect(tonFeeQuote).not.toHaveBeenCalled()
    })

    // Duz TON koluyla AYNI normalizasyon: bos/bosluk not alani HIC gonderilmez.
    // Iki kol ayrisirsa biri bos hucre kurdurur, digeri kurdurmaz ve V5 yalniz
    // birinde yesil yanar.
    it('bos/bosluk jetton yorumu /quote govdesine HIC konmaz', async () => {
        await run({
            acts: jettonActions({ comment: '   ' }),
            quoteResult: jettonClone(),
            intentOverride: jettonIntentOverride,
        })

        expect(tonFeeQuote.mock.calls[0][0].actions[0]).not.toHaveProperty('comment')
    })

    // ORNEK DEGISTI, KURAL DEGISMEDI (2026-09-14). Bu test eskiden `comment`i
    // "taninmayan alan" ornegi olarak kullaniyordu; `comment` ARTIK duz TON
    // eyleminde TANINIYOR (asagidaki testler), o yuzden kurali olcmek icin
    // gercekten taninmayan bir alan gerekiyor. Kural aynen duruyor.
    it('TANINMAYAN alan tasiyan duz TON eylemi FIRLATIR', async () => {
        await expect(executeTonViaRelayer({
            account, vaults,
            actions: [{ kind: 'ton', to: SELF, amountNano: AMOUNT, forwardPayload: 'te6ccgEB' }],
            intent: baseIntent(),
            approvedAtsFee: BigInt(GOLDEN.atsFee), txId: 't', signers: makeSigners(),
        })).rejects.toMatchObject({ code: 'TON_RELAY_UNSUPPORTED_ACTION' })

        expect(tonFeeQuote).not.toHaveBeenCalled()
    })

    // YORUM ARTIK GECER -- ve SESSIZCE DUSMEDEN gecer.
    //
    // Eski kisit ("sunucunun eylem sozlesmesinde yorum alani yok") OLCULDU ve
    // yanlis cikti. Ama acilan kapinin TEK basina degeri yok: asil gereksinim
    // notun /quote'a GERCEKTEN gitmesi. Gitmezse sunucu notsuz bir govde kurar,
    // V5 onu "niyetle birebir" diye dogrular ve memosuz giden bir borsa yatirimi
    // KAYIP sayilir. Bu yuzden test kapinin acildigini degil, ALANIN TASINDIGINI
    // olcer.
    it('duz TON eyleminde yorum KABUL EDILIR ve /quote a TASINIR', async () => {
        // GOLDEN govdesinde yorum YOK. Niyet yorumluyken bu bir SAPMADIR, yani bu
        // tek test IKI seyi birden kanitliyor: (a) alan eylem kapisindan gecip
        // /quote'a tasiniyor, (b) notu YOK SAYAN bir sunucu V5'te reddediliyor.
        // Ikincisi olmadan birincisi tehlikeli olurdu - not gonderilir ama
        // dusuruldugu fark edilmezdi.
        await expect(run({ acts: [{ kind: 'ton', to: SELF, amountNano: AMOUNT, comment: 'memo-123' }] }))
            .rejects.toMatchObject({ code: 'TON_QUOTE_INTENT_MISMATCH' })

        expect(tonFeeQuote).toHaveBeenCalled()
        expect(tonFeeQuote.mock.calls[0][0].actions[0]).toMatchObject({ kind: 'ton', comment: 'memo-123' })
    })

    // BOS/BOSLUK NOT ALANI HIC GONDERILMEZ. Bos dizeyle gondermek sunucuya BOS bir
    // yorum hucresi kurdurabilir; o zaman V5'in bekledigi hash (null) ile gelen
    // hash (bos hucre) AYRISIR ve GECERLI bir gonderim reddedilir.
    it('bos/bosluk yorum alani /quote govdesine HIC konmaz', async () => {
        // Bu cagri UCTAN UCA GECER (GOLDEN govdesinde de yorum yok) - ve gecmesi
        // kanittir: alan bos dizeyle gonderilseydi sunucu BOS bir yorum hucresi
        // kurabilir, V5'in bekledigi hash (null) ile gelen hash AYRISIR ve gecerli
        // bir gonderim reddedilirdi.
        await run({ acts: [{ kind: 'ton', to: SELF, amountNano: AMOUNT, comment: '   ' }] })

        expect(tonFeeQuote.mock.calls[0][0].actions[0]).not.toHaveProperty('comment')
    })

    // Jetton eyleminin `jettonWallet`i duz TON eyleminde ANLAMSIZDIR - tur icin
    // taninmayan bir alan da taninmayan alandir.
    it('duz TON eyleminde jettonWallet FIRLATIR', async () => {
        await expect(executeTonViaRelayer({
            account, vaults,
            actions: [{ kind: 'ton', to: SELF, amountNano: AMOUNT, jettonWallet: JETTON_WALLET }],
            intent: baseIntent(),
            approvedAtsFee: BigInt(GOLDEN.atsFee), txId: 't', signers: makeSigners(),
        })).rejects.toMatchObject({ code: 'TON_RELAY_UNSUPPORTED_ACTION' })

        expect(tonFeeQuote).not.toHaveBeenCalled()
    })

    it('duz TON eyleminde amountNano YOKSA FIRLATIR', async () => {
        await expect(executeTonViaRelayer({
            account, vaults, actions: [{ kind: 'ton', to: SELF }], intent: baseIntent(),
            approvedAtsFee: BigInt(GOLDEN.atsFee), txId: 't', signers: makeSigners(),
        })).rejects.toMatchObject({ code: 'TON_RELAY_UNSUPPORTED_ACTION' })

        expect(tonFeeQuote).not.toHaveBeenCalled()
    })
})

// "TEK AYIRT EDICI account.type" (2026-09-05 tasarim belgesi §2.1) bu blok olmadan
// DOGRU DEGIL: bu dosyada `accountHasEvm`in IKINCI bir yazimi vardi
// (EVM_CAPABLE_ACCOUNT_TYPES kumesi). Iki kopya kacinilmaz sekilde ayrisir --
// accountKind.js'e yeni bir hesap turu eklendiginde arayuz relay secenegini
// gosterir, arka plan reddederdi (ya da tersi, ki daha kotu: gosterilmeyen bir
// secenek zaten uygulanabilir olurdu).
//
// DUZELTME (2026-09-10, inceleme turu 2): bir onceki tur burada "accountHasEvm
// artik KULLANILAMAZ, dogrudan account.type === 'ton' esitligine gecildi"
// diyordu -- accountKind.js'teki bir spec olcum hatasina dayaniyordu. Olculdu:
// yanlisti. `type:'ton'` artik hicbir akis URETMIYOR, kalan kayitlarin
// GERCEKTEN EVM'i yok (accountKindsOf duzeltildi), yani `accountHasEvm` TEK
// KAYNAK ilkesi GERI GECERLI: yerel bir ikinci yazim asla geri GELMEMELI,
// ama dogru kaynak `accountKind.js`in KENDISIYDI, dogrudan tip kontrolu
// degil.
describe('accountHasEvm TEK KAYNAK -- ikinci kopya geri gelmez', () => {
    const SRC = readFileSync(fileURLToPath(new URL('./tonFeeRelayer.js', import.meta.url)), 'utf8')

    it('accountKind ten accountHasEvm ice aktarilir', () => {
        expect(SRC).toMatch(
            /import\s*\{[^}]*\baccountHasEvm\b[^}]*\}\s*from\s*['"]\.\.\/accountKind['"]/)
    })

    it('evmVaultResolvable accountHasEvm i GERCEKTEN cagirir', () => {
        const fn = SRC.slice(SRC.indexOf('export function evmVaultResolvable'))
        expect(fn.slice(0, fn.indexOf('\n}'))).toContain('accountHasEvm(account)')
    })

    // Yerel tur kumesi silinmis olmali: birakilirsa okunmayan bir kopya olarak
    // durur ve ileride biri onu "asil kapi" sanip guncelleyebilir.
    it('yerel EVM tur kumesi SILINMIS', () => {
        expect(SRC).not.toContain('EVM_CAPABLE_ACCOUNT_TYPES')
    })
})

// Davranis kilidi: refactor bir DAVRANIS degisikligi DEGIL. Bu dort vaka
// refactor'dan once de sonra da ayni sonucu vermeli.
describe('evmVaultResolvable davranisi refactor dan ETKILENMEZ', () => {
    const EVM_ACC = { key: 'k1', type: 'hd', address: '0x' + '1'.repeat(40) }
    const TON_ACC = { key: 'k2', type: 'ton', address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG' }
    const VAULTS = [
        { id: 'v1', type: 'hd', accounts: [EVM_ACC] },
        { id: 'v2', type: 'tonMnemonic', accounts: [TON_ACC] },
    ]

    it('EVM hesabinda TRUE', () => {
        expect(evmVaultResolvable(VAULTS, EVM_ACC)).toBe(true)
    })

    it('TON hesabinda FALSE -- ATS BSC de imzalayacak anahtar YOK', () => {
        expect(evmVaultResolvable(VAULTS, TON_ACC)).toBe(false)
    })

    it('bilinmeyen tipte FALSE -- relay secenegi tahminle acilmaz', () => {
        expect(evmVaultResolvable(VAULTS, { key: 'k3', address: '0x' + '2'.repeat(40) })).toBe(false)
    })

    it('kasasi bulunamayan EVM hesabinda FALSE', () => {
        expect(evmVaultResolvable([], EVM_ACC)).toBe(false)
    })
})
