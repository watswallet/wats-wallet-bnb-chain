import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// KAYNAK KILIDI -- oturum onbellekleri (bakiye anlik goruntusu + ATS yakit bakiyesi) kilitlenince silinir.
// Cikis/sifirlama da 'LOCK' mesaji gonderdigi icin ayni yoldan gecer (ForgotPassword.vue).
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const bg = read('./background.js')

describe('oturum onbellekleri kilitte silinir', () => {
    it('lockWallet clearSessionCaches cagirir', () => {
        const start = bg.indexOf('async function lockWallet()')
        const end = bg.indexOf('async function isUnlocked()')
        expect(start).toBeGreaterThan(-1)
        expect(bg.slice(start, end)).toMatch(/await clearSessionCaches\(\)/)
    })

    it('sifirlama LOCK mesajiyla lockWallet e gider', () => {
        const fp = read('./components/ForgotPassword.vue')
        expect(fp).toMatch(/type: 'LOCK'/)
        expect(bg).toMatch(/case 'LOCK':\s*\n\s*lockWallet\(\)/)
    })

    it('yakit bakiyesi onbellegi local a yazilmaz', () => {
        const fuel = read('./utils/atsFuel.js')
        const w = fuel.slice(fuel.indexOf('export async function writeFuelCache'), fuel.indexOf('export async function clearFuelCaches'))
        expect(w).not.toMatch(/storage\.local/)
    })
})
