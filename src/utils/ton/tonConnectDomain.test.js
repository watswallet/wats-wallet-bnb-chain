import { describe, it, expect } from 'vitest'
import { isDottedDomain } from './tonConnectDomain'

// connect.md Domain-binding rules: imzalanan alan adinda en az bir '.' ve iki
// yaninda gecerli karakter olmali. Noktasiz adlar (tonkeeper, localhost) yerel
// cuzdan entegrasyonlarina ayrilmis; dis dapp'ten KABUL EDILMEZ.
describe('isDottedDomain', () => {
    it.each([
        'app.dedust.io',
        '127.0.0.1',
        'xn--80ak6aa92e.com',
        // FQDN kok noktasi: TEK sondaki nokta atilir.
        'example.com.',
    ])('%s kabul edilir', (host) => {
        expect(isDottedDomain(host)).toBe(true)
    })

    it.each([
        'localhost',
        'localhost.',
        '',
        // resolveSenderOrigin'in cozemedigi gonderen icin yedegi.
        'Unknown',
        '[::1]',
        '.tonkeeper',
        'a..b',
        'example.com..',
        'app dedust.io',
    ])('%j reddedilir', (host) => {
        expect(isDottedDomain(host)).toBe(false)
    })

    it.each([[undefined], [null], [42], [{}]])('dize olmayan %j reddedilir', (host) => {
        expect(isDottedDomain(host)).toBe(false)
    })
})
