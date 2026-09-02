import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Yedi cagiranin da testnet bayragini GECMESI sart. Biri unutulursa o ekran
// testnet'te mainnet adresini gosterir ve kullanici yanlis agdan gonderir.
const FILES = [
    '../../components/Home.vue',
    '../../components/Send.vue',
    '../../components/Token.vue',
    '../../components/History.vue',
    '../../components/Header.vue',
    '../../components/ConfirmTransaction.vue',
    '../../components/popups/Receive.vue',
]

describe('ensureTonAddress cagiranlari testnet bayragini gecer', () => {
    it.each(FILES)('%s', (rel) => {
        const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
        const call = src.indexOf('ensureTonAddress(')
        expect(call).toBeGreaterThan(-1)
        // Cagriyi izleyen 200 karakter icinde testnet bayragi gecmeli.
        expect(src.slice(call, call + 200)).toContain('testnet')
    })
})


// TON'a kilitli hesapta `account.address` / `user.address` ZATEN TON adresidir
// (spec §5). O deger `buildAddressRows`a `evmAddress` olarak verilirse fonksiyon
// AYNI UQ... dizesini iki kez dondurur: biri "TON", digeri "EVM" etiketiyle.
// Al ekrani bunun uzerine "EVM uyumlu aglardan varlik gonderin" yazan EVM
// etiketli bir QR basar.
//
// useDisplayAddress.js'in bas yorumu bu kurali PAZARLIK DISI ilan ediyor ve
// sebebini de yaziyor: iki adres yan yana dururken bir satirin yanlis adresi
// tasimasi, tek adres gosteren ekrandan DAHA tehlikelidir - kullanici etikete
// guvenip o zincirden gonderir ve varlik KALICI OLARAK KAYBOLUR.
describe('buildAddressRows cagiranlari TON hesabinda EVM satirini BOS birakir', () => {
    const CALLERS = [
        ['../../components/Header.vue', 'activeAccount.value'],
        ['../../components/popups/Receive.vue', 'user.address'],
    ]

    it.each(CALLERS)('%s isTonOnlyAccount kapisindan gecirir', (rel) => {
        const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

        // Kapi `buildAddressRows` CAGRISININ ICINDE olmali: dosyanin baska bir
        // yerinde isTonOnlyAccount kullanilmasi (Header zaten kullaniyor) bu
        // satirin korunmasi anlamina gelmez.
        const call = src.slice(src.indexOf('buildAddressRows({'))
        const args = call.slice(0, call.indexOf('}))'))

        const evmLine = args.split('\n').find((l) => l.includes('evmAddress:'))
        expect(evmLine, 'evmAddress satiri bulunamadi').toBeDefined()
        expect(evmLine).toContain('isTonOnlyAccount')
    })

    it.each(CALLERS)('%s ham adresi KOSULSUZ vermez', (rel, raw) => {
        const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
        const call = src.slice(src.indexOf('buildAddressRows({'))
        const args = call.slice(0, call.indexOf('}))'))
        const evmLine = args.split('\n').find((l) => l.includes('evmAddress:'))

        // Eski hali: `evmAddress: user.address,` / `evmAddress: activeAccount.value?.address,`
        expect(evmLine.trim()).not.toMatch(new RegExp(`^evmAddress:\\s*${raw.replace('.', '\\.')}`))
    })

    it.each(CALLERS)('%s isTonOnlyAccount i accountKind ten ice aktarir', (rel) => {
        const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
        expect(src).toMatch(/import\s*\{[^}]*\bisTonOnlyAccount\b[^}]*\}\s*from\s*['"][^'"]*accountKind['"]/)
    })

    // TON satirinin EVM adresine dusmedigi zaten useDisplayAddress.test.js'te
    // olculuyor; burada olculen sey KARSIT yon - kapi ters cevrilirse (TON
    // hesabinda EVM adresi verilip sıradan hesapta null verilirse) sıradan
    // kullanicilarin EVM satiri bosalirdi.
    it.each(CALLERS)('%s sıradan hesapta EVM adresini HALA verir', (rel, raw) => {
        const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
        const call = src.slice(src.indexOf('buildAddressRows({'))
        const args = call.slice(0, call.indexOf('}))'))
        const evmLine = args.split('\n').find((l) => l.includes('evmAddress:'))
        expect(evmLine).toContain(raw)
    })

    // Yukaridaki iddialarin TAMAMI, EVM satirini sonsuza kadar "Hazirlaniyor…"da
    // birakan hatali sürümde de GECIYORDU: hepsi `evmAddress`in null OLDUGUNU
    // olcuyor, kullanicinin o null'i nasil GORDUGUNU degil.
    //
    // Eksik olan bilgi cagirandaydi: "bu hesabin EVM adresi yok" ile "adres henuz
    // turetilmedi" ayni deger olarak geciliyordu. Saf katman artik ikisini ayirt
    // edebiliyor (evmSupported) ama bunu ancak cagiran SOYLERSE - o yuzden
    // soyledigi burada kilitleniyor.
    it.each(CALLERS)('%s evmSupported i isTonOnlyAccount a baglar', (rel) => {
        const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
        const call = src.slice(src.indexOf('buildAddressRows({'))
        const args = call.slice(0, call.indexOf('}))'))

        const line = args.split('\n').find((l) => l.includes('evmSupported:'))
        expect(line, 'evmSupported satiri bulunamadi').toBeDefined()
        expect(line).toContain('isTonOnlyAccount')
        // Sabit bir deger (`evmSupported: true`) bayragi susturur ve hata geri gelir.
        expect(line).not.toMatch(/evmSupported:\s*(true|false)\s*,?\s*$/)
    })
})
