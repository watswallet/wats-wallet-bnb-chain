import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})
const api = vi.hoisted(() => ({ post: null }))
vi.mock('axios', () => ({ default: { post: (...a) => api.post(...a) } }))

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { getAddress } from 'ethers'
import SERVER_LIST from '../../test-utils/serverTokenList.snapshot.json'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import { privateTokenInventory, ZERO } from '../../test-utils/privateTokenInventory.js'
import PrivateDeliveryTokenPicker from '../../components/privacy/PrivateDeliveryTokenPicker.vue'
import { DELIVERY_CHAINS } from './deliveryChains'
import { selfDeliverableAssets, selfDeliveryTokenOf } from './selfRoutes'
import { buildDeliveryTokenList } from './deliveryTokens'
import { isStockDeliveryToken } from './stockDelivery'
import { stockEntry, isGeneralSwapExcluded } from '../tokenizedStocks'
import { hideLogolessZeroRows } from './privateHomeScope'
import { privateTokenLogo, privateChainBadge, hasPrivateLogo, UNKNOWN_TOKEN_LOGO } from './privateTokenLogo'

// GIZLI MODDA LOGOSUZ TOKEN YOK (sahip karari 2026-11-03: "logosuz hicbir yer gormek istemiyorum, her seyin logosu tam olacak").
// Bu kilit gizli modun gosterebilecegi HER (ag, token) ciftini ekranlarin kendi kod yollarindan turetilen ENVANTERDEN yurur
// (test-utils/privateTokenInventory.js: kaynak ciftleri + Depository tablosunun tamami, her teslim agi icin sabit teslim satirlari, Para yukle /
// Takas / Kopru teslim varliklari, takas ve kopru hedefleri, siparis karti varliklari, Home tohumu). Elle yazilmis liste YOKTUR: yeni bir token
// (yeni ag, yeni kaynak varlik, yeni Depository satiri, yeni teslim tokeni) envantere kendiliginden girer ve gercek bir logosu yoksa BU TEST KIRILIR.
// Cozulen yol client/public altinda gercekten var olmali, PNG olmali, yedek simgeyle (ya da onun kopyasiyla) ayni dosya olmamali ve token icin
// bir ZINCIR logosu olmamali (yerel coin istisnasi: coinin evi olan aginin logosu coinin kendi logosudur, L2 logosu degil).

const PUBLIC = fileURLToPath(new URL('../../../public', import.meta.url))
const publicPath = (p) => PUBLIC + p
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const sha = (p) => createHash('sha256').update(readFileSync(publicPath(p))).digest('hex')
const DEFAULT_SHA = sha(UNKNOWN_TOKEN_LOGO)

// Bagimsiz beklenti: coin sembolu -> coinin logosu (cozucunun tablosundan kopya degil, ekranda gorunmesi gereken sonuc).
const COIN_LOGO = { ETH: '/chains/1.png', BNB: '/chains/56.png', POL: '/chains/137.png', CELO: '/chains/42220.png', MNT: '/chains/5000.png', CRO: '/chains/25.png', XDAI: '/tokens/100/' + ZERO + '.png' }

let inventory
beforeAll(() => {
    const all = DELIVERY_CHAINS.map((c) => c.chainId).join(',')
    vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', all)
    vi.stubEnv('VITE_PRIVATE_SEND_CHAINS', all)
    inventory = privateTokenInventory()
})
afterAll(() => { vi.unstubAllEnvs(); delete globalThis.chrome })

function expectRealLogo(path, label) {
    expect(typeof path, label).toBe('string')
    expect(path.startsWith('/') && !path.startsWith('//'), `${label}: yerel yol degil (${path})`).toBe(true)
    expect(path, `${label}: yedek simge`).not.toBe(UNKNOWN_TOKEN_LOGO)
    expect(existsSync(publicPath(path)), `${label}: dosya yok (${path})`).toBe(true)
    const bytes = readFileSync(publicPath(path))
    expect([...bytes.subarray(0, 8)], `${label}: PNG degil (${path})`).toEqual(PNG_SIG)
    expect(bytes.readUInt32BE(16), `${label}: bos gorsel (${path})`).toBeGreaterThan(0)
    expect(bytes.readUInt32BE(20), `${label}: bos gorsel (${path})`).toBeGreaterThan(0)
    expect(sha(path), `${label}: yedek simgenin kopyasi (${path})`).not.toBe(DEFAULT_SHA)
}

describe('envanter: kodun kendi yollarindan turetilir ve gercekten kapsayicidir', () => {
    const symbolsOn = (chainId) => inventory.filter((e) => e.chainId === chainId).map((e) => e.symbol)

    it('her teslim agi icin yerel coin, USDC ve siparis karti satirlari vardir; BSC ATS ve Ethereum USDT/DAI/ETH kaynaklari envanterde', () => {
        for (const chain of DELIVERY_CHAINS) {
            expect(symbolsOn(chain.chainId), String(chain.chainId)).toEqual(expect.arrayContaining(['USDC', chain.nativeSymbol]))
        }
        const has = (chainId, symbol, surface) => inventory.some((e) => e.chainId === chainId && e.symbol === symbol && e.surfaces.includes(surface))
        expect(has(56, 'ATS', 'delivery-send')).toBe(true)
        expect(has(56, 'ATS', 'order-card')).toBe(true)
        for (const symbol of ['USDC', 'USDT', 'DAI', 'ETH']) expect(has(1, symbol, 'source'), `1:${symbol}`).toBe(true)
        for (const [chainId, symbol] of [[10, 'USDT'], [42161, 'USDT'], [137, 'USDT'], [8453, 'ETH'], [100, 'USDC']]) expect(has(chainId, symbol, 'source'), `${chainId}:${symbol}`).toBe(true)
        expect(has(100, 'XDAI', 'delivery-send')).toBe(true)
        expect(has(100, 'XDAI', 'order-card')).toBe(true)
        // Her yuzey temsil edilir (bos yuzey yesil sayilmaz).
        for (const surface of ['source', 'delivery-send', 'delivery-fund', 'delivery-swap', 'delivery-bridge', 'swap-target', 'bridge-target', 'order-card', 'home-seed', 'home-native']) {
            expect(inventory.some((e) => e.surfaces.includes(surface)), surface).toBe(true)
        }
        expect(inventory.length).toBeGreaterThanOrEqual(40)
    })

    it('Para yukle / Takas / Kopru teslim varliklari (selfRoutes) envanterde eksiksiz', () => {
        for (const chain of DELIVERY_CHAINS) {
            for (const symbol of selfDeliverableAssets(chain.chainId)) {
                const t = selfDeliveryTokenOf(chain.chainId, symbol)
                expect(inventory.some((e) => e.chainId === t.chainId && e.address === t.address.toLowerCase()), `${chain.chainId}:${symbol}`).toBe(true)
            }
        }
    })
})

describe('her (ag, token) paketli, gercek bir logoya cozulur', () => {
    it('adresli sorgu (secici satiri, teslim cipi, kaynak cipi): sonuc gercek logo; yerel coin COININ logosu; token icin zincir logosu degil', () => {
        const hatalar = []
        for (const e of inventory) {
            if (e.address === null) continue
            const label = `${e.chainId}:${e.symbol}:${e.address}`
            const path = privateTokenLogo({ chainId: e.chainId, address: e.address, symbol: e.symbol })
            try { expectRealLogo(path, label) } catch (err) { hatalar.push(err.message); continue }
            const native = e.address === ZERO
            if (native) {
                const coin = COIN_LOGO[e.symbol === 'XDAI' ? 'XDAI' : e.symbol]
                expect(coin, `${label}: coin tablosunda yok (yeni yerel coin icin logo kurali gerekir)`).toBeDefined()
                if (path !== coin) hatalar.push(`${label}: yerel coin ${coin} olmaliydi, ${path} geldi`)
            } else if (path.startsWith('/chains/')) {
                hatalar.push(`${label}: token icin zincir logosu (${path})`)
            }
        }
        expect(hatalar).toEqual([])
    })

    it('adressiz sorgu (siparis karti: yalniz sembol + ag): ayni sonuc, yerel coin ETH ag logosu degil', () => {
        const hatalar = []
        for (const e of inventory) {
            const label = `${e.chainId}:${e.symbol}`
            const path = privateTokenLogo({ chainId: e.chainId, symbol: e.symbol })
            try { expectRealLogo(path, label) } catch (err) { hatalar.push(err.message); continue }
            const withAddress = e.address === null ? null : privateTokenLogo({ chainId: e.chainId, address: e.address, symbol: e.symbol })
            if (withAddress !== null && withAddress !== path) hatalar.push(`${label}: adresli (${withAddress}) ile adressiz (${path}) sonuc ayrisiyor`)
            const coin = COIN_LOGO[e.symbol]
            if (coin && path !== coin) hatalar.push(`${label}: coin ${coin} olmaliydi, ${path} geldi`)
            if (!coin && path.startsWith('/chains/')) hatalar.push(`${label}: token icin zincir logosu (${path})`)
        }
        expect(hatalar).toEqual([])
    })

    it('USDC her yerde /usdc.png, ATS /ats.png; ETH hicbir L2 logosu degil', () => {
        for (const e of inventory) {
            const path = privateTokenLogo({ chainId: e.chainId, address: e.address ?? undefined, symbol: e.symbol })
            if (e.symbol === 'USDC') expect(path, `${e.chainId}:USDC`).toBe('/usdc.png')
            if (e.symbol === 'ATS') expect(path, `${e.chainId}:ATS`).toBe('/ats.png')
            if (e.symbol === 'ETH') expect(path, `${e.chainId}:ETH`).toBe('/chains/1.png')
        }
    })

    it('ag rozeti: her teslim agi icin paketli, gercek zincir logosu', () => {
        for (const chain of DELIVERY_CHAINS) {
            const badge = privateChainBadge(chain.chainId)
            expect(badge, String(chain.chainId)).toBe(`/chains/${chain.chainId}.png`)
            expect(existsSync(publicPath(badge)), badge).toBe(true)
            expect(sha(badge), badge).not.toBe(DEFAULT_SHA)
            expect(chain.logo, 'teslim tablosundaki logo').toBe(badge)
        }
    })

    it('KONTROL: kilit ise yariyor: gercekten bilinmeyen token yedek simgeye duser ve kilidin denetimi bunu reddeder', () => {
        expect(privateTokenLogo({ chainId: 1, address: '0x' + '42'.repeat(20), symbol: 'USDT' })).toBe(UNKNOWN_TOKEN_LOGO)
        expect(privateTokenLogo({ chainId: 1, symbol: 'YOKTOKEN' })).toBe(UNKNOWN_TOKEN_LOGO)
        expect(() => expectRealLogo(UNKNOWN_TOKEN_LOGO, 'yedek')).toThrow()
        expect(() => expectRealLogo('/tokens/1/0x' + '00'.repeat(20) + '.png', 'olmayan dosya')).toThrow()
    })
})

// UCTAN UCA: teslim token secicisi her teslim agi ve her kipte (Gonder, Para yukle, Takas, Kopru) SUNUCU uzak gorselleriyle bile yalniz gercek logo cizer.
describe('PrivateDeliveryTokenPicker: her ag ve kipte hicbir satir gri yer tutucu cizmez', () => {
    const imgSrcs = (html) => [...html.matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/g)].map((m) => m[1])
    async function rowsOf(chainId, mode, remote) {
        installChromeStub({ active_account: { key: 'g-1' }, imported_tokens: {} })
        api.post = async () => ({ data: { tokens: remote } })
        const app = createApp(PrivateDeliveryTokenPicker, { props: { chainId, mode, nativeEnabled: true, selected: null, onSelect: () => {}, onClose: () => {} } })
        app.use(createTestPinia())
        app.use(createTestI18n())
        const html = await render(app)
        return html.split('<li').slice(1).filter((p) => p.includes('text-sm font-bold truncate')).map((p) => ({
            symbol: p.match(/<span class="block text-sm font-bold truncate">([^<]*)<\/span>/)?.[1],
            srcs: imgSrcs(p),
        }))
    }
    // Sunucunun bu agin icin dondurecegi satirlar: BUGUNKU gercek liste (snapshot; hepsi uzak gorselli gelir) + teslim edilebilir varliklar (kayit adresiyle)
    // + paketli logosu OLMAYAN bir sunucu satiri (NOLOGO): secici onu gri yer tutucuyla degil HIC cizmemeli.
    const NOLOGO = { address: getAddress('0x' + '42'.repeat(20)), symbol: 'NOLOGO', name: 'Logosuz', decimals: 18, image: { large: 'https://img.example/nologo.png' } }
    const remoteFor = (chainId) => {
        const fromList = SERVER_LIST.chains[String(chainId)].map((t) => ({ ...t, image: { large: 'https://img.example/' + t.symbol + '.png' } }))
        const seen = new Set(fromList.map((t) => t.address.toLowerCase()))
        const registry = selfDeliverableAssets(chainId)
            .map((symbol) => selfDeliveryTokenOf(chainId, symbol))
            .filter((t) => t.address !== ZERO && !seen.has(t.address.toLowerCase()))
            .map((t) => ({ address: t.address.toLowerCase(), symbol: t.symbol, name: t.symbol, decimals: t.decimals, image: { large: 'https://img.example/' + t.symbol + '.png' } }))
        return [...fromList, ...registry, NOLOGO]
    }

    for (const chain of DELIVERY_CHAINS) {
        for (const mode of ['send', 'fund', 'swap', 'bridge']) {
            it(`${chain.name} (${chain.chainId}) / ${mode}`, async () => {
                const rows = await rowsOf(chain.chainId, mode, remoteFor(chain.chainId))
                expect(rows.length, 'satir yok').toBeGreaterThan(0)
                expect(rows.map((r) => r.symbol)).toContain('USDC')
                expect(rows.map((r) => r.symbol), 'logosuz satir cizildi').not.toContain('NOLOGO')
                for (const r of rows) {
                    expect(r.srcs.length, `${r.symbol}: gorsel yok`).toBeGreaterThanOrEqual(1)
                    for (const src of r.srcs) expectRealLogo(src, `${chain.chainId}/${mode}/${r.symbol}`)
                    // Ilk gorsel tokenin logosu (ikincisi ag rozeti): yerel coin COININ logosu, token icin zincir logosu degil.
                    const first = r.srcs[0]
                    if (r.symbol === chain.nativeSymbol) expect(first, `${chain.chainId}/${mode}/${r.symbol}`).toBe(COIN_LOGO[chain.nativeSymbol])
                    else expect(first.startsWith('/chains/'), `${chain.chainId}/${mode}/${r.symbol}: token logosu ag logosu (${first})`).toBe(false)
                }
            })
        }
    }
})

// BUGUNKU SUNUCU LISTESI (test-utils/serverTokenList.snapshot.json: POST /getChainTokens skip 0 limit 100, 10 teslim agi, 2026-11-03): Gonder modunda
// secicinin gosterdigi her satirin PAKETLI gercek bir logosu olmali. KASITLI logosuzlar (sahip karari): logosu hicbir kaynakta olmayan Balancer LP tokeni (DLP) ve kare olmayan
// afis gorselli $GINI. Bu iki satir disinda logosuz satir KIRMIZIDIR; yeni bir sunucu satiri icin logo eklenmeli (client/scripts/gen-token-logos.mjs) ya da bilincli olarak buraya yazilmali.
// TOKENLASTIRILMIS HISSELER (xStock / Backed) artik kasitli logosuz SAYILMAZ: hisse teslimi gizli modda yasaktir (sahip karari 2026-10-23) ve secici onlari HISSE KURALIYLA
// (stockDelivery.isStockDeliveryToken: ticaret katalogu + deliveryStocks.js'teki 32 katalog disi adres) listeden cikarir, logo eksikligiyle degil. Asagidaki ilk test bunu kilitler.
describe('bugunku sunucu listesi: her satir paketli gercek logoya cozulur, kasitli logosuzlar gizli kalir', () => {
    const STOCK = /xstock|^backed /i
    const INTENTIONAL = new Set(['42161:0x32df62dc3aed2cd6224193052ce665dc18165841', '137:0xa1a39558718d6fa57c699dc45981e5a1b2e25d08'])
    const rowsOf = (chainId) => buildDeliveryTokenList({ chainId, nativeEnabled: true, remote: SERVER_LIST.chains[String(chainId)] })
    const intentional = (chainId, row) => INTENTIONAL.has(`${chainId}:${row.address.toLowerCase()}`)

    it('hisse satirlari (xStock / Backed, bugun 46): adres kuraliyla hisse sayilir, 32\'si ticaret katalogunda YOK ama yine elenir; secici listesinde hicbiri yok', () => {
        const stockRows = Object.entries(SERVER_LIST.chains).flatMap(([chainId, list]) => list.filter((t) => STOCK.test(t.name)).map((t) => ({ ...t, chainId: Number(chainId) })))
        expect(stockRows).toHaveLength(46)
        // Hepsi hisse kuraliyla (logoya bakilmadan) hisse.
        for (const row of stockRows) expect(isStockDeliveryToken(row.chainId, row.address), `${row.chainId}:${row.symbol}`).toBe(true)
        // Katalogun bilmedigi 32 (30 Arbitrum xStock + Polygon BCOIN, BNIU): eski kural bunlari kacirirdi, yeni liste yakalar.
        const catalogMisses = stockRows.filter((r) => stockEntry(r.chainId, r.address) === null && !isGeneralSwapExcluded(r.chainId, r.address))
        expect(catalogMisses).toHaveLength(32)
        expect(catalogMisses.filter((r) => r.chainId === 42161)).toHaveLength(30)
        expect(catalogMisses.filter((r) => r.chainId === 137).map((r) => r.symbol.toUpperCase()).sort()).toEqual(['BCOIN', 'BNIU'])
        for (const chain of DELIVERY_CHAINS) {
            const gone = new Set(stockRows.filter((r) => r.chainId === chain.chainId).map((r) => r.address.toLowerCase()))
            expect(rowsOf(chain.chainId).filter((t) => gone.has(t.address.toLowerCase())), String(chain.chainId)).toEqual([])
        }
    })

    it('snapshot 10 agin hepsini ve bugunku sayilari kapsar (bos snapshot yesil sayilmaz)', () => {
        expect(Object.keys(SERVER_LIST.chains).map(Number).sort((a, b) => a - b)).toEqual(DELIVERY_CHAINS.map((c) => c.chainId).sort((a, b) => a - b))
        const total = Object.values(SERVER_LIST.chains).reduce((n, l) => n + l.length, 0)
        expect(total).toBeGreaterThanOrEqual(600)
    })

    it('her sunucu satiri (kasitli logosuzlar haric) gercek paketli logoya cozulur ve hasPrivateLogo true', () => {
        const hatalar = []
        let checked = 0
        for (const chain of DELIVERY_CHAINS) {
            for (const row of rowsOf(chain.chainId)) {
                if (intentional(chain.chainId, row)) continue
                checked++
                const token = { chainId: chain.chainId, address: row.address, symbol: row.symbol }
                const label = `${chain.chainId}:${row.symbol}:${row.address}`
                if (!hasPrivateLogo(token)) { hatalar.push(`${label}: logosuz (secicide gizlenir)`); continue }
                try { expectRealLogo(privateTokenLogo(token), label) } catch (err) { hatalar.push(err.message) }
            }
        }
        expect(checked).toBeGreaterThanOrEqual(500)
        expect(hatalar).toEqual([])
    })

    it('kasitli logosuzlar (DLP, $GINI) gizli: yedek simgeye dusen ve secicide hic cizilmeyen satirlar; sayi sabit (hisseler artik burada degil)', () => {
        const hidden = []
        for (const chain of DELIVERY_CHAINS) {
            for (const row of rowsOf(chain.chainId)) {
                if (!intentional(chain.chainId, row)) continue
                expect(hasPrivateLogo({ chainId: chain.chainId, address: row.address, symbol: row.symbol }), `${chain.chainId}:${row.symbol}`).toBe(false)
                hidden.push(`${chain.chainId}:${row.symbol}`)
            }
        }
        expect(hidden.length).toBe(2)
    })
})

// HOME: BAKIYESI OLAN TOKEN ASLA GIZLENMEZ (para kayboldu gibi gorunmesin); yalniz KESIN sifir bakiyeli logosuz satir gizlenir.
describe('Home: bakiyesi olan token hicbir kosulda gizlenmez', () => {
    const LOGOSUZ = [
        { chainId: 56, address: '0x' + '42'.repeat(20), symbol: 'NOLOGO' },
        { chainId: 1, address: '0x' + '43'.repeat(20), symbol: 'USDT' }, // adres taklidi: gercek USDT degil
        { chainId: 99999, address: '0x' + '44'.repeat(20), symbol: 'X' },
    ]
    const BAKIYELER = [{ amount: 1 }, { amount: '0.000001' }, { amount: '25' }, { amount: 0, error: true }, { error: 'rpc' }, {}, undefined]
    const rowOfEntry = (e) => ({ chainId: e.chainId, address: e.address ?? ZERO, symbol: e.symbol })
    const listRows = () => DELIVERY_CHAINS.flatMap((chain) => buildDeliveryTokenList({ chainId: chain.chainId, nativeEnabled: true, remote: SERVER_LIST.chains[String(chain.chainId)] })
        .map((t) => ({ chainId: chain.chainId, address: t.address, symbol: t.symbol })))

    it('envanterdeki ve sunucu listesindeki HER satir, bakiyesi sifir degilken (ya da belirsizken) gorunur kalir', () => {
        const rows = [...inventory.map(rowOfEntry), ...LOGOSUZ, ...listRows()]
        expect(rows.length).toBeGreaterThan(600)
        for (const row of rows) {
            for (const b of BAKIYELER) {
                expect(hideLogolessZeroRows([row], () => b), `${row.chainId}:${row.symbol} ${JSON.stringify(b)}`).toHaveLength(1)
            }
        }
    })

    it('sifir bakiyede yalniz logosuz satir gizlenir; logolu satir (envanterin tamami) gorunur kalir', () => {
        for (const e of inventory) expect(hideLogolessZeroRows([rowOfEntry(e)], () => ({ amount: 0 })), `${e.chainId}:${e.symbol}`).toHaveLength(1)
        for (const row of LOGOSUZ) expect(hideLogolessZeroRows([row], () => ({ amount: '0' })), `${row.chainId}:${row.symbol}`).toHaveLength(0)
    })

    it('kaynak: Home ayni kurali kullanir (balanceOf = user.tokenBalances), satir logosu gizli modda TEK cozucudan', () => {
        const home = yorumsuz(readFileSync(fileURLToPath(new URL('../../components/Home.vue', import.meta.url)), 'utf8'))
        expect(home).toMatch(/hideLogolessZeroRows\(result, \(t\) => user\.tokenBalances\[t\.chainId \+ '_' \+ t\.address\]\)/)
        // Gizli modda satir logosu TEK cozucudan (privateTokenLogo): rowLogo yalniz onu cagirir ve yalniz gizli modda <img> olarak cizilir; normal modda
        // satir TokenAvatar'dir (components/TokenAvatar.vue, normal cozucu utils/tokenLogoSources.js; gizli mod cozucusunden bagimsiz).
        expect(home).toMatch(/const rowLogo = \(token\) => privateTokenLogo\(/)
        expect(home).toMatch(/v-if="privacy\.active" :src="rowLogo\(token\)"/)
    })
})

// BILESENLER YALNIZ COZUCUYU KULLANIR: token logosu yeniden icat edilemez (kaynak taramasi).
describe('gizli mod bilesenleri token logosunu yalniz TEK cozucuden alir', () => {
    const oku = (yol) => yorumsuz(readFileSync(fileURLToPath(new URL(yol, import.meta.url)), 'utf8'))
    const BILESENLER = ['PrivateTransfer.vue', 'PrivateDeliveryTokenPicker.vue', 'PrivateOrders.vue', 'PrivateAssetChip.vue', 'PrivateAssetPicker.vue', 'PrivateTokenLogo.vue']

    it.each(['PrivateTransfer.vue', 'PrivateDeliveryTokenPicker.vue', 'PrivateOrders.vue'])('%s privateTokenLogo cozucusunu kullanir; tokenLogo / sourceAssetLogo / orderTokenLogo / localTokenLogoPath import etmez', (ad) => {
        const kod = oku(`../../components/privacy/${ad}`)
        expect(kod).toMatch(/from '\.\.\/\.\.\/utils\/privacy\/privateTokenLogo'/)
        expect(kod).not.toMatch(/utils\/tokenLogo'/)
        expect(kod).not.toMatch(/\b(sourceAssetLogo|orderTokenLogo|sourceChainBadge|localTokenLogoPath)\b/)
    })

    it('bilesenlerde yedek simge yalniz yukleme hatasi (onerror) isleyicisinde; sablonda sabit /default-token.png src yok', () => {
        for (const ad of BILESENLER) {
            const kod = oku(`../../components/privacy/${ad}`)
            const sablon = kod.slice(0, kod.indexOf('<script'))
            expect(sablon, ad).not.toMatch(/src="\/default-token\.png"|:src="'\/default-token\.png'"/)
        }
    })

    it('eski uretilmis kopyalar kalmadi: sourceAssets.js ve privateDefaultTokens.js logo yolu uretmez', () => {
        const kaynak = oku('./sourceAssets.js')
        expect(kaynak).not.toMatch(/default-token|localTokenLogoPath|chainLogo/)
        const tohum = oku('./privateDefaultTokens.js')
        expect(tohum).not.toMatch(/`\/chains\/\$\{/)
    })
})
