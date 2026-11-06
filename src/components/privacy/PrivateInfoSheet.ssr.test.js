import { describe, it, expect, vi } from 'vitest'
import { ssrRender, createTestI18n } from '../../test-utils/ssrRender.js'
import PrivateInfoSheet from './PrivateInfoSheet.vue'
import en from '../../i18n/locales/en.json'
import tr from '../../i18n/locales/tr.json'

const render = (props = {}, locale = 'en') => ssrRender(PrivateInfoSheet, {
    props: { mode: 'fund', chainName: 'Arbitrum One', ...props },
    global: { plugins: [createTestI18n(locale)] },
})

// Metni HTML'e girdigi bicimde bekle (')' gibi kacis gerektiren karakterler icin).
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const T = en.privacy.transfer

describe('PrivateInfoSheet', () => {
    it('dialog: role, aria-modal, baslik ve kapat dugmesi; pi-sheet sinif kalibi', async () => {
        const html = await render()
        expect(html).toContain('role="dialog"')
        expect(html).toContain('aria-modal="true"')
        expect(html).toMatch(/aria-labelledby="[^"]+"/)
        expect(html).toContain(esc(T.howTitle))
        expect(html).toContain('aria-label="Close"')
        expect(html).toMatch(/class="pi-backdrop /)
        expect(html).toMatch(/class="pi-panel /)
    })

    it('fund: uc adim, ag ucreti ve iade var; {chain} yerine chainName yazili; sendHowBody yok', async () => {
        const html = await render({ mode: 'fund', chainName: 'Arbitrum One' })
        expect(html).toContain(esc(T.fundStep1))
        expect(html).toContain(esc(T.fundStep2.replace('{chain}', 'Arbitrum One')))
        expect(html).not.toContain('{chain}')
        expect(html).toContain(esc(T.fundStep3))
        expect(html).toContain(esc(T.fundHowFee))
        expect(html).toContain(esc(T.howRefund))
        expect(html).not.toContain(esc(T.sendHowBody))
        expect(html).not.toContain(esc(T.sendHowFee))
    })

    it('send: gövde + ag ucreti + iade var; fund adimlari yok', async () => {
        const html = await render({ mode: 'send', chainName: 'Arbitrum One' })
        expect(html).toContain(esc(T.sendHowBody))
        expect(html).toContain(esc(T.sendHowFee))
        expect(html).toContain(esc(T.howRefund))
        expect(html).not.toContain(esc(T.fundStep1))
        expect(html).not.toContain(esc(T.fundStep3))
        expect(html).not.toContain(esc(T.fundHowFee))
    })

    // Sahip karari 2026-10-30: gizli modda ag ucreti (iade dahil) ATS ile odenir; metin native coin / BNB istemez.
    it('iade metni ATS der, BNB / native coin demez, iki dilde', async () => {
        for (const [mode, lang] of [['fund', 'en'], ['send', 'tr'], ['fund', 'tr'], ['send', 'en'], ['swap', 'en'], ['bridge', 'tr'], ['swap', 'tr'], ['bridge', 'en']]) {
            const html = await render({ mode }, lang)
            expect(html).toContain('ATS')
            expect(html).not.toMatch(/BNB|native/i)
        }
        expect(tr.privacy.transfer.howRefund).toContain('ATS')
        expect(en.privacy.transfer.howRefund).toContain('ATS')
        expect(tr.privacy.transfer.howRefund).not.toContain('BNB')
        expect(en.privacy.transfer.howRefund).not.toContain('BNB')
    })

    it('Turkce render: baslik ve fund adim 2 chainName ile', async () => {
        const html = await render({ mode: 'fund', chainName: 'Base' }, 'tr')
        expect(html).toContain('Nasıl çalışır?')
        expect(html).toContain(esc(tr.privacy.transfer.fundStep2.replace('{chain}', 'Base')))
    })

    it('fiyat / dolar metni yok', async () => {
        for (const mode of ['fund', 'send', 'swap', 'bridge']) {
            const html = await render({ mode })
            expect(html).not.toMatch(/\$|≈|USD(?!C)/)
        }
    })

    // Takas / Kopru: odeme Gizli Hesap'tan SilentSwap'a, sonuc yine kendi Gizli Hesabina. Govde selfHowBody'dir (alici / zincirde baglanti
    // iddiasi tasimaz); ag ucreti ve iade metni Gonder ile ayni.
    it('swap ve bridge: selfHowBody + sendHowFee + howRefund var; sendHowBody ve fund adimlari yok; zincirde baglanti yok iddiasi yok (iki dilde)', async () => {
        for (const mode of ['swap', 'bridge']) {
            for (const [lang, dict] of [['en', en], ['tr', tr]]) {
                const t = dict.privacy.transfer
                const html = await render({ mode }, lang)
                expect(html, `${mode} ${lang}`).toContain(esc(t.selfHowBody))
                expect(html, `${mode} ${lang}`).toContain(esc(t.sendHowFee))
                expect(html, `${mode} ${lang}`).toContain(esc(t.howRefund))
                expect(html, `${mode} ${lang}`).not.toContain(esc(t.sendHowBody))
                expect(html, `${mode} ${lang}`).not.toContain(esc(t.fundStep1))
                expect(html, `${mode} ${lang}`).not.toContain(esc(t.fundStep3))
                expect(html, `${mode} ${lang}`).not.toContain(esc(t.fundHowFee))
                expect(html, `${mode} ${lang}`).not.toContain('data-testid="info-step-')
                const govde = html.match(/data-testid="info-body"[^>]*>([^<]*)</)
                expect(govde, `${mode} ${lang} info-body`).not.toBeNull()
                expect(govde[1], `${mode} ${lang}`).toBe(esc(t.selfHowBody))
                // Kendine teslimde alici ve zincirde baglanti yoktur: metin bu iddiayi tasimaz.
                expect(t.selfHowBody, lang).not.toMatch(lang === 'en' ? /recipient|link|on-chain/i : /alıcı|bağ|zincir/i)
            }
        }
    })

    it('gecerli modlar: fund, send, swap, bridge Vue prop uyarisi uretmez', async () => {
        const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {})
        try {
            // Pozitif kontrol: gecersiz mod bu donanimda console.warn'a 'Invalid prop' uyarisi dusurur; yoksa asagidaki kilit bos gecerdi.
            await render({ mode: 'baska' })
            expect(uyari.mock.calls.some((cagri) => cagri.join(' ').includes('Invalid prop'))).toBe(true)
            uyari.mockClear()
            for (const mode of ['fund', 'send', 'swap', 'bridge']) await render({ mode })
            for (const cagri of uyari.mock.calls) expect(cagri.join(' ')).not.toContain('Invalid prop')
        } finally {
            uyari.mockRestore()
        }
    })
})
