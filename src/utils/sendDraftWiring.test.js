import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// GONDER TASLAGININ BAGLANTI TESTLERI.
//
// Saf katman (sendDraft.js) kendi dosyasinda test ediliyor. Ama dogru calisan bir
// kapi CAGRILMAZSA hicbir sey yapmaz - bu depoda tam olarak bu yasandi (bkz.
// jettonSendWiring.test.js, O3 dersi). Bu dosya cagrilarin GERCEKTEN yerinde
// oldugunu ve DOGRU SIRADA durdugunu olcer; sira burada davranisin kendisidir.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

// Yorum satirlarini atar: bir esleme yalnizca bir aciklamada duruyorsa gercek
// kod silinmis olabilir ve test yesil kalirdi.
const codeOnly = (src) => src
    .split('\n')
    .filter((line) => {
        const t = line.trim()
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('<!--')
    })
    .join('\n')

const SEND = codeOnly(read('../components/Send.vue'))
const CONFIRM = codeOnly(read('../components/ConfirmTransaction.vue'))
const STORE = codeOnly(read('../store/crypto.js'))

describe('taslak store uzerinden tasinir', () => {
    it('crypto store sendDraft tutar ve DISARI VERIR', () => {
        expect(STORE).toContain('const sendDraft = ref(null)')
        // Store'un return'unde yoksa alan bilesenlerden gorunmez; ref'in
        // tanimlanmis olmasi tek basina hicbir sey ifade etmez.
        const ret = STORE.slice(STORE.lastIndexOf('return {'))
        expect(ret).toContain('sendDraft')
    })
})

describe('Send.vue onizlemeye gecerken taslagi YAZAR', () => {
    it('captureSendDraft cagrilir ve store\'a yazilir', () => {
        expect(SEND).toContain('crypto.sendDraft = captureSendDraft({')
    })

    it('taslak onizlemeye GECMEDEN once yazilir', () => {
        // Sira tersine donerse Send.vue sokulur ve yazma hic calismaz.
        const capture = SEND.indexOf('crypto.sendDraft = captureSendDraft({')
        const navigate = SEND.indexOf("page.currentPage = 'confirm_transaction'")
        expect(capture).toBeGreaterThan(-1)
        expect(navigate).toBeGreaterThan(-1)
        expect(capture).toBeLessThan(navigate)
    })

    it('kullanicinin yazdigi ham tutar saklanir - bicimlendirilmis olan DEGIL', () => {
        const capture = SEND.slice(SEND.indexOf('crypto.sendDraft = captureSendDraft({'))
        const call = capture.slice(0, capture.indexOf('})') + 2)
        expect(call).toContain('amount: rawInput.value')
        expect(call).not.toContain('formattedAmount')
    })
})

describe('Send.vue kurulurken taslagi GERI YUKLER', () => {
    it('restoreSendDraft cagrilir', () => {
        expect(SEND).toContain('restoreSendDraft(crypto.sendDraft, {')
    })

    it('geri yukleme AKTIF varlik ve zincirle kapilanir', () => {
        // Kimlik taslagin KENDI anahtarindan uretilirse kapi her zaman acilir ve
        // eski bir alici yeni bir gonderime tasinir.
        const at = SEND.indexOf('restoreSendDraft(crypto.sendDraft, {')
        expect(at).toBeGreaterThan(-1)
        const call = SEND.slice(at, SEND.indexOf('})', at) + 2)
        expect(call).toContain('asset: crypto.sendAsset')
        expect(call).toContain('chainId: network.currentNetwork?.chainId')
    })

    it('geri yukleme BAKIYE okumasindan SONRA calisir', () => {
        // Bu sira davranisin kendisi: tutari geri yazmak watch(amount) tetikler ve
        // o kapi balance.value'ye bakar. Bakiye gelmeden calisirsa (baslangic 0)
        // gecerli tutar "yetersiz bakiye" damgasi yer ve watcher bir daha
        // atesleyecegi icin ekran o hatada kilitli kalir.
        const balanceRead = SEND.indexOf('balanceError.value = true')
        const restore = SEND.indexOf('restoreSendDraft(crypto.sendDraft, {')
        expect(balanceRead).toBeGreaterThan(-1)
        expect(restore).toBeGreaterThan(-1)
        expect(restore).toBeGreaterThan(balanceRead)
    })

    it('taslak okununca TUKETILIR', () => {
        // Tuketilmezse kullanicinin bilerek terk ettigi form, ayni varliga ikinci
        // kez girildiginde geri gelir.
        expect(SEND).toContain('crypto.sendDraft = null')
    })

    it('alanlar geri yazilir', () => {
        const at = SEND.indexOf('if (draft) {')
        expect(at).toBeGreaterThan(-1)
        const block = SEND.slice(at, SEND.indexOf('}', at))
        expect(block).toContain('to.value = draft.to')
        // Tam ifade sendAmountWiring'de dogrulaniyor (dolar kapisiyla birlikte);
        // burada onemli olan kutunun taslaktan besleniyor olmasi.
        expect(block).toContain('rawInput.value =')
        expect(block).toContain('draft.amount')
        expect(block).toContain('tonComment.value = draft.tonComment')
    })
})

describe('gonderim tamamlaninca taslak SILINIR', () => {
    // Islem gonderildikten sonra dogruca ana ekrana gidiliyor; Send.vue bir daha
    // kurulmadigi icin taslak kendi kendine tukenmez. Temizlenmezse AYNI varliga
    // bir sonraki gonderimde eski alici ve eski tutar forma geri yazilir.
    it('ana ekrana donen HER basari yolu taslagi temizler', () => {
        const lines = CONFIRM.split('\n')
        const homeAt = lines
            .map((line, i) => (line.includes("page.currentPage = 'home'") ? i : -1))
            .filter((i) => i !== -1)

        // Once VARLIK: yollar silinirse dongu bos gecer ve test anlamsizca yesil kalir.
        expect(homeAt.length).toBe(2)

        for (const i of homeAt) {
            const before = lines.slice(Math.max(0, i - 3), i).join('\n')
            expect(before).toContain('crypto.sendDraft = null')
        }
    })
})
