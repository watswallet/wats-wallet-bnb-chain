// Tamamlanan islemin KENDILIGINDEN kapanmasi.
//
// KOK NEDEN: bitmis bir transfer hicbir zaman kendiliginden kaybolmuyordu;
// kullanici "Kapat" demezse ekranda suresiz duruyordu. Ama bu kolayligin BEDELI
// olmamali: kendiliginden kaybolan bir HATA, hic gosterilmemis hatadir. Bu dosya
// "neyin kapanacagini" kilitliyor.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { autoDismissIds, SUCCESS_TTL_MS } from './txAutoDismiss'

const TX_STATUS = readFileSync(fileURLToPath(new URL('../components/TransactionStatus.vue', import.meta.url)), 'utf8')

// Bilesendeki `tonFeeTone` ile AYNI kural. Testin kendi kopyasi olmasi bilincli:
// asagidaki kaynak-sekil testi, bilesenin GERCEKTEN bu cozumleyiciyi (ham
// `tx.status`i degil) kullandigini AYRICA dogruluyor.
const tone = (tx) => {
    const state = tx?.meta?.tonFeeState
    if (state === 'not-charged' || state === 'unresolved') return 'error'
    if (state === 'recovering') return 'processing'
    return tx?.status
}

const tx = (id, status, tonFeeState) => ({ id, status, meta: tonFeeState ? { tonFeeState } : {} })

describe('kendiliginden kapanma -- NE kapanir', () => {
    it('YALNIZCA basarili kayit kapanir', () => {
        const liste = [
            tx('a', 'success'),
            tx('b', 'error'),
            tx('c', 'processing'),
            tx('d', 'queued'),
        ]
        expect(autoDismissIds(liste, tone)).toEqual(['a'])
    })

    it('basarisiz kayit ASLA kapanmaz -- sebep tasiyor', () => {
        expect(autoDismissIds([tx('x', 'error')], tone)).toEqual([])
    })

    // TON ucret kurtarmasinin UC durumu da ayri ayri: ucret ALINMIS ama sonuc
    // BILINMIYORken kaydi sessizce silmek, kullaniciyi islemin hic olmadigini
    // sanip TEKRAR gondermeye iter -- yani IKINCI bir ucret.
    it("'recovering': tx.status 'success' OLSA BILE kapanmaz", () => {
        expect(autoDismissIds([tx('t', 'success', 'recovering')], tone)).toEqual([])
    })

    it("'unresolved': tx.status 'success' OLSA BILE kapanmaz", () => {
        expect(autoDismissIds([tx('t', 'success', 'unresolved')], tone)).toEqual([])
    })

    it("'not-charged': tx.status 'success' OLSA BILE kapanmaz", () => {
        expect(autoDismissIds([tx('t', 'success', 'not-charged')], tone)).toEqual([])
    })

    it('bozuk girdi COKERTMEZ', () => {
        expect(autoDismissIds(null, tone)).toEqual([])
        expect(autoDismissIds([tx('a', 'success')], null)).toEqual([])
        expect(autoDismissIds([null, undefined, tx('a', 'success')], tone)).toEqual(['a'])
    })

    // Sure kullanicinin okumasina yetmeli. Cok kisa bir deger (or. 1 sn) onayi
    // pratikte gorunmez yapardi; cok uzun olani ise bu isin amacini bosa cikarir.
    it('sure makul bir aralikta', () => {
        expect(SUCCESS_TTL_MS).toBeGreaterThanOrEqual(3000)
        expect(SUCCESS_TTL_MS).toBeLessThanOrEqual(15000)
    })
})

describe('kendiliginden kapanma -- bilesen baglantisi', () => {
    it('bilesen karari tonFeeTone ile veriyor, ham tx.status ile DEGIL', () => {
        expect(TX_STATUS).toContain('autoDismissIds(list, tonFeeTone)')
    })

    it('sayac temizleniyor: bilesen soktugunde askida zamanlayici KALMAZ', () => {
        expect(TX_STATUS).toContain('onUnmounted')
        expect(TX_STATUS).toContain('clearTimeout')
    })

    // Kapanma `clearTransaction` ile olmak ZORUNDA: depo o yolda listeyi DISKTEN
    // taze okuyup yaziyor. Bellekteki anlik goruntuyu geri yazan bir kisa yol,
    // background'in bu arada yazdigi durum/txHash guncellemesini ezerdi.
    it('kapanma depo uzerinden yapiliyor', () => {
        expect(TX_STATUS).toContain('txStore.clearTransaction(id)')
    })
})
