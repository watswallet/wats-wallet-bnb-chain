// Solana Wallet Standard isteklerinin ARKA PLAN tarafi -- dappFunctions.js ve
// tonDappFunctions.js'in ucuncu kardesi.
//
// Neden ucuncu bagimsiz serit (tasarim belgesi 1.1): TonConnect ile Wallet Standard
// yalnizca ayni BORUYU paylasir (sayfa -> content -> background -> onay penceresi);
// mesaj sekilleri, hata modelleri ve donus tipleri TAMAMEN farklidir. Onay PENCERESI
// yine PAYLASILIR (openApprovalWindow): ikinci bir pencere yoneticisi, EVM/TON/Solana
// isteklerinin birbirinin penceresini kapatmasina ve onRemoved'in YANLIS istegi
// reddetmesine yol acardi.

import { openApprovalWindow, resolveSenderOrigin } from './dappFunctions'
import { grantedSolanaSession, removeSolanaSession, orphanSolanaOrigins } from './solana/solanaConnectAuthz'
import { isSolanaUnsupportedAccount } from './solana/accountSupport'
import { findVaultForAccount } from './deriveAccount'
import { unlockVault } from './crypto-utils'
import { deriveSolanaAddress } from './solana/derive'

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
 * `solana_connect` -- tasarim belgesi 3.3.1'in doruluk tablosu.
 *
 * KAPILARIN HEPSI PENCEREDEN ONCE (4.3.1): pencere acildiktan sonra reddedilen bir
 * istek dapp'in promise'ini SONSUZA KADAR askida birakir. Duz bir "oturum yok -> 4100"
 * listesi burada YANLIS olurdu: connect'e uygulanirsa her ILK baglanti reddedilir ve
 * ozellik hic calismaz -- bu yuzden 2. kapi yalnizca `silent:true` icin gecerlidir.
 */
export async function handleSolanaConnect(message, sender, sendResponse) {
    try {
        const params = message.params?.[0] || {}
        const silent = params.silent === true
        const { origin } = resolveSenderOrigin(sender)

        const { solana_dapps = {}, active_account, vaults = [] } =
            await chrome.storage.local.get(['solana_dapps', 'active_account', 'vaults'])

        const session = grantedSolanaSession(solana_dapps, origin)

        // 3. KAPI. Oturum varsa SABITLENDIGI hesaba (K10), yoksa aktif hesaba bakar.
        // Ekranin "onay dugmesini KALDIR" davranisi buna EK bir savunmadir, tek
        // savunma degil: aksi halde desteklenmeyen hesapta pencere acilir ve
        // "her redde sifir pencere" kurali ihlal edilirdi.
        const account = session ? accountByKey(vaults, session.accountKey) : active_account
        if (isSolanaUnsupportedAccount(account)) {
            sendResponse(uygulamaHatasi('SOLANA_ACCOUNT_UNSUPPORTED'))
            return
        }

        if (session) {
            // KILIT SORULMAZ: adres ALENI bir veridir ve dapp'ler bunu her sayfa
            // yuklemesinde sessizce sorar. Kilit istemek her Solana dapp'ini
            // acilista parola ekranina dusururdu -- ve 7.4 geregi sayfa zaten bir
            // kasa acma istemini TETIKLEYEMEZ.
            sendResponse({
                result: {
                    address: session.address,
                    publicKey: hexToBase64(session.publicKey),
                    accountKey: session.accountKey,
                },
            })
            return
        }

        // 2. KAPI, YALNIZ `silent:true`: sessiz yeniden baglanma tanim geregi
        // pencere acmaz. `silent:false` ise kullaniciya sorma HAKKIdir.
        if (silent) {
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
            accountKey: active_account?.key ?? null,
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
        // || {}` ile okur (background.js:2241). Duz `message.accountKey` yazilsaydi bu
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
        const mnemonic = await unlockVault(masterKey, vault)
        // Ifade DEGILSE (ornegin eski bir tonMnemonic kaydi ya da ham private key)
        // bip39.mnemonicToSeed SESSIZCE yanlis bir adres uretirdi.
        if (!mnemonic || !mnemonic.includes(' ')) {
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
 * `solana_disconnect`. 4.3.1'in 2. kapisi burada da gecerlidir: hic bagli olmayan
 * bir origin'e sahte bir basari donmek, dapp'e var olmayan bir oturumu kapattigini
 * soylemek olurdu -- Unauthorized ise dogruyu soyler.
 */
export async function handleSolanaDisconnect(message, sender, sendResponse) {
    try {
        const { origin } = resolveSenderOrigin(sender)
        const { solana_dapps = {} } = await chrome.storage.local.get('solana_dapps')

        if (!grantedSolanaSession(solana_dapps, origin)) {
            sendResponse({ error: SOLANA_YETKISIZ })
            return
        }
        // OKU-DEGISTIR-YAZ yalnizca SILINECEK kayit GERCEKTEN VARSA (4.4).
        await chrome.storage.local.set({ solana_dapps: removeSolanaSession(solana_dapps, origin) })
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
        const { solana_dapps = {} } = await chrome.storage.local.get('solana_dapps')
        // Kayip guncelleme korumasi: yaziya hic GEREK yoksa yazma (handleSolanaDisconnect'teki
        // ayni gerekce -- tam o anda inen bir putSolanaSession'i ezmemek icin).
        if (solana_dapps[origin]) {
            await chrome.storage.local.set({ solana_dapps: removeSolanaSession(solana_dapps, origin) })
        }
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
 * DURUST NOT: kardesi disconnectOrphanedTonSessions bugun hicbir cagirandan
 * tetiklenmiyor, cunku bu depoda hesap/kasa SILME akisi YOK. Bunun da durumu ayni:
 * bu fonksiyon da HENUZ hicbir cagirandan tetiklenmiyor -- disa verilip birim
 * testi yazildi, ileride bir hesap silme ekrani eklendiginde DOGRUDAN buraya
 * baglanmasi icin.
 */
export async function disconnectOrphanedSolanaSessions(vaults) {
    try {
        const accountKeys = (vaults || []).flatMap((v) => (v?.accounts || []).map((a) => a?.key)).filter(Boolean)
        const { solana_dapps = {} } = await chrome.storage.local.get('solana_dapps')
        // orphanSolanaOrigins zaten FAIL-OPEN (bos/gecersiz liste -> []), o yuzden
        // burada AYRICA bir bos-liste kontrolu YOK.
        const yetimler = orphanSolanaOrigins(solana_dapps, accountKeys)
        if (!yetimler.length) return

        let sonraki = solana_dapps
        for (const origin of yetimler) {
            sonraki = removeSolanaSession(sonraki, origin)
            await notifySolanaDapp(origin, { event: 'change', payload: { accounts: [] } })
        }
        await chrome.storage.local.set({ solana_dapps: sonraki })
    } catch (e) {
        console.error('disconnectOrphanedSolanaSessions error:', e)
    }
}
