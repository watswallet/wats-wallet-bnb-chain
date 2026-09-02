import { describe, it, expect } from 'vitest'
import { hasPendingTonTx, TON_PENDING_MAX_AGE_MS } from './tonPending'
import { TON_MAINNET_ID } from '../chainKind'

// ONEMLI: bu fixture'lar background.js:updateTxStatus'un GERCEKTEN yazdigi sekli
// birebir taklit etmek ZORUNDA. updateTxStatus kayitlari
//   { id, status, meta: { chainId, amount, type, ... }, timestamp }
// seklinde yaziyor — chainId UST SEVIYEDE DEGIL, meta icinde. Duz bir sekil
// (`{ chainId, status }`) kullanan bir test, `hasPendingTonTx`'in meta.chainId yerine
// yanlislikla ust seviye chainId okumasi durumunda bile YESIL gecer — yani olmayan
// bir korumayi "dogrulamis" gibi gorunur. Bu dosya bu hatayi tam olarak yasadi:
// ilk surumde fixture'lar duz sekildeydi, kapi PRODUKSIYONDA hicbir zaman calismiyordu
// ama testler geciyordu. Yeni bir fixture eklerken meta.chainId + ust seviye
// timestamp kuralina uy.
const NOW = 1_000_000_000_000 // sabit referans zaman: testler gercek saate bagimli olmasin

function tonTx(status, { timestamp = NOW, chainId = TON_MAINNET_ID, ...meta } = {}) {
    const record = { id: 'tx-1', status, meta: { chainId, ...meta } }
    if (timestamp !== undefined) record.timestamp = timestamp
    return record
}

function evmTx(status, { timestamp = NOW, chainId = 1, ...meta } = {}) {
    return { id: 'tx-1', status, meta: { chainId, ...meta }, timestamp }
}

describe('hasPendingTonTx', () => {
    it('bekleyen TON islemi varsa true', () => {
        expect(hasPendingTonTx([
            evmTx('processing'),
            tonTx('processing'),
        ], NOW)).toBe(true)
    })

    it('kuyrukta bekleyen TON islemi de sayilir', () => {
        expect(hasPendingTonTx([tonTx('queued')], NOW)).toBe(true)
    })

    it('bitmis TON islemi engellemez', () => {
        expect(hasPendingTonTx([
            tonTx('success'),
            tonTx('error'),
        ], NOW)).toBe(false)
    })

    it('EVM islemleri TON u engellemez', () => {
        // Zincirler bagimsiz: Ethereum'da bekleyen islem TON gonderimini kilitlemez.
        expect(hasPendingTonTx([evmTx('processing')], NOW)).toBe(false)
    })

    it('bos/gecersiz girdi false', () => {
        expect(hasPendingTonTx([], NOW)).toBe(false)
        expect(hasPendingTonTx(null, NOW)).toBe(false)
        expect(hasPendingTonTx([null, {}], NOW)).toBe(false)
    })

    // --- Yas siniri: kapinin bir cikisi olmali ---
    // waitForSeqno sonucu gelmeden SW olurse (uyku/crash/yeniden baslama) TON kaydi
    // sonsuza dek 'processing' kalabilir (txHash yok, checkAndRecoverPendingTxs onu
    // goremiyor). Yas siniri olmadan kullanici KALICI OLARAK TON gonderemez hale gelir.

    it('yas siniri ALTINDAKI TON kaydi engeller', () => {
        const age = TON_PENDING_MAX_AGE_MS - 1
        expect(hasPendingTonTx([tonTx('processing', { timestamp: NOW - age })], NOW)).toBe(true)
    })

    it('yas siniri USTUNDEKI TON kaydi ARTIK ENGELLEMEZ — kapinin cikisi', () => {
        const age = TON_PENDING_MAX_AGE_MS + 1
        expect(hasPendingTonTx([tonTx('processing', { timestamp: NOW - age })], NOW)).toBe(false)
    })

    it('sinir TAM UZERINDEKI deger engellemez (ust sinir haric)', () => {
        expect(hasPendingTonTx([
            tonTx('processing', { timestamp: NOW - TON_PENDING_MAX_AGE_MS }),
        ], NOW)).toBe(false)
    })

    it('timestamp alani olmayan kayit ENGELLEMEZ — guvenli yon kilitlenme degil', () => {
        // tonTx() helper'ini kullanmiyoruz: destructuring varsayilani `timestamp: undefined`
        // gecilse bile NOW'a duser (JS varsayilan-deger semantigi, deger `undefined` oldugunda
        // tetiklenir). Alanin GERCEKTEN yok oldugu bir kaydi elle kuruyoruz.
        const record = { id: 'tx-1', status: 'processing', meta: { chainId: TON_MAINNET_ID } }
        expect('timestamp' in record).toBe(false)
        expect(hasPendingTonTx([record], NOW)).toBe(false)
    })

    it('now parametresi verilmezse gercek saat kullanilir (varsayilan calisir)', () => {
        // Az once olusturulmus bir kayit varsayilan `now = Date.now()` ile hala bekleniyor sayilmali.
        expect(hasPendingTonTx([tonTx('processing', { timestamp: Date.now() })])).toBe(true)
    })

    // --- Gercek kayit sekli regresyonu ---
    // Bu test olmadan bir gelistirici hasPendingTonTx'i tekrar ust seviye t.chainId
    // okuyacak sekilde bozarsa (meta.chainId yerine) testler yine de gecerdi, cunku
    // digerlerinin hepsi meta.chainId DOLU fixture'lar kullaniyor ve `?? t.chainId`
    // yedegi devreye girmiyor. Bu test, ust seviyede chainId OLMAYAN — yalnizca
    // meta.chainId olan — gercekci bir kaydin hala engellendigini acikca kontrol eder.
    it('chainId SADECE meta icinde olan gercekci kayit hala engeller (ust seviyede chainId YOK)', () => {
        const record = { id: 'tx-1', status: 'processing', meta: { chainId: TON_MAINNET_ID, amount: '1', type: 'Transaction' }, timestamp: NOW }
        expect('chainId' in record).toBe(false) // ust seviyede chainId YOK — sadece meta'da
        expect(hasPendingTonTx([record], NOW)).toBe(true)
    })
})
