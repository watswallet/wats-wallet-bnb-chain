// ManageAccounts.vue GERCEKTEN render edilerek olculur (bkz. src/test-utils/ssrRender.js).
//
// IKI KUSUR, TEK EKRAN:
//
// 1) `isActive` hesap ADINI karsilastiriyordu. Ad kullanici tarafindan serbestce
//    degistirilebilir ve varsayilanlar CAKISIR: iki farkli kasadaki iki hesap da
//    "Wats 1" olabilir. O zaman listede IKI satir birden yesil nokta + indigo cerceve
//    ile "aktif" gorunur. Manuel TON modeliyle bu bir kenar durum olmaktan cikti:
//    kullanicinin bir EVM hesabi ve bir TON hesabi var, ikisi de kendi kasasinin
//    ilk hesabi. Dogru anahtar `key` -- kasa-icinde benzersiz kimlik, ayni sebeple
//    deriveAccount.js:findVaultForAccount da ONCE onu deniyor.
//
// 2) Ekranda hangi satirin hangi zincire ait oldugunu soyleyen HICBIR sey yoktu.
//    Adres bicimi (0x... / UQ...) bir ipucu ama kullaniciya ogretilmis bir kural
//    degil, ve hesap adi ("TON 1") yeniden adlandirilabilir -- zincir ipucu SAYILMAZ.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../../test-utils/ssrRender.js'
import ManageAccounts from './ManageAccounts.vue'

// IKI HESAP, AYNI AD: kusurun uretildigi tam yapilandirma.
const EVM_ACCOUNT = {
    key: 'k-evm', name: 'Wats 1', type: 'hd', fingerprint: 'F_EVM',
    address: '0xAbCdEf0000000000000000000000000000000001',
}
const TON_ACCOUNT = {
    key: 'k-ton', name: 'Wats 1', type: 'ton', fingerprint: 'F_TON',
    address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG',
}

afterEach(() => { delete globalThis.chrome })

function mount(active_account) {
    installChromeStub({
        vaults: [
            { type: 'hd', fingerprint: 'F_EVM', accounts: [EVM_ACCOUNT] },
            { type: 'tonMnemonic', fingerprint: 'F_TON', accounts: [TON_ACCOUNT] },
        ],
        active_account,
    })
    const app = createApp(ManageAccounts)
    app.use(createTestPinia())
    app.use(createTestI18n())
    return app
}

// TEK BIR SATIRIN html'i. Satirlar `<button` ile baslar; adresin kisaltilmis hali
// (shorten()) o satirda BIR KEZ gecer ve satiri benzersiz kilar.
//
// NEDEN satir bazli: `expect(html).toContain('>TON<')` iddiasi listedeki HERHANGI
// bir satirdan saglanir -- rozeti YANLIS satira basan bir uygulama da gecerdi ve
// kullaniciya TON hesabini "EVM" diye gosteren bir arayuz testten gecerdi.
const rowOf = (html, shortAddress) =>
    html.split('<button').find((part) => part.includes(shortAddress)) || ''

describe('ManageAccounts (SSR) -- aktif hesap ADLA degil KEY ile bulunur', () => {
    it('ayni ADI tasiyan BASKA hesabi aktif SANMAZ', async () => {
        const app = mount(TON_ACCOUNT)
        const captured = captureInstance(app, 'ManageAccounts')
        await render(app)

        expect(captured.instance.setupState.isActive(EVM_ACCOUNT)).toBe(false)
        expect(captured.instance.setupState.isActive(TON_ACCOUNT)).toBe(true)
    })

    // Aktif hesabin `key`i yoksa (bozuk/yarim kayit) HICBIR satir aktif
    // isaretlenmemeli. `undefined === undefined` ile HER satirin yesil nokta
    // almasi, ad karsilastirmasindan daha kotu bir gerileme olurdu.
    it('aktif hesabin key i yoksa HICBIR satiri aktif isaretlemez', async () => {
        const app = mount({ name: 'Wats 1', address: '0x0' })
        const captured = captureInstance(app, 'ManageAccounts')
        await render(app)

        expect(captured.instance.setupState.isActive(EVM_ACCOUNT)).toBe(false)
        expect(captured.instance.setupState.isActive(TON_ACCOUNT)).toBe(false)
    })
})

describe('ManageAccounts (SSR) -- her satir kendi zincir rozetini tasir', () => {
    it('EVM satiri EVM, TON satiri TON rozeti gosterir', async () => {
        const app = mount(TON_ACCOUNT)
        const html = await render(app)

        expect(rowOf(html, '0xAbCd...0001')).toContain('>EVM<')
        expect(rowOf(html, 'UQBvW8...ggGG')).toContain('>TON<')
    })

    // Rozet YANLIS satirda olmamali: capraz iddia olmadan "her satira ayni rozeti
    // bas" uygulamasi da yesil kalirdi.
    it('rozetler capraz gecmez', async () => {
        const app = mount(TON_ACCOUNT)
        const html = await render(app)

        expect(rowOf(html, '0xAbCd...0001')).not.toContain('>TON<')
        expect(rowOf(html, 'UQBvW8...ggGG')).not.toContain('>EVM<')
    })

    // Bilinmeyen tipli (eski/yarim) kayitta UYDURULMUS bir rozet basmak, adresin
    // kendisinden daha az bilgi tasiyan bir YALAN olurdu: badgeOf orada `null`
    // doner ve satir rozetsiz kalir.
    it('bilinmeyen tipli hesapta rozet HIC cizilmez', async () => {
        const legacy = { key: 'k-old', name: 'Eski', address: '0x1111111111111111111111111111111111111111' }
        installChromeStub({
            vaults: [{ type: 'hd', fingerprint: 'F_OLD', accounts: [legacy] }],
            active_account: legacy,
        })
        const app = createApp(ManageAccounts)
        app.use(createTestPinia())
        app.use(createTestI18n())
        const html = await render(app)

        // POZITIF BEKCI: rowOf bos dize dondururse (satir hic bulunamazsa) asagidaki
        // iki `not.toContain` iddiasi da BOS uzerinde HALA gecerdi ve satirin gercekten
        // var olup rozetsiz kaldigini degil, sadece bulunamadigini olcerdi.
        const row = rowOf(html, '0x1111...1111')
        expect(row).not.toBe('')
        expect(row).not.toContain('>EVM<')
        expect(row).not.toContain('>TON<')
    })
})
