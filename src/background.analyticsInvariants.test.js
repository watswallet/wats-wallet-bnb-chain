// Sayim noktalari DEGISMEZLERI (kaynak taramasi). background.analyticsSites.test.js tek tek
// noktalarin yerini kilitler; burada genel kurallar kilitlenir: ag argumani eksik kalmaz,
// basari sayimi hata dalina girmez, hata sayimi tek kapidan gecer, nokta sayisi sabittir.
// NEDEN: yeni bir sayim noktasi onaysiz eklenirse (ya da ag argumani unutulursa) yalniz
// bu tur bir tarama yakalar; test gevsetilmez, nokta duzeltilir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const oku = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const yorumsuz = (s) => s.replace(/^\s*\/\/.*$/gm, '')
const src = yorumsuz(oku('./background.js'))

// Bir fonksiyon bildiriminin govdesi (sonraki ust duzey bildirime kadar).
function govde(ad, onek = 'function') {
    const bas = src.indexOf(`${onek} ${ad}(`)
    expect(bas, `${ad} bulunamadi`).toBeGreaterThan(-1)
    const sonra = src.slice(bas + 10).search(/\n(?:async function|function) \w+\(/)
    return src.slice(bas, sonra === -1 ? src.length : bas + 10 + sonra)
}

// Tanim satirlari/govdeleri haric tutulur: yalniz cagri noktalari taranir.
const tanimDisi = (s) => s
    .replace(govde('countAnalytics'), '')
    .replace(govde('countAnalyticsFailure'), '')
    .replace(govde('countOwnTransfer'), '')
    .replace(govde('countOwnTransferFailure'), '')

// `catch (` sonrasi suslu parantez dengesiyle blok govdeleri.
function catchGovdeleri(s) {
    const out = []
    const re = /catch\s*\([^)]*\)\s*\{/g
    let m
    while ((m = re.exec(s))) {
        let derin = 1
        let i = re.lastIndex
        while (i < s.length && derin > 0) {
            if (s[i] === '{') derin++
            else if (s[i] === '}') derin--
            i++
        }
        out.push(s.slice(re.lastIndex, i - 1))
    }
    return out
}

describe('sayim degismezleri', () => {
    it("AG DEGISMEZI: background.js icindeki her countAnalytics('transfer'|'swap'|'bridge', ...) cagrisi ikinci arguman tasir", () => {
        const cagrilar = [...tanimDisi(src).matchAll(/countAnalytics\('(transfer|swap|bridge)'(?:,\s*([^)]+))?\)/g)]
        expect(cagrilar.length).toBeGreaterThan(0)
        for (const m of cagrilar) {
            expect((m[2] || '').trim(), `ag argumansiz sayim: ${m[0]}`).not.toBe('')
        }
        // countOwnTransfer govdesi haric tutuldu; ag'i message.message.chainId ile sayar.
        expect(govde('countOwnTransfer')).toContain("countAnalytics('transfer', message.message.chainId)")
    })

    it('walletCreate/walletImport/open/unlock countAnalytics ikinci arguman ISTEMEZ', () => {
        const cagrilar = [...src.matchAll(/countAnalytics\('(walletCreate|walletImport|open|unlock)'([^)]*)\)/g)]
        expect(cagrilar.length).toBeGreaterThan(0)
        for (const m of cagrilar) expect(m[2], m[0]).toBe('')
        // Degisken kind'li cagri (mesaj dali) da arguman tasimaz.
        expect(src).toMatch(/kind === 'open'\) countAnalytics\(kind\)/)
    })

    it("hicbir catch dalinda basari countAnalytics('transfer|swap|bridge' ...) yok", () => {
        const bloklar = catchGovdeleri(src)
        expect(bloklar.length).toBeGreaterThan(50)
        // TEK ISTISNA: makbuz dogrulanamayan ama zincire GITMIS swap (e.txHash var, yanit
        // success:true + unverified). Bu hata degil, gonderilmis islemdir ve dogrudan
        // resolve({ success: true ...}) oncesinde sayilir; baska hicbir catch'te basari sayimi olamaz.
        const istisna = /if \(e && e\.txHash\) \{\n\s*updateTxStatus\(txId, 'processing', \{[\s\S]*?\n\s*\}\)\n\s*countAnalytics\('swap', chainId\)\n\s*resolve\(\{ success: true/g
        let istisnaSayisi = 0
        for (const b of bloklar) {
            const temiz = b.replace(istisna, () => { istisnaSayisi++; return '' })
            expect(temiz).not.toMatch(/countAnalytics\('(transfer|swap|bridge)'/)
            expect(temiz).not.toMatch(/countOwnTransfer\(/)
        }
        expect(istisnaSayisi).toBe(1)
    })

    it('hata sayimi cagrilari yalniz countAnalyticsFailure / countOwnTransferFailure uzerinden', () => {
        expect(src).not.toMatch(/countAnalytics\('(transfer|swap|bridge)Failed'/)
        expect(src).not.toMatch(/countAnalyticsGated\('(transfer|swap|bridge)Failed'/)
        // Hata metni tek yerde: countAnalyticsFailure govdesi.
        expect(src.match(/(transfer|swap|bridge)Failed/g) || []).toHaveLength(0)
        expect(govde('countAnalyticsFailure')).toContain("countAnalytics(kind + 'Failed')")
        const sahipler = [...src.matchAll(/countAnalytics\(kind \+ 'Failed'\)/g)]
        expect(sahipler).toHaveLength(1)
    })

    it('countAnalyticsFailure kind argumani yalniz transfer|swap|bridge literal', () => {
        const cagrilar = [...tanimDisi(src).matchAll(/countAnalyticsFailure\(([^)]*)\)/g)]
        expect(cagrilar.length).toBeGreaterThan(0)
        for (const m of cagrilar) expect(m[1], m[0]).toMatch(/^'(transfer|swap|bridge)'$/)
        for (const m of tanimDisi(src).matchAll(/countOwnTransferFailure\(([^)]*)\)/g)) expect(m[1]).toBe('message')
    })

    it('toplam sayim cagrisi sayisi beklenen sabit sayiya esit', () => {
        // Tanimlar haric: basari cagrilari + hata cagrilari + sahip fonksiyon cagrilari.
        const basari = (tanimDisi(src).match(/countAnalytics\(/g) || []).length
        const hata = (tanimDisi(src).match(/countAnalyticsFailure\(/g) || []).length
        const sahip = (tanimDisi(src).match(/countOwnTransfer\(/g) || []).length
        const sahipHata = (tanimDisi(src).match(/countOwnTransferFailure\(/g) || []).length
        // Sabitler Task 9-12 sonrasi kaynaktan hesaplandi; yeni nokta bilerek testi kirar.
        expect({ basari, hata, sahip, sahipHata }).toEqual({ basari: 18, hata: 7, sahip: 3, sahipHata: 1 })
    })
})
