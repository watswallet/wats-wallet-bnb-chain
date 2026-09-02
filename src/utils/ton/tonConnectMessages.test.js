import { describe, it, expect } from 'vitest'
import { validateSendTransactionRequest, tonNetworkId, MAX_MESSAGES } from './tonConnectMessages'

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
