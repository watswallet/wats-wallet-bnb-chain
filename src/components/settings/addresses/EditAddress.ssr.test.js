// EditAddress.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN (Task 16b): AddAddress.vue ile AYNI -- `ethers.isAddress` kapida
// duruyordu. Buradaki EK riski: dogrulama hangi "vm"ye gore yapilir? Aktif ag
// DEGIL, KAYDIN KENDI chainId'si -- kullanici Adres Defteri'ni herhangi bir
// agdayken acabilir (bkz. EditAddress.vue'deki `vm` yorumu).
import { describe, it, expect, afterEach } from 'vitest'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../../test-utils/ssrRender.js'
import EditAddress from './EditAddress.vue'

const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const PDA = '8nqnRHi4kQS7YjFmov2Khht6GQ8Fh58dDqQWe7dBE1gg'
const EVM_ADDR = '0xabcdef0000000000000000000000000000000001'

afterEach(() => {
    delete globalThis.chrome
})

function setup(savedAddress) {
    const chromeStub = installChromeStub({ saved_addresses: [savedAddress] })
    // `savedAddressIndex` bilesenin kaydi depoda BULMA yoludur (inceleme,
    // Bulgu A): SavedAddresses.vue `v-for` indisini yayinlar, App.vue tasir.
    const app = createApp(EditAddress, { props: { savedAddress, savedAddressIndex: 0 } })
    app.use(createTestPinia())
    app.use(createTestI18n())

    const captured = captureInstance(app, 'EditAddress')
    return { app, captured, chromeStub }
}

describe('EditAddress.vue (SSR) -- EVM REGRESYONU: davranis degismedi', () => {
    it('kayitli EVM adresi mount aninda GECERLI sayilir (eskiden de boyleydi)', async () => {
        const { app, captured } = setup({ label: 'Test', address: EVM_ADDR, chainId: 1 })
        await render(app)

        expect(captured.instance.setupState.isValid).toBe(true)
        expect(captured.instance.setupState.vm).toBe('evm')
    })

    it('EVM adresi baska bir gecersiz degerle degistirilirse ESKI mesaj gorunur', async () => {
        const { app, captured } = setup({ label: 'Test', address: EVM_ADDR, chainId: 1 })
        await render(app)

        captured.instance.setupState.address = 'not-an-address'

        expect(captured.instance.setupState.isValid).toBe(false)
        expect(captured.instance.setupState.reason).toBe('INVALID_EVM_ADDRESS')
    })

    it('duzenlenen EVM adresi OLDUGU GIBI (kucultulmeden) kaydedilir', async () => {
        const { app, captured, chromeStub } = setup({ label: 'Test', address: EVM_ADDR, chainId: 1 })
        await render(app)

        const NEW_ADDR = '0xffffffffffffffffffffffffffffffffffffffff'
        captured.instance.setupState.address = NEW_ADDR
        expect(captured.instance.setupState.isValid).toBe(true)

        await captured.instance.setupState.edit()

        expect(chromeStub.localStore.saved_addresses[0].address).toBe(NEW_ADDR)
    })
})

describe('EditAddress.vue (SSR) -- Solana kaydi duzenlenebilir (Task 16b)', () => {
    it('kayitli Solana adresi mount aninda GECERLI sayilir, vm dogru cozulur', async () => {
        const { app, captured } = setup({ label: 'Solana Cuzdanim', address: WALLET, chainId: 'solana-mainnet' })
        await render(app)

        expect(captured.instance.setupState.isValid).toBe(true)
        expect(captured.instance.setupState.vm).toBe('solana')
    })

    it('vm KAYDIN chainId sinden gelir, AKTIF agdan DEGIL', async () => {
        // Aktif ag hic kurulmadi (networkStore bos) -- yine de Solana kaydi
        // dogru vm ile dogrulanmali, cunku kaynak savedAddress.chainId'dir.
        const { app, captured } = setup({ label: 'Solana Cuzdanim', address: WALLET, chainId: 'solana-mainnet' })
        await render(app)

        captured.instance.setupState.address = PDA // gecerli base58 ama cuzdan degil
        expect(captured.instance.setupState.reason).toBe('RECIPIENT_NOT_WALLET')
    })

    it('egri disindaki bir adresle DEGISTIRILIRSE RECIPIENT_NOT_WALLET ile reddedilir', async () => {
        const { app, captured } = setup({ label: 'Solana Cuzdanim', address: WALLET, chainId: 'solana-mainnet' })
        await render(app)

        captured.instance.setupState.address = PDA

        expect(captured.instance.setupState.isValid).toBe(false)
        expect(captured.instance.setupState.reason).toBe('RECIPIENT_NOT_WALLET')
    })

    it('duzenlenen Solana adresi harf kasasi BIREBIR korunarak kaydedilir', async () => {
        const { app, captured, chromeStub } = setup({ label: 'Solana Cuzdanim', address: WALLET, chainId: 'solana-mainnet' })
        await render(app)

        const OTHER_WALLET = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
        captured.instance.setupState.address = `  ${OTHER_WALLET}  `
        expect(captured.instance.setupState.isValid).toBe(true)

        await captured.instance.setupState.edit()

        expect(chromeStub.localStore.saved_addresses[0].address).toBe(OTHER_WALLET)
        expect(chromeStub.localStore.saved_addresses[0].address).not.toBe(OTHER_WALLET.toLowerCase())
    })

    it('silme HALA calisir (Solana kaydi icin de)', async () => {
        const { app, captured, chromeStub } = setup({ label: 'Solana Cuzdanim', address: WALLET, chainId: 'solana-mainnet' })
        await render(app)

        await captured.instance.setupState.remove()

        expect(chromeStub.localStore.saved_addresses).toEqual([])
    })
})

// KOD INCELEMESI (Task 16b review, F4): kayit ONCEDEN `label`e gore
// bulunuyordu/siliniyordu. Bu gorev, ayni kisinin biri EVM biri Solana olan IKI
// kayda AYNI etiketle ihtiyac duymasini YAYGIN hale getirdi (orn. "Ali").
describe('EditAddress.vue (SSR) -- AYNI etiketli iki kayit birbirine KARISMAZ (F4)', () => {
    function setupWithSiblings(savedAddress, siblings) {
        const chromeStub = installChromeStub({ saved_addresses: [...siblings, savedAddress] })
        // Duzenlenen kayit SONA eklendi -> indisi kardeslerin SAYISIDIR.
        const app = createApp(EditAddress, { props: { savedAddress, savedAddressIndex: siblings.length } })
        app.use(createTestPinia())
        app.use(createTestI18n())

        const captured = captureInstance(app, 'EditAddress')
        return { app, captured, chromeStub }
    }

    it('Solana "Ali" duzenlenince EVM "Ali" kaydi DOKUNULMADAN kalir', async () => {
        const evmAli = { label: 'Ali', address: EVM_ADDR, chainId: 1 }
        const solanaAli = { label: 'Ali', address: WALLET, chainId: 'solana-mainnet' }
        const { app, captured, chromeStub } = setupWithSiblings(solanaAli, [evmAli])
        await render(app)

        const OTHER_WALLET = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
        captured.instance.setupState.label = 'Ali (Solana)'
        captured.instance.setupState.address = OTHER_WALLET
        expect(captured.instance.setupState.isValid).toBe(true)

        await captured.instance.setupState.edit()

        const evmRecord = chromeStub.localStore.saved_addresses.find(a => a.address === EVM_ADDR)
        const solanaRecord = chromeStub.localStore.saved_addresses.find(a => a.address === OTHER_WALLET)

        // EVM kaydi HIC DEGISMEDI -- ne etiketi ne adresi.
        expect(evmRecord).toEqual(evmAli)
        // Solana kaydi DOGRU sekilde guncellendi.
        expect(solanaRecord.label).toBe('Ali (Solana)')
        expect(chromeStub.localStore.saved_addresses).toHaveLength(2)
    })

    it('silme yalniz KENDI kaydini kaldirir, AYNI etiketli digerini SILMEZ', async () => {
        const evmAli = { label: 'Ali', address: EVM_ADDR, chainId: 1 }
        const solanaAli = { label: 'Ali', address: WALLET, chainId: 'solana-mainnet' }
        const { app, captured, chromeStub } = setupWithSiblings(solanaAli, [evmAli])
        await render(app)

        await captured.instance.setupState.remove()

        expect(chromeStub.localStore.saved_addresses).toEqual([evmAli])
    })
})

// INCELEME (Bulgu A): F4'un ilk duzeltmesi kaydi `label` yerine `address` ile
// buluyordu. `address` DE BENZERSIZ DEGIL -- AddAddress.vue yinelenen kontrolu
// YAPMADAN push eder, yani AYNI adres iki FARKLI etiketle ("Ev"/"Is")
// kaydedilebilir. O halde `address`e gore anahtarlamak `08a043d`deki (etikete
// gore anahtarlayan) davranisa gore bir GERILEMEYDI: `remove()` IKISINI BIRDEN
// siliyor, `edit()` ILK eslesenin uzerine yaziyordu. Anahtar artik INDIS.
describe('EditAddress.vue (SSR) -- AYNI adresli iki kayit birbirine KARISMAZ (Bulgu A)', () => {
    function setupAt(list, index) {
        const chromeStub = installChromeStub({ saved_addresses: list })
        const app = createApp(EditAddress, { props: { savedAddress: list[index], savedAddressIndex: index } })
        app.use(createTestPinia())
        app.use(createTestI18n())

        const captured = captureInstance(app, 'EditAddress')
        return { app, captured, chromeStub }
    }

    const evHome = () => ({ label: 'Ev', address: EVM_ADDR, chainId: 1 })
    const isWork = () => ({ label: 'Is', address: EVM_ADDR, chainId: 1 })

    it('silme TAM OLARAK BIR kaydi kaldirir, ayni adresli digerini BIRAKIR', async () => {
        const list = [evHome(), isWork()]
        const { app, captured, chromeStub } = setupAt(list, 1)
        await render(app)

        await captured.instance.setupState.remove()

        expect(chromeStub.localStore.saved_addresses).toEqual([evHome()])
    })

    it('ILK kaydin silinmesi IKINCIYI birakir (indis 0 da dogru calisir)', async () => {
        const list = [evHome(), isWork()]
        const { app, captured, chromeStub } = setupAt(list, 0)
        await render(app)

        await captured.instance.setupState.remove()

        expect(chromeStub.localStore.saved_addresses).toEqual([isWork()])
    })

    it('duzenleme ILK eslesenin DEGIL, ACILAN kaydin uzerine yazar', async () => {
        const list = [evHome(), isWork()]
        const { app, captured, chromeStub } = setupAt(list, 1)
        await render(app)

        const NEW_ADDR = '0xffffffffffffffffffffffffffffffffffffffff'
        captured.instance.setupState.address = NEW_ADDR
        expect(captured.instance.setupState.isValid).toBe(true)

        await captured.instance.setupState.edit()

        const saved = chromeStub.localStore.saved_addresses
        // "Ev" BIREBIR dokunulmadan kaldi; degisen YALNIZ "Is".
        expect(saved[0]).toEqual(evHome())
        expect(saved[1]).toEqual({ label: 'Is', address: NEW_ADDR, chainId: 1 })
    })

    // KIMLIK KORUMASI: indis, ekran acildiktan sonra dizi degistiyse YANLIS
    // kaydi gosterebilir. O konumdaki kayit kullanicinin GORDUGU kayit degilse
    // HICBIR YAZMA yapilmaz -- kullanicinin gormedigi bir kaydi silmek/
    // duzenlemek tam da kapatilan hatanin kendisidir.
    it('indisteki kayit ACILAN kayit DEGILSE hicbir yazma yapilmaz', async () => {
        const opened = isWork()
        const chromeStub = installChromeStub({ saved_addresses: [evHome()] })
        const app = createApp(EditAddress, { props: { savedAddress: opened, savedAddressIndex: 0 } })
        app.use(createTestPinia())
        app.use(createTestI18n())
        const captured = captureInstance(app, 'EditAddress')
        await render(app)

        await captured.instance.setupState.remove()
        expect(chromeStub.localStore.saved_addresses).toEqual([evHome()])

        captured.instance.setupState.address = '0xffffffffffffffffffffffffffffffffffffffff'
        await captured.instance.setupState.edit()
        expect(chromeStub.localStore.saved_addresses).toEqual([evHome()])
    })
})
