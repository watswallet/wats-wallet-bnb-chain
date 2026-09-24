// PAYLASILAN ATS UCRET KARTI.
//
// Bes ekranda (Send, Takas, Kopru, Dapp, dapp/TonSendTx) YEDI ayri ATS ucret karti
// vardi ve ikisi bile birbirinin ayni degildi. Kullanicinin gordugu somut ayrisma:
// Takas ekranindaki TON karti etiketi ve tutari AYNI SATIRDA, logosuz, dolar
// karsiligi olmadan ciziyordu -- Send'deki ayni kart ise logolu, buyuk tutarli ve
// dolar karsiligiyla. "Tum ATS ucret kartlari tek componentten gelsin, hepsi
// Send'deki gibi gorunsun" istegi bu dosyanin sebebidir.
//
// GORUNUS BIRLESIR, METIN BIRLESMEZ. Bu ayrimin gerekcesi zincir gercegi:
//   - ayni-zincir EVM'de ucret bir UST SINIRDIR, postOp kullanilmayan gazi IADE EDER
//   - capraz-zincirde ve TON /relay yolunda IADE YOKTUR
// Tek bir etiket/alt satir kumesi dayatmak, bu iki durumdan BIRINDE kullaniciya
// iade konusunda yalan soylemek demekti. Component bu yuzden HICBIR i18n anahtarini
// KENDI TURETMEZ ve HICBIR SAYIYI BICIMLEMEZ: ikisi de ekranin sorumlulugudur.
//
// Asagidaki testler kartin GORUNUSUNU degil, tam da bu KURALLARI kilitler.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ssrRender, createTestI18n } from '../test-utils/ssrRender.js'
import AtsFeeCard from './AtsFeeCard.vue'

const KAYNAK = readFileSync(fileURLToPath(new URL('./AtsFeeCard.vue', import.meta.url)), 'utf8')

const K = (ad) => `send.confirmTransaction.${ad}`

const ciz = (props) => ssrRender(AtsFeeCard, {
    props: { labelKey: K('gasFee'), ...props },
    global: { plugins: [createTestI18n('en')] },
})

describe('AtsFeeCard -- etiket ekrandan gelir (Y1)', () => {
    // `gasFee` = "Predicted Gas Fee" (TAHMINI), `tonFeeExact` = "Fee Charged" (KESIN).
    // EVM'de gosterilen sayi gercekten bir tahmindir; TON'da /relay TAM OLARAK o kadar
    // keser. Component etiketi kendi secerse ikisinden biri MUTLAKA yanlis olur.
    it('verilen etiket anahtarini basar', async () => {
        expect(await ciz({ amount: '1.5' })).toContain('Predicted Gas Fee')
    })

    it('TON varyantinda KESIN etiketi basar, tahmini DEGIL', async () => {
        const html = await ciz({ labelKey: K('tonFeeExact'), amount: '1.5' })

        expect(html).toContain('Fee Charged')
        expect(html).not.toContain('Predicted')
    })

    it('component hicbir etiket anahtarini KENDI turetmez', () => {
        // Kaynakta sabit bir `send.confirmTransaction.<...>` dizesi olmamali:
        // olsaydi o ekran prop gecirse de component kendi bildigini basardi.
        expect(KAYNAK).not.toMatch(/send\.confirmTransaction\.(gasFee|tonFeeExact|atsPaidWith)/)
    })
})

describe('AtsFeeCard -- "en fazla" ile "iade edilmez" ASLA birlikte cizilmez (Y2)', () => {
    // Bu ikisi birbirini CURUTUR: "en fazla 2.3 ATS" kullanilmayan kismin geri
    // gelecegini soyler, "iade edilmez" gelmeyecegini. Capraz-zincirde iade YOKTUR
    // (uzak paymaster'in postOp'u yok) ve bu cift daha once ekranda yan yana cizildi.
    it('showUpTo acikken niteleyici gorunur', async () => {
        expect(await ciz({ amount: '2.3', showUpTo: true })).toContain('up to')
    })

    it('showUpTo varsayilan olarak KAPALIDIR', async () => {
        // Yanlis tarafa dusen "en fazla" var olmayan bir iade sozu verir; dusen
        // "en fazla" yalnizca fazla temkinli olur. Varsayilan guvenli taraftadir.
        expect(await ciz({ amount: '2.3' })).not.toContain('up to')
    })

    it('iade-yok satiri varken "en fazla" CIZILMEZ', async () => {
        const html = await ciz({
            amount: '2.3', showUpTo: true, noRefundKey: K('atsFeeNoRefund'),
        })

        expect(html).toContain('non-refundable')
        expect(html, '"en fazla" ile "iade edilmez" ayni kartta').not.toContain('up to')
    })
})

describe('AtsFeeCard -- iade satiri IKI AYRI anahtar olarak korunur (Y3)', () => {
    // Metinleri neredeyse ayni ama AYRI anahtarlar. Tek anahtara indirgemek,
    // cevirilerin birinde sessizce olu anahtar birakir.
    it('EVM anahtarini basar', async () => {
        expect(await ciz({ amount: '1', noRefundKey: K('atsFeeNoRefund') }))
            .toContain('This fee is non-refundable')
    })

    it('TON anahtarini basar', async () => {
        expect(await ciz({ amount: '1', noRefundKey: K('tonFeeNoRefund') }))
            .toContain('This fee is not refundable')
    })

    it('anahtar verilmezse satir HIC cizilmez', async () => {
        // Takas/Kopru ekranlarinda bu satir BILEREK yok: ayni-zincir takasta
        // "iade edilmez" duz yalan olurdu.
        const html = await ciz({ amount: '1' })

        expect(html).not.toContain('refundable')
        expect(html).not.toContain('not refunded')
    })
})

describe('AtsFeeCard -- tutar HAM basilir, ASLA bicimlenmez (Y4)', () => {
    // TON kartinda gosterilen sayi DOGRUDAN imzalanacak `atsMaxFee` alanidir.
    // Component araya bir bicimleyici koyarsa ekrandaki sayi ile imzalanan sayi
    // ayrisir: kullanici onayladigini sandigindan BASKA bir tutari imzalar.
    it('uzun ondalik kirpilmadan gecer', async () => {
        expect(await ciz({ amount: '20.746887966804980152' }))
            .toContain('20.746887966804980152')
    })

    it('component bir bicimleyici IMPORT ETMEZ', () => {
        expect(KAYNAK).not.toMatch(/formatAtsAmount|atsCompact|toFixed/)
    })
})

describe('AtsFeeCard -- "ucret yanar" uyarisi ekranin karari (Y5)', () => {
    // Uc ekranda UC AYRI dogru deger var: Takas'ta HER ZAMAN (sendMode 3 ile
    // fonlanamayan eylem atlanir, islem "basarili" sayilir, ucret kesilmistir ve
    // takas OLMAMISTIR), Send'de yalniz jetton (duz TON'da bounce:false, zincirde
    // dusecek eylem yok), dapp gonderiminde HIC. Bu bir stil tercihi degil.
    it('acikken uyari cizilir', async () => {
        expect(await ciz({ amount: '1', burnsWarning: true }))
            .toContain('this fee is not refunded')
    })

    it('varsayilan KAPALIDIR', async () => {
        // Var olmayan bir riskle korkutmak da bir hatadir.
        expect(await ciz({ amount: '1' })).not.toContain('this fee is not refunded')
    })
})

describe('AtsFeeCard -- dolar satiri KENDI metnine baglidir (S10)', () => {
    // Kosul `amount` DEGIL `usdText`: tutar varken fiyat gelmemis olabilir ve
    // sifirli bir dolar metni bir ucret kartinda "bedava" demektir.
    it('metin varsa cizilir', async () => {
        expect(await ciz({ amount: '1', usdText: '3.48' })).toContain('3.48')
    })

    it('metin yoksa dolar isareti HIC gecmez', async () => {
        expect(await ciz({ amount: '1' })).not.toContain('≈ $')
    })
})

describe('AtsFeeCard -- tutarin yukleniyor ve bos halleri (S2, S3)', () => {
    it('yukleniyorken iskelet cizilir, tutar cizilmez', async () => {
        const html = await ciz({ amount: null, loading: true })

        expect(html).toContain('animate-pulse')
        expect(html).not.toContain('—')
    })

    it('yukleme bitti ve tutar yoksa TIRE cizilir (sag taraf bos KALMAZ)', async () => {
        const html = await ciz({ amount: null, loading: false })

        expect(html).toContain('—')
        expect(html).not.toContain('animate-pulse')
    })

    it('tam deger yalniz verildiginde title olur', async () => {
        expect(await ciz({ amount: '1.2345', exact: '1.23456789 ATS' }))
            .toContain('title="1.23456789 ATS"')
        expect(await ciz({ amount: '1.2345' })).not.toContain('title=')
    })
})

describe('AtsFeeCard -- kabuk ve sembol', () => {
    // Kullanicinin sikayet ettigi ayrisma: Takas karti logosuz ve dar, Send karti
    // logolu ve buyuk. Tek kabuk kaldi -- Send'inki.
    it('logo verilince cizilir, verilmeyince HIC cizilmez', async () => {
        expect(await ciz({ amount: '1', logoUri: '/ats.png' })).toContain('/ats.png')
        expect(await ciz({ amount: '1' })).not.toContain('<img')
    })

    it('sembol varsayilani ATS, prop ezer', async () => {
        expect(await ciz({ amount: '1' })).toContain('ATS')
        expect(await ciz({ amount: '1', symbol: 'WATS' })).toContain('WATS')
    })

    // YERLESIM TESTININ ARACI BUNA BAGLI (atsFeeCardTogether.test.js): kart govdesi
    // kaynak metinden, sinifinda `rounded-xl` gecen div yiginiyla cikariliyor.
    // Kabuk `:class` ile dinamik uretilirse o arac kartin sinirini bulamaz.
    it('kok kabuk STATIK rounded-xl tasir', () => {
        expect(KAYNAK).toMatch(/<div[^>]*class="[^"]*rounded-xl/)
    })
})
