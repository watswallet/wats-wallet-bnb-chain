// TonConnect onay ekranlarinin Kapat-yalniz cikisi (B1): dapp'e hicbir sey
// gitmez. current_request yalniz arka plan kaydi artik TUTMUYORSA temizlenir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { cikislar } = vi.hoisted(() => ({ cikislar: [] }))
vi.mock('./uiSurface', () => ({
    closeOrNavigate: (hedef, opts) => { cikislar.push({ hedef, opts }) },
}))

import { tonOnayiKapat } from './tonApprovalExit'

let depo
let gonderilen
// TON_DAPP_REQUEST_STATE yaniti (arka planin pendingRequestState'i).
let arkaPlan

beforeEach(() => {
    cikislar.length = 0
    depo = {}
    gonderilen = []
    arkaPlan = async () => ({ state: 'gone' })
    globalThis.chrome = {
        storage: {
            local: {
                get: async (k) => ({ [k]: depo[k] }),
                remove: async (k) => { delete depo[k] },
            },
        },
        runtime: { sendMessage: async (m) => { gonderilen.push(m); return arkaPlan(m) } },
    }
})

afterEach(() => { delete globalThis.chrome })

describe('tonOnayiKapat', () => {
    const page = { currentPage: 'ton_send_tx' }

    // Arka plana giden tek mesaj durum sorusu; dapp'e yanit veren hicbir tur
    // (SEND_TX_SUCCESS vb.) gitmez.
    it('ayni istegin kaydini siler, ana sayfaya cikar; dapp e mesaj GONDERMEZ', async () => {
        depo.current_request = { type: 'TON_SEND_TX', id: 'req-1' }

        await tonOnayiKapat('req-1', page)

        expect(depo.current_request).toBeUndefined()
        expect(cikislar).toEqual([{ hedef: 'home', opts: { page } }])
        expect(gonderilen).toEqual([{ type: 'TON_DAPP_REQUEST_STATE', requestId: 'req-1' }])
    })

    // Ikinci yuzey (or. eylem popup'i) kapaninca onay penceresinin durust
    // metni silinmemeli: kayit hala o pencereye bagli, onun kapanisi temizler.
    it.each(['answered', 'committed', 'open'])('kayit arka planda hala duruyorsa (%s) current_request SILINMEZ', async (state) => {
        arkaPlan = async () => ({ state })
        const kayit = { type: 'TON_SEND_TX', id: 'req-1', answered: { error: 'TON_SEND_FAILED', code: 0 } }
        depo.current_request = kayit

        await tonOnayiKapat('req-1', page)

        expect(depo.current_request).toEqual(kayit)
        expect(cikislar).toHaveLength(1)
    })

    // Arka plan cevap veremiyorsa bekleyen kayit da yoktur; olu kayit kalirsa
    // popup her acilista ayni ekrana doner.
    it('arka plan yanit veremezse ayni id li kayit yine silinir', async () => {
        arkaPlan = async () => { throw new Error('Receiving end does not exist.') }
        depo.current_request = { type: 'TON_SEND_TX', id: 'req-1' }

        await tonOnayiKapat('req-1', page)

        expect(depo.current_request).toBeUndefined()
        expect(cikislar).toHaveLength(1)
    })

    it('baska bir istegin kaydina DOKUNMAZ', async () => {
        depo.current_request = { type: 'SEND_TX', id: 'yeni' }

        await tonOnayiKapat('req-1', page)

        expect(depo.current_request).toEqual({ type: 'SEND_TX', id: 'yeni' })
        expect(cikislar).toHaveLength(1)
    })

    // Kimliksiz cagri (ekran yuklenmeden) id'siz bir kaydi "ayni" saymamali.
    it('requestId yoksa id siz bir kaydi da SILMEZ, arka plana da sormaz', async () => {
        depo.current_request = { type: 'BOZUK' }

        await tonOnayiKapat(undefined, page)

        expect(depo.current_request).toEqual({ type: 'BOZUK' })
        expect(gonderilen).toEqual([])
    })

    it('depo okunamazsa yine de cikar (firlatmaz)', async () => {
        globalThis.chrome.storage.local.get = async () => { throw new Error('depo yok') }
        const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await expect(tonOnayiKapat('req-1', page)).resolves.toBeUndefined()

        expect(cikislar).toHaveLength(1)
        uyari.mockRestore()
    })
})
