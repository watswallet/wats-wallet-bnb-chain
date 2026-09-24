// Solana Wallet Standard isteklerinin ARKA PLAN tarafi -- dappFunctions.js ve
// tonDappFunctions.js'in ucuncu kardesi.
//
// Neden ucuncu bagimsiz serit (tasarim belgesi 1.1): TonConnect ile Wallet Standard
// yalnizca ayni BORUYU paylasir (sayfa -> content -> background -> onay penceresi);
// mesaj sekilleri, hata modelleri ve donus tipleri TAMAMEN farklidir. Onay PENCERESI
// yine PAYLASILIR (openApprovalWindow): ikinci bir pencere yoneticisi, EVM/TON/Solana
// isteklerinin birbirinin penceresini kapatmasina ve onRemoved'in YANLIS istegi
// reddetmesine yol acardi.

import { openApprovalWindow } from './dappFunctions'
import { grantedSolanaSession, putSolanaSession, removeSolanaSession, orphanSolanaOrigins } from './solana/solanaConnectAuthz'
import { isSolanaUnsupportedAccount, assertSolanaDerivable } from './solana/accountSupport'
import { findVaultForAccount } from './deriveAccount'
import { unlockVault } from './crypto-utils'
import { deriveSolanaAddress, deriveSolanaKeypair } from './solana/derive'
import { MAX_MESSAGE_BYTES, MAX_BATCH_TRANSACTIONS, MAX_TX_BASE64_LENGTH, SOLANA_MAINNET_CHAIN } from './solana/walletStandardFeatures'
import { looksLikeTransaction, parseDappTransaction } from './solana/parseDappTransaction'
import { signDappTransaction } from './solana/signDappTransaction'
import { validateSiwsInput, buildSiwsMessage } from './solana/siwsMessage'
import { signMessageBytes } from './solana/signMessage'
import { flattenVaultAccounts } from './knownRecipients'
// Bu dort modul solanaDappFunctions.js'e ILK KEZ burada girer:
import { checkBlockhashFresh } from './solana/blockhashFreshness'
import { broadcastSignedTransaction } from './solana/send'
import { isAmbiguousBroadcastError } from './solana/sendErrors'
import { base58Encode } from './solana/base58'
// Task 38'in satiri GENISLETILIR -- yalnizca ownSignatureBytes eklenir:
import { foreignMissingCosigners, sanitizeSendOptions, ownSignatureBytes } from './solana/signAndSendPolicy'

// Tasarim belgesi 3.6: dapp'e giden hata SEKLI EIP-1193'tur. Uygulama katmani
// kodlari `data.code` icinde tasinir -- sayfa betigi Error'u oradan yeniden kurar
// ve arayuz ayni kodu sendErrors.js uzerinden i18n'e cevirir. Kullaniciya ASLA
// ham kod gosterilmez.
//
// Tasiyici kod -32603: 4001 KULLANILAMAZ -- o "kullanici reddetti" demektir ve
// dapp, kullaniciya HIC gormedigi bir istek icin "reddettiniz" derdi.
//
// BU IKI YARDIMCI BU DOSYADA TEK KEZ, BURADA TANIMLANIR. Ayni dosyaya ekleme
// yapan Gorev 12, 22, 29, 30 ve 38 bunlari OLDUGU GIBI kullanir, YENIDEN
// TANIMLAMAZ. Ikinci bir 4100 zarfi acmak, biri onceden sarilmis biri ciplak
// IKI FARKLI hata sekli demektir ve cagri yerlerinden biri er ya da gec yanlis
// olani sendResponse'a verir. Adlar da bu yuzden sonraki gorevlerin bekledigi
// adlardir.
//
// SEKIL SOZLESMESI: SOLANA_YETKISIZ CIPLAK nesnedir, cagri yerinde
// `sendResponse({ error: SOLANA_YETKISIZ })` diye sarilir; uygulamaHatasi ise
// zarfin TAMAMINI dondurur, `sendResponse(uygulamaHatasi(kod))`.
const SOLANA_YETKISIZ = { code: 4100, message: 'Unauthorized.' }
const uygulamaHatasi = (kod) => ({ error: { code: -32603, message: kod, data: { code: kod } } })

// appMeta SAYFANIN URETTIGI bir tasima alanidir (document.title + link[rel=icon]),
// StandardConnectInput'un parcasi DEGIL. Saldirgan kontrolundedir ve ekranda render
// edilir: sinirsiz uzunluk onay ekraninin kendisini bir DoS yuzeyine cevirir.
const APP_META_NAME_MAX = 64
const APP_META_ICON_MAX = 512

function clampAppMeta(appMeta) {
    if (!appMeta || typeof appMeta !== 'object') return null
    const kirp = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null)
    return { name: kirp(appMeta.name, APP_META_NAME_MAX), icon: kirp(appMeta.icon, APP_META_ICON_MAX) }
}

function accountByKey(vaults, key) {
    if (!Array.isArray(vaults) || !key) return null
    for (const vault of vaults) {
        const bulunan = (vault?.accounts || []).find((a) => a?.key === key)
        if (bulunan) return bulunan
    }
    return null
}

/**
 * Depodaki hex publicKey'i tasimanin base64'une cevirir.
 *
 * NEDEN IKI BICIM: hex YALNIZCA dahili kolayliktir ve sinira ASLA cikmaz (4.4);
 * Wallet Standard sinirinda WalletAccount.publicKey 32 baytlik bir Uint8Array
 * olmali ve sayfa betigi onu import'suz olarak ancak `atob` ile uretebilir.
 */
function hexToBase64(hex) {
    const temiz = typeof hex === 'string' ? hex.replace(/^0x/, '') : ''
    if (!temiz || temiz.length % 2 !== 0) return ''
    let ikili = ''
    for (let i = 0; i < temiz.length; i += 2) ikili += String.fromCharCode(parseInt(temiz.slice(i, i + 2), 16))
    return btoa(ikili)
}

/**
 * Solana serit gonderen kapisi -- nihai inceleme C1.3 (spec K5).
 *
 * content.js <all_urls> uzerinde `all_frames:true` ile calisir ve HER
 * cerceve/semadan gelen `wats_content_script` mesajini oldugu gibi arka
 * plana iletir; solanaInjected.js'in enjeksiyon kapsami (manifest.config.js
 * -- yalnizca https + localhost/127.0.0.1, `all_frames:false`) O KATMANDA
 * uygulanir, BU dagitici katmaninda DEGIL. Bu kapi olmadan bir iframe ya da
 * http sayfasi, adres cubugunda gorunenden FARKLI bir origin adina Solana
 * onay penceresi actirabilir ya da bagli bir origin'in oturumunu okuyabilirdi.
 *
 * FAIL-CLOSED: sender.tab yoksa (ic aksiyon/uzanti sayfasi -- bu alti
 * page-facing handler'a asla mesru sekilde ulasmamali), frameId UST cerceve
 * (0) degilse, origin dizge degilse ya da 'null' ise (sandbox'li cerceve),
 * URL ayrisamiyorsa ya da sema izin listesinde (manifest.config.js'teki
 * `matches` deseniyle AYNI) degilse `null` doner.
 */
function solanaSayfaKapisi(sender) {
    if (!sender?.tab) return null
    if (sender.frameId !== 0) return null
    if (typeof sender.origin !== 'string' || sender.origin === 'null') return null
    let u
    try {
        u = new URL(sender.origin)
    } catch (e) {
        return null
    }
    const izinli = u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))
    if (!izinli) return null
    return { origin: u.origin }
}

/**
 * `solana_connect` -- tasarim belgesi 3.3.1'in doruluk tablosu.
 *
 * KAPILARIN HEPSI PENCEREDEN ONCE (4.3.1): pencere acildiktan sonra reddedilen bir
 * istek dapp'in promise'ini SONSUZA KADAR askida birakir. Duz bir "oturum yok -> 4100"
 * listesi burada YANLIS olurdu: connect'e uygulanirsa her ILK baglanti reddedilir ve
 * ozellik hic calismaz -- bu yuzden 2. kapi yalnizca `silent:true` icin gecerlidir.
 */
export async function handleSolanaConnect(message, sender, sendResponse) {
    try {
        const kapi = solanaSayfaKapisi(sender)
        if (!kapi) { sendResponse({ error: SOLANA_YETKISIZ }); return }
        const { origin } = kapi

        const params = message.params?.[0] || {}
        const silent = params.silent === true

        const { solana_dapps = {}, active_account, vaults = [] } =
            await chrome.storage.local.get(['solana_dapps', 'active_account', 'vaults'])

        const session = grantedSolanaSession(solana_dapps, origin)

        // BAYAT OTURUM = OTURUM YOK (nihai inceleme S-notu, ruling A). Bu
        // origin'in eski accountKey'e SABITLENMIS kaydi (K10) aktif hesap
        // degistiginde artik gecerli bir yetki degildir. Onu "gecerli" sayip
        // eski adresi PENCERE ACILMADAN dondurmek spec 7.3.1 kural 3'u ("dapp
        // yeniden connect cagirmali") pratikte islevsiz birakirdi: dapp
        // connect() cagirir, ESKI adresi hemen alir, sonraki HER imza istegi
        // yine K10'a takilip 4100 doner -- yeniden baglanmasi icin dapp'e
        // hicbir sinyal ULASMAZ.
        const sabitHesap = session ? accountByKey(vaults, session.accountKey) : null
        const bayat = !!session && (!active_account || session.accountKey !== active_account.key || !sabitHesap)

        // 3. KAPI. Oturum GECERLIYSE (bayat DEGILSE) SABITLENDIGI hesaba (K10),
        // aksi halde AKTIF hesaba bakar. Ekranin "onay dugmesini KALDIR"
        // davranisi buna EK bir savunmadir, tek savunma degil: aksi halde
        // desteklenmeyen hesapta pencere acilir ve "her redde sifir pencere"
        // kurali ihlal edilirdi.
        const account = session && !bayat ? sabitHesap : active_account
        if (isSolanaUnsupportedAccount(account)) {
            sendResponse(uygulamaHatasi('SOLANA_ACCOUNT_UNSUPPORTED'))
            return
        }

        if (session && !bayat) {
            // KILIT SORULMAZ: adres ALENI bir veridir ve dapp'ler bunu her sayfa
            // yuklemesinde sessizce sorar. Kilit istemek her Solana dapp'ini
            // acilista parola ekranina dusururdu -- ve 7.4 geregi sayfa zaten bir
            // kasa acma istemini TETIKLEYEMEZ. `accountKey` sinira ARTIK CIKMAZ
            // (C1.5): sayfa dunyasindaki HERHANGI bir betigin okuyabilecegi,
            // capraz-zincir korelasyon icin kullanilabilecek kalici bir
            // tutamac olurdu.
            sendResponse({
                result: {
                    address: session.address,
                    publicKey: hexToBase64(session.publicKey),
                },
            })
            return
        }

        // 2. KAPI: `silent:true` sessiz yeniden baglanma tanim geregi pencere
        // acmaz; aktif hesap YOKSA da onaylatacak kimse yoktur. `silent:false`
        // + aktif hesap VARSA kullaniciya sorma HAKKIdir -- BAYAT bir oturum bu
        // hakki elinden ALMAZ, sadece AKTIF hesap icin YENIDEN sorar.
        if (silent || !active_account) {
            sendResponse({ error: SOLANA_YETKISIZ })
            return
        }

        const requestId = crypto.randomUUID()
        await openApprovalWindow(requestId, sendResponse, {
            type: 'SOLANA_CONNECT',
            // Alan adi `id` -- resolvePendingRequest (dappFunctions.js) bekleyen
            // kaydi `current_request.id` ile esler. `requestId` yazilsaydi MV3
            // yeniden baslatmasindan sonra kayit hicbir zaman temizlenmez ve popup
            // her acilista ayni olu onay ekranina donerdi.
            id: requestId,
            // ORIGIN `sender`DAN, sayfanin verdigi appMeta'dan DEGIL (K5). Wallet
            // Standard'da TonConnect'in manifest belgesi YOKTUR: sayfanin verdigi ad
            // TAMAMEN saldirgan kontrolundedir ve baskin oge olamaz.
            origin,
            favicon: sender.tab?.favIconUrl,
            appMeta: clampAppMeta(params.appMeta),
            // Pencere HER ZAMAN AKTIF hesap icin acilir (bayat bir oturumun
            // eski accountKey'i buraya TASINMAZ); onay tarafi
            // (SolanaConnectApprove.vue putSolanaSession) oturumu bu hesaba
            // YENIDEN yazar.
            accountKey: active_account.key,
        })
    } catch (error) {
        console.error('handleSolanaConnect error:', error)
        sendResponse({ error: { code: -32603, message: 'Internal error' } })
    }
}

/**
 * SOLANA_CONNECT_IDENTITY -- onay ekraninin adres kaynagi. IC AKSIYON.
 *
 * TON_CONNECT_IDENTITY'nin karsiligi: anahtari TURETTIGI icin kilidin ACIK olmasini
 * GEREKTIRIR. Ekran once `account.solanaAddress`e bakar, yoksa buraya duser --
 * ASLA EVM adresine dusulmez (5.1).
 */
export async function handleSolanaConnectIdentity(message, sender, sendResponse) {
    try {
        // IC AKSIYON YUKU NESTED GELIR. Cuzdan arayuzu her ic aksiyonu
        // `chrome.runtime.sendMessage({ type, message: { ... } })` seklinde yollar ve
        // background.js'teki tonConnectIdentity de bunu `const data = message.message
        // || {}` ile okur. Duz `message.accountKey` yazilsaydi bu
        // gorevin testi kendi duz nesnesiyle YESIL kalir, gercek eklentide deger
        // undefined olur, accountByKey isabetsiz kalir ve onay ekrani her acilista
        // NO_ACTIVE_ACCOUNT gorup baglanmayi imkansiz kilardi.
        const { accountKey } = message.message || {}
        const { vaults = [], active_account } = await chrome.storage.local.get(['vaults', 'active_account'])
        const account = accountByKey(vaults, accountKey)
            || (active_account?.key && active_account.key === accountKey ? active_account : null)

        if (!account) {
            sendResponse({ success: false, error: 'NO_ACTIVE_ACCOUNT' })
            return
        }
        // Kural TEK YERDE (accountSupport): secp256k1 sirrindan ed25519 turetilemez.
        if (isSolanaUnsupportedAccount(account)) {
            sendResponse({ success: false, error: 'SOLANA_ACCOUNT_UNSUPPORTED' })
            return
        }
        // Zaten turetilmis: kasayi ACMADAN don (resolveSolanaAddress'teki ayni
        // gerekce) -- aksi halde her onay ekrani acilisi kasa cozumu tetiklerdi.
        if (account.solanaAddress && account.solanaPublicKey) {
            sendResponse({ success: true, address: account.solanaAddress, publicKey: account.solanaPublicKey })
            return
        }

        const { sessionMasterKeyJwk } = await chrome.storage.session.get('sessionMasterKeyJwk')
        if (!sessionMasterKeyJwk) {
            sendResponse({ success: false, error: 'WALLET_LOCKED' })
            return
        }
        const masterKey = await crypto.subtle.importKey(
            'jwk', sessionMasterKeyJwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']
        )
        const vault = findVaultForAccount(vaults, account)
        if (!vault) {
            sendResponse({ success: false, error: 'VAULT_NOT_FOUND' })
            return
        }
        // Kasa TIPI kapisi (accountSupport, spec §8 R1): eski bosluk sezgisi
        // 24 kelimelik TON ifadesini BIP39 sanip GECIRIYORDU.
        // try/catch SIRF yanit kodunu korumak icin: dis catch buraya
        // 'SOLANA_UNSUPPORTED_ACCOUNT' yazardi, oysa onay ekraninin ve
        // sendErrors.js:71'in tanidigi ad 'SOLANA_ACCOUNT_UNSUPPORTED'.
        try {
            assertSolanaDerivable(account, vault)
        } catch {
            sendResponse({ success: false, error: 'SOLANA_ACCOUNT_UNSUPPORTED' })
            return
        }
        const mnemonic = await unlockVault(masterKey, vault)
        if (!mnemonic) {
            sendResponse({ success: false, error: 'SOLANA_ACCOUNT_UNSUPPORTED' })
            return
        }

        const derived = await deriveSolanaAddress(mnemonic, account.index ?? 0)
        sendResponse({ success: true, address: derived.address, publicKey: derived.publicKey })
    } catch (error) {
        console.error('handleSolanaConnectIdentity error:', error)
        sendResponse({ success: false, error: error?.message || 'SOLANA_ACCOUNT_UNSUPPORTED' })
    }
}

/**
 * Cuzdandan sayfaya olay. Sekli notifyTonDapp'in AYNISI, notifyConnectedDapps'inki
 * DEGIL: ikincisi `dapps` kaydini gezip her hostname'e EIP-1193 olayi yayinliyor ve
 * bir Solana oturumu oraya hic girmez.
 *
 * `chrome.tabs.sendMessage(tabId, msg)` frameId VERILMEDEN o sekmenin TUM
 * cercevelerine ulasir. Sekmeleri `tab.url` ile SUZMEK (TON'da kapatilan defekt)
 * burada da yanlis olurdu; hedef ORIGIN mesajin ICINDE tasinir ve hangi cercevenin
 * bunu sayfaya iletecegine content.js kendi `window.location.origin`iyle
 * karsilastirarak karar verir. Origin, hostname DEGIL: yetki kaynagi tam origin'dir
 * (K5), hostname karsilastirmasi http:// serit ile https:// seridi ayni sayardi.
 */
export async function notifySolanaDapp(origin, event) {
    try {
        const tabs = await chrome.tabs.query({})
        for (const tab of tabs) {
            if (tab.id === undefined || tab.id === null) continue
            // Tek bir sekmenin "Receiving end does not exist" hatasi kalan
            // sekmelerin bildirimini KESMEMELI.
            chrome.tabs.sendMessage(tab.id, { target: 'wats_solana_inpage', origin, event }).catch(() => {})
        }
    } catch (e) {
        console.error('notifySolanaDapp error:', e)
    }
}

/**
 * Bir origin'in Solana oturumunu depodan siler -- TAZE bir okuma ile. Yetki
 * denetimi (grantedSolanaSession) icin cagirandan once alinmis olabilecek ESKI
 * bir anlik goruntu BURADA KULLANILMAZ: kayit YOKSA yazmadan false doner, VARSA
 * o anki (bu fonksiyonun kendi okudugu) kopyadan yalnizca o origin dusurulup
 * yazilir. Boylece kesme ile yazim arasinda ARAYA giren baska bir origin'in
 * es zamanli putSolanaSession'i (connect/signIn onayi) EZILMEZ --
 * handleSolanaDisconnect'teki yetki-denetimi okumasi ile silme AYRI okumalardir.
 */
async function oturumuDepodanSil(origin) {
    const { solana_dapps: guncel = {} } = await chrome.storage.local.get('solana_dapps')
    if (!guncel[origin]) return false
    await chrome.storage.local.set({ solana_dapps: removeSolanaSession(guncel, origin) })
    return true
}

/**
 * `solana_disconnect`. 4.3.1'in 2. kapisi burada da gecerlidir: hic bagli olmayan
 * bir origin'e sahte bir basari donmek, dapp'e var olmayan bir oturumu kapattigini
 * soylemek olurdu -- Unauthorized ise dogruyu soyler.
 */
export async function handleSolanaDisconnect(message, sender, sendResponse) {
    try {
        const kapi = solanaSayfaKapisi(sender)
        if (!kapi) { sendResponse({ error: SOLANA_YETKISIZ }); return }
        const { origin } = kapi
        const { solana_dapps = {} } = await chrome.storage.local.get('solana_dapps')

        if (!grantedSolanaSession(solana_dapps, origin)) {
            sendResponse({ error: SOLANA_YETKISIZ })
            return
        }
        // Silme oturumuDepodanSil'in TAZE okumasindan yapilir (yukaridaki
        // anlik goruntu yalnizca yetki denetimi icindir).
        await oturumuDepodanSil(origin)
        sendResponse({ result: {} })
    } catch (error) {
        console.error('handleSolanaDisconnect error:', error)
        sendResponse({ error: { code: -32603, message: 'Internal error' } })
    }
}

/**
 * DISCONNECT_SOLANA_DAPP -- ayarlardaki "Bagli siteler" listesinin kesme dugmesi.
 * IC AKSIYON: keyfi bir origin alir, sayfa asla erisememeli.
 *
 * DISCONNECT_DAPP'ten (EVM) FARKI, DISCONNECT_TON_DAPP'teki ile ayni: silme burada
 * (arka planda) yapilir, cagiran bilesen yalniz listeyi tazeler -- iki yerde silmek,
 * biri basarisiz oldugunda ekranla disk arasinda kalici bir ayrisma birakirdi.
 */
export async function handleDisconnectSolanaDapp(message, sender, sendResponse) {
    try {
        const origin = message.origin
        // Kayip guncelleme korumasi handleSolanaDisconnect ile AYNI yardimcidan
        // gelir: oturumuDepodanSil kaydi yoksa yazmadan doner (tam o anda inen
        // bir putSolanaSession'i ezmemek icin).
        await oturumuDepodanSil(origin)
        // Haber verilmezse dapp bagli oldugunu sanmaya devam eder ve her isteginde
        // 4100 yer -- kullanici bunu "cuzdan bozuk" diye okur. Kayit onceden yoksa
        // bile bildirim ZARARSIZ (idempotent).
        await notifySolanaDapp(origin, { event: 'change', payload: { accounts: [] } })
        sendResponse({ success: true })
    } catch (e) {
        console.error('DISCONNECT_SOLANA_DAPP error:', e)
        sendResponse({ success: false, error: e?.message })
    }
}

/**
 * Bagli hesabi ARTIK VAR OLMAYAN Solana oturumlarini temizler ve dapp'lere haber
 * verir. Oturum `accountKey`e SABITLENDIGI icin (K10) hesap silinince imzalayacak
 * anahtar kalmaz -- oturumu tutmak dapp'e kullanilamayan bir baglanti gostermek olurdu.
 *
 * `vaults` DOGRUDAN parametre: hesap anahtarlarinin TEK gercek kaynagi budur;
 * `active_account` yalniz SECILI hesabi bilir, TUMUNU degil.
 *
 * Tetikleyiciler background.js sweepOrphanedSolanaSessions icindedir (Gorev 56):
 * chrome.runtime.onStartup ve chrome.storage.onChanged (yalnizca `vaults`).
 * Kardes TON supurgesi HALA baglanmamistir (ayri is). Iki okuma arasinda
 * YENI yetim olan bir oturum (kabul edilen sinir) bir sonraki tetiklemeye kalir.
 */
export async function disconnectOrphanedSolanaSessions(vaults) {
    try {
        const accountKeys = (vaults || []).flatMap((v) => (v?.accounts || []).map((a) => a?.key)).filter(Boolean)
        const { solana_dapps = {} } = await chrome.storage.local.get('solana_dapps')
        // orphanSolanaOrigins zaten FAIL-OPEN (bos/gecersiz liste -> []), o yuzden
        // burada AYRICA bir bos-liste kontrolu YOK. Bu ilk hesap yalnizca ERKEN
        // CIKIS icindir (asagida YENIDEN hesaplanir) -- yetim adayi yoksa ikinci
        // okuma/yazim/bildirim hic YAPILMAZ.
        const adaylar = orphanSolanaOrigins(solana_dapps, accountKeys)
        if (!adaylar.length) return

        // Kayip guncelleme penceresini kapatmak icin YENIDEN oku VE yetimligi bu
        // TAZE kopyadan YENIDEN HESAPLA -- yalnizca varlik kontrolu (sonraki[origin])
        // YETMEZ: iki okuma arasinda bir origin silinip GECERLI bir accountKey ile
        // yeniden baglandiysa (es zamanli connect/signIn onayi) o oturum ARTIK
        // yetim degildir ve ilk anlik goruntudeki aday listesiyle silinirse dapp'e
        // yanlislikla "baglanti kesildi" denmis olur.
        const { solana_dapps: guncel = {} } = await chrome.storage.local.get('solana_dapps')
        const yetimler = orphanSolanaOrigins(guncel, accountKeys)

        let sonraki = guncel
        for (const origin of yetimler) sonraki = removeSolanaSession(sonraki, origin)
        // Yazim SADECE gercekten bir sey silinecekse -- yetimler bu arada zaten
        // baska bir akista silinmisse (ya da hic yetim kalmadiysa) gereksiz (ve
        // potansiyel olarak zararli) bir yazim atlanir.
        if (yetimler.length) await chrome.storage.local.set({ solana_dapps: sonraki })
        // Bildirim YAZIMDAN SONRA ve YALNIZCA taze kopyadan GERCEKTEN silinen
        // origin'lere: ilk anlik goruntudeki bir aday, taze kopyada artik yetim
        // degilse (yeniden baglanmis) ya da hic yoksa (baska bir akis sildi)
        // bildirim ALMAZ.
        for (const origin of yetimler) await notifySolanaDapp(origin, { event: 'change', payload: { accounts: [] } })
    } catch (e) {
        console.error('disconnectOrphanedSolanaSessions error:', e)
    }
}

// `SOLANA_YETKISIZ` ve `uygulamaHatasi(kod)` Task 11'de, bu ayni dosyanin
// import blogunun hemen altinda TANIMLANDI -- BURADA YENIDEN TANIMLANMAZ.
// Ikinci bir 4100 zarfi acmak (biri ciplak, digeri onceden `{ error: ... }`
// ile sarilmis) IKI FARKLI hata seklini yan yana yasatir ve cagri
// yerlerinden biri er ya da gec yanlis olani sendResponse'a verir. Sonraki
// gorevler -- M3'un signTransaction seridi ve M4'un signAndSend seridi dahil
// -- ayni iki yardimciyi oldugu gibi kullanir.
//
// SEKIL SOZLESMESI (Task 11'den degismedi): SOLANA_YETKISIZ CIPLAK nesnedir,
// cagri yerinde `sendResponse({ error: SOLANA_YETKISIZ })` diye sarilir;
// uygulamaHatasi ise zarfin TAMAMINI dondurur,
// `sendResponse(uygulamaHatasi(kod))`.

function base64Coz(deger) {
    if (typeof deger !== 'string' || deger === '') return null
    try {
        const bin = atob(deger)
        const out = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
        return out
    } catch (e) {
        return null
    }
}

// Yayilim (spread) burada GUVENLI: bu yolda kodlanan her sey MAX_MESSAGE_BYTES
// (8KB) ile sinirli ya da 64 baytlik bir imza. RangeError riski SAYFA
// betigindedir (orada 8KB'lik parcali kodlayici zorunludur).
const base64Yaz = (bytes) => btoa(String.fromCharCode(...bytes))
const hexYaz = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')

/** §4.3.1 kapi 3 + 4. Ikisi de pencere ACILMADAN. */
function hesapVeClusterKapisi({ account, chain, cluster }) {
    if (!account || isSolanaUnsupportedAccount(account)) return 'SOLANA_ACCOUNT_UNSUPPORTED'
    // Alan yoksa mainnet varsayilir (§3.3): adaptor her zaman gonderir ama
    // gondermeyen bir cagirani sessizce reddetmek mesru akislari kirardi.
    const istenen = chain || SOLANA_MAINNET_CHAIN
    if (istenen !== SOLANA_MAINNET_CHAIN) return 'SOLANA_WRONG_CLUSTER'
    if (cluster && cluster !== istenen) return 'SOLANA_WRONG_CLUSTER'
    return null
}

/** §4.3.1 kapi 5 + 6. */
function mesajYukKapisi(bytes) {
    if (!bytes || bytes.length === 0) return 'TX_DESERIALIZE_FAILED'
    // Sinirsiz mesaj ayni zamanda bir onay ekrani DoS'udur.
    if (bytes.length > MAX_MESSAGE_BYTES) return 'SOLANA_MESSAGE_TOO_LARGE'
    // Solana'nin en bilinen signMessage saldirisi: kullaniciya mesaj susu
    // verilmis bir islemi KOR imzalatmak.
    if (looksLikeTransaction(bytes)) return 'SOLANA_MESSAGE_LOOKS_LIKE_TX'
    return null
}

export function handleSolanaSignMessage(message, sender, sendResponse) {
    ;(async () => {
        try {
            const kapi = solanaSayfaKapisi(sender)
            if (!kapi) { sendResponse({ error: SOLANA_YETKISIZ }); return }
            const { origin } = kapi
            const req = message.params?.[0] || {}
            const { solana_dapps = {}, vaults, active_account } =
                await chrome.storage.local.get(['solana_dapps', 'vaults', 'active_account'])

            // KAPI 2
            const session = grantedSolanaSession(solana_dapps, origin, req.account)
            if (!session) {
                sendResponse({ error: SOLANA_YETKISIZ })
                return
            }

            // KAPI 2 (devami) -- K10 askiya alma. handleSolanaSignTransaction'daki
            // (Task 29) AYNI kural: oturum accountKey'e SABITLENIR; kullanici aktif
            // hesabi degistirdiyse kayit DURUR ama imza istekleri 4100 alir ve
            // dapp'in yeniden `connect` cagirmasi gerekir. Kayit SILINMEZ: kullanici
            // eski hesaba donerse oturum kendiliginden yeniden gecerli olur.
            //
            // Task 55 inceleme turu 1: bu kapi ONCEDEN buraya UYGULANMAMISTI --
            // handleSolanaSignTransaction ve handleSolanaSignAndSend'de VARDI ama
            // handleSolanaSignMessage active_account'u hic okumuyordu; hesap
            // degistikten sonra dapp signMessage penceresini acabiliyor ve ESKI
            // hesap imzalayabiliyordu (spec 4.3.1 kapi 2 ihlali).
            if (!active_account || session.accountKey !== active_account.key) {
                sendResponse({ error: SOLANA_YETKISIZ })
                return
            }

            const account = flattenVaultAccounts(vaults).find((a) => a.key === session.accountKey) || null
            const kod = hesapVeClusterKapisi({ account, chain: req.chain, cluster: session.cluster })
            if (kod) {
                sendResponse(uygulamaHatasi(kod))
                return
            }

            // C1.4 -- RAW base64 uzunlugu, `base64Coz` (atob) COZMEDEN once.
            // `atob` BOSLUK karakterlerini SESSIZCE atar (dogrulandi: node'da
            // 2.000.000 bosluk + 'aGVsbG8=' 5 bayta cozulur), yani yalniz
            // COZULMUS baytlari olcen `mesajYukKapisi` TEK BASINA yetmez --
            // milyonlarca karakterlik ham bir dize, paylasilan MV3 servis
            // calisanina pahali bir atob/decode dongusu, sonra onay ekranina
            // sinirsiz bir govde tasiyabilirdi. Sinir MAX_MESSAGE_BYTES'in
            // (8KB) base64 karsiligidir: `Math.ceil(n/3)*4`.
            if (typeof req.message !== 'string' || req.message.length > Math.ceil(MAX_MESSAGE_BYTES / 3) * 4) {
                sendResponse(uygulamaHatasi('SOLANA_MESSAGE_TOO_LARGE'))
                return
            }
            const yukKodu = mesajYukKapisi(base64Coz(req.message))
            if (yukKodu) {
                sendResponse(uygulamaHatasi(yukKodu))
                return
            }

            const requestId = crypto.randomUUID()
            await openApprovalWindow(requestId, sendResponse, {
                type: 'SOLANA_SIGN_MESSAGE',
                // `id` (requestId DEGIL): resolvePendingRequest diskteki kaydi
                // BU alanla esler, isim degisirse MV3 yeniden baslamasindan
                // sonra kayit hicbir zaman temizlenmez.
                id: requestId,
                origin,
                favicon: sender.tab?.favIconUrl,
                appMeta: session.appMeta,
                accountKey: session.accountKey,
                from: session.address,
                mode: 'message',
                message: req.message,
                // C1.4 -- sinirli alan: sayfanin gonderdigi HERHANGI bir deger
                // ('hex' DISINDA) onay ekraninda 'utf8' GIBI islenirdi; burada
                // ikiye SIKISTIRILIR.
                display: req.display === 'hex' ? 'hex' : 'utf8',
            })
        } catch (e) {
            console.error('handleSolanaSignMessage error:', e)
            sendResponse(uygulamaHatasi('SOLANA_SEND_FAILED'))
        }
    })()
}

export function handleSolanaSignIn(message, sender, sendResponse) {
    ;(async () => {
        try {
            const kapi = solanaSayfaKapisi(sender)
            if (!kapi) { sendResponse({ error: SOLANA_YETKISIZ }); return }
            const { origin } = kapi
            const req = message.params?.[0] || {}
            const input = req.input || {}
            const { solana_dapps = {}, vaults, active_account } = await chrome.storage.local.get(['solana_dapps', 'vaults', 'active_account'])

            // KAPI 2 UYGULANMAZ (§3.4): SIWS connect + signMessage'i TEK adimda
            // yapar ve oturumu OLMAYAN bir origin'den gelir.
            const session = grantedSolanaSession(solana_dapps, origin)

            // KAPI 2 (K10 -- C1.1, nihai inceleme ruling A). Oturum VARSA (dapp
            // daha once connect ile baglanmis) ve aktif hesap o oturumun
            // SABITLENDIGI hesaptan FARKLIYSA, handleSolanaSignMessage'daki AYNI
            // askiya alma burada da gecerlidir: onay tarafindaki kilit
            // (handleSolanaDappSignMessage, asagida) AYNI bayat kaydi
            // karsilastirdigi icin TEK BASINA yeterli DEGILDIR -- pencere
            // ACILMADAN ONCE kesilmesi gerekir. Oturumu OLMAYAN asil spec 3.4 SIWS
            // yolu (`session` burada null) bu kapinin DISINDA kalir: sessionless
            // signIn KAPI 2'YE hic takilmaz, tanim geregi.
            if (session && (!active_account || session.accountKey !== active_account.key)) {
                sendResponse({ error: SOLANA_YETKISIZ })
                return
            }

            const account = session
                ? (flattenVaultAccounts(vaults).find((a) => a.key === session.accountKey) || null)
                : (active_account || null)
            const address = session ? session.address : (active_account?.solanaAddress || '')

            let kod = hesapVeClusterKapisi({ account, chain: req.chain, cluster: session?.cluster })
            // Adres cozulemiyorsa kapi 9'un adres yarisi ZORLANAMAZ: SIWS'in
            // tek garantisi (imza somut bir adrese baglanir) sessizce kaybolur.
            if (!kod && !address) kod = 'SOLANA_ACCOUNT_UNSUPPORTED'
            if (kod) {
                sendResponse(uygulamaHatasi(kod))
                return
            }

            // KAPI 9
            const dogrulama = validateSiwsInput(input, { origin, address })
            if (!dogrulama.ok) {
                sendResponse(uygulamaHatasi(dogrulama.code))
                return
            }

            // Mesaj ARKA PLANDA kurulur (§6.3): sayfanin verdigi ham metin ASLA
            // imzalanmaz, cunku domain'i ezen tek yer burasidir.
            const bytes = new TextEncoder().encode(buildSiwsMessage(dogrulama.input))
            // KAPI 5 + 6, signMessage yolundakinin AYNI zinciri.
            //
            // KAPI 6 BURADA YAPISAL OLARAK TETIKLENEMEZ: govdeyi sayfa degil
            // CUZDAN kuruyor ve metin her zaman "<domain> wants you to sign
            // in..." ile basliyor. Ilk bayt bir host karakteridir (>= 0x2D),
            // looksLikeTransaction'in bekledigi 1-19 imza sayisi araligina
            // hicbir girdiyle dusemez. Yine de kapi burada CAGRILIR: yuk
            // kontrolu TEK yerde kalsin ve govde kurma bicimi ileride
            // degisirse koruma kendiliginden devrede olsun.
            const yukKodu = mesajYukKapisi(bytes)
            if (yukKodu) {
                sendResponse(uygulamaHatasi(yukKodu))
                return
            }

            const requestId = crypto.randomUUID()
            await openApprovalWindow(requestId, sendResponse, {
                type: 'SOLANA_SIGN_MESSAGE',
                id: requestId,
                origin,
                favicon: sender.tab?.favIconUrl,
                // C1.4 -- signIn KAPI 2'yi (spec 3.4) uygulamadigi icin appMeta
                // BAGLANMAMIS bir origin'den de gelebilir; connect (clampAppMeta
                // params.appMeta) gibi burada da SINIRLANIR. Oturum VARSA onun
                // appMeta'si zaten daha once clamp'lenmis olarak kullanilir.
                appMeta: session?.appMeta || clampAppMeta(req.appMeta),
                accountKey: session?.accountKey || active_account?.key,
                from: address,
                mode: 'signIn',
                // Ekran ve imzalayici AYNI baytlari gorur: kayittaki `message`
                // cuzdanin kurdugu govdedir, sayfanin verdigi hicbir sey degil.
                message: base64Yaz(bytes),
                signInInput: dogrulama.input,
            })
        } catch (e) {
            console.error('handleSolanaSignIn error:', e)
            sendResponse(uygulamaHatasi('SOLANA_SEND_FAILED'))
        }
    })()
}

export function handleSolanaDappSignMessage(message, sender, sendResponse) {
    ;(async () => {
        try {
            const { mode, origin, from, accountKey, appMeta, message: messageB64 } = message.message || {}
            const bytes = base64Coz(messageB64)
            if (!bytes) throw new Error('TX_DESERIALIZE_FAILED')

            const { active_account, vaults, solana_dapps = {} } = await chrome.storage.local.get(['active_account', 'vaults', 'solana_dapps'])
            const { sessionMasterKeyJwk } = await chrome.storage.session.get('sessionMasterKeyJwk')
            if (!sessionMasterKeyJwk) throw new Error('WALLET_LOCKED')

            const account = flattenVaultAccounts(vaults).find((a) => a.key === accountKey) || active_account
            if (!account) throw new Error('NO_ACTIVE_ACCOUNT')
            if (isSolanaUnsupportedAccount(account)) throw new Error('SOLANA_UNSUPPORTED_ACCOUNT')

            const masterKey = await crypto.subtle.importKey('jwk', sessionMasterKeyJwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
            const vault = findVaultForAccount(vaults, account)
            if (!vault) throw new Error('VAULT_NOT_FOUND')
            // Kasa TIPI kapisi (accountSupport, spec §8 R1) -- unlockVault'tan ONCE.
            assertSolanaDerivable(account, vault)
            const mnemonic = await unlockVault(masterKey, vault)
            if (!mnemonic) throw new Error('SOLANA_UNSUPPORTED_ACCOUNT')

            const keypair = await deriveSolanaKeypair(mnemonic, account.index ?? 0)
            const address = keypair.publicKey.toBase58()

            // §6.1 IMZALAYICI KILIDI -- IKI karsilastirma. base58 KUCUK HARFE
            // CEVRILMEZ (K8): buyuk/kucuk harf base58'de anlamlidir.
            //
            // BIRINCI kilit FAIL-CLOSED: `from` hem 'message' hem 'signIn' icin
            // pencere ACILMADAN ONCE dolduruluyor (handleSolanaSignMessage
            // session.address'i, handleSolanaSignIn ise bos adresi ayri bir
            // kapiyla ('SOLANA_ACCOUNT_UNSUPPORTED') ELEDIKTEN sonra `address`i
            // yazar) -- yani pencere acildiysa `from` HER ZAMAN doludur. Eksik
            // ya da bos gelmesi (kirik bir cagiran, degistirilmis bir mesaj)
            // GECMEMELI: task-30 incelemesinin bulgusu, `SOLANA_DAPP_SIGN_TX`
            // yanindaki bu kilidin `if (from && ...)` sekliyle FAIL-OPEN
            // kaldigiydi.
            if (!from || from !== address) throw new Error('SOLANA_DAPP_FROM_MISMATCH')
            // IKINCI kilit MOD'A GORE: signMessage icin KAPI 2 zaten bir oturumu
            // ZORUNLU kildigi icin pencere acildiginda solana_dapps[origin] HER
            // ZAMAN vardir -- yoksa (orn. onay ekrani acikken kullanici baglantiyi
            // kesti) reddetmek DOGRUDUR, GECMEK degil. signIn'de ise KAPI 2
            // UYGULANMAZ (§3.4): ilk baglanmada solana_dapps[origin] HENUZ YOK,
            // cunku bu cagrinin kendisi (asagida) o kaydi KURUYOR -- burada
            // fail-closed uygulamak her ilk SIWS girisini kirardi. Kayit ONCEDEN
            // VARSA (dapp'e daha once baglanilmis, simdi FARKLI bir hesapla SIWS
            // deneniyor) o kayitla celisen bir signIn yine reddedilir.
            const kayitliAdres = solana_dapps?.[origin]?.address
            if (mode === 'signIn') {
                if (kayitliAdres && kayitliAdres !== address) throw new Error('SOLANA_DAPP_FROM_MISMATCH')
            } else if (!kayitliAdres || kayitliAdres !== address) {
                throw new Error('SOLANA_DAPP_FROM_MISMATCH')
            }

            const signature = signMessageBytes(bytes, keypair.secretKey)
            const publicKeyBytes = keypair.publicKey.toBytes()

            if (mode === 'signIn') {
                // §3.4: signIn OTURUM DA KURAR. Kayit COZULEN adresle yazilir --
                // ekranin gonderdigi bir dizeyle degil. KAYIP GUNCELLEME
                // KORUMASI: depo imza tamamlandiktan sonra YENIDEN okunur,
                // yukarida okunan kopya bu arada bayatlamis olabilir.
                const { solana_dapps: guncel = {} } = await chrome.storage.local.get('solana_dapps')
                await chrome.storage.local.set({
                    solana_dapps: putSolanaSession(guncel, origin, {
                        address,
                        // hex YALNIZCA dahili kolaylik (§4.4): sinira base64
                        // gider, bu alan ASLA sayfaya cikmaz.
                        publicKey: hexYaz(publicKeyBytes),
                        accountKey: account.key,
                        cluster: SOLANA_MAINNET_CHAIN,
                        // C1.4 -- SAVUNMA DERINLIGI: onay ekrani zaten arka
                        // planin openApprovalWindow'a yazdigi (ONCEDEN
                        // clamp'lenmis) appMeta'yi geri gonderir, ama bu kayit
                        // KALICIDIR (solana_dapps) -- gonderenin gucune BAKMAKSIZIN
                        // 64/512 sinirini burada da zorlamak, ekranin arasina
                        // giren bir hata ya da gelecekteki bir cagiran kalici
                        // depoyu sinirsiz birakamaz.
                        appMeta: clampAppMeta(appMeta) || guncel?.[origin]?.appMeta || null,
                        connectedAt: Date.now(),
                    }),
                })
            }

            sendResponse({
                success: true,
                address,
                // publicKey base64: sayfa betiginde base58 COZUCU YOKTUR (§3.3'un
                // bilincli borcu) -- WalletAccount'un 32 baytlik publicKey'i
                // baska turlu kurulamaz.
                publicKey: base64Yaz(publicKeyBytes),
                signature: base64Yaz(signature),
                signedMessage: messageB64,
            })
        } catch (e) {
            console.error('handleSolanaDappSignMessage error:', e)
            // Ham kod doner; ekran onu resolveSolanaSendError ile cevirir.
            sendResponse({ success: false, error: e?.message || 'SOLANA_SEND_FAILED' })
        }
    })()
}

/**
 * `solana_signTransaction` -- DEGISKEN ARGUMANLI (K2).
 *
 * `solana:signAllTransactions` diye bir ozellik YOKTUR: toplu imzalama tam
 * olarak bu metodun cok girdiyle cagrilmasidir. Ust sinir (20) bir BILDIRIM
 * degil politikadir; gerekcesi onay ekraninda gozden gecirilebilirliktir.
 *
 * §4.3.1'in 2/3/4/5/7. kapilari BURADA, pencere ACILMADAN once calisir.
 * Ekrandaki "onay dugmesini kaldir" davranisi buna EK bir savunmadir, tek
 * savunma degil.
 */
export function handleSolanaSignTransaction(message, sender, sendResponse) {
    // Her govde KENDI try/catch'inde: dagitici `.catch()` KOYMUYOR ve
    // yakalanmayan bir firlatma sendResponse'u hic cagirmaz -- dapp'in
    // promise'i sonsuza dek asili kalir.
    ;(async () => {
        try {
            const kapi = solanaSayfaKapisi(sender)
            if (!kapi) { sendResponse({ error: SOLANA_YETKISIZ }); return }
            const { origin } = kapi
            const request = message.params?.[0] || {}
            const { solana_dapps = {}, active_account } = await chrome.storage.local.get(['solana_dapps', 'active_account'])

            // KAPI 2 -- oturum. `request.account` verilmisse ADRES TAM eslesmeli
            // (grantedSolanaSession base58'i KUCULTMEZ).
            const session = grantedSolanaSession(solana_dapps, origin, request.account)
            if (!session) { sendResponse({ error: SOLANA_YETKISIZ }); return }

            // KAPI 2 (devami) -- K10 askiya alma. Oturum accountKey'e SABITLENIR;
            // kullanici aktif hesabi degistirdiyse kayit DURUR ama imza istekleri
            // 4100 alir ve dapp yeniden `connect` cagirmak zorundadir. Kayit
            // SILINMEZ: kullanici eski hesaba donerse oturum kendiliginden
            // yeniden gecerli olur.
            if (!active_account || session.accountKey !== active_account.key) {
                sendResponse({ error: SOLANA_YETKISIZ })
                return
            }

            // KAPI 3 -- hesap ed25519 uretebiliyor mu.
            if (isSolanaUnsupportedAccount(active_account)) {
                sendResponse(uygulamaHatasi('SOLANA_ACCOUNT_UNSUPPORTED'))
                return
            }

            // KAPI 4 -- cluster. Alan yoksa mainnet varsayilir (§3.3).
            const chain = request.chain || SOLANA_MAINNET_CHAIN
            if (chain !== SOLANA_MAINNET_CHAIN || session.cluster !== SOLANA_MAINNET_CHAIN) {
                sendResponse(uygulamaHatasi('SOLANA_WRONG_CLUSTER'))
                return
            }

            // KAPI 5 -- yuk dogrulama (bicim, sayi, cozulebilirlik).
            const transactions = Array.isArray(request.transactions) ? request.transactions : []
            if (transactions.length === 0) { sendResponse(uygulamaHatasi('TX_DESERIALIZE_FAILED')); return }
            if (transactions.length > MAX_BATCH_TRANSACTIONS) {
                sendResponse(uygulamaHatasi('SOLANA_TOO_MANY_TRANSACTIONS'))
                return
            }
            // KAPI 5 (devami) -- boyut. UCUZ pas: `parseDappTransaction`e (base64
            // regex + Buffer.from tahsisi) girmeden once calisir, aksi halde
            // onaylanmis bir origin paylasilan MV3 service worker'ina keyfi
            // uzunlukta govdeler yollayip her birinde pahali islemi tetikleyebilirdi.
            // `typeof !== 'string'` ONCE kontrol edilir -- KAPI 5'in sayi kontrolundeki
            // ayni tip-karisikligi sinifi: bir nesne/dizi elemani `.length` ile
            // olculse YANLISLIKLA kucuk bir sayi donup gecebilirdi; string OLMAYAN
            // her eleman burada dogrudan FAIL-CLOSED reddedilir.
            if (transactions.some((tx) => typeof tx !== 'string' || tx.length > MAX_TX_BASE64_LENGTH)) {
                sendResponse(uygulamaHatasi('TX_DESERIALIZE_FAILED'))
                return
            }

            let parsedList
            try {
                parsedList = transactions.map((base64) => parseDappTransaction(base64))
            } catch (e) {
                const code = e?.message === 'UNSUPPORTED_TX_VERSION' ? 'UNSUPPORTED_TX_VERSION' : 'TX_DESERIALIZE_FAILED'
                sendResponse(uygulamaHatasi(code))
                return
            }

            // KAPI 7 -- imzaci miyiz. Adres TAM karsilastirilir (K8).
            if (parsedList.some((p) => !p.requiredSigners.includes(session.address))) {
                sendResponse(uygulamaHatasi('SOLANA_NOT_A_SIGNER'))
                return
            }

            const requestId = crypto.randomUUID()
            await openApprovalWindow(requestId, sendResponse, {
                type: 'SOLANA_SIGN_TX',
                // §4.5 alani `requestId` diye adlandiriyor; dappFunctions.js'in
                // resolvePendingRequest'i ise kaydi `id` ile esler. IKISI de
                // yazilir -- yalniz biri yazilirsa ya ekran ya da temizleme
                // yolu kaydi bulamaz.
                requestId,
                id: requestId,
                // ORIGIN `sender`DAN, appMeta'dan DEGIL (K5): sayfanin verdigi
                // ad TAMAMEN saldirgan kontrolundedir ve baskin oge OLAMAZ.
                origin,
                favicon: sender.tab?.favIconUrl,
                appMeta: session.appMeta,
                accountKey: session.accountKey,
                from: session.address,
                // `mode` olmadan ekran ile arka plan anlasamaz: ayni ekran uc
                // ayri semantik islemi topluyor (§4.5).
                mode: transactions.length > 1 ? 'signAll' : 'sign',
                transactions,
                chain,
            })
        } catch (error) {
            console.error('handleSolanaSignTransaction error:', error)
            sendResponse({ error: { code: -32603, message: 'Internal error' } })
        }
    })()
}

/**
 * Iki base64 islem dizisi TAM ayni SIRADA, TAM ayni uzunlukta mi.
 *
 * Task-30 incelemesi Bulgu 2: onay ekrani gorunur hale gelmeden once (Task 31)
 * bile kilit BURAYA baglanir -- `handleSolanaDappSignTx` mesajdaki alanlari
 * OLDUGU GIBI aliyordu, `current_request`i hic okumuyordu. Iki kilit "KIM
 * imzaliyor"u zorluyordu; bu, "NE imzalaniyor"u zorlar.
 */
function ayniTransactionListesi(depodaki, gelen) {
    if (!Array.isArray(depodaki) || !Array.isArray(gelen) || depodaki.length !== gelen.length) return false
    return depodaki.every((b64, i) => b64 === gelen[i])
}

/**
 * Solana onay ekranindan gelen imzalama (§6).
 *
 * Anahtar acma onculu `sendSolanaTransfer` ile AYNI: session masterKey ->
 * importKey -> findVaultForAccount -> unlockVault -> deriveSolanaKeypair.
 * Anahtar hicbir zaman popup'a cikmaz.
 *
 * Hata ham KOD olarak doner (TON'un aksine): Solana tarafinda kod->metin
 * cevirisi ekranda, sendErrors.js tablosuyla yapiliyor (Send.vue ile AYNI
 * desen). Ikinci bir metin uretici yazmak iki sozlugun zamanla ayrismasi
 * demekti.
 */
export async function handleSolanaDappSignTx(message, sender, sendResponse) {
    // signAndSend AYRI bir yol: imzadan sonra YAYIN da yapilir, tazelik
    // kontrolu vardir ve dapp'e imza DIZGESI doner. Ayni govdeye sikistirmak,
    // signTransaction'a (yayini DAPP yapar) sizmamasi gereken kapilari oraya da
    // tasirdi.
    if (message?.mode === 'signAndSend') {
        signAndSendFromApproval(message, sendResponse)
        return
    }
    try {
        const { transactions, origin, from: approvedFrom, account: accountFromUi, requestId } = message.message || {}

        const { sessionMasterKeyJwk } = await chrome.storage.session.get('sessionMasterKeyJwk')
        if (!sessionMasterKeyJwk) throw new Error('WALLET_LOCKED')

        // `resolveAccount` background.js'e OZEL bir yardimcidir ve bu modulden
        // ulasilamaz. handleSolanaConnectIdentity'nin AYNI kalibi kullanilir:
        // hesap onay ekranindan gelir, gelmezse active_account'a dusulur.
        const { vaults = [], solana_dapps = {}, active_account, current_request } = await chrome.storage.local.get(
            ['vaults', 'solana_dapps', 'active_account', 'current_request']
        )

        // ICERIK BAGLAMA KILIDI (task-30 incelemesi Bulgu 2). SS6.1'in iki kilidi
        // yalnizca KIMIN imzaladigini zorluyor; bu ise onay penceresi ACILIRKEN
        // yazilan `current_request` kaydiyla -- yani kullaniciya GERCEKTEN
        // GOSTERILEN istekle -- simdi imzalanacak seyin AYNI oldugunu zorlar.
        // Bugun sayfa buraya ulasamiyor (messageGate + FORBIDDEN_ORIGIN) ve
        // openApprovalWindow zaten eskiyen kaydi ustune yazmadan once pencereyi
        // kapatiyor (dappFunctions.js:57-75) -- ama tasarimin "kullanici
        // GORDUGUNU onaylar" iddiasi, henuz YAZILMAMIS onay ekranindan (Task 31)
        // baska hicbir yere DAYANMAMALI. YENI bir hata kodu ICAT EDILMEZ:
        // SOLANA_DAPP_FROM_MISMATCH "onaylanan sey ile imzalanacak sey AYNI
        // degil" ailesine zaten giriyor.
        //
        // C1.5 -- nihai inceleme: eski kosul `current_request.type`i HIC
        // kontrol etmiyordu ve `requestId` ile `current_request.requestId`
        // IKISI de `undefined` gelince (`!==` esitligi tatmin olur) kilit
        // SESSIZCE gecerdi -- diskte BEKLEYEN HERHANGI bir SOLANA_SIGN_TX
        // disi kaydi (orn. bir SOLANA_SIGN_MESSAGE) bu yolun imzalamasina
        // izin verirdi. `!requestId` ve `type` kontrolleri bu iki bosluk
        // icin FAIL-CLOSED.
        if (
            !current_request ||
            current_request.type !== 'SOLANA_SIGN_TX' ||
            !requestId ||
            current_request.requestId !== requestId ||
            current_request.origin !== origin ||
            !ayniTransactionListesi(current_request.transactions, transactions)
        ) {
            throw new Error('SOLANA_DAPP_FROM_MISMATCH')
        }

        const account = accountFromUi || active_account
        if (!account) throw new Error('NO_ACTIVE_ACCOUNT')
        if (isSolanaUnsupportedAccount(account)) throw new Error('SOLANA_UNSUPPORTED_ACCOUNT')

        const masterKey = await crypto.subtle.importKey(
            'jwk', sessionMasterKeyJwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']
        )

        const targetVault = findVaultForAccount(vaults, account)
        if (!targetVault) throw new Error('VAULT_NOT_FOUND')

        // Kasa TIPI kapisi (accountSupport, spec §8 R1) -- unlockVault'tan ONCE.
        assertSolanaDerivable(account, targetVault)

        const mnemonic = await unlockVault(masterKey, targetVault)
        if (!mnemonic) throw new Error('SOLANA_UNSUPPORTED_ACCOUNT')

        const keypair = await deriveSolanaKeypair(mnemonic, account.index ?? 0)
        const derived = keypair.publicKey.toBase58()

        // §6.1 IMZALAYICI KILIDI -- IKI karsilastirma, IKI ayri soru:
        //   1) Onay ekraninda kullaniciya GOSTERILEN `from` (TON'daki
        //      Address.parse(from).equals(contract.address) kilidinin karsiligi).
        //   2) Yetkinin GERCEK kaynagi olan oturum kaydi.
        // Istek kaydindaki accountKey YALNIZCA kolayliktir; resolveAccount aktif
        // hesaba sessizce duserse imzalayan, kullaniciya gosterilenden BASKA biri
        // olurdu. Karsilastirma TAM: base58 KUCULTULMEZ (K8).
        if (!approvedFrom || derived !== approvedFrom) throw new Error('SOLANA_DAPP_FROM_MISMATCH')
        if (derived !== solana_dapps?.[origin]?.address) throw new Error('SOLANA_DAPP_FROM_MISMATCH')

        const signedTransactions = (transactions || []).map((base64) => {
            const parsed = parseDappTransaction(base64)
            // Kapi 7 BURADA TEKRARLANIR: kapidaki kontrol onaydan ONCE calisti, ama
            // onay penceresi acikken kayit degismis olabilir ve imza atan katman
            // kendi kararini kendi verecek kadar bagimsiz olmali.
            if (!parsed.requiredSigners.includes(derived)) throw new Error('SOLANA_NOT_A_SIGNER')
            // forBroadcast:false -- yayini DAPP yapar (§6.2). true olsaydi eksik
            // ortak imzacili mesru bir islem burada reddedilirdi.
            return signDappTransaction(parsed, keypair, { forBroadcast: false })
        })

        sendResponse({ success: true, signedTransactions })
    } catch (e) {
        console.error('[solana] dapp imzasi basarisiz:', e?.message, e)
        // Hicbir hata FALSY olarak sinir otesine GECEMEZ (SOLANA_SEND'deki AYNI
        // gerekce): bos bir `error` alani cagiranin basari dalina dusmesine yol acar.
        sendResponse({ success: false, error: e?.message || e?.name || 'SOLANA_SEND_FAILED' })
    }
}

// signAndSendTransaction kapilari (§4.3.1). signTransaction'in kapilariyla
// BIREBIR ayni DEGILDIR ve ortak bir fonksiyona alinmadi: 8. kapi (eksik ortak
// imzaci) YALNIZCA burada vardir, cunku yayini BIZ yapariz ve serilestirme
// verifySignatures ACIK calisir (§6.2). Ortaklastirilsaydi, signTransaction'a
// da sizan bir kapi mesru toplu-imza akislarini kirardi.
//
// Hata zarfi icin AYRI bir prose-mesaj tablosu ve sarici YAZILMAZ: dosyanin
// basindaki `uygulamaHatasi(kod)` (satir 43) TEK gercek kaynaktir. Ikinci bir
// zarf, `data.code` ayni kalsa bile `error.message`i method'a gore ayristirir
// -- solanaInjected.js -32603 icin `error.message`e duser, yani ayni
// SOLANA_NOT_A_SIGNER durumu signTransaction'da `Error('SOLANA_NOT_A_SIGNER')`,
// signAndSendTransaction'da BASKA bir dize firlatirdi.
/**
 * `solana_signAndSendTransaction` kapisi.
 *
 * Govde SENKRON: dagitici .catch() KOYMUYOR (sozlesme), bu yuzden butun
 * asenkron is KENDI try/catch'i icindeki bir ic fonksiyona verilir -- disari
 * yakalanmamis hicbir reddedilmis promise sizmaz.
 */
export function handleSolanaSignAndSend(message, sender, sendResponse) {
    gateSolanaSignAndSend(message, sender, sendResponse)
}

async function gateSolanaSignAndSend(message, sender, sendResponse) {
    try {
        const kapi = solanaSayfaKapisi(sender)
        if (!kapi) { sendResponse({ error: SOLANA_YETKISIZ }); return }
        const { origin } = kapi
        const params = message.params?.[0] || {}

        const { solana_dapps = {}, vaults, active_account } =
            await chrome.storage.local.get(['solana_dapps', 'vaults', 'active_account'])

        // KAPI 2 -- yetki. Adres TAM eslesir (K8): grantedSolanaSession
        // toLowerCase YAPMAZ.
        const session = grantedSolanaSession(solana_dapps, origin, params.account)
        if (!session) {
            sendResponse({ error: SOLANA_YETKISIZ })
            return
        }

        // KAPI 2 (devami) -- K10 askiya alma. handleSolanaSignTransaction'daki
        // (Task 29) AYNI kural: oturum accountKey'e SABITLENIR; kullanici aktif
        // hesabi degistirdiyse kayit DURUR ama imza istekleri 4100 alir ve
        // dapp'in yeniden `connect` cagirmasi gerekir. Kayit SILINMEZ: kullanici
        // eski hesaba donerse oturum kendiliginden yeniden gecerli olur.
        if (!active_account || session.accountKey !== active_account.key) {
            sendResponse({ error: SOLANA_YETKISIZ })
            return
        }

        // KAPI 3 -- hesap destegi. `accountByKey` (bu dosyada handleSolanaConnect'in
        // de kullandigi yardimci) VAULTS'TAN TAZE okur -- active_account'un
        // kopyalanmis alanlarina degil: o alanlar bayatlayabilir, vaults tek
        // gercek kaynaktir. Hesap vaults'ta HIC bulunamazsa (bozuk/eksik depo)
        // destek BILINEMEZ ve "destekleniyor" VARSAYILMAZ -- fail-closed.
        const account = accountByKey(vaults, session.accountKey)
        if (!account || isSolanaUnsupportedAccount(account)) {
            sendResponse(uygulamaHatasi('SOLANA_ACCOUNT_UNSUPPORTED'))
            return
        }

        // KAPI 4 -- cluster. Alan yoksa mainnet varsayilir (§3.3): adaptor onu
        // her zaman gonderir, ama legacy serit gondermeyebilir.
        const chain = params.chain || SOLANA_MAINNET_CHAIN
        if (chain !== SOLANA_MAINNET_CHAIN || (session.cluster && chain !== session.cluster)) {
            sendResponse(uygulamaHatasi('SOLANA_WRONG_CLUSTER'))
            return
        }

        // KAPI 5 -- boyut, UCUZ pas. `parseDappTransaction`e (base64 regex +
        // Buffer.from tahsisi) girmeden ONCE calisir, aksi halde onaylanmis bir
        // origin paylasilan MV3 service worker'ina keyfi uzunlukta govdeler
        // yollayip her birinde pahali islemi tetikleyebilirdi.
        // `typeof !== 'string'` ONCE kontrol edilir -- handleSolanaSignTransaction'daki
        // (Task 29) ayni tip-karisikligi sinifi: string OLMAYAN bir deger `.length`
        // ile YANLISLIKLA kucuk bir sayi donup gecebilirdi; burada dogrudan
        // FAIL-CLOSED reddedilir.
        if (typeof params.transaction !== 'string' || params.transaction.length > MAX_TX_BASE64_LENGTH) {
            sendResponse(uygulamaHatasi('TX_DESERIALIZE_FAILED'))
            return
        }

        // KAPI 5 (devami) -- yuk dogrulama (cozulebilirlik). Basarisiz olursa
        // BURADA doner: `parsed` tanimsiz kalirsa asagidaki kapi 8
        // foreignMissingCosigners'i `undefined` ile cagirir ve o fonksiyon BOS
        // dizi doner (fail-OPEN o degenere durum icin) -- pencere SESSIZCE
        // acilirdi. `return` bu yuzden burada ZORUNLU.
        let parsed
        try {
            parsed = parseDappTransaction(params.transaction)
        } catch (e) {
            const kod = e?.message === 'UNSUPPORTED_TX_VERSION' ? 'UNSUPPORTED_TX_VERSION' : 'TX_DESERIALIZE_FAILED'
            sendResponse(uygulamaHatasi(kod))
            return
        }

        // KAPI 7 -- imzaci miyiz. Adres TAM karsilastirilir (K8).
        if (!parsed.requiredSigners.includes(session.address)) {
            sendResponse(uygulamaHatasi('SOLANA_NOT_A_SIGNER'))
            return
        }

        // KAPI 8 -- eksik ortak imzaci. YALNIZCA signAndSend'de (§6.2): yayini
        // BIZ yaptigimiz icin islem TAM IMZALI olmak zorunda; eksik ortak imzaci
        // onaydan SONRA fark edilirse kullanici onayladigi seyin
        // yayinlanamadigini gorur.
        if (foreignMissingCosigners(parsed, session.address).length > 0) {
            sendResponse(uygulamaHatasi('SOLANA_MISSING_COSIGNER'))
            return
        }

        const requestId = crypto.randomUUID()
        await openApprovalWindow(requestId, sendResponse, {
            type: 'SOLANA_SIGN_TX',
            // `requestId` VE `id` IKISI de yazilir -- Task 29'un ayni kalibi:
            // onay ekrani (Task 31/40) `requestId`i okuyup geri gonderir,
            // handleSolanaDappSignTx (Task 30) icerik kilidini `current_request.requestId`
            // ile kurar; resolvePendingRequest (dappFunctions.js, MV3 onRemoved
            // dali) kaydi `id` ile esler. Biri eksik kalirsa ilgili yol kaydi
            // hic bulamaz ve onay fail-closed reddedilir.
            requestId,
            id: requestId,
            // ORIGIN `sender`DAN, sayfanin verdigi appMeta'dan DEGIL (K5).
            origin,
            favicon: sender.tab?.favIconUrl,
            appMeta: session.appMeta,
            accountKey: session.accountKey,
            from: session.address,
            mode: 'signAndSend',
            transactions: [params.transaction],
            chain,
            // Ekranin "durable nonce" rozeti icin (§6.5). Imza anindaki tazelik
            // kontrolu bu alana GUVENMEZ, islemi YENIDEN ayristirir.
            isDurableNonce: parsed.isDurableNonce,
            // Dapp'in HAM opsiyonlari diske HIC yazilmaz (§6.4): kayittaki deger
            // zaten temizlenmis olandir, yayin yolu (Task 39) onu oldugu gibi
            // kullanir.
            options: sanitizeSendOptions(params.options),
        })
    } catch (error) {
        console.error('handleSolanaSignAndSend error:', error)
        sendResponse({ error: { code: -32603, message: 'Internal error' } })
    }
}

/**
 * Onaydan SONRA: imzala, tazeligi olc, yayinla (§6.1, §6.4, §6.5).
 *
 * Butun girdiler DISKTEKI `current_request`ten okunur, gelen mesajdan DEGIL:
 * o kaydi arka plan KENDISI yazdi (gateSolanaSignAndSend). Ekranin gonderdigi
 * alanlara guvenilseydi, kaydi yazan kapi ile imzalayan yol AYRISABILIRDI.
 */
async function signAndSendFromApproval(message, sendResponse) {
    try {
        const { current_request, vaults, active_account, solana_dapps = {} } =
            await chrome.storage.local.get(['current_request', 'vaults', 'active_account', 'solana_dapps'])

        // Kimlik karsilastirmasi KOSULSUZ (Task 30'un :776 kalibi ile AYNI):
        // `message.requestId &&` koruyucusu, requestId'siz gelen bir onay
        // mesajinin bu kontrolu TAMAMEN atlayip diskteki HERHANGI bir
        // signAndSend kaydini imzalayip yayinlamasina izin verirdi (fail-OPEN).
        // `current_request.requestId` okunur, `.id` DEGIL: ikisi de
        // openApprovalWindow'da AYNI UUID'den yazilir (:938-943), ama alan adi
        // simdi kardes kilitle AYNI.
        //
        // F2 (fix turu 1) -- handleSolanaDappSignTx'teki SIGN_TX kilidiyle
        // (C1.5) AYNI simetri: `!message.requestId` olmadan, `requestId` HEM
        // mesajda HEM kayitta `undefined` gelince `!==` esitligi TATMIN OLUP
        // kilit SESSIZCE gecerdi. Bugun sayfa bu yola ULASAMAZ (onay ekrani
        // her zaman requestId gonderir), ama fail-closed simetri korunur.
        if (!current_request || current_request.type !== 'SOLANA_SIGN_TX' || current_request.mode !== 'signAndSend'
            || !message.requestId || current_request.requestId !== message.requestId) {
            sendResponse({ error: 'SOLANA_DAPP_FROM_MISMATCH' })
            return
        }

        const session = grantedSolanaSession(solana_dapps, current_request.origin)
        if (!session) {
            sendResponse({ error: 'SOLANA_DAPP_FROM_MISMATCH' })
            return
        }

        // Anahtar acma oncusu sendSolanaTransfer ile AYNI (§6).
        const { sessionMasterKeyJwk } = await chrome.storage.session.get('sessionMasterKeyJwk')
        if (!sessionMasterKeyJwk) { sendResponse({ error: 'WALLET_LOCKED' }); return }

        const masterKey = await crypto.subtle.importKey(
            'jwk', sessionMasterKeyJwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']
        )

        // accountKey YALNIZCA KOLAYLIKTIR (§6.1): gercek kilit asagidaki adres
        // karsilastirmasidir, bu yuzden bulunamazsa aktif hesaba dusulur.
        const account = (vaults || []).flatMap((v) => v?.accounts || [])
            .find((a) => a?.key === current_request.accountKey) || active_account
        if (!account) { sendResponse({ error: 'NO_ACTIVE_ACCOUNT' }); return }

        const targetVault = findVaultForAccount(vaults, account)
        if (!targetVault) { sendResponse({ error: 'VAULT_NOT_FOUND' }); return }

        // Kasa TIPI kapisi (accountSupport, spec §8 R1). Bu yolda ONCEDEN
        // HICBIR hesap kapisi YOKTU -- isSolanaUnsupportedAccount yalnizca
        // gateSolanaSignAndSend'de, yani pencere ACILMADAN once vardi;
        // kullanici onay ekrani acikken hesap degistirmis olabilir.
        try {
            assertSolanaDerivable(account, targetVault)
        } catch { sendResponse({ error: 'SOLANA_ACCOUNT_UNSUPPORTED' }); return }

        const mnemonic = await unlockVault(masterKey, targetVault)
        if (!mnemonic) { sendResponse({ error: 'SOLANA_ACCOUNT_UNSUPPORTED' }); return }

        const keypair = await deriveSolanaKeypair(mnemonic, account.index ?? 0)
        const from = keypair.publicKey.toBase58()

        // IMZALAYICI KILIDI -- IKI karsilastirma (§6.1). Karsilastirma TAM (K8).
        // Kullanici onay ekrani acikken hesap degistirmis olabilir; o durumda
        // baska bir hesabin fonlari, bu hesap icin onaylandigi sanilan bir
        // isleme harcanirdi.
        if (from !== current_request.from || from !== session.address) {
            sendResponse({ error: 'SOLANA_DAPP_FROM_MISMATCH' })
            return
        }

        let parsed
        try {
            parsed = parseDappTransaction(current_request.transactions?.[0])
        } catch (e) {
            sendResponse({ error: e?.message === 'UNSUPPORTED_TX_VERSION' ? 'UNSUPPORTED_TX_VERSION' : 'TX_DESERIALIZE_FAILED' })
            return
        }

        // Kapi 7/8 IMZA ANINDA TEKRARLANIR: kayit diskte, pencere ise dakikalarca
        // acik kalmis olabilir.
        if (!parsed.requiredSigners.includes(from)) { sendResponse({ error: 'SOLANA_NOT_A_SIGNER' }); return }
        if (foreignMissingCosigners(parsed, from).length > 0) { sendResponse({ error: 'SOLANA_MISSING_COSIGNER' }); return }

        // §6.5 -- YALNIZCA burada. FAIL-OPEN: `fresh:false` yalnizca dugum
        // ACIKCA gecersiz dediginde gelir (bkz. blockhashFreshness.js).
        const tazelik = await checkBlockhashFresh(parsed)
        if (!tazelik.fresh) { sendResponse({ error: tazelik.code || 'SOLANA_BLOCKHASH_EXPIRED' }); return }
        if (tazelik.skipped) console.warn('[solana-dapp] blockhash kontrolu atlandi:', tazelik.skipped)

        // verifySignatures ACIK (§6.2): islem TAM IMZALI ve yayinlanabilir mi,
        // yayindan ONCE ve yerel olarak dogrulanir.
        const serialized = signDappTransaction(parsed, keypair, { forBroadcast: true })

        // IMZA YAYINDAN ONCE (§6.4). Yanit KAYBOLURSA (dugum kabul ETTIKTEN
        // sonra) elimizde kalan tek iz budur; RPC'nin donus degerine guvenmek
        // dapp'i FARKLI imzali ikinci bir gonderime iterdi.
        const sigBytes = ownSignatureBytes(parsed, from)
        if (!sigBytes) { sendResponse({ error: 'SOLANA_SEND_FAILED' }); return }
        const signature = base58Encode(sigBytes)
        const signatureBytes = btoa(String.fromCharCode(...sigBytes))

        // NOT (§2.1): dapp islemleri bu turda GECMISE YAZILMAZ --
        // writeSolanaPendingRecord tek alici / tek tutar varsayiyor, dapp
        // isleminde ikisi de yok. Buraya bir kayit eklemek istenirse once o
        // varsayim kaldirilmali.
        try {
            await broadcastSignedTransaction(serialized, current_request.options)
        } catch (e) {
            const kod = e?.message || e?.name || 'SOLANA_SEND_FAILED'

            // KESIN red (preflight, gecersiz blockhash, 4xx): islem zincire
            // GITMEDI, "tekrar deneyin" DOGRU tavsiyedir.
            if (!isAmbiguousBroadcastError(kod)) { sendResponse({ error: kod }); return }

            // BELIRSIZ (zaman asimi / 5xx): dugum islemi kabul etmis OLABILIR.
            // Hata DEGIL imza donulur -- aksi halde dapp yeniden imzalatir ve
            // ayni islem ikinci kez zincire gidebilir.
            console.warn('[solana-dapp] yayin BELIRSIZ dustu, imza donuluyor:', kod)
            sendResponse({ result: { signature, signatureBytes, broadcastStatusUnknown: true, broadcastError: kod } })
            return
        }

        sendResponse({ result: { signature, signatureBytes } })
    } catch (error) {
        console.error('signAndSendFromApproval error:', error)
        // Hicbir hata FALSY olarak sinir otesine gecemez: bos bir mesaj,
        // ekranin `if (res.error)` dalina hic girmemesine yol acar.
        sendResponse({ error: error?.message || error?.name || 'SOLANA_SEND_FAILED' })
    }
}
