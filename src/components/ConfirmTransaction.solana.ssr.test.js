// ConfirmTransaction.vue (SSR) -- Solana yolunun KIMLIK ve BELIRSIZ-YAYIN davranisi.
//
// Bu dosya IKI nihai inceleme bulgusunu kilitler:
//
//  Bulgu 5 (capraz-VM kimlik yedegi): `loadTrusted({ myAddress: ... })` cagrisi
//  `crypto.transactionData.from || user.address` yaziyordu. `user.address` bir EVM
//  (0x...) adresidir; Solana'da yedege dusulurse adres guvenligi katmanina
//  CUZDANIN KENDI ADRESI diye BASKA bir VM'in adresi verilir -- gecmis karsi
//  taraflari o adrese gore cekilir ve "kendine gonderiyorsun" uyarisi sessizce
//  olur. Send.vue:333 tam bu yedegi tasiyordu ve duzeltilmisti.
//
//  Bulgu 1 (belirsiz yayin, ARAYUZ tarafi): SOLANA_SEND `broadcastStatusUnknown`
//  dondugunde ekran "tekrar deneyin" DEMEMELI ve Onayla dugmesi bir daha
//  TIKLANABILIR OLMAMALI (kaldirilir, `disabled` yapilmaz).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Guvenlik katmani GERCEK kalir; yalnizca onun AG cagrisi saplanir. Boylece
// `myAddress`in gectigi yol (bilesen -> useAddressSecurity -> historyRecipients)
// uctan uca gercek kod olur.
const fetchHistoryCounterpartiesMock = vi.fn(async () => [])
vi.mock('../utils/historyRecipients', () => ({
    fetchHistoryCounterparties: (...args) => fetchHistoryCounterpartiesMock(...args),
}))

const prepareTransferContextMock = vi.fn(async () => ({
    blockhash: '11111111111111111111111111111111',
    feeLamports: 5000, rentExemptLamports: 890880,
    recipientAtaExists: true, ataRentLamports: 0,
}))
vi.mock('../utils/solana/send', () => ({
    prepareTransferContext: (...args) => prepareTransferContextMock(...args),
}))

const fetchSolanaAssetsMock = vi.fn(async () => ([{ mint: 'native', amount: 5, decimals: 9 }]))
vi.mock('../utils/solana/balances', () => ({
    fetchSolanaAssets: (...args) => fetchSolanaAssetsMock(...args),
}))

const axiosPostMock = vi.fn(async () => ({ status: 200, data: {} }))
const axiosGetMock = vi.fn(async () => ({ status: 200, data: {} }))
vi.mock('axios', () => ({ default: { post: (...a) => axiosPostMock(...a), get: (...a) => axiosGetMock(...a) } }))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { userStore } from '../store/user'
import { pageStore } from '../store/pageStore'
import ConfirmTransaction from './ConfirmTransaction.vue'
import supported_chains from '../data/supported_chains.json'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const SOLANA_FROM = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const SOLANA_TO = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const EVM_ADDRESS = '0xAbCdEf0000000000000000000000000000000001'

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    fetchHistoryCounterpartiesMock.mockClear()
    prepareTransferContextMock.mockClear()
    fetchSolanaAssetsMock.mockClear()
    delete globalThis.chrome
})

/**
 * Solana gonderimi ONAY ekraninda. `from` opsiyonel: Bulgu 5'in tam senaryosu,
 * `from` COZULEMEDIGI (undefined) durumda EVM adresine dusulup dusulmedigidir.
 */
async function renderConfirm({ omitFrom = false, sendResponse } = {}) {
    const stub = installChromeStub({
        currentNetwork: SOLANA_CHAIN,
        active_account: { address: EVM_ADDRESS, solanaAddress: SOLANA_FROM, key: 'acc1' },
        vaults: [],
        saved_addresses: [],
    })
    if (sendResponse) stub.setSendMessage(async () => sendResponse)

    const app = createApp(ConfirmTransaction)
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = SOLANA_CHAIN

    const user = userStore()
    user.address = EVM_ADDRESS

    const crypto = cryptoStore()
    crypto.transactionData = {
        // `omitFrom`: Send.vue `active_account?.solanaAddress` yaziyor; o alan yoksa
        // `from` ALANI HIC OLMAZ. Testte `from: undefined` GECIRMEK yetmez --
        // varsayilan parametre onu geri doldururdu.
        ...(omitFrom ? {} : { from: SOLANA_FROM }),
        to: SOLANA_TO,
        amount: '1',
        asset: 'native',
        network: SOLANA_CHAIN.name,
    }

    const captured = captureInstance(app, 'ConfirmTransaction')
    const html = await render(app)
    return { captured, html }
}

describe('ConfirmTransaction.vue (SSR) -- kimlik VM ye gore secilir (Bulgu 5)', () => {
    it('Solana da myAddress SOLANA adresidir', async () => {
        await renderConfirm()

        expect(fetchHistoryCounterpartiesMock).toHaveBeenCalled()
        const [, myAddress, chainId] = fetchHistoryCounterpartiesMock.mock.calls[0]
        expect(myAddress).toBe(SOLANA_FROM)
        expect(chainId).toBe('solana-mainnet')
    })

    // ASIL KILIT: `from` cozulemediginde EVM adresine DUSULMEZ. Eski kod
    // (`crypto.transactionData.from || user.address`) burada 0x... adresini
    // veriyordu -- baska bir VM'in kimligi.
    //
    // BIRLESME NOTU (bu iddia guncellendi, GEVSETILMEDI): bu test daha once
    // `mock.calls[0]`i okuyup `myAddress`in undefined oldugunu dogruluyordu, yani
    // cagrinin KIMLIKSIZ de olsa YAPILDIGI varsayimina dayaniyordu. TON tarafi
    // loadTrusted'a `selfAddress` kapisini ekledi: kimlik cozulemediyse gecmis
    // HIC SORULMAZ (useAddressSecurity.js; useAddressSecurity.test.js -> "onbellekli
    // TON adresi yoksa gecmis SORULMAZ"). Kilidin OZU degismedi ve zayiflamadi --
    // yedek geri gelirse cagri EVM adresiyle YAPILIR ve asagidaki iki iddia da kirilir.
    it('from cozulemezse EVM adresine DUSULMEZ', async () => {
        const { captured } = await renderConfirm({ omitFrom: true })

        expect(fetchHistoryCounterpartiesMock)
            .not.toHaveBeenCalledWith(expect.anything(), EVM_ADDRESS, expect.anything())
        // Kimlik yok -> gecmis sorgusu hic yapilmaz (yukaridaki birlesme notu).
        expect(fetchHistoryCounterpartiesMock).not.toHaveBeenCalled()

        // AYNI YEDEK EKRANDA DA YOK: imza oncesi "Gonderen" satiri capraz VM
        // adresine dusmez, adres cozulene kadar bos kalir (sablon "hazirlaniyor"
        // gosterir). Bkz. useDisplayAddress.js:pickDisplayAddress solana kolu.
        expect(captured.instance.setupState.fromAddress).not.toBe(EVM_ADDRESS)
        expect(captured.instance.setupState.fromAddress).toBeNull()
    })
})

describe('ConfirmTransaction.vue (SSR) -- BELIRSIZ yayin arayuzu (Bulgu 1)', () => {
    it('durum bilinmiyorken ekranda kalinir, Onayla dugmesi KALDIRILIR', async () => {
        const { captured } = await renderConfirm({
            sendResponse: {
                result: {
                    signature: '5'.repeat(87),
                    broadcastStatusUnknown: true,
                    broadcastError: 'SOLANA_RPC_TIMEOUT',
                },
            },
        })

        const state = captured.instance.setupState
        await state.send()

        expect(state.solanaStatusUnknown).toBe(true)
        // "Tekrar deneyin" diyen kirmizi hata karti CIKMAZ.
        expect(state.solanaSendError).toBeNull()
        // Ana ekrana da GECILMEZ: kullanici ne oldugunu okumali.
        expect(pageStore().currentPage).not.toBe('home')
    })

    it('BASARILI gonderimde ana ekrana gecilir ve dugme durur', async () => {
        const { captured } = await renderConfirm({
            sendResponse: { result: { signature: '5'.repeat(87) } },
        })

        const state = captured.instance.setupState
        await state.send()

        expect(state.solanaStatusUnknown).toBe(false)
        expect(pageStore().currentPage).toBe('home')
    })

    // Sablon TARAFI: dugme `v-if` ile KALDIRILIR, `disabled` ile degil.
    // (Ayri bir render: SSR ciktisi tek seferlik uretilir, `send()` sonrasi
    // yeniden render edilmez.)
    it('solanaStatusUnknown iken render edilen HTML de Onayla dugmesi YOKTUR', async () => {
        const app = createApp(ConfirmTransaction)
        installChromeStub({
            currentNetwork: SOLANA_CHAIN,
            active_account: { address: EVM_ADDRESS, solanaAddress: SOLANA_FROM, key: 'acc1' },
            vaults: [], saved_addresses: [],
        })
        app.use(createTestPinia())
        app.use(createTestI18n())
        networkStore().currentNetwork = SOLANA_CHAIN
        cryptoStore().transactionData = { from: SOLANA_FROM, to: SOLANA_TO, amount: '1', asset: 'native', network: SOLANA_CHAIN.name }

        // Bayrak, bilesen KENDI onServerPrefetch'ine girmeden ONCE yazilir.
        captureInstance(app, 'ConfirmTransaction', (instance) => {
            instance.setupState.solanaStatusUnknown = true
        })
        const html = await render(app)

        expect(html).toContain('Status unknown')
        expect(html).not.toContain('>Confirm<')
    })
})

// EVM REGRESYONU: yedek EVM'de AYNEN durur. Bulgu 5'in duzeltmesi VM'e gore
// dallanmak, yedegi TUMDEN kaldirmak DEGIL -- EVM'de `from` tasimayan bir cagri
// (dapp yolu) hala hesabin EVM adresine dusmeli.
describe('ConfirmTransaction.vue (SSR) -- EVM yedegi DEGISMEDI', () => {
    it('EVM de from yoksa user.address kullanilir', async () => {
        installChromeStub({
            currentNetwork: ETH_CHAIN,
            active_account: { address: EVM_ADDRESS, key: 'acc1' },
            vaults: [], saved_addresses: [],
        })

        const app = createApp(ConfirmTransaction)
        app.use(createTestPinia())
        app.use(createTestI18n())
        networkStore().currentNetwork = ETH_CHAIN
        networkStore().rpc = 'https://evm.example/rpc'
        userStore().address = EVM_ADDRESS
        cryptoStore().transactionData = {
            to: '0x1111111111111111111111111111111111111111',
            amount: '1', asset: 'native', network: ETH_CHAIN.name,
        }

        captureInstance(app, 'ConfirmTransaction')
        await render(app)

        const [, myAddress, chainId] = fetchHistoryCounterpartiesMock.mock.calls[0]
        expect(myAddress).toBe(EVM_ADDRESS)
        expect(chainId).toBe(1)
    })
})

// ============================================================================
// BIRLESME BULGUSU (denetci): "ConfirmTransaction.vue:504
//   evmAddress: crypto.transactionData.from || user.address
// dapp'ten gelen `from` gosterilir, ISLEMI IMZALAYAN hesaptan AYRISABILIR."
//
// SONUC: CURUTULDU -- dapp islemi BU EKRANI HIC ACMAZ, ayrisma URETILEMEZ:
//   - popup/main.js (DAPP_SEND_TX) ve popup/App.vue (current_request izleyicisi)
//     SEND_TX icin sayfayi 'dapp_router' yapar; o sayfa Dapp.vue'dur. Dapp'in
//     `from`unu KASALARDA arayan (findAccountByAddress), bulamazsa istegi
//     REDDEDEN (unknownSender karti) ve bulunca kanonik hesap adresini yazan
//     dogrulama ORADADIR.
//   - 'confirm_transaction' sayfasini acan TEK yer Send.vue'nun confirm()'idir
//     ve orasi `crypto.transactionData`yi KOMPLE yeniden yazar:
//         EVM    -> from: active_account.address        (depodan TAZE okunur)
//         SOLANA -> from: active_account.solanaAddress
//   - Bu ekranda IMZALAYAN da ayni kaynaktir: send() EVM dalinda SEND_TRANSACTION'i
//     depodan TAZE okunan `active_account`in index'iyle gonderir ve
//     `serializedTx.from` alanini SILER -- `from` yalnizca gas tahminine girer.
//
// Ustelik yon denetcinin sandiginin TERSIDIR: `user.address` bir DEPO AYNASIDIR
// (popup acilisinda / Header.changeAccount'ta yazilir), `transactionData.from` ise
// confirm() aninda chrome.storage'dan TAZE okunmustur. Ikisi ayrisirsa imzalayana
// yakin olan `transactionData.from`dur. Asagidaki iki test bunun OLCUMUDUR.
// ============================================================================
describe('ConfirmTransaction.vue (SSR) -- EVM Gonderen satiri (bulgu CURUTULDU)', () => {
    // Depo aynasi bayat, taze deger imzalayanin adresi: ekran TAZE olani gostermeli.
    const STALE_MIRROR = '0x9999999999999999999999999999999999999999'

    it('gosterilen Gonderen, ekranin islemi kurarken kullandigi adresle AYNIDIR', async () => {
        installChromeStub({
            currentNetwork: ETH_CHAIN,
            active_account: { address: EVM_ADDRESS, key: 'acc1' },
            vaults: [], saved_addresses: [],
        })

        const app = createApp(ConfirmTransaction)
        app.use(createTestPinia())
        app.use(createTestI18n())
        networkStore().currentNetwork = ETH_CHAIN
        networkStore().rpc = 'https://evm.example/rpc'
        userStore().address = STALE_MIRROR
        cryptoStore().transactionData = {
            // Send.vue'nun EVM dalinin yazdigi deger: depodan TAZE active_account.address
            from: EVM_ADDRESS,
            to: '0x1111111111111111111111111111111111111111',
            amount: '1', asset: null, network: ETH_CHAIN.name,
        }

        const captured = captureInstance(app, 'ConfirmTransaction')
        await render(app)

        // Satirda gorunen adres = imzalayacak hesabin adresi (bayat ayna DEGIL).
        expect(captured.instance.setupState.fromAddress).toBe(EVM_ADDRESS)
        expect(captured.instance.setupState.fromAddress).not.toBe(STALE_MIRROR)

        // Ve ekranin geri kalani (guvenlik kapisi / gas tahmini / buildTransaction)
        // AYNI degeri okur -- gosterilen ile kullanilan TEK kaynaktan gelir.
        const [, myAddress] = fetchHistoryCounterpartiesMock.mock.calls[0]
        expect(myAddress).toBe(EVM_ADDRESS)
    })

    // CURUTMENIN DAYANAGI: dapp yolu bu bileseni acmaz. Sessizce degisirse
    // (dapp istegi 'confirm_transaction'a yonlendirilirse) dapp kontrollu bir
    // `from` gercekten bu satira ulasirdi -- o gun bu test kirilsin.
    it('dapp islemi bu ekrana YONLENDIRILMEZ (dapp_router/Dapp.vue dogrular)', () => {
        const here = dirname(fileURLToPath(import.meta.url))
        const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')
        const APP = read('popup/App.vue')
        // Dapp dinleyicileri popup/main.js'ten shared/bootstrap.js'e tasindi
        // (iki giris noktasi -- popup ve yan panel -- ayni govdeyi paylasiyor).
        const MAIN = read('shared/bootstrap.js')
        const POPUP_MAIN = read('popup/main.js')
        const DAPP = read('components/Dapp.vue')

        // SEND_TX -> dapp_router (ConfirmTransaction DEGIL)
        expect(APP).toMatch(/case 'SEND_TX':\s*page\.currentPage = 'dapp_router'/)
        expect(MAIN).toMatch(/DAPP_SEND_TX/)
        expect(MAIN).toMatch(/page\.currentPage = 'dapp_router'/)

        // Dapp yolundaki dosyalarin hicbiri bu ekrani acmaz.
        expect(APP).not.toMatch(/currentPage = 'confirm_transaction'/)
        expect(MAIN).not.toMatch(/confirm_transaction/)
        expect(POPUP_MAIN).not.toMatch(/confirm_transaction/)
        expect(DAPP).not.toMatch(/confirm_transaction/)

        // Dapp'in `from`u KASADA aranir; bulunmazsa istek reddedilir.
        expect(DAPP).toMatch(/findAccountByAddress\(vaults, txData\.from\)/)
        expect(DAPP).toMatch(/unknownSender\.value = txData\.from/)
    })

    // ONAY EKRANLARINA `tabs.query` YASAK.
    //
    // Bu ekran islemin kaynagini AKTIF SEKMEDEN okuyordu. Dal bugun ulasilamaz
    // (yukaridaki test dapp akisinin buraya yonlendirilmedigini kilitliyor) ve
    // dogru kalip zaten Dapp.vue'de: origin ve ikon `current_request`ten gelir.
    //
    // Yine de kaynak kilidi GEREKLI, cunku kalip yan panelde gercek bir tuzaga
    // donusur: panel sekme degisiminde ayakta kalir, yani ekran masum bir sitenin
    // adiyla dururken kotu niyetli bir istegi imzalatabilirdi. Bu bir GERILEME
    // ONLEMIDIR, acik kapatma degil.
    it('onay ekrani kaynagi aktif sekmeden OKUMAZ', () => {
        const here = dirname(fileURLToPath(import.meta.url))
        const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

        for (const yol of ['components/ConfirmTransaction.vue', 'components/Dapp.vue']) {
            expect(read(yol)).not.toMatch(/tabs\.query/)
        }

        // Dogru kaynak Dapp.vue'de duruyor ve orada KALMALI.
        const dapp = read('components/Dapp.vue')
        expect(dapp).toMatch(/url\.value = current_request\.origin/)
        expect(dapp).toMatch(/logo\.value = current_request\.favicon/)
    })
})
