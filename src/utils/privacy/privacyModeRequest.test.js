import { describe, it, expect, afterEach } from 'vitest'
import { requestPrivacyMode } from './privacyModeRequest'

afterEach(() => { delete globalThis.chrome })

function stubSend(impl) {
    const sent = []
    globalThis.chrome = { runtime: { sendMessage: async (msg) => { sent.push(msg); return impl(msg) } } }
    return sent
}

describe('requestPrivacyMode', () => {
    it('PRIVACY_MODE_SET mesajini gonderir; basarida ok:true', async () => {
        const sent = stubSend(() => ({ success: true }))
        expect(await requestPrivacyMode(true)).toEqual({ ok: true })
        expect(await requestPrivacyMode(false)).toEqual({ ok: true })
        expect(sent).toEqual([
            { type: 'PRIVACY_MODE_SET', enabled: true },
            { type: 'PRIVACY_MODE_SET', enabled: false },
        ])
    })

    it('basarisiz cevap bilinen kodu anahtara, bilinmeyeni generic e esler', async () => {
        stubSend(() => ({ success: false, error: 'WALLET_LOCKED' }))
        expect(await requestPrivacyMode(true)).toEqual({ ok: false, errorKey: 'privacy.errors.WALLET_LOCKED' })
        for (const error of ['INVALID_ENABLED', 'PRIVATE_DAPP_BLOCKED', undefined]) {
            stubSend(() => ({ success: false, error }))
            expect(await requestPrivacyMode(true)).toEqual({ ok: false, errorKey: 'privacy.errors.generic' })
        }
    })

    it('bos cevap ve firlatan sendMessage generic hata olur, istisna disari cikmaz', async () => {
        stubSend(() => null)
        expect(await requestPrivacyMode(true)).toEqual({ ok: false, errorKey: 'privacy.errors.generic' })
        stubSend(() => { throw new Error('ag yok') })
        expect(await requestPrivacyMode(false)).toEqual({ ok: false, errorKey: 'privacy.errors.generic' })
    })
})
