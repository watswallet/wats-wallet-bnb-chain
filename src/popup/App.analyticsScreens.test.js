// Ekran izleyicisi: saf yardimci davranisi + App.vue baglantisinin kaynak taramasi.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { screenCounterHandler } from '../utils/analyticsScreens.js'

const mk = (o = {}) => {
    const send = vi.fn()
    const h = screenCounterHandler({ getSurface: () => 'popup', privacyActive: () => false, isStockPage: () => false, send, ...o })
    return { h, send }
}

describe('screenCounterHandler', () => {
    it('popup yuzeyinde send girisi sayilir', () => {
        const { h, send } = mk()
        h('send')
        expect(send).toHaveBeenCalledWith('send')
    })
    it('panel yuzeyinde de sayilir', () => {
        const { h, send } = mk({ getSurface: () => 'panel' })
        h('swap')
        expect(send).toHaveBeenCalledWith('swap')
    })
    it('window yuzeyinde hicbir ekran sayilmaz', () => {
        const { h, send } = mk({ getSurface: () => 'window' })
        h('send'); h('swap'); h('token')
        expect(send).not.toHaveBeenCalled()
    })
    it('alert yuzeyinde de sayilmaz', () => {
        const { h, send } = mk({ getSurface: () => 'alert' })
        h('send')
        expect(send).not.toHaveBeenCalled()
    })
    it('privacy aktifken mesaj yok', () => {
        const { h, send } = mk({ privacyActive: () => true })
        h('send'); h('settings')
        expect(send).not.toHaveBeenCalled()
    })
    it('home/welcome/select_asset ... null: mesaj yok', () => {
        const { h, send } = mk()
        for (const p of ['home', 'welcome', 'select_asset', '', 'private_send', 'dapp_connect', 'settings_show_phrases']) h(p)
        expect(send).not.toHaveBeenCalled()
    })
    it('listede olmayan yeni sayfa other sayilir', () => {
        const { h, send } = mk()
        h('yeni_bir_sayfa')
        expect(send).toHaveBeenCalledWith('other')
    })
    it('geri gidip tekrar girmek tekrar sayilir', () => {
        const { h, send } = mk()
        h('send'); h('home'); h('send')
        expect(send.mock.calls.map((c) => c[0])).toEqual(['send', 'send'])
    })
    it('ayni deger tekrar ayni kalirsa sayilmaz (watch zaten tetiklemez): tek cagri tek mesaj', () => {
        const { h, send } = mk()
        h('bridge')
        expect(send).toHaveBeenCalledTimes(1)
    })
    it('token + isStockPage -> stockDetail, degilse token, hicbir giris iki kez sayilmaz', () => {
        const a = mk({ isStockPage: () => true })
        a.h('token')
        expect(a.send.mock.calls).toEqual([['stockDetail']])
        const b = mk({ isStockPage: () => false })
        b.h('token')
        expect(b.send.mock.calls).toEqual([['token']])
    })
    it('deger olarak verilen kapilar da calisir', () => {
        const send = vi.fn()
        screenCounterHandler({ getSurface: 'popup', privacyActive: false, isStockPage: true, send })('token')
        expect(send).toHaveBeenCalledWith('stockDetail')
    })
})

describe('App.vue baglantisi', () => {
    const src = readFileSync(resolve(__dirname, 'App.vue'), 'utf8')
    it('izleyici IMMEDIATE degil: ilk ekran sayilmaz', () => {
        const m = src.match(/watch\(\(\) => page\.currentPage, \(yeni\) => countScreen\(yeni\)[^\n]*\)/)
        expect(m).toBeTruthy()
        expect(m[0]).not.toMatch(/immediate/)
    })
    it('yuzey, gizli mod ve isStockPage kapilari saf yardimciya baglanir', () => {
        expect(src).toMatch(/screenCounterHandler\(\{[\s\S]*?getSurface,[\s\S]*?privacy\.active[\s\S]*?isStockPage\.value[\s\S]*?requestAnalyticsCount\('screen', \{ key \}\)/)
    })
})
