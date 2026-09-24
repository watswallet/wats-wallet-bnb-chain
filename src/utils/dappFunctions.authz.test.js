import { describe, it, expect, vi, beforeEach } from 'vitest'
import supported_chains from '../data/supported_chains.json'

/**
 * Dapp istek kapilari (guvenlik taramasi duzeltmeleri):
 *
 * 1) KIMLIK: istegin origin'i GONDEREN CERCEVEDEN (sender.origin/sender.url)
 *    turetilmeli, ust sekmenin URL'sinden (sender.tab.url) DEGIL. Content
 *    script all_frames:true ile calisiyor: iframe'deki bir dapp'in istegi
 *    ust sayfaya atfedilirse onay ekrani GUVENILIR sitenin adini gosterir,
 *    yanit ise iframe'e gider.
 *
 * 2) YETKI: eth_sendTransaction / personal_sign yalniz BAGLI (connected)
 *    origin'lerden ve o origin'e VERILMIS hesaplar icin kabul edilmeli.
 *    Aksi halde cuzdana hic baglanmamis herhangi bir sayfa imza penceresi
 *    actirabilir ve bagli bir dapp kullanicinin BASKA hesabindan islem
 *    hazirlatabilir. Reddin EIP-1193 kodu 4100'dur.
 *
 * 3) personal_sign'in ADRES parametresi (params[1]) saklanmali (signWith)
 *    ki imza istenen hesapla atilsin, o anki aktif hesapla degil. Ayrica
 *    karde$ handler'lardaki requireEvmVm kapisi burada da olmali.
 */

const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

const GRANTED = '0xAbCdEf0000000000000000000000000000000001'
const OTHER_ACCOUNT = '0x9999990000000000000000000000000000000009'

let localStore
let dapp

function installChromeStub() {
    globalThis.chrome = {
        windows: {
            onRemoved: { addListener: () => {} },
            create: vi.fn(async () => ({ id: 7 })),
            getLastFocused: vi.fn(async () => ({ width: 1000, left: 0, top: 0 })),
            get: vi.fn(async () => ({ id: 7 })),
            remove: vi.fn(async () => {}),
        },
        storage: {
            local: {
                get: vi.fn(async (keys) => {
                    const wanted = Array.isArray(keys) ? keys : [keys]
                    return Object.fromEntries(wanted.map(k => [k, localStore[k]]))
                }),
                set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
                remove: vi.fn(async (k) => { delete localStore[k] }),
            },
        },
        runtime: { getURL: (p) => 'chrome-extension://wats/' + p },
    }
}

// Iframe'den gelen gercekci sender: origin/url GONDEREN cerceveyi, tab.url
// UST sayfayi gosterir.
const iframeSender = {
    origin: 'https://widget.example',
    url: 'https://widget.example/embed/frame.html',
    tab: { url: 'https://trusted.example/news', favIconUrl: 'https://trusted.example/fav.ico' },
}

const topSender = {
    origin: 'https://dapp.example',
    url: 'https://dapp.example/app',
    tab: { url: 'https://dapp.example/app', favIconUrl: '' },
}

beforeEach(async () => {
    vi.resetModules()
    localStore = {
        currentNetwork: ETH_CHAIN,
        active_account: { key: 'k1', address: GRANTED, name: 'Hesap 1' },
        dapps: {
            'dapp.example': { accounts: [GRANTED], chainId: '0x1' },
            'widget.example': { accounts: [GRANTED], chainId: '0x1' },
        },
    }
    installChromeStub()
    dapp = await import('./dappFunctions')
})

describe('istek kimligi: origin gonderen cerceveden turetilir (iframe atfi)', () => {
    it('sendTxDapp: iframe istegi iframe origin\'iyle kaydedilir, ust sayfayla degil', async () => {
        await dapp.sendTxDapp({ params: [{ from: GRANTED, to: OTHER_ACCOUNT, value: '0x0' }] }, iframeSender, vi.fn())
        expect(localStore.current_request.origin).toBe('https://widget.example')
    })

    it('signMessageDapp: iframe istegi iframe origin\'iyle kaydedilir', async () => {
        await dapp.signMessageDapp({ params: ['0xdeadbeef', GRANTED] }, iframeSender, vi.fn())
        expect(localStore.current_request.origin).toBe('https://widget.example')
    })

    it('handleConnectWallet: baglanti onayi iframe origin\'i icin acilir', async () => {
        localStore.dapps = {}
        await dapp.handleConnectWallet({}, iframeSender, vi.fn())
        expect(localStore.current_request.origin).toBe('https://widget.example')
    })

    it('handleConnectWallet: zaten bagli kontrolu HARF DUYARSIZDIR (pencere acilmaz)', async () => {
        // Kayit kucuk harfle tutulmus, aktif hesap checksum'lu: ayni adres.
        localStore.dapps = { 'dapp.example': { accounts: [GRANTED.toLowerCase()], chainId: '0x1' } }
        const sendResponse = vi.fn()
        await dapp.handleConnectWallet({}, topSender, sendResponse)

        expect(sendResponse).toHaveBeenCalledWith({ result: [GRANTED] })
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })
})

describe('yetki kapisi: sendTxDapp', () => {
    it('bagli olmayan origin 4100 ile reddedilir; pencere ACILMAZ, kayit YAZILMAZ', async () => {
        localStore.dapps = {}
        const sendResponse = vi.fn()
        await dapp.sendTxDapp({ params: [{ from: GRANTED, to: OTHER_ACCOUNT, value: '0x0' }] }, topSender, sendResponse)

        expect(sendResponse).toHaveBeenCalledWith({ error: expect.objectContaining({ code: 4100 }) })
        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(localStore.current_request).toBeUndefined()
    })

    it('bagli dapp, VERILMEMIS `from` adresi isterse 4100 ile reddedilir', async () => {
        const sendResponse = vi.fn()
        await dapp.sendTxDapp({ params: [{ from: OTHER_ACCOUNT, to: GRANTED, value: '0x0' }] }, topSender, sendResponse)

        expect(sendResponse).toHaveBeenCalledWith({ error: expect.objectContaining({ code: 4100 }) })
        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(localStore.current_request).toBeUndefined()
    })

    it('verilmis `from` (farkli harf buyuklugunde) kabul edilir ve pencere acilir', async () => {
        const sendResponse = vi.fn()
        await dapp.sendTxDapp({ params: [{ from: GRANTED.toLowerCase(), to: OTHER_ACCOUNT, value: '0x0' }] }, topSender, sendResponse)

        expect(sendResponse).not.toHaveBeenCalled()
        expect(chrome.windows.create).toHaveBeenCalled()
        expect(localStore.current_request.txData.from).toBe(GRANTED.toLowerCase())
    })

    it('`from` verilmemisse dapp\'e verilmis ILK hesap kullanilir (aktif hesaba dusulmez)', async () => {
        const sendResponse = vi.fn()
        await dapp.sendTxDapp({ params: [{ to: OTHER_ACCOUNT, value: '0x0' }] }, topSender, sendResponse)

        expect(sendResponse).not.toHaveBeenCalled()
        expect(localStore.current_request.txData.from).toBe(GRANTED)
    })

    it('dapp\'in bildirdigi gas limiti (`gas`) kayda TASINIR (tahmin basarisizliginda tek guvenli yedek)', async () => {
        const sendResponse = vi.fn()
        await dapp.sendTxDapp({ params: [{ from: GRANTED, to: OTHER_ACCOUNT, value: '0x0', gas: '0x30d40' }] }, topSender, sendResponse)

        expect(localStore.current_request.txData.gas).toBe('0x30d40')
    })
})

describe('yetki kapisi + adres parametresi: signMessageDapp', () => {
    it('bagli olmayan origin 4100 ile reddedilir; pencere ACILMAZ', async () => {
        localStore.dapps = {}
        const sendResponse = vi.fn()
        await dapp.signMessageDapp({ params: ['0xdeadbeef', GRANTED] }, topSender, sendResponse)

        expect(sendResponse).toHaveBeenCalledWith({ error: expect.objectContaining({ code: 4100 }) })
        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(localStore.current_request).toBeUndefined()
    })

    it('verilmemis adres icin imza istenirse 4100 ile reddedilir', async () => {
        const sendResponse = vi.fn()
        await dapp.signMessageDapp({ params: ['0xdeadbeef', OTHER_ACCOUNT] }, topSender, sendResponse)

        expect(sendResponse).toHaveBeenCalledWith({ error: expect.objectContaining({ code: 4100 }) })
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    it('istenen adres (params[1]) signWith olarak SAKLANIR; mesaj da saklanir', async () => {
        const sendResponse = vi.fn()
        await dapp.signMessageDapp({ params: ['0xdeadbeef', GRANTED.toLowerCase()] }, topSender, sendResponse)

        expect(sendResponse).not.toHaveBeenCalled()
        expect(localStore.current_request.type).toBe('SIGN_MESSAGE')
        expect(localStore.current_request.messageToSign).toBe('0xdeadbeef')
        // Verilen hesap listesindeki KANONIK yazimla saklanir.
        expect(localStore.current_request.signWith).toBe(GRANTED)
    })

    it('adres verilmemisse dapp\'e verilmis ILK hesap signWith olur', async () => {
        const sendResponse = vi.fn()
        await dapp.signMessageDapp({ params: ['0xdeadbeef'] }, topSender, sendResponse)

        expect(sendResponse).not.toHaveBeenCalled()
        expect(localStore.current_request.signWith).toBe(GRANTED)
    })

    it('EVM disi ag aktifken (Solana) pencere ACILMAZ, 4901 doner (karde$ kapilarla ayni)', async () => {
        localStore.currentNetwork = SOLANA_CHAIN
        const sendResponse = vi.fn()
        await dapp.signMessageDapp({ params: ['0xdeadbeef', GRANTED] }, topSender, sendResponse)

        // BU IDDIA -32603 BEKLIYORDU ve mevcut davranisi tarif ediyordu, dogruyu
        // degil. CANLI OLCUM (dapp konsolu, TON aktifken): eth_chainId 4901,
        // eth_requestAccounts -32603 -- AYNI kosula iki ayri kod. 4901 EIP-1193'te
        // "zincire bagli degil" demektir ve wagmi/viem/ethers onu TANIR; -32603
        // "cuzdan bozuldu" demektir ve dapp kullaniciya yanlis sebebi gosterir.
        expect(sendResponse).toHaveBeenCalledWith({ error: { code: 4901, message: 'CHAIN_NOT_EVM' } })
        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(localStore.current_request).toBeUndefined()
    })
})

// EVM DISI AG: DORT GIRIS NOKTASI, TEK KOD.
//
// Kapilar ayri dosyalarda ve ayri catch bloklarinda yasiyor; biri duzelip
// digerleri geride kaldigi icin bu hata dogdu. Iddia artik DORDUNU BIRDEN
// olcuyor, yani bir sonraki ayrisma testte gorunur.
describe('EVM disi ag: IMZA kapilari AYNI kodu doner', () => {
    // eth_requestAccounts BU LISTEDEN CIKTI (kullanici bildirimi: "cuzdan en son
    // gram aginda kalmissa dapp ile evm'lere gecemiyor").
    //
    // Artik EVM disi agda HATA DONMUYOR: onay penceresini ACIYOR ve kullaniciya
    // cikisi ("su EVM agina gec ve baglan") gosteriyor. Gerekce dappFunctions.js'te
    // uzun uzun yazili; ozeti: red DOGRUYDU ama SESSIZDI, cuzdan hicbir sey
    // gostermedigi icin kullanici sorunun aktif ag oldugunu hicbir yerden
    // ogrenemiyordu. Yeni sozlesme background.evmGates.test.js'te kilitli, o
    // yolun DAVRANISINI (pencere acilir) dogrudan sinayan yer orasi.
    //
    // KALAN UCU DEGISMEDI ve ayni listede kalmalari SART: ekranlari (Dapp.vue /
    // Sign.vue) EVM'e ozel ve "once aga gec" diye bir kurtarma yollari YOK --
    // imzalanacak yuk zaten baska bir zincir icin kurulmus.
    const KAPILAR = [
        ['eth_sendTransaction', (d, r) => d.sendTxDapp({ params: [{ from: GRANTED, to: GRANTED, value: '0x0' }] }, topSender, r)],
        ['personal_sign', (d, r) => d.signMessageDapp({ params: ['0xdeadbeef', GRANTED] }, topSender, r)],
        // handleGetChainId TEK argüman alır (sender sormaz) — kardeşlerinden farklı imza.
        ['eth_chainId', (d, r) => d.handleGetChainId(r)],
    ]

    it.each(KAPILAR)('%s: 4901 + CHAIN_NOT_EVM', async (_ad, cagir) => {
        localStore.currentNetwork = SOLANA_CHAIN
        const sendResponse = vi.fn()
        await cagir(dapp, sendResponse)

        const zarf = sendResponse.mock.calls[0][0]
        expect(zarf.error).toBeDefined()
        expect(zarf.error.code).toBe(4901)
        expect(zarf.error.message).toBe('CHAIN_NOT_EVM')
    })

    // KARDESLERDEN AYRILAN YOLUN KENDI KILIDI: burada da sinanir ki listeden
    // cikarilmis olmasi "bu yol artik test edilmiyor" anlamina gelmesin.
    it('eth_requestAccounts: HATA DEGIL, onay penceresi acar (cikis gosterilsin)', async () => {
        localStore.currentNetwork = SOLANA_CHAIN
        const sendResponse = vi.fn()
        await dapp.handleConnectWallet({}, topSender, sendResponse)

        expect(chrome.windows.create).toHaveBeenCalledOnce()
        expect(sendResponse).not.toHaveBeenCalled()
    })

    // HIZLI YOL KAPALI: zaten bagli bir origin bile EVM disi agda hesabi HEMEN
    // ALAMAZ. Alsaydi "EVM disi agda dapp'e asla basarili yanit donmez" degismezi
    // tam da en cok kullanilan yolda delinirdi -- dapp bir adres alir, sonraki her
    // cagrisi 4901 yer ve kullanici "bagli ama hicbir sey calismiyor" durumunda
    // kalirdi. Ustelik o dapp aga gecilirken ZATEN `disconnect` almistir.
    it('eth_requestAccounts: ZATEN BAGLI origin de hizli yoldan GECEMEZ', async () => {
        localStore.currentNetwork = SOLANA_CHAIN
        const sendResponse = vi.fn()
        await dapp.handleConnectWallet({}, topSender, sendResponse)

        expect(sendResponse).not.toHaveBeenCalledWith({ result: [GRANTED] })
        expect(chrome.windows.create).toHaveBeenCalledOnce()
    })

    it('BASKA hatalar 4901 e KAYMAZ - kod yalnizca bu duruma ozel', () => {
        expect(dapp.dappErrorCode(new Error('CHAIN_NOT_EVM'))).toBe(4901)
        expect(dapp.dappErrorCode(new Error('storage okunamadi'))).toBe(-32603)
        expect(dapp.dappErrorCode(undefined)).toBe(-32603)
    })
})

describe('eth_accounts: sessiz baglanti sorgusu', () => {
    it('bagli origin verilen hesap listesini alir', async () => {
        const sendResponse = vi.fn()
        await dapp.handleGetAccounts({}, topSender, sendResponse)

        expect(sendResponse).toHaveBeenCalledWith({ result: [GRANTED] })
    })

    it('bagli olmayan origin HATA DEGIL bos liste alir (autoconnect kirilmasin)', async () => {
        localStore.dapps = {}
        const sendResponse = vi.fn()
        await dapp.handleGetAccounts({}, topSender, sendResponse)

        expect(sendResponse).toHaveBeenCalledWith({ result: [] })
    })

    it('EVM disi ag aktifken bos liste doner', async () => {
        localStore.currentNetwork = SOLANA_CHAIN
        const sendResponse = vi.fn()
        await dapp.handleGetAccounts({}, topSender, sendResponse)

        expect(sendResponse).toHaveBeenCalledWith({ result: [] })
    })
})

// ── §8 R4: UQ... metni EVM dapp'ine EIP-1193 hesabi olarak ULASMAMALI ──
//
// Bu dosyadaki mevcut `requireEvmVm` kapilari BASKA bir soruya cevap veriyor
// ("aktif ZINCIR EVM mi") ve bunu KAPSAMIYOR: EVM aginda duran bir TON hesabi
// o kapiyi rahatca geciyor. Asagidakiler HESAP sorusunu kilitliyor.
const TON_UQ = 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG'
const TON_HESAP = { key: 'k-ton', type: 'ton', name: 'TON 1', address: TON_UQ, tonAddress: TON_UQ }

describe('hesap kapisi: TON hesabi EVM dapp yoluna GIREMEZ', () => {
    it('handleConnectWallet: TON hesabi aktifken 4100 doner, onay penceresi ACILMAZ', async () => {
        localStore.active_account = TON_HESAP
        localStore.dapps = {}
        const sendResponse = vi.fn()
        await dapp.handleConnectWallet({}, topSender, sendResponse)

        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(sendResponse).toHaveBeenCalledWith({ error: expect.objectContaining({ code: 4100 }) })
        expect(localStore.current_request).toBeUndefined()
    })

    // FAIL-OPEN, BILEREK (§2.1: accountKindsOf bilinmeyen turde null doner).
    // Bu uc noktada fail-closed olmak, turu henuz yazilmamis/eski bir kayitla
    // acilan her cuzdani her dapp'ten kesardi. Kemer: handleGetAccounts'un
    // 0x suzgeci (asagida) UQ metnini yine de disari birakmaz.
    it('handleConnectWallet: turu BILINMEYEN hesap kapiyi GECER (FAIL-OPEN)', async () => {
        localStore.active_account = { key: 'k1', address: GRANTED, name: 'Turu yok' }
        localStore.dapps = {}
        const sendResponse = vi.fn()
        await dapp.handleConnectWallet({}, topSender, sendResponse)

        expect(chrome.windows.create).toHaveBeenCalled()
        expect(localStore.current_request.type).toBe('CONNECT')
    })

    // FIX 4 (kucuk bulgu, fix dalgasi): "zaten bagli" HIZLI YOLU (:228 civari)
    // `grantedAccountFor` disinda hicbir suzgecten gecmiyordu. `grantedAccountFor`in
    // karsilastirmasi harf DUYARSIZDIR (EIP-55 checksum icin dogru) ama bu bir
    // `UQ...` metnini de rahatlikla eslestirir - o karsilastirma TON adresleri
    // icin HIC tasarlanmadi (bkz. dappFunctions.js:162 notu). Ustteki
    // `accountHasTon` kapisi FAIL-OPEN oldugu icin (tipi bilinmeyen hesap gecer)
    // bu hizli yol tek basina kalan tek kapisiz nokta oluyordu: `dapps[hostname]
    // .accounts` icinde (eski/bozuk bir kayittan) bir `UQ...` metni VE aktif
    // hesabin adresi TESADUFEN o metinle AYNIYSA, hizli yol o UQ metnini
    // dogrudan EIP-1193 sonucu olarak donduruyordu -- `handleGetAccounts`teki
    // `isEvmDappAddress` kemeri bu yoldan hic GECMIYORDU.
    it('handleConnectWallet: hizli yol UQ adresini 0x kemeri OLMADAN dondurmez', async () => {
        localStore.active_account = { key: 'k-unknown', address: TON_UQ, name: 'Turu yok' }
        localStore.dapps = { 'dapp.example': { accounts: [TON_UQ], chainId: '0x1' } }
        const sendResponse = vi.fn()
        await dapp.handleConnectWallet({}, topSender, sendResponse)

        // Hizli yoldan UQ metniyle DONMEDI: onay penceresine dustu, orada
        // ConnectDapp'in hesap kapisi (accountHasEvm) onu fail-closed reddeder.
        expect(sendResponse).not.toHaveBeenCalledWith({ result: [TON_UQ] })
        expect(chrome.windows.create).toHaveBeenCalled()
        expect(localStore.current_request.type).toBe('CONNECT')
    })

    it('sendTxDapp: kayitta duran UQ adresi 4100 ile reddedilir, pencere ACILMAZ', async () => {
        localStore.dapps = { 'dapp.example': { accounts: [TON_UQ], chainId: '0x1' } }
        const sendResponse = vi.fn()
        await dapp.sendTxDapp({ params: [{ to: OTHER_ACCOUNT, value: '0x0' }] }, topSender, sendResponse)

        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(sendResponse).toHaveBeenCalledWith({ error: expect.objectContaining({ code: 4100 }) })
        expect(localStore.current_request).toBeUndefined()
    })

    it('sendTxDapp: `from` acikca UQ verilse de 4100', async () => {
        localStore.dapps = { 'dapp.example': { accounts: [GRANTED, TON_UQ], chainId: '0x1' } }
        const sendResponse = vi.fn()
        await dapp.sendTxDapp({ params: [{ from: TON_UQ, to: OTHER_ACCOUNT, value: '0x0' }] }, topSender, sendResponse)

        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(sendResponse).toHaveBeenCalledWith({ error: expect.objectContaining({ code: 4100 }) })
    })

    it('signMessageDapp: kayitta duran UQ adresi 4100 ile reddedilir', async () => {
        localStore.dapps = { 'dapp.example': { accounts: [TON_UQ], chainId: '0x1' } }
        const sendResponse = vi.fn()
        await dapp.signMessageDapp({ params: ['0xdeadbeef'] }, topSender, sendResponse)

        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(sendResponse).toHaveBeenCalledWith({ error: expect.objectContaining({ code: 4100 }) })
    })

    it('handleGetAccounts: 0x onekli OLMAYAN kayitlar listeden DUSER', async () => {
        localStore.dapps = { 'dapp.example': { accounts: [GRANTED, TON_UQ], chainId: '0x1' } }
        const sendResponse = vi.fn()
        await dapp.handleGetAccounts({}, topSender, sendResponse)

        expect(sendResponse).toHaveBeenCalledWith({ result: [GRANTED] })
    })

    it('handleGetAccounts: yalniz UQ tasiyan kayit BOS liste doner (hata DEGIL)', async () => {
        localStore.dapps = { 'dapp.example': { accounts: [TON_UQ], chainId: '0x1' } }
        const sendResponse = vi.fn()
        await dapp.handleGetAccounts({}, topSender, sendResponse)

        // Hata degil BOS liste: eth_accounts'un sozlesmesi budur (autoconnect
        // bir saglayici arizasi sanip iptal etmesin).
        expect(sendResponse).toHaveBeenCalledWith({ result: [] })
    })
})
