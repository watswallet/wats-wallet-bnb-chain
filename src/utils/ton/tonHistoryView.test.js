import { describe, it, expect } from 'vitest'
import { toHistoryRows } from './tonHistoryView'

const ME = 'UQAgPlDEUtqTMAJ1fpGT0AFebk85pdtOYKq72I5Eq9VIIy1P'

const GIDEN = { hash: 'h1', time: 1700000000, direction: 'send', counterparty: 'UQ_alici', amount: 2.5, comment: 'faturam', fee: 0.003 }
const GELEN = { hash: 'h2', time: 1700000100, direction: 'receive', counterparty: 'UQ_gonderen', amount: 5, comment: '', fee: 0.001 }
const JETTON_GELEN = { hash: 'h3', time: 1700000200, direction: 'receive', counterparty: 'UQ_gonderen', amount: 12.34, symbol: 'USDT', comment: '', fee: 0.002 }

describe('toHistoryRows', () => {
    it('giden satirda from ben, to karsi taraf', () => {
        const [row] = toHistoryRows([GIDEN], ME)
        expect(row.from_address).toBe(ME)
        expect(row.to_address).toBe('UQ_alici')
    })

    it('gelen satirda from karsi taraf, to ben', () => {
        const [row] = toHistoryRows([GELEN], ME)
        expect(row.from_address).toBe('UQ_gonderen')
        expect(row.to_address).toBe(ME)
    })

    it('block_timestamp ISO metindir (siralama new Date ile yapiliyor)', () => {
        const [row] = toHistoryRows([GIDEN], ME)
        expect(row.block_timestamp).toBe(new Date(1700000000000).toISOString())
        expect(Number.isNaN(new Date(row.block_timestamp).getTime())).toBe(false)
    })

    it('miktar erc20_transfers kalibiyla tasinir', () => {
        // getListAmount'un native dali 1e18'e bolup "ETH" yaziyor; TON 9 ondalik ve
        // sembolu TON. Bu kalip mevcut bicimlendiriciyi DOGRU calistirir.
        const [row] = toHistoryRows([GIDEN], ME)
        expect(row.erc20_transfers).toHaveLength(1)
        expect(row.erc20_transfers[0].value_formatted).toBe('2.5')
        expect(row.erc20_transfers[0].token_symbol).toBe('TON')
        expect(row.erc20_transfers[0].direction).toBe('send')
    })

    it('receipt_status onaylanmis olarak isaretlenir', () => {
        // /ton/history yalnizca zincire islenmis islemleri doner.
        expect(toHistoryRows([GELEN], ME)[0].receipt_status).toBe('1')
    })

    it('category yonu tasir (gelen satir yesil gorunur)', () => {
        expect(toHistoryRows([GELEN], ME)[0].category).toBe('receive')
        expect(toHistoryRows([GIDEN], ME)[0].category).toBe('send')
    })

    it('yorum summary olarak gosterilir, yoksa alan bos kalir', () => {
        expect(toHistoryRows([GIDEN], ME)[0].summary).toBe('faturam')
        expect(toHistoryRows([GELEN], ME)[0].summary).toBe('')
    })

    it('bozuk kayitlar atlanir', () => {
        expect(toHistoryRows([null, {}, GELEN], ME)).toHaveLength(1)
        expect(toHistoryRows(null, ME)).toEqual([])
    })

    it('ucret transaction_fee alanina tasinir (detay modalindaki "hesaplaniyor..." kilidi acilsin diye)', () => {
        // History.vue detay modali `parseFloat(selectedTx.transaction_fee).toFixed(6)`
        // okuyor; tasinmazsa alan undefined kalir ve kutu KALICI olarak "hesaplaniyor..."
        // gosterirdi (islem zaten onaylanmis olsa bile). /ton/history yalnizca zincire
        // islenmis kayitlari donerdigi icin ucret her zaman biliniyor.
        const [row] = toHistoryRows([GIDEN], ME)
        expect(row.transaction_fee).toBe('0.003')
        expect(parseFloat(row.transaction_fee).toFixed(6)).toBe('0.003000')
    })

    it('native satirda jettonSymbol yok, sembol TON kalir', () => {
        const [row] = toHistoryRows([GELEN], ME)
        expect(row.jettonSymbol).toBe(null)
        expect(row.erc20_transfers[0].token_symbol).toBe('TON')
    })

    it('jetton satirinda sunucudan gelen symbol tasinir, ondalik TEKRAR uygulanmaz', () => {
        // Sunucu miktari zaten dogru ondaligiyla cevirmis gonderiyor (bkz.
        // server/utils/tonJettonHistory.js: rawUnitsToDecimalNumber) - burada 10**decimals
        // gibi bir ikinci bolme YAPILMAZ, aksi halde miktar yanlis kucultulurdu.
        const [row] = toHistoryRows([JETTON_GELEN], ME)
        expect(row.jettonSymbol).toBe('USDT')
        expect(row.erc20_transfers[0].token_symbol).toBe('USDT')
        expect(row.erc20_transfers[0].value_formatted).toBe('12.34')
    })
})
