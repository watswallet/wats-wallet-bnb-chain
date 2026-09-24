import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Header.vue SSR harness'iyle (test-utils/ssrRender.js) MOUNT EDILEMIYOR:
// chrome.tabs.query, AtsFuelPill'in kendi ag turu, `immediate: true` watch'lari
// ve document dinleyicileri harness'in stub'larinin disinda kaliyor. Bu depoda
// boyle dosyalar icin yerlesik kalip KAYNAK TARAMASIDIR (tonFlowWiring.test.js,
// swapWiring.test.js, assetRouteWiring.test.js).
//
// SINIR ACIK: bu dosya kapinin YAZILDIGINI kilitler, CALISTIGINI degil.
// Davranis iki yerde olculuyor: yuklem accountKind.test.js'te (saf),
// ve AYNI filtrenin gercekten render edilen ikizi
// components/settings/DappPermissions.ssr.test.js'te.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const HEADER = read('../components/Header.vue')

describe('Header dapp izin modali yalniz EVM hesaplarini listeler (R4)', () => {
    it('izin listesi ham `accounts` yerine dappEvmAccounts uzerinde doner', () => {
        expect(HEADER).toContain('v-for="acc in dappEvmAccounts"')
        expect(HEADER).not.toContain('v-for="acc in accounts"')
    })

    it('dappEvmAccounts accountHasEvm ile suzulur', () => {
        expect(HEADER).toContain('const dappEvmAccounts = computed(() => accounts.value.filter(accountHasEvm))')
    })

    // R1 kurali (gorev 5 baglami): Header.vue'nun accountKind import satiri
    // birden fazla gorevin ORTAK satiridir ve HICBIRI onu YENIDEN YAZMAZ, yalniz
    // ihtiyaci olan sembolu var olan listeye EKLER. Bu gorev geldiginde
    // `accountHasEvm` zaten listedeydi (Gorev 1/3/4 eklemisti) -- burada
    // eklenecek YENI bir sembol yok, yalnizca VAR OLAN satirin degismedigi
    // kilitleniyor.
    //
    // GUNCELLEME (2026-09-10 Gorev 4, accountKindOf/isTonOnlyAccount temizligi):
    // ayni satirdan `accountKindOf` ve `isTonOnlyAccount` KALDIRILDI -- kod
    // tabaninda bu iki sembolun HICBIR kullanimi kalmadigi icin import da
    // dusuruldu. R1'in "satir YENIDEN YAZILMAZ, yalniz eklenir" kurali YAZMA
    // yonundedir; bir sembolun TUM cagiranlari kalktiginda import'tan da
    // dusurulmesi bunun ihlali degildir -- aksi halde kullanilmayan bir ithalat
    // sonsuza kadar surunurdu.
    it('accountHasEvm/accountHasTon/chainsForAccount accountKind.js ten ithal edilir (kalan uc sembol)', () => {
        expect(HEADER).toContain("import { accountHasEvm, accountHasTon, accountShowsEvmRow, chainsForAccount } from '../utils/accountKind'")
        expect(HEADER).not.toContain('accountKindOf')
        expect(HEADER).not.toContain('isTonOnlyAccount')
    })

    // KRITIK NEGATIF IDDIA: ham `accounts` dizisi SUZULMEZ. Ayni diziyi
    // groupedAccounts (-> hesap DEGISTIRICI) da tuketiyor; diziyi kaynaginda
    // suzmek TON hesabini degistiriciden de silerdi ve kullanici kendi TON
    // cuzdanina BIR DAHA gecemezdi. Filtre listede, kaynakta DEGIL.
    it('ham `accounts` dizisi suzulmez -- hesap degistirici TON hesabini gormeye devam eder', () => {
        expect(HEADER).toContain('accounts.value.push(acc)')
        expect(HEADER).toContain('accounts.value.forEach(acc => {')
    })

    // Diskteki ESKI bir `UQ...` kaydi editableAccounts'a yuklenip aynen geri
    // yaziliyordu: listeyi suzmek tek basina YETMEZ, YAZAN satir da suzulmeli.
    //
    // GUNCELLEME (FIX 5, fix dalgasi): suzgec artik `(a) => typeof a === 'string'
    // && a.startsWith('0x')` diye BURADA yeniden yazilmiyor; `isEvmDappAddress`
    // dappFunctions.js'ten ice aktariliyor. Iddia hala AYNI seyi kilitliyor
    // (diske yalniz 0x onekli adres yazilir), yalniz artik ithal edilen
    // sembolun adiyla.
    it('savePermissions diske yalniz 0x onekli adres yazar', () => {
        expect(HEADER).toContain('dapps[hostname].accounts = editableAccounts.value.filter(isEvmDappAddress)')
        expect(HEADER).not.toContain('dapps[hostname].accounts = [...editableAccounts.value]')
    })

    it('isEvmDappAddress dappFunctions.js ten ithal edilir', () => {
        expect(HEADER).toMatch(/import\s*\{[^}]*\bisEvmDappAddress\b[^}]*\}\s*from\s*['"][^'"]*dappFunctions['"]/)
    })
})

// FIX 5 -- `isEvmDappAddress` UC BAGIMSIZ KOPYA olarak yasiyordu:
// dappFunctions.js:166, Header.vue:810, DappPermissions.vue:258. Uc yazicinin
// biri sessizce sapabilirdi (ornegin '0X' gibi bir yazim varyasyonu) ve
// R4'un "0x suzgeci" garantisi ozellikle boyle bir sapmaya karsi. Tanim artik
// TEK yerde (dappFunctions.js); iki bilesen onu ITHAL EDER, YENIDEN YAZMAZ.
describe('isEvmDappAddress TEK yerde tanimlanir', () => {
    const DAPP_FUNCTIONS = read('./dappFunctions.js')
    const DAPP_PERMISSIONS = read('../components/settings/DappPermissions.vue')

    const DEFINITION = /(?:export\s+)?const\s+isEvmDappAddress\s*=/g

    it('tanim yalnizca dappFunctions.js icinde gecer', () => {
        expect(DAPP_FUNCTIONS.match(DEFINITION) || []).toHaveLength(1)
        expect(HEADER).not.toMatch(DEFINITION)
        expect(DAPP_PERMISSIONS).not.toMatch(DEFINITION)
    })

    it('dappFunctions.js kendi tanimini export eder', () => {
        expect(DAPP_FUNCTIONS).toContain('export const isEvmDappAddress =')
    })

    it('DappPermissions.vue de ayni sembolu ithal eder ve kullanir', () => {
        expect(DAPP_PERMISSIONS).toMatch(/import\s*\{[^}]*\bisEvmDappAddress\b[^}]*\}\s*from\s*['"][^'"]*dappFunctions['"]/)
        expect(DAPP_PERMISSIONS).toContain('dapps[dAppName].accounts = editableAccounts.value.filter(isEvmDappAddress)')
    })
})
