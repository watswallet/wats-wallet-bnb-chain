import { describe, it, expect, vi, afterEach } from 'vitest'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { TYPED_DATA_USER_REJECT_MESSAGE } from './utils/eip712/errors'
import { approvalRejectionFor, privacyBlockResponse, privacyDecision } from './utils/privacy/privacyGate'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

// WalletConnect 1.8.3 (main) birlesmesi: yeni dapp yuzeyinin GIZLI MODDAKI davranisi -- GERCEK
// dagitici uzerinden. Degmez kural: gizli modda her site "bagli degil" gorunur ve sayfaya donen
// HER cevap, normal modda hibesi OLMAYAN bir sitenin alacagi cevapla BAYT BAYT aynidir (cevap
// farki modu sizdirir). Karsilastirma: normal mod + hic baglanmamis site  <->  gizli mod + hem
// baglanmamis hem Genel hesapla baglanmis site.

const GIZLI = { key: 'g-1', address: '0x' + 'cd'.repeat(20), type: 'hd', private: true, derivationPath: "m/44'/60'/0'/1/0" }
const A = { key: 'a-1', address: '0x' + 'ab'.repeat(20), type: 'hd' }
const BAGLI_SENDER = { url: 'https://site.example/app', origin: 'https://site.example', tab: { id: 3, url: 'https://site.example/app' } }
const YABANCI_SENDER = { url: 'https://yabanci.example/', origin: 'https://yabanci.example', tab: { id: 5, url: 'https://yabanci.example/' } }
const NOKTASIZ_SENDER = { url: 'http://localhost:3000/', origin: 'http://localhost:3000', tab: { id: 6, url: 'http://localhost:3000/' } }
const ETH = { chainId: 1, name: 'Ethereum' }
const BSC = { chainId: 56, name: 'BNB Smart Chain' }
const TON = { chainId: -239, kind: 'ton', name: 'TON' }
const FROZEN = 'privacy_frozen_network'

const TYPED = JSON.stringify({
    types: { EIP712Domain: [{ name: 'name', type: 'string' }], Mail: [{ name: 'c', type: 'string' }] },
    primaryType: 'Mail', domain: { name: 'x' }, message: { c: 'hi' },
})

let bg, localStore
const callHandler = (...args) => bg.call(...args)
const sakinles = () => new Promise((resolve) => setTimeout(resolve, 20))

async function boot({ active = A, extra = {}, tabs, flag = 'true' } = {}) {
    localStore = {
        active_account: active,
        vaults: [{ type: 'hd', accounts: [A], privateAccount: GIZLI }],
        currentNetwork: BSC,
        dapps: { 'site.example': { accounts: [A.address], chainId: '0x38', origin: 'https://site.example' } },
        solana_dapps: {},
        ...extra,
    }
    bg = await bootBackground({ privacyFlag: flag, localStore, sessionStore: {}, ...(tabs ? { tabs } : {}) })
    await sakinles()
    chrome.tabs.sendMessage.mockClear()
}

afterEach(async () => {
    await sakinles()
    teardownBackground()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

// Ayni istegin (a) normal modda hibesi olmayan sitedeki, (b) gizli modda iki sitedeki cevabi.
async function esitlik(mesaj, { frozen } = {}) {
    await boot({ active: A })
    const taban = await callHandler(mesaj, YABANCI_SENDER)
    await sakinles()
    teardownBackground()

    const gizliler = []
    for (const sender of [YABANCI_SENDER, BAGLI_SENDER]) {
        await boot({ active: GIZLI, ...(frozen ? { extra: { [FROZEN]: frozen } } : {}) })
        gizliler.push(await callHandler(mesaj, sender))
        await sakinles()
        teardownBackground()
    }
    return { taban, gizliler }
}

describe('eth_signTypedData_v4 -- gizli modda her site "bagli degil"', () => {
    const gecerli = { method: 'eth_signTypedData_v4', params: [A.address, TYPED] }

    // T29 M3: eskiden tek it() icinde background.js UC kez ayaga kalkiyordu (normal + iki gizli) ve yukte 30 sn'yi
    // asiyordu. Simdi uc ayri it(), her biri BIR acilis; esitlik, normal modun sabit cevabina (TABAN_4100) karsi sinanir.
    const TABAN_4100 = { error: { code: 4100, message: 'The requested account and/or method has not been authorized by the user.' } }

    it('gecerli istek, normal mod: hibesi olmayan (baglanmamis) site 4100 alir -- gizli mod karsilastirma tabani', async () => {
        await boot({ active: A })
        const taban = await callHandler(gecerli, YABANCI_SENDER)
        expect(taban.error.code).toBe(4100)
        expect(taban).toEqual(TABAN_4100)
    })

    it('gecerli istek, gizli mod: baglanmamis site normal modun 4100 cevabinin AYNISINI alir', async () => {
        await boot({ active: GIZLI })
        const res = await callHandler(gecerli, YABANCI_SENDER)
        expect(res).toEqual(TABAN_4100)
    })

    it('gecerli istek, gizli mod: Genel hesapla BAGLI site de AYNI 4100 cevabini alir, pencere acilmaz', async () => {
        await boot({ active: GIZLI })
        const res = await callHandler(gecerli, BAGLI_SENDER)
        expect(res).toEqual(TABAN_4100)
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    it('bagli site icin pencere ACILMAZ (gizli modda)', async () => {
        await boot({ active: GIZLI })
        const res = await callHandler(gecerli, BAGLI_SENDER)
        expect(res.error.code).toBe(4100)
        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(localStore.current_request).toBeUndefined()
    })

    it('bozuk parametre: iki modda ayni hata (hibeden once dogrulanir)', async () => {
        const { taban, gizliler } = await esitlik({ method: 'eth_signTypedData_v4', params: [] })
        expect(taban.error.code).not.toBe(4100)
        for (const g of gizliler) expect(g).toEqual(taban)
    })

    it('EVM disi (TON) donmus zincirde iki modda ayni 4901', async () => {
        await boot({ active: A, extra: { currentNetwork: TON } })
        const taban = await callHandler(gecerli, YABANCI_SENDER)
        teardownBackground()
        await boot({ active: GIZLI, extra: { [FROZEN]: TON, currentNetwork: BSC } })
        const gizli = await callHandler(gecerli, BAGLI_SENDER)
        expect(taban.error.code).toBe(4901)
        expect(gizli).toEqual(taban)
    })

    it('SIGN_TYPED_DATA_CONFIRM sayfadan gelirse iki modda ayni 4100 (ic aksiyon)', async () => {
        const mesaj = { type: 'SIGN_TYPED_DATA_CONFIRM', message: { requestId: 'r', expectedDigest: '0x00', account: GIZLI } }
        await boot({ active: A })
        const normal = await callHandler(mesaj, YABANCI_SENDER)
        teardownBackground()
        await boot({ active: GIZLI })
        const gizli = await callHandler(mesaj, YABANCI_SENDER)
        expect(normal).toEqual({ error: { code: 4100, message: 'Unauthorized' } })
        expect(gizli).toEqual(normal)
    })

    it('SIGN_TYPED_DATA_CONFIRM arayuzden: gizli modda ENGELLENIR (imza uretilmez), genel modda Gizli imzaci reddedilir', async () => {
        await boot({ active: GIZLI })
        const gizli = await callHandler({ type: 'SIGN_TYPED_DATA_CONFIRM', message: { requestId: 'r', expectedDigest: '0x00', account: GIZLI } })
        expect(gizli).toEqual({ success: false, error: 'PRIVATE_USE_PRIVATE_SEND' })
        teardownBackground()
        await boot({ active: A })
        const genel = await callHandler({ type: 'SIGN_TYPED_DATA_CONFIRM', message: { requestId: 'r', expectedDigest: '0x00', account: GIZLI } })
        expect(genel).toEqual({ success: false, error: 'PRIVATE_ACCOUNT_IN_PUBLIC_MODE' })
    })
})

describe('eth_sendTransaction / personal_sign -- hiz siniri ve parametre dogrulamasi iki modda ayni', () => {
    it('bozuk params: normal modda hibesiz site ile gizli modda AYNI -32602 (4100\'e kisayol YOK)', async () => {
        for (const mesaj of [
            { method: 'eth_sendTransaction', params: [] },
            { method: 'personal_sign', params: [] },
        ]) {
            const { taban, gizliler } = await esitlik(mesaj)
            expect(taban.error.code, mesaj.method).toBe(-32602)
            for (const g of gizliler) expect(g, mesaj.method).toEqual(taban)
        }
    })

    it('gecerli istek: iki modda AYNI 4100, bagli site icin pencere acilmaz', async () => {
        for (const mesaj of [
            { method: 'eth_sendTransaction', params: [{ from: A.address, to: A.address }] },
            { method: 'personal_sign', params: ['0x68656c6c6f', A.address] },
        ]) {
            const { taban, gizliler } = await esitlik(mesaj)
            expect(taban.error.code, mesaj.method).toBe(4100)
            for (const g of gizliler) expect(g, mesaj.method).toEqual(taban)
        }
        await boot({ active: GIZLI })
        await callHandler({ method: 'personal_sign', params: ['0x68656c6c6f', A.address] }, BAGLI_SENDER)
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    it('EVM disi (TON) donmus zincirde iki modda ayni 4901: kapi DONMUS zincire bakar, canli aga degil', async () => {
        for (const mesaj of [
            { method: 'eth_sendTransaction', params: [{ from: A.address, to: A.address }] },
            { method: 'personal_sign', params: ['0x68656c6c6f', A.address] },
        ]) {
            await boot({ active: A, extra: { currentNetwork: TON } })
            const taban = await callHandler(mesaj, YABANCI_SENDER)
            teardownBackground()
            await boot({ active: GIZLI, extra: { [FROZEN]: TON, currentNetwork: BSC } })
            const gizli = await callHandler(mesaj, BAGLI_SENDER)
            teardownBackground()
            expect(taban.error.code, mesaj.method).toBe(4901)
            expect(gizli, mesaj.method).toEqual(taban)
        }
    })
})

describe('wallet_getPermissions / wallet_revokePermissions -- gizli modda her site "bagli degil"', () => {
    it('wallet_getPermissions: bagli site bile [] alir (Genel hesap adresi caveat\'ta sizmaz)', async () => {
        const { taban, gizliler } = await esitlik({ method: 'wallet_getPermissions' })
        expect(taban).toEqual({ result: [] })
        for (const g of gizliler) expect(g).toEqual(taban)
    })

    it('normal modda ayni bagli site izin listesini alir (kontrol: gizli mod farki gercekten gizli moddan gelir)', async () => {
        await boot({ active: A })
        const res = await callHandler({ method: 'wallet_getPermissions' }, BAGLI_SENDER)
        expect(res.result.length).toBeGreaterThan(0)
        expect(JSON.stringify(res)).toContain(A.address)
    })

    it('wallet_revokePermissions: baglanmamis siteyle AYNI cevap; bagli sitenin hibesi SILINMEZ, olay GITMEZ', async () => {
        const mesaj = { method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }
        const { taban, gizliler } = await esitlik(mesaj)
        expect(taban).toEqual({ result: null })
        for (const g of gizliler) expect(g).toEqual(taban)

        await boot({ active: GIZLI, tabs: [{ id: 3, url: 'https://site.example/app' }] })
        const dappsOnce = structuredClone(localStore.dapps)
        await callHandler(mesaj, BAGLI_SENDER)
        await sakinles()
        expect(localStore.dapps).toEqual(dappsOnce)
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
    })

    it('wallet_revokePermissions bozuk parametre: iki modda ayni hata', async () => {
        const { taban, gizliler } = await esitlik({ method: 'wallet_revokePermissions', params: [] })
        expect(taban.error).toBeDefined()
        for (const g of gizliler) expect(g).toEqual(taban)
    })

    it('normal modda revoke bagli sitenin hibesini siler (kontrol)', async () => {
        await boot({ active: A })
        await callHandler({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }, BAGLI_SENDER)
        expect(localStore.dapps['site.example']).toBeUndefined()
    })
})

describe('net_version ve salt-okuma -- siteler gizli modda DONMUS zinciri gorur', () => {
    it('net_version donmus zincirin kimligini verir, canli agi DEGIL', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: BSC } })
        expect(await callHandler({ method: 'net_version' }, BAGLI_SENDER)).toEqual({ result: '1' })
        expect(await callHandler({ method: 'eth_chainId' }, BAGLI_SENDER)).toEqual({ result: '0x1' })
    })

    it('normal modda net_version canli agi verir (kontrol)', async () => {
        await boot({ active: A, extra: { currentNetwork: BSC } })
        expect(await callHandler({ method: 'net_version' }, BAGLI_SENDER)).toEqual({ result: '56' })
    })

    it('gizli modda salt-okuma DONMUS zincirin RPC\'sine gider; normal modda ayni zincirdeki okumayla ayni uc', async () => {
        const urller = []
        vi.stubGlobal('fetch', vi.fn(async (url) => { urller.push(String(url)); throw new Error('ag kapali') }))
        vi.spyOn(console, 'error').mockImplementation(() => {})

        await boot({ active: A, extra: { currentNetwork: ETH } })
        await callHandler({ method: 'eth_blockNumber' }, BAGLI_SENDER)
        const normalUrl = urller.splice(0)
        teardownBackground()

        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: BSC } })
        await callHandler({ method: 'eth_blockNumber' }, BAGLI_SENDER)
        const gizliUrl = urller.splice(0)

        expect(normalUrl.length).toBeGreaterThan(0)
        expect(gizliUrl).toEqual(normalUrl)
    })

    it('donmus zincir EVM disiysa (TON) okuma iki modda ayni 4901', async () => {
        await boot({ active: A, extra: { currentNetwork: TON } })
        const taban = await callHandler({ method: 'eth_blockNumber' }, YABANCI_SENDER)
        teardownBackground()
        await boot({ active: GIZLI, extra: { [FROZEN]: TON, currentNetwork: BSC } })
        const gizli = await callHandler({ method: 'eth_blockNumber' }, BAGLI_SENDER)
        expect(taban.error.code).toBe(4901)
        expect(gizli).toEqual(taban)
    })
})

describe('TonConnect -- ton_proof + noktasiz alan adi iki modda ayni cevap', () => {
    it('tonconnect_connect: noktasiz sayfa + ton_proof, hesap kapisindan ONCE 400 (iki modda ayni)', async () => {
        const mesaj = {
            method: 'tonconnect_connect',
            params: [{ manifestUrl: 'https://dapp.example/manifest.json', items: [{ name: 'ton_addr' }, { name: 'ton_proof', payload: 'x' }] }],
        }
        await boot({ active: A })
        const taban = await callHandler(mesaj, NOKTASIZ_SENDER)
        teardownBackground()
        await boot({ active: GIZLI })
        const gizli = await callHandler(mesaj, NOKTASIZ_SENDER)
        expect(taban.result.payload.message).toBe('ton_proof requires a domain with a dot')
        expect(gizli.result.payload).toEqual(taban.result.payload)
        expect(gizli.result.event).toBe(taban.result.event)
    })
})

// WalletConnect ile gelen IC aksiyonlar sayfadan gelirse (content.js frenini atlayan ham mesaj) uc durumda
// (normal mod, gizli mod, bayrak kapali) BAYT BAYT ayni reddi alir: mod yoklamasi yok.
describe('yeni ic aksiyonlar -- sayfa kokeni uc durumda ayni red', () => {
    const RED = { error: { code: 4100, message: 'Unauthorized' } }
    for (const ad of ['SIGN_TYPED_DATA_CONFIRM', 'TON_DAPP_REQUEST_STATE', 'ATS_SALE_QUOTE', 'ATS_SALE_EXECUTE']) {
        it(`${ad}: normal, gizli ve bayrak kapali ayni 4100`, async () => {
            const yanitlar = []
            for (const [active, flag] of [[A, 'true'], [GIZLI, 'true'], [GIZLI, 'false']]) {
                await boot({ active, flag })
                for (const mesaj of [{ method: ad, params: [] }, { type: ad, message: { requestId: 'r', account: GIZLI } }]) {
                    for (const sender of [BAGLI_SENDER, YABANCI_SENDER]) yanitlar.push(await callHandler(mesaj, sender))
                }
                teardownBackground()
            }
            expect(yanitlar.length).toBe(12)
            for (const res of yanitlar) expect(res).toEqual(RED)
        })
    }
})

// K13 (cok-ag spec 4.5): Gizli Hesap yalniz KENDI alimini yapar. Kapi imzaciyi mesajdan cozer; gizli modda baska hesap,
// genel modda Gizli hesap ve PRIVATE_ATS_SALE kapaliyken gizli mod PRIVATE_ATS_SALE_BLOCKED alir.
describe('ATS alimi -- Gizli Hesap yalniz KENDI alimini yapar (K13)', () => {
    afterEach(() => { vi.unstubAllEnvs() })

    it('ATS_SALE_QUOTE / ATS_SALE_EXECUTE gizli modda mesajdaki GENEL hesapla kapida engellenir (islem yok)', async () => {
        await boot({ active: GIZLI })
        for (const type of ['ATS_SALE_QUOTE', 'ATS_SALE_EXECUTE']) {
            const res = await callHandler({ type, message: { chainId: 56, amount: '1', account: A } })
            expect(res.success, type).toBe(false)
            expect(res.error, type).toBe('PRIVATE_ATS_SALE_BLOCKED')
        }
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    it('gizli modda mesajdaki Gizli hesap kapidan GECER: engel kodu yoktur (isleyici kendi satis istegini cozer)', async () => {
        await boot({ active: GIZLI })
        for (const type of ['ATS_SALE_QUOTE', 'ATS_SALE_EXECUTE']) {
            const res = await callHandler({ type, message: { chainId: 56, amount: '1', account: GIZLI } })
            expect(res.error, type).not.toBe('PRIVATE_ATS_SALE_BLOCKED')
            expect(res.error, type).not.toBe('PRIVATE_EVM_ONLY')
        }
    })

    it('PRIVATE_ATS_SALE kapaliyken gizli modda Gizli hesapla da kapida engellenir (bugunku yanit)', async () => {
        vi.stubEnv('VITE_PRIVATE_ATS_SALE', 'false')
        await boot({ active: GIZLI })
        for (const type of ['ATS_SALE_QUOTE', 'ATS_SALE_EXECUTE']) {
            const res = await callHandler({ type, message: { chainId: 56, amount: '1', account: GIZLI } })
            expect(res, type).toEqual({ success: false, error: 'PRIVATE_ATS_SALE_BLOCKED' })
        }
    })
})

describe('privacyGate saf kararlari -- yeni adlar', () => {
    const ctxGizli = { activeAccount: GIZLI, signer: GIZLI, privateAccount: GIZLI, privateAddress: GIZLI.address, chainKind: 'evm' }
    const ctxGenel = { activeAccount: A, signer: A, privateAccount: GIZLI, privateAddress: GIZLI.address, chainKind: 'evm' }

    it('wallet_getPermissions gizli modda [] ile cevaplanir, normal modda gecer', () => {
        expect(privacyDecision('wallet_getPermissions', ctxGizli)).toEqual({ respond: { result: [] } })
        expect(privacyDecision('wallet_getPermissions', ctxGenel)).toBeNull()
    })

    it('eth_signTypedData_v4 ve wallet_revokePermissions gizli modda dapp engeli, normal modda gecer', () => {
        expect(privacyDecision('eth_signTypedData_v4', ctxGizli)).toEqual({ block: 'PRIVATE_DAPP_BLOCKED' })
        expect(privacyDecision('wallet_revokePermissions', ctxGizli)).toEqual({ block: 'PRIVATE_DAPP_BLOCKED' })
        expect(privacyDecision('eth_signTypedData_v4', ctxGenel)).toBeNull()
        expect(privacyDecision('wallet_revokePermissions', ctxGenel)).toBeNull()
    })

    it('SIGN_TYPED_DATA_CONFIRM: imzaci cozulemezse fail-closed, gizli modda engel, Gizli imzaci genel modda engel', () => {
        expect(privacyDecision('SIGN_TYPED_DATA_CONFIRM', { ...ctxGenel, signer: null })).toEqual({ block: 'PRIVATE_CHECK_FAILED' })
        expect(privacyDecision('SIGN_TYPED_DATA_CONFIRM', ctxGizli)).toEqual({ block: 'PRIVATE_USE_PRIVATE_SEND' })
        expect(privacyDecision('SIGN_TYPED_DATA_CONFIRM', { ...ctxGenel, signer: GIZLI })).toEqual({ block: 'PRIVATE_ACCOUNT_IN_PUBLIC_MODE' })
        expect(privacyDecision('SIGN_TYPED_DATA_CONFIRM', ctxGenel)).toBeNull()
    })

    it('ATS_SALE_*: gizli mod + Gizli imzaci gecer (K13); gizli mod + genel imzaci ve genel mod + Gizli imzaci ozel kodla (PRIVATE_ATS_SALE_BLOCKED) engel; genel mod + genel imzaci gecer', () => {
        for (const a of ['ATS_SALE_QUOTE', 'ATS_SALE_EXECUTE']) {
            expect(privacyDecision(a, ctxGizli), a).toBeNull()
            expect(privacyDecision(a, { ...ctxGizli, signer: A }), a).toEqual({ block: 'PRIVATE_ATS_SALE_BLOCKED' })
            expect(privacyDecision(a, { ...ctxGenel, signer: GIZLI }), a).toEqual({ block: 'PRIVATE_ATS_SALE_BLOCKED' })
            expect(privacyDecision(a, ctxGenel), a).toBeNull()
            expect(privacyBlockResponse(a, 'PRIVATE_ATS_SALE_BLOCKED', {})).toEqual({ success: false, error: 'PRIVATE_ATS_SALE_BLOCKED' })
        }
    })

    it('typed data reti BAYT BAYT SignTypedData.vue retiyle ayni (kod 4001, "User rejected the request.")', () => {
        const beklenen = { code: 4001, message: TYPED_DATA_USER_REJECT_MESSAGE }
        expect(TYPED_DATA_USER_REJECT_MESSAGE).toBe('User rejected the request.')
        expect(privacyBlockResponse('eth_signTypedData_v4', 'PRIVATE_DAPP_BLOCKED', {})).toEqual({ error: beklenen })
        expect(approvalRejectionFor('SIGN_TYPED_DATA')).toEqual(beklenen)
        // personal_sign ikizinin metni DEGIL (yanlis kopyalanmasin)
        expect(beklenen.message).not.toBe(approvalRejectionFor('SIGN_MESSAGE').message)
    })

    it('izin yontemlerinin engel cevaplari normal moddaki hibesiz site cevabidir', () => {
        expect(privacyBlockResponse('wallet_getPermissions', 'PRIVATE_DAPP_BLOCKED', {})).toEqual({ result: [] })
        expect(privacyBlockResponse('wallet_revokePermissions', 'PRIVATE_DAPP_BLOCKED', {})).toEqual({ result: null })
    })
})
