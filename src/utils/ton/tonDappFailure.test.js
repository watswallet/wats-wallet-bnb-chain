// TonConnect dapp yanitinin hata siniflandirmasi (B1). Saf katman: hangi
// hatanin dapp'e HEMEN (kod 0/1) donecegini, hangisinin yeniden denemeye acik
// kalacagini (dapp'e yanit YOK) soyler.
import { describe, it, expect } from 'vitest'
import { TON_DAPP_DOGRULAMA, tonBroadcastRefused, tonDappSendFailure, tonDappSignFailure } from './tonDappFailure'

const DOGRULAMA = [
    ['TON_DAPP_REQUEST_EXPIRED', 'Request expired'],
    ['TON_DAPP_VALID_UNTIL_INVALID', 'valid_until must be a uint32 unix time in seconds'],
    ['TON_DAPP_FROM_MISMATCH', 'Requested from address does not match the connected account'],
    ['TON_ADDRESS_INVALID', 'Message address must be a valid user-friendly address'],
]

describe('tonDappSendFailure', () => {
    it.each(DOGRULAMA)('%s imzadan ONCE: kod 1, terminal', (kod, mesaj) => {
        expect(tonDappSendFailure(kod, { sent: false })).toEqual({ terminal: true, code: 1, message: mesaj })
    })

    // Gonderim sinirindan SONRA hicbir hata 1 olamaz: islem zincire gitmis olabilir.
    it.each(DOGRULAMA)('%s gonderimden SONRA: kod 0', (kod) => {
        const s = tonDappSendFailure(kod, { sent: true })
        expect(s.terminal).toBe(true)
        expect(s.code).toBe(0)
    })

    it('gonderimden sonraki genel hata kod 0, durust mesaj', () => {
        expect(tonDappSendFailure('TON_SEND_FAILED', { sent: true })).toEqual({
            terminal: true,
            code: 0,
            message: 'Sending failed after signing; the transaction may still be processed',
        })
    })

    it('RELAY_NO_BOC: kod 0 ve BoC un olmadigini soyler', () => {
        expect(tonDappSendFailure('TON_DAPP_RELAY_NO_BOC', { sent: true })).toEqual({
            terminal: true,
            code: 0,
            message: 'Transaction was sent but its BoC is unavailable',
        })
    })

    // Relay ancak /relay dondukten sonra BoC'suz kalabilir: bayrak eksik olsa
    // bile (cagiran onSubmit'i baglamadi) bu kod ASLA yeniden denenebilir sayilmaz.
    it('RELAY_NO_BOC sent bayragi olmadan da terminal kod 0', () => {
        expect(tonDappSendFailure('TON_DAPP_RELAY_NO_BOC', { sent: false })).toMatchObject({ terminal: true, code: 0 })
    })

    it.each(['TON_TX_ALREADY_PENDING', 'TON_SEND_FAILED', 'TON_QUOTE_VERIFY_FAILED', 'TON_RELAY_UNAVAILABLE', 'Wallet locked. Please enter your password.', undefined])(
        '%s imzadan once: yeniden denenebilir, dapp e yanit YOK', (kod) => {
            expect(tonDappSendFailure(kod, { sent: false })).toEqual({ terminal: false, code: null, message: null })
        })

    it('ikinci arguman yoksa gonderilmemis sayilir (firlatmaz)', () => {
        expect(tonDappSendFailure('TON_TX_ALREADY_PENDING')).toEqual({ terminal: false, code: null, message: null })
    })

    it('dogrulama kumesi tam olarak dort kod', () => {
        expect([...TON_DAPP_DOGRULAMA].sort()).toEqual(DOGRULAMA.map(([k]) => k).sort())
    })
})

// sendBoc hatasinin sekli axios'un (TonClient -> HttpApi): durum kodlu yanit
// `response.status` tasir, yanitsiz hata (ag, zaman asimi) tasimaz.
describe('tonBroadcastRefused', () => {
    const httpHatasi = (status) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } })

    // Proxy istegi kendi katmaninda durdurdu (oran limiti, beyaz liste, govde
    // siniri); ust akis hatalarini 502'ye cevirdigi icin 4xx toncenter'dan gelemez.
    it.each([400, 403, 413, 429, 499])('HTTP %i: reddedildi, yayin YOK', (status) => {
        expect(tonBroadcastRefused(httpHatasi(status))).toBe(true)
    })

    // Istek iletilmis olabilir: belirsiz kalir.
    it.each([500, 502, 503, 504])('HTTP %i: belirsiz', (status) => {
        expect(tonBroadcastRefused(httpHatasi(status))).toBe(false)
    })

    it.each([
        ['yanitsiz ag hatasi', Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' })],
        ['zaman asimi', Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' })],
        ['2xx govdesinde ok:false (HttpApi)', new Error('Received error: {"ok":false}')],
        ['sayi olmayan durum', { response: { status: '429' } }],
        ['null', null],
        ['undefined', undefined],
    ])('%s: belirsiz', (_ad, hata) => {
        expect(tonBroadcastRefused(hata)).toBe(false)
    })
})

describe('tonDappSignFailure', () => {
    it('from uyusmazligi kod 1', () => {
        expect(tonDappSignFailure(new Error('TON_DAPP_FROM_MISMATCH'))).toEqual({
            code: 1,
            message: 'Requested from address does not match the connected account',
        })
    })

    // signData kurucusunun her hatasi BAD_REQUEST (tonSignDataSchemes.js); mesaj
    // kurucunun kendi metni.
    it('kurucu hatasi (tonConnectCode 1) kod 1, kendi mesajiyla', () => {
        const e = Object.assign(new Error('Unsupported payload type'), { tonConnectCode: 1 })
        expect(tonDappSignFailure(e)).toEqual({ code: 1, message: 'Unsupported payload type' })
    })

    it.each([
        new Error('Wallet locked. Please enter your password.'),
        new Error('TON_VAULT_NOT_FOUND'),
        new TypeError('x is undefined'),
        null,
        undefined,
    ])('diger her sey kod 0 (%s)', (e) => {
        expect(tonDappSignFailure(e)).toEqual({ code: 0, message: 'The wallet could not sign the request' })
    })
})
