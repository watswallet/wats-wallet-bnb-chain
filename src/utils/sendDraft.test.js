import { describe, it, expect } from 'vitest'
import { sendDraftKey, captureSendDraft, restoreSendDraft } from './sendDraft'

const BSC = 56
const TON = -239

describe('sendDraftKey', () => {
    it('varlik + zincir birlikte kimligi olusturur', () => {
        const key = sendDraftKey({ address: '0xAbC' }, BSC)
        expect(key).toBe('56:0xabc')
    })

    it('adres yoksa `ca` alanina duser', () => {
        expect(sendDraftKey({ ca: '0xDeF' }, BSC)).toBe('56:0xdef')
    })

    it('adres buyuk/kucuk harfi kimligi degistirmez', () => {
        // EVM adresleri kimi kayitta checksum'li kimi kayitta kucuk harf gelir;
        // ayni token iki farkli anahtar uretirse taslak asla geri gelmez.
        expect(sendDraftKey({ address: '0xABC' }, BSC))
            .toBe(sendDraftKey({ address: '0xabc' }, BSC))
    })

    it('native varlik (adres yok) token ile AYNI anahtari uretmez', () => {
        expect(sendDraftKey(null, BSC)).not.toBe(sendDraftKey({ address: '0xabc' }, BSC))
    })

    // chainId olmadan kimlik yok: eksik zincir iki FARKLI zincirin taslagini
    // ayni anahtara toplar ve BNB gonderiminin alicisi TON ekraninda belirir.
    it('chainId yoksa kimlik uretilmez', () => {
        expect(sendDraftKey({ address: '0xabc' }, undefined)).toBeNull()
        expect(sendDraftKey({ address: '0xabc' }, null)).toBeNull()
    })
})

describe('captureSendDraft', () => {
    it('girdileri kimlikle birlikte saklar', () => {
        const draft = captureSendDraft({
            asset: { address: '0xabc' }, chainId: BSC,
            to: '0xdead', amount: '1.5', tonComment: '',
        })
        expect(draft).toEqual({ key: '56:0xabc', to: '0xdead', amount: '1.5', tonComment: '', mode: 'token' })
    })

    it('kimlik uretilemiyorsa taslak DA uretilmez', () => {
        expect(captureSendDraft({
            asset: { address: '0xabc' }, chainId: null, to: '0xdead', amount: '1',
        })).toBeNull()
    })

    it('alanlar metne cevrilir - number tutar geri yazilabilir olmali', () => {
        // MAX dugmesi amount'a SAYI yaziyor (setMax). Sayi olarak saklanip
        // input'a geri konursa v-model tipi degisir; metin olarak sabitlenir.
        const draft = captureSendDraft({
            asset: null, chainId: TON, to: 'UQabc', amount: 12.5, tonComment: null,
        })
        expect(draft.amount).toBe('12.5')
        expect(draft.tonComment).toBe('')
    })

    // Girdi birimi de taslakla tasinir: kullanici dolar yazarken onizlemeye
    // gecip geri donunce alanin token'a atlamasi, tam da sikayet edilen
    // "girdiler sifirlaniyor" hissinin daha sinsi bir hali olurdu.
    it('girdi birimini saklar', () => {
        const draft = captureSendDraft({
            asset: null, chainId: TON, to: 'UQabc', amount: '1', mode: 'usd',
        })
        expect(draft.mode).toBe('usd')
    })

    // Birim yalnizca IKI degerden biri olabilir. Taninmayan bir deger token'a
    // duser: bilinmeyen bir birimde acilan kutu, kullanicinin yazdigi sayiyi
    // bambaska bir miktara cevirir.
    it('taninmayan birim token sayilir', () => {
        expect(captureSendDraft({ asset: null, chainId: TON, to: 'a', amount: '1' }).mode).toBe('token')
        expect(captureSendDraft({ asset: null, chainId: TON, to: 'a', amount: '1', mode: 'lira' }).mode).toBe('token')
    })
})

describe('restoreSendDraft', () => {
    const draft = captureSendDraft({
        asset: { address: '0xabc' }, chainId: BSC,
        to: '0xdead', amount: '1.5', tonComment: 'memo', mode: 'usd',
    })

    it('ayni varlik + ayni zincirde girdileri geri verir', () => {
        expect(restoreSendDraft(draft, { asset: { address: '0xabc' }, chainId: BSC }))
            .toEqual({ to: '0xdead', amount: '1.5', tonComment: 'memo', mode: 'usd' })
    })

    // Bu testlerin hepsi ayni tehlikeyi olcuyor: ESKI bir aliciyi YENI bir
    // gonderime sessizce tasimak. Kullanici tutari yazip gonderir ve parasi
    // bambaska bir adrese gider - geri alinamaz.
    it('varlik degistiyse geri vermez', () => {
        expect(restoreSendDraft(draft, { asset: { address: '0xffff' }, chainId: BSC })).toBeNull()
    })

    it('zincir degistiyse geri vermez', () => {
        expect(restoreSendDraft(draft, { asset: { address: '0xabc' }, chainId: 1 })).toBeNull()
    })

    it('hedef zincir bilinmiyorsa geri vermez', () => {
        expect(restoreSendDraft(draft, { asset: { address: '0xabc' }, chainId: undefined })).toBeNull()
    })

    it('taslak yoksa geri vermez', () => {
        expect(restoreSendDraft(null, { asset: { address: '0xabc' }, chainId: BSC })).toBeNull()
        expect(restoreSendDraft(undefined, { asset: { address: '0xabc' }, chainId: BSC })).toBeNull()
    })

    it('kimliksiz (bozuk) taslak geri vermez', () => {
        expect(restoreSendDraft({ to: '0xdead', amount: '1' }, { asset: { address: '0xabc' }, chainId: BSC }))
            .toBeNull()
    })

    it('native varligin taslagi token ekraninda acilmaz', () => {
        const nativeDraft = captureSendDraft({
            asset: null, chainId: BSC, to: '0xdead', amount: '1', tonComment: '',
        })
        expect(restoreSendDraft(nativeDraft, { asset: { address: '0xabc' }, chainId: BSC })).toBeNull()
        expect(restoreSendDraft(nativeDraft, { asset: null, chainId: BSC }))
            .toEqual({ to: '0xdead', amount: '1', tonComment: '', mode: 'token' })
    })
})
