import { describe, it, expect, vi } from 'vitest'
import { ethers, getAddress } from 'ethers'
import {
    BRIDGE_QUOTES_KEY, BRIDGE_QUOTE_TTL_MS, BRIDGE_QUOTE_MAX, BRIDGE_RECEIVER_MISMATCH, BRIDGE_QUOTE_NOT_FOUND,
    isBridgeQuoteRefusal, bridgeQuoteKey, rememberBridgeQuote, assertBridgeQuoteBound,
} from './bridgeQuoteGuard'

const SIGNER = getAddress('0x' + 'ab'.repeat(20))
const OTHER = getAddress('0x' + 'cd'.repeat(20))
const ROUTER = getAddress('0x' + '5a'.repeat(20))
const SPENDER = getAddress('0x' + '6b'.repeat(20))
const DATA = '0x' + 'AB'.repeat(36)
const T0 = 1_000_000_000_000

// chrome.storage.session benzeri sahte depo. `yield`: get'ten sonra bir makro gorev bekler; kuyruksuz iki yazici
// ayni eski haritayi okuyup birbirinin kaydini silerdi (es zamanlilik testi).
function fakeSession(initial = {}, { yieldOnGet = false } = {}) {
    const store = { ...initial }
    return {
        store,
        get: vi.fn(async (key) => {
            const out = { [key]: structuredClone(store[key]) }
            if (yieldOnGet) await new Promise((r) => setImmediate(r))
            return out
        }),
        set: vi.fn(async (obj) => { Object.assign(store, structuredClone(obj)) }),
    }
}

// LI.FI /quote yanitinin bu modulun okudugu parcalari.
// to / from ACIKCA undefined verilirse alan yanitta HIC yoktur (varsayilan parametre bunu ezerdi).
function lifi(opts = {}) {
    const { tx = {}, estimate = {} } = opts
    const to = 'to' in opts ? opts.to : SIGNER
    const from = 'from' in opts ? opts.from : SIGNER
    const action = { fromChainId: 56, toChainId: 137 }
    if (to !== undefined) action.toAddress = to
    if (from !== undefined) action.fromAddress = from
    return {
        action,
        estimate: { approvalAddress: SPENDER, ...estimate },
        transactionRequest: { from: SIGNER, to: ROUTER, chainId: 56, data: DATA, value: '0x0', ...tx },
    }
}

const remember = (session, over = {}) => rememberBridgeQuote(session, { fromChain: 56, quote: lifi(), signer: SIGNER, now: T0, ...over })
const bound = (session, over = {}) => assertBridgeQuoteBound(session, {
    chain: 56, to: ROUTER, data: DATA, value: '0x0', approvalAddress: undefined, signer: SIGNER, now: T0 + 1000, ...over,
})
const reason = async (promise) => { try { await promise } catch (e) { return e.message } return null }

describe('bridgeQuoteKey', () => {
    it('anahtar ethers.id(JSON([zincir, to, data, value])): to ve data kucuk harf, value dizge', () => {
        const beklenen = ethers.id(JSON.stringify([56, ROUTER.toLowerCase(), DATA.toLowerCase(), '0x0']))
        expect(bridgeQuoteKey(56, ROUTER, DATA, '0x0')).toBe(beklenen)
        expect(beklenen).toMatch(/^0x[0-9a-f]{64}$/)
    })

    it('harf buyuklugu (to, data) ve zincirin dizge/sayi olmasi anahtari DEGISTIRMEZ', () => {
        const ref = bridgeQuoteKey(56, ROUTER, DATA, '0x0')
        expect(bridgeQuoteKey('56', ROUTER.toLowerCase(), DATA.toUpperCase().replace('0X', '0x'), '0x0')).toBe(ref)
        expect(bridgeQuoteKey(56, ROUTER.toUpperCase().replace('0X', '0x'), DATA.toLowerCase(), '0x0')).toBe(ref)
    })

    it('value dizgeye cevrilir: sayi 0 ile "0" ayni, "0x0" farkli; eksik value bos dizge', () => {
        expect(bridgeQuoteKey(56, ROUTER, DATA, 0)).toBe(bridgeQuoteKey(56, ROUTER, DATA, '0'))
        expect(bridgeQuoteKey(56, ROUTER, DATA, '0x0')).not.toBe(bridgeQuoteKey(56, ROUTER, DATA, '0'))
        expect(bridgeQuoteKey(56, ROUTER, DATA, undefined)).toBe(bridgeQuoteKey(56, ROUTER, DATA, ''))
        expect(bridgeQuoteKey(56, ROUTER, DATA, null)).toBe(bridgeQuoteKey(56, ROUTER, DATA, ''))
    })

    it('zincir, to, data ya da value farki farkli anahtar uretir (ayni calldata baska zincirde gecmez)', () => {
        const ref = bridgeQuoteKey(56, ROUTER, DATA, '0x0')
        expect(bridgeQuoteKey(1, ROUTER, DATA, '0x0')).not.toBe(ref)
        expect(bridgeQuoteKey(56, OTHER, DATA, '0x0')).not.toBe(ref)
        expect(bridgeQuoteKey(56, ROUTER, DATA + '00', '0x0')).not.toBe(ref)
        expect(bridgeQuoteKey(56, ROUTER, DATA, '0x1')).not.toBe(ref)
    })

    it('cozulemeyen girdi null verir', () => {
        for (const chain of [undefined, null, '', 'abc', 0, -1, 1.5, NaN]) {
            expect(bridgeQuoteKey(chain, ROUTER, DATA, '0x0'), String(chain)).toBeNull()
        }
        for (const to of [undefined, null, '', 42, {}]) expect(bridgeQuoteKey(56, to, DATA, '0x0')).toBeNull()
        for (const data of [undefined, null, 42, {}]) expect(bridgeQuoteKey(56, ROUTER, data, '0x0')).toBeNull()
    })
})

describe('isBridgeQuoteRefusal', () => {
    it('yalniz iki kod', () => {
        expect(isBridgeQuoteRefusal('BRIDGE_RECEIVER_MISMATCH')).toBe(true)
        expect(isBridgeQuoteRefusal('BRIDGE_QUOTE_NOT_FOUND')).toBe(true)
        for (const v of [undefined, null, '', 'PRIVATE_QUOTE_NOT_FOUND', 'bridge_quote_not_found', 'Unsupported chain']) {
            expect(isBridgeQuoteRefusal(v), String(v)).toBe(false)
        }
    })
})

describe('rememberBridgeQuote: alici imzaciya bagli olmali', () => {
    it('gecerli teklif { signer, approval, createdAt } kaydi yazar; approval estimate.approvalAddress', async () => {
        const session = fakeSession()
        await remember(session)
        const key = bridgeQuoteKey(56, ROUTER, DATA, '0x0')
        expect(Object.keys(session.store[BRIDGE_QUOTES_KEY])).toEqual([key])
        expect(session.store[BRIDGE_QUOTES_KEY][key]).toEqual({ signer: SIGNER, approval: SPENDER, createdAt: T0 })
    })

    it('estimate.approvalAddress yoksa approval transactionRequest.to; bos dizge de yok sayilir', async () => {
        for (const approvalAddress of [undefined, '', null]) {
            const session = fakeSession()
            await remember(session, { quote: lifi({ estimate: { approvalAddress } }) })
            expect(Object.values(session.store[BRIDGE_QUOTES_KEY])[0].approval, String(approvalAddress)).toBe(ROUTER)
        }
    })

    it('harf buyuklugu: LI.FI kucuk harfli toAddress/fromAddress dondurse da teklif gecer', async () => {
        const session = fakeSession()
        await remember(session, { quote: lifi({ to: SIGNER.toLowerCase(), from: SIGNER.toLowerCase() }) })
        expect(Object.keys(session.store[BRIDGE_QUOTES_KEY])).toHaveLength(1)
    })

    it('fromAddress yanitta yoksa teklif gecer (toAddress zorunlu, fromAddress opsiyonel)', async () => {
        const session = fakeSession()
        await remember(session, { quote: lifi({ from: undefined }) })
        expect(Object.keys(session.store[BRIDGE_QUOTES_KEY])).toHaveLength(1)
    })

    it('toAddress baska adres / yok / dizge degil: BRIDGE_RECEIVER_MISMATCH ve depoya YAZILMAZ', async () => {
        for (const to of [OTHER, undefined, '', null, 42, {}, [SIGNER], SIGNER + ' ']) {
            const session = fakeSession()
            expect(await reason(remember(session, { quote: lifi({ to }) })), JSON.stringify(to)).toBe(BRIDGE_RECEIVER_MISMATCH)
            expect(session.set).not.toHaveBeenCalled()
        }
    })

    it('fromAddress var ama imzaci degilse (toAddress dogru olsa bile) BRIDGE_RECEIVER_MISMATCH', async () => {
        for (const from of [OTHER, '', null, 7]) {
            const session = fakeSession()
            expect(await reason(remember(session, { quote: lifi({ from }) })), JSON.stringify(from)).toBe(BRIDGE_RECEIVER_MISMATCH)
            expect(session.set).not.toHaveBeenCalled()
        }
    })

    it('imzaci bos/dizge degilse hicbir teklif gecmez', async () => {
        for (const signer of [undefined, null, '', 5]) {
            const session = fakeSession()
            expect(await reason(remember(session, { signer })), String(signer)).toBe(BRIDGE_RECEIVER_MISMATCH)
            expect(session.set).not.toHaveBeenCalled()
        }
    })

    it('eksik/bozuk LI.FI yaniti (transactionRequest, to, data yok; action yok) hata kodu BRIDGE_RECEIVER_MISMATCH, ham TypeError DEGIL', async () => {
        const kotu = [
            undefined, null, {}, { action: null }, { action: {} },
            { ...lifi(), transactionRequest: undefined },
            { ...lifi(), transactionRequest: null },
            lifi({ tx: { to: undefined } }),
            lifi({ tx: { to: '' } }),
            lifi({ tx: { data: undefined } }),
            lifi({ tx: { data: 5 } }),
        ]
        for (const quote of kotu) {
            const session = fakeSession()
            expect(await reason(remember(session, { quote })), JSON.stringify(quote)).toBe(BRIDGE_RECEIVER_MISMATCH)
            expect(session.set).not.toHaveBeenCalled()
        }
    })

    it('zincir cozulemezse kayit yazilmaz', async () => {
        const session = fakeSession()
        expect(await reason(remember(session, { fromChain: undefined }))).toBe(BRIDGE_RECEIVER_MISMATCH)
        expect(session.set).not.toHaveBeenCalled()
    })
})

describe('rememberBridgeQuote: omur ve tavan', () => {
    it('ayni teklif yeniden yazilirsa kayit cogalmaz, createdAt tazelenir', async () => {
        const session = fakeSession()
        await remember(session, { now: T0 })
        await remember(session, { now: T0 + 60_000 })
        const entries = Object.values(session.store[BRIDGE_QUOTES_KEY])
        expect(entries).toHaveLength(1)
        expect(entries[0].createdAt).toBe(T0 + 60_000)
    })

    it('21. kayit EN ESKIYI duser, yenisini asla; tam BRIDGE_QUOTE_MAX kayit kalir', async () => {
        const session = fakeSession()
        const keys = []
        for (let i = 0; i < BRIDGE_QUOTE_MAX + 1; i++) {
            const data = '0x' + i.toString(16).padStart(2, '0')
            keys.push(bridgeQuoteKey(56, ROUTER, data, '0x0'))
            await remember(session, { quote: lifi({ tx: { data } }), now: T0 + i * 1000 })
        }
        const kalan = Object.keys(session.store[BRIDGE_QUOTES_KEY])
        expect(kalan).toHaveLength(BRIDGE_QUOTE_MAX)
        expect(kalan).not.toContain(keys[0])
        expect(kalan).toContain(keys[BRIDGE_QUOTE_MAX])
        expect(kalan).toEqual(keys.slice(1))
    })

    it('omru dolan kayitlar yazimda temizlenir; omru dolmamis olanlar kalir', async () => {
        const session = fakeSession()
        await remember(session, { quote: lifi({ tx: { data: '0x01' } }), now: T0 })
        await remember(session, { quote: lifi({ tx: { data: '0x02' } }), now: T0 + BRIDGE_QUOTE_TTL_MS - 1 })
        await remember(session, { quote: lifi({ tx: { data: '0x03' } }), now: T0 + BRIDGE_QUOTE_TTL_MS })
        expect(Object.keys(session.store[BRIDGE_QUOTES_KEY])).toEqual([
            bridgeQuoteKey(56, ROUTER, '0x02', '0x0'),
            bridgeQuoteKey(56, ROUTER, '0x03', '0x0'),
        ])
    })

    it('bozuk depo icerigi (nesne olmayan, dizi, imzacisiz kayit) yazimi bozmaz ve temizlenir', async () => {
        for (const bozuk of ['x', 5, null, [1, 2], { a: null, b: 'x', c: { createdAt: T0 }, d: { signer: SIGNER } }]) {
            const session = fakeSession({ [BRIDGE_QUOTES_KEY]: bozuk })
            await remember(session)
            expect(Object.keys(session.store[BRIDGE_QUOTES_KEY]), JSON.stringify(bozuk)).toEqual([bridgeQuoteKey(56, ROUTER, DATA, '0x0')])
        }
    })

    it('ES ZAMANLI uc yazim (popup + yan panel + baska bir istek): uclusu de kalir, biri digerini silmez', async () => {
        const session = fakeSession({}, { yieldOnGet: true })
        await Promise.all([
            remember(session, { quote: lifi({ tx: { data: '0xaa' } }), now: T0 }),
            remember(session, { quote: lifi({ tx: { data: '0xbb' } }), now: T0 + 1 }),
            remember(session, { quote: lifi({ tx: { data: '0xcc' } }), now: T0 + 2 }),
        ])
        expect(Object.keys(session.store[BRIDGE_QUOTES_KEY]).sort()).toEqual([
            bridgeQuoteKey(56, ROUTER, '0xaa', '0x0'),
            bridgeQuoteKey(56, ROUTER, '0xbb', '0x0'),
            bridgeQuoteKey(56, ROUTER, '0xcc', '0x0'),
        ].sort())
    })

    it('yazim hatasi sonraki yazimi tikamaz', async () => {
        const session = fakeSession()
        session.set.mockRejectedValueOnce(new Error('depo dolu'))
        expect(await reason(remember(session))).toBe('depo dolu')
        await remember(session, { quote: lifi({ tx: { data: '0x02' } }) })
        expect(Object.keys(session.store[BRIDGE_QUOTES_KEY])).toHaveLength(1)
    })
})

describe('assertBridgeQuoteBound', () => {
    async function seeded(over = {}) {
        const session = fakeSession()
        await remember(session, over)
        return session
    }

    it('kayitli teklif, ayni imzaci: gecer (onay adresi verilmese de)', async () => {
        const session = await seeded()
        await expect(bound(session)).resolves.toBeUndefined()
    })

    it('kayit yok (bos depo, baska to/data/value, baska zincir): BRIDGE_QUOTE_NOT_FOUND', async () => {
        const session = await seeded()
        expect(await reason(bound(fakeSession()))).toBe(BRIDGE_QUOTE_NOT_FOUND)
        expect(await reason(bound(session, { to: OTHER }))).toBe(BRIDGE_QUOTE_NOT_FOUND)
        expect(await reason(bound(session, { data: DATA + '00' }))).toBe(BRIDGE_QUOTE_NOT_FOUND)
        expect(await reason(bound(session, { value: '0x1' }))).toBe(BRIDGE_QUOTE_NOT_FOUND)
        expect(await reason(bound(session, { chain: 1 }))).toBe(BRIDGE_QUOTE_NOT_FOUND)
    })

    it('anahtar kurulamayan mesaj (zincir/to/data yok): BRIDGE_QUOTE_NOT_FOUND, depoya bakmadan', async () => {
        const session = await seeded()
        session.get.mockClear()
        expect(await reason(bound(session, { chain: undefined }))).toBe(BRIDGE_QUOTE_NOT_FOUND)
        expect(await reason(bound(session, { to: undefined }))).toBe(BRIDGE_QUOTE_NOT_FOUND)
        expect(await reason(bound(session, { data: undefined }))).toBe(BRIDGE_QUOTE_NOT_FOUND)
        expect(session.get).not.toHaveBeenCalled()
    })

    it('harf farki ve dizge zincir ayni kaydi bulur', async () => {
        const session = await seeded()
        await expect(bound(session, { chain: '56', to: ROUTER.toLowerCase(), data: DATA.toLowerCase() })).resolves.toBeUndefined()
    })

    it('imzaci farkli: BRIDGE_RECEIVER_MISMATCH (mod/hesap degisti); harf farki sayilmaz', async () => {
        const session = await seeded()
        expect(await reason(bound(session, { signer: OTHER }))).toBe(BRIDGE_RECEIVER_MISMATCH)
        await expect(bound(session, { signer: SIGNER.toLowerCase() })).resolves.toBeUndefined()
        for (const signer of [undefined, null, '', 5]) {
            expect(await reason(bound(session, { signer })), String(signer)).toBe(BRIDGE_RECEIVER_MISMATCH)
        }
    })

    it('onay adresi (ATS kolu): kayittakine esitse gecer (harf duyarsiz), farkliysa BRIDGE_RECEIVER_MISMATCH', async () => {
        const session = await seeded()
        await expect(bound(session, { approvalAddress: SPENDER })).resolves.toBeUndefined()
        await expect(bound(session, { approvalAddress: SPENDER.toLowerCase() })).resolves.toBeUndefined()
        expect(await reason(bound(session, { approvalAddress: OTHER }))).toBe(BRIDGE_RECEIVER_MISMATCH)
        expect(await reason(bound(session, { approvalAddress: ROUTER }))).toBe(BRIDGE_RECEIVER_MISMATCH)
        expect(await reason(bound(session, { approvalAddress: { x: 1 } }))).toBe(BRIDGE_RECEIVER_MISMATCH)
    })

    it('bos/yok onay adresi denetlenmez (buildBridgeCalls `approvalAddress || to` der, to anahtarla bagli)', async () => {
        const session = await seeded()
        for (const approvalAddress of [undefined, null, '']) {
            await expect(bound(session, { approvalAddress }), String(approvalAddress)).resolves.toBeUndefined()
        }
    })

    it('kayitta estimate.approvalAddress yoksa onay adresi to ile karsilastirilir', async () => {
        const session = await seeded({ quote: lifi({ estimate: { approvalAddress: undefined } }) })
        await expect(bound(session, { approvalAddress: ROUTER })).resolves.toBeUndefined()
        expect(await reason(bound(session, { approvalAddress: SPENDER }))).toBe(BRIDGE_RECEIVER_MISMATCH)
    })

    it('OMUR: 9 dk 59.999 sn gecer; tam 10 dk reddedilir', async () => {
        const session = await seeded()
        await expect(bound(session, { now: T0 + BRIDGE_QUOTE_TTL_MS - 1 })).resolves.toBeUndefined()
        expect(await reason(bound(session, { now: T0 + BRIDGE_QUOTE_TTL_MS }))).toBe(BRIDGE_QUOTE_NOT_FOUND)
        expect(await reason(bound(session, { now: T0 + 24 * 3600 * 1000 }))).toBe(BRIDGE_QUOTE_NOT_FOUND)
    })

    it('SAAT GERI ALINIRSA (negatif yas) kayit kanitlanamaz: BRIDGE_QUOTE_NOT_FOUND', async () => {
        const session = await seeded()
        expect(await reason(bound(session, { now: T0 - 1 }))).toBe(BRIDGE_QUOTE_NOT_FOUND)
    })

    it('bozuk depo: nesne olmayan, imzacisiz, createdAt sayi olmayan kayit BRIDGE_QUOTE_NOT_FOUND (fail-closed)', async () => {
        const key = bridgeQuoteKey(56, ROUTER, DATA, '0x0')
        const depolar = [
            undefined, null, 'x', 5, [],
            { [key]: null }, { [key]: 'x' }, { [key]: [] },
            { [key]: { approval: SPENDER, createdAt: T0 } },
            { [key]: { signer: 5, approval: SPENDER, createdAt: T0 } },
            { [key]: { signer: SIGNER, approval: SPENDER } },
            { [key]: { signer: SIGNER, approval: SPENDER, createdAt: String(T0) } },
            { [key]: { signer: SIGNER, approval: SPENDER, createdAt: NaN } },
        ]
        for (const bozuk of depolar) {
            const session = fakeSession({ [BRIDGE_QUOTES_KEY]: bozuk })
            expect(await reason(bound(session)), JSON.stringify(bozuk)).toBe(BRIDGE_QUOTE_NOT_FOUND)
        }
    })

    // Deponun PROTOTIPINDE duran bir kayit (kendi ozelligi degil) gecerli sayilmaz. Gercek chrome.storage duz
    // JSON dondurur; bu test assertBridgeQuoteBound'daki hasOwnProperty savunmasinin KENDISINI olcer (anahtarlar
    // 0x ozetleridir, "constructor" gibi adlarla carpisamaz; bu yuzden miras ancak boyle kurulabilir).
    it('miras alinan (prototip) kayit sayilmaz: yalniz deponun KENDI kayitlari', async () => {
        const key = bridgeQuoteKey(56, ROUTER, DATA, '0x0')
        const miras = Object.create({ [key]: { signer: SIGNER, approval: SPENDER, createdAt: T0 } })
        const session = { get: vi.fn(async () => ({ [BRIDGE_QUOTES_KEY]: miras })), set: vi.fn() }
        expect(miras[key], 'on kosul: kayit prototipte gorunuyor').toMatchObject({ signer: SIGNER })
        expect(await reason(bound(session))).toBe(BRIDGE_QUOTE_NOT_FOUND)
    })

    it('depo okuma hatasi yayilir (kayit varsayilmaz)', async () => {
        const session = fakeSession()
        session.get.mockRejectedValueOnce(new Error('depo okunamadi'))
        expect(await reason(bound(session))).toBe('depo okunamadi')
    })
})
