// SavedAddresses.vue -> App.vue -> EditAddress.vue arasindaki KAYIT KIMLIGI
// telini kilitler.
//
// KOK NEDEN (inceleme, Bulgu A): EditAddress.vue depodaki kaydi artik DIZI
// INDISIYLE buluyor, cunku ne `label` ne de `address` benzersiz
// (`AddAddress.vue` yinelenen kontrolu YAPMADAN push eder). Indis
// SavedAddresses.vue'nun `v-for`undan cikar, App.vue uzerinden EditAddress.vue'ya
// bir prop olarak ulasir. Bu telin HERHANGI bir halkasi kopiarsa
// `savedAddressIndex` `undefined` olur, `locateRecord` null doner ve
// duzenleme/silme SESSIZCE hicbir sey yapmaz -- guvenli bir yon, ama tam bir
// ozellik kaybi. Bu dosya olmadan hicbir test bunu yakalamaz.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js
// basindaki KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../../test-utils/ssrRender.js'
import SavedAddresses from './SavedAddresses.vue'

const EVM_ADDR = '0xabcdef0000000000000000000000000000000001'
const SOL_ADDR = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

afterEach(() => {
    delete globalThis.chrome
})

function setup(savedAddresses, onEditAddress) {
    installChromeStub({ saved_addresses: savedAddresses })
    const app = createApp(SavedAddresses, { props: { onEditAddress } })
    app.use(createTestPinia())
    app.use(createTestI18n())

    const captured = captureInstance(app, 'SavedAddresses')
    return { app, captured }
}

describe('SavedAddresses.vue (SSR) -- kaydin INDISI de yayinlanir (Bulgu A)', () => {
    it('editAddress kaydi VE listedeki indisi yayinlar', async () => {
        const list = [
            { label: 'Ev', address: EVM_ADDR, chainId: 1 },
            { label: 'Is', address: EVM_ADDR, chainId: 1 },
        ]
        const spy = vi.fn()
        const { app, captured } = setup(list, spy)
        await render(app)

        // Bu ortamda DOM/tiklama YOK; sablonun @click'te cagirdigi AYNI
        // fonksiyon dogrudan cagrilir (bkz. ssrRender.js'teki setupState notu).
        captured.instance.setupState.editAddress(list[1], 1)

        expect(spy).toHaveBeenCalledWith(list[1], 1)
    })

    // ASIL RISK: indis DUSERSE (tek argumanla yayin) EditAddress.vue'nun
    // `savedAddressIndex`i undefined olur ve duzenleme/silme sessizce OLU
    // hale gelir. Ikinci argumanin VARLIGI acikca kilitlenir.
    it('ikinci arguman GERCEKTEN bir SAYIDIR (dusurulemez)', async () => {
        const list = [{ label: 'Solana', address: SOL_ADDR, chainId: 'solana-mainnet' }]
        const spy = vi.fn()
        const { app, captured } = setup(list, spy)
        await render(app)

        captured.instance.setupState.editAddress(list[0], 0)

        expect(spy.mock.calls[0]).toHaveLength(2)
        expect(Number.isInteger(spy.mock.calls[0][1])).toBe(true)
    })

    it('sablon @click e indisi GERCEKTEN geciriyor (v-for indisi baglanmis)', () => {
        const source = readFileSync(fileURLToPath(new URL('./SavedAddresses.vue', import.meta.url)), 'utf8')

        expect(source).toMatch(/v-for="\(savedAddress, index\) in savedAddresses"/)
        expect(source).toMatch(/@click="editAddress\(savedAddress,\s*index\)"/)
    })
})

// App.vue TEK BASINA render edilemez (tum uygulama kabugu, onlarca store/ag
// bagimliligi) -- bu yuzden telin ORTA halkasi KAYNAK duzeyinde kilitlenir,
// tipki homeSolanaWiring.test.js'in Home.vue icin yaptigi gibi. Kilitlenen sey
// bir bicim tercihi DEGIL: prop baglantisi ya da ikinci parametre dusurulurse
// EditAddress'in kayit bulma yolu tamamen olur.
describe('App.vue -- indis EditAddress.vue ya kadar TASINIR (Bulgu A)', () => {
    const APP = readFileSync(fileURLToPath(new URL('../../../popup/App.vue', import.meta.url)), 'utf8')

    it('EditAddress e :saved-address-index prop u baglanir', () => {
        expect(APP).toMatch(/<EditAddress[^>]*:saved-address-index="selected_address_index"/)
    })

    it('selectAddress IKI arguman alir ve indisi saklar', () => {
        expect(APP).toMatch(/const selectAddress = \(data,\s*index\)\s*=>/)
        expect(APP).toMatch(/selected_address_index\.value = index/)
    })
})
