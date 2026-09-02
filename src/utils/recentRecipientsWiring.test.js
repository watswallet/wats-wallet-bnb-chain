import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// "SON GONDERDIKLERIM" BAGLANTI TESTLERI.
//
// Saf katman (recentRecipients.js) kendi dosyasinda test ediliyor. Burasi
// listenin GERCEKTEN okundugunu ve dogru elemelerle gosterildigini olcer.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const codeOnly = (src) => src
    .split('\n')
    .filter((line) => {
        const t = line.trim()
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('<!--')
    })
    .join('\n')

const BOOK = codeOnly(read('../components/popups/AddressBook.vue'))

describe('gecmis okunur ve gosterilir', () => {
    it('gonderim gecmisi depodan okunur', () => {
        expect(BOOK).toContain('getSentRecipients()')
        expect(BOOK).toContain('pickRecentRecipients(')
    })

    it('bolum listeden uretilir', () => {
        expect(BOOK).toContain('v-for="item in recent"')
        expect(BOOK).toContain('@click="selectWallet({ address: item.address, label: item.label })"')
    })

    it('liste bossa bolum HIC cizilmez', () => {
        expect(BOOK).toContain('<template v-if="recent.length">')
    })

    // Defterin bos durumu artik ucuncu bir kaynagi da hesaba katmali; yoksa
    // gecmis doluyken "adres yok" ekrani cikardi.
    it('bos durum gecmisi de hesaba katar', () => {
        expect(BOOK).toContain('wallets.length === 0 && myAccounts.length === 0 && recent.length === 0')
    })
})

describe('eleme kapilari', () => {
    it('kayitli adresler ve hesaplar elenmek uzere GECIRILIR', () => {
        const at = BOOK.indexOf('pickRecentRecipients(')
        expect(at).toBeGreaterThan(-1)
        const call = BOOK.slice(at, BOOK.indexOf('})', at) + 2)
        expect(call).toContain('savedAddresses: wallets.value')
        // AKTIF hesap dahil TUM hesaplar. `myAccounts.value` aktif hesabi
        // disliyor; onu gecirmek gonderenin kendi adresini alici olarak
        // onermek olurdu.
        expect(call).toContain('myAccounts: allAccounts')
        expect(call).not.toContain('myAccounts: myAccounts.value')
    })

    it('allAccounts aktif hesabi ELEMEDEN once alinir', () => {
        const all = BOOK.indexOf('const allAccounts = flattenVaultAccounts(vaults)')
        const filtered = BOOK.indexOf('myAccounts.value = allAccounts.filter(')
        expect(all).toBeGreaterThan(-1)
        expect(filtered).toBeGreaterThan(-1)
        expect(all).toBeLessThan(filtered)
    })

    // Bir depo hiccup'i adres secmeyi engellememeli.
    it('gecmis okunamazsa defter calismaya devam eder', () => {
        const at = BOOK.indexOf('pickRecentRecipients(')
        const tryAt = BOOK.lastIndexOf('try {', at)
        expect(tryAt).toBeGreaterThan(-1)
        expect(BOOK.slice(tryAt, at)).not.toContain('}')
    })
})

// ---------------------------------------------------------------------------
// SAF KATMANIN BICIM DAVRANISI (inceleme turu 3: ORTA-1 ve ORTA-3).
//
// Bu iddialar recentRecipients.test.js'te DEGIL burada duruyor: ikisi de
// "okuyucu, YAZICI (sentRecipients.js) ile AYNI karsilastiriciyi kullaniyor mu"
// sorusunun cevabi -- yani iki modulun BAGLANTISI. recentRecipients.test.js
// fonksiyonun kendi sozlesmesini (siralama, kirpma, bozuk kayit) olcer.
// ---------------------------------------------------------------------------
import { pickRecentRecipients } from './recentRecipients'
import { dedupeKey } from './addressForm'

const EVM = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
// AYNI harflerden olusan, YALNIZCA SON HARFIN KASASI farkli IKI GECERLI base58
// adres. Kucultuldukleri anda AYNI anahtara duserler -- gercek zincirde ise
// BIRBIRINDEN TAMAMEN FARKLI iki cuzdandir.
const SOL_A = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const SOL_TWIN = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWm'
const SOL_OTHER = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

const sent = (address, lastSentAt = 1, count = 1, label = null) => ({ address, lastSentAt, count, label })

describe('base58 adresler KUCULTULMEZ (yazici ile ayni karsilastirici)', () => {
    // Test verisi gercekten iddia ettigi seyi olcuyor mu: iki adres SAHIDEN
    // farkli ve SAHIDEN yalnizca kasada ayrisiyor.
    it('olcum onkosulu: ikiz adresler farkli ama kucultulunce ayni', () => {
        expect(SOL_A).not.toBe(SOL_TWIN)
        expect(SOL_A.toLowerCase()).toBe(SOL_TWIN.toLowerCase())
        expect(dedupeKey(SOL_A)).not.toBe(dedupeKey(SOL_TWIN))
    })

    it('kasasi farkli IKI base58 alici tekillemede BIRLESMEZ', () => {
        const out = pickRecentRecipients([sent(SOL_A, 9), sent(SOL_TWIN, 5)])
        expect(out.map(r => r.address)).toEqual([SOL_A, SOL_TWIN])
    })

    it('kayitli bir base58 adres, kasasi farkli BASKA bir aliciyi ELEMEZ', () => {
        const out = pickRecentRecipients([sent(SOL_TWIN, 9)], { savedAddresses: [{ address: SOL_A }] })
        expect(out.map(r => r.address)).toEqual([SOL_TWIN])
    })

    it('kendi hesabin base58 adresi, kasasi farkli BASKA bir aliciyi ELEMEZ', () => {
        const out = pickRecentRecipients([sent(SOL_TWIN, 9)], { myAccounts: [{ solanaAddress: SOL_A }] })
        expect(out.map(r => r.address)).toEqual([SOL_TWIN])
    })

    it('BIREBIR ayni base58 adres yine de elenir (eleme tamamen olmemis)', () => {
        const out = pickRecentRecipients([sent(SOL_A, 9)], { savedAddresses: [{ address: SOL_A }] })
        expect(out).toEqual([])
    })
})

describe('eleme kumesi hesabin TUM kimliklerini alir', () => {
    it('hesabin solanaAddress i, EVM .address i yaninda da elenir', () => {
        const out = pickRecentRecipients([sent(SOL_A, 9), sent(SOL_OTHER, 5)], {
            myAccounts: [{ name: 'Hesap 1', address: EVM, solanaAddress: SOL_A }],
        })
        expect(out.map(r => r.address)).toEqual([SOL_OTHER])
    })

    it('cagiranin sectigi aktif-ag kimligi (pickAddress) da elenir', () => {
        const out = pickRecentRecipients([sent(SOL_A, 9)], {
            myAccounts: [{ address: EVM, pickAddress: SOL_A }],
        })
        expect(out).toEqual([])
    })

    it('TON kimlikleri de elenir (tonAddress / tonAddressTestnet)', () => {
        // TON adresleri bugun addressForm.js tarafindan TANINMIYOR; bu test
        // alanin OKUNDUGUNU kilitler, boylece addressForm TON'u ogrendigi gun
        // eleme kapisi kendiliginden dogru calisir.
        const fields = ['tonAddress', 'tonAddressTestnet']
        for (const field of fields) {
            const out = pickRecentRecipients([sent(SOL_A, 9)], {
                myAccounts: [{ address: EVM, [field]: SOL_A }],
            })
            expect(out, field).toEqual([])
        }
    })

    it('EVM elemesi bozulmadi (kasa duyarsiz)', () => {
        const out = pickRecentRecipients([sent(EVM.toUpperCase(), 9)], { myAccounts: [{ address: EVM }] })
        expect(out).toEqual([])
    })
})
