import { describe, it, expect } from 'vitest'
import {
    beginCell, storeStateInit, Cell, Dictionary, loadStateInit, storeSimpleLibrary, loadSimpleLibrary,
} from '@ton/core'
import {
    validateSendTransactionRequest, tonNetworkId, MAX_MESSAGES, isNoopMessage, userSpentNano,
    parseTonConnectAddress, tonConnectBounce, networkMismatch,
} from './tonConnectMessages'

const NOW = 1756000000
// Ayni anahtarin (0:1111..) bicimleri. Mesaj adresi friendly OLMAK ZORUNDA
// (rpc.md: raw reddedilir); oturum adresi raw kalir.
const RAW = '0:1111111111111111111111111111111111111111111111111111111111111111'
const EQ = 'EQAREREREREREREREREREREREREREREREREREREREREREeYT'
const UQ = 'UQAREREREREREREREREREREREREREREREREREREREREREbvW'
const KQ = 'kQAREREREREREREREREREREREREREREREREREREREREREV2Z'
const ZQ = '0QAREREREREREREREREREREREREREREREREREREREREREQBc'
// Gecerlisi ...F9M ile biter: isFriendly gecer, CRC gecmez.
const BAD_CRC = 'EQCKWpx7cNMpvmcN5ObM5lLUZHZRFKqYA4xmw9jOry0ZsF9N'
// UQ BILEREK: yeniden serilestirme (toString varsayilani bounceable) onu EQ
// yapardi; dizenin AYNEN saklandigi asagida ayirt edici bicimde kilitlenir.
const MSG = { address: UQ, amount: '1000000000' }
const OK = { valid_until: NOW + 300, messages: [MSG] }
const CTX = { nowSec: NOW, walletNetwork: '-239' }

const boc = (cell) => cell.toBoc().toString('base64')
// GERCEK BOC'lar: kesik 'te6cc..' dizeleri artik cozulmeden gecemez.
const BODY_BOC = boc(beginCell().storeUint(0, 32).storeStringTail('hi').endCell())
const INIT = () => storeStateInit({
    code: beginCell().storeUint(1, 8).endCell(),
    data: beginCell().storeUint(2, 8).endCell(),
})
const INIT_BOC = boc(beginCell().store(INIT()).endCell())
// @ton/core yalniz TEK kok yazar; iki koklu BOC elle kurulur: sihir b5ee9c72,
// ref/ofset 1'er bayt, 2 hucre, 2 kok, 0 eksik, 6 bayt veri, kokler [0,1],
// iki adet 8 bitlik hucre.
const MULTI_ROOT_BOC = Buffer.from(
    'b5ee9c72' + '01' + '01' + '02' + '02' + '00' + '06' + '00' + '01' + '000201' + '000202', 'hex',
).toString('base64')

// StateInit'in kutuphane sozlugu (HashmapE 256 SimpleLib).
const KUTUPHANE_DEGERI = { serialize: (src, b) => b.store(storeSimpleLibrary(src)), parse: (s) => loadSimpleLibrary(s) }
const TEK_KUTUPHANELI_INIT = () => {
    const libs = Dictionary.empty(Dictionary.Keys.BigUint(256), KUTUPHANE_DEGERI)
    libs.set(1n, { public: true, root: beginCell().storeUint(7, 8).endCell() })
    return boc(beginCell().store(storeStateInit({
        code: beginCell().storeUint(1, 8).endCell(),
        data: beginCell().storeUint(2, 8).endCell(),
        libraries: libs,
    })).endCell())
}
// Her catal iki kolunda AYNI hucreyi tasir: BOC tekrari bir kez yazar, sozluk
// ise 2^d girdi ve d derinlikte ustel gezinti demektir.
const DERIN_KUTUPHANELI_INIT = (d) => {
    const n0 = 256 - d
    let dugum = beginCell().storeBit(1).storeBit(1).storeBit(0).storeUint(n0, Math.ceil(Math.log2(n0 + 1)))
        .storeBit(0).storeRef(beginCell().endCell()).endCell()
    for (let i = 0; i < d; i++) dugum = beginCell().storeBit(0).storeBit(0).storeRef(dugum).storeRef(dugum).endCell()
    return boc(beginCell().storeBit(0).storeBit(0).storeBit(0).storeBit(0).storeBit(1).storeRef(dugum).endCell())
}

const ADRES_HATASI = 'Message address must be a valid user-friendly address'
const TUTAR_HATASI = 'Message amount must be a decimal string of nanotons'
const ARALIK_HATASI = 'Message amount out of range'
// TON Coins = VarUInteger 16: en fazla 15 bayt.
const COINS_SINIRI = 2n ** 120n
const VU_HATASI = 'valid_until must be a uint32 unix time in seconds'
const YUK_HATASI = 'Malformed payload'
const INIT_HATASI = 'Malformed stateInit'

describe('tonNetworkId', () => {
    it('TON testnet aginda -3', () => {
        expect(tonNetworkId({ chainId: -3, kind: 'ton' })).toBe('-3')
    })

    // K3: TonConnect aktif agdan BAGIMSIZ calisir. Kullanici Ethereum'da dururken
    // TON kimligi MAINNET'tir -- testnet yalnizca kullanici ACIKCA TON testnet'e
    // gectiyse secilir.
    it.each([{ chainId: 1 }, { chainId: -239, kind: 'ton' }, null, undefined])('diger her durumda -239', (net) => {
        expect(tonNetworkId(net)).toBe('-239')
    })
})

describe('validateSendTransactionRequest', () => {
    it('gecerli istek cozulur', () => {
        const r = validateSendTransactionRequest(OK, CTX)
        expect(r.ok).toBe(true)
        expect(r.validUntil).toBe(NOW + 300)
        expect(r.messages).toEqual([
            { address: MSG.address, amountNano: '1000000000', payload: null, stateInit: null },
        ])
    })

    it('JSON METIN olarak da kabul edilir (kopruden string gelebilir)', () => {
        const r = validateSendTransactionRequest(JSON.stringify(OK), CTX)
        expect(r.ok).toBe(true)
    })

    it('valid_until GECMISSE kod 1', () => {
        const r = validateSendTransactionRequest({ ...OK, valid_until: NOW - 1 }, CTX)
        expect(r.ok).toBe(false)
        expect(r.code).toBe(1)
        expect(r.message).toBe('Request expired')
    })

    it('valid_until YOKSA kabul edilir (alan opsiyonel)', () => {
        const r = validateSendTransactionRequest({ messages: [MSG] }, CTX)
        expect(r.ok).toBe(true)
        expect(r.validUntil).toBe(null)
    })

    // features'ta maxMessages: 4 BILDIRIYORUZ. Bildirdigimiz sinir BAGLAYICI:
    // 5. mesaji sessizce dusurmek, kullanicinin gormedigi bir islem yayinlamak olurdu.
    it('MAX_MESSAGES ustu kod 1', () => {
        const cok = { ...OK, messages: Array(MAX_MESSAGES + 1).fill(MSG) }
        const r = validateSendTransactionRequest(cok, CTX)
        expect(r.ok).toBe(false)
        expect(r.code).toBe(1)
        expect(r.message).toBe('Too many messages')
    })

    it('tam MAX_MESSAGES kadar mesaj gecer', () => {
        const r = validateSendTransactionRequest({ ...OK, messages: Array(MAX_MESSAGES).fill(MSG) }, CTX)
        expect(r.ok).toBe(true)
        expect(r.messages.length).toBe(MAX_MESSAGES)
    })

    it('bos mesaj listesi kod 1', () => {
        expect(validateSendTransactionRequest({ ...OK, messages: [] }, CTX).code).toBe(1)
    })

    it('adres ya da amount eksikse kod 1', () => {
        const adresYok = validateSendTransactionRequest({ messages: [{ amount: '1' }] }, CTX)
        expect(adresYok.code).toBe(1)
        expect(adresYok.message).toBe('Message address is missing')
        const tutarYok = validateSendTransactionRequest({ messages: [{ address: MSG.address }] }, CTX)
        expect(tutarYok.code).toBe(1)
        expect(tutarYok.message).toBe(TUTAR_HATASI)
    })

    it('amount ondalikli/negatif/sayisal olmayan ise kod 1', () => {
        for (const kotu of ['1.5', '-5', 'abc', '', '0x10']) {
            const r = validateSendTransactionRequest({ messages: [{ ...MSG, amount: kotu }] }, CTX)
            expect(r.ok).toBe(false)
            expect(r.code).toBe(1)
            expect(r.message, kotu).toBe(TUTAR_HATASI)
        }
    })

    // ESKI davranis sayiyi metne ceviriyordu. rpc.md amount'u DIZE tanimlar;
    // JSON sayisi 2^53 ustunde sessizce yuvarlanir ve orijinali KURTARILAMAZ.
    it('amount SAYI olarak gelirse kod 1 (spec: ondalik dize)', () => {
        const r = validateSendTransactionRequest({ messages: [{ ...MSG, amount: 1000 }] }, CTX)
        expect(r.ok).toBe(false)
        expect(r.code).toBe(1)
        expect(r.message).toBe(TUTAR_HATASI)
    })

    it('amount sayi ama unsafe-integer araligi disinda ise kod 1', () => {
        const r = validateSendTransactionRequest({ messages: [{ ...MSG, amount: 9007199254740993 }] }, CTX)
        expect(r.ok).toBe(false)
        expect(r.code).toBe(1)
        expect(r.message).toBe(TUTAR_HATASI)
    })

    // --- amount: TON Coins (VarUInteger 16) araligi ---
    // Sinirin ustu onay ekranina geliyor, imzada (storeCoins) patliyordu.

    it('sinir kutuphaneyle ayni: storeCoins 2^120-1 yazar, 2^120 yazamaz', () => {
        expect(() => beginCell().storeCoins(COINS_SINIRI - 1n)).not.toThrow()
        expect(() => beginCell().storeCoins(COINS_SINIRI)).toThrow()
    })

    it('amount 2^120-1 gecer ve dize AYNEN saklanir', () => {
        const amount = (COINS_SINIRI - 1n).toString()
        const r = validateSendTransactionRequest({ ...OK, messages: [{ ...MSG, amount }] }, CTX)
        expect(r.ok).toBe(true)
        expect(r.messages[0].amountNano).toBe(amount)
    })

    it.each([
        ['2^120', COINS_SINIRI.toString()],
        ['basinda sifirli 2^120', '00' + COINS_SINIRI.toString()],
        ['100 haneli', '9'.repeat(100)],
    ])('amount %s ise kod 1, etiket TASIMAZ', (_ad, amount) => {
        const r = validateSendTransactionRequest({ ...OK, messages: [{ ...MSG, amount }] }, CTX)
        expect(r.ok).toBe(false)
        expect(r.code).toBe(1)
        expect(r.message).toBe(ARALIK_HATASI)
        expect(r.reason).toBeUndefined()
    })

    it('ikinci mesajin amount u sinir disindaysa da kod 1', () => {
        const r = validateSendTransactionRequest(
            { ...OK, messages: [MSG, { ...MSG, amount: COINS_SINIRI.toString() }] }, CTX)
        expect(r.code).toBe(1)
        expect(r.message).toBe(ARALIK_HATASI)
    })

    it('payload ve stateInit korunur', () => {
        const r = validateSendTransactionRequest({
            messages: [{ ...MSG, payload: BODY_BOC, stateInit: INIT_BOC }],
        }, CTX)
        expect(r.messages[0].payload).toBe(BODY_BOC)
        expect(r.messages[0].stateInit).toBe(INIT_BOC)
    })

    // Testnet dapp'ine mainnet adresi vermek, kullanicinin GERCEK parasini test
    // akisina sokar. Dapp bir ag SOYLEDIYSE ona uymak zorundayiz.
    it('istekteki network cuzdaninkiyle uyusmuyorsa kod 1', () => {
        const r = validateSendTransactionRequest({ ...OK, network: '-3' }, CTX)
        expect(r.ok).toBe(false)
        expect(r.code).toBe(1)
        expect(r.message).toBe('Requested network does not match the wallet network')
        // B2: cagiran uyari penceresini YALNIZ bu etiketle acar.
        expect(r.reason).toBe('network')
    })

    // Uyari yalniz ag uyusmazligina ait: baska bir kod 1 reddi etiket TASIMAZ.
    it.each([
        ['bozuk JSON', '{bozuk'],
        ['gecmis valid_until', { ...OK, valid_until: NOW - 1 }],
        ['raw mesaj adresi', { ...OK, messages: [{ ...MSG, address: RAW }] }],
        ['bos mesaj listesi', { ...OK, messages: [] }],
        ['items', { valid_until: NOW + 300, items: [{ type: 'ton', address: UQ, amount: '1' }] }],
    ])('%s reddi reason TASIMAZ', (_ad, girdi) => {
        const r = validateSendTransactionRequest(girdi, CTX)
        expect(r.ok).toBe(false)
        expect(r.reason).toBeUndefined()
    })

    it('istekte network YOKSA kabul edilir', () => {
        expect(validateSendTransactionRequest(OK, CTX).ok).toBe(true)
    })

    it('bozuk JSON metni kod 1', () => {
        expect(validateSendTransactionRequest('{bozuk', CTX).code).toBe(1)
    })

    // --- Mesaj adresi: YALNIZ friendly (rpc.md) ---

    it('raw mesaj adresi kod 1', () => {
        const r = validateSendTransactionRequest({ ...OK, messages: [{ ...MSG, address: RAW }] }, CTX)
        expect(r.ok).toBe(false)
        expect(r.code).toBe(1)
        expect(r.message).toBe(ADRES_HATASI)
    })

    it('CRC si bozuk ya da uzunlugu yanlis adres kod 1', () => {
        for (const kotu of [BAD_CRC, UQ.slice(0, 47), UQ + 'A']) {
            const r = validateSendTransactionRequest({ ...OK, messages: [{ ...MSG, address: kotu }] }, CTX)
            expect(r.code, kotu).toBe(1)
            expect(r.message, kotu).toBe(ADRES_HATASI)
        }
    })

    it('url-safe OLMAYAN (+ /) friendly adres kabul edilir, dize AYNEN saklanir', () => {
        const arti = 'UQAzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzM+lI'
        const bolu = 'EQB3ncyBUTjZUA5EnFKR5/EnOMI9V1tTEAAPaiU71gc4TiUt'
        const r = validateSendTransactionRequest({ ...OK, messages: [{ ...MSG, address: arti }, { ...MSG, address: bolu }] }, CTX)
        expect(r.ok).toBe(true)
        expect(r.messages.map((m) => m.address)).toEqual([arti, bolu])
    })

    it('bosluklu friendly adres kabul edilir ve KIRPILMIS saklanir', () => {
        const r = validateSendTransactionRequest({ ...OK, messages: [{ ...MSG, address: `  ${UQ}\n` }] }, CTX)
        expect(r.ok).toBe(true)
        expect(r.messages[0].address).toBe(UQ)
    })

    // Spec testOnly hakkinda sessiz; Test Runner testnette bile UQ yolluyor.
    it('testOnly bayragi iki yonde de REDDEDILMEZ', () => {
        const ana = validateSendTransactionRequest({ ...OK, messages: [{ ...MSG, address: KQ }, { ...MSG, address: ZQ }] }, CTX)
        expect(ana.ok).toBe(true)
        expect(ana.messages.map((m) => m.address)).toEqual([KQ, ZQ])
        const test = validateSendTransactionRequest(
            { ...OK, messages: [{ ...MSG, address: EQ }, { ...MSG, address: UQ }] },
            { ...CTX, walletNetwork: '-3' },
        )
        expect(test.ok).toBe(true)
        expect(test.messages.map((m) => m.address)).toEqual([EQ, UQ])
    })

    // --- messages / items: TAM OLARAK biri (rpc.md) ---

    it('messages ile items BIRLIKTE gelirse kod 1', () => {
        const r = validateSendTransactionRequest({ ...OK, items: [{ type: 'ton', address: UQ, amount: '1' }] }, CTX)
        expect(r.code).toBe(1)
        expect(r.message).toBe('messages and items are mutually exclusive')
        // null items YOK sayilir.
        expect(validateSendTransactionRequest({ ...OK, items: null }, CTX).ok).toBe(true)
    })

    // features'ta itemTypes BILDIRMIYORUZ.
    it('yalniz items gelirse kod 1: yapisal item desteklenmiyor', () => {
        const r = validateSendTransactionRequest({ valid_until: NOW + 300, items: [{ type: 'ton', address: UQ, amount: '1' }] }, CTX)
        expect(r.code).toBe(1)
        expect(r.message).toBe('Structured items are not supported')
    })

    // --- network: TAM dize esitligi (wallet-guidelines.md) ---

    it('network SAYI olarak gelirse kod 1, ayni DIZE gecer', () => {
        const r = validateSendTransactionRequest({ ...OK, network: -239 }, CTX)
        expect(r.code).toBe(1)
        expect(r.message).toBe('Requested network does not match the wallet network')
        expect(r.reason).toBe('network')
        expect(validateSendTransactionRequest({ ...OK, network: '-239' }, CTX).ok).toBe(true)
    })

    // --- valid_until: uint32 SANIYE ---

    it.each([
        ['DIZE', String(NOW + 300)],
        ['KESIRLI', NOW + 300.5],
        ['MILISANIYE', (NOW + 300) * 1000],
    ])('valid_until %s ise kod 1', (_, vu) => {
        const r = validateSendTransactionRequest({ ...OK, valid_until: vu }, CTX)
        expect(r.code).toBe(1)
        expect(r.message).toBe(VU_HATASI)
    })

    // Saat (nowSec) verilmese bile 0 ve negatif gecmez.
    it('valid_until 0 ya da negatif ise saatten BAGIMSIZ kod 1', () => {
        for (const vu of [0, -1]) {
            const r = validateSendTransactionRequest({ ...OK, valid_until: vu }, { walletNetwork: '-239' })
            expect(r.code, String(vu)).toBe(1)
            expect(r.message, String(vu)).toBe(VU_HATASI)
        }
    })

    it('valid_until uint32 sinirinda: 0xFFFFFFFF gecer, 0x100000000 kod 1', () => {
        expect(validateSendTransactionRequest({ ...OK, valid_until: 0xFFFFFFFF }, CTX).ok).toBe(true)
        expect(validateSendTransactionRequest({ ...OK, valid_until: 0x100000000 }, CTX).message).toBe(VU_HATASI)
    })

    // --- payload / stateInit: undefined/null YOK; gerisi tek kokli BOC ---

    it('iki koklu fikstur GERCEKTEN gecerli, iki koklu bir BOC', () => {
        expect(Cell.fromBoc(Buffer.from(MULTI_ROOT_BOC, 'base64')).length).toBe(2)
    })

    it('payload/stateInit null ya da undefined ise YOK sayilir', () => {
        const r = validateSendTransactionRequest({ messages: [{ ...MSG, payload: null, stateInit: undefined }] }, CTX)
        expect(r.ok).toBe(true)
        expect(r.messages[0]).toEqual({ address: UQ, amountNano: '1000000000', payload: null, stateInit: null })
    })

    it.each([
        ['SAYI', 123],
        ['NESNE', {}],
        ['true', true],
        ['BOS DIZE', ''],
        ['BOC olmayan base64', 'aGVsbG8='],
        ['IKI KOKLU BOC', MULTI_ROOT_BOC],
    ])('payload %s ise kod 1', (_, payload) => {
        const r = validateSendTransactionRequest({ ...OK, messages: [{ ...MSG, payload }] }, CTX)
        expect(r.code).toBe(1)
        expect(r.message).toBe(YUK_HATASI)
    })

    it.each([
        ['SAYI', 123],
        ['BOS DIZE', ''],
        ['BOC olmayan base64', 'aGVsbG8='],
        ['IKI KOKLU BOC', MULTI_ROOT_BOC],
        // loadStateInit bos hucreyi okuyamaz.
        ['StateInit olarak okunamayan hucre', boc(beginCell().endCell())],
        // loadStateInit GECER ama 27 bit artar: govde hucresi StateInit diye yollanmis.
        ['32 bitlik GOVDE hucresi', boc(beginCell().storeUint(0, 32).endCell())],
        // Bitler tukenir ama fazladan bir ref artar.
        ['fazladan ref tasiyan StateInit', boc(beginCell().store(INIT()).storeRef(beginCell().endCell()).endCell())],
    ])('stateInit %s ise kod 1', (_, stateInit) => {
        const r = validateSendTransactionRequest({ ...OK, messages: [{ ...MSG, stateInit }] }, CTX)
        expect(r.code).toBe(1)
        expect(r.message).toBe(INIT_HATASI)
    })

    // --- stateInit kutuphane sozlugu: YURUNMEZ, reddedilir ---

    it('kutuphaneli fikstur GERCEKTEN gecerli bir StateInit (tek kutuphane)', () => {
        const s = Cell.fromBase64(TEK_KUTUPHANELI_INIT()).beginParse()
        expect(loadStateInit(s).libraries.size).toBe(1)
        expect(s.remainingBits + s.remainingRefs).toBe(0)
    })

    it('stateInit kutuphane sozlugu tasiyorsa kod 1', () => {
        const r = validateSendTransactionRequest({ ...OK, messages: [{ ...MSG, stateInit: TEK_KUTUPHANELI_INIT() }] }, CTX)
        expect(r.code).toBe(1)
        expect(r.message).toBe('stateInit libraries are not supported')
    })

    // parseDict paylasilan alt agaci her yoldan YENIDEN gezer: 128 karakterlik
    // bu BOC eski kapida saniyeler surdu (servis calisani kilitlenir).
    it('paylasilan alt agacli derin kutuphane sozlugu HIZLA kod 1 alir', () => {
        const stateInit = DERIN_KUTUPHANELI_INIT(14)
        expect(stateInit.length).toBeLessThan(200)
        const t0 = performance.now()
        const r = validateSendTransactionRequest({ ...OK, messages: [{ ...MSG, stateInit }] }, CTX)
        expect(performance.now() - t0).toBeLessThan(100)
        expect(r.code).toBe(1)
        expect(r.message).toBe('stateInit libraries are not supported')
    })

    // Test Runner'in varsayilan istegi (tcwl demo/TxForm.tsx): gercek govde ve
    // standart base64 (+ /) StateInit. Kurallar onu REDDETMEMELI.
    it('Test Runner varsayilan istegi gecer, alanlar AYNEN saklanir', () => {
        const m = {
            address: 'EQCKWpx7cNMpvmcN5ObM5lLUZHZRFKqYA4xmw9jOry0ZsF9M',
            amount: '5000000',
            payload: boc(beginCell().storeUint(0, 32).storeStringTail('Hello!').endCell()),
            stateInit: 'te6cckEBBAEAOgACATQCAQAAART/APSkE/S88sgLAwBI0wHQ0wMBcbCRW+D6QDBwgBDIywVYzxYh+gLLagHPFsmAQPsAlxCarA==',
        }
        const r = validateSendTransactionRequest({ valid_until: NOW + 600, messages: [m] }, CTX)
        expect(r.ok).toBe(true)
        expect(r.messages[0]).toEqual({ address: m.address, amountNano: '5000000', payload: m.payload, stateInit: m.stateInit })
    })

    // --- ek para birimi: extraCurrencySupported:false bildiriyoruz ---

    it.each(['extra_currency', 'extraCurrency'])('%s DOLU ise kod 1', (alan) => {
        const r = validateSendTransactionRequest({ ...OK, messages: [{ ...MSG, [alan]: { '100': '1' } }] }, CTX)
        expect(r.code).toBe(1)
        expect(r.message).toBe('Extra currencies are not supported')
    })

    // Nesne olmayan ya da dizi olan deger de "dolu" sayilir: sessizce dusurmek
    // dapp'in istedigi DEGIL baska bir islemi imzalamak olurdu.
    it.each(['extra_currency', 'extraCurrency'].flatMap((alan) =>
        [5, true, 'x', [], [['100', '1']]].map((deger) => [alan, deger])),
    )('%s nesne degilse (%j) kod 1', (alan, deger) => {
        const r = validateSendTransactionRequest({ ...OK, messages: [{ ...MSG, [alan]: deger }] }, CTX)
        expect(r.code).toBe(1)
        expect(r.message).toBe('Extra currencies are not supported')
    })

    it('extra_currency BOS nesne ya da null ise kabul edilir', () => {
        for (const ec of [{}, null]) {
            expect(validateSendTransactionRequest({ ...OK, messages: [{ ...MSG, extra_currency: ec }] }, CTX).ok).toBe(true)
        }
    })
})

describe('parseTonConnectAddress', () => {
    it.each([
        [EQ, true, false],
        [UQ, false, false],
        [KQ, true, true],
        [ZQ, false, true],
    ])('%s bayraklari cozulur', (a, bounce, testOnly) => {
        const p = parseTonConnectAddress(a)
        expect(p.isBounceable).toBe(bounce)
        expect(p.isTestOnly).toBe(testOnly)
        expect(p.address.toRawString()).toBe(RAW)
    })

    it('bosluklu adres kirpilip cozulur', () => {
        expect(parseTonConnectAddress(`  ${EQ} `).address.toRawString()).toBe(RAW)
    })

    // parseFriendly gecersiz etikette Error DEGIL duz DIZE firlatir.
    it('etiketi gecersiz (CRC dogru) adres firlatmaz, null doner', () => {
        expect(parseTonConnectAddress('IgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI6Z')).toBe(null)
    })

    it.each([RAW, BAD_CRC, '', '   ', UQ.slice(0, 47), 123, null, undefined, {}])('gecersiz girdi %s -> null', (a) => {
        expect(parseTonConnectAddress(a)).toBe(null)
    })
})

describe('tonConnectBounce', () => {
    // rpc.md: bounce bayragi ADRESTEN okunur; testOnly yok sayilir.
    it('EQ/kQ true, UQ/0Q false', () => {
        expect(tonConnectBounce(EQ)).toBe(true)
        expect(tonConnectBounce(UQ)).toBe(false)
        expect(tonConnectBounce(KQ)).toBe(true)
        expect(tonConnectBounce(ZQ)).toBe(false)
    })

    it.each([RAW, BAD_CRC, ''])('gecersiz adres %s TON_ADDRESS_INVALID firlatir', (a) => {
        expect(() => tonConnectBounce(a)).toThrow('TON_ADDRESS_INVALID')
    })
})

describe('networkMismatch', () => {
    it('istekte ag YOKSA uyumsuzluk yok', () => {
        expect(networkMismatch(undefined, '-239')).toBe(false)
        expect(networkMismatch(null, '-239')).toBe(false)
    })

    it('ayni dize uyumlu', () => {
        expect(networkMismatch('-239', '-239')).toBe(false)
        expect(networkMismatch('-3', '-3')).toBe(false)
    })

    // wallet-guidelines.md: ag OPAK kimliktir, TAM dize esitligi aranir.
    it.each(['-3', -239, '', ' -239', {}])('%s cuzdanin -239 una uymaz', (istenen) => {
        expect(networkMismatch(istenen, '-239')).toBe(true)
    })

    // Istenen ag DIZE olmali; cuzdan kimligi sayi verilse bile sayi istek uyusmaz.
    it('istenen ag dize degilse cuzdan kimliginden BAGIMSIZ uyumsuz', () => {
        expect(networkMismatch(-239, -239)).toBe(true)
    })
})

// HICBIR SEY YAPMAYAN MESAJ.
//
// OLCULDU 2026-09-14, canli paymaster:
//   POST /paymaster/ton/quote {"kind":"raw","amountNano":"0","bounce":false}
//   -> 400 {"error":"actions[0] does nothing - amountNano is 0 and there is no payloadBoc"}
// Sunucu boyle bir eylemi FIYATLANDIRMIYOR, bu yuzden ATS teklifi istenmez.
// 0 TON tasiyan, govdesi olmayan bir mesaj hedefte hicbir sey yapmaz; cuzdan
// kullaniciyi UYARIR ama yine de imzalar (self-pay, yalniz ag ucreti).
//
// `stateInit` ISTISNA ve bilerek: 0 TON'la bile olsa alici adreste bir kontrat
// kurmak ANLAMLI bir niyettir. Sunucunun kurali stateInit'i anmaz cunku o zaten
// ham yolu tumden reddediyor (beyaz liste disina TON akitilabilirdi).
describe('isNoopMessage', () => {
    const m = (over) => ({ address: MSG.address, amountNano: '1000000000', payload: null, stateInit: null, ...over })

    it('0 TON + govde YOK + stateInit YOK -> hicbir sey yapmiyor', () => {
        expect(isNoopMessage(m({ amountNano: '0' }))).toBe(true)
    })

    it('0 TON ama GOVDE var -> is yapiyor (dapp islemlerinin yaygin sekli)', () => {
        expect(isNoopMessage(m({ amountNano: '0', payload: 'te6ccgEB' }))).toBe(false)
    })

    it('0 TON ama stateInit var -> kontrat kuruyor, is yapiyor', () => {
        expect(isNoopMessage(m({ amountNano: '0', stateInit: 'te6ccgAA' }))).toBe(false)
    })

    it('tutar TASIYAN duz transfer -> is yapiyor', () => {
        expect(isNoopMessage(m())).toBe(false)
    })

    // Normalize edilmis mesajda amountNano HEP dizedir (validateSendTransactionRequest
    // yalniz dize kabul ediyor). Yine de sayi 0 gelirse "0 degil" sayip gecirmek,
    // kapinin sessizce acilmasi olurdu.
    it('amountNano SAYI 0 olarak gelirse de yakalanir', () => {
        expect(isNoopMessage(m({ amountNano: 0 }))).toBe(true)
    })

    it('mesaj yoksa hicbir sey iddia edilmez', () => {
        expect(isNoopMessage(null)).toBe(false)
        expect(isNoopMessage(undefined)).toBe(false)
    })
})

// KULLANICININ KENDI TON'UNDAN CIKAN TUTAR.
//
// Backend cevabi (2026-09-14, backend-istek-...-c): `amountNano` HICBIR ZAMAN
// sponsorlanmaz -- her zaman kullanicinin KENDI bakiyesinden cikar; rolecinin
// ilistirdigi TON (`gasTonNano`) yalniz hedef kontratin gazini fonlar. Yani
// "role acik" demek "bedava" demek DEGILDIR ve bakiye kapisi role modunda da
// gereklidir.
describe('userSpentNano', () => {
    const m = (over) => ({ address: MSG.address, amountNano: '0', payload: null, stateInit: null, ...over })

    it('self-pay: butun tutarlar kullanicidan cikar', () => {
        expect(userSpentNano([m({ amountNano: '1000000000' }), m({ amountNano: '500' })]))
            .toBe(1000000500n)
    })

    // Role modunda yuklu mesaj `kind:'raw'` + `amountNano:'0'` + `gasTonNano`
    // olarak fiyatlanir (TonSendTx.vue:tonFeeActions): tutar rolecinin
    // ilistirdiginden gelir, kullanicidan DEGIL.
    it('role: YUKLU mesajin tutari kullanicidan CIKMAZ', () => {
        expect(userSpentNano([m({ amountNano: '900000000', payload: 'te6ccgEB' })], { relay: true }))
            .toBe(0n)
    })

    // Yuksuz mesaj role modunda da `kind:'raw'` + GERCEK `amountNano` ile gider.
    it('role: YUKSUZ mesajin tutari kullanicidan CIKAR', () => {
        expect(userSpentNano([m({ amountNano: '900000000' })], { relay: true }))
            .toBe(900000000n)
    })

    it('role: karisik istekte yalniz yuksuz olanlar toplanir', () => {
        expect(userSpentNano([
            m({ amountNano: '700000000', payload: 'te6ccgEB' }),
            m({ amountNano: '300000000' }),
        ], { relay: true })).toBe(300000000n)
    })

    // Self-pay'de yuk, tutarin kimden ciktigini DEGISTIRMEZ -- gonderen yine
    // kullanicinin cuzdanidir.
    it('self-pay: yuk tasiyan mesajin tutari da kullanicidan cikar', () => {
        expect(userSpentNano([m({ amountNano: '700000000', payload: 'te6ccgEB' })]))
            .toBe(700000000n)
    })

    // BigInt SART: nanoton degerleri double'in tam temsil ettigi araligi asabilir
    // (toplamNano'daki ayni gerekce).
    it('double araligini asan tutarlar TAM toplanir', () => {
        expect(userSpentNano([m({ amountNano: '9007199254740993' }), m({ amountNano: '1' })]))
            .toBe(9007199254740994n)
    })

    it('mesaj yoksa sifir', () => {
        expect(userSpentNano([])).toBe(0n)
        expect(userSpentNano(null)).toBe(0n)
    })
})
