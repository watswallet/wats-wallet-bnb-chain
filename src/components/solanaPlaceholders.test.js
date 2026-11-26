// K3: Solana yer tutucu metinleri.
//
// KOK NEDEN: Send/ImportToken/AddAddress/EditAddress Solana'da ya `0x...` gosteriyordu
// (Send) ya da cevrilmemis, sabit Ingilizce 'Base58 address...' / 'Mint address...'
// dizelerini (diger uc ekran). Bu test hem bu dizelerin geri gelmesini hem de dort yeni
// anahtarin 12 dilin HEPSINDE dolu olmasini kilitler. PrivateTransfer.vue bilerek
// kapsam disidir (`0x...` kalir).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SUPPORTED_LANGS } from '../i18n/languages'
import { yorumsuz } from '../test-utils/kaynakTarama.js'

const oku = (yol) => readFileSync(fileURLToPath(new URL(yol, import.meta.url)), 'utf8')
const kaynak = (yol) => yorumsuz(oku(yol))

const DOSYALAR = {
    send: '../components/Send.vue',
    importToken: '../components/ImportToken.vue',
    addAddress: '../components/settings/addresses/AddAddress.vue',
    editAddress: '../components/settings/addresses/EditAddress.vue',
}

const ANAHTARLAR = [
    'send.placeholder_address_solana',
    'importToken.custom.placeholder_mint',
    'settings.addresses.addAddress.placeholder_solana',
    'settings.addresses.editAddress.placeholder_solana',
]

const deger = (obj, yol) => yol.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)

describe('K3: Solana yer tutucu kaynak taramasi', () => {
    for (const [ad, yol] of Object.entries(DOSYALAR)) {
        it(`${ad}: sabit Ingilizce 'Base58 address...' / 'Mint address...' yok`, () => {
            const k = kaynak(yol)
            expect(k).not.toContain('Base58 address...')
            expect(k).not.toContain('Mint address...')
        })
    }

    it('Send: TON -> ton anahtari, Solana -> solana anahtari, EVM -> 0x...', () => {
        const k = kaynak(DOSYALAR.send)
        const m = k.match(/:placeholder="([^"]*placeholder_address_ton[^"]*)"/)
        expect(m, 'Send adres alaninda placeholder baglamasi bulunamadi').not.toBeNull()
        const ifade = m[1].replace(/\s+/g, ' ')
        expect(ifade).toContain("$t('send.placeholder_address_solana')")
        expect(ifade).toContain("$t('send.placeholder_address_ton')")
        expect(ifade).toContain("'0x...'")
        // sira: once TON, sonra Solana, sonra EVM varsayilani
        expect(ifade).toMatch(
            /isTonNetwork \? \$t\('send\.placeholder_address_ton'\) : vm === 'solana' \? \$t\('send\.placeholder_address_solana'\) : '0x\.\.\.'/,
        )
    })

    it('ImportToken: Solana mint yer tutucusu anahtardan, EVM 0x...', () => {
        const k = kaynak(DOSYALAR.importToken)
        expect(k).toMatch(
            /:placeholder="vm === 'solana' \? \$t\('importToken\.custom\.placeholder_mint'\) : '0x\.\.\.'"/,
        )
    })

    for (const ad of ['addAddress', 'editAddress']) {
        it(`${ad}: Solana yer tutucusu anahtardan, EVM 0x...`, () => {
            const k = kaynak(DOSYALAR[ad])
            expect(k).toContain(
                `:placeholder="vm === 'solana' ? $t('settings.addresses.${ad}.placeholder_solana') : '0x...'"`,
            )
        })
    }

    it('PrivateTransfer.vue dokunulmamis: 0x... duruyor', () => {
        expect(kaynak('../components/privacy/PrivateTransfer.vue')).toContain('0x...')
    })
})

describe('K3: yeni anahtarlar 12 dilde dolu', () => {
    it('SUPPORTED_LANGS 12 dil', () => {
        expect(SUPPORTED_LANGS).toHaveLength(12)
    })

    for (const dil of SUPPORTED_LANGS) {
        it(`${dil}: 4 anahtar var, bos degil, ham anahtar yolu degil`, () => {
            const sozluk = JSON.parse(oku(`../i18n/locales/${dil}.json`))
            for (const a of ANAHTARLAR) {
                const v = deger(sozluk, a)
                expect(typeof v, `${dil} ${a}`).toBe('string')
                expect(v.trim().length, `${dil} ${a} bos`).toBeGreaterThan(0)
                expect(v, `${dil} ${a} ham anahtar`).not.toBe(a)
                expect(v, `${dil} ${a} 0x icermez`).not.toContain('0x')
            }
        })
    }
})
