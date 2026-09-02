// ImportToken.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN (Task 16b): ekran `ethers.isAddress` ile kapida duruyordu, yani
// Solana'da bir SPL mint'i HICBIR ZAMAN ice aktarilamiyordu. Karar mantigi
// (utils/solana/importToken.js) AYRI ve kapsamli test edildi; burasi
// BILESENIN `import_token()` yazma tarafini (kova anahtari, ondalik tasima,
// harf kasasi, tekillestirme) dogrular.
//
// KAPSAM DISI (bilerek): `watch(ca, ...)` -- yani "kullanici yazdikca hangi
// dogrulama cagrilir" telinin KENDISI -- bu harness'te DENENEMEZ. Vue, SSR
// render'i sirasinda setup() icinde olusturulan (immediate:true OLMAYAN,
// flush:'sync' OLMAYAN) watcher'lara GERCEK bir efekt bile KURMAZ
// (isInSSRComponentSetup + doWatch, @vue/runtime-core) -- HATTA `flush:'sync'`
// ile zorlansa bile @vue/server-renderer `renderToString` sonunda TOPLADIGI
// butun senkron watcher'lari (`context.__watcherHandles`) ACIKCA `unwatch()`
// eder (renderToString bir kerelik String ciktisidir, kalici bir abonelik
// birakmak SIZINTI olurdu). Yani `ca`ya render()'DAN ONCE ya da SONRA
// yazmanin HICBIR FARKI yok: iki durumda da watcher CALISMAZ -- deneyle
// dogrulandi (bkz. task-16b-report.md). Bu, `watch` kullanan HERHANGI bir
// bilesen icin gecerli bir SSR sinirlamasidir, bu goreve ozgu degil.
// `vm.value === 'solana'` dallanmasi (hangi dogrulayicinin cagrildigi, format
// on kontrolu) bu yuzden yalniz KOD INCELEMESIYLE dogrulanmistir; asagidaki
// testler `import_token()`in KENDISINE (watcher'in DOLDURDUGU ayni state'i
// dogrudan yazarak) odaklanir.
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import ImportToken from './ImportToken.vue'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

afterEach(() => {
    delete globalThis.chrome
})

function setup(chainRecord, seedState) {
    const chromeStub = installChromeStub({ active_account: { key: 'acc-1' } })
    const app = createApp(ImportToken)
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord

    // Watcher SSR'da calismaz (bkz. dosya basi notu): "dogrulama SONUCU"
    // durumu, `onCapture` icinde (render()'dan ONCE, senkron) DOGRUDAN yazilir
    // -- tam olarak `watch(ca,...)`in basari dalinin YAZACAGI degerler.
    const captured = captureInstance(app, 'ImportToken', (instance) => {
        if (seedState) Object.assign(instance.setupState, seedState)
    })
    return { app, captured, chromeStub }
}

describe('ImportToken.vue (SSR) -- EVM REGRESYONU: import_token() davranisi degismedi', () => {
    it('ice aktarilan EVM tokeni ESKI kova (network.currentNetwork.chainId, SAYI) ile kaydedilir', async () => {
        const ADDR = '0xabcdef0000000000000000000000000000000001'
        const { app, captured, chromeStub } = setup(ETH_CHAIN, {
            ca: ADDR, isValid: true, name: 'Fake Token', symbol: 'FAKE', decimals: 18,
            image: null, chain: null, id: null,
        })
        await render(app)

        await captured.instance.setupState.import_token()

        expect(chromeStub.localStore.imported_tokens['acc-1'][1]).toEqual([
            { name: 'Fake Token', symbol: 'FAKE', decimals: 18, address: ADDR, image: { thumb: '', small: '', large: '' }, chain: null, coingecko_id: null },
        ])
    })

    it('ayni EVM adresi (KUCUK/BUYUK harf farkli) IKI KEZ eklenmez -- ESKI davranis (kucultup karsilastirma)', async () => {
        const ADDR = '0xabcdef0000000000000000000000000000000001'
        const { app, captured, chromeStub } = setup(ETH_CHAIN, {
            ca: ADDR.toUpperCase().replace('0X', '0x'), isValid: true, name: 'Fake', symbol: 'FAKE', decimals: 18,
            image: null, chain: null, id: null,
        })
        chromeStub.localStore.imported_tokens = { 'acc-1': { 1: [{ address: ADDR, name: 'Fake', symbol: 'FAKE', decimals: 18 }] } }
        await render(app)

        await captured.instance.setupState.import_token()

        expect(chromeStub.localStore.imported_tokens['acc-1'][1]).toHaveLength(1)
        expect(captured.instance.setupState.errorMessage).toBe('This token is already in your list')
    })
})

describe('ImportToken.vue (SSR) -- Solana da SPL mint import_token() ile dogru sekilde kaydedilir (Task 16b)', () => {
    it('bilinen (metadata BULUNAN) bir SPL tokeni "solana-mainnet" (METIN) kovasina yazilir', async () => {
        const { app, captured, chromeStub } = setup(SOLANA_CHAIN, {
            ca: MINT, isValid: true, known: true, resolvedMint: MINT,
            name: 'USD Coin', symbol: 'usdc', decimals: 6, image: { thumb: '', small: '', large: '' }, id: 'usd-coin',
        })
        await render(app)

        await captured.instance.setupState.import_token()

        const bucket = chromeStub.localStore.imported_tokens['acc-1']['solana-mainnet']
        expect(bucket).toEqual([
            { name: 'USD Coin', symbol: 'usdc', decimals: 6, address: MINT, image: { thumb: '', small: '', large: '' }, coingecko_id: 'usd-coin' },
        ])
        // Kova anahtari METIN kalir -- Number('solana-mainnet') NaN'dir, EVM
        // kovasiyla ('1' sayisi) KARISMAMALI.
        expect(chromeStub.localStore.imported_tokens['acc-1'][1]).toBeUndefined()
        expect(Object.keys(chromeStub.localStore.imported_tokens['acc-1'])).toEqual(['solana-mainnet'])
    })

    // BULGU (Task 16a): metadata'siz bir SPL satiri onceden Send'de native SOL'e
    // donusuyordu. Buradaki kok neden ONDALIK EKSIKLIGIYDI -- resolveMintForImport
    // ondaliksiz bir kaydi zaten reddediyor (importToken.test.js), yani buraya
    // ULASAN her `known:false` kaydin decimals'i DOLU olmak ZORUNDA. Bu test
    // COMPONENT'in o degeri KAYBETMEDEN yazdigini dogrular.
    it('bilinmeyen (metadata BULUNAMAYAN) bir token da decimals ile birlikte kaydedilir', async () => {
        const { app, captured, chromeStub } = setup(SOLANA_CHAIN, {
            ca: MINT, isValid: true, known: false, resolvedMint: MINT,
            name: 'EPjF...Dt1v', symbol: 'EPjF...Dt1v', decimals: 5, image: { thumb: '', small: '', large: '' }, id: null,
        })
        await render(app)

        await captured.instance.setupState.import_token()

        const bucket = chromeStub.localStore.imported_tokens['acc-1']['solana-mainnet']
        expect(bucket[0].decimals).toBe(5)
        expect(bucket[0].coingecko_id).toBe(null)
        expect(bucket[0].name).toBe('EPjF...Dt1v')
    })

    it('harf kasasi BIREBIR korunarak yazilir (kucultulmez)', async () => {
        const { app, captured, chromeStub } = setup(SOLANA_CHAIN, {
            ca: MINT, isValid: true, known: true, resolvedMint: MINT,
            name: 'USD Coin', symbol: 'usdc', decimals: 6, image: null, id: 'usd-coin',
        })
        await render(app)

        await captured.instance.setupState.import_token()

        const bucket = chromeStub.localStore.imported_tokens['acc-1']['solana-mainnet']
        expect(bucket[0].address).toBe(MINT)
        expect(bucket[0].address).not.toBe(MINT.toLowerCase())
    })

    it('ayni mint (harf kasasi FARKLI) IKI FARKLI KAYIT sayilir -- kucultup karsilastirilmaz', async () => {
        const { app, captured, chromeStub } = setup(SOLANA_CHAIN, {
            ca: MINT, isValid: true, known: true, resolvedMint: MINT,
            name: 'USD Coin', symbol: 'usdc', decimals: 6, image: null, id: 'usd-coin',
        })
        chromeStub.localStore.imported_tokens = {
            'acc-1': { 'solana-mainnet': [{ address: MINT.toLowerCase(), name: 'baska', symbol: 'baska', decimals: 6 }] },
        }
        await render(app)

        await captured.instance.setupState.import_token()

        // MINT.toLowerCase() ZATEN listede, ama BIREBIR MINT (farkli harf
        // kasasi) AYNI kayit sayilmaz -- base58 harf kasasi duyarlidir.
        expect(chromeStub.localStore.imported_tokens['acc-1']['solana-mainnet']).toHaveLength(2)
    })

    it('ayni mint AYNEN tekrar eklenmeye calisilirsa reddedilir', async () => {
        const { app, captured, chromeStub } = setup(SOLANA_CHAIN, {
            ca: MINT, isValid: true, known: true, resolvedMint: MINT,
            name: 'USD Coin', symbol: 'usdc', decimals: 6, image: null, id: 'usd-coin',
        })
        chromeStub.localStore.imported_tokens = {
            'acc-1': { 'solana-mainnet': [{ address: MINT, name: 'USD Coin', symbol: 'usdc', decimals: 6 }] },
        }
        await render(app)

        await captured.instance.setupState.import_token()

        expect(chromeStub.localStore.imported_tokens['acc-1']['solana-mainnet']).toHaveLength(1)
        expect(captured.instance.setupState.errorMessage).toBe('This token is already in your list')
    })

    it('isValid false iken import_token() hicbir sey yazmaz', async () => {
        const { app, captured, chromeStub } = setup(SOLANA_CHAIN, {
            ca: MINT, isValid: false, resolvedMint: null,
        })
        await render(app)

        await captured.instance.setupState.import_token()

        expect(chromeStub.localStore.imported_tokens).toBeUndefined()
    })
})
