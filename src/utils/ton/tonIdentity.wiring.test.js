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

    // GUNCELLEME (2026-09-10, inceleme turu 2, Critical 1): Header.vue ve
    // Receive.vue artik AYNI IFADEYI kullanmiyor. Header.vue'da `evmAddress`
    // (bulunamazsa) `activeAccount.value?.address`e duser -- `activeAccount`
    // null iken bu zaten `undefined`dir, sizinti YOK, dogrudan tip kontrolu
    // yeterli. Receive.vue'da ise dusulen deger `user.address` -- AYRI bir
    // Pinia store alani ve `activeAccount` (yerel ref) null iken bile HAZIR.
    // Dogrudan tip kontrolu (`activeAccount.value?.type !== 'ton'`) orada
    // `undefined !== 'ton' === true` verip hesap COZULMEDEN `user.address`i
    // sizdiriyordu (Critical 1).
    //
    // 2026-09-11 (final inceleme): ilk duzeltme `accountHasEvm` kullaniyordu ve
    // o FAIL-CLOSED -- `type` alani olmayan ESKI bir kayitta EVM satiri tumden
    // kalkiyor, kullanici kendi alis adresini goremiyordu. Ikisi artik ORTAK
    // `accountShowsEvmRow`u soruyor: fail-open ama `type:'ton'` yine gizli,
    // yani Critical 1'in kapattigi sizinti ACILMIYOR (asagidaki ikinci testin
    // kilitledigi sey tam da bu: ham adres KOSULSUZ verilmiyor).
    it.each(CALLERS)('%s hesap TURU/accountHasEvm kapisindan gecirir', (rel) => {
        const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

        // Kapi `buildAddressRows` CAGRISININ ICINDE olmali: dosyanin baska bir
        // yerinde hesap turu kontrolu kullanilmasi (Header zaten kullaniyor) bu
        // satirin korunmasi anlamina gelmez.
        const call = src.slice(src.indexOf('buildAddressRows({'))
        const args = call.slice(0, call.indexOf('}))'))

        const evmLine = args.split('\n').find((l) => l.includes('evmAddress:'))
        expect(evmLine, 'evmAddress satiri bulunamadi').toBeDefined()
        expect(evmLine).toMatch(/type\s*(===|!==)\s*'ton'|accountHasEvm\(|accountShowsEvmRow\(/)
        expect(evmLine).not.toContain('isTonOnlyAccount')
    })

    it.each(CALLERS)('%s ham adresi KOSULSUZ vermez', (rel, raw) => {
        const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
        const call = src.slice(src.indexOf('buildAddressRows({'))
        const args = call.slice(0, call.indexOf('}))'))
        const evmLine = args.split('\n').find((l) => l.includes('evmAddress:'))

        // Eski hali: `evmAddress: user.address,` / `evmAddress: activeAccount.value?.address,`
        // -- raw ifade DOGRUDAN (bir kosul olmadan) evmAddress'e atanmis olurdu.
        expect(evmLine.trim()).not.toMatch(new RegExp(`^evmAddress:\\s*${raw.replace('.', '\\.')}\\s*,?\\s*$`))
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
    it.each(CALLERS)('%s evmSupported i hesap TURUNE/accountHasEvm e baglar', (rel) => {
        const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
        const call = src.slice(src.indexOf('buildAddressRows({'))
        const args = call.slice(0, call.indexOf('}))'))

        const line = args.split('\n').find((l) => l.includes('evmSupported:'))
        expect(line, 'evmSupported satiri bulunamadi').toBeDefined()
        expect(line).toMatch(/type\s*(===|!==)\s*'ton'|accountHasEvm\(|accountShowsEvmRow\(/)
        expect(line).not.toContain('isTonOnlyAccount')
        // Sabit bir deger (`evmSupported: true`) bayragi susturur ve hata geri gelir.
        expect(line).not.toMatch(/evmSupported:\s*(true|false)\s*,?\s*$/)
    })
})

// AKTIF AGDAN BAGIMSIZ KOSAN IKI CAGRI NOKTASI.
//
// Diger sekiz `ensureTonAddress` cagrisi aktif zincir TON iken kosuyor ve hesap
// suzgeci (accountSupportsChain) onlari EVM hesabinda zaten erisilemez kiliyor.
// BU IKISI oyle DEGIL: Header'in watch'i `immediate: true` ve AG KOSULU YOK,
// Receive'in onMounted'i ise yalnizca `vm !== 'solana'` diye soruyor. Kapisiz
// kalirlarsa her EVM kullanicisi HER hesap degisiminde TON_ACCOUNT_REQUIRED
// uretir - yakalanan ama gurultulu bir hata, ustelik her seferinde.
describe('ag-bagimsiz iki cagri noktasi HESAP kapisindan gecer', () => {
    const GATED = [
        '../../components/Header.vue',
        '../../components/popups/Receive.vue',
    ]

    it.each(GATED)('%s accountHasTon i accountKind ten ice aktarir', (rel) => {
        const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
        expect(src).toMatch(/import\s*\{[^}]*\baccountHasTon\b[^}]*\}\s*from\s*['"][^'"]*accountKind['"]/)
    })

    // SIRA: kapi CAGRIDAN ONCE gelmeli. Sonra konursa turetme yine calisir ve
    // kapi hicbir sey korumaz. (Import satirlarinda parantez YOK, o yuzden
    // `indexOf('...(')` gercekten CAGRIYI buluyor.)
    it.each(GATED)('%s hesap kapisi ensureTonAddress CAGRISINDAN once gelir', (rel) => {
        const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
        const gate = src.indexOf('accountHasTon(')
        const call = src.indexOf('ensureTonAddress(')
        expect(gate, 'accountHasTon cagrisi bulunamadi').toBeGreaterThan(-1)
        expect(call).toBeGreaterThan(gate)
    })

    // Kapinin TERS CEVRILMEMIS oldugu ayri ayri kilitleniyor: alt-dize eslesmesi
    // basindaki `!` isaretini FARK ETMEZ ve tersine cevrilmis bir kapi (TON
    // hesabinda turetmeyi ATLAYIP EVM hesabinda calistiran) yukaridaki iki
    // iddiayi da GECERDI. Iki dosyanin kapi bicimi farkli oldugu icin ayri yazildi.
    it('Header watch i TON cuzdani olmayan hesapta ERKEN DONER', () => {
        const src = readFileSync(fileURLToPath(new URL('../../components/Header.vue', import.meta.url)), 'utf8')
        expect(src).toMatch(/if \(!accountHasTon\(activeAccount\.value\)\) return/)
    })

    it('Receive onMounted i turetmeyi YALNIZCA TON cuzdani olan hesapta yapar', () => {
        const src = readFileSync(fileURLToPath(new URL('../../components/popups/Receive.vue', import.meta.url)), 'utf8')
        expect(src).toMatch(/if \(accountHasTon\(active_account\) && vm\.value !== 'solana'\)/)
    })
})
