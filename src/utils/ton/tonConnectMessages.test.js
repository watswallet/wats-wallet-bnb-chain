import { describe, it, expect } from 'vitest'
import { validateSendTransactionRequest, tonNetworkId, MAX_MESSAGES, isNoopMessage, userSpentNano } from './tonConnectMessages'

const NOW = 1756000000
const MSG = { address: '0:1111111111111111111111111111111111111111111111111111111111111111', amount: '1000000000' }
const OK = { valid_until: NOW + 300, messages: [MSG] }
const CTX = { nowSec: NOW, walletNetwork: '-239' }

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
        expect(validateSendTransactionRequest({ messages: [{ amount: '1' }] }, CTX).code).toBe(1)
        expect(validateSendTransactionRequest({ messages: [{ address: MSG.address }] }, CTX).code).toBe(1)
    })

    it('amount ondalikli/negatif/sayisal olmayan ise kod 1', () => {
        for (const kotu of ['1.5', '-5', 'abc', '', '0x10']) {
            const r = validateSendTransactionRequest({ messages: [{ ...MSG, amount: kotu }] }, CTX)
            expect(r.ok).toBe(false)
            expect(r.code).toBe(1)
        }
    })

    it('amount sayi olarak gelirse metne cevrilir', () => {
        const r = validateSendTransactionRequest({ messages: [{ ...MSG, amount: 1000 }] }, CTX)
        expect(r.ok).toBe(true)
        expect(r.messages[0].amountNano).toBe('1000')
    })

    it('amount sayi ama unsafe-integer araligi disinda ise kod 1', () => {
        const r = validateSendTransactionRequest({ messages: [{ ...MSG, amount: 9007199254740993 }] }, CTX)
        expect(r.ok).toBe(false)
        expect(r.code).toBe(1)
    })

    it('payload ve stateInit korunur', () => {
        const r = validateSendTransactionRequest({
            messages: [{ ...MSG, payload: 'te6ccgEB', stateInit: 'te6ccgAA' }],
        }, CTX)
        expect(r.messages[0].payload).toBe('te6ccgEB')
        expect(r.messages[0].stateInit).toBe('te6ccgAA')
    })

    // Testnet dapp'ine mainnet adresi vermek, kullanicinin GERCEK parasini test
    // akisina sokar. Dapp bir ag SOYLEDIYSE ona uymak zorundayiz.
    it('istekteki network cuzdaninkiyle uyusmuyorsa kod 1', () => {
        const r = validateSendTransactionRequest({ ...OK, network: '-3' }, CTX)
        expect(r.ok).toBe(false)
        expect(r.code).toBe(1)
    })

    it('istekte network YOKSA kabul edilir', () => {
        expect(validateSendTransactionRequest(OK, CTX).ok).toBe(true)
    })

    it('bozuk JSON metni kod 1', () => {
        expect(validateSendTransactionRequest('{bozuk', CTX).code).toBe(1)
    })
})

// HICBIR SEY YAPMAYAN MESAJ.
//
// OLCULDU 2026-09-14, canli paymaster:
//   POST /paymaster/ton/quote {"kind":"raw","amountNano":"0","bounce":false}
//   -> 400 {"error":"actions[0] does nothing - amountNano is 0 and there is no payloadBoc"}
// Sunucu boyle bir eylemi FIYATLANDIRMIYOR. Cuzdan da IMZALAMAMALI: 0 TON tasiyan,
// govdesi olmayan bir mesaj hedefte hicbir sey yapmaz, yalnizca kullaniciya ag
// ucreti odetir.
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
    // String'e ceviriyor). Yine de sayi 0 gelirse "0 degil" sayip gecirmek,
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
