// Header.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN: Task 15 oncesi ATS yakit hapi ve dapp baglanti girisi (EIP-1193)
// Solana aktifken de KOSULSUZ render ediliyor, ustelik `loadConnectionState`
// (dugme gizli olsa bile HER ag degisiminde calisan bir fonksiyon) Solana'nin
// METIN chainId'sini `Number()`e sokup NaN'i bagli dapp'in `allowedChains`
// listesine YAZIYOR ve anlamsiz bir "ag etkinlestirildi" banner'i tetikliyordu.
// Bu dosya davranisa bakar: hem GORUNURLUK hem de bu ikinci (gorunmez) yan etki.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js
// basindaki KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Header.vue -> utils/dappFunctions.js zinciri (FIX 5, isEvmDappAddress ithali)
// MODUL UST DUZEYINDE chrome.windows.onRemoved.addListener cagirir; o satir
// import ANINDA calisir, installChromeStub ise ancak test govdesinde. vi.hoisted
// olmadan asagidaki `import Header from './Header.vue'` "chrome is not defined"
// ile patlar (ayni tuzak: ConnectDapp.ssr.test.js, dappFunctions.tonGate.test.js).
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { userStore } from '../store/user'
import { installUiSync } from '../utils/uiSync'
import Header from './Header.vue'
import supported_chains from '../data/supported_chains.json'

const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const POLYGON_CHAIN = supported_chains.find((c) => c.chainId === 137)

// document.addEventListener (disari tiklama) bu SSR ortaminda (DOM yok) yoksa
// crash eder -- konumuzun disinda, zararsiz sahte ile atlanir.
beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

/**
 * `chrome.tabs.query` (installChromeStub'ta YOK) burada elle eklenir ki
 * `currentTabHostname` cozulebilsin. `dapps` zaten baglanmis bir dapp'i temsil eder.
 */
function setup(chainRecord, { hostname = 'example.com', dapps = {}, ton_dapps = {}, solana_dapps = {}, activeAccount, sendMessageImpl } = {}) {
    // Stub ONCE (networkStore()'dan) once kurulur: store olusunca fire-and-forget
    // baslattigi initializeCurrentNetwork() `chrome.storage`i hemen okumaya calisir --
    // stub yoksa bu bir ReferenceError (yakalanip loglanir, zararsiz ama gurultulu).
    const stub = installChromeStub({
        currentNetwork: chainRecord,
        active_account: activeAccount || { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1', type: 'hd' },
        user: { username: 'tester' },
        vaults: [],
        dapps,
        ton_dapps,
        solana_dapps,
    })
    globalThis.chrome.tabs = { query: async () => [{ url: `https://${hostname}` }] }
    if (sendMessageImpl) stub.setSendMessage(sendMessageImpl)

    const app = createApp(Header, { props: { dappMode: false } })
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord

    return { app, network, stub }
}

describe('Header.vue (SSR) -- ATS hapi Solana da GORUNMEZ (Task 15)', () => {
    it('EVM aktifken ATS yakit hapi GORUNUR', async () => {
        const { app } = setup(ETH_CHAIN)
        const captured = captureInstance(app, 'Header')
        const html = await render(app)

        expect(html).toContain('ats.png')
        expect(captured.instance.setupState.features.ats).toBe(true)
    })

    it('Solana aktifken ATS yakit hapi GORUNMEZ', async () => {
        const { app } = setup(SOLANA_CHAIN)
        const captured = captureInstance(app, 'Header')
        const html = await render(app)

        expect(html).not.toContain('ats.png')
        expect(captured.instance.setupState.features.ats).toBe(false)
    })
})

describe('Header.vue (SSR) -- dapp baglanti girisi Solana da GORUNMEZ (Task 15)', () => {
    it('EVM aktifken baglanti dugmesi GORUNUR (title: hostname + baglanti durumu)', async () => {
        const { app } = setup(ETH_CHAIN, { hostname: 'example.com', dapps: {} })
        const captured = captureInstance(app, 'Header')
        const html = await render(app)

        expect(html).toContain('Not Connected')
        expect(captured.instance.setupState.features.dapp).toBe(true)
    })

    it('Solana aktifken baglanti dugmesi GORUNMEZ (currentTabHostname cozulse bile)', async () => {
        const { app } = setup(SOLANA_CHAIN, { hostname: 'example.com', dapps: {} })
        const captured = captureInstance(app, 'Header')
        const html = await render(app)

        expect(html).not.toContain('Not Connected')
        expect(captured.instance.setupState.features.dapp).toBe(false)
        // Hostname yine de cozulmus olmali (baska bir kod yolu bunu kullanir);
        // yalniz dugme GIZLI.
        expect(captured.instance.setupState.currentTabHostname).toBe('example.com')
    })
})

// IKINCI (GORUNMEZ) YAN ETKI: loadConnectionState dugme gizli olsa bile HER
// ag degisiminde calisir ve onceden Solana'da NaN'i `allowedChains`'e yaziyordu.
describe('Header.vue (SSR) -- loadConnectionState EVM-disi chainId yi allowedChains e YAZMAZ', () => {
    it('EVM (regresyon): baglanmamis zincir allowedChains e EKLENIR, banner tetiklenir', async () => {
        const dapps = { 'example.com': { accounts: ['0xAbCdEf0000000000000000000000000000000001'], allowedChains: [1] } }
        const { app, stub } = setup(POLYGON_CHAIN, { hostname: 'example.com', dapps })
        const captured = captureInstance(app, 'Header')
        await render(app)

        expect(captured.instance.setupState.editableChains).toEqual([1, 137])
        expect(captured.instance.setupState.dappNetworkActivated).toBe(true)
        expect(stub.localStore.dapps['example.com'].allowedChains).toEqual([1, 137])
    })

    it('Solana: allowedChains DEGISMEZ (NaN yazilmaz), banner tetiklenmez', async () => {
        const dapps = { 'example.com': { accounts: ['0xAbCdEf0000000000000000000000000000000001'], allowedChains: [1, 137] } }
        const { app, stub } = setup(SOLANA_CHAIN, { hostname: 'example.com', dapps })
        const captured = captureInstance(app, 'Header')
        await render(app)

        expect(captured.instance.setupState.editableChains).toEqual([1, 137])
        expect(captured.instance.setupState.editableChains).not.toContain(NaN)
        expect(captured.instance.setupState.dappNetworkActivated).toBe(false)
        // Depoya YAZILMADI: orijinal dizi degismeden kaldi.
        expect(stub.localStore.dapps['example.com'].allowedChains).toEqual([1, 137])
    })
})

// TASK 16b: Header aktif hesabin adresini gosterir; Solana'da bu `solanaAddress`
// olmali, `activeAccount.address` (HER ZAMAN EVM) DEGIL -- aksi halde kopyalama
// dugmesi kullanicinin kontrol ETMEDIGI bir adresi "senin adresin" gibi sunardi.
describe('Header.vue (SSR) -- aktif adres gosterimi Solana da solanaAddress (Task 16b)', () => {
    it('EVM REGRESYONU: EVM aktifken headerAddress activeAccount.address kalir, "EVM" etiketi gorunur', async () => {
        const { app } = setup(ETH_CHAIN)
        const captured = captureInstance(app, 'Header')
        const html = await render(app)

        expect(captured.instance.setupState.headerAddress).toBe('0xAbCdEf0000000000000000000000000000000001')
        expect(html).toContain('EVM')
        expect(html).not.toContain('>Solana<')
    })

    it('Solana: active_account.solanaAddress HAZIRSA dogrudan kullanilir, "Solana" etiketi gorunur', async () => {
        const SOL_ADDR = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        const { app } = setup(SOLANA_CHAIN, {
            activeAccount: { address: '0xAbCdEf0000000000000000000000000000000001', solanaAddress: SOL_ADDR, key: 'acc1' },
        })
        const captured = captureInstance(app, 'Header')
        const html = await render(app)

        expect(captured.instance.setupState.headerAddress).toBe(SOL_ADDR)
        expect(html).toContain(SOL_ADDR.slice(0, 6))
        expect(html).not.toContain('0xAbCdEf0000000000000000000000000000000001')
    })

    it('Solana: solanaAddress YOKSA SOLANA_GET_ADDRESS ile cozulur', async () => {
        const SOL_ADDR = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
        const { app } = setup(SOLANA_CHAIN, {
            activeAccount: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
            sendMessageImpl: async (msg) => (msg?.type === 'SOLANA_GET_ADDRESS' ? { result: { address: SOL_ADDR } } : { error: 'unexpected' }),
        })
        const captured = captureInstance(app, 'Header')
        await render(app)

        expect(captured.instance.setupState.headerAddress).toBe(SOL_ADDR)
    })

    // COZUM BASARISIZ: EVM adresine SESSIZCE DUSMEK, kullaniciya kontrol
    // ETMEDIGI bir adresi kendi adresiymis gibi gosterir. (Ustteki identicon
    // SEED'i kozmetik amacli EVM adresine duser -- bkz. sablondaki yorum --
    // bu yuzden burada KOPYALAMA metnini/degerini kontrol ederiz, TUM html'i
    // degil.)
    it('Solana: cozum basarisiz olursa headerAddress null kalir, EVM adresine DUSULMEZ', async () => {
        const { app } = setup(SOLANA_CHAIN, {
            activeAccount: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
            sendMessageImpl: async () => { throw new Error('kasa kilitli') },
        })
        const captured = captureInstance(app, 'Header')
        const html = await render(app)

        expect(captured.instance.setupState.headerAddress).toBe(null)
        // Kopyalama satiri '...' gosterir (bkz. sablon: `headerAddress ? shortenAddress(...) : '...'`).
        expect(html).toContain('font-mono tracking-wide">...</span>')
        expect(html).not.toContain('AbCdEf0000000000000000000000000000000001<')
    })

    it('hesap degistirilince YENI hesabin Solana adresi cozulur, ESKISI sizmaz', async () => {
        const OLD_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        const NEW_SOL = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
        const newAccount = { address: '0xffffffffffffffffffffffffffffffffffffffff', solanaAddress: NEW_SOL, key: 'acc2', fingerprint: 'fp2' }

        const { app, stub } = setup(SOLANA_CHAIN, {
            activeAccount: { address: '0xAbCdEf0000000000000000000000000000000001', solanaAddress: OLD_SOL, key: 'acc1' },
        })
        stub.localStore.vaults = [{ fingerprint: 'fp2', accounts: [newAccount] }]
        const captured = captureInstance(app, 'Header')
        await render(app)

        expect(captured.instance.setupState.headerAddress).toBe(OLD_SOL)

        await captured.instance.setupState.changeAccount(newAccount)

        expect(captured.instance.setupState.headerAddress).toBe(NEW_SOL)
    })
})

// HESAP DEGISTIRICISI VE ATS YAKIT PILL'I -- HESAP KAPISI (2026-09-05 tasarim
// belgesi, adim 11).
//
// (a) Gunluk hesap degistirici bu drawer'dir. Kullanicinin gordugu tek sey
//     identicon + hesap ADI; ad yeniden adlandirilabilir, yani "TON 1" bir zincir
//     ipucu DEGILDIR. Yanlis hesapla acilan bir ekran, TON hesabinda EVM
//     islemini denemek (ya da tersi) demek.
//
// (b) ATS yakit pill'i `activeAccount.address` ile BSC'ye `token.balanceOf` atiyor.
//     O adres `UQ...` olunca ethers FIRLATIR, useAtsFuel kendi catch'inde YUTAR ve
//     pill sonsuza kadar "—" + bayat-nokta gosterir. Header.vue:139-150 bunu nadir
//     bir durum diye kabul etmisti; manuel TON modelinden sonra bu, TON hesabinin
//     VARSAYILAN durumu. Kapi AGDA degil HESAPTA: kullanicinin 2026-08-27'de
//     verdigi "EVM hesabiyla TON agina bakarken pill gorunsun" karari AYNEN
//     yururlukte (bkz. utils/tonFlowWiring.test.js).
const EVM_SWITCH_ACCOUNT = {
    key: 'k-evm', name: 'Wats 1', type: 'hd', fingerprint: 'F_EVM',
    address: '0xAbCdEf0000000000000000000000000000000001',
}
const TON_SWITCH_ACCOUNT = {
    key: 'k-ton', name: 'TON 1', type: 'ton', fingerprint: 'F_TON',
    address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG',
}

// Drawer `v-if` DEGIL, class ile kayar (Header.vue:414-428): kapaliyken de
// html'e basilir, yani acmadan olculebilir.
//
// Satir, hesap ADININ basildigi `<span ...>AD</span>` ile bulunur; `<button` ile
// bolunur ki rozet YANLIS satirda olsa test kirmizi olsun.
const switcherRow = (html, accountName) =>
    html.split('<button').find((part) => part.includes('>' + accountName + '</span>')) || ''

function setupSwitcher(activeAccount) {
    return setup(ETH_CHAIN, {
        activeAccount,
        dapps: {},
    })
}

describe('Header.vue (SSR) -- hesap degistiricide TON cipi', () => {
    // Kasalar `setup`in varsayilan `vaults: []`ini EZER: degistirici listesini
    // Header onMounted'da kasalarin accounts[] dizilerinden kuruyor (INV-1).
    function withBothAccounts(active) {
        const { app } = setup(ETH_CHAIN, { activeAccount: active })
        globalThis.chrome.storage.local.set({
            vaults: [
                { type: 'hd', fingerprint: 'F_EVM', accounts: [EVM_SWITCH_ACCOUNT] },
                { type: 'tonMnemonic', fingerprint: 'F_TON', accounts: [TON_SWITCH_ACCOUNT] },
            ],
        })
        return app
    }

    it('TON hesabinin satiri TON cipi tasir', async () => {
        const html = await render(withBothAccounts(EVM_SWITCH_ACCOUNT))
        expect(switcherRow(html, 'TON 1')).toContain('>TON</span>')
    })

    // Cip YALNIZCA TON satirinda. Capraz iddia olmadan "her satira cip bas"
    // uygulamasi da yesil kalirdi ve EVM hesabi TON gibi gorunurdu.
    it('EVM hesabinin satiri TON cipi TASIMAZ', async () => {
        const html = await render(withBothAccounts(EVM_SWITCH_ACCOUNT))
        // POZITIF BEKCI: switcherRow bos dize dondururse (satir hic bulunamazsa)
        // asagidaki `not.toContain` iddiasi BOS uzerinde HALA gecerdi -- satirin
        // gercekten var olup cipsiz kaldigini degil, sadece bulunamadigini olcerdi.
        const row = switcherRow(html, 'Wats 1')
        expect(row).not.toBe('')
        expect(row).not.toContain('>TON</span>')
    })
})

// ADRES ACILIR LISTESI (Header.vue:65-95). Drawer gibi bu da `v-show` ile
// gizlenir, yani acmadan olculebilir.
//
// Satirlar `<button` ile bolunur ve KOPYALAMA sinifiyla (`group/copy`) suzulur:
// hesap degistirici cipi de `>TON</span>` basiyor (yukaridaki describe), yani
// suzgecsiz bir iddia YANLIS yuzeyde karsilanabilirdi.
//
// `</button>` KESIMI SART: onsuz SON satirin parcasi belgenin SONUNA kadar uzar ve
// asagidaki hesap degistirici drawer'ini (`>TON</span>` basan oteki yuzey) de
// icine alirdi -- suzgec kagit uzerinde kapsamli, olcumde kapsamsiz olurdu.
const addressRows = (html) =>
    html.split('<button')
        .map((part) => part.split('</button>')[0])
        .filter((part) => part.includes('group/copy'))
const tonAddressRow = (html) => addressRows(html).find((part) => part.includes('>TON</span>')) || ''

// `baseAddressRows`taki `tonSupported: accountHasTon(activeAccount)` (Header.vue:621).
//
// Bu bayrak fix dalgasinda eklendi ama HIC test edilmiyordu: satiri silmek
// `buildAddressRows`un fail-closed varsayilanina (`tonSupported = false`) duserdi
// ve TON hesabi KENDI adresini goremezdi -- 4669 testin hepsi yesil kalarak.
// Asagidaki iki test bayragi IKI YONDEN birden kilitler.
//
// IKINCI testin fixture'i GUNCELLENDI (2026-09-10 tek-seed-cok-zincir, Gorev 6):
// bu describe yazildiginda `type:'hd'` hesabin TON'u YOKTU. accountKind.js
// kumeye gectiginden beri (Gorev 5) HER `type:'hd'` hesabin ANA SEED'DEN
// turetilen KENDI TON'u var (accountHasTon('hd') artik HER ZAMAN true, bkz.
// asagidaki "TON aginda HD hesaplar arasi gecis" testinin de dayandigi ayni
// gercek) -- yani `EVM_SWITCH_ACCOUNT` (type:'hd') ile bu satir ARTIK HER ZAMAN
// cizilir, `tonAddress` alani versin ya da vermesin (yalnizca "Preparing
// address..." ile gercek adres arasinda degisir, satirin VARLIGINI etkilemez;
// bkz. Receive.ssr.test.js'teki ayni duzeltme). "TON satiri hic cizilmeyen bir
// hesap" bugun yalnizca ozel-anahtar/ice aktarilmis hesap (`accountHasTon` = false,
// YALNIZ_EVM) -- fixture bunu yansitir.
const PRIVATE_KEY_SWITCH_ACCOUNT = {
    key: 'k-pk', name: 'Wats PK', type: 'privateKey', fingerprint: 'F_PK',
    address: '0xPk00000000000000000000000000000000000001',
}
describe('Header.vue (SSR) -- adres listesindeki TON satiri HESAP kapisindan gecer', () => {
    it('TON hesabinda TON adres satiri VAR', async () => {
        const { app } = setupSwitcher(TON_SWITCH_ACCOUNT)
        const html = await render(app)

        // Satirin ADRESI bu SSR ortaminda bos olabilir (`ensureTonAddress` kasaya
        // iner); olculen sey satirin CIZILMESI, yani `tonSupported`in kendisi.
        expect(tonAddressRow(html)).not.toBe('')
    })

    // CAPRAZ IDDIA: bayragi sabit `true` yapan bir uygulama da yukaridaki testi
    // gecerdi ve her TON'u OLMAYAN hesapta kalici bir "TON -- Hazirlaniyor..."
    // satiri birakirdi (fix dalgasinin kapattigi HAYALET SATIR hatasinin ta
    // kendisi). Ozel anahtar hesabi secildi cunku HD hesabin artik KENDI TON'u
    // var (yukaridaki not) -- "TON'u olmayan hesap" bugun yalnizca budur.
    it('TON u olmayan (ozel anahtar) hesapta TON adres satiri HIC CIZILMEZ', async () => {
        const { app } = setupSwitcher(PRIVATE_KEY_SWITCH_ACCOUNT)
        const html = await render(app)

        // POZITIF BEKCI: liste hic render edilmediyse asagidaki iddia BOS uzerinde
        // de gecerdi -- once EVM satirinin GERCEKTEN durdugu dogrulanir.
        expect(addressRows(html).length).toBeGreaterThan(0)
        expect(tonAddressRow(html)).toBe('')
    })
})

describe('Header.vue (SSR) -- ATS yakit pill i HESAP kapisindan gecer', () => {
    it('EVM hesabinda ATS yakit pill i GORUNUR', async () => {
        const { app } = setupSwitcher(EVM_SWITCH_ACCOUNT)
        const html = await render(app)
        expect(html).toContain('ats.png')
    })

    it('TON hesabinda ATS yakit pill i GORUNMEZ', async () => {
        const { app } = setupSwitcher(TON_SWITCH_ACCOUNT)
        const html = await render(app)
        expect(html).not.toContain('ats.png')
    })
})

// DAVRANISSAL KANIT (2026-09-10, inceleme turu 2, Important 5). Statik
// string-eslesmesi (tonAccountLockWiring.test.js) `evmFallback` dalinin
// DOGRU SEMBOLU cagirdigini kilitliyor ama YANLIS HESAPLA cagirilip
// cagirilmadigini olcmuyor. Bu test GERCEKTEN calistirip olcuyor: eski kod
// (`accountHasEvm(acc) && isTon(...)`) `type:'hd'` hesabin da TUM_AILELER'de
// (dolayisiyla accountHasEvm=true) olmasi yuzunden TON agindayken IKI hd
// hesap arasinda gecis yapan bir kullaniciyi bile zorla Ethereum'a cekerdi --
// bu test o durumu birebir kurup agin TON'da KALDIGINI dogruluyor.
describe('Header.vue (SSR) -- TON aginda HD hesaplar arasi gecis agi ZORLA degistirmez (Important 5)', () => {
    it('TON agindayken baska bir HD hesaba gecmek Ethereum a ZORLAMAZ', async () => {
        const TON_CHAIN = supported_chains.find((c) => Number(c.chainId) === -239)
        const HD_ACCOUNT_A = {
            key: 'hd-a', name: 'Wats 1', type: 'hd', fingerprint: 'F_A',
            address: '0xAaaa000000000000000000000000000000000001',
        }
        const HD_ACCOUNT_B = {
            key: 'hd-b', name: 'Wats 2', type: 'hd', fingerprint: 'F_B',
            address: '0xBbbb000000000000000000000000000000000002',
        }
        const { app, network } = setup(TON_CHAIN, { activeAccount: HD_ACCOUNT_A })
        const captured = captureInstance(app, 'Header')
        await render(app)

        await captured.instance.setupState.changeAccount(HD_ACCOUNT_B)

        // Eski kod bu satirda applyNetworkChange(Ethereum, t)i tetikleyip
        // networku degistirirdi -- burada aynen TON'da KALMASI beklenir.
        expect(network.currentNetwork.chainId).toBe(TON_CHAIN.chainId)
    })
})

// PANELLER ARASI HESAP SENKRONU (final inceleme, I3).
//
// Panel N pencerede acik olabilir ve her biri AYRI bir Vue ornegidir. Kopru
// (utils/uiSync.js) bugune kadar SADECE `user.address`i tasiyordu; Header'in
// gosterdigi ad/avatar/profil ise adresten TUREMEZ ve bu bilesende yalnizca
// `onMounted`ta bir kez doluyordu. Sonuc: B panelinde Home YENI hesabin
// bakiyelerini gosterirken baslik ONCEKI hesabin adinda kaliyordu -- bir
// cuzdanda, harcanan hesaptan BASKA bir hesabi adlandiran bir baslik.
//
// Bu test ZINCIRIN TAMAMINI surer: gercek `chrome.storage.onChanged` olayi ->
// gercek `installUiSync` isleyicisi -> depo -> Header'in bagli oldugu deger.
describe('Header.vue (SSR) -- baska panelde yapilan hesap degisimi basliga ULASIR', () => {
    const A = { address: '0xAaaaAaaa00000000000000000000000000000001', key: 'acc1', name: 'Hesap A', type: 'hd' }
    const B = { address: '0xBbbbBbbb00000000000000000000000000000002', key: 'acc2', name: 'Hesap B', type: 'hd' }

    it('uiSync active_account yazimi Header in hesabini DEGISTIRIR', async () => {
        const { app } = setup(ETH_CHAIN, { activeAccount: A })

        // installChromeStub `storage.onChanged` TANIMLAMAZ; uiSync'in GERCEK
        // dinleyicisini yakalayabilmek icin burada elle eklenir.
        const dinleyiciler = []
        globalThis.chrome.storage.onChanged = {
            addListener: (fn) => dinleyiciler.push(fn),
            removeListener: () => {},
        }
        const durdur = installUiSync({ userStore, networkStore, i18n: createTestI18n() })

        const captured = captureInstance(app, 'Header')
        const html = await render(app)

        // ON KOSUL: baslik GERCEKTEN `activeAccount`a bagli (adi ciziyor).
        expect(html).toContain('Hesap A')
        expect(captured.instance.setupState.activeAccount.key).toBe('acc1')

        // BASKA panel hesabi degistirdi -> depoya yazdi -> olay her baglama gider.
        for (const fn of dinleyiciler) fn({ active_account: { newValue: B, oldValue: A } }, 'local')

        expect(captured.instance.setupState.activeAccount.key).toBe('acc2')
        expect(captured.instance.setupState.activeAccount.name).toBe('Hesap B')
        durdur()
    })

    // Adres de tasinmaya DEVAM etmeli: bu duzeltme onun YERINE degil, YANINA.
    it('adres senkronu bozulmaz', async () => {
        const { app } = setup(ETH_CHAIN, { activeAccount: A })
        const dinleyiciler = []
        globalThis.chrome.storage.onChanged = {
            addListener: (fn) => dinleyiciler.push(fn),
            removeListener: () => {},
        }
        const durdur = installUiSync({ userStore, networkStore, i18n: createTestI18n() })
        await render(app)

        for (const fn of dinleyiciler) fn({ active_account: { newValue: B, oldValue: A } }, 'local')

        expect(userStore().address).toBe(B.address)
        durdur()
    })
})

// M11 -- SEKME DINLEYICILERI ILK HOOK'UN AWAIT ZINCIRINDEN SONRA KAYDEDILIR.
//
// Kapatilan hata: kayit AYRI ve SENKRON bir ikinci `onMounted` hook'undaydi ve
// birinci (async) hook daha `await initPanelWindowId()`i beklerken kosuyordu.
// O aralikta gelen bir sekme aktivasyonu `loadConnectionState`i panel pencere
// kimligi COZULMEDEN tetikler, sorgu "en son odaklanan pencere" yedegine duser
// ve BASKA bir pencerenin sekmesi okunur -- o yolun otomatik-etkinlestirme dali
// `dapps[host].allowedChains`e YAZDIGI icin sonuc yanlis origin'e kalici bir
// izin kaydidir.
//
// Test ilk hook'u ORTASINDA askiya alir (ilk storage okumasi elde tutulur) ve
// o anda dinleyicilerin HENUZ kayitli OLMADIGINI olcer.
describe('Header.vue (SSR) -- sekme dinleyicilerinin kayit ANI', () => {
    it('ilk hook un await zinciri bitmeden dinleyici KAYDEDILMEZ', async () => {
        installChromeStub({
            currentNetwork: ETH_CHAIN,
            active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1', type: 'hd' },
            user: { username: 'tester' },
            vaults: [],
            dapps: {},
        })

        // Hook'un ILK satirindaki okuma ELDE TUTULUR: `active_account` isteyen
        // cagri Header'in kendi acilis okumasidir. Anahtara gore secmek SART --
        // `networkStore()` olusurken fire-and-forget baslayan
        // `initializeCurrentNetwork()` de depoyu okur ve "ilk cagri" o olurdu.
        let serbestBirak
        const bekleme = new Promise((r) => { serbestBirak = r })
        const gercekGet = globalThis.chrome.storage.local.get
        let acilisOkumasiGeldi = false
        globalThis.chrome.storage.local.get = async (keys) => {
            const istenen = Array.isArray(keys) ? keys : [keys]
            if (!acilisOkumasiGeldi && istenen.includes('active_account')) {
                acilisOkumasiGeldi = true
                await bekleme
            }
            return gercekGet(keys)
        }

        const eklenenler = []
        globalThis.chrome.tabs = {
            query: async () => [{ url: 'https://example.com' }],
            onActivated: { addListener: () => eklenenler.push('activated'), removeListener: () => {} },
            onUpdated: { addListener: () => eklenenler.push('updated'), removeListener: () => {} },
        }

        const app = createApp(Header, { props: { dappMode: false } })
        app.use(createTestPinia())
        app.use(createTestI18n())
        networkStore().currentNetwork = ETH_CHAIN

        const renderSozu = render(app)
        await new Promise((r) => setTimeout(r, 0))

        // Hook HENUZ bitmedi: kayit da olmamali.
        expect(acilisOkumasiGeldi).toBe(true)
        expect(eklenenler).toEqual([])

        serbestBirak()
        await renderSozu

        // Zincir bitince kayit YAPILIR.
        expect(eklenenler).toEqual(['activated', 'updated'])
    })
})


/**
 * BASLIKTAKI BAGLANTI KABI UC PROTOKOLU DE GORUR.
 *
 * KOK NEDEN: `isConnected` yalnizca EVM `dapps` kaydini okuyordu. Kullanici bir
 * TON dapp'ine BASARIYLA baglandiginda (oturum `ton_dapps`e yazilir) baslik ayni
 * site icin "Bagli Degil" diyordu -- dapp sayfasi "Connected" derken. Ayni oturum
 * Ayarlar > Dapp'ler ekraninda DOGRU listeleniyordu: iki yuzey celiskili
 * konusuyor ve kullanici bunu "baglanamadim" diye okuyup tekrar tekrar
 * deniyordu. Kesme/izin dugmeleri de `v-if="isConnected"` arkasinda oldugu icin
 * o oturum basliktan YONETILEMIYORDU.
 */
const TON_CHAIN = supported_chains.find((c) => c.chainId === -239)

describe('Header.vue (SSR) -- baglanti kabi TON ve Solana oturumlarini da GORUR', () => {
    const TON_OTURUM = { address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG', accountKey: 'acc1', chain: '-239' }
    const SOLANA_OTURUM = { address: '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK', accountKey: 'acc1' }

    it('EVM aginda TON oturumu olan site BAGLI gorunur', async () => {
        const { app } = setup(ETH_CHAIN, { hostname: 'app.dedust.io', ton_dapps: { 'app.dedust.io': TON_OTURUM } })
        const captured = captureInstance(app, 'Header')
        const html = await render(app)

        expect(captured.instance.setupState.isConnected).toBe(true)
        expect(html).not.toContain('Not Connected')
    })

    it('TON aginda TON oturumu olan site BAGLI gorunur', async () => {
        const { app } = setup(TON_CHAIN, { hostname: 'app.dedust.io', ton_dapps: { 'app.dedust.io': TON_OTURUM } })
        const captured = captureInstance(app, 'Header')
        await render(app)

        expect(captured.instance.setupState.isConnected).toBe(true)
    })

    // Solana oturumlari TAM ORIGIN ile anahtarlanir (K5), hostname ile DEGIL:
    // `https://x.com` ile `http://x.com` ayni yetkiyi paylasmamali.
    it('EVM aginda Solana oturumu olan site BAGLI gorunur (anahtar TAM ORIGIN)', async () => {
        const { app } = setup(ETH_CHAIN, { hostname: 'jup.ag', solana_dapps: { 'https://jup.ag': SOLANA_OTURUM } })
        const captured = captureInstance(app, 'Header')
        await render(app)

        expect(captured.instance.setupState.isConnected).toBe(true)
    })

    it('BASKA origin in Solana oturumu bu siteyi BAGLI gostermez', async () => {
        const { app } = setup(ETH_CHAIN, { hostname: 'jup.ag', solana_dapps: { 'https://baska.example': SOLANA_OTURUM } })
        const captured = captureInstance(app, 'Header')
        await render(app)

        expect(captured.instance.setupState.isConnected).toBe(false)
    })

    it('hicbir oturum yoksa BAGLI DEGIL kalir (regresyon)', async () => {
        const { app } = setup(ETH_CHAIN, { hostname: 'example.com' })
        const captured = captureInstance(app, 'Header')
        const html = await render(app)

        expect(captured.instance.setupState.isConnected).toBe(false)
        expect(html).toContain('Not Connected')
    })

    // IZIN EKRANI EVM'E OZEL: `allowedChains`/`accounts` EIP-1193 kavramlari ve
    // savePermissions yalnizca `dapps` kaydina yazar. Yalnizca TON ile bagli bir
    // sitede o dugmeyi gostermek, hicbir seye dokunmayan bir ayar ekrani acardi.
    it('yalnizca TON ile bagliyken EVM izin dugmesi GORUNMEZ', async () => {
        const { app } = setup(ETH_CHAIN, { hostname: 'app.dedust.io', ton_dapps: { 'app.dedust.io': TON_OTURUM } })
        const captured = captureInstance(app, 'Header')
        await render(app)

        expect(captured.instance.setupState.evmConnected).toBe(false)
    })

    it('EVM ile bagliyken izin dugmesi GORUNUR (regresyon)', async () => {
        const dapps = { 'example.com': { accounts: ['0xAbCdEf0000000000000000000000000000000001'], allowedChains: [1] } }
        const { app } = setup(ETH_CHAIN, { hostname: 'example.com', dapps })
        const captured = captureInstance(app, 'Header')
        await render(app)

        expect(captured.instance.setupState.evmConnected).toBe(true)
    })
})

describe('Header.vue (SSR) -- baglanti kesme UC oturumu da keser', () => {
    const TON_OTURUM = { address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG', accountKey: 'acc1' }
    const SOLANA_OTURUM = { address: '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK', accountKey: 'acc1' }

    // UC AYRI DEPO, UC AYRI MESAJ. `dapps`i silip otekilere dokunmayan eski
    // `disconnectDapp`, TON ile bagli bir sitede HICBIR SEY yapmazdi -- kullanici
    // "kes"e basar, kart "Bagli" kalirdi.
    it('TON ile bagli sitede DISCONNECT_TON_DAPP gider', async () => {
        const gonderilen = []
        const stub = { localStore: null }
        const kurulum = setup(ETH_CHAIN, {
            hostname: 'app.dedust.io',
            ton_dapps: { 'app.dedust.io': TON_OTURUM },
            // Gercek isleyici gibi davranan sahte: kaydi DISKTEN siler.
            // Ekran artik yerel bir tahmini degil DISKI gosterdigi icin
            // (bkz. disconnectDapp'teki not) bu sahtenin de gercege benzemesi
            // SART -- yoksa test kendi uydurdugu iyimserligi olcerdi.
            sendMessageImpl: async (m) => {
                gonderilen.push(m)
                if (m.type === 'DISCONNECT_TON_DAPP') {
                    // YENI NESNE, yerinde `delete` DEGIL: gercek isleyici
                    // `removeTonSession` ile YENI bir harita uretip
                    // `storage.local.set` ile yaziyor (tonConnectAuthz.js).
                    // Yerinde mutasyon gercek Chrome'da da imkansiz -- depo
                    // her okumada yapisal kopya doner.
                    const { [m.hostname]: _, ...kalan } = stub.localStore.ton_dapps
                    stub.localStore.ton_dapps = kalan
                }
                return { success: true }
            },
        })
        const { app } = kurulum
        stub.localStore = kurulum.stub.localStore
        const captured = captureInstance(app, 'Header')
        await render(app)

        await captured.instance.setupState.disconnectDapp()

        expect(gonderilen).toContainEqual({ type: 'DISCONNECT_TON_DAPP', hostname: 'app.dedust.io' })
        expect(captured.instance.setupState.isConnected).toBe(false)
    })

    it('Solana ile bagli sitede DISCONNECT_SOLANA_DAPP TAM ORIGIN ile gider', async () => {
        const gonderilen = []
        const { app } = setup(ETH_CHAIN, {
            hostname: 'jup.ag',
            solana_dapps: { 'https://jup.ag': SOLANA_OTURUM },
            sendMessageImpl: async (m) => { gonderilen.push(m); return {} },
        })
        const captured = captureInstance(app, 'Header')
        await render(app)

        await captured.instance.setupState.disconnectDapp()

        expect(gonderilen).toContainEqual({ type: 'DISCONNECT_SOLANA_DAPP', origin: 'https://jup.ag' })
    })

    // EVM yolu DEGISMEDI: kayit silinir ve DISCONNECT_DAPP gider.
    it('EVM ile bagli sitede eski davranis AYNEN korunur', async () => {
        const gonderilen = []
        const dapps = { 'example.com': { accounts: ['0xAbCdEf0000000000000000000000000000000001'], allowedChains: [1] } }
        const { app, stub } = setup(ETH_CHAIN, {
            hostname: 'example.com',
            dapps,
            sendMessageImpl: async (m) => { gonderilen.push(m); return {} },
        })
        const captured = captureInstance(app, 'Header')
        await render(app)

        await captured.instance.setupState.disconnectDapp()

        expect(stub.localStore.dapps['example.com']).toBeUndefined()
        expect(gonderilen).toContainEqual({ type: 'DISCONNECT_DAPP', hostname: 'example.com' })
        // TON/Solana oturumu YOKKEN o mesajlar GONDERILMEZ: yoktan bir
        // baglantiyi kesmeye calismak, arka planda gereksiz bir yazma turu ve
        // tam o sirada onay ekranindan gelen bir oturumu ezme riski.
        expect(gonderilen.find((m) => m.type === 'DISCONNECT_TON_DAPP')).toBeUndefined()
        expect(gonderilen.find((m) => m.type === 'DISCONNECT_SOLANA_DAPP')).toBeUndefined()
    })
})


/**
 * INCELEME TURU 2 -- "uc protokolu de kes" vaadinin GERCEKTEN olculmesi.
 *
 * Onceki tur uc testi de TEK protokolle kurmustu (yalniz ton_dapps, yalniz
 * solana_dapps, yalniz dapps). Ozelligin ASIL iddiasi -- ucu AYNI ANDA bagliysa
 * ucunun de kesilmesi -- hicbir yerde olculmuyordu: govdedeki uc bagimsiz `if`i
 * `if / else if / else if` zincirine cevirmek 31/31 YESIL biraktiriyordu.
 */
describe('Header.vue (SSR) -- ayni site BIRDEN COK protokolle bagliysa', () => {
    const TON_OTURUM = { address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG', accountKey: 'acc1' }
    const SOLANA_OTURUM = { address: '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK', accountKey: 'acc1' }
    const EVM_KAYIT = { accounts: ['0xAbCdEf0000000000000000000000000000000001'], allowedChains: [1] }

    it('EVM + TON + Solana birlikte bagliysa UC mesaj da gider', async () => {
        const gonderilen = []
        const { app, stub } = setup(ETH_CHAIN, {
            hostname: 'jup.ag',
            dapps: { 'jup.ag': EVM_KAYIT },
            ton_dapps: { 'jup.ag': TON_OTURUM },
            solana_dapps: { 'https://jup.ag': SOLANA_OTURUM },
            sendMessageImpl: async (m) => { gonderilen.push(m); return { success: true } },
        })
        const captured = captureInstance(app, 'Header')
        await render(app)

        await captured.instance.setupState.disconnectDapp()

        expect(gonderilen).toContainEqual({ type: 'DISCONNECT_DAPP', hostname: 'jup.ag' })
        expect(gonderilen).toContainEqual({ type: 'DISCONNECT_TON_DAPP', hostname: 'jup.ag' })
        expect(gonderilen).toContainEqual({ type: 'DISCONNECT_SOLANA_DAPP', origin: 'https://jup.ag' })
        expect(stub.localStore.dapps['jup.ag']).toBeUndefined()
    })

    /**
     * YARIS: EVM dali IKI `await` yapar (storage.get + storage.set). Tam o sirada
     * `chrome.tabs.onActivated` ya da ag degisimi `loadConnectionState()`i kosturur
     * ve `currentTabHostname` / `connectedTonDapps` ref'lerinin HEPSINI yeniden
     * yazar. Sonraki dallar kararlarini CANLI computed'lerden turetirse TON/Solana
     * oturumu SESSIZCE ayakta kalir -- kullanici "kestim" sanir, dapp imza istemeye
     * devam edebilir.
     */
    it('EVM await i sirasinda sekme degisse bile TON mesaji YINE gider', async () => {
        const gonderilen = []
        const { app } = setup(ETH_CHAIN, {
            hostname: 'jup.ag',
            dapps: { 'jup.ag': EVM_KAYIT },
            ton_dapps: { 'jup.ag': TON_OTURUM },
            sendMessageImpl: async (m) => { gonderilen.push(m); return { success: true } },
        })
        const captured = captureInstance(app, 'Header')
        await render(app)

        // EVM dalinin ilk await'i sirasinda loadConnectionState kosmus gibi:
        // sekme baska bir siteye gecti ve TON haritasi yeniden yazildi.
        const orijinalGet = globalThis.chrome.storage.local.get
        globalThis.chrome.storage.local.get = async (keys) => {
            const sonuc = await orijinalGet(keys)
            captured.instance.setupState.currentTabHostname = 'baska.example'
            captured.instance.setupState.currentTabOrigin = 'https://baska.example'
            captured.instance.setupState.connectedTonDapps = {}
            return sonuc
        }

        await captured.instance.setupState.disconnectDapp()

        expect(gonderilen).toContainEqual({ type: 'DISCONNECT_TON_DAPP', hostname: 'jup.ag' })
    })
})

/**
 * INCELEME TURU 2 -- kesme BASARISIZ olursa ekran DISKLE ayrismamali.
 *
 * TON/Solana kayitlarini silen TEK yer arka plan isleyicisidir. Cagiran onun
 * basarip basarmadigina BAKMAZSA ve yerel ref'i iyimser temizlerse: disk hala
 * bagli, dapp hala bagli sanir, ama ekran "Bagli Degil" der. Daha kotusu kesme
 * dugmesinin kendisi `v-if="isConnected"` arkasinda oldugu icin EKRANDAN KAYBOLUR
 * ve kullanici basliktan TEKRAR DENEYEMEZ.
 *
 * Kardes bilesen bunu dogru yapiyor (settings/Dapps.vue): yaniti bekler, hatayi
 * uyarir ve HER DURUMDA listeyi diskten YENIDEN OKUR. Burasi o desene esitlenir.
 */
describe('Header.vue (SSR) -- kesme basarisiz olursa ekran DISKI gosterir', () => {
    const TON_OTURUM = { address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG', accountKey: 'acc1' }

    it('arka plan TON oturumunu SILEMEZSE site BAGLI kalir (kullanici tekrar deneyebilir)', async () => {
        const { app } = setup(ETH_CHAIN, {
            hostname: 'app.dedust.io',
            ton_dapps: { 'app.dedust.io': TON_OTURUM },
            // Isleyici hata dondu: disk DEGISMEDI.
            sendMessageImpl: async () => ({ success: false, error: 'yazma hatasi' }),
        })
        const captured = captureInstance(app, 'Header')
        await render(app)

        await captured.instance.setupState.disconnectDapp()

        expect(captured.instance.setupState.isConnected).toBe(true)
    })

    it('arka plan SILERSE site BAGLI DEGIL olur', async () => {
        const { app, stub } = setup(ETH_CHAIN, {
            hostname: 'app.dedust.io',
            ton_dapps: { 'app.dedust.io': TON_OTURUM },
            sendMessageImpl: async () => {
                // Gercek isleyici gibi: diskte YENI bir harita birak
                // (yerinde `delete` gercek depoda mumkun degil).
                const { 'app.dedust.io': _, ...kalan } = stub.localStore.ton_dapps
                stub.localStore.ton_dapps = kalan
                return { success: true }
            },
        })
        const captured = captureInstance(app, 'Header')
        await render(app)

        await captured.instance.setupState.disconnectDapp()

        expect(captured.instance.setupState.isConnected).toBe(false)
    })

    it('sendMessage FIRLATIRSA ekran cokmez ve site BAGLI kalir', async () => {
        const { app } = setup(ETH_CHAIN, {
            hostname: 'app.dedust.io',
            ton_dapps: { 'app.dedust.io': TON_OTURUM },
            sendMessageImpl: async () => { throw new Error('service worker olu') },
        })
        const captured = captureInstance(app, 'Header')
        await render(app)

        await expect(captured.instance.setupState.disconnectDapp()).resolves.toBeUndefined()
        expect(captured.instance.setupState.isConnected).toBe(true)
    })
})

/**
 * INCELEME TURU 2 -- `currentTabOrigin` temizleme yollari SIMETRIK olmali.
 *
 * `solanaConnected` YALNIZCA origin'e bakar. Erken cikis dali ikisini de
 * temizliyordu ama catch dali yalnizca hostname'i temizliyordu: iki degisken
 * ayrisinca baslik "Unknown -- Bagli" gibi imkansiz bir durum gosterebiliyor ve
 * kesme dugmesi olu hale geliyordu (hostname bos oldugu icin disconnectDapp
 * ilk satirda geri donuyor).
 */
describe('Header.vue (SSR) -- sekme cozulemezse IKI anahtar da temizlenir', () => {
    const SOLANA_OTURUM = { address: '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK', accountKey: 'acc1' }

    it('tabs.query FIRLATIRSA currentTabOrigin de bosalir, site BAGLI GORUNMEZ', async () => {
        const { app } = setup(ETH_CHAIN, {
            hostname: 'jup.ag',
            solana_dapps: { 'https://jup.ag': SOLANA_OTURUM },
        })
        const captured = captureInstance(app, 'Header')
        await render(app)
        expect(captured.instance.setupState.isConnected).toBe(true)

        globalThis.chrome.tabs = { query: async () => { throw new Error('sekme erisimi yok') } }
        await captured.instance.setupState.loadConnectionState()

        expect(captured.instance.setupState.currentTabOrigin).toBe('')
        expect(captured.instance.setupState.isConnected).toBe(false)
    })
})

/**
 * INCELEME TURU 2 -- izin KAYDETME kapisi SESSIZCE genisledi.
 *
 * `savePermissions` yalnizca EVM `dapps` kaydina yazar. Kapisi `isConnected`ti ve
 * o kosul bu turda UC protokolu kapsayacak sekilde genisledi: artik yalnizca TON
 * ile bagli bir sitede de govdeye giriliyor. Bugun onu kurtaran tek sey
 * `if (dapps[hostname])` satiri -- yani kaza eseri. Kapi dogru soruyu sormali.
 */
describe('Header.vue (SSR) -- izin kaydetme YALNIZCA EVM oturumunda calisir', () => {
    const TON_OTURUM = { address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG', accountKey: 'acc1' }

    it('yalnizca TON ile bagliyken savePermissions diske YAZMAZ', async () => {
        const yazilanlar = []
        const { app, stub } = setup(ETH_CHAIN, {
            hostname: 'app.dedust.io',
            ton_dapps: { 'app.dedust.io': TON_OTURUM },
        })
        const captured = captureInstance(app, 'Header')
        await render(app)

        const orijinalSet = globalThis.chrome.storage.local.set
        globalThis.chrome.storage.local.set = async (obj) => { yazilanlar.push(obj); return orijinalSet(obj) }

        await captured.instance.setupState.savePermissions()

        // ASIL IDDIA: hicbir yazma OLMADI. (`dapps` anahtari setup tarafindan
        // her zaman `{}` olarak kuruluyor, yani "undefined mi" diye sormak
        // davranisi degil kurulumu olcerdi.)
        expect(yazilanlar).toHaveLength(0)
        expect(stub.localStore.dapps['app.dedust.io']).toBeUndefined()
    })

    it('EVM ile bagliyken savePermissions AYNEN calisir (regresyon)', async () => {
        const dapps = { 'example.com': { accounts: ['0xAbCdEf0000000000000000000000000000000001'], allowedChains: [1] } }
        const { app, stub } = setup(ETH_CHAIN, { hostname: 'example.com', dapps })
        const captured = captureInstance(app, 'Header')
        await render(app)

        captured.instance.setupState.editableChains = [1, 56]
        await captured.instance.setupState.savePermissions()

        expect(stub.localStore.dapps['example.com'].allowedChains).toEqual([1, 56])
    })
})
