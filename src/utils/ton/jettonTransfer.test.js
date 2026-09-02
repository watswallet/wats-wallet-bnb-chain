import { describe, it, expect } from 'vitest'
import { buildJettonTransferBody, JETTON_TRANSFER_OP } from './jettonTransfer'

// ALTIN VEKTORLER: Gorev 2'de ZINCIRDEN okunmus gercek jetton transferleri
// (docs/superpowers/notes/2026-08-24-tep74-dogrulama.md, GV1 ve GV2).
// Her biri gercek bir islemin govdesidir; uydurulmadi.
//
// Not defterinde 4 vektor vardi (2x transfer + 2x transfer_notification); burada
// SADECE transfer#0x0f8a7ea5 olan ikisi (GV1, GV2) kullanildi. GV3/GV4
// transfer_notification#0x7362d09c mesajidir - bu fonksiyon o mesaji uretmez,
// bu yuzden BILEREK atlandi (bkz. task-9-report.md).
//
// Jetton master (her iki vektorde de ayni, USDT-TON): EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs
// Ondalik notta dogrulanmamisti (kapsam disi); burada USDT-TON'un bilinen 6
// ondaligi kullanildi - raw elementer birim (amount * 10**decimals) her iki
// vektorde de notta okunan tam sayiyla (41487400 / 10638297) birebir eslesiyor,
// yani decimals=6 varsayimi BOC'u dogru urettigi icin dogrulanmis sayilir.
const VECTORS = [
    {
        girdi: {
            amount: 41.4874,
            decimals: 6,
            destination: 'EQCGkOk-Ewt6HvkVXtoXufBs6TAlBncVTjmGxU5tg-tjvTFi',
            responseDestination: 'EQAA1b2x9OEwYqUMknXpbpdurv7nGZqlNMbvYVOGLDmCClzV',
            forwardTon: 0.000000001,
            comment: 'AB3686F9521CA94F55E5',
            queryId: 0n,
        },
        boc: 'b5ee9c724101020100720001aa0f8a7ea50000000000000000402790c288010d21d27c2616f43df22abdb42f73e0d9d2604a0cee2a9c730d8a9cdb07d6c77b0000356f6c7d384c18a943249d7a5ba5dbabbfb9c666a94d31bbd854e18b0e60828203010030000000004142333638364639353231434139344635354535a89d068e',
    },
    {
        girdi: {
            amount: 10.638297,
            decimals: 6,
            destination: 'EQBTfhw1OxMmdsSltgyc0PEvwwdc5pUJMuSKD-YIr-bKhQqI',
            responseDestination: 'EQCNYiLvXlK0gz57n4Lcqimw6G6WLdaypN19ud1pP0Lj7Q-I',
            forwardTon: 0.000000001,
            queryId: 0n,
        },
        boc: 'b5ee9c724101010100560000a80f8a7ea500000000000000003a253d9800a6fc386a76264ced894b6c1939a1e25f860eb9cd2a1265c9141fcc115fcd950b00235888bbd794ad20cf9ee7e0b72a8a6c3a1ba58b75aca9375f6e775a4fd0b8fb42022597a2c4',
    },
]

describe('buildJettonTransferBody — altin vektorler', () => {
    it.each(VECTORS)('vektor $# zincirdeki govdeyle birebir eslesir', ({ girdi, boc }) => {
        expect(buildJettonTransferBody(girdi).toBoc().toString('hex')).toBe(boc)
    })
})

// Govdeden VarUInteger amount alanini geri okur (opcode + query_id'den sonraki alan) -
// DUZELTME TURU 1 testlerinde dize-tabanli donusumun uretttigi ham degeri dogrudan
// dogrulamak icin.
function readAmount(cell) {
    const s = cell.beginParse()
    s.loadUint(32)
    s.loadUintBig(64)
    return s.loadCoins()
}

describe('buildJettonTransferBody — kapilar', () => {
    const BASE = {
        amount: 1.5, decimals: 6,
        destination: 'UQDHMWKzTPGWZyEK8xgNb8-4jfFnjLu-cx84ZCU0zGlR5N8r',
        responseDestination: 'UQDHMWKzTPGWZyEK8xgNb8-4jfFnjLu-cx84ZCU0zGlR5N8r',
        forwardTon: 0.000000001,
        queryId: 0n,
    }

    it('opcode TEP-74 ile ayni', () => {
        expect(buildJettonTransferBody(BASE).beginParse().loadUint(32)).toBe(JETTON_TRANSFER_OP)
    })

    // forward_ton_amount SIFIR OLURSA bildirim mesaji hic olusmaz, dolayisiyla icindeki
    // yorum/memo da TESLIM EDILMEZ. Borsalar yatirimi memo ile eslestirir: memo
    // gitmezse para borsada KAYIP sayilir. TON'un en bilinen destek kabusu.
    it('forwardTon sifir ise HATA firlatir', () => {
        expect(() => buildJettonTransferBody({ ...BASE, forwardTon: 0 })).toThrow('JETTON_FORWARD_TON_ZERO')
    })

    it('yorum varken forwardTon sifir ise HATA firlatir', () => {
        expect(() => buildJettonTransferBody({ ...BASE, forwardTon: 0, comment: 'memo123' })).toThrow('JETTON_FORWARD_TON_ZERO')
    })

    it('ondalik verilmezse HATA firlatir - 9 varsaymaz', () => {
        expect(() => buildJettonTransferBody({ ...BASE, decimals: undefined })).toThrow('JETTON_DECIMALS_MISSING')
    })

    // DUZELTME TURU 1 (kucuk bulgu): decimals yalniz "tam sayi mi" diye degil,
    // MAKUL ARALIKTA mi diye de kontrol edilir. Negatif bir ondalik anlamsizdir
    // (10**-1 basamak kaydirmasi kirik bir govde uretir); asiri buyuk bir ondalik
    // (or. 100) hicbir bilinen jettonda yok, bozuk/kotu niyetli girdiye isaret eder.
    it('negatif ondalik HATA firlatir', () => {
        expect(() => buildJettonTransferBody({ ...BASE, decimals: -1 })).toThrow('JETTON_DECIMALS_INVALID')
    })

    it('anlamsiz buyuk ondalik HATA firlatir', () => {
        expect(() => buildJettonTransferBody({ ...BASE, decimals: 100 })).toThrow('JETTON_DECIMALS_INVALID')
    })

    it('6 ve 9 ondalik AYNI miktarda FARKLI govde uretir', () => {
        const a = buildJettonTransferBody({ ...BASE, decimals: 6 }).toBoc().toString('hex')
        const b = buildJettonTransferBody({ ...BASE, decimals: 9 }).toBoc().toString('hex')
        expect(a).not.toBe(b)
    })

    // DUZELTME TURU 1 (B1, KRITIK): incelemede bagimsiz dogrulandi - eski kod
    // `BigInt(Math.round(numeric * 10 ** decimals))` kayan nokta carpimi kullaniyordu.
    // 2.675 ikili tabanda TAM temsil edilemez (gercekte 2.67499999999999982236...
    // olarak saklanir), bu yuzden 2.675 * 100 = 267.49999999999997 cikiyor ve
    // Math.round bunu 267 DEGIL 268'e yuvarliyordu - kullanicinin yazdigindan 1
    // birim FAZLASI SESSIZCE gonderilirdi. Golden vektor testlerinin (41.4874,
    // 10.638297) gecmesi bu satirin guvenli oldugunu KANITLAMIYORDU - o degerler
    // bu hatayi TESADUFEN tetiklemiyordu. Duzeltme: donusum artik dize tabanli ve
    // ondaliktan fazla basamak SESSIZCE YUVARLANMAZ, REDDEDILIR.
    it('ondaliktan fazla basamak tasiyan miktar REDDEDILIR - sessizce yuvarlanmaz (eski kod 268 uretiyordu)', () => {
        expect(() => buildJettonTransferBody({ ...BASE, amount: 2.675, decimals: 2 })).toThrow('JETTON_AMOUNT_PRECISION')
    })

    it('tam basamakli bir miktar sorunsuz gecer ve ham deger BIREBIR dogru', () => {
        const cell = buildJettonTransferBody({ ...BASE, amount: 2.67, decimals: 2 })
        expect(readAmount(cell)).toBe(267n)
    })

    // Ustel gosterim (String(0.000000001) === '1e-9') duz-ondalik ayristirmadan
    // KACAR - once duz dizgeye acilmasi gerekir (clampToDecimals ile ayni teknik,
    // client/src/utils/swapValidation.js). Acilmazsa gecerli kucuk bir miktar
    // yanlislikla JETTON_AMOUNT_INVALID ile reddedilirdi.
    it('ustel gosterimli kucuk miktar dogru cevrilir - ham deger BIREBIR 1', () => {
        const cell = buildJettonTransferBody({ ...BASE, amount: 0.000000001, decimals: 9 })
        expect(readAmount(cell)).toBe(1n)
    })

    // tonSend.js'te ayni sinif hata vardi: `amount > 0` yukarida GECER ama ondaliga
    // cevrilirken 0'a duserse zincirde GERCEK bir sifir-degerli islem kurulur -
    // gaz yanar, aliciya hicbir sey gitmez, ve hic hata firlamadigi icin gonderim
    // "basarili" gorunur.
    //
    // DUZELTME TURU 1: bu senaryo (0.0000001, decimals=6) eskiden dogrudan bu
    // gate'i (donusum-sonrasi sifir, JETTON_AMOUNT_INVALID) tetikliyordu. Dize
    // tabanli donusumde artik DAHA ERKEN ve DAHA DOGRU bir sebeple yakalaniyor:
    // 0.0000001'in 7. ondalik basamagi decimals=6'yi asiyor, yani bu aslinda bir
    // hassasiyet ihlali (JETTON_AMOUNT_PRECISION) - "sessizce sifira dusme" DEGIL.
    // Ayni parasal riski (miktarin sessizce degismesi) daha once, daha doğru
    // sebeple engelliyor.
    it('ondaliktan fazla basamak tasiyan kucuk miktar reddedilir (eskiden sessizce sifira duserdi)', () => {
        expect(() => buildJettonTransferBody({ ...BASE, amount: 0.0000001, decimals: 6 })).toThrow('JETTON_AMOUNT_PRECISION')
    })

    // Donusum-sonrasi sifir kapisi (#3) BASKA BIR senaryoda hala BAGIMSIZ olarak
    // calisiyor: ustel acilimin bile (18 basamaga kadar) yakalayamayacagi kadar
    // asiri kucuk bir miktar, hicbir ANLAMLI basamak tasimadigi icin PRECISION
    // kapisini tetiklemez, ama donusum sonucu ham deger GERCEKTEN sifirdir. Bu
    // test, o backstop'un dize-tabanli donusumden SONRA da ayakta oldugunu kanitlar.
    it('ustel acilimin bile yakalayamadigi asiri kucuk miktar donusum-sonrasi sifir olarak reddedilir', () => {
        expect(() => buildJettonTransferBody({ ...BASE, amount: 1e-25, decimals: 6 })).toThrow('JETTON_AMOUNT_INVALID')
    })

    it('responseDestination ZORUNLU - artan TON iadesi icin', () => {
        expect(() => buildJettonTransferBody({ ...BASE, responseDestination: undefined })).toThrow('JETTON_RESPONSE_DESTINATION_MISSING')
    })
})
