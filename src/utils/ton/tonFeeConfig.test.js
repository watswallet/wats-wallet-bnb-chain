import { describe, it, expect } from 'vitest'
import { Cell } from '@ton/core'
import { ATS_COLLECTOR, getAtsSourceConfig } from '../atsConfig'
import { TON_FEE_DOMAIN, TON_FEE_AUTH_TYPES, assertTonFeeDomain, tonFeePaymasterBase } from './tonFeeConfig'
import GOLDEN from './__fixtures__/tonQuote.golden.json'

// Bu fixture 2026-08-29'da bundler.watswallet.com/paymaster/ton/quote'tan CANLI
// olcumdur (spec 2.3). Tek degisiklik: gercek `payer` (kullanicinin kisisel BSC
// adresi) `0x00000000000000000000000000000000000000A1` ile degistirildi, quoteId'nin
// base64 govdesinde. Bu yuzden quoteId'nin HMAC parcasi artik govdeyle uyusmuyor —
// SORUN DEGIL, istemci HMAC dogrulamaz, yalniz govdeyi cozup muhurlu degerleri
// (tonWallet, tonPublicKey, payer, seqno, actionHash, atsFee, attachNanoton,
// payloadBoc, needsInit, deadline, exp) capraz kontrol eder. payloadBoc ve
// actionHash degismedi: payer o ikisine hic girmiyor, asagidaki testler bunu kilitler.
describe('altin vektor bozulmamis', () => {
    // Fixture bozulursa DIGER her test yanlis bir zemin uzerinde yesil olur.
    it('payloadBoc hash i sign.tonPayloadHash e ve feeAuth.actionHash e ESIT', () => {
        const h = '0x' + Cell.fromBase64(GOLDEN.payloadBoc).hash().toString('hex')
        expect(h).toBe(GOLDEN.sign.tonPayloadHash)
        expect(h).toBe(GOLDEN.sign.feeAuth.actionHash)
    })

    // 0x73696e74 = auth_signed_internal. 'external' ile hesaplanan hash BASKA olurdu.
    it('opcode internal auth', () => {
        const s = Cell.fromBase64(GOLDEN.payloadBoc).beginParse()
        expect(s.loadUint(32)).toBe(0x73696e74)
    })

    // ALTIN VEKTOR BIR TRANSKRIPSIYONDUR, bir kurgu degil. Fazladan bir alan
    // eklemek, sonraki bir gorevin `quote.tonWallet` yazip testlerde YESIL,
    // gercek sunucuda KIRMIZI olmasina yol acar - ve bu ancak uretimde,
    // kullanicinin parasini tasiyan yolda gorunur.
    it('ust seviye alan kumesi olculen yanitla AYNI', () => {
        expect(Object.keys(GOLDEN).sort()).toEqual([
            'atsFee', 'atsFeeFormatted', 'attachNanoton',
            'payloadBoc', 'quoteId', 'sign', 'validUntil',
        ].sort())
    })

    // quoteId sanitize edildikten sonra da hala <base64(govde)>.<hmac> bicimini
    // ve sanitize edilmis payer'i tasimali; istemci HMAC'i degil govdeyi okur.
    it('quoteId govdesi cozulur ve sanitize edilmis payer i tasir', () => {
        const [bodyB64] = GOLDEN.quoteId.split('.')
        const body = JSON.parse(Buffer.from(bodyB64, 'base64').toString('utf8'))
        expect(body.payer).toBe('0x00000000000000000000000000000000000000A1')
    })

    // Muhurlu govde, ust seviyedeki degerlerin AYNISINI tasir. Ayrisirlarsa
    // ekranda gosterilen ve imzalanan sayi, sunucunun muhurledigi sayidan
    // farkli olur - ve dogrulama kapisi tam bunu yakalamak icin var.
    it('quoteId muhurlu govdesi ust seviyeyle tutarli', () => {
        const seal = JSON.parse(
            Buffer.from(GOLDEN.quoteId.split('.')[0], 'base64').toString('utf8'))
        expect(seal.atsFee).toBe(GOLDEN.atsFee)
        expect(seal.attachNanoton).toBe(GOLDEN.attachNanoton)
        expect(seal.actionHash).toBe(GOLDEN.sign.feeAuth.actionHash)
        expect(seal.seqno).toBe(GOLDEN.sign.feeAuth.seqno)
        expect(seal.deadline).toBe(GOLDEN.sign.feeAuth.deadline)
        expect(seal.tonWallet).toBe(GOLDEN.sign.feeAuth.tonWallet)
        expect(seal.tonPublicKey).toBe(GOLDEN.sign.feeAuth.tonPublicKey)
    })

    // MUHUR GOVDENIN KENDISINI de tasiyor. Bu, dogrulamayi skaler
    // karsilastirmadan cikarip govdenin tamamina baglamayi mumkun kilar.
    it('muhurlu govde payloadBoc u de tasir ve ust seviyeyle AYNIDIR', () => {
        const seal = JSON.parse(
            Buffer.from(GOLDEN.quoteId.split('.')[0], 'base64').toString('utf8'))
        expect(seal.payloadBoc).toBe(GOLDEN.payloadBoc)
    })
})

describe('TON_FEE_DOMAIN', () => {
    it('tam olarak dort alan tasir', () => {
        expect(Object.keys(TON_FEE_DOMAIN).sort()).toEqual(
            ['chainId', 'name', 'verifyingContract', 'version'].sort()
        )
    })

    it('verifyingContract atsConfig tan gelir, elle yazilmaz', () => {
        expect(TON_FEE_DOMAIN.verifyingContract).toBe(ATS_COLLECTOR)
    })

    it('name/version/chainId olculen degerlerle birebir', () => {
        expect(TON_FEE_DOMAIN.name).toBe('ATS TON Gas')
        expect(TON_FEE_DOMAIN.version).toBe('1')
        expect(TON_FEE_DOMAIN.chainId).toBe(56)
    })
})

describe('TON_FEE_AUTH_TYPES', () => {
    it('alan sirasi donmus — imzanin parcasi', () => {
        expect(TON_FEE_AUTH_TYPES.TonFeeAuth).toEqual([
            { name: 'tonWallet', type: 'string' },
            { name: 'tonPublicKey', type: 'bytes32' },
            { name: 'actionHash', type: 'bytes32' },
            { name: 'seqno', type: 'uint32' },
            { name: 'atsMaxFee', type: 'uint256' },
            { name: 'deadline', type: 'uint64' },
        ])
    })
})

describe('assertTonFeeDomain', () => {
    it('altin vektorun sign.domain i GECER', () => {
        expect(() => assertTonFeeDomain(GOLDEN.sign.domain)).not.toThrow()
    })

    it('name uyusmazsa firlatir', () => {
        expect(() => assertTonFeeDomain({ ...GOLDEN.sign.domain, name: 'Baska Isim' }))
            .toThrow('TON_FEE_DOMAIN_MISMATCH')
    })

    it('version uyusmazsa firlatir', () => {
        expect(() => assertTonFeeDomain({ ...GOLDEN.sign.domain, version: '2' }))
            .toThrow('TON_FEE_DOMAIN_MISMATCH')
    })

    it('chainId uyusmazsa firlatir', () => {
        expect(() => assertTonFeeDomain({ ...GOLDEN.sign.domain, chainId: 1 }))
            .toThrow('TON_FEE_DOMAIN_MISMATCH')
    })

    it('verifyingContract uyusmazsa firlatir', () => {
        expect(() => assertTonFeeDomain({ ...GOLDEN.sign.domain, verifyingContract: '0x0000000000000000000000000000000000dEaD' }))
            .toThrow('TON_FEE_DOMAIN_MISMATCH')
    })

    it('verifyingContract buyuk/kucuk harf farkini yok sayar', () => {
        expect(() => assertTonFeeDomain({ ...GOLDEN.sign.domain, verifyingContract: ATS_COLLECTOR.toLowerCase() }))
            .not.toThrow()
    })
})

describe('paymaster adresi', () => {
    // KOK NEDEN (olculdu 2026-08-31): bu modul ailesi adresi
    // `configStore().bundlerBase`den okuyordu. O deger production'da
    // https://api.extension.watswallet.com - token API'si ve Pimlico proxy'si
    // (/bundler/auth, /rpc/56 orada; /paymaster/* ve /health 404).
    // Paymaster https://bundler.watswallet.com'da ve orada /paymaster/status
    // 200 donuyor. Sonuc: her TON ucret cagrisi 404 aliyordu ve ozellik
    // production'da hic calismiyordu.
    it('ATS kaynak zincirinin backendBase i ile AYNI', () => {
        // Adres tek yerde yasamali. atsConfig.js'teki calisan ATS yolu zaten
        // oradan okuyor; ikinci bir kaynak, birinin guncellenip digerinin
        // unutulmasi demek (bu dosyanin basindaki ATS_COLLECTOR gerekcesiyle
        // AYNI kural).
        expect(tonFeePaymasterBase()).toBe(getAtsSourceConfig().backendBase)
    })

    it('olculen paymaster hostunu verir', () => {
        // Bir OLCUMUN yazimi: fixture basligindaki uc da
        // bundler.watswallet.com/paymaster/ton/quote idi.
        expect(tonFeePaymasterBase()).toBe('https://bundler.watswallet.com')
    })

    it('sonda bolu birakmaz - yollar `/paymaster/...` diye ekleniyor', () => {
        expect(tonFeePaymasterBase().endsWith('/')).toBe(false)
    })
})
