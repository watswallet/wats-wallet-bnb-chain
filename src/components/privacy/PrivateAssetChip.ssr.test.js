import { describe, it, expect } from 'vitest'
import { ssrRender, createTestI18n } from '../../test-utils/ssrRender.js'
import PrivateAssetChip from './PrivateAssetChip.vue'

const render = (props = {}) => ssrRender(PrivateAssetChip, {
    props: { logo: '/usdc.png', symbol: 'USDC', network: 'BNB Smart Chain', testid: 'source-chip', ...props },
    global: { plugins: [createTestI18n()] },
})

describe('PrivateAssetChip', () => {
    it('etkilesimli cip: dugme, sembol, ag adi, ok simgesi', async () => {
        const html = await render({ badge: '/chains/56.png' })
        expect(html).toContain('<button')
        expect(html).toContain('type="button"')
        expect(html).toContain('data-testid="source-chip"')
        expect(html).toContain('>USDC<')
        expect(html).toContain('>BNB Smart Chain<')
        expect(html).toContain('<svg')
        expect(html).not.toContain('role="group"')
    })

    it('Takas cipi sinif kumesi, logo 24 px, sembol ve ag adi sinifi', async () => {
        const html = await render({ badge: '/chains/56.png' })
        expect(html).toContain('flex items-center gap-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#202022] dark:hover:bg-[#2a2a2c]')
        expect(html).toContain('px-3 py-2 rounded-xl')
        expect(html).toContain('shrink-0')
        expect(html).toContain('w-6 h-6')
        expect(html).toContain('font-bold text-sm')
        expect(html).toContain('text-[10px] text-slate-500')
    })

    it('rozet <img> yalniz badge verilince, logonun sag altinda 16 px yuvarlak', async () => {
        const withBadge = await render({ badge: '/chains/56.png' })
        expect(withBadge.split('<img').length - 1).toBe(2)
        expect(withBadge).toContain('src="/chains/56.png"')
        expect(withBadge).toContain('absolute -bottom-1 -right-1 w-4 h-4 rounded-full')
        const without = await render()
        expect(without.split('<img').length - 1).toBe(1)
        const nullBadge = await render({ badge: null })
        expect(nullBadge.split('<img').length - 1).toBe(1)
    })

    it('interactive=false: dugme yok, role=group, ok simgesi yok', async () => {
        const html = await render({ interactive: false, badge: '/chains/56.png' })
        expect(html).not.toContain('<button')
        expect(html).toContain('role="group"')
        expect(html).not.toContain('<svg')
        expect(html).toContain('>USDC<')
        expect(html).toContain('>BNB Smart Chain<')
        expect(html).toContain('data-testid="source-chip"')
    })

    it('varsayilan (compact yok) markup degismez: rounded-xl, 24 px logo, iki satirli sembol ve ag adi, 16 px ok', async () => {
        const html = await render({ badge: '/chains/56.png' })
        expect(html).not.toContain('rounded-full bg-slate-100')
        expect(html).not.toContain('inline-flex')
        expect(html).toContain('flex flex-col min-w-0 leading-tight')
        expect(html).toContain('<span class="font-bold text-sm">USDC</span>')
        expect(html).toContain('w-6 h-6 rounded-full border')
        expect(html).toContain('w-4 h-4 shrink-0 text-slate-500')
        expect(html).not.toContain('w-5 h-5')
        expect(html).not.toContain('w-3 h-3')
    })

    it('compact etkilesimli: hap (inline-flex, rounded-full), 20 px logo + 12 px rozet, sembol ve ag adi TEK satirda, kucuk ok; islev ayni (dugme, aria-haspopup)', async () => {
        const html = await render({ compact: true, badge: '/chains/56.png' })
        expect(html).toMatch(/^<button/)
        expect(html).toContain('type="button"')
        expect(html).toContain('aria-haspopup="dialog"')
        expect(html).toContain('data-testid="source-chip"')
        expect(html).toContain('inline-flex items-center gap-2 max-w-full rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-[#202022] dark:hover:bg-[#2a2a2c] pl-1.5 pr-2.5 py-1')
        expect(html).toContain('cursor-pointer')
        expect(html).not.toContain('rounded-xl')
        expect(html).not.toContain('px-3 py-2')
        // Logo 20 px, rozet 12 px (ayni iki gorsel, ayni sira).
        expect(html).toContain('w-5 h-5 rounded-full border')
        expect(html).toContain('absolute -bottom-0.5 -right-1 w-3 h-3 rounded-full')
        expect(html).not.toContain('w-6 h-6')
        expect(html).not.toContain('w-4 h-4 rounded-full')
        expect(html.split('<img').length - 1).toBe(2)
        // Sembol ve ag adi yan yana (flex-col degil), kucuk yazi; ok 14 px.
        expect(html).toContain('flex items-baseline gap-2 min-w-0')
        expect(html).not.toContain('flex-col')
        expect(html).toContain('<span class="font-semibold text-xs">USDC</span>')
        expect(html).toContain('<span class="text-[11px] text-slate-500 dark:text-zinc-400 truncate">BNB Smart Chain</span>')
        expect(html).toContain('w-3.5 h-3.5 shrink-0')
        expect(html.indexOf('>USDC<')).toBeLessThan(html.indexOf('>BNB Smart Chain<'))
    })

    it('compact etkilesimsiz: <div role=group>, ok ve hover yok, hap gorunumu korunur', async () => {
        const html = await render({ compact: true, interactive: false, badge: '/chains/56.png' })
        expect(html).toMatch(/^<div/)
        expect(html).toContain('role="group"')
        expect(html).toContain('aria-label="USDC BNB Smart Chain"')
        expect(html).not.toContain('<button')
        expect(html).not.toContain('<svg')
        expect(html).not.toContain('hover:')
        expect(html).not.toContain('cursor-pointer')
        expect(html).toContain('inline-flex items-center gap-2 max-w-full rounded-full bg-slate-100 dark:bg-[#202022] pl-1.5 pr-2.5 py-1')
        expect(html).toContain('>USDC</span>')
        expect(html).toContain('>BNB Smart Chain</span>')
    })

    it('compact: rozet yalniz badge verilince; tum src yerel', async () => {
        expect((await render({ compact: true })).split('<img').length - 1).toBe(1)
        expect((await render({ compact: true, badge: null })).split('<img').length - 1).toBe(1)
        const html = await render({ compact: true, badge: '/chains/1.png' })
        for (const [, src] of html.matchAll(/\ssrc="([^"]*)"/g)) expect(src.startsWith('/')).toBe(true)
    })

    it('tum src degerleri / ile baslar (uzak gorsel yok)', async () => {
        for (const props of [{ badge: '/chains/56.png' }, {}, { interactive: false, badge: '/chains/1.png' }]) {
            const html = await render(props)
            const srcs = [...html.matchAll(/\ssrc="([^"]*)"/g)].map((m) => m[1])
            expect(srcs.length).toBeGreaterThan(0)
            for (const s of srcs) expect(s.startsWith('/')).toBe(true)
        }
    })
})
