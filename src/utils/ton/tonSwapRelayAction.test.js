import { describe, it, expect } from 'vitest'
import { Address, beginCell } from '@ton/core'
import { swapRelayAction, TonSwapRelayError, MAX_PAYLOAD_BYTES } from './tonSwapRelayAction'

// GERCEK adresler (beyaz listeden bir router, gercek bir W5 cuzdani ve gercek bir
// jetton master). Uydurma adres kullanmak, `Address.parse` hatasini gercek bir
// bulguymus gibi gostermeye acik.
const ROUTER = '0:13bcefc15df905a1c397865bded351197ec8b2163a15fb493d08b9a9830b7356'
const JETTON_CUZDANIM = 'EQDWTpfN3Bw5DC_yENjpItwdG1d9BqhvsScTpxTquIF5XnCq'
const MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
const BENIM = 'EQD4joKxbphnt0bFfsaCb-KyJaydnMiLTTltGfrQB0mjzgJ2'
const PTON = '0:11b3ca02794071e6c59f6b32fa819cd314003df9182789cb06847040f2d0cb21'

const AMOUNT = 250000000n
const FORWARD = 240000000n

// STON.fi SDK'sinin createJettonTransferMessage'i ile BIREBIR ayni sira ve ayni
// kodlama (node_modules/@ston-fi/sdk .../chunk-7OWKQS2D.js): forward_payload
// `bit 1 + ref` olarak yazilir, satir ici DEGIL.
const SWAP_YUKU = beginCell().storeUint(0x25938561, 32).storeCoins(1n).endCell()

const jettonGovde = ({
    amount = AMOUNT, destination = ROUTER, responseDestination = BENIM,
    customPayload = null, forwardTon = FORWARD, forwardPayload = SWAP_YUKU,
} = {}) => beginCell()
    .storeUint(0x0f8a7ea5, 32)
    .storeUint(0, 64)
    .storeCoins(amount)
    .storeAddress(Address.parse(destination))
    .storeAddress(Address.parse(responseDestination))
    .storeMaybeRef(customPayload)
    .storeCoins(forwardTon)
    .storeMaybeRef(forwardPayload)
    .endCell()

const jettonParams = (over = {}) => ({
    to: JETTON_CUZDANIM, value: 50000001n, body: jettonGovde(over),
})

const kod = (fn) => {
    try { fn(); return null } catch (e) { return e.code ?? e.message }
}

const rawStr = (a) => Address.parse(a).toRawString()

describe('jetton -> * (j2j / j2t): TEP-74 govdesinden eylem cikarilir', () => {
    it('takas eylemi kurar - router govdedeki destination, jettonWallet DIS hedef', () => {
        const a = swapRelayAction({
            direction: 'j2j', params: jettonParams(), offerJettonMaster: MASTER, offerUnits: AMOUNT,
        })
        expect(a).toEqual({
            kind: 'jetton',
            jettonMaster: MASTER,
            // ROUTER govdenin ICINDEN gelir. Dis hedefi router sanmak, takasi
            // kullanicinin kendi jetton cuzdanina gondermek olurdu.
            to: rawStr(ROUTER),
            amount: String(AMOUNT),
            jettonWallet: rawStr(JETTON_CUZDANIM),
            forwardTonNano: String(FORWARD),
            forwardPayloadBoc: SWAP_YUKU.toBoc().toString('base64'),
        })
    })

    it('j2t de AYNI yoldan gecer (fark yalniz DEX yuku)', () => {
        const a = swapRelayAction({
            direction: 'j2t', params: jettonParams(), offerJettonMaster: MASTER, offerUnits: AMOUNT,
        })
        expect(a.kind).toBe('jetton')
        expect(a.to).toBe(rawStr(ROUTER))
    })

    // ADRESLER KANONIK RAW: sunucunun beyaz listesi bu bicimde. Friendly yazimla
    // gondermek "listede var ama eslesmiyor" sinifinda sessiz bir redde yol acardi.
    it('adresler kanonik raw bicimde (0:<hex>)', () => {
        const a = swapRelayAction({
            direction: 'j2j', params: jettonParams(), offerJettonMaster: MASTER, offerUnits: AMOUNT,
        })
        expect(a.to.startsWith('0:')).toBe(true)
        expect(a.jettonWallet.startsWith('0:')).toBe(true)
    })

    // TAKASIN TANIMI forward_payload'dir. Yoksa bu duz bir transferdir ve role
    // eylemi uretmek onu takas gibi gostermek olurdu.
    it('forward_payload YOKSA firlatir', () => {
        expect(kod(() => swapRelayAction({
            direction: 'j2j', params: jettonParams({ forwardPayload: null }),
            offerJettonMaster: MASTER, offerUnits: AMOUNT,
        }))).toBe('TON_SWAP_RELAY_NO_FORWARD_PAYLOAD')
    })

    // Forward payi DEX'in gazidir; sifirda router cagriyi HIC islemez -- islem
    // zincirde sessizce duser ve ucret ALINMISTIR.
    it('forward tutari SIFIRSA firlatir', () => {
        expect(kod(() => swapRelayAction({
            direction: 'j2j', params: jettonParams({ forwardTon: 0n }),
            offerJettonMaster: MASTER, offerUnits: AMOUNT,
        }))).toBe('TON_SWAP_RELAY_NO_FORWARD_TON')
    })

    // SDK bizim istedigimizden BASKA bir tutar gonderiyorsa ekranda gorulen
    // miktar ile zincire giden ayrisir - ve bakiye kapilari ekrandakine gore
    // kurulmustu.
    it('SDK tutari istenenden FARKLIYSA firlatir', () => {
        expect(kod(() => swapRelayAction({
            direction: 'j2j', params: jettonParams(), offerJettonMaster: MASTER, offerUnits: AMOUNT + 1n,
        }))).toBe('TON_SWAP_RELAY_AMOUNT_MISMATCH')
    })

    // Anlamadigimiz bir govde sessizce gecemez: custom_payload cozmedigimiz bir
    // talimattir ve okuyucu orada duser.
    it('COZULEMEYEN govde firlatir', () => {
        const params = { ...jettonParams(), body: beginCell().storeUint(0xdeadbeef, 32).endCell() }
        expect(kod(() => swapRelayAction({
            direction: 'j2j', params, offerJettonMaster: MASTER, offerUnits: AMOUNT,
        }))).toBe('TON_SWAP_RELAY_BODY_UNREADABLE')
    })

    it('custom_payload tasiyan govde firlatir', () => {
        const params = jettonParams({ customPayload: beginCell().storeUint(1, 8).endCell() })
        expect(kod(() => swapRelayAction({
            direction: 'j2j', params, offerJettonMaster: MASTER, offerUnits: AMOUNT,
        }))).toBe('TON_SWAP_RELAY_BODY_UNREADABLE')
    })

    // Sunucu siniri (limits.maxPayloadBytes). Burada dusmek, kullaniciya ONCE
    // ucret gosterip SONRA reddetmeyi onler.
    it('yuk sunucu sinirini ASIYORSA firlatir', () => {
        const kocaman = beginCell().storeBuffer(Buffer.alloc(100)).endCell()
        expect(kod(() => swapRelayAction({
            direction: 'j2j', params: jettonParams({ forwardPayload: kocaman }),
            offerJettonMaster: MASTER, offerUnits: AMOUNT, maxPayloadBytes: 10,
        }))).toBe('TON_SWAP_RELAY_PAYLOAD_TOO_LARGE')
    })

    // STANDART base64: base64url ('-', '_') ya da kirpilmis padding sunucuda
    // dusurulur (sozlesme ss04).
    it('yuk STANDART base64 (base64url degil)', () => {
        const a = swapRelayAction({
            direction: 'j2j', params: jettonParams(), offerJettonMaster: MASTER, offerUnits: AMOUNT,
        })
        expect(a.forwardPayloadBoc).not.toMatch(/[-_]/)
        expect(Buffer.from(a.forwardPayloadBoc, 'base64').length).toBeGreaterThan(0)
    })
})

describe('TON -> jetton (t2j): HAM mesaj', () => {
    const OFFER = 1000000000n
    const GAZ = 215000000n
    const t2jParams = (over = {}) => ({
        to: PTON, value: OFFER + GAZ, body: SWAP_YUKU, ...over,
    })

    it('ham eylem kurar - gaz payi SDK degerinden TURER', () => {
        const a = swapRelayAction({ direction: 't2j', params: t2jParams(), offerUnits: OFFER })
        expect(a).toEqual({
            kind: 'raw',
            to: rawStr(PTON),
            // Kullanicinin CEBINDEN cikar: sponsorlanan sey GAZ, takasa GIREN
            // TON degil.
            amountNano: String(OFFER),
            payloadBoc: SWAP_YUKU.toBoc().toString('base64'),
            gasTonNano: String(GAZ),
            bounce: true,
        })
    })

    // Deger gonderilenden BUYUK degilse SDK bizim bekledigimizden baska bir sey
    // kurmus demektir; gazsiz giden bir DEX cagrisi zincirde SESSIZCE duser.
    it('gaz payi cikmiyorsa firlatir', () => {
        expect(kod(() => swapRelayAction({
            direction: 't2j', params: t2jParams({ value: OFFER }), offerUnits: OFFER,
        }))).toBe('TON_SWAP_RELAY_GAS_UNRESOLVED')
    })

    it('bounce HER ZAMAN true (dusen cagride TON geri donsun)', () => {
        const a = swapRelayAction({ direction: 't2j', params: t2jParams(), offerUnits: OFFER })
        expect(a.bounce).toBe(true)
    })
})

describe('genel kapilar', () => {
    it('govde YOKSA firlatir', () => {
        expect(kod(() => swapRelayAction({ direction: 'j2j', params: { to: JETTON_CUZDANIM }, offerUnits: 1n })))
            .toBe('TON_SWAP_RELAY_NO_BODY')
    })

    // TANIMADIGIMIZ YON duz bir dala DUSURULMEZ: yeni bir yon eklendiginde
    // varsayilan cevap FIRLATMAK olmali, sessizce yanlis sekli uretmek degil.
    it('bilinmeyen yon firlatir', () => {
        expect(kod(() => swapRelayAction({
            direction: 'x2y', params: jettonParams(), offerJettonMaster: MASTER, offerUnits: AMOUNT,
        }))).toBe('TON_SWAP_RELAY_UNKNOWN_DIRECTION')
    })

    it('hata turu kod tasir', () => {
        let err
        try {
            swapRelayAction({ direction: 'j2j', params: { to: JETTON_CUZDANIM }, offerUnits: 1n })
        } catch (e) { err = e }
        expect(err).toBeInstanceOf(TonSwapRelayError)
        expect(err.code).toBe('TON_SWAP_RELAY_NO_BODY')
    })

    it('varsayilan yuk siniri sunucunun beyan ettigi deger', () => {
        expect(MAX_PAYLOAD_BYTES).toBe(1024)
    })
})
