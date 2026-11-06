import { describe, it, expect } from 'vitest'
import { ssrRender, createTestI18n } from '../../test-utils/ssrRender.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import PrivateAssetPicker from './PrivateAssetPicker.vue'

const OPTIONS = [
    { key: '56:USDC', chainId: 56, asset: 'USDC', chainName: 'BNB Smart Chain', logo: '/usdc.png', badge: '/chains/56.png' },
    { key: '56:BNB', chainId: 56, asset: 'BNB', chainName: 'BNB Smart Chain', logo: '/chains/56.png', badge: '/chains/56.png' },
    { key: '42161:USDC', chainId: 42161, asset: 'USDC', chainName: 'Arbitrum One', logo: '/usdc.png', badge: '/chains/42161.png' },
]
const render = (props = {}) => ssrRender(PrivateAssetPicker, {
    props: { options: OPTIONS, selectedKey: '56:USDC', ...props },
    global: { plugins: [createTestI18n()] },
})
const rowsOf = (html) => html.split('data-testid="asset-row"').slice(1)

describe('PrivateAssetPicker -- kopru baglantisi kaldirildi (Task 4)', () => {
    it('showBridge artik yok: prop verilse bile bridge-link, "Asset not listed?" ve "Go to bridge" cizilmez (en ve tr); kaynakta showBridge, emit bridge, exitHint, exitAction yok', async () => {
        const html = await render({ showBridge: true })
        expect(rowsOf(html)).toHaveLength(3)
        expect(html).not.toContain('data-testid="bridge-link"')
        expect(html).not.toContain('Asset not listed?')
        expect(html).not.toContain('Go to bridge')
        const tr = await ssrRender(PrivateAssetPicker, { props: { options: OPTIONS, selectedKey: '56:USDC', showBridge: true }, global: { plugins: [createTestI18n('tr')] } })
        expect(tr).toContain('data-testid="asset-row"')
        expect(tr).not.toContain('Listede olmayan varlık?')
        expect(tr).not.toContain('Köprüye git')
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateAssetPicker.vue', import.meta.url)), 'utf8'))
        for (const iz of ['showBridge', "emit('bridge')", 'exitHint', 'exitAction', 'bridge-link']) expect(kaynak, iz).not.toContain(iz)
        expect(kaynak).toMatch(/defineEmits\(\['select', 'close'\]\)/)
    })
})

describe('PrivateAssetPicker', () => {
    it('dialog kalibi: role, aria-modal, tabindex, pi-backdrop/pi-panel, h-[80%] panel', async () => {
        const html = await render()
        expect(html).toContain('role="dialog"')
        expect(html).toContain('aria-modal="true"')
        expect(html).toContain('tabindex="-1"')
        expect(html).toMatch(/class="pi-backdrop /)
        expect(html).toMatch(/class="pi-panel [^"]*\sh-\[80%\]/)
    })

    it('baslik ve arama kutusu metinleri; kapat dugmesi', async () => {
        const html = await render()
        expect(html).toMatch(/<h2 id="asset-picker-title"[^>]*>Choose payment asset<\/h2>/)
        expect(html).toContain('aria-labelledby="asset-picker-title"')
        expect(html).toContain('placeholder="Search tokens"')
        expect(html).toContain('aria-label="Close"')
    })

    it('N secenek N satir; her satirda sembol ve ag adi', async () => {
        const html = await render()
        const rows = rowsOf(html)
        expect(rows.length).toBe(3)
        expect(rows[0]).toContain('>USDC<')
        expect(rows[0]).toContain('>BNB Smart Chain<')
        expect(rows[1]).toContain('>BNB<')
        expect(rows[2]).toContain('>Arbitrum One<')
        const tek = await render({ options: [OPTIONS[0]] })
        expect(rowsOf(tek).length).toBe(1)
    })

    it('secili satir aria-current ve onay isareti (data-selected) tasir; digerleri tasimaz', async () => {
        const html = await render({ selectedKey: '56:BNB' })
        const rows = rowsOf(html)
        expect(rows[0]).not.toContain('aria-current')
        expect(rows[0]).not.toContain('data-selected="true"')
        expect(rows[1]).toContain('aria-current="true"')
        expect(rows[1]).toContain('data-selected="true"')
        expect(rows[2]).not.toContain('data-selected="true"')
        expect(html.split('data-selected="true"').length - 1).toBe(1)
    })

    it('selectedKey eslesmiyorsa ya da null ise hicbir satir secili degil', async () => {
        for (const selectedKey of ['yok', null]) {
            const html = await render({ selectedKey })
            expect(html).not.toContain('data-selected="true"')
            expect(html).not.toContain('aria-current')
        }
    })

    it('her satirda logo ve zincir rozeti; tum img src yerel (uzak yok)', async () => {
        const html = await render()
        const rows = rowsOf(html)
        for (const row of rows) expect(row.split('<img').length - 1).toBe(2)
        expect(rows[2]).toContain('src="/chains/42161.png"')
        const srcs = [...html.matchAll(/src="([^"]*)"/g)].map((m) => m[1])
        expect(srcs.length).toBeGreaterThan(0)
        for (const src of srcs) {
            expect(src.startsWith('/')).toBe(true)
            expect(src).not.toMatch(/^(https?:)?\/\//)
        }
    })

    it('satirda bakiye metni yok', async () => {
        const html = await render()
        expect(html).not.toMatch(/Balance/i)
        expect(html).not.toMatch(/Bakiye/i)
        expect(html).not.toMatch(/\d+\.\d{2,}/)
    })

    it('secenek yoksa bos metni', async () => {
        const html = await render({ options: [], selectedKey: null })
        expect(html).toContain('No tokens found')
        expect(rowsOf(html).length).toBe(0)
    })
})
