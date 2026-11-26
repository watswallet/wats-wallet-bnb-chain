import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { usernameErrorKey } from '../../../utils/usernameError'

const P = 'settings.profile.editUsername.'
const src = readFileSync(new URL('./EditUsername.vue', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('usernameErrorKey', () => {
    it('ham ethers/axios metni gecmez', () => {
        for (const msg of ['Request failed with status code 500', 'TypeError: x is undefined']) {
            expect(usernameErrorKey(new Error(msg))).toEqual({ key: P + 'error_unknown' })
        }
    })
    it('sunucu stack/ham metni gecmez', () => {
        const e = { response: { data: { message: 'Error: ECONNREFUSED at Object.query (/srv/db.js:12)' } } }
        expect(usernameErrorKey(e)).toEqual({ key: P + 'error_unknown' })
    })
    it('bilinen sunucu mesajlari cevrilir', () => {
        expect(usernameErrorKey({ response: { data: { message: 'Username already taken' } } }))
            .toEqual({ key: P + 'status_unavailable_desc' })
        expect(usernameErrorKey({ response: { data: { message: 'You must wait 9 more days to change your username.' } } }))
            .toEqual({ key: P + 'error_cooldown', params: { days: 9 } })
    })
    it('istek gitti cevap yok -> error_network', () => {
        expect(usernameErrorKey({ request: {}, message: 'Network Error' })).toEqual({ key: P + 'error_network' })
    })
})

describe('EditUsername.vue catch', () => {
    it('e.message ve response.data.message dogrudan errorMessage a yazilmaz', () => {
        const i = src.indexOf("console.error('Username update error:'")
        const body = src.slice(i, i + 500)
        expect(body).toMatch(/usernameErrorKey\(e\)/)
        expect(body).not.toMatch(/e\.message/)
        expect(body).not.toMatch(/response\.data\.message/)
    })
})

describe('error_cooldown 12 dilde', () => {
    const langs = ['tr', 'en', 'es', 'pt-BR', 'ru', 'zh-CN', 'vi', 'id', 'ko', 'ja', 'de', 'fr']
    it.each(langs)('%s', (l) => {
        const j = JSON.parse(readFileSync(new URL(`../../../i18n/locales/${l}.json`, import.meta.url), 'utf8'))
        expect(j.settings.profile.editUsername.error_cooldown).toContain('{days}')
    })
})
