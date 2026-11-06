import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
    ALWAYS_ALLOWED, CONDITIONAL, BLOCKED_IN_PRIVATE, POPUP_DAPP_METHODS, PRIVATE_ACTIONS, PRIVATE_GATE_CODES,
    APPROVAL_RESULTS_CHECKED, APPROVAL_RESULTS_PASSTHROUGH,
    privacyNeedsCheck, privacyDecision, privacyBlockResponse,
    isPrivateIdentity, normalizeDerivationPath, privateContextFrom,
    approvalResultDecision, approvalRejectionFor, scrubPrivateAddress,
} from './privacyGate'
import { INTERNAL_RESPONSES, isPrivateModeAction } from '../messageGate'
import { extractSwitchCases } from '../../test-utils/switchCases'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { PRIVATE_SWAP_BRIDGE } from '../featureFlags'

const GIZLI = { key: 'g-1', address: '0x' + 'cd'.repeat(20), type: 'hd', private: true }
const A = { key: 'a-1', address: '0x' + 'ab'.repeat(20), type: 'hd' }
// Imzalayan / para hareket ettiren ATS ve gazsiz aksiyonlar (I1): SWAP_QUOTE ile ayni kural.
const ATS_SIGNING = ['ATS_RUN_ONBOARDING', 'GASLESS_TOKEN_OPTIONS', 'ATS_SWAP_FEE_QUOTE', 'ATS_BRIDGE_FEE_QUOTE']
// Klasik takas/kopru adlari (SWAP_BRIDGE_ACTIONS): gizli kimlik icin bayraktan bagimsiz PRIVATE_SWAP_BRIDGE_CLOSED.
const SIX = ['SWAP', 'SWAP_QUOTE', 'BRIDGE', 'BRIDGE_QUOTE', 'ATS_SWAP_FEE_QUOTE', 'ATS_BRIDGE_FEE_QUOTE']

describe('siniflandirma kilidi (spec 6.1-5)', () => {
    const source = readFileSync(fileURLToPath(new URL('../../background.js', import.meta.url)), 'utf8')
    const cases = extractSwitchCases(source)

    it('switch okunabildi', () => {
        expect(cases.length).toBeGreaterThan(40)
    })

    it('her case TAM BIR kumede', () => {
        const sayim = (c) => [ALWAYS_ALLOWED, CONDITIONAL, BLOCKED_IN_PRIVATE].filter((s) => s.has(c)).length
        expect(cases.filter((c) => sayim(c) !== 1)).toEqual([])
    })

    it('popup metotlari engellenen kumede', () => {
        for (const m of POPUP_DAPP_METHODS) expect(BLOCKED_IN_PRIVATE.has(m)).toBe(true)
    })

    // A-I2: normal modun da BAGLI OLMAYAN siteye popup actigi tek iki metot popup alir.
    it('popup yalniz eth_requestAccounts ve wallet_switchEthereumChain icin (sign/send aninda 4100)', () => {
        expect([...POPUP_DAPP_METHODS].sort()).toEqual(['eth_requestAccounts', 'wallet_switchEthereumChain'])
    })

    // A-C1 (5): onay sonucu kanali. Bu adlar switch'e girmez (dagiticinin ignoredResponses
    // dali) ama bekleyen dapp istegini COZER; kapiyi sessizce atlayamaz.
    it('messageGate INTERNAL_RESPONSES in her adi TAM BIR onay sonucu kumesinde', () => {
        const sayim = (n) => [APPROVAL_RESULTS_CHECKED, APPROVAL_RESULTS_PASSTHROUGH].filter((k) => k.has(n)).length
        expect([...INTERNAL_RESPONSES].filter((n) => sayim(n) !== 1)).toEqual([])
    })

    it('onay sonucu kumelerinde INTERNAL_RESPONSES disinda ad yok; SUCCESS denetlenir, REJECTED gecer', () => {
        for (const n of [...APPROVAL_RESULTS_CHECKED, ...APPROVAL_RESULTS_PASSTHROUGH]) expect(INTERNAL_RESPONSES.has(n)).toBe(true)
        for (const n of INTERNAL_RESPONSES) {
            expect(APPROVAL_RESULTS_CHECKED.has(n), n).toBe(n.endsWith('_SUCCESS'))
            expect(APPROVAL_RESULTS_PASSTHROUGH.has(n), n).toBe(n.endsWith('_REJECTED'))
        }
    })

    it('dagitici ignoredResponses dizisi onay sonucu kumeleriyle birebir ayni', () => {
        const blok = source.match(/const ignoredResponses = \[([^\]]+)\]/)
        expect(blok).not.toBeNull()
        const listed = [...blok[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]).sort()
        expect(listed).toEqual([...APPROVAL_RESULTS_CHECKED, ...APPROVAL_RESULTS_PASSTHROUGH].sort())
    })

    it('engel popup\'i bekleyen dapp istegini reddedebilir (gizli modda da)', () => {
        const gizli = { activeAccount: GIZLI, signer: GIZLI, privateAddress: GIZLI.address, chainKind: 'evm' }
        expect(ALWAYS_ALLOWED.has('CONNECT_WALLET_REJECTED')).toBe(true)
        expect(privacyNeedsCheck('CONNECT_WALLET_REJECTED')).toBe(false)
        expect(privacyDecision('CONNECT_WALLET_REJECTED', gizli)).toBe(null)
    })

    it('imzalayan / para hareket ettiren ATS ve gazsiz aksiyonlar KOSULLU (I1)', () => {
        for (const a of ATS_SIGNING) {
            expect(CONDITIONAL.has(a)).toBe(true)
            expect(ALWAYS_ALLOWED.has(a)).toBe(false)
            expect(BLOCKED_IN_PRIVATE.has(a)).toBe(false)
        }
    })

    it('yalniz adres okuyan ATS aksiyonlari her zaman izinli', () => {
        expect(ALWAYS_ALLOWED.has('ATS_FEE_QUOTE')).toBe(true)
        expect(ALWAYS_ALLOWED.has('ATS_FUEL_BALANCE')).toBe(true)
    })

    // Task 11: SWAP/BRIDGE teklifleri anahtari acar (createWalletInstance); gizli siparis teklifi
    // yalniz saklanan tekliften kaynak ADRESINI okur, anahtar acmaz, imza atmaz: ATS_FEE_QUOTE ile ayni yetenek.
    it('ATS_PRIVATE_FEE_QUOTE yalniz adres okur: her zaman izinli, kosullu ve engelli degil', () => {
        expect(ALWAYS_ALLOWED.has('ATS_PRIVATE_FEE_QUOTE')).toBe(true)
        expect(CONDITIONAL.has('ATS_PRIVATE_FEE_QUOTE')).toBe(false)
        expect(BLOCKED_IN_PRIVATE.has('ATS_PRIVATE_FEE_QUOTE')).toBe(false)
        expect(privacyNeedsCheck('ATS_PRIVATE_FEE_QUOTE')).toBe(false)
    })

    // T2 (gizli transfer sade ekran): PRIVATE_PROVIDER_INFO yalniz sayi ve bayrak doner (feeBps, limitler, musaitlik); adres,
    // anahtar, imza yok. Gizli ve normal modda ayni yanit: bu yuzden ALWAYS_ALLOWED (tam bir kumede).
    it('PRIVATE_PROVIDER_INFO her zaman izinli: kosullu ve engelli degil, iki modda kapidan gecer', () => {
        expect(ALWAYS_ALLOWED.has('PRIVATE_PROVIDER_INFO')).toBe(true)
        expect(CONDITIONAL.has('PRIVATE_PROVIDER_INFO')).toBe(false)
        expect(BLOCKED_IN_PRIVATE.has('PRIVATE_PROVIDER_INFO')).toBe(false)
        expect(PRIVATE_ACTIONS.has('PRIVATE_PROVIDER_INFO')).toBe(false)
        expect(privacyNeedsCheck('PRIVATE_PROVIDER_INFO')).toBe(false)
        const gizli = { activeAccount: GIZLI, signer: GIZLI, privateAddress: GIZLI.address, chainKind: 'evm' }
        expect(privacyDecision('PRIVATE_PROVIDER_INFO', gizli)).toBe(null)
        expect(privacyDecision('PRIVATE_PROVIDER_INFO', { activeAccount: null, signer: null, privateAddress: null, chainKind: 'evm' })).toBe(null)
    })

    it('ALWAYS_ALLOWED tam kumesi (PRIVATE_PROVIDER_INFO dahil, her ad bir kez)', () => {
        expect([...ALWAYS_ALLOWED].sort()).toEqual([
            'ACCOUNT_CHANGED', 'ATS_FEE_QUOTE', 'ATS_FUEL_BALANCE', 'ATS_PRIVATE_FEE_QUOTE', 'CHAIN_CHANGED', 'CHECK_TX_STATUS',
            'CHECK_UNLOCK', 'CONNECT_WALLET_REJECTED', 'DISCONNECT_DAPP', 'DISCONNECT_SOLANA_DAPP', 'DISCONNECT_TON_DAPP', 'HEARTBEAT',
            'LOCK', 'PRIVACY_MODE_SET', 'PRIVATE_PROVIDER_INFO', 'SET_UI_MODE', 'TON_DAPP_REQUEST_STATE', 'UNLOCK_WALLET',
            'eth_chainId', 'solana_disconnect', 'wallet_addEthereumChain',
        ].sort())
    })

    it('wallet_addEthereumChain her zaman izinli: hesap gerektirmez, normal 4200 cevabini alir (I2)', () => {
        expect(ALWAYS_ALLOWED.has('wallet_addEthereumChain')).toBe(true)
        expect(BLOCKED_IN_PRIVATE.has('wallet_addEthereumChain')).toBe(false)
        const gizli = { activeAccount: GIZLI, signer: GIZLI, privateAddress: GIZLI.address, chainKind: 'evm' }
        expect(privacyDecision('wallet_addEthereumChain', gizli)).toBe(null)
    })
})

describe('privacyDecision -- normal mod', () => {
    const ctx = (over) => ({ activeAccount: A, signer: A, privateAddress: GIZLI.address, recipient: null, chainKind: 'evm', ...over })

    it('her zaman izinli aksiyonlar kontrol edilmez', () => {
        expect(privacyNeedsCheck('HEARTBEAT')).toBe(false)
        expect(privacyDecision('HEARTBEAT', ctx({ signer: GIZLI }))).toBe(null)
    })

    it('Gizli Hesap normal modda imzalayamaz', () => {
        expect(privacyDecision('SWAP', ctx({ signer: GIZLI }))).toEqual({ block: 'PRIVATE_ACCOUNT_IN_PUBLIC_MODE' })
    })

    it('ATS/gazsiz aksiyonlarda Gizli Hesap imzaci olamaz (I1)', () => {
        for (const a of ATS_SIGNING) {
            expect(privacyDecision(a, ctx({ signer: GIZLI }))).toEqual({ block: 'PRIVATE_ACCOUNT_IN_PUBLIC_MODE' })
            expect(privacyDecision(a, ctx({ signer: A }))).toBe(null)
        }
    })

    it('alicisi Gizli Hesap olan gonderim engellenir (buyuk/kucuk harf duyarsiz)', () => {
        expect(privacyDecision('SEND_TRANSACTION', ctx({ recipient: GIZLI.address.toUpperCase().replace('0X', '0x') })))
            .toEqual({ block: 'RECIPIENT_IS_PRIVATE' })
    })

    it('alici 0x oneksiz yazilsa da Gizli Hesap adresi yakalanir (M2)', () => {
        const bare = GIZLI.address.slice(2)
        expect(privacyDecision('SEND_TRANSACTION', ctx({ recipient: bare }))).toEqual({ block: 'RECIPIENT_IS_PRIVATE' })
        expect(privacyDecision('SEND_TRANSACTION', ctx({ recipient: bare.toUpperCase() }))).toEqual({ block: 'RECIPIENT_IS_PRIVATE' })
        expect(privacyDecision('SEND_TRANSACTION', ctx({ recipient: '0X' + bare.toUpperCase() }))).toEqual({ block: 'RECIPIENT_IS_PRIVATE' })
    })

    it('alici ya da Gizli Hesap adresi bos ise eslesme sayilmaz', () => {
        expect(privacyDecision('SEND_TRANSACTION', ctx({ recipient: '', privateAddress: '' }))).toBe(null)
        expect(privacyDecision('SEND_TRANSACTION', ctx({ recipient: '0x', privateAddress: '0x' }))).toBe(null)
        expect(privacyDecision('SEND_TRANSACTION', ctx({ recipient: '0x', privateAddress: null }))).toBe(null)
    })

    it('normal islemler gecer', () => {
        expect(privacyDecision('SEND_TRANSACTION', ctx({ recipient: A.address }))).toBe(null)
        expect(privacyDecision('eth_requestAccounts', ctx())).toBe(null)
        expect(privacyDecision('SOLANA_SEND', ctx())).toBe(null)
    })
})

describe('privacyDecision -- baglam yok / imzaci yok: fail-closed (I3)', () => {
    const pub = { activeAccount: A, signer: A, privateAddress: GIZLI.address, chainKind: 'evm' }
    const priv = { activeAccount: GIZLI, signer: GIZLI, privateAddress: GIZLI.address, chainKind: 'evm' }

    it('kontrol gerektiren aksiyonda baglam yok / nesne degil ise PRIVATE_CHECK_FAILED', () => {
        for (const a of ['SWAP', 'eth_requestAccounts', 'eth_sendTransaction', 'SOLANA_SEND', 'tonconnect_send']) {
            for (const bad of [undefined, null, 'x', 42, true]) {
                expect(privacyDecision(a, bad), a).toEqual({ block: 'PRIVATE_CHECK_FAILED' })
            }
        }
        expect(privacyDecision('SWAP')).toEqual({ block: 'PRIVATE_CHECK_FAILED' })
    })

    it('kontrol gerektirmeyen aksiyon baglam olmadan da gecer', () => {
        expect(privacyDecision('HEARTBEAT')).toBe(null)
        expect(privacyDecision('wallet_addEthereumChain', null)).toBe(null)
    })

    it('KOSULLU aksiyonda imzaci cozulemezse iki modda da PRIVATE_CHECK_FAILED; gizli modda klasik alti ad imzaciya bakmadan PRIVATE_SWAP_BRIDGE_CLOSED', () => {
        for (const a of CONDITIONAL) {
            // PRIVATE_* kendi karar dalina sahip: cozulemeyen imzaci/teklif PRIVATE_UNSUPPORTED
            // (yine bir engel). Sozlesmeleri asagidaki PRIVATE_* bloklarinda sinanir.
            if (PRIVATE_ACTIONS.has(a)) continue
            for (const base of [pub, priv]) {
                // Kapatma imzaci cozumunden ONCE gelir: gizli kimlikte klasik alti ad CHECK_FAILED'a varmadan kesilir.
                const beklenen = base === priv && SIX.includes(a) ? { block: 'PRIVATE_SWAP_BRIDGE_CLOSED' } : { block: 'PRIVATE_CHECK_FAILED' }
                for (const signer of [undefined, null, 'x']) {
                    expect(privacyDecision(a, { ...base, signer }), a).toEqual(beklenen)
                }
            }
        }
    })

    it('activeAccount yoklugu tek basina engel degil: aktif hesap yok = normal mod', () => {
        expect(privacyDecision('eth_accounts', { activeAccount: null })).toBe(null)
        expect(privacyDecision('eth_requestAccounts', {})).toBe(null)
        expect(privacyDecision('SWAP', { activeAccount: null, signer: A, chainKind: 'evm' })).toBe(null)
    })
})

describe('privacyDecision -- gizli mod', () => {
    const ctx = (over) => ({ activeAccount: GIZLI, signer: GIZLI, privateAddress: GIZLI.address, recipient: null, chainKind: 'evm', ...over })

    it('klasik dort ad (SWAP, SWAP_QUOTE, BRIDGE, BRIDGE_QUOTE) gizli modda kapali; ATS_RUN_ONBOARDING gecer', () => {
        for (const a of ['SWAP', 'SWAP_QUOTE', 'BRIDGE', 'BRIDGE_QUOTE']) expect(privacyDecision(a, ctx()), a).toEqual({ block: 'PRIVATE_SWAP_BRIDGE_CLOSED' })
        expect(privacyDecision('ATS_RUN_ONBOARDING', ctx())).toBe(null)
    })

    it('EVM disi zincirde ATS_RUN_ONBOARDING engellenir; zincir bilinmiyorsa da (fail-closed)', () => {
        expect(privacyDecision('ATS_RUN_ONBOARDING', ctx({ chainKind: 'ton' }))).toEqual({ block: 'PRIVATE_EVM_ONLY' })
        expect(privacyDecision('ATS_RUN_ONBOARDING', ctx({ chainKind: null }))).toEqual({ block: 'PRIVATE_EVM_ONLY' })
    })

    it('gizli modda normal hesapla ATS_RUN_ONBOARDING engellenir', () => {
        expect(privacyDecision('ATS_RUN_ONBOARDING', ctx({ signer: A }))).toEqual({ block: 'PRIVATE_SIGNER_MUST_BE_PRIVATE' })
    })

    it('ATS onboarding / gazsiz aksiyonlarda yalniz Gizli Hesap imzalar, zincir EVM olmali; iki ATS ucret teklifi kapali (I1)', () => {
        for (const a of ['ATS_RUN_ONBOARDING', 'GASLESS_TOKEN_OPTIONS']) {
            expect(privacyDecision(a, ctx())).toBe(null)
            expect(privacyDecision(a, ctx({ signer: A }))).toEqual({ block: 'PRIVATE_SIGNER_MUST_BE_PRIVATE' })
            expect(privacyDecision(a, ctx({ chainKind: 'ton' }))).toEqual({ block: 'PRIVATE_EVM_ONLY' })
        }
        for (const a of ['ATS_SWAP_FEE_QUOTE', 'ATS_BRIDGE_FEE_QUOTE']) {
            expect(privacyDecision(a, ctx()), a).toEqual({ block: 'PRIVATE_SWAP_BRIDGE_CLOSED' })
            expect(privacyDecision(a, ctx({ signer: A })), a).toEqual({ block: 'PRIVATE_SWAP_BRIDGE_CLOSED' })
            expect(privacyDecision(a, ctx({ chainKind: 'ton' })), a).toEqual({ block: 'PRIVATE_SWAP_BRIDGE_CLOSED' })
        }
    })

    it('yalniz adres okuyan ATS aksiyonlari gizli modda da gecer', () => {
        for (const a of ['ATS_FEE_QUOTE', 'ATS_FUEL_BALANCE']) expect(privacyDecision(a, ctx({ signer: A }))).toBe(null)
    })

    it('duz gonderim ve imza gizli gondermeye yonlendirilir', () => {
        expect(privacyDecision('SEND_TRANSACTION', ctx())).toEqual({ block: 'PRIVATE_USE_PRIVATE_SEND' })
        expect(privacyDecision('SIGN', ctx())).toEqual({ block: 'PRIVATE_USE_PRIVATE_SEND' })
    })

    it('dapp istekleri engellenir, eth_accounts bos doner', () => {
        expect(privacyDecision('eth_requestAccounts', ctx())).toEqual({ block: 'PRIVATE_DAPP_BLOCKED' })
        expect(privacyDecision('solana_connect', ctx())).toEqual({ block: 'PRIVATE_DAPP_BLOCKED' })
        expect(privacyDecision('tonconnect_restore', ctx())).toEqual({ block: 'PRIVATE_DAPP_BLOCKED' })
        expect(privacyDecision('eth_accounts', ctx())).toEqual({ respond: { result: [] } })
    })

    it('TON Connect baglanti kesme istegi gecer', () => {
        expect(privacyDecision('tonconnect_send', ctx({ tonMethod: 'disconnect' }))).toBe(null)
        expect(privacyDecision('tonconnect_send', ctx({ tonMethod: 'sendTransaction' }))).toEqual({ block: 'PRIVATE_DAPP_BLOCKED' })
    })

    it('ic TON/Solana aksiyonlari engellenir', () => {
        expect(privacyDecision('SEND_TON_TRANSACTION', ctx())).toEqual({ block: 'PRIVATE_EVM_ONLY' })
        expect(privacyDecision('SOLANA_GET_ADDRESS', ctx())).toEqual({ block: 'PRIVATE_EVM_ONLY' })
    })
})

describe('privacyBlockResponse -- sayfaya donen ret, normal kullanici retiyle BAYT BAYT ayni (I2)', () => {
    it('EVM dapp: her metot kendi mevcut kullanici-reddetti metnini alir', () => {
        const ret = (m) => privacyBlockResponse(m, 'PRIVATE_DAPP_BLOCKED', {}).error
        expect(ret('eth_requestAccounts')).toEqual({ code: 4001, message: 'User rejected the connection' })
        expect(ret('wallet_switchEthereumChain')).toEqual({ code: 4001, message: 'User rejected the chain switch' })
        expect(ret('eth_sendTransaction')).toEqual({ code: 4001, message: 'Transaction cancelled by user.' })
        expect(ret('personal_sign')).toEqual({ code: 4001, message: 'Sign Request cancelled by user.' })
    })

    it('Solana dapp: mevcut Solana kullanici-reddetti hatasi', () => {
        for (const m of ['solana_connect', 'solana_signMessage', 'solana_signIn', 'solana_signTransaction', 'solana_signAndSendTransaction']) {
            expect(privacyBlockResponse(m, 'PRIVATE_DAPP_BLOCKED', {}).error).toEqual({ code: 4001, message: 'User rejected the request.' })
        }
    })

    // SADECE fail-closed yedek yanit (kapi karar veremedi). Gizli modun normal "dapp engeli"
    // TON / Solana istekleri icin gercek isleyicilerin kendi cevabini verir
    // (background.privacyGate.test.js, A-I1 esitlik blogu).
    it('TON Connect fail-closed yedegi: code 300 "User rejected the request"; connect_error / sendError sekli korunur', () => {
        const c = privacyBlockResponse('tonconnect_connect', 'X', {}).result
        expect(c.event).toBe('connect_error')
        expect(c.payload).toEqual({ code: 300, message: 'User rejected the request' })
        expect(privacyBlockResponse('tonconnect_restore', 'X', {}).result.payload).toEqual({ code: 300, message: 'User rejected the request' })
        const r = privacyBlockResponse('tonconnect_send', 'X', { params: [{ id: '42' }] })
        expect(r.result).toEqual({ error: { code: 300, message: 'User rejected the request' }, id: '42' })
    })

    it('sayfaya donen hicbir ret "private" kelimesi ya da PRIVATE_ kodu icermez', () => {
        const methods = [
            'eth_requestAccounts', 'eth_sendTransaction', 'personal_sign', 'wallet_switchEthereumChain',
            'solana_connect', 'solana_signMessage', 'solana_signIn', 'solana_signTransaction', 'solana_signAndSendTransaction',
            'tonconnect_connect', 'tonconnect_restore', 'tonconnect_send',
        ]
        for (const m of methods) {
            const json = JSON.stringify(privacyBlockResponse(m, 'PRIVATE_DAPP_BLOCKED', { params: [{ id: '1' }] }))
            expect(json, m).not.toMatch(/private/i)
        }
    })

    it('BLOCKED_IN_PRIVATE icindeki her dapp metodu sayfaya sizdirmayan bir ret alir', () => {
        for (const m of BLOCKED_IN_PRIVATE) {
            if (!(m.startsWith('eth_') || m.startsWith('wallet_') || m === 'personal_sign' || m.startsWith('solana_') || m.startsWith('tonconnect_'))) continue
            const json = JSON.stringify(privacyBlockResponse(m, 'PRIVATE_DAPP_BLOCKED', { params: [{ id: '1' }] }))
            expect(json, m).not.toMatch(/private/i)
        }
    })

    it('ic (cuzdanin kendi arayuzu) yanitlar PRIVATE_ kodunu tasir', () => {
        expect(privacyBlockResponse('SOLANA_SEND', 'PRIVATE_EVM_ONLY', {})).toEqual({ error: 'PRIVATE_EVM_ONLY' })
        expect(privacyBlockResponse('SWAP', 'PRIVATE_EVM_ONLY', {})).toEqual({ success: false, error: 'PRIVATE_EVM_ONLY' })
        expect(privacyBlockResponse('SWAP', 'PRIVATE_CHECK_FAILED', {})).toEqual({ success: false, error: 'PRIVATE_CHECK_FAILED' })
    })
})

describe('turetme yolu kanonik bicimi (A-M2)', () => {
    it('ethers in ayni anahtara cevirdigi dort yazim ayni kanonik bicime iner', () => {
        const kanonik = normalizeDerivationPath("m/44'/60'/0'/1/0")
        for (const yazim of ["44'/60'/0'/1/0", "m/44'/60'/0'/01/0", "m/44'/60'/0'/1/00", "m/044'/60'/0'/1/0"]) {
            expect(normalizeDerivationPath(yazim), yazim).toBe(kanonik)
        }
    })

    it('farkli yollar ve cozulemeyen metinler esit degil', () => {
        const kanonik = normalizeDerivationPath("m/44'/60'/0'/1/0")
        expect(normalizeDerivationPath("m/44'/60'/0'/0/0")).not.toBe(kanonik)
        expect(normalizeDerivationPath("m/44'/60'/0'/1/1")).not.toBe(kanonik)
        for (const bozuk of ['', 'm', 'm/', 'm/a/b', "m/44'/60'/0'/-1/0", null, undefined, 42, {}]) {
            expect(normalizeDerivationPath(bozuk)).toBe(null)
        }
    })

    it('sertlestirme isareti tek bicime iner (h / H / apostrof)', () => {
        expect(normalizeDerivationPath("m/44h/60H/0'/1/0")).toBe(normalizeDerivationPath("m/44'/60'/0'/1/0"))
    })

    const depodaki = { ...GIZLI, derivationPath: "m/44'/60'/0'/1/0" }
    const ctx = privateContextFrom([{ privateAccount: depodaki }])

    it('kanonik olmayan yazimlar kasadaki Gizli Hesap sayilir (kimlik eslesmesi)', () => {
        for (const derivationPath of ["44'/60'/0'/1/0", "m/44'/60'/0'/01/0", "m/44'/60'/0'/1/00", "m/044'/60'/0'/1/0"]) {
            expect(isPrivateIdentity({ type: 'hd', derivationPath }, ctx), derivationPath).toBe(true)
        }
        expect(isPrivateIdentity({ type: 'hd', derivationPath: "m/44'/60'/0'/0/0" }, ctx)).toBe(false)
    })

    it('normal modda kanonik olmayan yolla imzalama Gizli Hesap imzasi sayilir', () => {
        const base = { activeAccount: A, privateAccount: depodaki, privateAddress: depodaki.address, chainKind: 'evm' }
        for (const derivationPath of ["44'/60'/0'/1/0", "m/44'/60'/0'/01/0", "m/44'/60'/0'/1/00", "m/044'/60'/0'/1/0"]) {
            expect(privacyDecision('SIGN', { ...base, signer: { type: 'hd', index: 0, derivationPath } }), derivationPath)
                .toEqual({ block: 'PRIVATE_ACCOUNT_IN_PUBLIC_MODE' })
        }
    })
})

describe('tek kimlik kurali (A-M1 / A-M3): isPrivateIdentity', () => {
    const depodaki = { ...GIZLI, derivationPath: "m/44'/60'/0'/1/0" }
    const ctx = privateContextFrom([{ privateAccount: depodaki }])

    it('bayrak YETERLI (fail-closed), kayit eslesmesi de YETERLI', () => {
        expect(isPrivateIdentity({ private: true }, ctx)).toBe(true)
        expect(isPrivateIdentity({ address: GIZLI.address }, ctx)).toBe(true)
        expect(isPrivateIdentity({ address: GIZLI.address.slice(2).toUpperCase() }, ctx)).toBe(true)
        expect(isPrivateIdentity({ key: GIZLI.key }, ctx)).toBe(true)
        expect(isPrivateIdentity({ type: 'hd', address: A.address, key: A.key }, ctx)).toBe(false)
    })

    it('hesap nesnesi degilse ya da kayit bilinmiyorsa kimlik yok', () => {
        for (const bad of [null, undefined, 'x', 7]) expect(isPrivateIdentity(bad, ctx)).toBe(false)
        expect(isPrivateIdentity({ address: GIZLI.address }, privateContextFrom([]))).toBe(false)
        expect(isPrivateIdentity({ address: GIZLI.address }, {})).toBe(false)
    })

    it('gizli modda "imzaci Gizli Hesap olmali": kasadaki kayitla eslesmeyen BAYRAKLI nesne PRIVATE_SIGNER_MUST_BE_PRIVATE', () => {
        const baglam = { activeAccount: GIZLI, privateAccount: depodaki, privateAddress: depodaki.address, chainKind: 'evm' }
        // Bayragi almis ama adresi/key i/yolu Gizli Hesap a ait OLMAYAN genel hesap.
        const bayrakAlmisGenel = { ...A, private: true }
        expect(privacyDecision('ATS_RUN_ONBOARDING', { ...baglam, signer: bayrakAlmisGenel })).toEqual({ block: 'PRIVATE_SIGNER_MUST_BE_PRIVATE' })
        // Bayraksiz ama kayitla eslesen nesne gecer.
        expect(privacyDecision('ATS_RUN_ONBOARDING', { ...baglam, signer: { type: 'hd', address: GIZLI.address } })).toBe(null)
        expect(privacyDecision('ATS_RUN_ONBOARDING', { ...baglam, signer: GIZLI })).toBe(null)
    })

    it('kasadaki kayit BILINMIYORSA bayrak gecerli sayilir (eski davranis korunur)', () => {
        const baglam = { activeAccount: GIZLI, chainKind: 'evm' }
        expect(privacyDecision('ATS_RUN_ONBOARDING', { ...baglam, signer: GIZLI })).toBe(null)
    })

    it('bayragi dusmus ama kayitla eslesen AKTIF hesap gizli mod sayilir (dapp engeli)', () => {
        const baglam = { activeAccount: { type: 'hd', address: GIZLI.address }, privateAccount: depodaki, privateAddress: depodaki.address, chainKind: 'evm' }
        expect(privacyDecision('eth_requestAccounts', baglam)).toEqual({ block: 'PRIVATE_DAPP_BLOCKED' })
        expect(privacyDecision('eth_accounts', baglam)).toEqual({ respond: { result: [] } })
    })
})

describe('Gizli Hesap a giden islem (A-M4): tx.to', () => {
    const ctx = (over) => ({ activeAccount: A, signer: A, privateAddress: GIZLI.address, recipient: null, chainKind: 'evm', ...over })

    it('cagri verisi taninmasa da tx.to Gizli Hesap ise RECIPIENT_IS_PRIVATE', () => {
        expect(privacyDecision('SEND_TRANSACTION', ctx({ recipient: null, txTo: GIZLI.address }))).toEqual({ block: 'RECIPIENT_IS_PRIVATE' })
        expect(privacyDecision('SEND_TRANSACTION', ctx({ txTo: GIZLI.address.slice(2).toUpperCase() }))).toEqual({ block: 'RECIPIENT_IS_PRIVATE' })
    })

    it('cozulmus alici denetimi AYRICA durur; baska tx.to gecer', () => {
        expect(privacyDecision('SEND_TRANSACTION', ctx({ recipient: GIZLI.address, txTo: A.address }))).toEqual({ block: 'RECIPIENT_IS_PRIVATE' })
        expect(privacyDecision('SEND_TRANSACTION', ctx({ recipient: A.address, txTo: A.address }))).toBe(null)
        expect(privacyDecision('SEND_TRANSACTION', ctx({ txTo: '', privateAddress: '' }))).toBe(null)
    })
})

describe('onay sonucu karari (A-C1)', () => {
    const ctx = (over) => ({ activeAccount: A, privateAccount: GIZLI, privateAddress: GIZLI.address, ...over })
    const sonuc = (result) => ({ requestId: 'r1', status: 'success', data: { result } })

    it('SUCCESS disindaki adlar denetlenmez', () => {
        for (const n of ['CONNECT_WALLET_REJECTED', 'SEND_TX_REJECTED', 'HEARTBEAT']) {
            expect(approvalResultDecision(n, sonuc([GIZLI.address]), ctx())).toEqual({ reject: false })
        }
    })

    it('aktif hesap Gizli Hesap iken HER SUCCESS ret olur', () => {
        for (const n of ['CONNECT_WALLET_SUCCESS', 'SIGN_MESSAGE_SUCCESS', 'SEND_TX_SUCCESS']) {
            expect(approvalResultDecision(n, sonuc([A.address]), ctx({ activeAccount: GIZLI })), n).toEqual({ reject: true })
        }
    })

    it('sonuc Gizli Hesap adresini tasiyorsa (0x siz / buyuk harf / ic ice) ret olur', () => {
        const d = (r) => approvalResultDecision('CONNECT_WALLET_SUCCESS', sonuc(r), ctx())
        expect(d([GIZLI.address])).toEqual({ reject: true })
        expect(d([A.address, GIZLI.address.slice(2).toUpperCase()])).toEqual({ reject: true })
        expect(d({ address: GIZLI.address })).toEqual({ reject: true })
        expect(d({ items: [{ nested: [GIZLI.address] }] })).toEqual({ reject: true })
    })

    it('genel hesap sonucu gecer; kayit bilinmiyorsa adres eslesmesi olmaz', () => {
        expect(approvalResultDecision('CONNECT_WALLET_SUCCESS', sonuc([A.address]), ctx())).toEqual({ reject: false })
        expect(approvalResultDecision('CONNECT_WALLET_SUCCESS', sonuc(null), ctx())).toEqual({ reject: false })
        expect(approvalResultDecision('CONNECT_WALLET_SUCCESS', sonuc([GIZLI.address]), { activeAccount: A })).toEqual({ reject: false })
    })

    it('baglam yoksa SUCCESS ret olur (fail-closed)', () => {
        expect(approvalResultDecision('CONNECT_WALLET_SUCCESS', sonuc([]), undefined)).toEqual({ reject: true })
    })

    it('ret, onay ekraninin normal kullanici retiyle ayni', () => {
        expect(approvalRejectionFor('CONNECT')).toEqual({ code: 4001, message: 'User rejected the connection' })
        expect(approvalRejectionFor(undefined)).toEqual({ code: 4001, message: 'User rejected the connection' })
        expect(approvalRejectionFor('SWITCH_CHAIN')).toEqual({ code: 4001, message: 'User rejected the chain switch' })
        expect(approvalRejectionFor('SEND_TX')).toEqual({ code: 4001, message: 'Transaction cancelled by user.' })
        expect(approvalRejectionFor('SIGN_MESSAGE')).toEqual({ code: 4001, message: 'Sign Request cancelled by user.' })
        expect(approvalRejectionFor('SOLANA_CONNECT')).toEqual({ code: 4001, message: 'User rejected the request.' })
        expect(approvalRejectionFor('TON_SEND_TX')).toEqual({ code: 4001, message: 'User closed the window.' })
    })

    it('scrubPrivateAddress: adresi listeden cikarir, baska hesap kalmadiysa kaydi siler', () => {
        const dapps = {
            'a.example': { accounts: [GIZLI.address] },
            'b.example': { accounts: [A.address, GIZLI.address.slice(2)], chainId: '0x38' },
            'c.example': { accounts: [A.address] },
        }
        const { dapps: temiz, changed } = scrubPrivateAddress(dapps, GIZLI.address)
        expect(changed).toBe(true)
        expect(temiz).toEqual({ 'b.example': { accounts: [A.address], chainId: '0x38' }, 'c.example': { accounts: [A.address] } })
        expect(dapps['a.example']).toBeDefined() // girdi degismez
    })

    it('scrubPrivateAddress: eslesme yoksa degisiklik yok', () => {
        const dapps = { 'c.example': { accounts: [A.address] } }
        expect(scrubPrivateAddress(dapps, GIZLI.address)).toEqual({ dapps, changed: false })
        expect(scrubPrivateAddress(undefined, GIZLI.address).changed).toBe(false)
        expect(scrubPrivateAddress(dapps, '').changed).toBe(false)
    })
})

describe('privacyDecision -- Gizli Hesap KIMLIKLE taninir (bayrak tek basina sart degil)', () => {
    const depodaki = { ...GIZLI, derivationPath: "m/44'/60'/0'/1/0" }
    const ctx = (over) => ({ activeAccount: A, signer: A, privateAccount: depodaki, privateAddress: depodaki.address, chainKind: 'evm', ...over })
    const bayraksiz = [
        { type: 'hd', address: GIZLI.address },
        { type: 'hd', address: GIZLI.address.toUpperCase().replace('0X', '0x') },
        { type: 'hd', address: GIZLI.address.slice(2) },
        { type: 'hd', key: GIZLI.key },
        { type: 'hd', derivationPath: "m/44'/60'/0'/1/0" },
    ]

    it('normal modda bayraksiz Gizli Hesap imzaci engellenir', () => {
        for (const signer of bayraksiz) {
            expect(privacyDecision('SIGN', ctx({ signer })), JSON.stringify(signer)).toEqual({ block: 'PRIVATE_ACCOUNT_IN_PUBLIC_MODE' })
        }
    })

    it('gizli modda bayraksiz Gizli Hesap imzaci ATS_RUN_ONBOARDING te gecer; genel hesap engellenir', () => {
        for (const signer of bayraksiz) {
            expect(privacyDecision('ATS_RUN_ONBOARDING', ctx({ activeAccount: GIZLI, signer })), JSON.stringify(signer)).toBe(null)
        }
        expect(privacyDecision('ATS_RUN_ONBOARDING', ctx({ activeAccount: GIZLI, signer: A }))).toEqual({ block: 'PRIVATE_SIGNER_MUST_BE_PRIVATE' })
    })

    it('depoda Gizli Hesap yoksa kimlik eslesmesi olmaz (bos adres / key eslesme sayilmaz)', () => {
        expect(privacyDecision('SIGN', { activeAccount: A, signer: { type: 'hd', address: '' }, privateAccount: null, privateAddress: null, chainKind: 'evm' })).toBe(null)
        expect(privacyDecision('SIGN', { activeAccount: A, signer: { type: 'hd', derivationPath: "m/44'/60'/0'/1/0" }, privateAccount: null, chainKind: 'evm' })).toBe(null)
    })
})

describe('privacyDecision -- PRIVATE_* (spec 6.2)', () => {
    const ctx = (over) => ({ activeAccount: GIZLI, signer: A, privateAddress: GIZLI.address, outputAddress: GIZLI.address, chainKind: 'evm', ...over })

    it('normal modda hepsi PRIVACY_MODE_OFF', () => {
        for (const a of ['PRIVATE_QUOTE', 'PRIVATE_ORDER', 'PRIVATE_ORDERS', 'PRIVATE_REFUND']) {
            expect(privacyDecision(a, ctx({ activeAccount: A }))).toEqual({ block: 'PRIVACY_MODE_OFF' })
        }
    })

    it('normal hesaptan Gizli Hesap\'a aktarma gecer', () => {
        expect(privacyDecision('PRIVATE_QUOTE', ctx())).toBe(null)
        expect(privacyDecision('PRIVATE_ORDER', ctx())).toBe(null)
    })

    it('normal hesaptan baska bir adrese gizli siparis engellenir', () => {
        expect(privacyDecision('PRIVATE_QUOTE', ctx({ outputAddress: '0x' + '12'.repeat(20) }))).toEqual({ block: 'PRIVATE_TRANSFER_TARGET' })
    })

    it('Gizli Hesap\'tan herhangi bir adrese gecer, kendi Gizli adresine de (PRIVATE_SWAP_BRIDGE acik)', () => {
        expect(privacyDecision('PRIVATE_QUOTE', ctx({ signer: GIZLI, outputAddress: A.address }))).toBe(null)
        expect(privacyDecision('PRIVATE_QUOTE', ctx({ signer: GIZLI, outputAddress: GIZLI.address.toUpperCase().replace('0X', '0x') })))
            .toBe(null)
    })

    it('ortam: bu dosyanin kapiyi statik ice aktardigi calismada PRIVATE_SWAP_BRIDGE acik (vitest.config.js varsayilani)', () => {
        expect(PRIVATE_SWAP_BRIDGE).toBe(true)
    })

    it('Gizli Hesap kendi Gizli adresine: QUOTE ve ORDER gecer; buyuk harfli ve 0x\'siz yazim da (bayrak acik)', () => {
        for (const action of ['PRIVATE_QUOTE', 'PRIVATE_ORDER']) {
            for (const spelling of [GIZLI.address, GIZLI.address.toUpperCase().replace('0X', '0x'), GIZLI.address.slice(2)]) {
                expect(privacyDecision(action, ctx({ signer: GIZLI, outputAddress: spelling })), `${action} ${spelling}`).toBe(null)
            }
        }
    })

    it('normal hesap kendi adresine PRIVATE_SAME_ADDRESS (istisna Gizli Hesap\'a ozeldir)', () => {
        for (const action of ['PRIVATE_QUOTE', 'PRIVATE_ORDER']) {
            expect(privacyDecision(action, ctx({ signer: A, outputAddress: A.address })), action).toEqual({ block: 'PRIVATE_SAME_ADDRESS' })
        }
    })

    it('kasadaki Gizli adres bilinmiyorsa Gizli Hesap kendine donus yine PRIVATE_SAME_ADDRESS (fail-closed)', () => {
        for (const action of ['PRIVATE_QUOTE', 'PRIVATE_ORDER']) {
            for (const bilinmeyen of [{ privateAddress: null, privateAccount: null }, { privateAddress: undefined, privateAccount: undefined }]) {
                expect(privacyDecision(action, ctx({ signer: GIZLI, outputAddress: GIZLI.address, ...bilinmeyen })), `${action} ${JSON.stringify(bilinmeyen)}`)
                    .toEqual({ block: 'PRIVATE_SAME_ADDRESS' })
            }
        }
    })

    it('EVM disi kaynak, bilinmeyen imzaci ya da cikti engellenir', () => {
        expect(privacyDecision('PRIVATE_QUOTE', ctx({ chainKind: 'ton' }))).toEqual({ block: 'PRIVATE_EVM_ONLY' })
        expect(privacyDecision('PRIVATE_QUOTE', ctx({ signer: null }))).toEqual({ block: 'PRIVATE_UNSUPPORTED' })
        expect(privacyDecision('PRIVATE_QUOTE', ctx({ outputAddress: null }))).toEqual({ block: 'PRIVATE_UNSUPPORTED' })
    })

    it('ORDER: Gizli Hesap kaynak: yabanci cikti gecer (gonderim), kendi Gizli adresi de gecer (bayrak acik)', () => {
        expect(privacyDecision('PRIVATE_ORDER', ctx({ signer: GIZLI, outputAddress: A.address }))).toBe(null)
        expect(privacyDecision('PRIVATE_ORDER', ctx({ signer: GIZLI, outputAddress: GIZLI.address }))).toBe(null)
    })

    it('Gizli Hesap adresi hic bilinmiyorsa (ne privateAddress ne privateAccount) genel kaynak PRIVATE_TRANSFER_TARGET (fail-closed)', () => {
        for (const a of ['PRIVATE_QUOTE', 'PRIVATE_ORDER']) {
            expect(privacyDecision(a, ctx({ privateAddress: undefined, privateAccount: undefined })), a).toEqual({ block: 'PRIVATE_TRANSFER_TARGET' })
            expect(privacyDecision(a, ctx({ privateAddress: null, privateAccount: null })), a).toEqual({ block: 'PRIVATE_TRANSFER_TARGET' })
        }
    })

    it('liste ve iade gizli modda serbest (iade imzacisi isleyicide denetlenir)', () => {
        expect(privacyDecision('PRIVATE_ORDERS', ctx())).toBe(null)
        expect(privacyDecision('PRIVATE_REFUND', ctx())).toBe(null)
    })
})

describe('privacyDecision -- PRIVATE_* fail-closed ve kimlik (kendi karar dali)', () => {
    const KAYIT = { ...GIZLI, derivationPath: "m/44'/60'/0'/1/0" }
    const ctx = (over) => ({ activeAccount: GIZLI, signer: A, privateAccount: KAYIT, privateAddress: KAYIT.address, outputAddress: KAYIT.address, chainKind: 'evm', ...over })
    const ACTIONS = ['PRIVATE_QUOTE', 'PRIVATE_ORDER', 'PRIVATE_ORDERS', 'PRIVATE_REFUND']

    it('PRIVATE_ACTIONS tam bu dort ad; kapi onlari kontrol eder', () => {
        expect([...PRIVATE_ACTIONS].sort()).toEqual([...ACTIONS].sort())
        for (const a of ACTIONS) expect(privacyNeedsCheck(a), a).toBe(true)
    })

    it('baglam nesne degilse hepsi PRIVATE_CHECK_FAILED', () => {
        for (const a of ACTIONS) {
            for (const bad of [undefined, null, 'x', 42, true]) {
                expect(privacyDecision(a, bad), a).toEqual({ block: 'PRIVATE_CHECK_FAILED' })
            }
        }
    })

    it('imzaci cozulemezse: normal modda PRIVACY_MODE_OFF, gizli modda QUOTE/ORDER PRIVATE_UNSUPPORTED, ORDERS/REFUND serbest', () => {
        for (const signer of [undefined, null, 'x']) {
            for (const a of ACTIONS) {
                expect(privacyDecision(a, ctx({ activeAccount: A, signer })), a).toEqual({ block: 'PRIVACY_MODE_OFF' })
            }
            for (const a of ['PRIVATE_QUOTE', 'PRIVATE_ORDER']) {
                expect(privacyDecision(a, ctx({ signer })), a).toEqual({ block: 'PRIVATE_UNSUPPORTED' })
            }
            for (const a of ['PRIVATE_ORDERS', 'PRIVATE_REFUND']) {
                expect(privacyDecision(a, ctx({ signer })), a).toBe(null)
            }
        }
    })

    it('gizli modun kimligi de kimlikle taninir: bayraksiz Gizli Hesap aktifken mod acik', () => {
        const aktif = { type: 'hd', address: KAYIT.address.slice(2).toUpperCase() }
        expect(privacyDecision('PRIVATE_QUOTE', ctx({ activeAccount: aktif }))).toBe(null)
    })

    it('D1-a: gizli modda genel kaynak ciktisi Gizli Hesap DEGILSE engellenir', () => {
        expect(privacyDecision('PRIVATE_QUOTE', ctx({ outputAddress: '0x' + '12'.repeat(20) }))).toEqual({ block: 'PRIVATE_TRANSFER_TARGET' })
        expect(privacyDecision('PRIVATE_ORDER', ctx({ outputAddress: '0x' + '12'.repeat(20) }))).toEqual({ block: 'PRIVATE_TRANSFER_TARGET' })
    })

    it('KAYIT imzaci ve cikti ayni Gizli adres: bayrak acikken QUOTE ve ORDER gecer', () => {
        expect(privacyDecision('PRIVATE_QUOTE', ctx({ signer: KAYIT, outputAddress: KAYIT.address }))).toBe(null)
        expect(privacyDecision('PRIVATE_ORDER', ctx({ signer: KAYIT, outputAddress: KAYIT.address }))).toBe(null)
    })

    it('istisna YALNIZ kasadaki Gizli adrese dar: anahtarla eslesen ama adresi farkli imzaci kendi adresine donunce PRIVATE_SAME_ADDRESS', () => {
        const imzaci = { type: 'hd', key: KAYIT.key, address: '0x' + '77'.repeat(20) }
        for (const action of ['PRIVATE_QUOTE', 'PRIVATE_ORDER']) {
            expect(privacyDecision(action, ctx({ signer: imzaci, outputAddress: imzaci.address })), action).toEqual({ block: 'PRIVATE_SAME_ADDRESS' })
        }
    })

    it('bayrak almis ama kayitta olmayan genel hesap kendi adresine PRIVATE_SAME_ADDRESS (A-M3)', () => {
        const bayrakli = { ...A, private: true }
        for (const action of ['PRIVATE_QUOTE', 'PRIVATE_ORDER']) {
            expect(privacyDecision(action, ctx({ signer: bayrakli, outputAddress: bayrakli.address })), action).toEqual({ block: 'PRIVATE_SAME_ADDRESS' })
        }
    })

    it('bayrak almis ama kayitta olmayan genel hesap Gizli Hesap sayilmaz (A-M3): yabanci adrese engel', () => {
        const bayrakli = { ...A, private: true }
        expect(privacyDecision('PRIVATE_QUOTE', ctx({ signer: bayrakli, outputAddress: '0x' + '12'.repeat(20) }))).toEqual({ block: 'PRIVATE_TRANSFER_TARGET' })
        expect(privacyDecision('PRIVATE_QUOTE', ctx({ signer: bayrakli }))).toBe(null)
    })

    it('kayitla eslesen bayraksiz imzaci (adres / key / kanonik yol) her adrese gonderebilir', () => {
        const yabanci = '0x' + '12'.repeat(20)
        for (const signer of [
            { type: 'hd', address: KAYIT.address.toUpperCase().replace('0X', '0x') },
            { type: 'hd', address: KAYIT.address.slice(2) },
            { type: 'hd', key: KAYIT.key, address: '0x' + '77'.repeat(20) },
            { type: 'hd', address: '0x' + '77'.repeat(20), derivationPath: "44'/60'/0'/01/0" },
        ]) {
            expect(privacyDecision('PRIVATE_QUOTE', ctx({ signer, outputAddress: yabanci })), JSON.stringify(signer)).toBe(null)
        }
    })

    it('cikti Gizli Hesap adresinin oneksiz buyuk harfli yazimiysa normal imzaci icin gecer', () => {
        expect(privacyDecision('PRIVATE_QUOTE', ctx({ outputAddress: KAYIT.address.slice(2).toUpperCase() }))).toBe(null)
    })

    it('zincir turu evm degilse PRIVATE_EVM_ONLY (null / undefined / solana / ton)', () => {
        for (const chainKind of [null, undefined, 'solana', 'ton']) {
            expect(privacyDecision('PRIVATE_QUOTE', ctx({ chainKind })), String(chainKind)).toEqual({ block: 'PRIVATE_EVM_ONLY' })
            expect(privacyDecision('PRIVATE_ORDER', ctx({ chainKind })), String(chainKind)).toEqual({ block: 'PRIVATE_EVM_ONLY' })
        }
    })
})

describe('PRIVATE_* siniflandirma kilidi', () => {
    const source = readFileSync(fileURLToPath(new URL('../../background.js', import.meta.url)), 'utf8')
    const cases = extractSwitchCases(source)

    // Olumlu iddia: case satirlari regex'e uymaz olursa (bicim degisikligi, tek satirli case)
    // asagidaki suzme bos kalip sessizce gecerdi; bu esitlik onu kalici olarak yakalar.
    it('PRIVATE_ ile baslayan her case PRIVATE_ACTIONS ve CONDITIONAL icinde, ve tam PRIVATE_ACTIONS kadar', () => {
        // PRIVATE_PROVIDER_INFO tek ISTISNA: salt okunur, yalniz sayi/bayrak doner; ALWAYS_ALLOWED'da tam bir kumede (yukaridaki testte kilitli).
        const privateCases = cases.filter((c) => c.startsWith('PRIVATE_') && c !== 'PRIVATE_PROVIDER_INFO')
        expect(cases).toContain('PRIVATE_PROVIDER_INFO')
        expect([...privateCases].sort()).toEqual([...PRIVATE_ACTIONS].sort())
        expect(privateCases.filter((c) => !PRIVATE_ACTIONS.has(c) || !CONDITIONAL.has(c))).toEqual([])
    })

    // Sayfa kokeni kurali (isPrivateModeAction) ailenin tek tanimidir: bu kurala uyan her case
    // ya kosullu kapidan gecer ya da her zaman serbesttir. Genel 'her case TAM BIR kumede' kilidi
    // zaten siniflandirilmamis adi yakalar; buradaki ek iddia yalniz aile uyelerinin BLOCKED_IN_PRIVATE'a
    // dusmemesidir (bir X_PRIVATE_Y adi gizli modda sessizce kesilmemeli) ve ATS_PRIVATE_FEE_QUOTE'un
    // ailede sayildigidir.
    it('kurala uyan her case (PRIVATE_ oneki / _PRIVATE_ icerigi) CONDITIONAL ya da ALWAYS_ALLOWED icinde', () => {
        const aile = cases.filter(isPrivateModeAction)
        expect(aile).toContain('ATS_PRIVATE_FEE_QUOTE')
        expect(aile.filter((c) => !CONDITIONAL.has(c) && !ALWAYS_ALLOWED.has(c))).toEqual([])
    })

    it('case i olan her PRIVATE_ACTIONS adi CONDITIONAL icinde', () => {
        expect([...PRIVATE_ACTIONS].filter((a) => cases.includes(a) && !CONDITIONAL.has(a))).toEqual([])
    })
})

// K13 (cok-ag spec 4.5 madde 2, 5.1): ATS_SALE_* adlari CONDITIONAL'dadir; dedicated kod ATS_SALE_ oneki VE CONDITIONAL
// uyeligi ister (ayri bir liste YOK). Gizli imzaci yalniz gizli mod canliyken ve PRIVATE_ATS_SALE aciksa gecer.
describe('ATS_SALE_* K13 kapisi (CONDITIONAL)', () => {
    const KAYIT = { ...GIZLI, derivationPath: "m/44'/60'/0'/1/0" }
    const ATS_ADLARI = ['ATS_SALE_QUOTE', 'ATS_SALE_EXECUTE']
    const ENGEL = { block: PRIVATE_GATE_CODES.ATS_SALE_BLOCKED }
    const ctxOf = (over) => ({ activeAccount: GIZLI, signer: GIZLI, privateAccount: KAYIT, privateAddress: KAYIT.address, chainKind: 'evm', ...over })
    const gizliMod = (over) => ctxOf(over)
    const genelMod = (over) => ctxOf({ activeAccount: A, signer: A, ...over })

    it('iki ad CONDITIONAL de; BLOCKED_IN_PRIVATE ve ALWAYS_ALLOWED da degil; kapi denetler', () => {
        for (const ad of ATS_ADLARI) {
            expect(CONDITIONAL.has(ad), ad).toBe(true)
            expect(BLOCKED_IN_PRIVATE.has(ad), ad).toBe(false)
            expect(ALWAYS_ALLOWED.has(ad), ad).toBe(false)
            expect(privacyNeedsCheck(ad), ad).toBe(true)
        }
    })

    it('bayrak ACIK: gizli mod + Gizli imzaci + EVM -> gecer (K13); genel mod + genel imzaci -> gecer', () => {
        for (const ad of ATS_ADLARI) {
            expect(privacyDecision(ad, gizliMod()), ad).toBeNull()
            expect(privacyDecision(ad, genelMod()), ad).toBeNull()
        }
    })

    it('bayrak ACIK: gizli mod + genel imzaci, gizli mod + EVM olmayan / bilinmeyen zincir, genel mod + Gizli imzaci -> PRIVATE_ATS_SALE_BLOCKED', () => {
        for (const ad of ATS_ADLARI) {
            expect(privacyDecision(ad, gizliMod({ signer: A })), `${ad} genel imzaci`).toEqual(ENGEL)
            for (const chainKind of ['ton', 'solana', null, undefined]) {
                expect(privacyDecision(ad, gizliMod({ chainKind })), `${ad} ${String(chainKind)}`).toEqual(ENGEL)
            }
            expect(privacyDecision(ad, genelMod({ signer: GIZLI })), `${ad} genel modda Gizli imzaci`).toEqual(ENGEL)
        }
    })

    it('imzaci cozulemezse PRIVATE_CHECK_FAILED (ESLENMEZ); iki modda da', () => {
        for (const ad of ATS_ADLARI) {
            expect(privacyDecision(ad, gizliMod({ signer: null })), ad).toEqual({ block: PRIVATE_GATE_CODES.CHECK_FAILED })
            expect(privacyDecision(ad, genelMod({ signer: null })), ad).toEqual({ block: PRIVATE_GATE_CODES.CHECK_FAILED })
        }
    })

    it('eslenmeyen kodlar: ayni zincir / imzaci ihlali ATS_RUN_ONBOARDING / SWAP ailesinde kendi kodunu korur (yalniz ATS_SALE_ ailesi eslenir)', () => {
        expect(privacyDecision('ATS_RUN_ONBOARDING', gizliMod({ chainKind: 'ton' }))).toEqual({ block: 'PRIVATE_EVM_ONLY' })
        expect(privacyDecision('ATS_RUN_ONBOARDING', gizliMod({ signer: A }))).toEqual({ block: 'PRIVATE_SIGNER_MUST_BE_PRIVATE' })
        expect(privacyDecision('SWAP', genelMod({ signer: GIZLI }))).toEqual({ block: 'PRIVATE_ACCOUNT_IN_PUBLIC_MODE' })
    })

    it('CONDITIONAL e eklenen gelecekteki ATS_SALE_ adi ayni eslemeyi alir; CONDITIONAL de olmayan ATS_SALE_ adi dedicated kod ALMAZ', () => {
        CONDITIONAL.add('ATS_SALE_FUTURE_STEP')
        try {
            expect(privacyDecision('ATS_SALE_FUTURE_STEP', gizliMod({ signer: A }))).toEqual(ENGEL)
            expect(privacyDecision('ATS_SALE_FUTURE_STEP', gizliMod())).toBeNull()
        } finally {
            CONDITIONAL.delete('ATS_SALE_FUTURE_STEP')
        }
        expect(privacyDecision('ATS_SALE_NOT_CLASSIFIED', gizliMod({ signer: A }))).toBeNull()
    })

    describe('PRIVATE_ATS_SALE KAPALI (derleme sabiti; vi.stubEnv + resetModules)', () => {
        afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
        async function kapaliGate() {
            vi.resetModules()
            vi.stubEnv('VITE_PRIVATE_ATS_SALE', 'false')
            return import('./privacyGate')
        }

        it('gizli modda imzaciya BAKILMADAN PRIVATE_ATS_SALE_BLOCKED (bugunku yanit): Gizli imzaci, genel imzaci, cozulemeyen imzaci, zincir turu', async () => {
            const gate = await kapaliGate()
            for (const ad of ATS_ADLARI) {
                for (const over of [{}, { signer: A }, { signer: null }, { chainKind: 'ton' }, { chainKind: undefined }]) {
                    expect(gate.privacyDecision(ad, gizliMod(over)), `${ad} ${JSON.stringify(over)}`).toEqual(ENGEL)
                }
            }
        })

        it('genel mod: genel imzaci gecer (bugunku davranis), Gizli imzaci engellenir', async () => {
            const gate = await kapaliGate()
            for (const ad of ATS_ADLARI) {
                expect(gate.privacyDecision(ad, genelMod()), ad).toBeNull()
                expect(gate.privacyDecision(ad, genelMod({ signer: GIZLI })), ad).toEqual(ENGEL)
            }
        })

        it('kumeler bayraktan bagimsiz: iki ad yine CONDITIONAL de (geri tasinmaz)', async () => {
            const gate = await kapaliGate()
            for (const ad of ATS_ADLARI) {
                expect(gate.CONDITIONAL.has(ad), ad).toBe(true)
                expect(gate.BLOCKED_IN_PRIVATE.has(ad), ad).toBe(false)
            }
        })
    })
})

// T28 R7: ATS_FUEL_BALANCE ALWAYS_ALLOWED kalir (gizli modda Header hapi Gizli Hesap'in ATS bakiyesini okur) YALNIZ cunku
// okuma duz bir zincir RPC'sine balanceOf'tur: Gizli adres herkese acik BSC dugumune gider, bu her Gizli Hesap bakiye
// okumasiyla AYNI kabul edilmis gorunurluktur (spec 10.2 / 10.13 ve 23.11 d; 23.3 gerekce DEGIL). Baska bir uzak servise
// (kendi backend'imiz, ucret/teklif/izleme) adres giderse bu kume degismek ZORUNDA: o zaman bu test kirilir.
describe('ATS_FUEL_BALANCE yalniz zincir RPC balanceOf okur (T28 R7)', () => {
    const source = readFileSync(fileURLToPath(new URL('../../background.js', import.meta.url)), 'utf8')
    // Okuma ORTAK yardimcilardadir (bscAtsReadConfig / readBscAtsBalance); tek kullanicisi pill'dir (atsFuelBalance). ATS-once kapisi
    // (assertAtsFirst) 2026-10-28 kullanici karariyla kaldirildi ve bu kilidin kapsami geri daraldi.
    const bas = source.indexOf('function bscAtsReadConfig(')
    const govde = source.slice(bas, source.indexOf('\nasync function atsFeeQuote(', bas))

    it('islevin govdesi bulundu ve ALWAYS_ALLOWED te', () => {
        expect(bas).toBeGreaterThan(-1)
        expect(govde.length).toBeGreaterThan(200)
        expect(ALWAYS_ALLOWED.has('ATS_FUEL_BALANCE')).toBe(true)
    })

    it('adres yalniz JsonRpcProvider(zincir RPC) + balanceOf e gider; fetch/axios/backend cagrisi yok', () => {
        expect(bas).toBeGreaterThan(-1)
        expect(govde).toMatch(/src\.rpc\[0\]\.url/)
        expect(govde).toMatch(/new ethers\.JsonRpcProvider\(rpcUrl\)/)
        expect(govde).toMatch(/balanceOf\(address\)/)
        expect(govde).not.toMatch(/fetch\(|axios|config\.api|getAxios|XMLHttpRequest|sendBeacon|apiBase/i)
    })

    // Kapi KALDIRILDI: Gizli adres ATS bakiyesi icin arka planda baska bir yoldan da okunmaz.
    it('ATS-once kapisi (assertAtsFirst) arka planda YOK', () => {
        expect(source).not.toMatch(/assertAtsFirst|PRIVATE_ATS_FIRST/)
    })

    it('RPC adresi supported_chains BSC kaydindan, bilinen halka acik dugum', async () => {
        const chains = (await import('../../data/supported_chains.json')).default
        const bsc = chains.find((c) => Number(c.chainId) === 56)
        expect(bsc.rpc[0].url).toMatch(/^https:\/\/bsc-dataseed[0-9]*\.(bnbchain\.org|binance\.org)$/)
    })
})

// xStocks (CoW Al/Sat) gizli modda KAPALI (sahip karari 2026-10-16): CoW emri Gizli adresi CoW'a IP ile gosterir,
// gizli modda fiyat istekleri kapali ve xStocks "fiyat yoksa kilit" der. origin/main'in sekiz COW_* mesaji birlesmeyle
// gelir; hicbir kumede degillerdi (siniflandirma kilidi kirmizi) ve gizli modda isleyiciye ulasip Gizli Hesap'i CoW
// servisine sahip olarak verirlerdi. Dagitici seviyesindeki kanit: background.cowPrivacy.test.js.
describe('xStocks (CoW) mesajlari gizli modda KAPALI', () => {
    const COW_MESAJLARI = [
        'COW_QUOTE', 'COW_PLACE_ORDER', 'COW_APPROVE_QUOTE', 'COW_APPROVE_EXECUTE', 'COW_ORDERS_REFRESH',
        // Faz 3 ATS ucreti + iade hatti (main 2a8acd4): kasayi acar, ATS bakiyesinden ucret op'u imzalar.
        'COW_FEE_STATUS', 'COW_FEE_PAY', 'COW_FEE_APPROVE_CHANGE',
    ]
    const gizliCtx = { activeAccount: GIZLI, signer: GIZLI, privateAddress: GIZLI.address, recipient: null, chainKind: 'evm' }
    const normalCtx = { activeAccount: A, signer: A, privateAddress: GIZLI.address, recipient: null, chainKind: 'evm' }
    const source = readFileSync(fileURLToPath(new URL('../../background.js', import.meta.url)), 'utf8')

    it('switch in COW_ ailesi tam bu sekiz ad ve hepsi YALNIZ BLOCKED_IN_PRIVATE te (yeni COW_ adi baska kumeye yazilamaz)', () => {
        const aile = extractSwitchCases(source).filter((c) => c.startsWith('COW_'))
        expect([...aile].sort()).toEqual([...COW_MESAJLARI].sort())
        for (const ad of aile) {
            expect(BLOCKED_IN_PRIVATE.has(ad), ad).toBe(true)
            expect(ALWAYS_ALLOWED.has(ad), ad).toBe(false)
            expect(CONDITIONAL.has(ad), ad).toBe(false)
            expect(privacyNeedsCheck(ad), ad).toBe(true)
        }
    })

    it.each(COW_MESAJLARI)('%s: gizli modda PRIVATE_EVM_ONLY ile engellenir; yanit ic aksiyon bicimindedir', (ad) => {
        expect(privacyDecision(ad, gizliCtx)).toEqual({ block: PRIVATE_GATE_CODES.EVM_ONLY })
        expect(privacyBlockResponse(ad, PRIVATE_GATE_CODES.EVM_ONLY)).toEqual({ success: false, error: 'PRIVATE_EVM_ONLY' })
    })

    it.each(COW_MESAJLARI)('%s: normal modda kapidan gecer', (ad) => {
        expect(privacyDecision(ad, normalCtx)).toBe(null)
    })

    it.each(COW_MESAJLARI)('%s: baglam yoksa PRIVATE_CHECK_FAILED (fail-closed)', (ad) => {
        expect(privacyDecision(ad, undefined)).toEqual({ block: PRIVATE_GATE_CODES.CHECK_FAILED })
    })
})

describe('normal mod: dApp islem ve imzalarinda Gizli adres (yukun herhangi bir yerinde)', () => {
    const ctx = (over) => ({ activeAccount: A, signer: A, privateAddress: GIZLI.address, recipient: null, chainKind: 'evm', ...over })
    const DAPP_ISTEKLERI = ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4', 'SEND_TRANSACTION']

    it('yukte Gizli adres varsa her dApp islem/imza istegi RECIPIENT_IS_PRIVATE', () => {
        for (const action of DAPP_ISTEKLERI) {
            expect(privacyDecision(action, ctx({ payloadHasPrivate: true })), action).toEqual({ block: 'RECIPIENT_IS_PRIVATE' })
        }
    })

    it('yukte Gizli adres yoksa normal istek gecer', () => {
        for (const action of ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4']) {
            expect(privacyDecision(action, ctx({ payloadHasPrivate: false })), action).toBe(null)
            expect(privacyDecision(action, ctx({})), action).toBe(null)
        }
    })

    it('ret sayfaya NORMAL kullanici reti olarak gider (4001, mod sizmaz)', () => {
        for (const action of ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4']) {
            const res = privacyBlockResponse(action, 'RECIPIENT_IS_PRIVATE', {})
            expect(res.error.code).toBe(4001)
            expect(JSON.stringify(res)).not.toMatch(/private|gizli/i)
        }
    })

    it('gizli modda ayni istek eskisi gibi PRIVATE_DAPP_BLOCKED (degismedi)', () => {
        const gizli = { activeAccount: GIZLI, signer: GIZLI, privateAddress: GIZLI.address, chainKind: 'evm', payloadHasPrivate: true }
        expect(privacyDecision('eth_sendTransaction', gizli)).toEqual({ block: 'PRIVATE_DAPP_BLOCKED' })
        expect(privacyDecision('personal_sign', gizli)).toEqual({ block: 'PRIVATE_DAPP_BLOCKED' })
    })
})

// Klasik Takas/Kopru (SWAP, SWAP_QUOTE, BRIDGE, BRIDGE_QUOTE ve iki ATS ucret teklifi) gizli modda VITE_PRIVATE_SWAP_BRIDGE degerinden BAGIMSIZ kapali:
// gizli yol SilentSwap ekranlaridir (PRIVATE_QUOTE / PRIVATE_ORDER). Bayrak yalniz o ekranlari ve dar SAME_ADDRESS istisnasini acar. Normal mod ETKILENMEZ.
describe('klasik Takas/Kopru: gizli modda bayraktan bagimsiz kapali (bayrak "false" ve normal mod ayrintilari; derleme sabiti; vi.stubEnv + resetModules)', () => {
    const KAYIT = { ...GIZLI, derivationPath: "m/44'/60'/0'/1/0" }
    const AD = ['SWAP', 'SWAP_QUOTE', 'BRIDGE', 'BRIDGE_QUOTE', 'ATS_SWAP_FEE_QUOTE', 'ATS_BRIDGE_FEE_QUOTE']
    const ctxOf = (over) => ({ activeAccount: GIZLI, signer: GIZLI, privateAccount: KAYIT, privateAddress: KAYIT.address, chainKind: 'evm', ...over })
    afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
    async function gateWith(value) {
        vi.resetModules()
        if (value !== undefined) vi.stubEnv('VITE_PRIVATE_SWAP_BRIDGE', value)
        return import('./privacyGate')
    }

    it('gizli modda imzaciya BAKILMADAN reddedilir (Gizli imzaci, genel imzaci, cozulemeyen imzaci, zincir turu)', async () => {
        const gate = await gateWith('false')
        const ENGEL = { block: gate.PRIVATE_GATE_CODES.SWAP_BRIDGE_CLOSED }
        expect(ENGEL.block).toMatch(/^PRIVATE_/)
        for (const ad of AD) {
            for (const over of [{}, { signer: A }, { signer: null }, { signer: undefined }, { chainKind: 'ton' }, { chainKind: undefined }]) {
                expect(gate.privacyDecision(ad, ctxOf(over)), `${ad} ${JSON.stringify(over)}`).toEqual(ENGEL)
            }
        }
    })

    it('bayrak degeri "", "1", "TRUE", "yes" iken de kapali (bayrak "true" ile ayni sonuc)', async () => {
        for (const v of ['', '1', 'TRUE', 'yes']) {
            const gate = await gateWith(v)
            for (const ad of AD) expect(gate.privacyDecision(ad, ctxOf()), `${ad} ${v}`).toEqual({ block: gate.PRIVATE_GATE_CODES.SWAP_BRIDGE_CLOSED })
        }
    })

    it('bayrak "true": YINE kapali (klasik yolu bayrak acmaz)', async () => {
        const gate = await gateWith('true')
        for (const ad of AD) expect(gate.privacyDecision(ad, ctxOf()), ad).toEqual({ block: gate.PRIVATE_GATE_CODES.SWAP_BRIDGE_CLOSED })
    })

    it('normal mod ETKILENMEZ: genel imzaci gecer, Gizli imzaci eski kodla engellenir', async () => {
        const gate = await gateWith('false')
        for (const ad of AD) {
            expect(gate.privacyDecision(ad, ctxOf({ activeAccount: A, signer: A })), ad).toBeNull()
            expect(gate.privacyDecision(ad, ctxOf({ activeAccount: A, signer: GIZLI })), ad).toEqual({ block: 'PRIVATE_ACCOUNT_IN_PUBLIC_MODE' })
        }
    })

    it('baglam yoksa yine CHECK_FAILED (fail-closed bozulmaz)', async () => {
        const gate = await gateWith('false')
        for (const ad of AD) expect(gate.privacyDecision(ad, null), ad).toEqual({ block: gate.PRIVATE_GATE_CODES.CHECK_FAILED })
    })

    it('baska gizli aksiyonlar bayraktan etkilenmez: ATS_PRIVATE_FEE_QUOTE ve gizli siparis ailesi', async () => {
        const gate = await gateWith('false')
        expect(gate.privacyDecision('ATS_PRIVATE_FEE_QUOTE', ctxOf())).toBeNull()
        expect(gate.privacyDecision('PRIVATE_ORDERS', ctxOf())).toBeNull()
        expect(gate.privacyDecision('PRIVATE_REFUND', ctxOf())).toBeNull()
    })

    it('kumeler bayraktan bagimsiz: adlar CONDITIONAL de kalir (geri tasinmaz)', async () => {
        const gate = await gateWith('false')
        for (const ad of AD) {
            expect(gate.CONDITIONAL.has(ad), ad).toBe(true)
            expect(gate.BLOCKED_IN_PRIVATE.has(ad), ad).toBe(false)
        }
    })

    it('ret kodu ic yanitta kalir; sayfaya giden dapp retlerini etkilemez', async () => {
        const gate = await gateWith('false')
        expect(gate.privacyBlockResponse('SWAP', gate.PRIVATE_GATE_CODES.SWAP_BRIDGE_CLOSED)).toEqual({ success: false, error: 'PRIVATE_SWAP_BRIDGE_CLOSED' })
    })
})

// Kendine Takas/Kopru (SilentSwap): SAME_ADDRESS istisnasi PRIVATE_SWAP_BRIDGE'e baglidir. Bayrak derleme sabitidir; kapali
// uretim davranisi (istisna YOK, Gizli Hesap kendine donuste PRIVATE_SAME_ADDRESS) burada vi.stubEnv + resetModules ile sinanir.
describe('SAME_ADDRESS istisnasi: PRIVATE_SWAP_BRIDGE KAPALIYKEN uretim davranisi (derleme sabiti; vi.stubEnv + resetModules)', () => {
    const KAYIT = { ...GIZLI, derivationPath: "m/44'/60'/0'/1/0" }
    const ACTIONS = ['PRIVATE_QUOTE', 'PRIVATE_ORDER']
    const bare = { activeAccount: GIZLI, signer: GIZLI, privateAddress: GIZLI.address, outputAddress: GIZLI.address, chainKind: 'evm' }
    const withAccount = { activeAccount: GIZLI, signer: KAYIT, privateAccount: KAYIT, privateAddress: KAYIT.address, outputAddress: KAYIT.address, chainKind: 'evm' }
    afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
    async function gateWith(value) {
        vi.resetModules()
        vi.stubEnv('VITE_PRIVATE_SWAP_BRIDGE', value)
        return import('./privacyGate')
    }

    it('bayrak "false": Gizli Hesap kendi adresine PRIVATE_SAME_ADDRESS (QUOTE ve ORDER, iki baglam bicimi)', async () => {
        const gate = await gateWith('false')
        for (const action of ACTIONS) {
            for (const builder of [bare, withAccount]) {
                expect(gate.privacyDecision(action, builder), `${action} ${builder === bare ? 'bare' : 'withAccount'}`)
                    .toEqual({ block: gate.PRIVATE_GATE_CODES.SAME_ADDRESS })
            }
        }
    })

    it('bayrak bos / tanimsiz / "1" / "TRUE": yalniz tam "true" acar, digerleri SAME_ADDRESS engeli', async () => {
        for (const value of ['', '1', 'TRUE', undefined]) {
            const gate = await gateWith(value)
            for (const action of ACTIONS) {
                expect(gate.privacyDecision(action, bare), `${action} ${String(value)}`).toEqual({ block: gate.PRIVATE_GATE_CODES.SAME_ADDRESS })
            }
        }
    })

    it('olumlu kontrol, bayrak "true": ayni baglamlar gecer (null)', async () => {
        const gate = await gateWith('true')
        for (const action of ACTIONS) {
            for (const builder of [bare, withAccount]) {
                expect(gate.privacyDecision(action, builder), `${action} ${builder === bare ? 'bare' : 'withAccount'}`).toBe(null)
            }
        }
    })

    it('bayrak kapaliyken istisna disindaki kararlar degismez', async () => {
        const gate = await gateWith('false')
        expect(gate.privacyDecision('PRIVATE_QUOTE', { ...bare, outputAddress: A.address })).toBe(null)
        expect(gate.privacyDecision('PRIVATE_QUOTE', { ...bare, signer: A, outputAddress: GIZLI.address })).toBe(null)
        expect(gate.privacyDecision('PRIVATE_QUOTE', { ...bare, signer: A, outputAddress: '0x' + '12'.repeat(20) })).toEqual({ block: 'PRIVATE_TRANSFER_TARGET' })
    })
})

// Klasik alti ad (SIX) gizli kimlik icin VITE_PRIVATE_SWAP_BRIDGE degerinden BAGIMSIZ reddedilir: bayrak yalniz SilentSwap ekranlarini
// ve privateActionDecision'daki dar SAME_ADDRESS istisnasini acar. Her ortam degeri icin modul yeniden yuklenir (derleme sabiti).
describe('klasik Takas/Kopru kapisi bayraktan bagimsiz', () => {
    const KAYIT = { ...GIZLI, derivationPath: "m/44'/60'/0'/1/0" }
    const KAPALI = { block: 'PRIVATE_SWAP_BRIDGE_CLOSED' }
    const ctxOf = (over) => ({ activeAccount: GIZLI, signer: GIZLI, privateAccount: KAYIT, privateAddress: KAYIT.address, chainKind: 'evm', ...over })
    afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
    // Her zaman stub'lar: gateWith(undefined) degiskeni GERCEKTEN siler (vi.stubEnv(ad, undefined) siler), yoksa vitest
    // varsayilani 'true' "tanimsiz" bacagina sizardi.
    async function gateWith(value) {
        vi.resetModules()
        vi.stubEnv('VITE_PRIVATE_SWAP_BRIDGE', value)
        return import('./privacyGate')
    }

    it('ortam: bayrak degeri gercekten uygulaniyor (true acik; false, bos ve tanimsiz kapali)', async () => {
        for (const v of ['true', 'false', '', undefined]) {
            await gateWith(v)
            const { PRIVATE_SWAP_BRIDGE } = await import('../featureFlags')
            expect(PRIVATE_SWAP_BRIDGE, `bayrak=${String(v)}`).toBe(v === 'true')
        }
    })

    it('gizli kimlik: alti klasik ad, bayrak "true", "false", "" ve tanimsiz iken, her imzaci ve zincir turunde PRIVATE_SWAP_BRIDGE_CLOSED', async () => {
        for (const v of ['true', 'false', '', undefined]) {
            const gate = await gateWith(v)
            for (const ad of SIX) {
                for (const signer of [GIZLI, A, null, undefined]) {
                    for (const chainKind of ['evm', 'ton', undefined]) {
                        expect(gate.privacyDecision(ad, ctxOf({ signer, chainKind })), `${ad} bayrak=${String(v)} imzaci=${String(signer?.key)} zincir=${String(chainKind)}`).toEqual(KAPALI)
                    }
                }
                // Kasadaki kayit baglamda YOK: kimlik yalniz `private` isaretinden gelir.
                expect(gate.privacyDecision(ad, { activeAccount: GIZLI, signer: GIZLI, chainKind: 'evm' }), `${ad} bayrak=${String(v)} kayitsiz`).toEqual(KAPALI)
            }
        }
    })

    // Gizli kimlik YALNIZ `private` isaretiyle degil, kasadaki kayitla eslesmeyle de bilinir (isPrivateIdentity: adres, key, kanonik turetme yolu).
    // Isareti dusmus eski kayitlar gercek (background.swapQuotePrivacy.test.js "bayragi dusmus eski Gizli Hesap kaydi"): kapi bunlari da kesmeli.
    it('bayragi dusmus ama kasadaki kayitla eslesen AKTIF hesap da gizli kimliktir: alti klasik ad (bayrak "true" ve "false") PRIVATE_SWAP_BRIDGE_CLOSED; eslesmeyen bayraksiz genel hesap kapanmaz', async () => {
        const bayraksiz = [
            { type: 'hd', address: GIZLI.address },
            // sameAddress harf boyutu ve 0x onekini yok sayar: oneksiz buyuk harfli yazim da ayni adrestir.
            { type: 'hd', address: GIZLI.address.slice(2).toUpperCase() },
            { type: 'hd', key: GIZLI.key },
            { type: 'hd', derivationPath: KAYIT.derivationPath },
        ]
        // Bu hesaplarin hicbiri `private` isareti tasimaz (aksi halde test eski, isaretli yolu tekrar ederdi).
        for (const hesap of bayraksiz) expect(hesap.private, JSON.stringify(hesap)).toBeUndefined()
        for (const v of ['true', 'false']) {
            const gate = await gateWith(v)
            for (const ad of SIX) {
                for (const activeAccount of bayraksiz) {
                    expect(gate.privacyDecision(ad, ctxOf({ activeAccount, signer: activeAccount })), `${ad} bayrak=${v} ${JSON.stringify(activeAccount)}`).toEqual(KAPALI)
                }
                // Olumlu kontrol: kayitla eslesmeyen bayraksiz genel hesap Gizli kimlik degildir, ayni adlar kapanmaz.
                expect(gate.privacyDecision(ad, ctxOf({ activeAccount: A, signer: A })), `${ad} bayrak=${v} genel`).toBeNull()
            }
        }
    })

    it('bayrak "true" iken normal mod ETKILENMEZ: genel hesap altisini da gecer, Gizli imzaci eski kodla engellenir', async () => {
        const gate = await gateWith('true')
        for (const ad of SIX) {
            expect(gate.privacyDecision(ad, ctxOf({ activeAccount: A, signer: A })), ad).toBeNull()
            expect(gate.privacyDecision(ad, ctxOf({ activeAccount: A, signer: GIZLI })), ad).toEqual({ block: 'PRIVATE_ACCOUNT_IN_PUBLIC_MODE' })
        }
    })

    it('bayrak "true" iken gizli siparis ailesi kapanmaz: ATS_PRIVATE_FEE_QUOTE, PRIVATE_ORDERS, PRIVATE_REFUND', async () => {
        const gate = await gateWith('true')
        for (const ad of ['ATS_PRIVATE_FEE_QUOTE', 'PRIVATE_ORDERS', 'PRIVATE_REFUND']) {
            expect(gate.privacyDecision(ad, ctxOf()), ad).toBeNull()
        }
    })

    it('bayrak "true" iken ATS satin alma kapanmaz: ATS_SALE_QUOTE ve ATS_SALE_EXECUTE Gizli imzaciyla SWAP_BRIDGE_CLOSED DEGIL', async () => {
        const gate = await gateWith('true')
        for (const ad of ['ATS_SALE_QUOTE', 'ATS_SALE_EXECUTE']) {
            expect(gate.privacyDecision(ad, ctxOf()), ad).not.toEqual(KAPALI)
        }
        // Olumlu kontrol: ATS_SALE dali canli (genel imzaci PRIVATE_ATS_SALE_BLOCKED alir), yani "kapali degil" bos bir iddia degil.
        expect(gate.privacyDecision('ATS_SALE_QUOTE', ctxOf({ signer: A }))).toEqual({ block: 'PRIVATE_ATS_SALE_BLOCKED' })
    })

    it('kaynak kilidi: kapi dali bayrak okumaz (yorumsuz privacyGate.js)', () => {
        const kod = yorumsuz(readFileSync(fileURLToPath(new URL('./privacyGate.js', import.meta.url)), 'utf8'))
        const KAPI_DALI = /if \(SWAP_BRIDGE_ACTIONS\.has\(action\) && isPrivateIdentity\(ctx\.activeAccount, ctx\)\)/
        const BAYRAKLI = /PRIVATE_SWAP_BRIDGE\s*&&[^\n]*SWAP_BRIDGE_ACTIONS|SWAP_BRIDGE_ACTIONS[^\n]*&&\s*!?PRIVATE_SWAP_BRIDGE\b/
        // Regex oz-denetimi ESKI metinde: kilit bos yere gecemez.
        const ESKI = 'if (!PRIVATE_SWAP_BRIDGE && SWAP_BRIDGE_ACTIONS.has(action) && isPrivateIdentity(ctx.activeAccount, ctx)) {'
        expect(ESKI).toMatch(BAYRAKLI)
        expect(ESKI).not.toMatch(KAPI_DALI)
        expect(kod).toMatch(KAPI_DALI)
        expect(kod).not.toMatch(BAYRAKLI)
        expect(kod.match(/SWAP_BRIDGE_ACTIONS\.has\(/g)).toHaveLength(1)
    })
})
