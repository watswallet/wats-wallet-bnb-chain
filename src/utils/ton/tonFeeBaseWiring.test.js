import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// TON UCRET UCLARININ ADRESI - BAGLANTI TESTLERI.
//
// KOK NEDEN (olculdu 2026-08-31): bu iki modul paymaster adresini
// `configStore().bundlerBase`den okuyordu. O deger BASKA BIR SUNUCU:
//
//   api.extension.watswallet.com  /getTokenDataById 200 · /bundler/auth 500
//                                 /rpc/56 500 · /paymaster/status 404 · /health 404
//   bundler.watswallet.com        /paymaster/status 200 · /health 200
//                                 digerleri 404
//
// Yani `bundlerBase` Pimlico proxy'sinin adresi ve KENDI tuketicileri
// (bundlerAuth.js, smartAccount.js) icin DOGRU. Yanlis olan, TON ucret
// yolunun onu paymaster sanmasiydi: her cagri 404 aliyordu ve ozellik
// production'da hic calismiyordu.
//
// Birim testleri bunu goremezdi - ikisi de adresi mockluyor. Yakalanabilecek
// tek yer kaynak metni.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const codeOnly = (src) => src
    .split('\n')
    .filter((line) => {
        const t = line.trim()
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')

const MODULES = {
    'tonFeeStatus.js': codeOnly(read('./tonFeeStatus.js')),
    'tonFeeClient.js': codeOnly(read('./tonFeeClient.js')),
}

const CONFIG = codeOnly(read('./tonFeeConfig.js'))
const ATS_CONFIG = codeOnly(read('../atsConfig.js'))

describe.each(Object.entries(MODULES))('%s', (_name, SRC) => {
    it('adresi tonFeePaymasterBase ten alir', () => {
        expect(SRC).toContain("import { tonFeePaymasterBase } from './tonFeeConfig'")
        expect(SRC).toContain('const base = tonFeePaymasterBase()')
    })

    // HATANIN TA KENDISI.
    it('bundlerBase OKUMAZ - o Pimlico proxy sinin adresi', () => {
        expect(SRC).not.toContain('bundlerBase')
    })

    // Ikinci bir kaynak, birinin guncellenip digerinin unutulmasi demek.
    it('host metnini KOPYALAMAZ', () => {
        expect(SRC).not.toContain('watswallet.com')
    })
})

describe('cozucu tek kaynaktan okur', () => {
    it('tonFeePaymasterBase atsConfig ten gelir', () => {
        expect(CONFIG).toContain("import { ATS_COLLECTOR, getAtsSourceConfig } from '../atsConfig'")
        expect(CONFIG).toContain('getAtsSourceConfig()?.backendBase')
    })

    // Adres tonFeeConfig'te de kopyalanmamali - kural ATS_COLLECTOR ile ayni.
    it('tonFeeConfig host metnini KOPYALAMAZ', () => {
        const code = CONFIG.split('\n').filter(l => !l.includes('watswallet.com ->')).join('\n')
        expect(code).not.toMatch(/['"`]https:\/\/[a-z.]*watswallet\.com/)
    })

    // Yapilandirma yoksa `undefined/paymaster/status` gibi bir URL uretmek,
    // hatayi ag katmaninda anlasilmaz bir yere tasirdi.
    it('adres cozulemezse FIRLATIR', () => {
        expect(CONFIG).toContain("throw new Error('TON_FEE_BASE_MISSING')")
    })

    it('adresin TEK evi atsConfig', () => {
        expect(ATS_CONFIG).toContain("const BACKEND_BASE = 'https://bundler.watswallet.com'")
    })
})
