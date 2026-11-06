// TON yetersiz bakiye kapisi (1.9.2, main 2a8acd4) gizli modda ERISILEMEZ (Dilim 0c G7, spec 4.7 satir 34).
//
// tonDappFunctions.handleTonSendTransaction `readTonBalanceNano` ile `getTonClient(...).getBalance` (`/ton/rpc`) cagirir.
// Tek yol: `tonconnect_send` mesaji -> background.js -> handleTonSend -> handleTonSendTransaction. `tonconnect_send`
// gizli modda BLOCKED_IN_PRIVATE'tadir (yalniz `disconnect` yontemi gecer ve o dal bakiye kapisina ulasmaz), yani
// `/ton/rpc` yine "ulasilamayan uc noktalar" notunda kalir (privateRequestCoverage.test.js).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz, blokGovdesi } from '../test-utils/kaynakTarama'
import { privacyDecision, BLOCKED_IN_PRIVATE } from './privacy/privacyGate'

const kaynak = (yol) => yorumsuz(readFileSync(fileURLToPath(new URL(yol, import.meta.url)), 'utf8'))
const TON = kaynak('./tonDappFunctions.js')
const BG = kaynak('../background.js')
const sayim = (metin, parca) => metin.split(parca).length - 1

const GIZLI = { key: 'g-1', address: '0x' + 'cd'.repeat(20), private: true }
const GENEL = { key: 'a-1', address: '0x' + 'ab'.repeat(20) }
const ctx = (activeAccount, over = {}) => ({ activeAccount, signer: activeAccount, privateAddress: GIZLI.address, recipient: null, chainKind: 'evm', ...over })

describe('TON yetersiz bakiye kapisi: gizli modda erisilemez', () => {
    it('tonconnect_send BLOCKED_IN_PRIVATE; gizli modda sendTransaction ve imza istekleri engellenir, disconnect gecer', () => {
        expect(BLOCKED_IN_PRIVATE.has('tonconnect_send')).toBe(true)
        expect(BLOCKED_IN_PRIVATE.has('TON_DAPP_SEND')).toBe(true)
        expect(privacyDecision('tonconnect_send', ctx(GIZLI, { tonMethod: 'sendTransaction' }))).toEqual({ block: 'PRIVATE_DAPP_BLOCKED' })
        expect(privacyDecision('tonconnect_send', ctx(GIZLI, { tonMethod: 'signData' }))).toEqual({ block: 'PRIVATE_DAPP_BLOCKED' })
        // Yontem bilinmiyorsa da engellenir (fail-closed): yalniz acik `disconnect` gecer.
        expect(privacyDecision('tonconnect_send', ctx(GIZLI))).toEqual({ block: 'PRIVATE_DAPP_BLOCKED' })
        expect(privacyDecision('tonconnect_send', ctx(GIZLI, { tonMethod: 'disconnect' }))).toBe(null)
    })

    it('KONTROL: genel hesapta tonconnect_send sendTransaction kapidan gecer (main davranisi)', () => {
        expect(privacyDecision('tonconnect_send', ctx(GENEL, { tonMethod: 'sendTransaction' }))).toBe(null)
    })

    it('readTonBalanceNano YALNIZ handleTonSendTransaction icinde cagrilir', () => {
        expect(sayim(TON, 'readTonBalanceNano(')).toBe(2) // tanim + tek cagri
        const bas = TON.indexOf('async function handleTonSendTransaction(')
        const son = TON.indexOf('async function handleTonSignData(')
        expect(bas).toBeGreaterThan(-1)
        expect(son).toBeGreaterThan(bas)
        const govde = TON.slice(bas, son)
        expect(sayim(govde, 'readTonBalanceNano(')).toBe(1)
    })

    it('handleTonSendTransaction YALNIZ handleTonSend\'in sendTransaction dalindan cagrilir', () => {
        expect(sayim(TON, 'handleTonSendTransaction(')).toBe(2) // tanim + tek cagri
        const govde = blokGovdesi(TON, 'export async function handleTonSend(')
        expect(govde, 'handleTonSend govdesi bulunamadi').toBeTruthy()
        expect(govde).toMatch(/appRequest\.method === 'sendTransaction'\)\s*\{\s*await handleTonSendTransaction\(/)
    })

    it('handleTonSend YALNIZ background.js\'in tonconnect_send kolundan erisilir', () => {
        const kol = BG.match(/case\s+['"]tonconnect_send['"]\s*:\s*handleTonSend\(/)
        expect(kol, 'tonconnect_send kolu handleTonSend cagirmiyor').not.toBeNull()
        expect(sayim(BG, 'handleTonSend(')).toBe(1)
    })
})
