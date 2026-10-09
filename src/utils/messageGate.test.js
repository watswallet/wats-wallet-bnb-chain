import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
    INTERNAL_ACTIONS,
    INTERNAL_RESPONSES,
    DAPP_METHODS,
    isInternalAction,
    messageBlockReason,
    isPagePayloadAllowed,
} from './messageGate'

// KRITIK GUVENLIK KAPISI. Kapatilan acik suydu:
//
//   content.js sayfadan gelen mesajin payload'ini OLDUGU GIBI arka plana iletiyordu
//   (tek kontrol `target === 'wats_content_script'`, herhangi bir sayfanin yazabilecegi
//   duz bir metin). Arka plan dagitici `action = message.method || message.type` diyor
//   ve IC aksiyonlar (SIGN, SEND_TRANSACTION, SWAP...) ayni switch'te. Isleyiciler
//   `sender`i parametre olarak aliyor ama HIC KULLANMIYORDU; createWalletInstance ise
//   yalnizca oturum anahtarina bakiyor. Sonuc: cuzdan kilidi acikken, kullanicinin
//   acik tuttugu HERHANGI bir site tek bir postMessage ile keyfi islem imzalatip
//   yayinlayabiliyordu - onay ekrani hic acilmadan.
//
// Bu testler kapinin iki yarisini da kilitler ve en onemlisi, kapinin GELECEKTE
// unutulmasini yakalar (son testteki kaynak taramasi).

const DANGEROUS = [
    'SIGN',
    'SEND_TRANSACTION',
    'SEND_TON_TRANSACTION',
    'SWAP',
    'BRIDGE',
    'UNLOCK_WALLET',
    'ATS_RUN_ONBOARDING',
    // Kasayi acar (createTonKeyPair), TON_FEE_IDENTITY'nin verdiginden fazlasini
    // (raw adres + walletStateInit) doner. DAPP_METHODS'a TASINSA bile buradaki
    // testler kirilir: `it.each([...DAPP_METHODS])` o zaman bu adin sayfadan
    // GECTIGINI ispatlamaya kalkardi -- kasayi acan bir aksiyonu bir web
    // sayfasina teslim eden kapi buradan yakalanir.
    'TON_CONNECT_IDENTITY',
    // Kasayi acar (createTonKeyPair -> tonDappSend), kullanicinin hic gormedigi bir
    // TON islemini imzalayip yayinlar. INTERNAL_ACTIONS/DAPP_METHODS siniflandirma
    // testi (asagida) bir aksiyonun IKI kumeden birinde olmasini yeterli sayiyor --
    // DAPP_METHODS'a KAYARSA o test yesil KALIR. Bu isim burada da (DANGEROUS)
    // bulunmasi, tam da o kaymayi yakalar: DAPP_METHODS'a tasinsaydi asagidaki
    // `it.each([...DAPP_METHODS])` testi (fromWalletUi:false -> GECER bekler) bu
    // satirin ustundeki testle (fromWalletUi:false -> REDDEDILIR bekler) DOGRUDAN
    // CELISIR ve suit kirilir.
    'TON_DAPP_SEND',
    // Ayni gerekce, imzalama tarafi: kasayi acar (createTonKeyPair -> tonDappSign),
    // ton_proof/signData'yi kullanicinin hic gormedigi bir baglamda imzalar.
    'TON_DAPP_SIGN',
    // Keyfi bir hostname alir ve o TON oturumunu siler -- DAPP_METHODS'a
    // KAYSAYDI bir web sayfasi KENDI DISINDAKI origin'lerin TON baglantilarini
    // kesebilirdi. Yukaridaki TON_DAPP_SEND/TON_DAPP_SIGN'daki AYNI gerekce:
    // INTERNAL_ACTIONS/DAPP_METHODS siniflandirma testi bir aksiyonun IKI
    // kumeden birinde olmasini yeterli sayiyor -- DAPP_METHODS'a KAYARSA o test
    // yesil KALIR. Bu isim burada da (DANGEROUS) bulunmasi, tam da o kaymayi
    // yakalar.
    'DISCONNECT_TON_DAPP',
    // TON'un DISCONNECT_TON_DAPP'iyle AYNI gerekce, Solana surumu: keyfi bir TAM
    // ORIGIN alir ve o oturumu siler. DAPP_METHODS'a KAYARSA bir web sayfasi kendi
    // disindaki origin'lerin Solana baglantilarini kesebilirdi. Adin burada da
    // bulunmasi, o kaymayi asagidaki `it.each([...DAPP_METHODS])` testiyle
    // DOGRUDAN CELISKIYE dusurup suiti kirar.
    'DISCONNECT_SOLANA_DAPP',
    // Kasayi ACAR (mnemonic'ten ed25519 turetme) -- TON_CONNECT_IDENTITY'nin
    // birebir karsiligi. Sayfadan gelebilseydi kullanicinin gormedigi bir parola
    // istemi tetiklenirdi.
    'SOLANA_CONNECT_IDENTITY',
    // Kasayi ACAR ve imza uretir (eth_signTypedData_v4 onay ekraninin imzalat
    // aksiyonu, `SIGN`in ikizi). DAPP_METHODS'a KAYSA asagidaki
    // `it.each([...DAPP_METHODS])` testiyle celiskiye duser ve suiti kirar.
    'SIGN_TYPED_DATA_CONFIRM',
]

describe('messageGate — ic aksiyonlar sayfadan gelemez', () => {
    it.each(DANGEROUS)('%s sayfadan gelirse reddedilir', (action) => {
        expect(messageBlockReason(action, { fromWalletUi: false })).toBe('internal-only')
    })

    it.each(DANGEROUS)('%s cuzdan arayuzunden gelirse GECER', (action) => {
        expect(messageBlockReason(action, { fromWalletUi: true })).toBeNull()
    })

    it('para hareketi olmayan ic aksiyonlar da kapali (varsayilan-reddet)', () => {
        for (const action of ['SWAP_QUOTE', 'BRIDGE_QUOTE', 'CHECK_TX_STATUS', 'GASLESS_TOKEN_OPTIONS']) {
            expect(messageBlockReason(action, { fromWalletUi: false })).toBe('internal-only')
        }
    })
})

describe('messageGate — dapp trafigi AYNEN gecer', () => {
    it.each([...DAPP_METHODS])('%s sayfadan gelince gecer', (method) => {
        expect(messageBlockReason(method, { fromWalletUi: false })).toBeNull()
    })

    // Kapi bir IZIN listesi degil, RED listesidir. Yarin eklenecek EIP-1193
    // metotlarinin sessizce olmesi, bu depoda daha once yasanmis bir hata sinifi.
    it('bilinmeyen bir EIP-1193 metodu sayfadan gecer (izin listesi DEGIL)', () => {
        for (const method of ['wallet_switchEthereumChain', 'eth_signTypedData_v4', 'eth_accounts']) {
            expect(isInternalAction(method)).toBe(false)
            expect(messageBlockReason(method, { fromWalletUi: false })).toBeNull()
        }
    })

    it('tanimsiz/bos aksiyon kapiyi tetiklemez — dagitici zaten bilinmeyeni yok sayar', () => {
        for (const action of [undefined, null, '']) {
            expect(messageBlockReason(action, { fromWalletUi: false })).toBeNull()
        }
    })
})

describe('messageGate — popup onay yanitlari da sayfadan gelemez', () => {
    it.each([...INTERNAL_RESPONSES])('%s sayfadan gelirse reddedilir', (action) => {
        expect(messageBlockReason(action, { fromWalletUi: false })).toBe('internal-only')
    })

    it('cuzdan arayuzunden gelirse GECER', () => {
        for (const action of INTERNAL_RESPONSES) {
            expect(messageBlockReason(action, { fromWalletUi: true })).toBeNull()
        }
    })
})

describe('isPagePayloadAllowed — content.js yarisinin kendi freni', () => {
    it('gercek dapp payload i gecer', () => {
        expect(isPagePayloadAllowed({ method: 'eth_chainId', params: [] })).toBe(true)
    })

    it('`type` tasiyan payload iletilmez', () => {
        expect(isPagePayloadAllowed({ type: 'SEND_TRANSACTION', message: {} })).toBe(false)
    })

    // ASIL KACAMAK: dagitici `message.method || message.type` okudugu icin saldirgan
    // ic aksiyon adini `type` yerine `method` alanina koyabilir. Yalnizca "type varsa
    // reddet" demek bu yolu ACIK BIRAKIR.
    it('ic aksiyon adi `method` alanina saklanmis olsa da iletilmez', () => {
        expect(isPagePayloadAllowed({ method: 'SEND_TRANSACTION', params: [] })).toBe(false)
        expect(isPagePayloadAllowed({ method: 'SIGN' })).toBe(false)
    })

    it('bos/bozuk payload iletilmez', () => {
        for (const payload of [null, undefined, 'merhaba', 42, []]) {
            expect(isPagePayloadAllowed(payload)).toBe(false)
        }
    })
})

// Kapinin GELECEKTE unutulmasina karsi tek gercek koruma: yeni bir `type` tabanli
// aksiyon eklenip kapiya yazilmazsa bu test kirilir - kullanici degil, gelistirici
// haberdar olur.
describe('messageGate — background.js ile senkron', () => {
    const source = readFileSync(
        fileURLToPath(new URL('../background.js', import.meta.url)),
        'utf8'
    )
    const cases = [...source.matchAll(/^\s*case\s+['"]([^'"]+)['"]\s*:/gm)].map((m) => m[1])

    it('background.js switch i okunabildi', () => {
        expect(cases.length).toBeGreaterThan(15)
    })

    it('switch teki HER aksiyon ya ic aksiyondur ya bilinen bir dapp metodudur', () => {
        const unclassified = cases.filter(
            (c) => !INTERNAL_ACTIONS.has(c) && !DAPP_METHODS.has(c)
        )
        expect(unclassified).toEqual([])
    })

    it('ic aksiyon listesindeki her ad background.js te gercekten vardir', () => {
        const missing = [...INTERNAL_ACTIONS].filter((a) => !cases.includes(a))
        expect(missing).toEqual([])
    })

    // Onay yanitlari switch'e girmez; dagiticinin basindaki ignoredResponses dizisinde
    // yasarlar. Kume ile dizi ayrisirsa kapi sessizce delinir.
    it('onay yanitlari background.js teki ignoredResponses dizisiyle birebir ayni', () => {
        const block = source.match(/const ignoredResponses = \[([^\]]+)\]/)
        expect(block).not.toBeNull()
        const listed = [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
        expect([...INTERNAL_RESPONSES].sort()).toEqual(listed.sort())
    })
})

// BAGLANTI TESTLERI. Saf kapi dogru calissa bile CAGRILMAZSA acik geri gelir.
// Bu depoda kaynak metni okuyan bu kalip zaten var (swapWiring.test.js).
describe('messageGate — kapi gercekten BAGLI', () => {
    const bg = readFileSync(fileURLToPath(new URL('../background.js', import.meta.url)), 'utf8')
    const content = readFileSync(fileURLToPath(new URL('../content.js', import.meta.url)), 'utf8')

    it('background.js messageBlockReason i import eder', () => {
        expect(bg).toContain("from './utils/messageGate'")
        expect(bg).toContain('messageBlockReason')
    })

    it('kapi switch ten ONCE cagrilir', () => {
        const gateAt = bg.indexOf('messageBlockReason(action')
        const switchAt = bg.indexOf('switch (action)')
        expect(gateAt).toBeGreaterThan(-1)
        expect(switchAt).toBeGreaterThan(-1)
        expect(gateAt).toBeLessThan(switchAt)
    })

    it('kapi ignoredResponses dalindan da ONCE cagrilir', () => {
        const gateAt = bg.indexOf('messageBlockReason(action')
        const ignoredAt = bg.indexOf('const ignoredResponses')
        expect(gateAt).toBeGreaterThan(-1)
        expect(ignoredAt).toBeGreaterThan(-1)
        expect(gateAt).toBeLessThan(ignoredAt)
    })

    it('kapi gonderenin kokenini isWalletUiMessage ile cozer', () => {
        expect(bg).toContain('fromWalletUi: isWalletUiMessage(sender)')
    })

    it('content.js payload i iletmeden ONCE frenden gecirir', () => {
        const guardAt = content.indexOf('isPagePayloadAllowed(event.data.payload)')
        const sendAt = content.indexOf('chrome.runtime.sendMessage')
        expect(guardAt).toBeGreaterThan(-1)
        expect(sendAt).toBeGreaterThan(-1)
        expect(guardAt).toBeLessThan(sendAt)
    })
})

describe('TonConnect metotlari', () => {
    // Kapi bir RED LISTESI: bu adlar zaten gecer. Kume, "arka plandaki her case
    // siniflandirilmis mi" testini besler -- eksik birakilirsa o test kirilir.
    it.each(['tonconnect_connect', 'tonconnect_restore', 'tonconnect_send'])('%s DAPP_METHODS icinde', (ad) => {
        expect(DAPP_METHODS.has(ad)).toBe(true)
    })

    it.each(['tonconnect_connect', 'tonconnect_restore', 'tonconnect_send'])('%s sayfadan gecebilir', (ad) => {
        expect(isPagePayloadAllowed({ method: ad, params: [] })).toBe(true)
    })

    it('ic aksiyon adi tonconnect_send params icine saklanamaz', () => {
        expect(isPagePayloadAllowed({ method: 'SEND_TON_TRANSACTION', params: [] })).toBe(false)
    })
})

describe('Solana dapp metotlari', () => {
    const SOLANA_METOTLARI = [
        'solana_connect',
        'solana_disconnect',
        'solana_signTransaction',
        'solana_signAndSendTransaction',
        'solana_signMessage',
        'solana_signIn',
    ]

    // Kapi bir RED LISTESI: bu adlar zaten geciyordu. Kume "arka plandaki her case
    // siniflandirilmis mi" testini besler. Adlar KUCUK HARF onekli olmak ZORUNDA:
    // INTERNAL_ACTIONS'a yazilmis BUYUK_HARF bir ad sayfadan gelirse kapi
    // 'FORBIDDEN_ORIGIN' DUZ METNINI dondururdu, ki bu bir EIP-1193 sekli degil ve
    // dapp'in saglayicisi onu hic tanimaz.
    it.each(SOLANA_METOTLARI)('%s DAPP_METHODS icinde', (ad) => {
        expect(DAPP_METHODS.has(ad)).toBe(true)
    })

    it.each(SOLANA_METOTLARI)('%s sayfadan gecebilir', (ad) => {
        expect(isInternalAction(ad)).toBe(false)
        expect(isPagePayloadAllowed({ method: ad, params: [] })).toBe(true)
    })

    it('ic Solana aksiyon adlari solana_* kiligina giremez', () => {
        expect(isPagePayloadAllowed({ method: 'SOLANA_CONNECT_IDENTITY', params: [] })).toBe(false)
        expect(isPagePayloadAllowed({ method: 'DISCONNECT_SOLANA_DAPP', origin: 'https://x.example' })).toBe(false)
    })

    // Solana onay ekranlari MEVCUT alti yaniti yeniden kullanir (tasarim belgesi
    // 3.6): yeni bir yanit adi eklenmedigi surece background.js'teki
    // ignoredResponses dizisi ile bu kume ayrisamaz.
    it('INTERNAL_RESPONSES buyumez -- Solana yeni yanit adi getirmez', () => {
        expect([...INTERNAL_RESPONSES].sort()).toEqual([
            'CONNECT_WALLET_REJECTED', 'CONNECT_WALLET_SUCCESS',
            'SEND_TX_REJECTED', 'SEND_TX_SUCCESS',
            'SIGN_MESSAGE_REJECTED', 'SIGN_MESSAGE_SUCCESS',
        ])
    })
})

// ATS SATISI (spec docs/superpowers/specs/2026-10-04-ats-satin-alma-design.md §6.2).
// ATS_SALE_EXECUTE kasayi acip kullanicinin USDT/USDC/BNB'sini harcayan bir op imzalar.
describe('messageGate -- ATS satisi ic aksiyondur', () => {
  it.each(['ATS_SALE_QUOTE', 'ATS_SALE_EXECUTE'])('%s: sayfadan reddedilir, arayuzden gecer', (a) => {
    expect(INTERNAL_ACTIONS.has(a)).toBe(true)
    expect(DAPP_METHODS.has(a)).toBe(false)
    expect(messageBlockReason(a, { fromWalletUi: false })).toBe('internal-only')
    expect(messageBlockReason(a, { fromWalletUi: true })).toBeNull()
    expect(isPagePayloadAllowed({ method: a })).toBe(false)
  })
})

// T14a: eth_signTypedData_v4 (dapp) ve SIGN_TYPED_DATA_CONFIRM (dahili).
//
// messageGate bir KIRMIZI LISTEDIR: sayfa, INTERNAL_ACTIONS'ta OLMAYAN her adi
// cagirabilir. SIGN_TYPED_DATA_CONFIRM kasayi acip imza uretir; listede olmazsa
// bir web sayfasi onay ekranini atlayip imza uretebilirdi. Bu yuzden adi
// background.js'teki `case` ile AYNI commit'te listeye girmek ZORUNDADIR.
describe('messageGate -- eth_signTypedData_v4 ve SIGN_TYPED_DATA_CONFIRM (T14a)', () => {
    it('SIGN_TYPED_DATA_CONFIRM ic aksiyondur, DAPP_METHODS te DEGIL', () => {
        expect(INTERNAL_ACTIONS.has('SIGN_TYPED_DATA_CONFIRM')).toBe(true)
        expect(DAPP_METHODS.has('SIGN_TYPED_DATA_CONFIRM')).toBe(false)
        expect(isInternalAction('SIGN_TYPED_DATA_CONFIRM')).toBe(true)
    })

    it('sayfa payload i olarak iletilmez: ne `type` ne `method` alanindan', () => {
        expect(isPagePayloadAllowed({ method: 'SIGN_TYPED_DATA_CONFIRM' })).toBe(false)
        expect(isPagePayloadAllowed({ method: 'SIGN_TYPED_DATA_CONFIRM', params: [] })).toBe(false)
        expect(isPagePayloadAllowed({ type: 'SIGN_TYPED_DATA_CONFIRM', message: {} })).toBe(false)
    })

    it('sayfadan gelirse internal-only, cuzdan arayuzunden gelirse GECER', () => {
        expect(messageBlockReason('SIGN_TYPED_DATA_CONFIRM', { fromWalletUi: false })).toBe('internal-only')
        expect(messageBlockReason('SIGN_TYPED_DATA_CONFIRM', { fromWalletUi: true })).toBeNull()
    })

    it('eth_signTypedData_v4 DAPP_METHODS icinde, ic aksiyon DEGIL ve sayfadan gecer', () => {
        expect(DAPP_METHODS.has('eth_signTypedData_v4')).toBe(true)
        expect(isInternalAction('eth_signTypedData_v4')).toBe(false)
        expect(messageBlockReason('eth_signTypedData_v4', { fromWalletUi: false })).toBeNull()
        expect(isPagePayloadAllowed({ method: 'eth_signTypedData_v4', params: ['0xabc', '{}'] })).toBe(true)
    })

    it('DAPP_METHODS ile INTERNAL_ACTIONS/INTERNAL_RESPONSES kesisimi BOS', () => {
        const kesisim = [...DAPP_METHODS].filter(
            (ad) => INTERNAL_ACTIONS.has(ad) || INTERNAL_RESPONSES.has(ad)
        )
        expect(kesisim).toEqual([])
    })

    // case ile INTERNAL_ACTIONS girisi AYRI commit'lere dusmesin: bu test ikisini
    // ayni kaynak durumunda ister.
    it('background.js switch inde ikisinin de `case` i var', () => {
        const source = readFileSync(
            fileURLToPath(new URL('../background.js', import.meta.url)),
            'utf8'
        )
        const cases = [...source.matchAll(/^\s*case\s+['"]([^'"]+)['"]\s*:/gm)].map((m) => m[1])
        expect(cases).toContain('eth_signTypedData_v4')
        expect(cases).toContain('SIGN_TYPED_DATA_CONFIRM')
    })
})

// T14b: wallet_getPermissions / wallet_revokePermissions (spec 6 G3).
//
// Ikisi de SAYFADAN gelmek zorunda (wagmi disconnect'te revoke'u cagirir): DAPP_METHODS'a
// girer, INTERNAL_ACTIONS'a DEGIL (oraya yazilan ad sayfadan gelince 4100 alir ve metot hic
// calismaz). `case` ile AYNI commit'te DAPP_METHODS'a girmek ZORUNDADIR (siniflandirma testi).
describe('messageGate -- izin yontemleri (T14b)', () => {
    it.each(['wallet_getPermissions', 'wallet_revokePermissions'])(
        '%s DAPP_METHODS icinde, ic aksiyon DEGIL ve sayfadan gecer',
        (ad) => {
            expect(DAPP_METHODS.has(ad)).toBe(true)
            expect(INTERNAL_ACTIONS.has(ad)).toBe(false)
            expect(isInternalAction(ad)).toBe(false)
            expect(messageBlockReason(ad, { fromWalletUi: false })).toBeNull()
            expect(isPagePayloadAllowed({ method: ad, params: [] })).toBe(true)
        }
    )

    // G3 karari: wagmi requestPermissions hatasini yutup eth_requestAccounts a gecer;
    // baglanma yoluna dokunulmaz. Bu ad default: 4200 yolunda KALIR.
    it('wallet_requestPermissions hicbir kumede YOK (default: 4200)', () => {
        expect(DAPP_METHODS.has('wallet_requestPermissions')).toBe(false)
        expect(INTERNAL_ACTIONS.has('wallet_requestPermissions')).toBe(false)
    })

    it('background.js switch inde iki izin case i var, wallet_requestPermissions case i YOK', () => {
        const source = readFileSync(
            fileURLToPath(new URL('../background.js', import.meta.url)),
            'utf8'
        )
        const cases = [...source.matchAll(/^\s*case\s+['"]([^'"]+)['"]\s*:/gm)].map((m) => m[1])
        expect(cases).toContain('wallet_getPermissions')
        expect(cases).toContain('wallet_revokePermissions')
        expect(cases).not.toContain('wallet_requestPermissions')
    })

    it('DAPP_METHODS ile INTERNAL_ACTIONS/INTERNAL_RESPONSES kesisimi hala BOS', () => {
        const kesisim = [...DAPP_METHODS].filter(
            (ad) => INTERNAL_ACTIONS.has(ad) || INTERNAL_RESPONSES.has(ad)
        )
        expect(kesisim).toEqual([])
    })
})

// T14b: net_version `case`siz kalir (spec 7.3): default: dalinda yerelde cevaplanir. `case` olarak
// eklenirse DAPP_METHODS girisi gerekir ve karar degismis olur; bu test bunu kilitler.
describe('messageGate -- net_version case siz (T14b)', () => {
    it('background.js switch inde net_version case i YOK ve DAPP_METHODS te degil', () => {
        const source = readFileSync(
            fileURLToPath(new URL('../background.js', import.meta.url)),
            'utf8'
        )
        const cases = [...source.matchAll(/^\s*case\s+['"]([^'"]+)['"]\s*:/gm)].map((m) => m[1])
        expect(cases).not.toContain('net_version')
        expect(DAPP_METHODS.has('net_version')).toBe(false)
    })
})
