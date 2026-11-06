import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// SIZINTI KILIDI (spec 7.2): adres tohumlu uzak avatar istegi kullanicinin IP'siyle
// adreslerini (Gizli Hesap dahil) ucuncu tarafa tasir. Kaynakta tek bir
// api.dicebear.com kalmamali; testler haric.
const SRC = fileURLToPath(new URL('../../', import.meta.url))

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.(vue|js|ts)$/.test(name) && !/\.test\.js$/.test(name)) out.push(p)
    }
    return out
}

describe('uzak avatar yok', () => {
    it('kaynakta api.dicebear.com gecmiyor', () => {
        const hits = walk(SRC).filter((f) => readFileSync(f, 'utf8').includes('api.dicebear.com'))
        expect(hits).toEqual([])
    })
})
