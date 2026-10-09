import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// rpc.md AppRequest: `id` oturum basina ARTAN olmali. Cuzdan oturumda gordugu
// ilk id'yi taban alir; sonraki her istek son islenenden KESIN BUYUK olmali,
// aksi reddedilir (kod 1). kurChrome/SENDER sendTx.test.js'ten KOPYALANDI:
// test dosyalari birbirinden BAGIMSIZ kalmali.
const SENDER = { origin: 'https://app.dedust.io', tab: { id: 7, favIconUrl: 'https://app.dedust.io/f.ico' } }

const VARSAYILAN_TON_KASA = {
    fingerprint: 'f-ton', type: 'tonMnemonic',
    accounts: [{ key: 'acc-1', type: 'ton', name: 'TON 1', address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG' }],
}

function kurChrome(local = {}) {
    const store = { vaults: [VARSAYILAN_TON_KASA], ...local }
    const acilanPencereler = []
    const yazilanAnahtarlar = []
    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const w = keys === undefined ? Object.keys(store) : (Array.isArray(keys) ? keys : [keys])
                    return Object.fromEntries(w.map((k) => [k, store[k]]))
                },
                set: async (obj) => {
                    yazilanAnahtarlar.push(...Object.keys(obj))
                    Object.assign(store, obj)
                },
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
    return { store, acilanPencereler, yazilanAnahtarlar }
}

beforeEach(() => { vi.resetModules() })
afterEach(() => { delete globalThis.chrome; vi.unstubAllGlobals() })

const SESSION = {
    address: '0:1111111111111111111111111111111111111111111111111111111111111111',
    publicKey: 'ab12', accountKey: 'acc-1', chain: '-239',
    manifest: { name: 'DeDust', url: 'https://cdn.example.com', iconUrl: null, manifestUrl: 'https://cdn.example.com/m.json', sameOrigin: false },
    connectedAt: 1,
}
const MSG = { address: 'UQAiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIsAH', amount: '1000000000' }
const ID_HATASI = 'Request id must be strictly increasing'

const gonderim = (id) => ({ params: [{ method: 'sendTransaction', params: [JSON.stringify({ messages: [MSG] })], id }] })
const imza = (id) => ({ params: [{ method: 'signData', params: [JSON.stringify({ type: 'text', text: 'x' })], id }] })
const kesme = (id) => ({ params: [{ method: 'disconnect', params: [], id }] })

// Kabul edilen istek onay penceresinde BEKLER (yanit yok); yanit yalniz retle gelir.
async function gonder(handleTonSend, req) {
    const yanitlar = []
    await handleTonSend(req, SENDER, (r) => yanitlar.push(r))
    return yanitlar
}

describe('AppRequest id artan olmali (rpc.md)', () => {
    it('ilk id taban alinir: pencere acilir; kayit AYRI anahtarda, ton_dapps YENIDEN YAZILMAZ', async () => {
        const { store, acilanPencereler, yazilanAnahtarlar } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')

        expect(await gonder(handleTonSend, gonderim('5'))).toEqual([])
        expect(acilanPencereler.length).toBe(1)
        expect(Object.values(store.ton_request_ids)).toEqual([{ connectedAt: 1, lastId: '5' }])
        // Kayip-guncelleme: o an yazilan bir putTonSession ezilmesin diye
        // ton_dapps'e hic dokunulmaz.
        expect(yazilanAnahtarlar).not.toContain('ton_dapps')
    })

    it('artan id kabul edilir', async () => {
        const { acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')

        expect(await gonder(handleTonSend, gonderim('5'))).toEqual([])
        expect(await gonder(handleTonSend, gonderim('6'))).toEqual([])
        expect(acilanPencereler.length).toBe(2)
    })

    it.each([
        ['ayni', '5'],
        ['dusuk', '4'],
    ])('%s id kod 1, PENCERE ACILMAZ, istek islenmez', async (_ad, ikinci) => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')

        await gonder(handleTonSend, gonderim('5'))
        const ilkIstek = store.current_request
        const yanitlar = await gonder(handleTonSend, gonderim(ikinci))

        expect(yanitlar).toEqual([{ result: { error: { code: 1, message: ID_HATASI }, id: ikinci } }])
        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request).toBe(ilkIstek)
    })

    // Red son id'yi GERI CEKMEZ: aksi halde 4'ten sonra 5 yeniden gecerdi.
    it('reddedilen id kaydi degistirmez', async () => {
        kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')

        await gonder(handleTonSend, gonderim('5'))
        await gonder(handleTonSend, gonderim('4'))
        const yanitlar = await gonder(handleTonSend, gonderim('5'))
        expect(yanitlar[0].result.error.message).toBe(ID_HATASI)
    })

    // Karsilastirma SAYISAL: sozluk sirasinda '10' < '9' olurdu.
    it('9dan sonra 10 kabul edilir', async () => {
        const { acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')

        await gonder(handleTonSend, gonderim('9'))
        expect(await gonder(handleTonSend, gonderim('10'))).toEqual([])
        expect(acilanPencereler.length).toBe(2)
    })

    // 2^53 ustunde Number ikisini AYNI degere yuvarlar; BigInt ayirir.
    it('2^53 ustu idler kesin karsilastirilir', async () => {
        const { acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')

        await gonder(handleTonSend, gonderim('9007199254740992'))
        expect(await gonder(handleTonSend, gonderim('9007199254740993'))).toEqual([])
        expect(acilanPencereler.length).toBe(2)
    })

    it.each([
        ['abc'], ['1.5'], ['-1'], [''], [' 7'], ['0x10'], ['1e3'],
        [null], [undefined], [-1], [1.5], [2 ** 53],
        // Sinirsiz uzunluk depoyu (10 MB, kasalarla ortak) doldurabilirdi.
        ['1'.repeat(65)],
    ])('sayisal olmayan id %j kod 1, PENCERE ACILMAZ, taban kurulmaz', async (id) => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')

        const yanitlar = await gonder(handleTonSend, gonderim(id))
        expect(yanitlar[0].result.error).toEqual({ code: 1, message: ID_HATASI })
        expect(acilanPencereler.length).toBe(0)
        expect(store.ton_request_ids).toBeUndefined()
    })

    it('64 haneye kadar ve negatif olmayan guvenli tam sayi idler kabul edilir', async () => {
        const { acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')

        expect(await gonder(handleTonSend, gonderim(7))).toEqual([])
        expect(await gonder(handleTonSend, gonderim('8'))).toEqual([])
        expect(await gonder(handleTonSend, gonderim('9'.repeat(64)))).toEqual([])
        expect(acilanPencereler.length).toBe(3)
        const yanitlar = await gonder(handleTonSend, gonderim(8))
        expect(yanitlar[0].result.error.message).toBe(ID_HATASI)
    })

    // Yeni baglanti YENI oturumdur: SDK sayacini sifirlar, taban da sifirlanmali.
    it('yeniden baglanti (yeni connectedAt) tabani sifirlar', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')

        await gonder(handleTonSend, gonderim('5'))
        store.ton_dapps = { 'app.dedust.io': { ...SESSION, connectedAt: 2 } }
        expect(await gonder(handleTonSend, gonderim('0'))).toEqual([])
        expect(acilanPencereler.length).toBe(2)
    })

    it('ayni anda gelen iki esit id ikisi birden GECEMEZ', async () => {
        kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')

        const yanitlar = []
        await Promise.all([
            handleTonSend(gonderim('5'), SENDER, (r) => yanitlar.push(r)),
            handleTonSend(gonderim('5'), SENDER, (r) => yanitlar.push(r)),
        ])
        const idRetleri = yanitlar.filter((r) => r.result?.error?.message === ID_HATASI)
        expect(idRetleri.length).toBe(1)
    })

    // Id dizisi OTURUMUN: sendTransaction ve signData ayni sayaci paylasir.
    it('signData da ayni id dizisine tabidir', async () => {
        const { acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')

        await gonder(handleTonSend, gonderim('5'))
        const yanitlar = await gonder(handleTonSend, imza('5'))
        expect(yanitlar[0].result).toEqual({ error: { code: 1, message: ID_HATASI }, id: '5' })
        expect(acilanPencereler.length).toBe(1)
    })
})

// SDK sayaci (nextRpcRequestId) sayfanin localStorage'inda: depo origin'e (port
// dahil), ucuncu taraf iframe'de UST siteye, gizli pencerede profile gore
// bolunur. Cuzdan oturumu ise host'a bagli ve ortak. Taban depo baglamina gore
// tutulmazsa ayni host'taki iki sayactan dusugu her istekte reddedilir.
describe('id tabani SDK depo baglamina gore', () => {
    const baglam = (origin, ustUrl, extra = {}) => ({ origin, tab: { id: 7, url: ustUrl, ...extra } })

    async function iki(oturumlar, A, B) {
        const { acilanPencereler } = kurChrome({ ton_dapps: oturumlar })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        await handleTonSend(gonderim('5'), A, () => {})
        const yanitlar = []
        await handleTonSend(gonderim('0'), B, (r) => yanitlar.push(r))
        return { yanitlar, acilanPencereler }
    }

    it('ayni host, farkli PORT: dusuk sayacli sayfa reddedilmez', async () => {
        const { yanitlar, acilanPencereler } = await iki(
            { '127.0.0.1': SESSION },
            baglam('http://127.0.0.1:8899', 'http://127.0.0.1:8899/'),
            baglam('http://127.0.0.1:4545', 'http://127.0.0.1:4545/'),
        )
        expect(yanitlar).toEqual([])
        expect(acilanPencereler.length).toBe(2)
    })

    // Ust sayfa AYNI: ayirt eden yalniz cercevenin portu.
    it('ayni ust sayfada iki porttan iframe: tabanlar ayri', async () => {
        const { yanitlar, acilanPencereler } = await iki(
            { '127.0.0.1': SESSION },
            baglam('http://127.0.0.1:8899', 'https://agg-a.io/'),
            baglam('http://127.0.0.1:4545', 'https://agg-a.io/'),
        )
        expect(yanitlar).toEqual([])
        expect(acilanPencereler.length).toBe(2)
    })

    it('ayni dapp iki farkli UST sitede iframe: tabanlar ayri', async () => {
        const { yanitlar, acilanPencereler } = await iki(
            { 'app.dedust.io': SESSION },
            baglam('https://app.dedust.io', 'https://agg-a.io/swap'),
            baglam('https://app.dedust.io', 'https://agg-b.io/'),
        )
        expect(yanitlar).toEqual([])
        expect(acilanPencereler.length).toBe(2)
    })

    it('gizli pencere ayri baglam', async () => {
        const { yanitlar, acilanPencereler } = await iki(
            { 'app.dedust.io': SESSION },
            baglam('https://app.dedust.io', 'https://app.dedust.io/', { incognito: false }),
            baglam('https://app.dedust.io', 'https://app.dedust.io/', { incognito: true }),
        )
        expect(yanitlar).toEqual([])
        expect(acilanPencereler.length).toBe(2)
    })

    // Anahtar SEKMEYE inmez: ayni origin'in iki sekmesi tek localStorage'i,
    // yani tek sayaci paylasir; tekrar eden id yine reddedilir.
    it('ayni baglamin iki sekmesi AYNI tabani paylasir', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        await handleTonSend(gonderim('5'), { origin: 'https://app.dedust.io', tab: { id: 1, url: 'https://app.dedust.io/' } }, () => {})
        const yanitlar = []
        await handleTonSend(gonderim('5'), { origin: 'https://app.dedust.io', tab: { id: 2, url: 'https://app.dedust.io/pool' } }, (r) => yanitlar.push(r))
        expect(yanitlar).toEqual([{ result: { error: { code: 1, message: ID_HATASI }, id: '5' } }])
        expect(acilanPencereler.length).toBe(1)
        expect(Object.keys(store.ton_request_ids).length).toBe(1)
    })
})

// disconnect fon tasimaz; SDK kendi kaydini yanit beklemeden siler (onRequestSent).
// Reddedilen bir disconnect cuzdanda olu bir oturum birakirdi
// (wallet-guidelines.md: cuzdan kabul edip oturuma hizmeti kesmeli).
describe('disconnect id kapisina TABI DEGIL', () => {
    it('eski id ile disconnect de oturumu siler, id kaydina dokunmaz', async () => {
        const { store } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')

        await gonder(handleTonSend, gonderim('5'))
        const kayit = structuredClone(store.ton_request_ids)
        const yanitlar = await gonder(handleTonSend, kesme('5'))
        expect(yanitlar).toEqual([{ result: { result: {}, id: '5' } }])
        expect(store.ton_dapps['app.dedust.io']).toBeUndefined()
        expect(store.ton_request_ids).toEqual(kayit)
    })

    it.each([['abc'], [null], [undefined]])('sayisal olmayan id %j ile de disconnect oturumu siler', async (id) => {
        const { store, yazilanAnahtarlar } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')

        const yanitlar = await gonder(handleTonSend, kesme(id))
        expect(yanitlar).toEqual([{ result: { result: {}, id } }])
        expect(store.ton_dapps['app.dedust.io']).toBeUndefined()
        expect(yazilanAnahtarlar).not.toContain('ton_request_ids')
    })

    it('artan id ile disconnect oturumu siler', async () => {
        const { store } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')

        await gonder(handleTonSend, gonderim('5'))
        const yanitlar = await gonder(handleTonSend, kesme('6'))
        expect(yanitlar).toEqual([{ result: { result: {}, id: '6' } }])
        expect(store.ton_dapps['app.dedust.io']).toBeUndefined()
    })
})
