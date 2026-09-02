// Al ekranindaki ag uyarisi ETIKETI icin ayri test dosyasi: useDisplayAddress.test.js
// saf ADRES secimine (pickDisplayAddress) ayrildi, bu dosya ayni modulun ikinci saf
// fonksiyonunu (pickNetworkWarningKey) kapsar. Konu farkli: yanlis ETIKET de yanlis
// ADRES kadar tehlikeli (kullanici karsi zincirden gonderir, varlik kalici kaybolur)
// ama secim mantigi ayri, karistirilmamali.
import { describe, it, expect } from 'vitest'
import { pickNetworkWarningKey, warningKeyForKind } from './useDisplayAddress'

describe('pickNetworkWarningKey', () => {
    it('EVM aginda "EVM uyumlu" anahtari secilir', () => {
        expect(pickNetworkWarningKey({ chainId: 1 })).toBe('warning_network_bold')
    })

    it('TON aginda "TON" anahtari secilir', () => {
        expect(pickNetworkWarningKey({ chainId: -239, kind: 'ton' })).toBe('warning_network_bold_ton')
    })

    it('zincir cozulemediginde EVM etiketine dusulur', () => {
        expect(pickNetworkWarningKey(null)).toBe('warning_network_bold')
    })
})

// Al ekrani artik iki adresi birden gosteriyor ve QR, kullanicinin DOKUNDUGU satiri
// izliyor. Etiket orada aktif aga baglanamaz: EVM agindayken TON satirina dokunan
// kullanici, TON adresinin altinda "EVM uyumlu aglardan gonderin" yazisini gorurdu.
// Bu, yukaridaki fonksiyonun var olma sebebi olan hatanin ta kendisi.
describe('warningKeyForKind — etiket SATIRI izler, aktif agi degil', () => {
    it('TON satiri icin "TON" anahtari doner', () => {
        expect(warningKeyForKind('ton')).toBe('warning_network_bold_ton')
    })

    it('EVM satiri icin "EVM uyumlu" anahtari doner', () => {
        expect(warningKeyForKind('evm')).toBe('warning_network_bold')
    })

    it('taninmayan tur EVM etiketine duser — chainKind ile ayni guvenli yon', () => {
        for (const kind of [null, undefined, '', 'TON', 'jetton']) {
            expect(warningKeyForKind(kind)).toBe('warning_network_bold')
        }
    })

    it('pickNetworkWarningKey ile AYNI sonucu verir — tek kaynak, iki giris', () => {
        expect(warningKeyForKind('ton')).toBe(pickNetworkWarningKey({ chainId: -239, kind: 'ton' }))
        expect(warningKeyForKind('evm')).toBe(pickNetworkWarningKey({ chainId: 1 }))
    })
})
