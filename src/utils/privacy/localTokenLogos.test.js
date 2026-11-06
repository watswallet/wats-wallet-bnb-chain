import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCAL_TOKEN_LOGOS, localTokenLogoPath, hasLocalTokenLogo } from './localTokenLogos'
import { DELIVERY_CHAIN_IDS } from './deliveryChains'
import { isStockDeliveryToken } from './stockDelivery'

// GIZLI MOD, TOKENLERE YEREL LOGO (sahip karari 2026-10-23). Manifest ile client/public/tokens/ klasoru BIRBIRINI
// kilitler: her giris icin dosya, her dosya icin giris; dosyalar 64x64 PNG ve kucuk (eklenti paketini sisirmesin).
//
// BUTCE (neden var): her dosya eklenti paketine (dist, magaza zip'i) girer ve manifest JS paketine girer; tavanlar paketin SISMEMESI icindir ve
// her artis BILINCLI bir karardir. 2026-10-23: 63 dosya / ~330 KB, tavan 75 dosya / 600 KB. 2026-11-03 sahip karari: sunucu token listesinin ilk
// sayfasi (10 teslim agi, hisse haric) paketlendi -> 542 dosya / ~1.4 MB (dosya basina ortanca ~2 KB: 64x64 256-renk palet PNG); yeni tavan olculenin
// ustunde kucuk bir pay: 560 dosya (+%3) / 1.5 MiB (olculen 1.35 MiB). Dosya basina 12 KB tavani DEGISMEDI. Manifest elle degil client/scripts/gen-token-logos.mjs ile uretilir (--check
// bu testin klasor-manifest esitligiyle ayni kapidir). Yeni logo bu tavani asarsa test kirilir: once tasarruf (palet, gereksiz token), sonra
// tavani bilincli yukselt ve bu aciklamayi guncelle.
const TOKENS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../public/tokens')
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const MAX_FILE = 12 * 1024
const MAX_TOTAL = 1536 * 1024
const MAX_FILES = 560

function filesOnDisk() {
    const out = []
    for (const dir of fs.readdirSync(TOKENS_DIR, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue
        for (const f of fs.readdirSync(path.join(TOKENS_DIR, dir.name))) out.push({ chainId: dir.name, file: f, full: path.join(TOKENS_DIR, dir.name, f) })
    }
    return out
}

describe('localTokenLogos manifest', () => {
    it('her giris icin dosya vardir ve her dosya icin giris vardir', () => {
        const disk = new Set(filesOnDisk().map((f) => `${f.chainId}:${f.file.replace(/\.png$/, '')}`))
        expect(disk.size).toBeGreaterThan(0)
        expect([...LOCAL_TOKEN_LOGOS].sort()).toEqual([...disk].sort())
    })

    it('anahtarlar "<teslim agi>:<kucuk harf adres>" bicimindedir, hisse yoktur, sayi sinirdadir', () => {
        expect(LOCAL_TOKEN_LOGOS.size).toBeLessThanOrEqual(MAX_FILES)
        for (const k of LOCAL_TOKEN_LOGOS) {
            const m = /^(\d+):(0x[0-9a-f]{40})$/.exec(k)
            expect(m, k).not.toBeNull()
            expect(DELIVERY_CHAIN_IDS).toContain(Number(m[1]))
            expect(isStockDeliveryToken(Number(m[1]), m[2]), k).toBe(false)
        }
    })

    it('her dosya PNG imzali, 64x64, en fazla 12 KB; toplam en fazla 600 KB', () => {
        let total = 0
        for (const f of filesOnDisk()) {
            expect(f.file, f.full).toMatch(/^0x[0-9a-f]{40}\.png$/)
            const b = fs.readFileSync(f.full)
            expect([...b.subarray(0, 8)], f.full).toEqual(PNG_SIG)
            expect(b.readUInt32BE(16), f.full).toBe(64)
            expect(b.readUInt32BE(20), f.full).toBe(64)
            expect(b.length, f.full).toBeLessThanOrEqual(MAX_FILE)
            total += b.length
        }
        expect(total).toBeLessThanOrEqual(MAX_TOTAL)
    })

    it('yardimcilar: yol, buyuk/kucuk harf ve bilinmeyen cift', () => {
        const [k] = [...LOCAL_TOKEN_LOGOS]
        const [cid, addr] = k.split(':')
        expect(localTokenLogoPath(Number(cid), addr)).toBe(`/tokens/${cid}/${addr}.png`)
        expect(hasLocalTokenLogo(cid, addr.toUpperCase().replace('0X', '0x'))).toBe(true)
        expect(hasLocalTokenLogo(Number(cid) + 12345, addr)).toBe(false)
        expect(hasLocalTokenLogo(cid, '0x' + '12'.repeat(20))).toBe(false)
        expect(hasLocalTokenLogo(cid, null)).toBe(false)
        expect(localTokenLogoPath(cid, '0x' + '12'.repeat(20))).toBeNull()
    })
})
