import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Task 8'deki kurChrome/SENDER buraya KOPYALANDI (tonDappFunctions.connect.test.js'ten):
// test dosyalari birbirinden BAGIMSIZ olmali, ortak bir yardimci modul iki dosyayi
// birbirine baglar ve biri bozulunca digeri de anlamsizca kirilir.
const SENDER = { origin: 'https://app.dedust.io', tab: { id: 7, favIconUrl: 'https://app.dedust.io/f.ico' } }

const VARSAYILAN_TON_KASA = {
    fingerprint: 'f-ton', type: 'tonMnemonic',
    accounts: [{ key: 'acc-1', type: 'ton', name: 'TON 1', address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG' }],
}

function kurChrome(local = {}) {
    // vaults VARSAYILAN: bkz. tonDappFunctions.connect.test.js'teki ayni not.
    const store = { vaults: [VARSAYILAN_TON_KASA], ...local }
    const acilanPencereler = []
    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const w = keys === undefined ? Object.keys(store) : (Array.isArray(keys) ? keys : [keys])
                    return Object.fromEntries(w.map((k) => [k, store[k]]))
                },
                set: async (obj) => { Object.assign(store, obj) },
                remove: async (k) => { delete store[k] },
            },
        },
        windows: {
            create: async (opts) => { acilanPencereler.push(opts); return { id: acilanPencereler.length } },
            remove: async () => {},
            get: async () => ({}),
            getLastFocused: async () => ({ width: 1200, left: 0, top: 0 }),
            onRemoved: { addListener: () => {} },
        },
        tabs: { sendMessage: async () => {} },
        runtime: { getURL: (p) => 'chrome-extension://x/' + p },
    }
    return { store, acilanPencereler }
}

beforeEach(() => { vi.resetModules() })
afterEach(() => { delete globalThis.chrome; vi.unstubAllGlobals() })

// B2: ag/from uyusmazligi ONAY penceresi ACMAZ ama yalniz-uyari penceresi acar.
const onayPencereleri = (p) => p.filter((o) => o.url.endsWith('#window'))
const uyariPencereleri = (p) => p.filter((o) => o.url.endsWith('#alert'))

// manifest.url BILEREK SENDER.origin'den FARKLI bir host (K4/Onemli 5): ikisi
// ayni dizeyi paylassaydi, origin'i sender'dan degil manifest'ten okuyan YANLIS
// bir implementasyon da asagidaki origin iddiasini gecerdi.
const SESSION = {
    address: '0:1111111111111111111111111111111111111111111111111111111111111111',
    publicKey: 'ab12', accountKey: 'acc-1', chain: '-239',
    manifest: { name: 'DeDust', url: 'https://cdn.example.com', iconUrl: null, manifestUrl: 'https://cdn.example.com/m.json', sameOrigin: false },
    connectedAt: 1,
}
// Mesaj adresi friendly OLMAK ZORUNDA (rpc.md); oturum adresi raw kalir.
const MSG = { address: 'UQAiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIsAH', amount: '1000000000' }

// id SAYISAL dize: oturum basina artan olmali (rpc.md), SDK '0','1',... gonderir.
function istek(params, id = '1') {
    return { params: [{ method: 'sendTransaction', params: [JSON.stringify(params)], id }] }
}

describe('sendTransaction', () => {
    it('gecerli istek TON_SEND_TX onay penceresi acar', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        await handleTonSend(istek({ valid_until: Math.floor(Date.now() / 1000) + 300, messages: [MSG] }), SENDER, () => {})

        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.type).toBe('TON_SEND_TX')
        expect(store.current_request.messages.length).toBe(1)
        expect(store.current_request.messages[0].amountNano).toBe('1000000000')
        expect(store.current_request.from).toBe(SESSION.address)
        expect(store.current_request.manifest.name).toBe('DeDust')
        // Origin SENDER'dan gelmeli, oturumun manifest.url'sinden DEGIL (K4). SESSION
        // yukarida BILEREK farkli bir manifest.url tasiyor, yani bu iddia gercekten
        // ayirt edici: manifest'ten okuyan yanlis bir implementasyon burada duser.
        expect(store.current_request.origin).toBe(SENDER.origin)
        // Onemli 4 (plumbing yarisi): onay ekraninin tonDappSend'e geri
        // gonderebilmesi icin hangi kasa hesabinin imzalayacagi da yazilmali.
        expect(store.current_request.accountKey).toBe(SESSION.accountKey)
    })

    it('4 mesaj gecer, 5 mesaj kod 1 ve PENCERE ACILMAZ', async () => {
        const { acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')

        await handleTonSend(istek({ messages: Array(4).fill(MSG) }), SENDER, () => {})
        expect(acilanPencereler.length).toBe(1)

        const yanitlar = []
        await handleTonSend(istek({ messages: Array(5).fill(MSG) }, '2'), SENDER, (r) => yanitlar.push(r))
        expect(acilanPencereler.length).toBe(1)
        expect(yanitlar[0].result.error.code).toBe(1)
        expect(yanitlar[0].result.error.message).toBe('Too many messages')
        expect(yanitlar[0].result.id).toBe('2')
    })

    it('gecmis valid_until kod 1, PENCERE ACILMAZ', async () => {
        const { acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend(istek({ valid_until: 1, messages: [MSG] }), SENDER, (r) => yanitlar.push(r))
        expect(acilanPencereler.length).toBe(0)
        expect(yanitlar[0].result.error.code).toBe(1)
        expect(yanitlar[0].result.error.message).toBe('Request expired')
    })

    // Dogrulayici reddi PENCEREDEN ONCE gelir: raw mesaj adresi onay ekranina ulasmaz.
    it('raw mesaj adresi kod 1, PENCERE ACILMAZ', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        const rawMesaj = { ...MSG, address: '0:2222222222222222222222222222222222222222222222222222222222222222' }
        await handleTonSend(istek({ messages: [rawMesaj] }), SENDER, (r) => yanitlar.push(r))
        expect(acilanPencereler.length).toBe(0)
        expect(store.current_request).toBeUndefined()
        expect(yanitlar[0].result.error.code).toBe(1)
        expect(yanitlar[0].result.error.message).toBe('Message address must be a valid user-friendly address')
        expect(yanitlar[0].result.id).toBe('1')
    })

    // Kutuphane sozlugu servis calisaninda HIC yurunmez: pencere acilmadan kod 1.
    it('kutuphane sozluklu stateInit kod 1, PENCERE ACILMAZ', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const { beginCell, storeStateInit, Dictionary, storeSimpleLibrary, loadSimpleLibrary } = await import('@ton/core')
        const libs = Dictionary.empty(Dictionary.Keys.BigUint(256), {
            serialize: (src, b) => b.store(storeSimpleLibrary(src)), parse: (s) => loadSimpleLibrary(s),
        })
        libs.set(1n, { public: true, root: beginCell().storeUint(7, 8).endCell() })
        const stateInit = beginCell().store(storeStateInit({ code: beginCell().storeUint(1, 8).endCell(), libraries: libs }))
            .endCell().toBoc().toString('base64')
        const yanitlar = []
        await handleTonSend(istek({ messages: [{ ...MSG, stateInit }] }), SENDER, (r) => yanitlar.push(r))
        expect(acilanPencereler.length).toBe(0)
        expect(store.current_request).toBeUndefined()
        expect(yanitlar[0].result.error).toEqual({ code: 1, message: 'stateInit libraries are not supported' })
    })

    // TON Coins sinirinin (2^120) ustu imzada patlardi; pencere acilmadan kod 1.
    it('2^120 nanoton amount kod 1, PENCERE ACILMAZ', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend(istek({ messages: [{ ...MSG, amount: (2n ** 120n).toString() }] }), SENDER, (r) => yanitlar.push(r))
        expect(acilanPencereler.length).toBe(0)
        expect(store.current_request).toBeUndefined()
        expect(yanitlar[0].result).toEqual({ error: { code: 1, message: 'Message amount out of range' }, id: '1' })
    })

    // Oturum ADRESE bagli (§7.1). Dapp baska bir adres icin islem hazirlatamaz.
    // Kod 1 (BAD_REQUEST, send-transaction.md); 100 oturum/hesap kapilarina ait.
    // B2 (rpc.md:104): kullanici yalniz-uyari penceresinde nedenini gorur.
    it('YABANCI from adresi kod 1, ONAY penceresi acilmaz, UYARI penceresi acilir', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        const yabanci = '0:9999999999999999999999999999999999999999999999999999999999999999'
        await handleTonSend(istek({ from: yabanci, messages: [MSG] }), SENDER, (r) => yanitlar.push(r))
        expect(yanitlar).toHaveLength(1)
        expect(yanitlar[0].result.error.code).toBe(1)
        expect(yanitlar[0].result.error.message).toBe('Requested from address does not match the connected account')
        // Sadece hata koduna bakmak, once onay penceresini acip SONRA hata donen
        // yanlis bir implementasyonu da gecerdi (bkz. gorev notu).
        expect(onayPencereleri(acilanPencereler)).toHaveLength(0)
        expect(uyariPencereleri(acilanPencereler)).toHaveLength(1)
        expect(store.ton_alert).toMatchObject({
            kind: 'from', hostname: 'app.dedust.io', appName: 'DeDust',
            requested: yabanci, expected: SESSION.address, network: '-239',
        })
        expect(store.current_request).toBeUndefined()
    })

    // Uyari bir onay DEGIL: bekleyen baska bir onayi 300'le (Request replaced)
    // iptal etmez, onun penceresini kapatmaz, current_request'ini ezmez.
    it('uyari penceresi bekleyen BASKA bir onaya dokunmaz', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const kapatilan = []
        chrome.windows.remove = async (id) => { kapatilan.push(id) }
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const { pendingRequests } = await import('./dappFunctions.js')
        const ilkYanit = vi.fn()
        await handleTonSend(istek({ messages: [MSG] }, '1'), SENDER, ilkYanit)
        const bekleyen = store.current_request
        expect(bekleyen.type).toBe('TON_SEND_TX')

        const yanitlar = []
        await handleTonSend(istek({ network: '-3', messages: [MSG] }, '2'), SENDER, (r) => yanitlar.push(r))

        expect(yanitlar[0].result.error.code).toBe(1)
        expect(uyariPencereleri(acilanPencereler)).toHaveLength(1)
        expect(ilkYanit).not.toHaveBeenCalled()
        expect(pendingRequests.has(bekleyen.id)).toBe(true)
        expect(kapatilan).toEqual([])
        expect(store.current_request).toEqual(bekleyen)
    })

    // Oturum adresi HAM saklanir; dapp ayni hesabi friendly bicimde de verebilir (rpc.md).
    it.each([
        ['EQ', 'EQAREREREREREREREREREREREREREREREREREREREREREeYT'],
        ['UQ', 'UQAREREREREREREREREREREREREREREREREREREREREREbvW'],
    ])('from oturum adresinin %s bicimiyse pencere acilir', async (_ad, from) => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        await handleTonSend(istek({ from, messages: [MSG] }), SENDER, () => {})
        expect(acilanPencereler.length).toBe(1)
        // Imzaya giden adres oturumun HAM adresi kalir, dapp'in dizesi degil.
        expect(store.current_request.from).toBe(SESSION.address)
    })

    // Yalniz undefined/null/'' "from yok" sayilir: 0/false kapiyi atlatamaz.
    // Uyari dize olmayan degeri YANSITMAZ (null -> ekranda "gecersiz deger").
    it.each([[123], [false], [{}]])('dize olmayan from %j kod 1, ONAY penceresi acilmaz, UYARI acilir', async (from) => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend(istek({ from, messages: [MSG] }), SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.error.code).toBe(1)
        expect(yanitlar[0].result.error.message).toBe('Requested from address does not match the connected account')
        expect(onayPencereleri(acilanPencereler)).toHaveLength(0)
        expect(uyariPencereleri(acilanPencereler)).toHaveLength(1)
        expect(store.ton_alert).toMatchObject({ kind: 'from', requested: null, expected: SESSION.address })
    })

    it('istekteki network cuzdaninkiyle uyusmuyorsa kod 1, ONAY penceresi acilmaz, UYARI acilir', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend(istek({ network: '-3', messages: [MSG] }), SENDER, (r) => yanitlar.push(r))
        expect(yanitlar).toHaveLength(1)
        expect(yanitlar[0].result.error.code).toBe(1)
        expect(yanitlar[0].result.error.message).toBe('Requested network does not match the wallet network')
        expect(onayPencereleri(acilanPencereler)).toHaveLength(0)
        expect(uyariPencereleri(acilanPencereler)).toHaveLength(1)
        expect(store.ton_alert).toMatchObject({ kind: 'network', hostname: 'app.dedust.io', requested: '-3', expected: '-239' })
        expect(store.current_request).toBeUndefined()
    })

    // Kisma: ayni sayfa 10 sn icinde ikinci bir uyari penceresi actiramaz;
    // dapp yine her istegine kod 1 alir.
    it('ayni sayfadan ikinci uyumsuzluk 10 sn icinde IKINCI pencere acmaz', async () => {
        const { acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        chrome.windows.get = async () => { throw new Error('No window') }
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend(istek({ network: '-3', messages: [MSG] }, '1'), SENDER, (r) => yanitlar.push(r))
        await handleTonSend(istek({ network: '-3', messages: [MSG] }, '2'), SENDER, (r) => yanitlar.push(r))
        expect(yanitlar.map((y) => y.result.error.code)).toEqual([1, 1])
        expect(uyariPencereleri(acilanPencereler)).toHaveLength(1)
    })

    // W5 adresi aga gore DEGISIR: testnette kurulan oturumun adresinden mainnet
    // cuzdanda islem imzalanamaz (tonDappSend from kilidi), hata Onayla'dan SONRA gelirdi.
    // network YOKSA dapp'in niyeti oturumun agidir: uyari onu gosterir.
    it('network YOKSA ve oturum agi cuzdaninkinden farkliysa kod 1, ONAY penceresi acilmaz, UYARI acilir', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': { ...SESSION, chain: '-3' } } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend(istek({ messages: [MSG] }), SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.error.code).toBe(1)
        expect(yanitlar[0].result.error.message).toBe('Wallet network does not match the connected session')
        expect(onayPencereleri(acilanPencereler)).toHaveLength(0)
        expect(uyariPencereleri(acilanPencereler)).toHaveLength(1)
        expect(store.ton_alert).toMatchObject({ kind: 'network', requested: '-3', expected: '-239' })
        expect(store.current_request).toBeUndefined()
    })

    // network VERILMIS ve cuzdanla ayni: rpc.md:100 uyari sart kosmaz (yalniz
    // FARKLI network). Asagidaki 0, uyari penceresini de kapsar.
    it('network cuzdanla ayni ama oturum agi farkliysa yine kod 1', async () => {
        const { acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': { ...SESSION, chain: '-3' } } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend(istek({ network: '-239', messages: [MSG] }), SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.error.code).toBe(1)
        expect(yanitlar[0].result.error.message).toBe('Wallet network does not match the connected session')
        expect(acilanPencereler.length).toBe(0)
    })

    it('testnet cuzdan ve testnet oturumda pencere acilir, ag -3 yazilir', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': { ...SESSION, chain: '-3' } }, currentNetwork: { chainId: -3 } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        await handleTonSend(istek({ messages: [MSG] }), SENDER, () => {})
        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.network).toBe('-3')
    })
})
