// Korumanin IKI YARISI da burada olculur (bkz. useFlowScreenGuard.test.js ile ayni gerekce): SSR harness'i
// izleyicileri calistirmaz ve render bitince effect scope'u durdurur; "hesap/mod SONRADAN degisti" yarisi
// ancak gercek bir effectScope + gercek `watch` ile gozlemlenir.
import { describe, it, expect, vi } from 'vitest'
import { effectScope, ref, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createQuoteScopeGuard, useQuoteScopeGuard } from './useQuoteScopeGuard'
import { userStore } from '../store/user'
import { privacyStore } from '../store/privacy'

function kurCekirdek() {
    const address = ref('0xA')
    const active = ref(false)
    const onChange = vi.fn()
    const scope = effectScope()
    scope.run(() => createQuoteScopeGuard({ getAddress: () => address.value, getPrivacyActive: () => active.value, onChange }))
    return { address, active, onChange, scope }
}

describe('createQuoteScopeGuard', () => {
    it('KURULURKEN atesleme: yalniz degisimde calisir', async () => {
        const { onChange } = kurCekirdek()
        await nextTick()
        expect(onChange).not.toHaveBeenCalled()
    })

    it('hesap adresi degisince bir kez atesler', async () => {
        const { address, onChange } = kurCekirdek()
        address.value = '0xB'
        await nextTick()
        expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('gizli mod degisince bir kez atesler (adres ayni kalsa bile)', async () => {
        const { active, onChange } = kurCekirdek()
        active.value = true
        await nextTick()
        expect(onChange).toHaveBeenCalledTimes(1)
        active.value = false
        await nextTick()
        expect(onChange).toHaveBeenCalledTimes(2)
    })

    it('ayni tikte hem adres hem mod degisirse tek atesleme', async () => {
        const { address, active, onChange } = kurCekirdek()
        address.value = '0xB'
        active.value = true
        await nextTick()
        expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('ayni degeri yeniden yazmak atesletmez', async () => {
        const { address, active, onChange } = kurCekirdek()
        address.value = '0xA'
        active.value = false
        await nextTick()
        expect(onChange).not.toHaveBeenCalled()
    })

    it('scope durdurulunca izleyici de durur (kapanmis ekran teklif istemez)', async () => {
        const { address, onChange, scope } = kurCekirdek()
        scope.stop()
        address.value = '0xB'
        await nextTick()
        expect(onChange).not.toHaveBeenCalled()
    })
})

describe('useQuoteScopeGuard (Pinia: user.address ve privacy.active)', () => {
    function kurPinia() {
        setActivePinia(createPinia())
        const onChange = vi.fn()
        const scope = effectScope()
        scope.run(() => useQuoteScopeGuard(onChange))
        return { user: userStore(), privacy: privacyStore(), onChange, scope }
    }

    it('user.address degisince atesler', async () => {
        const { user, onChange } = kurPinia()
        user.address = '0xAbC'
        await nextTick()
        expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('privacy.active degisince atesler', async () => {
        const { privacy, onChange } = kurPinia()
        privacy.active = true
        await nextTick()
        expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('ilgisiz store alanlari (privateAddress, usd) atesletmez', async () => {
        const { user, privacy, onChange } = kurPinia()
        privacy.privateAddress = '0xGizli'
        privacy.introSeen = true
        user.usd = 5
        await nextTick()
        expect(onChange).not.toHaveBeenCalled()
    })
})
