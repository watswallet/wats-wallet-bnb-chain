import { describe, it, expect, vi } from 'vitest'
import { HDNodeWallet, Interface } from 'ethers'
import { probeEvmAddress } from './evmUsageProbe'
import { usageTokenAddressesFor } from './evmUsageTokens'
import {
    scanUsedAccounts,
    isPartialOutcome,
    SCAN_STOP_AFTER_UNUSED,
    SCAN_MAX_ACCOUNTS,
    SCAN_TOTAL_TIMEOUT_MS,
} from './accountScan'

// Bilinen test ifadesi (Hardhat): gercek bir cuzdan degil, yalnizca turetme dogrulugu icin.
const JUNK = 'test test test test test test test test test test test junk'
const BASE = HDNodeWallet.fromPhrase(JUNK, '', "m/44'/60'/0'/0")
const addrOf = (i) => BASE.deriveChild(i).address
// Yoklama adresinden indeksi bulmak icin ters tablo (en fazla 20 indeks yoklanir; 22 pay).
const BY_ADDR = new Map(Array.from({ length: 22 }, (_, i) => [addrOf(i), i]))

// Sahte yoklama: `used` / `failed` indeks listeleri; `onCall(i, signal)` her yoklamada calisir.
// Yoklanan indeksler `probe.calls`a sirayla yazilir.
function makeProbe({ used = [], failed = [], onCall } = {}) {
    const calls = []
    const probe = vi.fn(async (addr, { signal } = {}) => {
        const i = BY_ADDR.get(addr)
        calls.push(i)
        await onCall?.(i, signal)
        if (failed.includes(i)) return 'failed'
        if (used.includes(i)) return 'used'
        return 'unused'
    })
    probe.calls = calls
    return probe
}

const scan = (probe, extra = {}) => scanUsedAccounts({ mnemonic: JUNK, probe, ...extra })

describe('accountScan', () => {
    it('sabitler plan degerleri', () => {
        expect(SCAN_STOP_AFTER_UNUSED).toBe(3)
        expect(SCAN_MAX_ACCOUNTS).toBe(20)
        expect(SCAN_TOTAL_TIMEOUT_MS).toBe(60_000)
    })

    it('hic kullanilmis yoksa 1,2,3 yoklanir ve yalniz Hesap 1 kalir', async () => {
        const p = makeProbe()
        expect(await scan(p)).toEqual({ accountCount: 1, usedIndexes: [], outcome: 'completed' })
        expect(p.calls).toEqual([1, 2, 3])
    })

    it('spec ornegi: 1 bos, 2 kullanilmis, 3-5 bos -> 0,1,2 eklenir', async () => {
        const p = makeProbe({ used: [2] })
        const r = await scan(p)
        expect(p.calls).toEqual([1, 2, 3, 4, 5])
        expect(r).toMatchObject({ accountCount: 3, usedIndexes: [2] })
    })

    it('kullanilmis indeks sayaci sifirlar: 3 ve 5 kullanilmis -> 6,7,8 sonra durur', async () => {
        // Yalniz [5] olsa 1,2,3 art arda bos olup tarama 3'te biterdi; bu yuzden 3 de kullanilmis.
        const p = makeProbe({ used: [3, 5] })
        const r = await scan(p)
        expect(p.calls).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
        expect(r.accountCount).toBe(6)
    })

    it('ust sinir: hepsi kullanilmis olsa da yalniz 1..19 yoklanir, 20 hesap', async () => {
        const p = makeProbe({ used: Array.from({ length: 40 }, (_, i) => i) })
        const r = await scan(p)
        expect(p.calls).toEqual(Array.from({ length: 19 }, (_, i) => i + 1))
        expect(r).toMatchObject({ accountCount: 20, outcome: 'completed' })
    })

    it('indeks 19 kullanilmissa dahil edilir', async () => {
        const r = await scan(makeProbe({ used: [3, 6, 9, 12, 15, 18, 19] }))
        expect(r.accountCount).toBe(20)
    })

    it('hata aninda tarama biter, bulunanlar korunur, hatali indeks sayaca girmez', async () => {
        const p = makeProbe({ used: [2], failed: [3] })
        const r = await scan(p)
        expect(p.calls).toEqual([1, 2, 3])
        expect(r).toEqual({ accountCount: 3, usedIndexes: [2], outcome: 'network_failed' })
    })

    it('ilk yoklama hata verirse yalniz Hesap 1', async () => {
        expect(await scan(makeProbe({ failed: [1] }))).toEqual({
            accountCount: 1,
            usedIndexes: [],
            outcome: 'network_failed',
        })
    })

    it("Atla: yoklama sirasinda iptal -> 'skipped', 1 hesap, sonraki yoklama YOK", async () => {
        const ctrl = new AbortController()
        const p = makeProbe({
            used: [2],
            onCall: (i) => {
                if (i === 2) ctrl.abort()
            },
        })
        expect(await scan(p, { signal: ctrl.signal })).toEqual({
            accountCount: 1,
            usedIndexes: [],
            outcome: 'skipped',
        })
        expect(p.calls).toEqual([1, 2])
    })

    it("Atla: yoklama iptalde 'failed' dondurse bile sonuc 'skipped' (ag hatasi DEGIL)", async () => {
        // Gercek probeEvmAddress iptalde 'failed' doner; iptal kontrolu hata kontrolunden once olmali.
        const ctrl = new AbortController()
        const p = makeProbe({
            failed: [2],
            onCall: (i) => {
                if (i === 2) ctrl.abort()
            },
        })
        expect(await scan(p, { signal: ctrl.signal })).toEqual({
            accountCount: 1,
            usedIndexes: [],
            outcome: 'skipped',
        })
        expect(p.calls).toEqual([1, 2])
    })

    it('Atla: gec sonuc yok sayilir, checked/included yayilmaz', async () => {
        const ctrl = new AbortController()
        const events = []
        const p = makeProbe({
            used: [1],
            onCall: (i) => {
                if (i === 1) ctrl.abort()
            },
        })
        await scan(p, { signal: ctrl.signal, onProgress: (e) => events.push(e) })
        // Yalniz baslangic included(0) ve yoklanan 1'in 'checking'i; 1'in sonucu yayilmaz.
        expect(events.map((e) => [e.type, e.index])).toEqual([
            ['included', 0],
            ['checking', 1],
        ])
    })

    it('en basta iptal edilmis signal hic yoklama yapmaz', async () => {
        const ctrl = new AbortController()
        ctrl.abort()
        const p = makeProbe()
        expect((await scan(p, { signal: ctrl.signal })).outcome).toBe('skipped')
        expect(p.calls).toEqual([])
    })

    it("toplam sure asilirsa 'timed_out' ve bulunanlar korunur", async () => {
        const clock = { t: 0 }
        const p = makeProbe({
            used: [1],
            onCall: (i) => {
                if (i === 1) clock.t = SCAN_TOTAL_TIMEOUT_MS + 1
            },
        })
        expect(await scan(p, { now: () => clock.t })).toEqual({
            accountCount: 2,
            usedIndexes: [1],
            outcome: 'timed_out',
        })
        expect(p.calls).toEqual([1])
    })

    it('olaylar: included(0) -> checking -> checked -> included; bosluklar used=false ile dahil edilir', async () => {
        const events = []
        await scan(makeProbe({ used: [3] }), { onProgress: (e) => events.push(e) })
        expect(events[0]).toMatchObject({ type: 'included', index: 0, address: addrOf(0), used: true })
        expect(events.slice(1, 4).map((e) => [e.type, e.index])).toEqual([
            ['checking', 1],
            ['checked', 1],
            ['checking', 2],
        ])
        expect(events.filter((e) => e.type === 'included').map((e) => [e.index, e.used])).toEqual([
            [0, true],
            [1, false],
            [2, false],
            [3, true],
        ])
    })

    it('olay alanlari: checking adresi, checked durumu, included adresi dogru', async () => {
        const events = []
        await scan(makeProbe({ used: [2] }), { onProgress: (e) => events.push(e) })
        expect(events.find((e) => e.type === 'checking' && e.index === 2)).toEqual({
            type: 'checking',
            index: 2,
            address: addrOf(2),
        })
        expect(events.filter((e) => e.type === 'checked').map((e) => [e.index, e.status])).toEqual([
            [1, 'unused'],
            [2, 'used'],
            [3, 'unused'],
            [4, 'unused'],
            [5, 'unused'],
        ])
        expect(events.find((e) => e.type === 'included' && e.index === 1)).toEqual({
            type: 'included',
            index: 1,
            address: addrOf(1),
            used: false,
        })
    })

    it("hata: 'checked' status=failed yayilir, ardindan baska olay gelmez", async () => {
        const events = []
        await scan(makeProbe({ failed: [1] }), { onProgress: (e) => events.push(e) })
        expect(events.map((e) => [e.type, e.index, e.status ?? e.used])).toEqual([
            ['included', 0, true],
            ['checking', 1, undefined],
            ['checked', 1, 'failed'],
        ])
    })

    it('yoklanan adresler HDNodeWallet.fromPhrase ile ayni yoldan gelir', async () => {
        const p = makeProbe()
        await scan(p)
        expect(p.mock.calls.map(([a]) => a)).toEqual(
            [1, 2, 3].map((i) => HDNodeWallet.fromPhrase(JUNK, '', `m/44'/60'/0'/0/${i}`).address)
        )
    })

    it('yoklamaya iptal sinyali iletilir', async () => {
        const ctrl = new AbortController()
        const p = makeProbe()
        await scan(p, { signal: ctrl.signal })
        expect(p.mock.calls.every(([, opts]) => opts.signal === ctrl.signal)).toBe(true)
    })

    it('ifadenin basindaki/sonundaki bosluk tarama adresini degistirmez', async () => {
        const p = makeProbe()
        await scan(p, { mnemonic: `  ${JUNK}  ` })
        expect(p.calls).toEqual([1, 2, 3])
    })

    it('isPartialOutcome yalniz network_failed ve timed_out icin true', () => {
        expect(['completed', 'skipped', 'network_failed', 'timed_out'].map(isPartialOutcome)).toEqual([
            false,
            false,
            true,
            true,
        ])
    })
})

// --- Uctan uca: gercek yoklama (probeEvmAddress) + sahte RPC ile token sinyali -----------------
// Kullanici karari 2026-11-03: yalniz token almis (nonce 0, yerli bakiye 0) hesap taramada
// KULLANILMIS sayilir. Burada probe enjekte EDILMEZ, gercek evmUsageProbe sahte fetch ile calisir.

const MC = new Interface([
    'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)',
    'function balanceOf(address) view returns (uint256)',
])
const w32 = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0')

// `tokenHolders`: adres -> o adresin USDT (listedeki ilk token) bakiyesi. Nonce/bakiye hep 0.
function rpcFor(tokenHolders) {
    return vi.fn(async (url, init) => {
        const { method, params } = JSON.parse(init.body)
        let result = '0x0'
        if (method === 'eth_call') {
            const calls = MC.decodeFunctionData('aggregate3', params[0].data)[0]
            const [owner] = MC.decodeFunctionData('balanceOf', calls[0][2])
            const held = tokenHolders.get(owner) ?? 0n
            result = MC.encodeFunctionResult('aggregate3', [
                calls.map((_, i) => [true, w32(i === 0 ? held : 0n)]),
            ])
        }
        return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) }
    })
}

const realProbe = (fetchImpl) => (addr, { signal } = {}) =>
    probeEvmAddress(addr, {
        signal,
        fetchImpl,
        chains: [{ chainId: 1, urls: ['https://eth.example'], tokens: usageTokenAddressesFor(1) }],
    })

describe('accountScan + gercek yoklama: token sinyali', () => {
    it('yalniz-token hesap (nonce 0, bakiye 0, USDT > 0) taramada bulunur: Hesap 3 de eklenir', async () => {
        const fetchImpl = rpcFor(new Map([[addrOf(2), 5_000_000n]]))
        const r = await scanUsedAccounts({ mnemonic: JUNK, probe: realProbe(fetchImpl) })
        expect(r).toMatchObject({ accountCount: 3, usedIndexes: [2], outcome: 'completed' })
    })

    it('token bakiyesi yoksa ayni senaryoda yalniz Hesap 1 kalir (token sinyali olmadan kaybolurdu)', async () => {
        const fetchImpl = rpcFor(new Map())
        const r = await scanUsedAccounts({ mnemonic: JUNK, probe: realProbe(fetchImpl) })
        expect(r).toMatchObject({ accountCount: 1, usedIndexes: [], outcome: 'completed' })
    })

    it('token cagrisi tamamen hata verse bile tarama ag hatasi SAYMAZ (nonce/bakiye yanit veriyor)', async () => {
        const fetchImpl = vi.fn(async (url, init) => {
            const { method } = JSON.parse(init.body)
            if (method === 'eth_call') throw new Error('rpc down')
            return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x0' }) }
        })
        const r = await scanUsedAccounts({ mnemonic: JUNK, probe: realProbe(fetchImpl) })
        expect(r).toMatchObject({ accountCount: 1, outcome: 'completed' })
    })
})
