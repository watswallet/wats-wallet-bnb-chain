// Basarisiz GONDERIM sayim noktalari (kaynak taramasi) - transfer bolumu.
// NEDEN kaynak taramasi: sayim noktalari para tasiyan akislarin icinde, refaktor yok;
// "yanlis dala tasindi / basari sonrasi hata sayildi / kapi hatasi sayildi" hatalarini
// yalniz yerlesimi kilitleyen test yakalar. Davranis countAction testlerinde.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { requireEvmChain } from './utils/vm'
import { BRIDGE_QUOTE_NOT_FOUND, BRIDGE_RECEIVER_MISMATCH } from './utils/bridgeQuoteGuard'

const oku = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const yorumsuz = (s) => s.replace(/^\s*\/\/.*$/gm, '')
const src = yorumsuz(oku('./background.js'))

function govde(ad) {
    const bas = src.indexOf(`async function ${ad}(`)
    expect(bas, `${ad} bulunamadi`).toBeGreaterThan(-1)
    const sonra = src.slice(bas + 10).search(/\n(?:async function|function) \w+\(/)
    return src.slice(bas, sonra === -1 ? src.length : bas + 10 + sonra)
}

describe('transfer hata sayimi', () => {
    it('sendTxInternal catch: countOwnTransferFailure, belirsiz/gonderim sonrasi ATS sonucu atlanir', () => {
        const g = govde('sendTxInternal')
        const hata = g.slice(g.indexOf('} catch (error)'))
        expect(hata).toContain('if (!isUncountedOutcomeFailure(error) && !isUncountedGateFailure(error)) countOwnTransferFailure(message)')
        expect(g.match(/countOwnTransferFailure\(/g).length).toBe(1)
    })

    it('countOwnTransferFailure AYNI countAs kosuluyla (Dapp.vue yolu hata sayilmaz)', () => {
        const bas = src.indexOf('function countOwnTransferFailure(')
        expect(bas).toBeGreaterThan(-1)
        const g = src.slice(bas, src.indexOf('\n}', bas))
        expect(g).toContain("message?.message?.countAs === 'transfer'")
        expect(g).toContain("countAnalyticsFailure('transfer')")
        expect(oku('./components/Dapp.vue')).not.toContain('countAs')
    })

    for (const [ad, adlandirma] of [['sendTonInternal', 'TON native'], ['sendJettonInternal', 'TON jetton']]) {
        it(`${adlandirma}: catch countAnalyticsFailure('transfer') ve bekleme/kilit kodlari haric`, () => {
            const g = govde(ad)
            const hata = g.slice(g.lastIndexOf('} catch (error)'))
            expect(g.match(/countAnalyticsFailure\(/g).length).toBe(1)
            expect(hata).toContain("countAnalyticsFailure('transfer')")
            expect(hata).toContain('TON_UNCOUNTED_FAILURES.has(error?.message)')
            expect(hata).toContain('TON_UNCOUNTED_FAILURES.has(errorCode)')
            // createTonKeyPair kilit cumlesi ve 'Unsupported chain' (spec 7c) ortak kapi ile haric
            expect(hata).toContain("!isUncountedGateFailure(error)) countAnalyticsFailure('transfer')")
        })
    }

    it('TON_UNCOUNTED_FAILURES tam uc kodu tasir', () => {
        const m = src.match(/const TON_UNCOUNTED_FAILURES = new Set\(\[([^\]]*)\]\)/)
        expect(m).not.toBeNull()
        const kodlar = [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort()
        expect(kodlar).toEqual(['TON_RELAY_PENDING_SETTLEMENT', 'TON_TX_ALREADY_PENDING', 'WALLET_LOCKED'])
    })

    it('relay status !== sent dalinda hata sayimi YOK (relay donus yolu)', () => {
        for (const ad of ['sendTonInternal', 'sendJettonInternal']) {
            const g = govde(ad)
            const i = g.search(/[rR]elayOut\?\.status === 'sent'\) countAnalytics/)
            expect(i).toBeGreaterThan(-1)
            const satir = g.slice(i, g.indexOf('\n', i))
            expect(satir).not.toContain('Failure')
            // relay donus yolu ile ilk `return` arasinda hata sayimi yok
            const donus = g.slice(i, g.indexOf('return', i))
            expect(donus).not.toContain('countAnalyticsFailure')
        }
    })

    it("Solana: SOLANA_SEND catch hata sayimi ve haric kodlar; broadcastStatusUnknown hata degil", () => {
        const bas = src.indexOf("case 'SOLANA_SEND':")
        expect(bas).toBeGreaterThan(-1)
        const blok = src.slice(bas, src.indexOf('case "HEARTBEAT"', bas))
        expect(blok).toContain('.catch(e => {')
        expect(blok).toContain("countAnalyticsFailure('transfer')")
        expect(blok).toContain('SOLANA_UNCOUNTED_FAILURES.has(e?.message)')
        const m = src.match(/const SOLANA_UNCOUNTED_FAILURES = new Set\(\[([^\]]*)\]\)/)
        expect(m).not.toBeNull()
        const kodlar = [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort()
        expect(kodlar).toEqual(['DERIVED_ADDRESS_MISMATCH', 'NO_ACTIVE_ACCOUNT', 'SOLANA_UNSUPPORTED_ACCOUNT', 'VAULT_NOT_FOUND', 'WALLET_LOCKED'])
        // belirsiz yayin donusu `.then` yolunda: sayim yok
        expect(govde('sendSolanaTransfer')).not.toContain('countAnalyticsFailure')
    })

    it('basari sayimindan sonra hata sayimi yok (her transfer fonksiyonunda)', () => {
        for (const ad of ['sendTxInternal', 'sendTonInternal', 'sendJettonInternal']) {
            const g = govde(ad)
            const catchIdx = g.lastIndexOf('} catch (error)')
            const sonBasari = Math.max(g.lastIndexOf("countAnalytics('transfer'"), g.lastIndexOf('countOwnTransfer(message)'))
            const hata = Math.max(g.indexOf('countAnalyticsFailure('), g.indexOf('countOwnTransferFailure('))
            expect(sonBasari, ad).toBeGreaterThan(-1)
            expect(hata, ad).toBeGreaterThan(-1)
            // hata sayimi catch icinde; basari sayimlari catch'ten ONCE ve catch icinde basari yok
            expect(hata, ad).toBeGreaterThan(catchIdx)
            expect(sonBasari, ad).toBeLessThan(catchIdx)
        }
    })
})

describe('swap hata sayimi', () => {
    it("swap catch: countAnalyticsFailure('swap') belirsiz/gonderim sonrasi sonucta atlanir, basari sayimi catch'te yok", () => {
        const g = govde('swap')
        const hata = g.slice(g.indexOf('} catch (error)'))
        expect(hata).toContain("if (!isUncountedOutcomeFailure(error) && !SWAP_UNCOUNTED_FAILURES.has(error?.message) && !isUncountedGateFailure(error)) countAnalyticsFailure('swap')")
        expect(hata).not.toMatch(/countAnalytics\(/)
        expect(g.match(/countAnalyticsFailure\(/g).length).toBe(1)
    })

    it('SWAP_UNCOUNTED_FAILURES TON kodlarini ve Unsupported chain mesajini tasir', () => {
        expect(src).toContain("const SWAP_UNCOUNTED_FAILURES = new Set([...TON_UNCOUNTED_FAILURES, 'Unsupported chain'])")
    })

    it('swap fonksiyonunda hata sayimi basari sayimindan sonra gelmez', () => {
        const g = govde('swap')
        const catchIdx = g.indexOf('} catch (error)')
        expect(g.lastIndexOf("countAnalytics('swap'")).toBeLessThan(catchIdx)
        expect(g.indexOf('countAnalyticsFailure(')).toBeGreaterThan(catchIdx)
    })

    it('TON takas hatasi swap catch ine duser: tonSwapExecute kendi icinde hata saymaz', () => {
        expect(govde('tonSwapExecute')).not.toContain('countAnalyticsFailure')
    })

    it('ATS satis catch: txId kosulu, requote/sale-closed/result-unknown haric', () => {
        const g = govde('atsSaleExecute')
        const hata = g.slice(g.indexOf('} catch (e)'))
        expect(g.match(/countAnalyticsFailure\(/g).length).toBe(1)
        expect(hata).toContain("if (txId && !isSaleRequoteError(e) && !SALE_UNCOUNTED_CODES.has(saleErrorOf(e).code)) countAnalyticsFailure('swap')")
        expect(src).toContain("const SALE_UNCOUNTED_CODES = new Set(['sale-closed', 'result-unknown'])")
        // requote dali return ile cikar: hata sayimindan ONCE
        const requoteDali = hata.indexOf('isSaleRequoteError(e) && buyer')
        expect(requoteDali).toBeGreaterThan(-1)
        expect(hata.indexOf('return', requoteDali)).toBeLessThan(hata.indexOf('countAnalyticsFailure('))
    })
})

describe('bridge hata sayimi', () => {
    it("bridge catch: countAnalyticsFailure('bridge'), belirsiz/gonderim sonrasi sonuc atlanir, hisse kapisi erken donusunde sayim yok", () => {
        const g = govde('bridge')
        const catchIdx = g.indexOf('} catch (error)')
        const hata = g.slice(catchIdx)
        expect(hata).toContain("if (!isUncountedOutcomeFailure(error) && !isUncountedGateFailure(error)) countAnalyticsFailure('bridge')")
        expect(g.match(/countAnalyticsFailure\(/g).length).toBe(1)
        // hisse kapisi (bridgeTargetGated) try/catch'ten ONCE yanit doner: sayim yok
        const kapi = g.slice(g.indexOf('if (bridgeTargetGated('), g.indexOf('const txId'))
        expect(kapi).toContain('return sendResponse(')
        expect(kapi).not.toContain('countAnalytics')
        // assertBridgeQuoteBound try icinde: reddi catch'e duser ve sayilir
        expect(g.indexOf('await assertBridgeQuoteBound(')).toBeGreaterThan(g.indexOf('transactionQueue.push('))
        expect(g.indexOf('await assertBridgeQuoteBound(')).toBeLessThan(catchIdx)
    })

    it('bridge basari sonrasi hata sayimi yok', () => {
        const g = govde('bridge')
        const sonSayim = g.lastIndexOf("countAnalytics('bridge', chain)")
        const hataSayim = g.indexOf("countAnalyticsFailure('bridge')")
        // tek hata sayimi catch'te; basari dallari resolve ile doner, sonraki .then/.catch durum guncellemeleri saymaz
        expect(hataSayim).toBeGreaterThan(sonSayim)
        const sonrasi = g.slice(g.indexOf('bridgeData.waitPromise.then('), g.indexOf('} catch (error)'))
        expect(sonrasi).not.toContain('countAnalytics')
    })
})

describe('CoW hata sayimi', () => {
    const KESIN = ['NO_LIQUIDITY', 'AMOUNT_TOO_SMALL', 'INSUFFICIENT_BALANCE', 'INSUFFICIENT_ALLOWANCE', 'FORBIDDEN', 'RATE_LIMITED', 'CLOCK_SKEW', 'REJECTED']

    it('COW_COUNTED_REJECTS tam sekiz kesin ret kodunu tasir', () => {
        const m = src.match(/const COW_COUNTED_REJECTS = new Set\(\[([^\]]*)\]\)/)
        expect(m).not.toBeNull()
        const kodlar = [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort()
        expect(kodlar).toEqual([...KESIN].sort())
    })

    it('belirsiz/kullanici disi kodlar kumede yok (TIMEOUT, NETWORK, SERVER, DUPLICATED_ORDER, QUOTE_*, UNKNOWN)', () => {
        const m = src.match(/const COW_COUNTED_REJECTS = new Set\(\[([^\]]*)\]\)/)
        for (const k of ['TIMEOUT', 'NETWORK', 'SERVER', 'DUPLICATED_ORDER', 'QUOTE_EXPIRED', 'QUOTE_NOT_FOUND', 'QUOTE_USED', 'QUOTE_LOCKED', 'UNKNOWN', 'COW_UNKNOWN']) {
            expect(m[1]).not.toContain(`'${k}'`)
        }
    })

    it('kesin kodlarin hepsi errors.js COW_ERROR kumesinde (listede olmayan kod eklenmedi)', () => {
        const e = oku('./utils/cow/errors.js')
        for (const k of KESIN) expect(e).toContain(`'${k}'`)
    })

    it("cowPlaceOrder: hata yalniz success === false && COW_COUNTED_REJECTS, 'submitting' sayilmaz", () => {
        const g = govde('cowPlaceOrder')
        expect(g).toContain("else if (res?.success === false && COW_COUNTED_REJECTS.has(res.code)) countAnalyticsFailure('swap')")
        expect(g.match(/countAnalyticsFailure\(/g).length).toBe(1)
    })

    it('COW_UNKNOWN (runCowQueued catch) hata saymaz', () => {
        const bas = src.indexOf('function runCowQueued(')
        expect(bas).toBeGreaterThan(-1)
        const g = src.slice(bas, src.indexOf('\n}\n', bas))
        expect(g).not.toContain('countAnalytics')
        expect(govde('cowApproveExecute')).not.toContain('countAnalytics')
    })
})

describe('kapi/onkosul retleri hata sayilmaz (spec 7c ortak kurali: zincir, kilitli kasa, hesap yok, ATS ucreti bekliyor)', () => {
    // Kume ve yardimci KAYNAKTAN alinip calistirilir: denenen kod background.js'teki kodun kendisidir.
    const kapiKaynagi = () => {
        const bas = src.indexOf('const GATE_UNCOUNTED_FAILURES = new Set([')
        expect(bas, 'GATE_UNCOUNTED_FAILURES bulunamadi').toBeGreaterThan(-1)
        const fn = src.indexOf('function isUncountedGateFailure(', bas)
        expect(fn).toBeGreaterThan(bas)
        return src.slice(bas, src.indexOf('\n}', fn) + 2)
    }
    // Tembel: kaynak bulunamazsa yalniz bu describe'in testleri kirilir, dosyanin geri kalani kosar.
    let kapi
    const sayilmaz = (e) => (kapi ??= new Function(`${kapiKaynagi()}\nreturn isUncountedGateFailure`)())(e)
    // Bir throw satirindaki dizge (cift ya da tek tirnak).
    const firlatilan = (g, onRe) => {
        const m = g.match(new RegExp(onRe.source + /throw new Error\((["'])(.+?)\1\)/.source))
        expect(m, `${onRe} throw satiri yok`).not.toBeNull()
        return m[2]
    }

    it('kume tam bes metni tasir', () => {
        const m = src.match(/const GATE_UNCOUNTED_FAILURES = new Set\(\[([^\]]*)\]\)/)
        expect(m).not.toBeNull()
        const metinler = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
        expect(metinler).toEqual(['Active account not found', 'CHAIN_NOT_EVM', 'PREVIOUS_TX_PENDING', 'Unsupported chain', 'Wallet locked. Please enter your password.'])
    })

    it('arka arkaya gonderim kapisi: sendTxInternal in gercekte firlattigi PREVIOUS_TX_PENDING sayilmaz', () => {
        const metin = firlatilan(govde('sendTxInternal'), /if \(isChainBlocked\(.*?\)\) /)
        expect(metin).toBe('PREVIOUS_TX_PENDING')
        expect(sayilmaz(new Error(metin))).toBe(true)
    })

    it('kilitli kasa: createWalletInstance (EVM) ve createTonKeyPair (TON) gercekte firlattigi cumle sayilmaz', () => {
        for (const ad of ['createWalletInstance', 'createTonKeyPair']) {
            const metin = firlatilan(govde(ad), /if \(!sessionMasterKeyJwk\) /)
            expect(sayilmaz(new Error(metin)), ad).toBe(true)
            // TON kumesi bu cumleyi TASIMAZ: ortak kapi olmasa TON/EVM catch'leri onu sayardi.
            expect(metin, ad).not.toBe('WALLET_LOCKED')
        }
    })

    it('aktif hesap yok: resolveAccount gercekte firlattigi metin sayilmaz', () => {
        expect(sayilmaz(new Error(firlatilan(govde('resolveAccount'), /if \(!active_account\) /)))).toBe(true)
    })

    it("'Unsupported chain' her gonderim/takas/kopru akisinda firlatilan metin ve sayilmaz", () => {
        for (const ad of ['sendTxInternal', 'swap', 'bridge', 'sendTonInternal', 'sendJettonInternal']) {
            expect(govde(ad), ad).toMatch(/throw new Error\((["'])Unsupported chain\1\)/)
        }
        expect(sayilmaz(new Error('Unsupported chain'))).toBe(true)
    })

    it('zincir kimligi kapisi (requireEvmChain) GERCEK hatasi sayilmaz', () => {
        for (const zincir of [{ chainId: -239, rpc: [] }, { chainId: 'solana-mainnet' }, null]) {
            let hata
            try { requireEvmChain(zincir) } catch (e) { hata = e }
            expect(hata, JSON.stringify(zincir)).toBeInstanceOf(Error)
            expect(sayilmaz(hata), JSON.stringify(zincir)).toBe(true)
        }
    })

    it('akis kapisi (assertChainFlow) GERCEK hatasi sayilmaz (degisken sonekli metin)', () => {
        const bas = src.indexOf('function assertChainFlow(')
        expect(bas).toBeGreaterThan(-1)
        const kaynak = src.slice(bas, src.indexOf('\n}', bas) + 2)
        const assertChainFlow = new Function('chainSupportsFlow', `${kaynak}\nreturn assertChainFlow`)(() => false)
        for (const [zincir, akis] of [[{ name: 'TON Testnet', chainId: -3 }, 'swap'], [{ chainId: 100 }, 'bridge']]) {
            let hata
            try { assertChainFlow(zincir, akis) } catch (e) { hata = e }
            expect(hata).toBeInstanceOf(Error)
            expect(sayilmaz(hata), hata.message).toBe(true)
        }
    })

    it("ATS 'xc-fee-pending' (atsPaymaster kodu) sayilmaz", () => {
        expect(oku('./utils/atsPaymaster.js')).toContain("err.code = 'xc-fee-pending'")
        expect(sayilmaz(Object.assign(new Error('onceki denemenin ucreti henuz dogrulanamadi'), { code: 'xc-fee-pending' }))).toBe(true)
    })

    it('gercek gonderim hatalari ve kopru teklif korumasi reddi SAYILIR (kapi genis degil)', () => {
        const sayilir = [
            new Error(BRIDGE_QUOTE_NOT_FOUND),
            new Error(BRIDGE_RECEIVER_MISMATCH),
            new Error('insufficient funds for intrinsic transaction cost'),
            Object.assign(new Error('x'), { code: 'INSUFFICIENT_FUNDS' }),
            Object.assign(new Error('x'), { code: 'xc-fee-auth-mismatch' }),
            new Error('TON_SEND_FAILED'),
            new Error('Unsupported chain.'),
            new Error('CHAIN_UNSUPPORTED_FOR_FLOW'),
            new Error('wallet locked'),
            undefined,
            null,
            {},
        ]
        for (const e of sayilir) expect(sayilmaz(e), String(e?.message ?? e)).toBe(false)
    })

    it('ortak kapi tam bes catch satirinda; hicbir basari satirinda yok', () => {
        const kullanim = [...src.matchAll(/!isUncountedGateFailure\(error\)\) (countOwnTransferFailure\(message\)|countAnalyticsFailure\('(transfer|swap|bridge)'\))/g)]
        expect(kullanim.map((m) => m[1]).sort()).toEqual([
            "countAnalyticsFailure('bridge')",
            "countAnalyticsFailure('swap')",
            "countAnalyticsFailure('transfer')",
            "countAnalyticsFailure('transfer')",
            'countOwnTransferFailure(message)',
        ])
        // Tanim + bes cagri; baska yerde yok.
        expect(src.match(/isUncountedGateFailure\(/g)).toHaveLength(6)
    })
})

// Belirsiz ya da GONDERIM SONRASI ATS sonucu hata SAYILMAZ (spec 7b: "hata txHash/userOpHash tasiyorsa sayilmaz";
// spec 7: zincire gitmis ama revert olan islem hata degil). executeAtsTransfer txHash'siz de firlatir: nonce
// ilerledi (opMayHaveRun + userOpHash), op sonucu dogrulanamadi (opSuccess null), op zincirde revert (opSuccess false).
// Eskiden uc EVM catch'i yalniz error.txHash'e bakiyordu; bu sekiller transferFailed/swapFailed/bridgeFailed yaziyordu.
describe('belirsiz / gonderim sonrasi ATS sonucu hata sayilmaz (uc EVM catch)', () => {
    const OP = '0x' + 'cd'.repeat(32)
    const TX = '0x' + 'ab'.repeat(32)
    const ATS_SEKILLERI = [
        ['nonce ilerledi: opMayHaveRun + userOpHash', Object.assign(new Error('islem sonucu dogrulanamadi: nonce ilerledigi icin op ZINCIRDE CALISMIS olabilir, ayni islem tekrar GONDERILMEDI'), { userOpHash: OP, opMayHaveRun: true })],
        ['relay hakki bitti, nonce okunamadi: opMayHaveRun (userOpHash yok)', Object.assign(new Error('relay failed'), { opMayHaveRun: true })],
        ['relay cagrisi hatasi: userOpHash, txHash yok', Object.assign(new Error('relay failed'), { userOpHash: OP })],
        ['op sonucu dogrulanamadi: opSuccess null', Object.assign(new Error('transfer islemi basarisiz veya sonucu dogrulanamadi'), { opSuccess: null })],
        ['op zincirde revert: opSuccess false', Object.assign(new Error('transfer islemi basarisiz veya sonucu dogrulanamadi'), { opSuccess: false })],
        ['makbuz dogrulanamadi: txHash + userOpHash', Object.assign(new Error(`islem sonucu dogrulanamadi (txHash: ${TX})`), { txHash: TX, userOpHash: OP })],
    ]
    // Sayilmaya DEVAM edenler: islem hic gonderilmedi (kurulum op'u basarisiz, yerel yayin reddi, teklif korumasi).
    const GERCEK_HATALAR = [
        new Error('kurulum islemi basarisiz; transfer gonderilmedi'),
        new Error('insufficient funds for intrinsic transaction cost'),
        Object.assign(new Error('x'), { code: 'INSUFFICIENT_FUNDS' }),
        Object.assign(new Error('x'), { code: 'xc-fee-auth-mismatch' }),
        new Error(BRIDGE_QUOTE_NOT_FOUND),
    ]

    // Catch satirindaki `if (...)` kosulu KAYNAKTAN alinir ve background.js'teki gercek kume/yardimcilarla calistirilir:
    // denenen kosul uretimdeki satirin kendisidir.
    const parca = (bas, son) => {
        const i = src.indexOf(bas)
        expect(i, `${bas} bulunamadi`).toBeGreaterThan(-1)
        return src.slice(i, src.indexOf(son, i) + son.length)
    }
    const yardimcilar = () => [
        parca('const GATE_UNCOUNTED_FAILURES = new Set([', '])'),
        parca('function isUncountedGateFailure(', '\n}'),
        parca('function isUncountedOutcomeFailure(', '\n}'),
        parca('const TON_UNCOUNTED_FAILURES = new Set([', '])'),
        parca('const SWAP_UNCOUNTED_FAILURES = new Set([', '])'),
    ].join('\n')
    const kosul = (ad, sayim) => {
        const g = govde(ad)
        const hata = g.slice(g.indexOf('} catch (error)'))
        const kacis = sayim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const m = hata.match(new RegExp(`if \\((.*)\\) ${kacis}`))
        expect(m, `${ad}: ${sayim} kosulu yok`).not.toBeNull()
        return new Function('error', `${yardimcilar()}\nreturn (${m[1]})`)
    }

    for (const [ad, sayim] of [
        ['sendTxInternal', 'countOwnTransferFailure(message)'],
        ['swap', "countAnalyticsFailure('swap')"],
        ['bridge', "countAnalyticsFailure('bridge')"],
    ]) {
        it(`${ad} catch: belirsiz ATS sonucu ve zincirde revert sayilmaz, gonderilmemis islem hatasi sayilir`, () => {
            const sayar = kosul(ad, sayim)
            for (const [aciklama, e] of ATS_SEKILLERI) expect(sayar(e), aciklama).toBe(false)
            for (const e of GERCEK_HATALAR) expect(sayar(e), e.message).toBe(true)
        })
    }

    it('sinanan sekiller atsPaymaster.js in GERCEK firlatmalari (alan adlari degisirse test kirilir)', () => {
        const a = oku('./utils/atsPaymaster.js')
        expect(a).toContain('if (advanced) e.opMayHaveRun = true')
        expect(a).toContain('err.opMayHaveRun = true')
        expect(a).toContain('if (e && e.userOpHash) err.userOpHash = e.userOpHash')
        expect(a).toContain("throw Object.assign(new Error('transfer islemi basarisiz veya sonucu dogrulanamadi'), { opSuccess: r2.success, userOpHash: r2.userOpHash })")
        expect(a).toContain('err.txHash = txHash')
        expect(a).toContain("throw new Error('kurulum islemi basarisiz; transfer gonderilmedi')")
    })

    it('swap ic catch i yalniz txHash i basari sayar, gerisini AYNI hata nesnesiyle dis catch e firlatir', () => {
        const g = govde('swap')
        const ic = g.slice(g.indexOf('} catch (e) {'), g.indexOf('} catch (error)'))
        expect(ic).toContain('if (e && e.txHash) {')
        expect(ic).toMatch(/return\n\s*\}\n\s*throw e\n/)
    })

    it('yardimci tam uc catch satirinda (EVM gonderim/takas/kopru); TON ve basari satirlarinda yok', () => {
        const kullanim = [...src.matchAll(/if \(!isUncountedOutcomeFailure\(error\) && [^\n]*\) (countOwnTransferFailure\(message\)|countAnalyticsFailure\('(?:transfer|swap|bridge)'\))/g)]
        expect(kullanim.map((m) => m[1]).sort()).toEqual([
            "countAnalyticsFailure('bridge')",
            "countAnalyticsFailure('swap')",
            'countOwnTransferFailure(message)',
        ])
        // Tanim + uc cagri; baska yerde yok.
        expect(src.match(/isUncountedOutcomeFailure\(/g)).toHaveLength(4)
        for (const ad of ['sendTonInternal', 'sendJettonInternal']) expect(govde(ad)).not.toContain('isUncountedOutcomeFailure')
    })
})
