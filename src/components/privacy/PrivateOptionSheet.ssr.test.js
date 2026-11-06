import { describe, it, expect } from 'vitest'
import { ssrRender, createTestI18n } from '../../test-utils/ssrRender.js'
import PrivateOptionSheet from './PrivateOptionSheet.vue'

const OPTIONS = [
    { value: 'a-1', title: 'Hesap 1', subtitle: '0xabab...abab', subtitleMono: true, logo: 'data:image/svg+xml,A' },
    { value: 'b-2', title: 'Hesap 2', subtitle: '0xcdcd...cdcd', subtitleMono: true, logo: 'data:image/svg+xml,B' },
]
const render = (props = {}) => ssrRender(PrivateOptionSheet, {
    props: { title: 'From account', titleId: 'x-title', options: OPTIONS, selected: 'b-2', ...props },
    global: { plugins: [createTestI18n()] },
})

describe('PrivateOptionSheet', () => {
    it('dialog + listbox: baslik, kapat dugmesi, her satirda logo, baslik ve gri alt baslik', async () => {
        const html = await render()
        expect(html).toContain('role="dialog"')
        expect(html).toContain('aria-modal="true"')
        expect(html).toContain('aria-labelledby="x-title"')
        expect(html).toMatch(/<h2 id="x-title"[^>]*>From account<\/h2>/)
        expect(html).toContain('aria-label="Close"')
        expect(html).toContain('role="listbox"')
        expect(html.split('role="option"').length - 1).toBe(2)
        expect(html).toContain('src="data:image/svg+xml,A"')
        expect(html).toContain('>Hesap 1<')
        expect(html).toContain('>0xabab...abab<')
    })

    it('pi-sheet gecisinin hedefledigi siniflari tasir; sabit h-[80%] yok, en cok 80% ve icerige gore', async () => {
        const html = await render()
        expect(html).toMatch(/class="pi-backdrop /)
        expect(html).toMatch(/class="pi-panel [^"]*max-h-\[80%\]/)
        expect(html).not.toMatch(/class="pi-panel [^"]*\sh-\[80%\]/)
    })

    it('secili satir aria-selected=true ve onay isareti tasir; digeri false ve isaretsiz', async () => {
        const html = await render()
        const rows = html.split('role="option"').slice(1)
        expect(rows[0]).toContain('aria-selected="false"')
        expect(rows[0]).not.toContain('data-selected="true"')
        expect(rows[1]).toContain('aria-selected="true"')
        expect(rows[1]).toContain('data-selected="true"')
    })

    it('secili deger eslesmiyorsa hicbir satir secili degil', async () => {
        const html = await render({ selected: 'yok' })
        expect(html).not.toContain('data-selected="true"')
        expect(html).not.toContain('aria-selected="true"')
    })

    it('alt basligi olmayan satir bos alt baslik yazmaz', async () => {
        const html = await render({ options: [{ value: 56, title: 'BNB Smart Chain', logo: '/chains/56.png' }], selected: 56 })
        expect(html).toContain('>BNB Smart Chain<')
        expect(html).not.toContain('text-[11px]')
    })
})
