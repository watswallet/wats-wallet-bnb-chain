// historyChains.js -- Aktivite sunucusunun destekledigi aglar (gizli-mod cok-ag spec 4.1 "Aktivite sunucusu", 4.7 satir 8).
// Tek kaynak deliveryChains.js tablosunun `activityServer` alanidir (PF-DD1); sunucu CHAINS tablosuna esitligi
// deliveryChains.test.js kilitler. Burada yalniz davranis ve import yuzeyi olculur.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../test-utils/kaynakTarama'
import { historyServerSupports } from './historyChains'

describe('historyServerSupports', () => {
    it.each([1, 56, 8453, 42161, 137, 10])('%s desteklenir (sayi ve rakam dizgesi)', (id) => {
        expect(historyServerSupports(id)).toBe(true)
        expect(historyServerSupports(String(id))).toBe(true)
    })

    it.each([100, 42220, 5000, 25, 999999])('%s desteklenmez (sunucu 400 doner ya da teslim tablosunda yok)', (id) => {
        expect(historyServerSupports(id)).toBe(false)
        expect(historyServerSupports(String(id))).toBe(false)
    })

    it('teslim tablosunda olmayan ag (43114) kapali-basarisiz: ozel modda gecmis istenmez', () => {
        expect(historyServerSupports(43114)).toBe(false)
        expect(historyServerSupports('43114')).toBe(false)
    })

    it('EVM disi ve bos kimlikler desteklenmez, firlatmaz', () => {
        for (const v of ['solana-mainnet', -239, -3, null, undefined, '', 'abc', 56.5, NaN, {}, []]) {
            expect(historyServerSupports(v), String(v)).toBe(false)
        }
    })
})

describe('historyChains.js -- popup paketine girer', () => {
    it('yalniz deliveryChains.js (saf modul) import eder, ikinci bir ag listesi tutmaz', () => {
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./historyChains.js', import.meta.url)), 'utf8'))
        const importlar = [...kaynak.matchAll(/^\s*import\s[^\n]*$/gm)].map((m) => m[0].trim())
        expect(importlar).toHaveLength(1)
        expect(importlar[0]).toMatch(/from '\.\/privacy\/deliveryChains'/)
        expect(kaynak).not.toMatch(/\[\s*1\s*,\s*56\s*,/)
    })
})
