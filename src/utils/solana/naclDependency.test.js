import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import nacl from 'tweetnacl'

// NEDEN BU TEST VAR: `import nacl from 'tweetnacl'` BUGUN de calisiyor --
// cunku @ton/crypto onu GECISKEN olarak cozuyor ve npm kok node_modules'a
// hoist ediyor. Yani import'un calismasi hicbir sey KANITLAMAZ: @ton/crypto
// bir gun nacl'i birakirsa ya da baska bir surume gecerse Solana imzalama
// yolu, package.json'da tek bir satir bile degismeden coker. Bu dosya o
// sessiz kirilmayi imkansiz kilar.
const readJson = (relative) =>
    JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'))

const pkg = readJson('../../../package.json')
const installed = readJson('../../../node_modules/tweetnacl/package.json')

describe('tweetnacl dogrudan bagimliliktir', () => {
    it('package.json dependencies icinde SABIT surumle bildirilir', () => {
        // Sabit surum (caret degil): asagidaki RFC 8032 vektor testlerinin
        // dogruluk kilidi, imzalayan kodun surumune baglidir.
        expect(pkg.dependencies.tweetnacl).toBe('1.0.3')
    })

    it('devDependencies icinde DEGILDIR -- uretim kodundan import ediliyor', () => {
        expect(pkg.devDependencies?.tweetnacl).toBeUndefined()
    })

    it('kurulu surum bildirilen surumun AYNISIDIR', () => {
        expect(installed.version).toBe(pkg.dependencies.tweetnacl)
    })

    it('ihtiyacimiz olan iki API yerinde', () => {
        expect(typeof nacl.sign.detached).toBe('function')
        expect(typeof nacl.sign.detached.verify).toBe('function')
    })
})
