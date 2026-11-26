// installChromeStub (test-utils/ssrRender.js) -- STOCK_GATE_STATUS yonlendirmesi (Task 40, V5c).
//
// KOK NEDEN / KAPATILAN HATA: ortak uygunluk kaynagi "yukleme = gizli" der; yanit gelmeyen bir yuzey HICBIR hisse satiri
// cizmez. Hisse yuzeyi baglayan mevcut SSR testleri `setSendMessage(fn)` ile tum uygulamanin mesaj yanitini degistirir;
// STATUS'u bilmeyen bir `fn` bu testlerde yuzeyi sessizce gizlerdi (yanlis yesil: iddialar bos bir ekranda gecer).
// installChromeStub STATUS'u setSendMessage'den ONCE yanitlar; kalan mesajlar setSendMessage'e gider.
// Her test kendi chrome'unu kurar ve geri alir (globalThis.chrome sizmasin).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { installChromeStub } from './ssrRender'

afterEach(() => {
    delete globalThis.chrome
})

const STATUS = { type: 'STOCK_GATE_STATUS' }
const OK = { decision: 'OK', reason: 'OK', ipCountry: null }
const ONLY_X = {
    bstocks: { decision: 'BLOCKED', reason: 'IP_COUNTRY_ISSUER', ipCountry: 'TR' },
    xstocks: { decision: 'OK', reason: 'OK', ipCountry: 'TR' },
}

describe('installChromeStub -- STOCK_GATE_STATUS', () => {
    it('installChromeStub: STATUS varsayilan OK/OK (her iki ihracci musait)', async () => {
        installChromeStub()
        expect(await chrome.runtime.sendMessage(STATUS)).toEqual({ bstocks: OK, xstocks: OK })
    })

    it('varsayilan yanit her cagrida KOPYADIR: bir cagirinin degistirmesi sonrakini etkilemez', async () => {
        installChromeStub()
        const ilk = await chrome.runtime.sendMessage(STATUS)
        ilk.bstocks.decision = 'BLOCKED'
        expect(await chrome.runtime.sendMessage(STATUS)).toEqual({ bstocks: OK, xstocks: OK })
    })

    it('eligibility nesnesi verilirse STATUS o yaniti doner', async () => {
        installChromeStub({}, { eligibility: ONLY_X })
        expect(await chrome.runtime.sendMessage(STATUS)).toEqual(ONLY_X)
    })

    it("eligibility 'pending': STATUS hic donmeyen soz; diger mesajlar etkilenmez", async () => {
        const stub = installChromeStub({}, { eligibility: 'pending' })
        stub.setSendMessage(async () => 'digeri')
        const sonuc = vi.fn()
        chrome.runtime.sendMessage(STATUS).then(sonuc, sonuc)
        for (let i = 0; i < 20; i++) await Promise.resolve()
        expect(sonuc).not.toHaveBeenCalled()
        expect(await chrome.runtime.sendMessage({ type: 'BASKA' })).toBe('digeri')
    })

    it('eligibility islevi mesaji gorur ve yaniti belirler (yanit ya da soz); firlatirsa soz reddedilir', async () => {
        const mesajlar = []
        installChromeStub({}, { eligibility: (m) => { mesajlar.push(m); return ONLY_X } })
        expect(await chrome.runtime.sendMessage(STATUS)).toEqual(ONLY_X)
        expect(mesajlar).toEqual([STATUS])

        installChromeStub({}, { eligibility: async () => ({ bstocks: OK, xstocks: OK }) })
        expect(await chrome.runtime.sendMessage(STATUS)).toEqual({ bstocks: OK, xstocks: OK })

        installChromeStub({}, { eligibility: () => { throw new Error('yanit yok') } })
        await expect(chrome.runtime.sendMessage(STATUS)).rejects.toThrow('yanit yok')
    })

    it('setSendMessage cagrilsa da STATUS varsayilandan gelir, baska mesajlar setSendMessage e gider', async () => {
        const stub = installChromeStub()
        const gorulen = []
        stub.setSendMessage(async (m) => { gorulen.push(m); return { ok: m.type } })
        expect(await chrome.runtime.sendMessage(STATUS)).toEqual({ bstocks: OK, xstocks: OK })
        expect(await chrome.runtime.sendMessage({ type: 'SWAP_QUOTE' })).toEqual({ ok: 'SWAP_QUOTE' })
        expect(await chrome.runtime.sendMessage({ type: 'HEARTBEAT' })).toEqual({ ok: 'HEARTBEAT' })
        expect(gorulen).toEqual([{ type: 'SWAP_QUOTE' }, { type: 'HEARTBEAT' }]) // STATUS setSendMessage'e HIC ulasmaz
    })

    it('setSendMessage STATUS icin yanit verse bile varsayilani EZMEZ (STATUS yalniz eligibility ile degistirilir)', async () => {
        const stub = installChromeStub()
        stub.setSendMessage(async () => ({ bstocks: { decision: 'BLOCKED', reason: 'IP_COUNTRY_ISSUER', ipCountry: null } }))
        expect(await chrome.runtime.sendMessage(STATUS)).toEqual({ bstocks: OK, xstocks: OK })
    })

    it('setSendMessage hic ayarlanmamissa baska mesajlar eskisi gibi acik hata yaniti alir (STATUS yine yanitlanir)', async () => {
        installChromeStub()
        expect(await chrome.runtime.sendMessage({ type: 'BASKA' })).toEqual({ error: 'installChromeStub: sendMessage yapilandirilmadi' })
        expect(await chrome.runtime.sendMessage(STATUS)).toEqual({ bstocks: OK, xstocks: OK })
    })

    it('eski cagri bicimi (tek arguman) ve storage davranisi degismedi', async () => {
        const stub = installChromeStub({ a: 1 })
        expect(await chrome.storage.local.get('a')).toEqual({ a: 1 })
        await chrome.storage.local.set({ b: 2 })
        expect(stub.localStore).toEqual({ a: 1, b: 2 })
        expect(stub.changeListenerCount()).toBe(0)
    })
})
