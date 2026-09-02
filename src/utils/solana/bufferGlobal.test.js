import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// @solana/web3.js MODUL DEGERLENDIRME aninda Buffer global'ini okur. Eklenti
// sayfalarinda ve MV3 service worker'inda boyle bir global YOKTUR: ilk import
// ReferenceError atar ve cuzdan HER agda (EVM dahil) bos acilir.
//
// vitest `environment: 'node'` ile calisiyor ve orada Buffer gercek bir global,
// yani davranis testi bu hatayi YAKALAYAMAZ. Bu yuzden kaynak uzerinden kilitlenir:
// @solana'yi dogrudan iceri alan her dosyanin ILK import'u bufferGlobal olmali.
const SOLANA_DIR = new URL('.', import.meta.url)

const FILES_IMPORTING_SOLANA = ['address.js', 'derive.js', 'buildTransferPlan.js']

describe('bufferGlobal', () => {
    it('globalThis.Buffer tanimli hale gelir', async () => {
        await import('./bufferGlobal.js')
        expect(typeof globalThis.Buffer).toBe('function')
    })

    it('@solana iceri alan her dosyanin ILK import u bufferGlobal', () => {
        for (const name of FILES_IMPORTING_SOLANA) {
            const src = readFileSync(new URL(name, SOLANA_DIR), 'utf8')
            if (!/from '@solana\//.test(src)) continue
            const firstImport = src.match(/^import .*$/m)?.[0] ?? ''
            expect(firstImport, `${name} ilk import`).toMatch(/bufferGlobal/)
        }
    })
})
