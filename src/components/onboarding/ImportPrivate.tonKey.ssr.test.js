// TON anahtari ozel anahtar ekranina yapistirilinca ne oluyor -- ImportPrivate.vue ve
// TonKey.vue GERCEKTEN render edilerek olculur (bkz. src/test-utils/ssrRender.js).
//
// KUSUR (2026-10-14, canli rapor): kullanici otomatik olusan TON hesabinin anahtarini
// TonKey ekranindan kopyalayip baska cihazdaki Wats'ta "Ozel Anahtar Ice Aktar"a
// yapistirdi; "Hesabi Ekle" HICBIR aciklama olmadan pasif kaldi. Anahtar 128 hex
// (ed25519 secretKey, 64 bayt), ekran yalniz 64 hex EVM anahtari kabul ediyor. Ham
// TON anahtari ice aktarilamaz; dogru yol hesabin 24 kelimelik TON ifadesi.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { keyPairFromSeed } from '@ton/crypto'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import en from '../../i18n/locales/en.json'
import ImportPrivate from './ImportPrivate.vue'
import TonKey from '../settings/accounts/TonKey.vue'

const EVM_KEY = '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'
const TON_SECRET_HEX = Buffer.from(keyPairFromSeed(Buffer.alloc(32, 7)).secretKey).toString('hex')

// SSR metni HTML-kacisli basar ("can't" -> "can&#39;t"); ham ceviriyle karsilastirma
// metin DOGRU basilsa bile kalirdi.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const T = Object.fromEntries(Object.entries(en.onboarding.importPrivate).map(([k, v]) => [k, esc(v)]))
const TK = Object.fromEntries(Object.entries(en.settings.tonKey).map(([k, v]) => [k, esc(v)]))

afterEach(() => { delete globalThis.chrome })

async function renderImportPrivate(privateKey) {
    installChromeStub({ vaults: [] })
    const app = createApp(ImportPrivate)
    app.use(createTestPinia())
    app.use(createTestI18n())
    captureInstance(app, 'ImportPrivate', (instance) => {
        instance.setupState.privateKey = privateKey
    })
    return render(app)
}

// "Hesabi Ekle" dugmesinin ACILIS etiketi. Dugmenin icinde baska <button> yok;
// etiketten geriye en yakin `<button` onun acilisidir.
function submitButtonTag(html) {
    const label = html.indexOf(T.btn_submit)
    expect(label).toBeGreaterThan(-1)
    const start = html.lastIndexOf('<button', label)
    return html.slice(start, html.indexOf('>', start) + 1)
}

describe('ImportPrivate: TON anahtari yapistirilinca', () => {
    it('kullaniciya bunun TON anahtari oldugunu ve ifadeyi kullanmasini soyler', async () => {
        const html = await renderImportPrivate(TON_SECRET_HEX)
        expect(html).toContain(T.ton_key_detected)
        expect(html).toContain(T.btn_import_phrase)
    })

    it('"Hesabi Ekle" pasif kalir -- ham TON anahtari EVM hesabi olarak ice aktarilmaz', async () => {
        const html = await renderImportPrivate(TON_SECRET_HEX)
        expect(submitButtonTag(html)).toMatch(/\sdisabled/)
    })
})

describe('ImportPrivate: EVM anahtari yapistirilinca', () => {
    it('TON uyarisi CIKMAZ ve "Hesabi Ekle" etkin olur', async () => {
        const html = await renderImportPrivate(EVM_KEY)
        expect(html).not.toContain(T.ton_key_detected)
        expect(submitButtonTag(html)).not.toMatch(/\sdisabled/)
    })
})

describe('TonKey: anahtar ekrani', () => {
    async function renderTonKey(tonKey) {
        const app = createApp(TonKey, { props: { tonKey } })
        app.use(createTestPinia())
        app.use(createTestI18n())
        return render(app)
    }

    it('turetilmis ifade varsa baska cihaza tasimak icin ifadeyi gosterir', async () => {
        const html = await renderTonKey({
            secretKeyHex: TON_SECRET_HEX,
            friendly: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG',
            mnemonic: Array(24).fill('abandon').join(' '),
        })
        expect(html).toContain(TK.transfer_hint)
    })

    it('ifade yoksa (ice aktarilmis TON hesabi) "asagidaki 24 kelime" demez', async () => {
        const html = await renderTonKey({
            secretKeyHex: TON_SECRET_HEX,
            friendly: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG',
            mnemonic: null,
        })
        expect(TK.transfer_hint).toBeTruthy()
        expect(html).not.toContain(TK.transfer_hint)
    })
})
