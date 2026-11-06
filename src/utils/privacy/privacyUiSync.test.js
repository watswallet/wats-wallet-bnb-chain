import { describe, it, expect, vi, afterEach } from 'vitest'
import { privacyStateFrom, installPrivacySync } from './privacyUiSync'
import { localLogosOnly, setLocalLogosOnly } from '../tokenLogo'
import { neutralAvatars, setNeutralAvatars } from '../localAvatar'

const GIZLI = { key: 'g-1', address: '0x' + 'cd'.repeat(20), type: 'hd', private: true }
const A = { key: 'a-1', address: '0x' + 'ab'.repeat(20), type: 'hd' }
const VAULTS = [{ accounts: [A], privateAccount: GIZLI }]

afterEach(() => {
    delete globalThis.chrome
    setLocalLogosOnly(false)
    setNeutralAvatars(false)
})

describe('privacyStateFrom', () => {
    it('aktif hesap tek dogruluk kaynagi', () => {
        expect(privacyStateFrom({ active_account: GIZLI, vaults: VAULTS, privacy_mode: { introSeen: true } }))
            .toEqual({ active: true, privateAddress: GIZLI.address, privateAccountKey: 'g-1', introSeen: true })
        expect(privacyStateFrom({ active_account: A, vaults: VAULTS }).active).toBe(false)
        expect(privacyStateFrom({}).privateAddress).toBe(null)
    })
})

describe('installPrivacySync', () => {
    function setup(initial) {
        const listeners = []
        globalThis.chrome = { storage: { onChanged: { addListener: (fn) => listeners.push(fn), removeListener: vi.fn() } } }
        const data = { ...initial }
        const storage = { get: vi.fn(async (keys) => Object.fromEntries(keys.map((k) => [k, data[k]]))) }
        const store = { active: false, privateAddress: null, privateAccountKey: null, introSeen: false }
        const classList = { toggle: vi.fn() }
        const doc = { documentElement: { classList } }
        const fire = (changes) => listeners.forEach((fn) => fn(changes, 'local'))
        return { storage, store, classList, doc, fire }
    }

    it('acilista durumu yukler ve html sinifini ayarlar', async () => {
        const s = setup({ active_account: GIZLI, vaults: VAULTS, privacy_mode: { introSeen: true } })
        await installPrivacySync({ privacyStore: () => s.store, storage: s.storage, doc: s.doc })
        expect(s.store).toEqual({ active: true, privateAddress: GIZLI.address, privateAccountKey: 'g-1', introSeen: true })
        expect(s.classList.toggle).toHaveBeenLastCalledWith('private', true)
    })

    // Iki panel acikken birinde yapilan gecis digerine ulasmali.
    it('baska panelde aktif hesap degisince store ve sinif guncellenir', async () => {
        const s = setup({ active_account: GIZLI, vaults: VAULTS })
        await installPrivacySync({ privacyStore: () => s.store, storage: s.storage, doc: s.doc })
        s.fire({ active_account: { newValue: A } })
        expect(s.store.active).toBe(false)
        expect(s.classList.toggle).toHaveBeenLastCalledWith('private', false)
    })

    // Logolar yerel (spec 4.7, D6): tokenLogo anahtari store ile AYNI yerden cevrilir.
    it('Gizli Hesap aktifken tokenLogo yalniz-yerel anahtari ACILIR; baska panelde mod kapaninca KAPANIR', async () => {
        const s = setup({ active_account: GIZLI, vaults: VAULTS })
        await installPrivacySync({ privacyStore: () => s.store, storage: s.storage, doc: s.doc })
        expect(localLogosOnly()).toBe(true)
        s.fire({ active_account: { newValue: A } })
        expect(localLogosOnly()).toBe(false)
        s.fire({ active_account: { newValue: GIZLI } })
        expect(localLogosOnly()).toBe(true)
    })

    it('normal modda acilista anahtar KAPALI kalir', async () => {
        const s = setup({ active_account: A, vaults: VAULTS })
        await installPrivacySync({ privacyStore: () => s.store, storage: s.storage, doc: s.doc })
        expect(localLogosOnly()).toBe(false)
    })

    it('donen teardown anahtari KAPATIR (dinleyici kalkinca takili kalan kural olmaz)', async () => {
        const s = setup({ active_account: GIZLI, vaults: VAULTS })
        const teardown = await installPrivacySync({ privacyStore: () => s.store, storage: s.storage, doc: s.doc })
        expect(localLogosOnly()).toBe(true)
        teardown()
        expect(localLogosOnly()).toBe(false)
    })

    // Notr avatarlar (grafit karari, kullanici 2026-10-26): localAvatar anahtari tokenLogo anahtariyla AYNI yerden cevrilir.
    it('Gizli Hesap aktifken notr avatar anahtari ACILIR; baska panelde mod kapaninca KAPANIR', async () => {
        const s = setup({ active_account: GIZLI, vaults: VAULTS })
        await installPrivacySync({ privacyStore: () => s.store, storage: s.storage, doc: s.doc })
        expect(neutralAvatars()).toBe(true)
        s.fire({ active_account: { newValue: A } })
        expect(neutralAvatars()).toBe(false)
        s.fire({ active_account: { newValue: GIZLI } })
        expect(neutralAvatars()).toBe(true)
    })

    it('normal modda acilista notr avatar anahtari KAPANIR (onceden takili kalmis olsa bile)', async () => {
        setNeutralAvatars(true)
        const s = setup({ active_account: A, vaults: VAULTS })
        await installPrivacySync({ privacyStore: () => s.store, storage: s.storage, doc: s.doc })
        expect(neutralAvatars()).toBe(false)
    })

    it('donen teardown notr avatar anahtarini da KAPATIR', async () => {
        const s = setup({ active_account: GIZLI, vaults: VAULTS })
        const teardown = await installPrivacySync({ privacyStore: () => s.store, storage: s.storage, doc: s.doc })
        expect(neutralAvatars()).toBe(true)
        teardown()
        expect(neutralAvatars()).toBe(false)
    })

    it('kasa degisince Gizli Hesap adresi guncellenir', async () => {
        const s = setup({ active_account: A, vaults: [{ accounts: [A] }] })
        await installPrivacySync({ privacyStore: () => s.store, storage: s.storage, doc: s.doc })
        expect(s.store.privateAddress).toBe(null)
        s.fire({ vaults: { newValue: VAULTS } })
        expect(s.store.privateAddress).toBe(GIZLI.address)
    })
})
