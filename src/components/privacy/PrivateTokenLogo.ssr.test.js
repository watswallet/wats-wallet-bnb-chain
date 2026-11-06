import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ssrRender } from '../../test-utils/ssrRender.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import PrivateTokenLogo from './PrivateTokenLogo.vue'

const render = (props = {}) => ssrRender(PrivateTokenLogo, { props: { logo: '/usdc.png', ...props } })

describe('PrivateTokenLogo', () => {
    it('varsayilan boyut: 24 px logo, 16 px rozet logonun sag altinda (Takas cipi olcusu)', async () => {
        const html = await render({ badge: '/chains/56.png' })
        expect(html).toMatch(/^<span class="relative shrink-0">/)
        expect(html).toContain('w-6 h-6 rounded-full border border-slate-200 dark:border-transparent')
        expect(html).toContain('absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white dark:bg-zinc-900 p-[1.5px] border border-slate-200 dark:border-white/10')
        expect(html).not.toContain('w-5 h-5')
        expect(html.split('<img').length - 1).toBe(2)
    })

    it('small: 20 px logo, 12 px rozet (ozet satiri ve kompakt cip olcusu)', async () => {
        const html = await render({ badge: '/chains/56.png', small: true })
        expect(html).toContain('w-5 h-5 rounded-full border border-slate-200 dark:border-transparent')
        expect(html).toContain('absolute -bottom-0.5 -right-1 w-3 h-3 rounded-full bg-white dark:bg-zinc-900 p-[1px] border border-slate-200 dark:border-white/10')
        expect(html).not.toContain('w-6 h-6')
        expect(html).not.toContain('w-4 h-4')
    })

    it('logo once, rozet sonra; rozet yalniz badge verilince; hepsi yerel yol ve alt bos (dekoratif)', async () => {
        const html = await render({ badge: '/chains/1.png' })
        const srcs = [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1])
        expect(srcs).toEqual(['/usdc.png', '/chains/1.png'])
        for (const s of srcs) expect(s.startsWith('/')).toBe(true)
        expect(html).toContain('referrerpolicy="no-referrer"')
        expect(html).toContain('decoding="async"')
        for (const props of [{}, { badge: null }]) expect((await render(props)).split('<img').length - 1).toBe(1)
    })

    it('kaynak: yuklenemeyen gorsel yedek simgeye duser (onerror once temizlenir, dongu yok), uzak adres yok', () => {
        const kod = yorumsuz(readFileSync(fileURLToPath(new URL('./PrivateTokenLogo.vue', import.meta.url)), 'utf8'))
        expect(kod).toContain("'/default-token.png'")
        expect(kod).toContain('e.target.onerror = null')
        expect(kod.split('@error="onImgError"').length - 1).toBe(2)
        expect(kod).not.toMatch(/https?:\/\//)
    })
})
