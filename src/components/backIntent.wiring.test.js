import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const kaynak = readFileSync(new URL('./Back.vue', import.meta.url), 'utf8')

describe('Back.vue gezinme niyeti', () => {
    it("tiklama navigate(props.page, 'back') cagirir", () => {
        expect(kaynak).toContain(`@click="pageStore().navigate(props.page, 'back')"`)
    })
    it('dogrudan currentPage ataması kalmadi', () => {
        expect(kaynak).not.toContain('currentPage = props.page')
    })
})
