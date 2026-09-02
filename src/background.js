import { ethers, HDNodeWallet, Wallet } from 'ethers'
import { MultiChainSwapManager } from './utils/swap'
import bridgeQuote, { crossChainSwap } from './utils/bridge'
import supported_chains from './data/supported_chains.json'
import { uniqueKey } from './utils/uniqueKey'

import { unlockVault, decryptSecret } from './utils/crypto-utils'
import { handleConnectWallet, handleGetAccounts, handleGetChainId, hexChainIdFor, resolvePendingRequest, sendTxDapp, signMessageDapp } from './utils/dappFunctions'
import { handleTonConnect, handleTonRestore, handleTonSend, notifyTonDapp } from './utils/tonDappFunctions'
import { handleSolanaConnect, handleSolanaConnectIdentity, handleDisconnectSolanaDapp, handleSolanaDisconnect } from './utils/solanaDappFunctions'
import { repairRpcFormat } from './utils/repairNetworkData'
import axios from 'axios'
import {buildPendingSkeleton, saveOrUpdateTxInStorage, watchTransactionResolution} from './utils/processTransaction'
import { executeSponsored, getGasTokenOptions } from './utils/smartAccount'
import { executeAtsTransfer, quoteAtsTransfer, runAtsOnboarding } from './utils/atsPaymaster'
import { toMessageSafe } from './utils/messageSafe'
import { messageBlockReason } from './utils/messageGate'
import { chainSupportsFlow } from './utils/chainKind'
import { isAtsChain, ATS_SRC_CHAIN_ID, getAtsSourceConfig } from './utils/atsConfig'
import { getBundlerToken, clearBundlerTokens } from './utils/bundlerAuth'
import { isGaslessChain } from './utils/gaslessConfig'
import { buildBridgeCalls } from './utils/bridge'
import { normalizePersonalSignMessage } from './utils/signMessage'
import { isStillPending, prunePendingTransactions } from './utils/pendingTransactions'
import { shouldLock, normalizeLockTimer, LOCK_IMMEDIATE } from './utils/lockTimer'
import { POPUP_PORT_NAME } from './utils/popupPort'
import { findVaultForAccount } from './utils/deriveAccount'
import { withStorageList, CURRENT_TRANSACTIONS, PENDING_TRANSACTIONS } from './utils/txStorage'
import { deriveSolanaAddress, deriveSolanaKeypair } from './utils/solana/derive'
import { isSolanaUnsupportedAccount } from './utils/solana/accountSupport'
import { buildTransferPlan } from './utils/solana/buildTransferPlan'
import { prepareTransferContext, broadcastSignedTransaction } from './utils/solana/send'
import { toPublicKey } from './utils/solana/address'
import { base58Encode } from './utils/solana/base58'
import { isAmbiguousBroadcastError } from './utils/solana/sendErrors'
import { solanaRpc } from './utils/solana/client'
import { SOLANA_CHAIN_ID } from './utils/solana/constants'
import { chainVm, isSameChainId, rpcUrlsOf, requireEvmChain, requireEvmVm } from './utils/vm'
import { tonIdentityForAccount } from './utils/ton/tonIdentity'
import { removeTonSession } from './utils/ton/tonConnectAuthz'
import { buildTonTransfer, sendTon, waitForSeqno, walletFromKeyPair } from './utils/ton/tonSend'
import { isJettonWallet, sendJetton } from './utils/ton/jettonSend'
import { getJettonWalletAddress } from './utils/ton/jettonAddress'
import { getJettonBalance } from './utils/ton/jettonBalance'
import { normalizeTonRecipient } from './utils/ton/tonAddress'
import { executeTonViaRelayer, evmVaultResolvable } from './utils/ton/tonFeeRelayer'
import { clearTonSettlement, loadAllTonSettlements, hasUnsettledTonFee } from './utils/ton/tonFeeSettlement'
import { sign } from '@ton/crypto'
import { buildTonProofMessage, tonProofSignInput } from './utils/ton/tonProofMessage'
import { buildSignDataInput } from './utils/ton/tonSignDataSchemes'
import { sendTonSwap, MAX_PRICE_IMPACT } from './utils/ton/tonSwap'
import { getTonSwapQuote } from './utils/ton/tonSwapQuote'
import { toDecimalString } from './utils/ton/jettonBalance'
import { decimalToRawUnits } from './utils/ton/jettonTransfer'
import { routerFactory, dexFactory } from '@ston-fi/sdk'

// Onay ekraninda gosterilen IHTIYATLI gaz payi. Canli teklif DEGIL: TON'da
// imzali govde onay aninda henuz yok. Deger SDK'nin olculmus sabitiyle ayni
// buyukluk (Gorev 4: v2.2 icin 0.3 TON) ve fazlasi zincirde IADE EDILIR.
const TON_SWAP_GAS_DISPLAY = 0.3
import { getTonClient } from './utils/ton/tonClient'
import { hasPendingTonTx } from './utils/ton/tonPending'
import { recoverTonSettlements, TON_RELAY_TX_FLAG } from './utils/ton/tonFeeRecovery'
import { Address, Cell, SendMode, beginCell, external, fromNano, storeMessage, storeStateInit, loadStateInit, internal } from '@ton/core'
import { isTon, TON_TESTNET_ID, TON_MAINNET_ID } from './utils/chainKind'

// Kilit suresi artik sabit degil: kullanicinin `lock_timer` ayarindan okunuyor
// (utils/lockTimer.js). Ayar yoksa varsayilan 15 dakika.
const ALARM_NAME = 'checkInactivity'

// EIP-1193 BAGLANTI DURUMU (yalnizca EVM saglayicisi icin).
//
// Kullanici Solana'ya gecince bagli dapp'lere `disconnect` (4901) yayinlaniyor.
// TERS yon (Solana -> EVM) icin `chainChanged` TEK BASINA YETMEZ:
//   - ethers'in BrowserProvider'i chainChanged'i yeniden baglanma gibi ele alir,
//     yani orada sorun cikmaz;
//   - ama wagmi/viem'in injected connector'u `onDisconnect`te connector
//     durumunu TEMIZLER, `onChainChanged` ise yalnizca HALA BAGLIYSA zincir
//     kimligini gunceller. Temizlenmis durumda chainChanged hicbir seye
//     dokunmaz ve dapp "baglanti kesildi" ekraninda ASILI kalir.
// Bu yuzden donus gecisinde ONCE `connect` yayilir.
//
// BAYRAK NEDEN DISKTE (chrome.storage.session): "en son dapp'lere ne soyledik"
// bilgisi bu. Modul kapsaminda bir degisken MV3'te service worker uyudugunda
// (30 sn bosluk yeter) KAYBOLUR ve donus gecisinde `connect` sessizce
// atlanirdi. `session` (yerel degil) BILEREK: tarayici kapanip acildiginda
// sayfalar da yeniden yuklenir, yani saglayici zaten taze bir "bagli" durumla
// baslar -- bayragin da o anda sifirlanmasi DOGRUDUR.
const EVM_DISCONNECTED_KEY = 'evmProviderDisconnected'

async function setEvmDisconnected(value) {
  // storage.session eski Chrome surumlerinde yok; bayrak bir OPTIMIZASYON degil
  // ama YOKLUGU da yeni bir ariza uretmemeli -- hata yutulur, davranis Task 16a
  // oncesine (yalniz chainChanged) duser.
  try {
    await chrome.storage.session.set({ [EVM_DISCONNECTED_KEY]: value })
  } catch (e) {
    console.error('EVM baglanti bayragi yazilamadi:', e?.message || e)
  }
}

async function wasEvmDisconnected() {
  try {
    const stored = await chrome.storage.session.get(EVM_DISCONNECTED_KEY)
    return stored?.[EVM_DISCONNECTED_KEY] === true
  } catch (e) {
    console.error('EVM baglanti bayragi okunamadi:', e?.message || e)
    return false
  }
}

// Notify all connected dapp tabs about an EIP-1193 event (chainChanged, accountsChanged)
async function notifyConnectedDapps(method, result) {
  try {
    const { dapps = {} } = await chrome.storage.local.get('dapps')
    const connectedHostnames = Object.keys(dapps)
    if (connectedHostnames.length === 0) return

    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })
    
    for (const tab of tabs) {
      try {
        const tabHostname = new URL(tab.url).hostname
        if (connectedHostnames.includes(tabHostname)) {
          chrome.tabs.sendMessage(tab.id, { 
            target: 'wats_inpage', 
            method, 
            result 
          }).catch(() => {})
        }
      } catch (e) {
        // Invalid URL, skip
      }
    }
  } catch (e) {
    console.error('notifyConnectedDapps error:', e)
  }
}

async function notifyDappTab(hostname, method, result) {
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })
    
    for (const tab of tabs) {
      try {
        const tabHostname = new URL(tab.url).hostname
        if (tabHostname === hostname) {
          chrome.tabs.sendMessage(tab.id, { 
            target: 'wats_inpage', 
            method, 
            result 
          }).catch(() => {})
        }
      } catch (e) {
        // Invalid URL
      }
    }
  } catch (e) {
    console.error('notifyDappTab error:', e)
  }
}

chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 })

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    // TON ucret kurtarmasi `session_active` KONTROLUNUN USTUNDE BASLAR. Altina
    // konursa kurtarma KILITLI cuzdanda hic calismaz - oysa kurtarmanin gerektigi
    // an TAM OLARAK kullanicinin uzaklastigi ve cuzdanin kilitlendigi andir
    // (odemesi yarim kalan islem, kullanici basinda olmadigi icin yarim kalmistir).
    // Anahtar GEREKMEZ: imzali govde zaten diskteki makbuzda.
    //
    // BASLAR ama BEKLENMEZ. tonFeeRelay'in zaman asimi/AbortController'i YOK ve
    // tonSeqnoFor canli bir zincir cagrisi yapiyor; ustelik tonFeeRecovery'nin
    // modul duzeyindeki kilidi AYNI askidaki sozu SONRAKI tike de veriyor.
    // Beklenseydi, takilan TEK bir istek pes pese butun tikleri bloklar,
    // shouldLock/lockWallet HIC calismaz ve otomatik kilit - bir GUVENLIK kontrolu
    // - ag yuzunden ACIK TARAFA duserdi. `.catch` yalnizca askidaki sozu
    // sessizlestirir; hatanin kendisini recoverTonFees zaten logluyor.
    const recovering = recoverTonFees().catch(() => {})

    try {
      const { lastActiveTime, session_active, lock_timer } = await chrome.storage.local.get(['lastActiveTime', 'session_active', 'lock_timer'])

      if (!session_active) return

      // Kullanicinin Ayarlar > Kilit Suresi secimi burada okunur. Onceden sabit 15
      // dakika kullaniliyordu, yani "Asla" ve "Hemen" dahil her secenek etkisizdi.
      if (shouldLock(lock_timer, lastActiveTime)) {
        await lockWallet()
      }
    } finally {
      // `finally` yukaridaki erken `return`da da calisir. Isleyici kurtarma
      // bitmeden donerse MV3 devam eden isi kesebilir - ve kilitli cuzdan tam
      // olarak kurtarmanin GEREKTIGI durum. Kilit karari ARTIK VERILDI, yani
      // takilan bir istek onu geciktiremez.
      await recovering
    }
  }
})

// "Hemen" secildiyse popup kapanir kapanmaz kilitle. Alarm en fazla dakikada bir
// calisabildigi icin gercek "hemen" davranisi ancak popup baglantisinin kopmasiyla
// yakalanabiliyor; alarm yine de yedek olarak duruyor.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== POPUP_PORT_NAME) return
  port.onDisconnect.addListener(async () => {
    try {
      const { lock_timer, session_active } = await chrome.storage.local.get(['lock_timer', 'session_active'])
      if (!session_active) return
      if (normalizeLockTimer(lock_timer) === LOCK_IMMEDIATE) await lockWallet()
    } catch (e) {
      console.error('Popup kapanisinda kilitleme basarisiz:', e)
    }
  })
})

// Diskte kalan eski sırların temizliği. Koşulsuz ve idempotent; bilinçli olarak
// data_version migration'ına bağlanmadı: o yalnızca onInstalled'da çalışıyor ve
// içinde erken return'ler + throw edebilen bir ağ çağrısı var.
//
// ⚠️ BU SÜRÜM GERİ ALINAMAZ. jwk silindikten sonra ESKİ sürümlere dönülemez: eski kod
// jwk'yı zorunlu tutuyordu (Login, ChangePassword, ShowPhrases, ShowPrivateKey,
// UnlockVault hepsi `if (!jwk) throw`), dolayısıyla geri alınan bir sürümde HİÇBİR
// kullanıcı giriş yapamaz. Bu commit'i revert ederek geri dönmeyin; düzeltme
// gerekiyorsa ileri bir sürümle çıkın.
async function cleanupLegacyStorage() {
  try {
    // 1) Master key eskiden burada DÜZ METİN duruyordu: kasaları açan anahtar,
    // şifrelediği verinin tam yanında. Artık hiç yazılmıyor.
    const { jwk } = await chrome.storage.local.get('jwk')
    if (jwk !== undefined) {
      await chrome.storage.local.remove('jwk')

      // Anahtarı diskte OLAN kullanıcı: silmek diskteki kopyayı mantıksal olarak
      // kaldırır ama LevelDB'de fiziksel iz kalabilir. Eski anahtarı gerçekten
      // devre dışı bırakmanın tek yolu şifre değişimi (yeni salt + yeniden
      // şifrelenmiş kasalar). Ana ekranda bir kez öneriliyor.
      await chrome.storage.local.set({ needsPasswordRotation: true })
    }

    // 2) v1->v2 migration'ının aldığı tam kasa yedeği. Hiçbir yerde okunmuyor ve
    // yeniden şifrelenmiyor: şifre değiştirilse bile ESKİ şifre bu kopyayı açmaya
    // devam ediyordu.
    //
    // Yalnızca migration'ın tamamlandığı kanıtlıysa silinir. Yarım kalmış bir
    // migration'da (data_version < hedef) bu yedek kullanıcının tek kurtarma
    // kopyasıdır, ona dokunulmaz.
    const { data_version, vaults_v1_backup } = await chrome.storage.local.get(['data_version', 'vaults_v1_backup'])

    if (vaults_v1_backup !== undefined && (data_version || 0) >= TARGET_DATA_VERSION) {
      await chrome.storage.local.remove('vaults_v1_backup')
    }
  } catch (e) {
    console.error('Eski depo temizligi basarisiz:', e)
  }
}

chrome.runtime.onStartup.addListener(async () => {
  await cleanupLegacyStorage()
  await repairRpcFormat()
  await checkAndRecoverPendingTxs()
  await recoverTonFees()
})

chrome.runtime.onInstalled.addListener(async () => {
  await cleanupLegacyStorage()
  await repairRpcFormat()
  await checkAndRecoverPendingTxs()
  await recoverTonFees()
})

const EXTENSION_ORIGIN = chrome.runtime.getURL('')

// Bir zincir kaydinin ISTENEN AKISTA calisip calismadigini dogrular.
//
// Bu isleyicilerin hepsi `found.rpc[0].url` okuyor. TON'un rpc listesi TASARIM
// GEREGI BOS oldugu icin oradan gecen bir TON kimligi "Cannot read properties of
// undefined (reading 'url')" TypeError'i uretiyordu: kullaniciya anlamsiz, loglarda
// yaniltici. Daha kotusu, hatanin ADI yoktu - arayuz bunu "baglantinizi kontrol edin"
// gibi gosterebiliyordu.
//
// Kapi arayuzdekinin AYNISINI okur (chainSupportsFlow, utils/chainKind.js): tek
// politika tablosu, iki katman. Arayuz kapisi atlansa bile burasi tutar.
function assertChainFlow(chain, flow) {
  if (!chainSupportsFlow(chain, flow)) {
    throw new Error(`CHAIN_UNSUPPORTED_FOR_FLOW:${flow}:${chain?.name || chain?.chainId}`)
  }
}

// Dapp trafigi content.js uzerinden geldigi icin sender.url her zaman ilgili
// SAYFANIN http(s) adresidir. Eklentinin kendi sayfalari (popup, onboarding)
// chrome-extension:// ile baslar - kullanici etkinligi olarak yalnizca bunlar sayilir.
function isWalletUiMessage(sender) {
  if (typeof sender?.url === 'string') return sender.url.startsWith(EXTENSION_ORIGIN)

  // sender.url beklenmedik sekilde bos gelirse: content script'ten gelen mesajlarda
  // sender.tab HER ZAMAN doludur. Tab yoksa mesaj eklentinin kendi sayfasindandir.
  // Bu yedek olmadan yanlis negatif, kullaniciyi calisirken kilitlerdi.
  return !sender?.tab
}

const refreshSession = async () => {
  await chrome.storage.local.set({ lastActiveTime: Date.now() })
}

async function unlockWalletSession(masterKeyJwk) {
  await chrome.storage.session.set({ sessionMasterKeyJwk: masterKeyJwk })
  await refreshSession()
  await chrome.storage.local.set({ session_active: true })
}

async function lockWallet() {
  await chrome.storage.session.remove('sessionMasterKeyJwk')
  await clearBundlerTokens()
  await chrome.storage.local.set({ session_active: false })

  chrome.runtime.sendMessage({ type: 'SESSION_EXPIRED' }).catch(() => {})
}

async function isUnlocked() {
  const { sessionMasterKeyJwk } = await chrome.storage.session.get('sessionMasterKeyJwk')
  return sessionMasterKeyJwk !== undefined
}

async function createWalletInstance(account, provider) {
  // 1. Session'dan Master Key JWK'sını al
  const { sessionMasterKeyJwk } = await chrome.storage.session.get('sessionMasterKeyJwk')
  if (!sessionMasterKeyJwk) throw new Error("Wallet locked. Please enter your password.")

  // 2. JWK'yı tekrar kullanılabilir CryptoKey formatına çevir
  const masterKey = await crypto.subtle.importKey(
    'jwk',
    sessionMasterKeyJwk,
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt']
  )

  // 3. İlgili kasanın (vault) şifreli verisini diskten çek
  const { vaults } = await chrome.storage.local.get('vaults')

  // Kasa once `key` ile, ancak bulunamazsa adres ile aranir. Yalnizca adrese
  // bakildiginda ayni adres iki kasada bulunabildigi icin (HD hesabin private
  // key'i ayrica ice aktarilirsa) HD kasa once geliyor, ice aktarilmis hesap
  // "Encrypted data not found" alarak HIC imzalayamiyordu.
  const targetVault = findVaultForAccount(vaults, account)
  if (!targetVault) throw new Error("Vault not found")

  // 4A. İçe Aktarılmış Hesap Kontrolü (Private Key)
  if (account.type === 'imported' || account.type === 'privateKey') {
    if (account.importedSecret) {
      // HD kasaya yükseltilmiş ama içinde barınan eski Private Key
      const privateKey = await decryptSecret(account.importedSecret, masterKey, targetVault.id)
      return new Wallet(privateKey, provider)
    } else if (targetVault.type === 'privateKey') {
      // Henüz yükseltilmemiş, kasanın kendisi Private Key olan durum
      const privateKey = await unlockVault(masterKey, targetVault)
      return new Wallet(privateKey, provider)
    }
    throw new Error("Encrypted data not found for imported account")
  }

  // 4B. HD Cüzdan Kontrolü (Mnemonic)
  if (account.type === 'hd') {
    const mnemonic = await unlockVault(masterKey, targetVault)
    if (!mnemonic.includes(" ")) throw new Error("Invalid Mnemonic.")
    
    const derivationPath = account.derivationPath || `m/44'/60'/0'/0/${account.index}`
    const masterNode = HDNodeWallet.fromPhrase(mnemonic, null, "m")
    const derivedNode = masterNode.derivePath(derivationPath)
    
    return provider ? derivedNode.connect(provider) : derivedNode
  }

  throw new Error("Invalid account type")
}

/**
 * Aktif hesabin Solana adresini dondurur; yoksa TURETIR ve diske yazar.
 *
 * Tembel turetme zorunlu: ed25519 anahtari ancak kasa acikken uretilebilir ve
 * ESKI KURULUMLARDA bu alanlar hic yok. Acilista zorla turetmek her acilista
 * parola istemek demekti.
 *
 * `account.address` (EVM) ASLA ezilmez: kod tabaninda `address.toLowerCase()`
 * ile eslesen onlarca cagri noktasi var ve base58 buyuk/kucuk harf duyarlidir —
 * kucultulen bir Solana adresi sessizce baska bir adrese donusur.
 */
async function resolveSolanaAddress() {
  const { active_account, vaults } = await chrome.storage.local.get(['active_account', 'vaults'])
  if (!active_account) throw new Error('NO_ACTIVE_ACCOUNT')

  // Kural TEK YERDE (accountSupport): secp256k1 sirrindan ed25519 turetilemez.
  if (isSolanaUnsupportedAccount(active_account)) throw new Error('SOLANA_UNSUPPORTED_ACCOUNT')

  // Zaten turetilmis: kasayi ACMADAN don. Aksi halde her bakiye yenilemesi
  // kasa cozumu tetiklerdi.
  if (active_account.solanaAddress && active_account.solanaPublicKey) {
    return { address: active_account.solanaAddress, publicKey: active_account.solanaPublicKey }
  }

  const { sessionMasterKeyJwk } = await chrome.storage.session.get('sessionMasterKeyJwk')
  if (!sessionMasterKeyJwk) throw new Error('WALLET_LOCKED')

  const masterKey = await crypto.subtle.importKey(
    'jwk', sessionMasterKeyJwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']
  )

  const targetVault = findVaultForAccount(vaults, active_account)
  if (!targetVault) throw new Error('VAULT_NOT_FOUND')

  const mnemonic = await unlockVault(masterKey, targetVault)
  if (!mnemonic || !mnemonic.includes(' ')) throw new Error('SOLANA_UNSUPPORTED_ACCOUNT')

  const derived = await deriveSolanaAddress(mnemonic, active_account.index ?? 0)

  // Kayitli bir adres varsa turetilenle AYNI olmali. Ayrilirsa baska bir hesabin
  // anahtari kullaniliyordur; sessizce ustune yazmak kullaniciyi kendi parasini
  // goremedigi bir adrese baglar.
  if (active_account.solanaAddress && active_account.solanaAddress !== derived.address) {
    throw new Error('DERIVED_ADDRESS_MISMATCH')
  }

  // Eslesme `key` ile YAPILIR ama iki taraf da DOLU olmali. Kontrolsuz
  // `a.key === active_account.key` yazilirsa, hesabin key'i yoksa
  // `undefined === undefined` TRUE olur ve turetilen adres BUTUN kasalardaki
  // key'siz her hesaba damgalanir - kullanici alakasiz hesaplarini, fonlarini
  // goremedigi bir adrese baglanmis bulur. deriveAccount.js:16 ve
  // crypto-utils.js:351 ayni korumayi zaten uyguluyor; sira da onlarla ayni:
  // once key, key yoksa adres.
  //
  // Adrese YALNIZCA active_account.key HICBIR SEKILDE yoksa dusulur - bir
  // kayitta key eksik olup active_account'ta VARSA (tutarsiz veri) adrese
  // KAYMAZ, o kayit eslesmemis sayilir: yanlis hesaba yazmaktansa hic
  // yazmamak tercih edilir.
  //
  // Yazma alani ayrica targetVault ILE SINIRLI (findVaultForAccount zaten
  // AYNI onceligi kullanarak bu vault'u bulmustu) - "baska bir kasada ayni
  // adresle eslesen ILGISIZ hesap" riskini (bkz. createWalletInstance'daki
  // yorum: "ayni adres iki kasada bulunabilir") baska bir kasaya hic
  // dokunmayarak tamamen ortadan kaldirir.
  const matchesActiveAccount = (a) => !!a && (
    (!!a.key && !!active_account.key && a.key === active_account.key) ||
    (!active_account.key && !!a.address && !!active_account.address &&
      a.address.toLowerCase() === active_account.address.toLowerCase())
  )

  const nextVaults = (vaults || []).map(vault => {
    if (vault !== targetVault) return vault
    return {
      ...vault,
      accounts: (vault.accounts || []).map(a =>
        matchesActiveAccount(a)
          ? { ...a, solanaAddress: derived.address, solanaPublicKey: derived.publicKey }
          : a)
    }
  })

  await chrome.storage.local.set({
    vaults: nextVaults,
    active_account: {
      ...active_account,
      solanaAddress: derived.address,
      solanaPublicKey: derived.publicKey
    }
  })

  return derived
}

/**
 * Solana transferini imzalar ve yayinlar.
 *
 * Imza ARKA PLANDA atilir: anahtar hicbir zaman popup'a cikmaz.
 *
 * Bekleyen kayit YAYIN BASARILI OLDUKTAN SONRA yazilir. Once yazilsaydi ve yayin
 * duseydi, golge bakiye hic gerceklesmemis bir gonderiyi 24 saat boyunca duserdi.
 */
/**
 * Bekleyen Solana kaydini yazar. Hata FIRLATMAZ -- hata ADINI doner (yoksa null).
 *
 * Cagiranin elinde HER IKI cagri noktasinda da bir IMZA var, yani islem zincire
 * gitmis olabilir. Boyle bir noktada yazma hatasini yukari firlatmak, cagirana
 * "gonderim basarisiz" dedirtir; kullanici TEKRAR gonderir ve FARKLI imzali
 * ikinci bir transfer zincire gider - CIFT GONDERIM. Bu yuzden yazma hatasi
 * AYRI bir alan olarak raporlanir, akisi kesmez.
 *
 * withStorageList (saveOrUpdateTxInStorage icinde) KULLANILIR: dogrudan get->set
 * yapan bir yazim, ayni anda HEARTBEAT'ten tetiklenen checkAndRecoverPendingTxs'in
 * kendi get->set'iyle YARISA girer.
 *
 * Donen deger FALSY OLAMAZ: cagiran onunla "defter tutulamadi mi?" sorusunu
 * soruyor, bos bir mesaj yaniti "sorun yok"a cevirirdi.
 */
async function writeSolanaPendingRecord({ signature, from, to, amount, mint }) {
  try {
    // Adresler KUCULTULMEZ: base58 buyuk/kucuk harf duyarlidir ve kucultulen bir
    // adres gecmis ekraninda BASKA bir adrese donusur.
    await saveOrUpdateTxInStorage({
      hash: signature,
      chainId: SOLANA_CHAIN_ID,
      from_address: from,
      to_address: to,
      value: String(amount),
      asset: mint,
      receipt_status: 'pending',
      block_timestamp: new Date().toISOString(),
    })
    return null
  } catch (e) {
    console.error('[solana] bekleyen kayit yazilamadi:', e)
    return e?.message || e?.name || 'PENDING_RECORD_WRITE_FAILED'
  }
}
async function sendSolanaTransfer({ to, mint, amount, decimals }) {
  const { active_account, vaults } = await chrome.storage.local.get(['active_account', 'vaults'])
  if (!active_account) throw new Error('NO_ACTIVE_ACCOUNT')
  if (isSolanaUnsupportedAccount(active_account)) throw new Error('SOLANA_UNSUPPORTED_ACCOUNT')

  const { sessionMasterKeyJwk } = await chrome.storage.session.get('sessionMasterKeyJwk')
  if (!sessionMasterKeyJwk) throw new Error('WALLET_LOCKED')

  const masterKey = await crypto.subtle.importKey(
    'jwk', sessionMasterKeyJwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']
  )

  const targetVault = findVaultForAccount(vaults, active_account)
  if (!targetVault) throw new Error('VAULT_NOT_FOUND')

  const mnemonic = await unlockVault(masterKey, targetVault)
  if (!mnemonic || !mnemonic.includes(' ')) throw new Error('SOLANA_UNSUPPORTED_ACCOUNT')

  const keypair = await deriveSolanaKeypair(mnemonic, active_account.index ?? 0)
  const from = keypair.publicKey.toBase58()

  // Kayitli adresle ayrilirsa BASKA bir hesabin anahtariyla imza atiliyordur:
  // kullanicinin baska bir hesabinin fonlari, bu hesap icin onayladigini
  // sandigi bir isleme harcanir.
  if (active_account.solanaAddress && active_account.solanaAddress !== from) {
    throw new Error('DERIVED_ADDRESS_MISMATCH')
  }

  const ctx = await prepareTransferContext({ from, to, mint })
  const { transaction } = buildTransferPlan({ from, to, mint, amount, decimals, ...ctx })

  // Imzalayici GERCEK bir PublicKey ile kurulur (`from` zaten yukarida dogrulandi):
  // Transaction._compile() imzaci anahtarini mesajin kendi hesap listesiyle
  // `.equals()` ile karsilastirir, bu da PublicKey'nin ic `_bn` alanini ister.
  // keypair.publicKey dogrudan kullanilirsa (ornegin baska bir turetme yolundan
  // gelmis, PublicKey OLMAYAN bir nesne olursa) bu karsilastirma sessizce degil,
  // acikca patlar; toPublicKey(from) ayni degeri HER ZAMAN gercek bir PublicKey
  // olarak uretir.
  const fromKey = toPublicKey(from)
  transaction.sign({ publicKey: fromKey, secretKey: keypair.secretKey })

  // verifySignatures VARSAYILAN (ACIK) birakilir: bu, imzanin fee payer ile
  // GERCEKTEN eslesip eslesmedigini yayindan ONCE, yerel olarak ve bedava
  // dogrulayan tek katmandir. /solana/rpc preflight'i (send.js) FARKLI ve
  // DAHA GEC calisan bir kontroldur -- ayri sebeplerle basarisiz olabilir veya
  // atlanabilir. Burasi kapatilirsa yanlis anahtarla imzalanmis (ornegin ileride
  // bir refactor'un yanlis keypair'i kullanmasi durumunda) bir islem sessizce
  // yayina gider ve kullanici bosa ucret oder.
  const serialized = transaction.serialize().toString('base64')

  // IMZA ARTIK BELLIDIR -- yayindan DOKUZ SATIR ONCE.
  //
  // `transaction.sign()` imzayi yukarida uretti ve `serialize()` ona DOKUNMADI
  // (yalnizca ayni baytlari tel bicimine yazar). Eskiden bu deger ATILIYOR ve
  // imza SADECE RPC'nin donus degerinden ogreniliyordu. Sonucu su: yanit
  // KAYBOLURSA -- dugum islemi KABUL ETTIKTEN SONRA -- elimizde hicbir sey
  // kalmiyor, sendSolanaTransfer firlatiyor, bekleyen kayit YAZILMIYOR ve
  // kullaniciya "tekrar deneyin" deniyor. ConfirmTransaction.vue `isSubmitting`i
  // `finally`de temizledigi icin Onayla dugmesi ANINDA yeniden tiklanabilir
  // durumda ve ikinci tiklama prepareTransferContext'i yeniden calistirip TAZE
  // bir blockhash alir: FARKLI imzali IKINCI bir transfer zincire gider.
  //
  // Bu, asagidaki defter-tutma catch'inin ZATEN cozdugu senaryonun ta kendisi;
  // orada imza elimizde oldugu icin dogru sey yapiliyordu. Ayni akil yurutme
  // bir adim YUKARI tasindi.
  const localSignature = base58Encode(transaction.signature)

  let signature
  try {
    signature = await broadcastSignedTransaction(serialized)
  } catch (e) {
    const code = e?.message || e?.name || ''

    // KESIN reddedilen yayin (preflight hatasi, gecersiz blockhash, yetersiz
    // bakiye, 4xx) BUGUNKU davranisini KORUR: islem zincire GITMEDI, bekleyen
    // kayit yazmak yalan olurdu ve "tekrar deneyin" DOGRU tavsiyedir.
    if (!isAmbiguousBroadcastError(code)) throw e

    // BELIRSIZ dusus (zaman asimi / 5xx): dugum islemi kabul etmis OLABILIR.
    // Kayit BURADA yazilir -- imza yereldir, RPC'ye ihtiyaci yoktur -- ve
    // cagirana "durum bilinmiyor, gecmise bak" denir. checkAndRecoverPendingTxs
    // zaten getSignatureStatuses'i `searchTransactionHistory: true` ile sorgular
    // (bkz. fetchSolanaResolution): islem gercekten gittiyse kayit kendiliginden
    // basariya doner, gitmediyse suresi dolunca temizlenir.
    console.warn('[solana] yayin BELIRSIZ dustu, imza kaydediliyor:', code)
    const bookkeepingError = await writeSolanaPendingRecord({ signature: localSignature, from, to, amount, mint })
    return bookkeepingError
      ? { signature: localSignature, broadcastStatusUnknown: true, broadcastError: code, bookkeepingError }
      : { signature: localSignature, broadcastStatusUnknown: true, broadcastError: code }
  }

  // Kayit YAYINDAN SONRA. Adresler KUCULTULMEZ: base58 buyuk/kucuk harf
  // duyarlidir ve kucultulen bir adres gecmis ekraninda baska bir adrese donusur.
  //
  // withStorageList (saveOrUpdateTxInStorage icinde) KULLANILIR: dogrudan
  // get->set yapan bir yazim, ayni anda HEARTBEAT'ten tetiklenen
  // checkAndRecoverPendingTxs'in kendi get->set'iyle YARISA girer ve hangisi
  // sona kalirsa digerinin yazdigi kaydi EZER (txStorage.js'in var olma
  // sebebi tam olarak bu). withStorageList ayrica bozuk/dizi-olmayan bir
  // anahtari sessizce [] 'e indirger; ham yol bunu yapmiyordu.
  const bookkeepingError = await writeSolanaPendingRecord({ signature, from, to, amount, mint })
  return bookkeepingError ? { signature, bookkeepingError } : { signature }
}

// TON anahtari: createWalletInstance'in ed25519 karsiligi.
//
// Ayni kaynaktan (session masterKey + kasa) beslenir, ayni hatalari atar. Anahtar
// DONDURULMEZ, yalnizca imzalayan tarafa verilir ve cagri bitince kapsam disina cikar.
//
// TURETME BURADA YAPILMAZ — `tonIdentityForAccount`a devredilir.
//
// Eskiden burada `tonSecretForAccount` + `deriveTonAccount(secret, account, { testnet })`
// vardi, yani turetmenin IKINCI bir kopyasi. Ve o kopya `secretKind` GECIRMIYORDU:
// TON kasasindan cikan ifade `value.includes(' ')` sezgisine dusuyor, BIP39 dalina
// giriyordu. bip39.mnemonicToSeed saf PBKDF2'dir — saglama dogrulamaz, FIRLATMAZ —
// yani gecerli gorunumlu ama YANLIS bir W5 adresi ve o adresin anahtari uretiliyordu.
// Gorunum yolu (tonIdentityForAccount, secretKind GECIRIYOR) baska bir adres
// gosterdigi icin sonuc en kotu sekliydi: kullanici A adresini gorup B'nin
// anahtariyla imzaliyor — gonderimler hic ulasmiyor, jetton sahibi yanlis
// hesaplaniyor, takas ayni sekilde.
//
// Cozum ikinci kopyayi duzeltmek DEGIL, KALDIRMAK: gorunum ve imzalama artik ayni
// govdeden geciyor, dolayisiyla sapma YAPISAL OLARAK imkansiz. `vault.type` ->
// `secretKind` esleme de tek yerde (tonIdentity.js:secretKindForVault) kaliyor.
async function createTonKeyPair(account, { testnet = false } = {}) {
  const { sessionMasterKeyJwk } = await chrome.storage.session.get('sessionMasterKeyJwk')
  if (!sessionMasterKeyJwk) throw new Error("Wallet locked. Please enter your password.")

  const masterKey = await crypto.subtle.importKey(
    'jwk', sessionMasterKeyJwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']
  )

  const { vaults } = await chrome.storage.local.get('vaults')

  return await tonIdentityForAccount(masterKey, vaults, account, { testnet })
}

async function resolveAccount(messageData) {
  if (messageData.account && typeof messageData.account === 'object') {
    return messageData.account;
  }
  const { active_account } = await chrome.storage.local.get('active_account')
  if (!active_account) throw new Error("Active account not found")
  return active_account
}

function deserializeTx(tx) {
  const out = {}
  for (const [key, value] of Object.entries(tx)) {
    if (["value", "gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"].includes(key)) {
      if (value !== undefined && value !== null && value !== "") out[key] = BigInt(value)
    } else {
      out[key] = value
    }
  }
  return out
}

const transactionQueue = [];
let isQueueRunning = false;

async function processQueue() {
  if (isQueueRunning) return;
  isQueueRunning = true;
  while (transactionQueue.length > 0) {
    const task = transactionQueue.shift();
    try {
      await task();
    } catch (e) {
      console.error("Queue task error:", e);
    }
  }
  isQueueRunning = false;
}

// Bu fonksiyon bircok yerden AWAIT EDILMEDEN cagriliyor (waitPromise devamlari,
// relay geri cagrilari). Kendi get->set'ini yapan es zamanli cagrilar birbirini
// eziyordu; ozellikle relay'in yazdigi txHash kayboluyor ve islem sonsuza dek
// 'processing' kaliyordu. Yazmalar artik siraya giriyor (utils/txStorage.js).
const updateTxStatus = async (id, status, data = {}) => {
  await withStorageList(CURRENT_TRANSACTIONS, (current_transactions) => {
    const existingIndex = current_transactions.findIndex(t => t.id === id);
    if (existingIndex !== -1) {
      current_transactions[existingIndex] = {
        ...current_transactions[existingIndex],
        status,
        meta: { ...current_transactions[existingIndex].meta, ...data }
      };
    } else {
      current_transactions.unshift({ id, status, meta: data, timestamp: Date.now() });
    }
    return current_transactions;
  });
}

/**
 * Bir Solana imzasinin zincirdeki durumu — SALT OKUR, hicbir sey degistirmez.
 *
 * Cozulduyse kayda islenecek YAMA nesnesini, cozulmediyse null doner. Kaydi
 * BURADA degistirmemesi bilerek: bu cagri agda gecen bir istektir ve
 * asagida bekleyen liste KILIDININ DISINDA calistirilir (bkz.
 * collectPendingResolutions). Kayda dokunmak, kilit disinda tutulan ESKI bir
 * anlik goruntuyu degistirmek demek olurdu.
 *
 * Kayit hala gorunmuyorsa (henuz yayilmadi/dusmus olabilir) null doner - sure
 * dolunca prunePendingTransactions zaten temizler.
 */
async function fetchSolanaResolution(signature) {
  const statuses = await solanaRpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }])
  const status = statuses?.value?.[0]
  if (!status) return null

  if (status.err) return { receipt_status: '0' }
  // 'processed' YETMEZ: o asamadaki bir islem hala geri alinabilir. Ancak
  // 'confirmed'/'finalized' cozulmus sayilir.
  if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
    return { receipt_status: '1' }
  }
  return null
}

/**
 * Bir EVM islem makbuzu — SALT OKUR. Sozlesmesi fetchSolanaResolution ile ayni.
 */
async function fetchEvmResolution(pTx, current_transactions) {
  // Zincir ID'ye ulasmak icin current_transactions eslesmesine bakiyoruz.
  const matchCtx = current_transactions.find(c => c.meta && c.meta.txHash === pTx.hash)
  const chainId = matchCtx ? matchCtx.meta.chainId : null
  // Deneme yanilma yapmiyoruz: zinciri bilemedigimiz kayit es geciliyor.
  if (!chainId) return null

  const found = supported_chains.find(c => isSameChainId(c.chainId, chainId))
  if (!found) return null

  // rpcUrlsOf EVM olmayan bir kayda [] doner ve `rpc` alaninin hem dizi hem
  // nesne bicimini kabul eder (repairNetworkData mirasi); `found.rpc[0].url`
  // ikincisinde patliyordu.
  const [url] = rpcUrlsOf(found)
  if (!url) return null

  const provider = new ethers.JsonRpcProvider(url)
  const receipt = await provider.getTransactionReceipt(pTx.hash)
  if (!receipt) return null

  return {
    receipt_status: receipt.status === 0 ? "0" : "1",
    block_number: receipt.blockNumber.toString(),
    transaction_fee: ethers.formatEther(receipt.gasUsed * (receipt.effectiveGasPrice || 0n)),
  }
}

/**
 * Bekleyen kayitlar icin zincir durumunu TOPLAR — AG ISI BURADA, KILIT DISINDA.
 *
 * Bu ayrimin sebebi: bu sorgular withStorageList'in mutate geri cagrisi ICINDE
 * yapiliyordu, yani PENDING_TRANSACTIONS kuyrugu bir ag turu boyunca TUTULUYORDU
 * (txStorage.js:19-33 anahtar basina tek bir soz zinciri). O kuyrugu bekleyen
 * herkes de bekliyordu: ozellikle sendSolanaTransfer'in yayindan SONRAKI
 * saveOrUpdateTxInStorage cagrisi. Takilan tek bir RPC ile o await hic donmez,
 * dolayisiyla sendResponse da hic cagrilmaz: popup ZATEN ZINCIRE GITMIS bir
 * islem icin donmeye devam eder, kullanici basarisiz sandigi gonderimi TEKRAR
 * yapar -- tam olarak "yayindan sonra hicbir sey duz hata olarak donmez"
 * kuralinin onlemek icin var oldugu CIFT GONDERIM, bu kez oteki yondan.
 *
 * (Zaman asimi da yardim etmiyordu: ethers'in FetchRequest varsayilani 300000 ms,
 * yani BES DAKIKA; solana/client.js'de ise hic yoktu — bu turda eklendi.)
 *
 * @returns {Promise<Map<string, object>>} hash -> kayda islenecek yama
 */
async function collectPendingResolutions(pending_transactions, current_transactions) {
  const resolutions = new Map()

  for (const pTx of pending_transactions) {
    if (!isStillPending(pTx) || !pTx.hash) continue

    // Kaydin KENDI chainId'sinden zincir kaydi bulunur. Kural POZITIF: "Solana
    // DEGIL mi?" diye degil, "KULLANILABILIR BIR EVM UCU VAR MI?" diye sorulur.
    //
    // Sebep: chainVm BILINMEYEN her `vm` degerini EVM'e dusurur (utils/vm.js) --
    // bilinmeyeni ozel bir yola sokmak, o yolun olmadigi yerde sessiz cokme
    // uretecegi icin oyle tasarlandi. Ama burada tam tersi gerekiyor: yarin
    // eklenecek `vm: 'ton'` gibi bir zincir "Solana degil" diye EVM dalina
    // duser ve base58/baska bicimli bir hash ile ethers.JsonRpcProvider'a
    // gider. rpcUrlsOf DURUST TESTTIR: EVM ucu olmayan bir zincirin ethers
    // saglayicisi da olamaz -- Solana kaydinda `rpc` alaninin BILEREK
    // bulunmamasinin sebebi zaten budur.
    //
    // chainId'si HIC OLMAYAN kayitlar (bugunku EVM iskeletleri hicbir chainId
    // yazmiyor) EVM dalina birakilir: zinciri orada current_transactions
    // eslesmesinden okunuyor. Kaydin BEYAN ETTIGI ama taninmayan bir zincir ise
    // atlanir; onu ctx'ten gelen BASKA bir zincire sorarak "cozmek" yanlis
    // zincire soru sormaktir.
    //
    // (isSameChainId 1 ile '1'i ayni sayar: metin chainId tasiyan bir EVM kaydi
    // -- yeni bir iskelet kurucusu, bir JSON gidis-donusu, gocurulmus bir kayit
    // -- bu yuzden SESSIZCE atlanmaz. 3. turda kapatilan tuzak buydu.)
    const chain = pTx.chainId == null
      ? null
      : supported_chains.find(c => isSameChainId(c.chainId, pTx.chainId))

    if (pTx.chainId != null) {
      if (!chain) continue                                  // beyan edilen zincir TANINMIYOR
      if (chainVm(chain) !== 'evm' || rpcUrlsOf(chain).length === 0) {
        // EVM-DISI zincirler: kendi yollari varsa oraya, yoksa atlanir.
        if (chainVm(chain) === 'solana') {
          try {
            const patch = await fetchSolanaResolution(pTx.hash)
            if (patch) resolutions.set(pTx.hash, patch)
          } catch (e) { }
        }
        continue
      }
    }

    try {
      const patch = await fetchEvmResolution(pTx, current_transactions)
      if (patch) resolutions.set(pTx.hash, patch)
    } catch (e) { }
  }

  return resolutions
}

/**
 * Ayni anda EN FAZLA BIR kurtarma turu.
 *
 * Ag isi 3. turda kilidin disina cikarilinca, kilidin kazara sagladigi
 * SERILESTIRME de kayboldu: HEARTBEAT kurtarmayi AWAIT ETMEDEN tetikliyor ve
 * kullanici hareket ettikce 5 saniyede bir gelebiliyor, yani onceki tur hala
 * agdayken ikincisi baslayip AYNI kayitlar icin AYNI sorgulari bir kez daha
 * yapiyordu. Birlestirme hash ile ve taze liste uzerinde oldugu icin sonuc
 * DOGRU kaliyor -- sorun dogruluk degil, kendi proxy'mize karsi surekli
 * ikilenen yuk (IP ile hiz sinirli ve ucretli bir saglayici anahtarini
 * paylasiyor).
 *
 * Devam eden tur varsa onun sozu donulur: cagiran ister await etsin ister
 * etmesin davranis ayni.
 */
let pendingRecoveryRun = null

function checkAndRecoverPendingTxs() {
  if (pendingRecoveryRun) return pendingRecoveryRun
  // finally: tur nasil biterse bitsin bayrak TEMIZLENIR. Temizlenmezse
  // kurtarma bir daha HIC calismaz ve bekleyen kayitlar yalnizca 24 saatte
  // eskiyerek duser.
  pendingRecoveryRun = runPendingRecovery().finally(() => { pendingRecoveryRun = null })
  return pendingRecoveryRun
}

// Kurtarma fonksiyonu: SW tekrar başlarsa kayıp pending'leri kontrol eder.
async function runPendingRecovery() {
  try {
    const { current_transactions = [] } = await chrome.storage.local.get('current_transactions');
    let hasChanges = false;

    // Check UI stack transactions stuck in processing
    for (const ctx of current_transactions) {
      if (ctx.status === 'processing' && ctx.meta && ctx.meta.txHash && ctx.meta.chainId) {
        try {
          const found = supported_chains.find(c => c.chainId === ctx.meta.chainId);
          if (!found) continue;
          const provider = new ethers.JsonRpcProvider(found.rpc[0].url);
          const receipt = await provider.getTransactionReceipt(ctx.meta.txHash);
          if (receipt) {
            ctx.status = receipt.status === 0 ? 'error' : 'success';
            hasChanges = true;
          }
        } catch(e) { }
      }
    }
    if (hasChanges) await chrome.storage.local.set({ current_transactions });

    // Check global pending_transactions stuck in pending
    //
    // IKI ASAMA, ve ayrim BILEREK:
    //
    //   1) Zincir sorgulari KILIT DISINDA (collectPendingResolutions). Bunlar
    //      ag turlaridir ve dakikalar surebilirler.
    //   2) Yalnizca birlestirme + budama KILIT ICINDE (withStorageList), tek bir
    //      get->set araligi kadar.
    //
    // Kilit PENDING_TRANSACTIONS anahtarinin TEK kuyrugudur (txStorage.js) ve
    // butun yazicilar onu paylasir: bu fonksiyon, sendSolanaTransfer, swap ve
    // kopru akislari. Bu fonksiyon HEARTBEAT'te AWAIT EDILMEDEN tetikleniyor ve
    // kullanici hareket ettikce 5 saniyede bir gelebiliyor, yani her an bir
    // gonderimle ayni anda calisabilir. Sorgular kilit icinde kalsaydi, takilan
    // TEK bir RPC yayin sonrasi kaydini yazmaya calisan bir gonderimi de
    // kilitler ve o gonderim hicbir zaman yanit dondurmezdi.
    //
    // withStorageList'in birakilmamasinin sebebi degismedi: birlestirme, kilit
    // icinde TAZE okunan liste uzerinde yapilir. 1. asamanin anlik goruntusu
    // eskimis olabilir; bu yuzden asagida yamalar listeye HASH ILE eslenir,
    // anlik goruntu geri YAZILMAZ. Arada yazilmis yeni bir kayit (orn. yeni
    // biten bir gonderim) boylece ezilmez, yalnizca bu turda cozulmemis olur.
    // withStorageList ayrica bozuk/dizi-olmayan bir anahtari sessizce []'e indirger.
    const { pending_transactions: pendingSnapshot } = await chrome.storage.local.get(PENDING_TRANSACTIONS);
    const resolutions = await collectPendingResolutions(
      Array.isArray(pendingSnapshot) ? pendingSnapshot : [], current_transactions
    );

    await withStorageList(PENDING_TRANSACTIONS, (pending_transactions) => {
      let pendingChanges = false;
      for (const pTx of pending_transactions) {
        const patch = resolutions.get(pTx.hash);
        // Kayit arada BASKA bir yazici tarafindan cozulmus olabilir; o zaman
        // elimizdeki yama eskidir ve uzerine yazmamalidir.
        if (!patch || !isStillPending(pTx)) continue;
        Object.assign(pTx, patch);
        pendingChanges = true;
      }
      // Cozulmus ve eskimis kayitlar listeden CIKARILIR. Listede birakilirlarsa golge
      // bakiye onlari sonsuza dek dusmeye devam eder: zincir gonderiyi zaten yansitmisken
      // ayni tutar bir kez daha dusuldugu icin bakiye kalici olarak eksik gorunur.
      const stillPending = prunePendingTransactions(pending_transactions);
      if (!pendingChanges && stillPending.length === pending_transactions.length) {
        return undefined; // degisiklik yok - gereksiz yazim atlanir
      }
      return stillPending;
    });

  } catch (e) {
    console.error("Recover pending txs error:", e);
  }
}

// --- TON ucret kurtarmasi ("odendi ama gitmedi", tasarim belgesi bolum 6) ---
//
// KARARIN TAMAMI utils/ton/tonFeeRecovery.js'te; burasi yalnizca ona zincire ve diske
// erisimi verir. Kurtarma KILITLI cuzdanda da calismak zorunda oldugu icin burada
// HICBIR anahtar acilmaz: imzali govde zaten diskteki makbuzda duruyor.

// Kurtarma bir MESAJDAN degil, bir alarmdan/onStartup'tan tetiklenir - ortada
// `message.apiBase` yok. Uc, TON yollarinin geri kalaniyla AYNI proxy (ConfirmTransaction
// `config.api`'yi yolluyor, o da bu env degerinden geliyor).
const TON_RECOVERY_API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Zincirden TAZE seqno. Task 6'dan tasinan yukumluluk 1: makbuzdaki `seqno` gonderim
// anindaki degerdir; kurtarma onu diskteki degerle DEGIL, zincirin SU ANKI degeriyle
// karsilastirmak zorunda - "ilerledi mi" sorusunun baska cevabi yok.
//
// FIRLATABILIR (RPC kesintisi, dagitilmamis cuzdan): tonFeeRecovery bunu "bu turda
// karar verme" olarak okur ve saklanan govdeyi KORLEMESINE oynatmaz.
async function tonSeqnoFor(tonWallet) {
  const client = getTonClient(TON_RECOVERY_API_BASE)
  const res = await client.runMethod(Address.parse(String(tonWallet)), 'seqno')
  return res.stack.readNumber()
}

// ZINCIRDE EYLEM ARAMASI HENUZ YOK. 'unknown' dondurmek, kurtarmayi guvenli tarafa
// ('unresolved') dusurur: ucret alindi, sonuc dogrulanamadi. Buraya 'found' donduren
// bir kestirme YAZILMAMALI - seqno'nun ilerlemesi bizim eylemimizin gittigini
// GOSTERMEZ (kullanici ayni cuzdandan self-pay/Tonkeeper ile baska bir sey gondermis
// olabilir) ve o durumda ucreti yanmis bir islem ekranda 'success' gorunur.
async function tonFindActionOnChain() {
  return 'unknown'
}

// HICBIR ZAMAN FIRLATMAZ: alarm isleyicisinde kilit mantiginin ONUNDE calisiyor;
// buradan cikan bir hata otomatik kilidi de dusururdu.
async function recoverTonFees() {
  try {
    await recoverTonSettlements({
      getSeqnoFor: tonSeqnoFor,
      findActionOnChain: tonFindActionOnChain,
      updateTxStatus,
      listTransactions: async () => {
        const stored = await chrome.storage.local.get(CURRENT_TRANSACTIONS)
        return stored[CURRENT_TRANSACTIONS] || []
      },
    })
  } catch (e) {
    console.error('[ton] ucret kurtarma basarisiz:', e)
  }
}


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message.method || message.type;

  // KOKEN KAPISI — switch'ten ve ignoredResponses'tan ONCE.
  //
  // KAPATILAN ACIK: content.js sayfadan gelen mesajin payload'ini OLDUGU GIBI buraya
  // iletiyordu (tek kontrol, herhangi bir sayfanin yazabilecegi bir 'target' metni).
  // Asagidaki isleyiciler `sender`i parametre olarak aliyor ama GOVDELERINDE HIC
  // KULLANMIYORDU ve createWalletInstance yalnizca oturum anahtarina bakiyor. Sonuc:
  // cuzdan kilidi ACIKKEN, kullanicinin acik tuttugu HERHANGI bir site tek bir
  // postMessage ile keyfi bir islemi imzalatip yayinlayabiliyordu - onay ekrani hic
  // acilmadan (onay ekrani popup'ta yasar ve bu mesaj zaten popup'in onaydan SONRA
  // gonderdigi mesajdir).
  //
  // Kapi ADIN KENDISINE bakar, adin `type`ta mi `method`ta mi geldigine DEGIL:
  // dagitici `method || type` okudugu icin saldirgan ic aksiyon adini `method`
  // alanina saklayabilir. Politikanin tamami utils/messageGate.js'te.
  if (messageBlockReason(action, { fromWalletUi: isWalletUiMessage(sender) })) {
    // Solana isleyicileri (asagida) ayni reddi kendi koken kontrollerinde
    // 'FORBIDDEN_ORIGIN' dizgesiyle veriyordu ve arayuz o dizgeyi cevirip gosteriyor
    // (utils/solana/sendErrors.js). Kapi switch'ten ONCE calistigi icin red artik
    // buradan cikiyor; sekli korunmazsa AYNI reddin iki farkli gorunumu olur ve
    // ekranda cevrilmemis bir hata belirirdi. EVM/dapp tarafi EIP-1193 sekliyle
    // (4100) yanitlanmaya devam eder.
    sendResponse(String(action).startsWith('SOLANA_')
      ? { error: 'FORBIDDEN_ORIGIN' }
      : { error: { code: 4100, message: 'Unauthorized' } })
    return false
  }


  // Yalnizca cuzdan arayuzunden gelen mesajlar "kullanici etkin" sayilir.
  // Aksi halde acik bir sekmede provider'i periyodik yoklayan HERHANGI bir site
  // (eth_chainId/eth_accounts cok yaygin) sayaci surekli sifirlar ve otomatik
  // kilit hicbir zaman devreye girmez.
  if (isWalletUiMessage(sender)) refreshSession()

  const ignoredResponses = [
    'SIGN_MESSAGE_SUCCESS', 'SIGN_MESSAGE_REJECTED',
    'CONNECT_WALLET_SUCCESS', 'CONNECT_WALLET_REJECTED',
    'SEND_TX_SUCCESS', 'SEND_TX_REJECTED'
  ]
  if(ignoredResponses.includes(action)) {
    resolvePendingRequest(message, sender)
    return
  }

  switch (action) {
    case 'CHECK_UNLOCK':
      isUnlocked().then(unlocked => sendResponse({ unlocked }))
      return true
      
    case 'UNLOCK_WALLET':
      unlockWalletSession(message.masterKeyJwk).then(() => sendResponse({ success: true }))
      return true
      
    case 'LOCK':
      lockWallet().then(() => sendResponse({ success: true }))
      return true

    case 'SOLANA_GET_ADDRESS':
      // Kasa acma yetkisi yalnizca cuzdan arayuzunde. Bir web sayfasi bu mesaji
      // gonderebilseydi kullanicinin gormedigi bir parola istemi tetiklenirdi.
      if (!isWalletUiMessage(sender)) {
        sendResponse({ error: 'FORBIDDEN_ORIGIN' })
        return false
      }
      resolveSolanaAddress()
        .then(result => sendResponse({ result }))
        .catch(e => sendResponse({ error: e.message }))
      return true

    case 'SOLANA_SEND':
      // Ayni gerekce: kasa acma yetkisi yalnizca cuzdan arayuzunde.
      if (!isWalletUiMessage(sender)) {
        sendResponse({ error: 'FORBIDDEN_ORIGIN' })
        return false
      }
      sendSolanaTransfer(message)
        .then(result => sendResponse({ result }))
        // e.message BAZI hatalarda BOS ("") olabilir (ornegin @solana/spl-token
        // TokenOwnerOffCurveError argumansiz firlatilir) - bos dizge FALSY
        // oldugu icin sinir otesine `{ error: '' }` gecerdi. Bir UI ekrani
        // `if (res.error) ... else res.result.signature` yazarsa bu durumda
        // BASARI dalina duser ve result yok diye patlar. Hicbir hata falsy
        // olarak sinir otesine GECEMEZ.
        .catch(e => sendResponse({ error: e?.message || e?.name || 'SOLANA_SEND_FAILED' }))
      return true

    case "HEARTBEAT":
      checkAndRecoverPendingTxs(); // Kurtarmayı tetikle
      // TON ucret makbuzlari ("odendi ama gitmedi") ayni tetikleyiciden. Alarm
      // dakikada bir; arayuz acildiginda kullaniciyi bir dakika bekletmeyelim.
      // Kendi ic kilidi (tonFeeRecovery) alarmla ust uste binmeyi engelliyor.
      recoverTonFees();
      sendResponse({ success: true })
      return false

    case "CHAIN_CHANGED":
      (async () => {
        // applyNetworkChange.js HER ag degisiminde (Solana DAHIL, bkz. kendi testi)
        // bu mesaji gonderir. Zincir EVM degilse burada SESSIZCE durulur: aksi halde
        // Solana'nin METIN chainId'si asagida `'0x' + 'solana-mainnet'.toString(16)`
        // ile (String.prototype.toString radix'i YOKSAYAR) GECERSIZ bir hex'e
        // ('0xsolana-mainnet') donusup butun bagli EVM dapp'lerine chainChanged
        // OLARAK YAYILIRDI ve `dapps[hostname].chainId`ye de bu hatali deger yazilirdi.
        //
        // KOD INCELEMESI (F9a): `chainId` karsilastirmasi isSameChainId ile yapilir,
        // KATI `===` ile DEGIL -- EVM kimlikleri hem sayi hem metin ('1'/1) dolasabiliyor
        // ve kati esitlik bunlari AYRI sayardi. Ayrica COZULEMEYEN bir chainId (found
        // undefined) ile "cozuldu ama EVM degil" (found=Solana) durumu BIRBIRINDEN
        // AYRILIR: ilki gercek bir hata (loglanir, `success:false` doner -- caller
        // (applyNetworkChange.js) yanitini okumasa da teshis konsolda kalir), ikincisi
        // KASITLI bir sessizlik degil, asagidaki disconnect bildirimidir.
        const found = supported_chains.find((c) => isSameChainId(c.chainId, message.chainId))
        if (!found) {
          console.error('CHAIN_CHANGED: bilinmeyen chainId, dapp bildirimi atlanir:', message.chainId)
          sendResponse({ success: false, error: 'Unsupported chain' })
          return
        }

        try {
          // KIMLIK kapisi (requireEvmVm), UC NOKTASI kapisi DEGIL. Burasi bir dapp
          // bildirim yolu; zincirin RPC'si acilmaz. Paketteki her EVM kaydinin rpc'si
          // dolu oldugu icin bugun ikisi ayni sonucu verir, ama kapi YAPILAN ISE gore
          // secilir: bkz. dappFunctions.js'teki ayni not.
          //
          // BIRLESTIRME NOTU: kapi artik EVM DISI HER ZINCIRI kapsiyor. Solana kaydi
          // `vm`, TON kaydi `kind` tasiyor ve TEK bir alana bakan her kontrol otekini
          // yanlis siniflandirirdi; chainVm TON sorusunu chainKind'e DEVRETTIGI icin
          // (utils/vm.js) burada tek kapi ikisini de yakalar. TON dali burada "hicbir
          // sey yayinlama" diyordu; asagidaki disconnect ONDAN DAHA IYIDIR ve TON icin
          // de dogrudur -- iki durumda da saglayici hicbir EVM zincirine bagli degil.
          requireEvmVm(found)
        } catch {
          // KOD INCELEMESI (F9b): "hicbir sey yapma" bagli bir dapp'i "Connected —
          // BNB Smart Chain" gosterirken birakiyordu, oysa eth_chainId ARTIK acik bir
          // hata donuyor -- dapp'in gordugu durum ile gercek durum AYRISIYORDU.
          // EIP-1193'un disconnect olayi tam bunun icin var: saglayici (biz) hicbir EVM
          // zincirine bagli degiliz, ama saglayicinin KENDISI (uzanti) hala orada.
          // Kod 4901 = "Chain Disconnected".
          await notifyConnectedDapps('disconnect', { code: 4901, message: 'Chain Disconnected' })
          // Donus gecisinde `connect` yayabilmek icin durum KAYDEDILIR
          // (bkz. EVM_DISCONNECTED_KEY notu).
          await setEvmDisconnected(true)
          // Solana/TON'a gecis: KASITLI, hata degil. `skipped` alani TON dalindan
          // korunuyor: cagiran bugun okumasa da "basarili ve yayin yapildi" ile
          // "basarili ama yayin yapilmadi" ayri seylerdir.
          sendResponse({ success: true, skipped: 'non-evm' })
          return
        }

        try {
          // Hex, COZULEN KAYITTAN ve TEK ureticiden (hexChainIdFor, dappFunctions.js)
          // uretilir; ham `message.chainId`den DEGIL:
          //   - yukaridaki arama isSameChainId ile yapiliyor, yani METIN bir EVM kimligi
          //     ('137') de cozuluyor. Ham degeri hexlemek `'137'.toString(16)` ile
          //     '0x137' uretirdi (String.prototype.toString radix'i YOKSAYAR); dogru
          //     cevap '0x89'.
          //   - hexChainIdFor ayrica NEGATIF (TON) ve tamsayi OLMAYAN (Solana'nin metin
          //     kimligi) degerleri eler: '0x-ef' / '0xsolana-mainnet' bicimleri artik
          //     YAPISAL OLARAK uretilemez.
          const hexChainId = hexChainIdFor(found)
          if (!hexChainId) {
            // requireEvmVm GECTI ama kaydin chainId'si hex'e cevrilemedi (eksik/0/negatif):
            // dapp'e uydurma bir kimlik yayilmaz.
            console.error('CHAIN_CHANGED: EVM kaydinin chainId si hex e cevrilemedi:', found?.chainId)
            sendResponse({ success: false, error: 'Unsupported chain' })
            return
          }

          // Update chainId in all connected dapps
          const { dapps = {} } = await chrome.storage.local.get('dapps')
          for (const hostname of Object.keys(dapps)) {
            dapps[hostname].chainId = hexChainId
          }
          await chrome.storage.local.set({ dapps })

          // DONUS GECISI (EVM-disi -> EVM): once `connect`, sonra `chainChanged`.
          //
          // KOSULA BAGLI, KOSULSUZ DEGIL: her EVM -> EVM zincir degisiminde
          // `connect` yaymak BUGUNKU EVM davranisini degistirirdi (connector'lar
          // onConnect'te dinleyicilerini yeniden kurar, "change" olaylarini
          // yeniden yayar). `connect` yalnizca dapp'lere EN SON `disconnect`
          // soylediysek anlamlidir.
          if (await wasEvmDisconnected()) {
            // EIP-1193 ProviderConnectInfo: tek zorunlu alan `chainId` (hex).
            await notifyConnectedDapps('connect', { chainId: hexChainId })
            await setEvmDisconnected(false)
          }

          // Notify all connected dapp tabs
          await notifyConnectedDapps('chainChanged', hexChainId)
          sendResponse({ success: true })
        } catch (e) {
          console.error('CHAIN_CHANGED error:', e)
          sendResponse({ success: false })
        }
      })()
      return true

    // Aktif hesap degistiginde bagli dapp'lere EIP-1193 accountsChanged gonderilir.
    // Bildirilmezse dapp eski hesabi bagli sanar ve islemlerini o hesap icin hazirlar;
    // onay ekrani ise baska bir hesapla imzalar.
    case "ACCOUNT_CHANGED":
      (async () => {
        try {
          await notifyConnectedDapps('accountsChanged', message.address ? [message.address] : [])
          sendResponse({ success: true })
        } catch (e) {
          console.error('ACCOUNT_CHANGED error:', e)
          sendResponse({ success: false })
        }
      })()
      return true

    case "DISCONNECT_DAPP":
      (async () => {
        try {
          const { hostname } = message
          // Tell the specific dapp that the connected user address is null.
          await notifyDappTab(hostname, 'accountsChanged', [])
          sendResponse({ success: true })
        } catch(e) {
          console.error('DISCONNECT_DAPP error:', e)
          sendResponse({ success: false })
        }
      })()
      return true

    // TON'un DISCONNECT_DAPP karsiligi. DISCONNECT_DAPP'ten FARKI: silme burada
    // (arka planda) yapilir, cagiran bilesen (Dapps.vue) yalniz listeyi tazeler --
    // EVM tarafinda oldugu gibi iki yerde (bilesen + arka plan) silmek, biri
    // basarisiz oldugunda ekranla disk arasinda kalici bir ayrisma birakirdi.
    case "DISCONNECT_TON_DAPP":
      (async () => {
        try {
          const hostname = message.hostname
          const { ton_dapps = {} } = await chrome.storage.local.get('ton_dapps')
          // OKU-DEGISTIR-YAZ yalnizca SILINECEK bir oturum GERCEKTEN VARSA
          // yapilir. Hostname icin kayit yoksa butun ton_dapps haritasini GERI
          // YAZMAK, TAM O ANDA baska bir istekten gelen bir putTonSession'i
          // (or. kullanici baska bir sekmede TAM O SIRADA yeni bir TON dapp'ine
          // baglaniyorken) EZEBILIR -- klasik kayip-guncelleme yarisi (bkz.
          // tonDappFunctions.js:handleTonSend disconnect dalindaki AYNI gerekce).
          // Yaziya hic GEREK yoksa yazma.
          if (ton_dapps[hostname]) {
            await chrome.storage.local.set({ ton_dapps: removeTonSession(ton_dapps, hostname) })
          }
          // Dapp'e HABER VERILMEZSE bagli oldugunu sanmaya devam eder ve her
          // isteginde kod 100 (UNKNOWN_APP) yer -- kullanici bunu "cuzdan bozuk"
          // diye okur. Oturum onceden yoksa bile bildirim ZARARSIZ (idempotent):
          // boyle bir durumda dapp zaten baglanti gormuyordur.
          await notifyTonDapp(hostname, { event: 'disconnect', id: Date.now(), payload: {} })
          sendResponse({ success: true })
        } catch (e) {
          console.error('DISCONNECT_TON_DAPP error:', e)
          sendResponse({ success: false, error: e.message })
        }
      })()
      return true

    case "SWAP":
      swap(message, sender, sendResponse)
      return true

    case "SWAP_QUOTE":
      swapQuote(message, sender, sendResponse)
      return true

    case "BRIDGE_QUOTE":
      getBridgeQuote(message, sender, sendResponse)
      return true

    case "BRIDGE":
      bridge(message, sender, sendResponse)
      return true

    case "SIGN":
      signInternal(message, sender, sendResponse)
      return true

    case "SEND_TRANSACTION":
      sendTxInternal(message, sender, sendResponse)
      return true

    case "SEND_TON_TRANSACTION":
      sendTonInternal(message, sender, sendResponse)
      return true

    case "TON_DAPP_SEND":
      tonDappSend(message, sender, sendResponse)
      return true

    case "TON_DAPP_SIGN":
      tonDappSign(message, sender, sendResponse)
      return true

    case "SEND_TON_JETTON":
      sendJettonInternal(message, sender, sendResponse)
      return true

    case "TON_FEE_IDENTITY":
      tonFeeIdentity(message, sender, sendResponse)
      return true

    case "TON_CONNECT_IDENTITY":
      tonConnectIdentity(message, sender, sendResponse)
      return true

    case "GASLESS_TOKEN_OPTIONS":
      gaslessTokenOptions(message, sender, sendResponse)
      return true

    case "ATS_FUEL_BALANCE":
      atsFuelBalance(message, sender, sendResponse)
      return true

    case "ATS_FEE_QUOTE":
      atsFeeQuote(message, sender, sendResponse)
      return true

    case "ATS_SWAP_FEE_QUOTE":
      atsSwapFeeQuote(message, sender, sendResponse)
      return true

    case "ATS_BRIDGE_FEE_QUOTE":
      atsBridgeFeeQuote(message, sender, sendResponse)
      return true

    case "ATS_RUN_ONBOARDING":
      atsRunOnboarding(message, sender, sendResponse)
      return true

    case "REVOKE_DELEGATION":
      revokeDelegation(message, sender, sendResponse)
      return true

    case "CHECK_TX_STATUS":
      checkTransactionStatus(message, sender, sendResponse)
      return true

    case 'eth_requestAccounts':
      handleConnectWallet(message, sender, sendResponse)
      return true

    case 'eth_accounts':
      handleGetAccounts(message, sender, sendResponse)
      return true

    case "eth_sendTransaction":
      sendTxDapp(message, sender, sendResponse)
      return true

    case "personal_sign":
      signMessageDapp(message, sender, sendResponse)
      return true

    case 'eth_chainId':
      handleGetChainId(sendResponse)
      return true

    case 'tonconnect_connect':
      handleTonConnect(message, sender, sendResponse)
      return true

    case 'tonconnect_restore':
      handleTonRestore(message, sender, sendResponse)
      return true

    case 'tonconnect_send':
      handleTonSend(message, sender, sendResponse)
      return true

    // Solana Wallet Standard serit. Her case YALNIZCA `return true` yapar: govde
    // solanaDappFunctions.js'te ve KENDI try/catch'inde -- dagitici buraya hicbir
    // .catch() koymuyor, yani isleyicinin icinde yakalanmayan bir hata sessizce
    // reddedilmemis bir promise birakir ve dapp'in await'i sonsuza kadar asilir.
    case 'solana_connect':
      handleSolanaConnect(message, sender, sendResponse)
      return true

    case 'solana_disconnect':
      handleSolanaDisconnect(message, sender, sendResponse)
      return true

    // IC AKSIYON (messageGate): kasayi ACAR. Yukaridaki koken kapisi bunu switch'e
    // hic ulasmadan reddeder; buradaki case yalnizca cuzdan arayuzunden gelen
    // mesaj icin vardir.
    case 'SOLANA_CONNECT_IDENTITY':
      handleSolanaConnectIdentity(message, sender, sendResponse)
      return true

    // IC AKSIYON: keyfi bir TAM ORIGIN alir ve o oturumu siler. Sayfadan
    // gelebilseydi bir web sayfasi KENDI DISINDAKI origin'lerin Solana
    // baglantilarini kesebilirdi.
    case 'DISCONNECT_SOLANA_DAPP':
      handleDisconnectSolanaDapp(message, sender, sendResponse)
      return true

    default:
      sendResponse({ error: 'Unknown message type' })
      return false
  }
})

async function swap(message, sender, sendResponse) {
  const { chainId, inTokenAddress, outTokenAddress, amount, slippage } = message.message
  const txId = uniqueKey()
  updateTxStatus(txId, 'queued', { chainId, amount, type: 'Swap' })
  
  const promise = new Promise((resolve, reject) => {
    transactionQueue.push(async () => {
      try {
        updateTxStatus(txId, 'processing', { chainId, amount, type: 'Swap' })
        const found = supported_chains.find(chain => chain.chainId === chainId)
        if (!found) throw new Error("Unsupported chain")
        // SIRA BILEREK BOYLE (iki dalin bulustugu yer):
        //  1) KIMLIK kapisi yalnizca TON OLMAYAN zincirlere uygulanir. TON kaydinin
        //     `rpc` dizisi BOS oldugu icin requireEvmChain TON'u da reddederdi -- oysa
        //     TON'da takas VAR (STON.fi) ve kendi koluna gitmeli. Solana buraya ULASIR
        //     ve burada durur: arayuz Swap ekranini Solana'da gizler ama bu mesaj eski
        //     bir popup'tan ya da baska bir sekmeden HER ZAMAN gelebilir; sessizce
        //     found.rpc[0] okumak (Solana kaydinda rpc YOK) yerine acik hata.
        //  2) AKIS kapisi HER zincir icin: "bu zincirde takas ozelligi var mi" (tek
        //     politika tablosu, chainKind.js). TON dalindan ONCE gelmeli, yoksa TON
        //     ikinci savunma katmanini atlar.
        //  3) TON dallanmasi -- provider KURULMADAN once (bkz. swapQuote'daki ayni not).
        if (!isTon(chainId)) requireEvmChain(found)
        assertChainFlow(found, 'swap')

        if (isTon(chainId)) {
          const out = await tonSwapExecute(message, txId)
          resolve(out)
          return
        }

        const provider = new ethers.JsonRpcProvider(found.rpc[0].url)
        const account = await resolveAccount(message.message)
        const wallet = await createWalletInstance(account, provider)
            
        const swapManager = new MultiChainSwapManager(wallet.privateKey, chainId)

        // ATS: swap ucreti ATS ile + OP BASINA KOMISYON (belge "Swap ve Bridge Komisyonu").
        //
        // `atsSwap` BAYRAGI KAPIYI TUTAN TEK SEYDIR — sendTxInternal'daki `atsTransfer` ile
        // ayni desen: bayragi YALNIZCA Swap ekrani gonderir. Dapp'in tetikledigi bir swap bu
        // koldan GECMEZ ve mevcut Pimlico/native yolunda kalir. Zincirden ("ATS zinciri mi")
        // TURETMEK, kullanicinin onaylamadigi islemleri ATS paymaster'ina sokardi.
        //
        // Komisyon, buildOpCallData icinde calls[0]'a konur ve YALNIZ 'local' bolgede
        // (BSC) — spoke zincirlerde komisyon zaten BSC tahsilatinin icindedir.
        const { atsSwap, atsQuoted } = message.message
        if (atsSwap && isAtsChain(chainId)) {
          // NATIVE GIRDILI SWAP (BNB -> token) ENGELLENMEZ ve bu bilincli:
          // §06.3'un hedefi native->native KOPRU rotalaridir (bkz. buildBridgeCalls). Bir
          // swap'ta `msg.value` kullanicinin KENDI hesabindan cikar — paymaster yalnizca
          // gazi oder. Bu, Send akisindaki native transferin ATS ile calismasiyla ayni
          // durumdur: kullanici gonderecek native'e sahiptir, GAZ icin native'i yoktur.
          // Blanket bir yasak, ATS zorunlu oldugu icin BNB -> token swap'ini bu on agda
          // tumden imkansiz kilardi. Yetersiz native zaten ekrandaki bakiye kontrolune takilir.
          const { calls } = await swapManager.buildSwapCalls(inTokenAddress, outTokenAddress, amount, slippage)
          const { hash, txHash } = await executeAtsTransfer({
            privateKey: wallet.privateKey, chainId, rpcUrl: found.rpc[0].url,
            calls, quoted: atsQuoted,
            // SABIT dizge — UI'dan OKUNMAZ: mesajdan gelen bir opKind komisyon tohumunu
            // dusurup fazladan bir /quote turu (ve kotu halde sessiz gelir kaybi) uretirdi.
            opKind: 'swap',
            onProgress: ({ step, total, kind }) => updateTxStatus(txId, 'processing', {
              chainId, amount, type: 'Swap', step, total, stepKind: kind,
            }),
            onRelayed: ({ txHash: relayedHash, kind }) => updateTxStatus(txId, 'processing', {
              txHash: relayedHash, chainId, amount, type: 'Swap', stepKind: kind,
            }),
          })
          updateTxStatus(txId, 'success', { txHash: txHash || hash, chainId, amount, type: 'Swap' })
          resolve({ success: true, hash })
          return
        }

        // GASLESS: approve + swap tek UserOp'ta (token ile gas)
        const { gasToken, bundlerBase } = message.message
        if (gasToken && isGaslessChain(chainId)) {
          const { calls } = await swapManager.buildSwapCalls(inTokenAddress, outTokenAddress, amount, slippage)
          const bundlerToken = await getBundlerToken({ signer: wallet, bundlerBase })
          const { hash, waitPromise } = await executeSponsored({
            privateKey: wallet.privateKey, chainId, rpcUrl: found.rpc[0].url, bundlerBase, calls, gasToken, bundlerToken,
          })
          updateTxStatus(txId, 'processing', { txHash: hash, chainId, amount, type: 'Swap' })
          resolve({ success: true, hash })
          waitPromise.then((rcpt) => {
            const ok = rcpt && rcpt.receipt?.status !== 'reverted'
            updateTxStatus(txId, ok ? 'success' : 'error', { txHash: rcpt?.receipt?.transactionHash || hash, chainId, amount, type: 'Swap' })
          }).catch(() => updateTxStatus(txId, 'error', { error: 'Swap UserOp failed', chainId, amount, type: 'Swap' }))
          return
        }

        const data = await swapManager.executeSwap(inTokenAddress, outTokenAddress, amount, slippage)

        updateTxStatus(txId, 'processing', { txHash: data.hash, chainId, amount, type: 'Swap' })
        resolve({ success: true, hash: data.hash })

        // Kuyruğu bloke etmeden Promise'in arka planda tamamlanmasını bekle!
        data.waitPromise.then((receipt) => {
          if (receipt && receipt.status === 0) {
            updateTxStatus(txId, 'error', { error: 'Transaction failed on-chain', chainId, amount, type: 'Swap' })
          } else {
            updateTxStatus(txId, 'success', { txHash: data.hash, chainId, amount, type: 'Swap' })
          }
        }).catch((e) => {
          updateTxStatus(txId, 'error', { error: e.message || 'Swap failed execution', chainId, amount, type: 'Swap' })
        });
        
      } catch (error) {
        updateTxStatus(txId, 'error', { error: error.message, chainId, amount, type: 'Swap' })
        reject({ error: error.message })
      }
    });
    processQueue();
  });

  promise.then(sendResponse).catch(sendResponse);
}

async function swapQuote(message, sender, sendResponse) {
  try {
    const { chainId, inTokenAddress, outTokenAddress, amount, slippage } = message.message
    const found = supported_chains.find(chain => chain.chainId === chainId)
    if (!found) throw new Error("Unsupported chain")
    if (!isTon(chainId)) requireEvmChain(found) // bkz. swap(): ayni sira, ayni gerekce
    assertChainFlow(found, 'swap')

    // TON EVM DEGIL ve dallanma PROVIDER KURULMADAN ONCE olmali: TON kaydinin
    // `rpc` dizisi BOS, yani `found.rpc[0].url` bir satir asagida TypeError
    // firlatirdi. Akis kapisi TON takasa acildiginda (chainKind.js) bu dal
    // olmasaydi ozellik ILK CAGRIDA patlardi - native TON gonderiminde
    // (sendTonInternal) alinan ayni karar.
    if (isTon(chainId)) return tonSwapQuoteInternal(message, sendResponse)

    const provider = new ethers.JsonRpcProvider(found.rpc[0].url)
    const account = await resolveAccount(message.message)
    const wallet = await createWalletInstance(account, provider)
    
    const swapManager = new MultiChainSwapManager(wallet.privateKey, chainId)
    const data = await swapManager.getExpectedOutput(inTokenAddress, outTokenAddress, amount, slippage)

    sendResponse({ success: true, data })
  } catch (error) {
    sendResponse({ error: error.message })
  }
}

// --- TON TAKASI ---------------------------------------------------------------
//
// EVM kolunun TEK SATIRI degismedi; TON kendi yoluna dallaniyor. Yanit SEKLI ise
// EVM'inkiyle BIREBIR ayni olmak zorunda: arayuz (Swap.vue) `expectedOutput`,
// `exchangeRate`, `depthGateWarning` ve `estimatedGasFee.totalCost` okuyor ve
// sagalayiciyi HIC bilmiyor. Sekil ayrisirsa takas ekrani TON'da bos gorunur.
//
// ONDALIKLAR MESAJLA GELIR ve varsayilani YOKTUR. Jettonlar 9 ondalik degildir
// (USDT-TON 6); bir varsayilan koymak gosterilen ciktiyi 1000 kat yanlis yapar
// ve kullanici o rakama bakarak takas onaylar.

// Teklif icin miktari HAM birime cevirir. Arayuz insan-okur ondalik gonderiyor
// ('1.5'); teklif ucu ham tamsayi bekliyor. Donusum dize tabanli
// (decimalToRawUnits) - kayan nokta carpimi miktari sessizce degistirir.
function tonSwapAssets(msg) {
  const inDecimals = Number(msg.inDecimals)
  const outDecimals = Number(msg.outDecimals)
  if (!Number.isInteger(inDecimals) || !Number.isInteger(outDecimals)) {
    throw new Error('JETTON_DECIMALS_MISSING')
  }
  return {
    offerAsset: { address: msg.inTokenAddress, decimals: inDecimals },
    askAsset: { address: msg.outTokenAddress, decimals: outDecimals },
  }
}

async function tonSwapQuoteInternal(message, sendResponse) {
  try {
    const msg = message.message
    const { offerAsset, askAsset } = tonSwapAssets(msg)

    // Arayuz kaymayi YUZDE gonderiyor (0.5 = %0.5); teklif ucu ORAN bekliyor.
    // Cevrilmezse kullanici %0.5 isterken %50 kayma ile takas ederdi.
    const slippage = Number(msg.slippage) / 100

    const quote = await getTonSwapQuote({
      apiBase: msg.apiBase,
      offerAddress: offerAsset.address,
      askAddress: askAsset.address,
      units: decimalToRawUnits(msg.amount, offerAsset.decimals).toString(),
      slippage,
    })

    const expectedOutput = toDecimalString(BigInt(quote.askUnits), askAsset.decimals)
    const minimumReceived = toDecimalString(BigInt(quote.minAskUnits), askAsset.decimals)
    const rate = Number(expectedOutput) / Number(msg.amount)

    sendResponse({
      success: true,
      data: {
        // Arayuzun OKUDUGU alanlar
        expectedOutput,
        exchangeRate: rate.toFixed(6),
        depthGateWarning: quote.priceImpact > MAX_PRICE_IMPACT,
        estimatedGasFee: {
          // TON'da onay aninda canli gaz teklifi YOK (imzali govde henuz kurulmadi).
          // Gosterilen deger SDK'nin olculmus sabitidir; fazlasi zincirde iade edilir.
          totalCost: String(TON_SWAP_GAS_DISPLAY),
          totalCostFormatted: `${TON_SWAP_GAS_DISPLAY} TON`,
          totalCostUSD: null,
          gasType: 'ton',
        },
        // Sozlesme uyumu icin doldurulan, arayuzun bugun okumadigi alanlar
        minimumReceived,
        slippageTolerance: `${Number(msg.slippage).toFixed(2)}%`,
        priceImpact: `${(quote.priceImpact * 100).toFixed(2)}%`,
        liquidityProviderFee: quote.feeUnits
          ? toDecimalString(BigInt(quote.feeUnits), askAsset.decimals)
          : 'N/A',
        reverseExchangeRate: rate > 0 ? (1 / rate).toFixed(6) : '0',
        routerType: { name: quote.router.routerType, version: quote.router.majorVersion },
        // TON'A OZEL: Gorev 10 bunu geri gonderir; kapilar (tazelik, cift
        // eslesmesi) bu nesne olmadan calisamaz.
        tonQuote: quote,
      },
    })
  } catch (error) {
    console.error('[ton] takas teklifi basarisiz:', error?.message, error)
    // Ham anahtar SIZMAZ: native TON/jetton yollariyla AYNI tablo ve AYNI yedek.
    sendResponse({
      error: TON_SEND_ERROR_MESSAGES[error.message] || TON_SEND_ERROR_FALLBACK,
      // Arayuz EVM tarafinda hata TURUNU metin icerigiyle ayirt ediyor
      // (`includes('No liquidity source found')`). TON makine anahtari
      // kullaniyor; ikisi ayni alanda bulusamaz. `code` EK bir alan olarak
      // tasiniyor: EVM kolu onu hic yazmiyor, yani mevcut davranis degismiyor.
      code: error.message,
    })
  }
}

async function tonSwapExecute(message, txId) {
  const msg = message.message
  const { chainId, amount } = msg
  const meta = { chainId, amount, type: 'Swap' }

  // Bekleyen islem kapisi KENDI KAYDIMIZI SUZER: yukaridaki
  // updateTxStatus(txId, 'queued') bu islemi zaten listeye yazdi ve
  // hasPendingTonTx 'queued' durumunu bekleyen sayiyor (bkz. sendTonInternal).
  const { current_transactions } = await chrome.storage.local.get(CURRENT_TRANSACTIONS)
  const otherPending = (current_transactions || []).filter((t) => t?.id !== txId)

  const { offerAsset, askAsset } = tonSwapAssets(msg)
  const testnet = Number(chainId) === TON_TESTNET_ID
  const account = await resolveAccount(msg)
  const { keyPair } = await createTonKeyPair(account, { testnet })

  const client = getTonClient(msg.apiBase)
  const contract = walletFromKeyPair(keyPair, testnet)
  const owner = contract.address.toString({ bounceable: false, testOnly: testnet })
  const wallet = client.open(contract)

  // SELF-PAY YOLUNUN MAKBUZ KAPISI - gonderimden ONCE (bkz. assertNoUnsettledTonFee).
  // Takas da AYNI cuzdanin seqno'sunu ilerletir ve cozulmemis bir makbuzun saklanan
  // govdesini kalici olarak oldurur - native/jetton self-pay kollariyla AYNI risk.
  // Ham kod BURADA yakalanip esleniyor (tonSendUserMessage): bu kolun ortak hata
  // yakalayicisi (`swap`, EVM ile PAYLASILAN) error.message'i HAM yaziyor.
  try {
    await assertNoUnsettledTonFee()
  } catch (error) {
    throw new Error(tonSendUserMessage(error))
  }

  const { seqno, direction } = await sendTonSwap({
    client, wallet, keyPair,
    quote: msg.tonQuote, offerAsset, askAsset, amount,
    owner, chainId, storage: chrome.storage.local,
    pendingTransactions: otherPending, testnet,
    priceImpactAcknowledged: Boolean(msg.priceImpactAcknowledged),
    routerFactory, dexFactory,
  })

  // TON'da islem hash'i gonderim aninda ELDE DEGIL; seqno degisimi islemin
  // cuzdan sozlesmesince islendiginin kanitidir (native yolla ayni).
  waitForSeqno({ contract: wallet, previous: seqno })
    .then((confirmed) => updateTxStatus(txId, confirmed ? 'success' : 'processing', meta))
    .catch(() => updateTxStatus(txId, 'processing', meta))

  return { success: true, seqno, address: owner, direction }
}

async function getBridgeQuote(message, sender, sendResponse) {
  try {
    const { fromChain, toChain, inToken, outToken, amount, filter, slippage } = message.message
    const found = supported_chains.find(chain => chain.chainId === fromChain)
    if (!found) throw new Error("Unsupported chain")
    requireEvmChain(found) // bkz. swap(): ayni gerekce
    // AKIS kapisi (TON dalinin ikinci katmani): kimlik kapisi "bu zincir EVM mi",
    // bu tablo "bu zincirde KOPRU var mi" diye sorar. Kopru TON'da BILINCLI OLARAK
    // kapali (LI.FI EVM disi zincir tasimiyor; bkz. chainKind.js FLOW.BRIDGE), yani
    // TON ikisinden de gecemez -- ama sira onemli: hatanin ADINI kimlik kapisi verir.
    assertChainFlow(found, 'bridge')

    // KOD INCELEMESI (F2): yukaridaki requireEvmChain yalnizca KAYNAK zinciri
    // (fromChain) dogruluyordu. Aktif ag her zaman EVM oldugu icin (kopru ekrani
    // zaten Task 15'te bunu zorunlu kilar) bu kontrol HER ZAMAN gecerdi -- ama
    // HEDEF (toChain) tamamen ayri bir alan ve bridge/selectToChains.vue Solana'yi
    // filtrelemeden once buraya 'solana-mainnet' gecirebiliyordu: outToken base58,
    // toChain metin, ama fromChain/toAddress hala EVM -- karisik bir teklif istegi
    // LI.FI'ye giderdi. Hedef de bir kapidan gecer -- ama AYNI kapidan degil:
    // Kapi KIMLIK kapisi: HEDEF zincirin RPC'si BIZIM tarafimizdan hic acilmaz
    // (asagidaki JsonRpcProvider KAYNAK zinciri kullanir, kopru motoru hedefi kendi
    // altyapisiyla cozer). Uc noktasi da istemek, `rpc` dizisi bos girilmis gecerli
    // bir EVM hedefine kopru kurmayi gerekcesizce engellerdi -- bkz. vm.js'teki iki
    // kapinin gerekcesi.
    const toFound = supported_chains.find((c) => isSameChainId(c.chainId, toChain))
    requireEvmVm(toFound)

    const provider = new ethers.JsonRpcProvider(found.rpc[0].url)
    const account = await resolveAccount(message.message)
    const wallet = await createWalletInstance(account, provider)
    
    const data = await bridgeQuote(fromChain, toChain, inToken, outToken, amount, filter, slippage, wallet.privateKey)

    sendResponse({ success: true, data })
  } catch (error) {
    sendResponse({ success: false, error: error.message })
  }
}

async function bridge(message, sender, sendResponse) {
  const { to, from, data, value, chain, amount, amount_raw } = message.message
  const txId = uniqueKey()
  updateTxStatus(txId, 'queued', { chainId: chain, amount: amount, type: 'Bridge' })

  const promise = new Promise((resolve, reject) => {
    transactionQueue.push(async () => {
      try {
        updateTxStatus(txId, 'processing', { chainId: chain, amount: amount, type: 'Bridge' })
        const found = supported_chains.find(c => c.chainId === chain)
        if (!found) throw new Error("Unsupported chain")
        requireEvmChain(found) // bkz. swap(): ayni gerekce
        assertChainFlow(found, 'bridge') // bkz. getBridgeQuote(): ayni iki katman

        const provider = new ethers.JsonRpcProvider(found.rpc[0].url)
        const account = await resolveAccount(message.message)
        const wallet = await createWalletInstance(account, provider)
        
        // ATS: bridge ucreti ATS ile + OP BASINA KOMISYON (belge "Swap ve Bridge Komisyonu").
        // Kapiyi `atsBridge` bayragi tutar (bkz. swap'taki ayni desen) — dapp'ler GECMEZ.
        //
        // `value > 0` olan rota (native->native kopru) buildBridgeCalls icinde FAIL-CLOSED
        // elenir: paymaster gazi oder, msg.value'yu odemez (§06.3).
        const { atsBridge, atsQuoted, approvalAddress } = message.message
        if (atsBridge && isAtsChain(chain)) {
          const calls = await buildBridgeCalls({
            to, data, value, fromTokenAddress: message.message.fromTokenAddress || from,
            owner: wallet.address, amountRaw: amount_raw, provider, approvalAddress,
          })
          const { hash, txHash } = await executeAtsTransfer({
            privateKey: wallet.privateKey, chainId: chain, rpcUrl: found.rpc[0].url,
            calls, quoted: atsQuoted,
            opKind: 'bridge',   // SABIT — bkz. swap kolundaki not
            onProgress: ({ step, total, kind }) => updateTxStatus(txId, 'processing', {
              chainId: chain, amount, type: 'Bridge', step, total, stepKind: kind,
            }),
            onRelayed: ({ txHash: relayedHash, kind }) => updateTxStatus(txId, 'processing', {
              txHash: relayedHash, chainId: chain, amount, type: 'Bridge', stepKind: kind,
            }),
          })
          updateTxStatus(txId, 'success', { txHash: txHash || hash, chainId: chain, amount, type: 'Bridge' })
          resolve({ success: true, hash })
          return
        }

        // GASLESS: bridge approve + Li.Fi call tek UserOp'ta (token ile gas)
        const { gasToken, bundlerBase, fromTokenAddress } = message.message
        if (gasToken && isGaslessChain(chain)) {
          const calls = await buildBridgeCalls({
            to, data, value, fromTokenAddress: fromTokenAddress || from, owner: wallet.address, amountRaw: amount_raw, provider,
          })
          const bundlerToken = await getBundlerToken({ signer: wallet, bundlerBase })
          const { hash, waitPromise } = await executeSponsored({
            privateKey: wallet.privateKey, chainId: chain, rpcUrl: found.rpc[0].url, bundlerBase, calls, gasToken, bundlerToken,
          })
          updateTxStatus(txId, 'processing', { txHash: hash, chainId: chain, amount, type: 'Bridge' })
          resolve({ success: true, hash })
          waitPromise.then((rcpt) => {
            const ok = rcpt && rcpt.receipt?.status !== 'reverted'
            updateTxStatus(txId, ok ? 'success' : 'error', { txHash: rcpt?.receipt?.transactionHash || hash, chainId: chain, amount, type: 'Bridge' })
          }).catch(() => updateTxStatus(txId, 'error', { error: 'Bridge UserOp failed', chainId: chain, amount, type: 'Bridge' }))
          return
        }

        const bridgeData = await crossChainSwap(to, from, data, value, chain, wallet.privateKey, amount, amount_raw)

        updateTxStatus(txId, 'processing', { txHash: bridgeData.hash, chainId: chain, amount: amount, type: 'Bridge' })
        resolve({ success: true, hash: bridgeData.hash })

        // Kuyruğu bloke etmeden Promise'in arka planda tamamlanmasını bekle!
        bridgeData.waitPromise.then((receipt) => {
          if (receipt && receipt.status === 0) {
            updateTxStatus(txId, 'error', { error: 'Bridge transaction failed on-chain', chainId: chain, amount: amount, type: 'Bridge' })
          } else {
            updateTxStatus(txId, 'success', { txHash: bridgeData.hash, chainId: chain, amount: amount, type: 'Bridge' })
          }
        }).catch((e) => {
          updateTxStatus(txId, 'error', { error: e.message || 'Bridge execution failed', chainId: chain, amount: amount, type: 'Bridge' })
        });

      } catch (error) {
        updateTxStatus(txId, 'error', { error: error.message, chainId: chain, amount: amount, type: 'Bridge' })
        reject({ success: false, error: error.message })
      }
    });
    processQueue();
  });

  promise.then(sendResponse).catch(sendResponse);
}

async function signInternal(message, sender, sendResponse) {
  try {
    const { sign_message } = message.message
    const account = await resolveAccount(message.message)
    const wallet = await createWalletInstance(account)

    // personal_sign yuku hex ise baytlarini imzala, hex metnini degil. Aksi halde
    // dapp'in ecrecover'i baska adres bulur ve imza dogrulamasi hep basarisiz olur.
    const signature = await wallet.signMessage(normalizePersonalSignMessage(sign_message))

    if(signature) sendResponse({ success: true, signature })
    else sendResponse({ success: false })
  } catch (error) {
    sendResponse({ success: false })
  }
}

async function sendTxInternal(message, sender, sendResponse) {
  const { tx, amount, chainId, asset } = message.message
  const txId = uniqueKey()
  updateTxStatus(txId, 'queued', { chainId, amount, type: 'Transaction' })
  
  const promise = new Promise((resolve, reject) => {
    transactionQueue.push(async () => {
      try {
        updateTxStatus(txId, 'processing', { chainId, amount, type: 'Transaction' })
        const found = supported_chains.find(c => c.chainId === chainId)
        if (!found) throw new Error("Unsupported chain")
        requireEvmChain(found) // bkz. swap(): ayni gerekce

        const provider = new ethers.JsonRpcProvider(found.rpc[0].url)
        const account = await resolveAccount(message.message)
        const wallet = await createWalletInstance(account, provider)

        // GASLESS: token ile gas (7702 + paymaster). tx zaten ConfirmTransaction'da
        // buildTransaction ile kuruldu; native/ERC20/dapp icin to/value/data dogru.
        const { gasToken, bundlerBase, atsTransfer, atsQuoted } = message.message

        // ATS: kullanici transferi + ATS zinciri -> ucret HER ZAMAN ATS (ozel paymaster).
        // Ilk kullanimda once bootstrap (approve) op'u, sonra transfer op'u gonderilir.
        //
        // atsTransfer BAYRAGI KAPIYI TUTAN TEK SEYDIR: bu bayragi YALNIZCA Send akisi
        // (ConfirmTransaction) gonderir. Dapp islemleri onu hic set etmez ve bu koldan
        // GECMEZ — dapp'ler mevcut Pimlico/native yolunda kalir (spec: swap/bridge/dapp
        // dokunulmaz). Gate'i gevsetmek veya kaldirmak, kullanicinin onaylamadigi dapp
        // islemlerini ATS paymaster'ina sokar.
        if (atsTransfer && isAtsChain(chainId)) {
          // ATS backend'i (bundler.watswallet.com) auth'suz + DOGRUDAN; bundlerToken/proxy YOK.
          // backendBase atsConfig'ten cozulur. Delege olmayan kullanici executeAtsTransfer
          // icinde 7702 authorization ile ilk kullanimda onboard edilir.
          const { hash, txHash } = await executeAtsTransfer({
            privateKey: wallet.privateKey, chainId, rpcUrl: found.rpc[0].url,
            call: { to: tx.to, value: tx.value, data: tx.data },
            quoted: atsQuoted,
            onProgress: ({ step, total, kind }) => updateTxStatus(txId, 'processing', {
              chainId, amount, type: 'Transaction', step, total, stepKind: kind,
            }),
            // Hash relayer'dan doner donmez kaydedilir: makbuz beklemesi zaman asimina
            // ugrasa bile zincire gitmis tx'in hash'i kaybolmaz, kullanici arayabilir ve
            // korlemesine tekrar gonderip degeri IKI KEZ yollamaz.
            onRelayed: ({ txHash: relayedHash, kind }) => updateTxStatus(txId, 'processing', {
              txHash: relayedHash, chainId, amount, type: 'Transaction', stepKind: kind,
            }),
          })
          updateTxStatus(txId, 'success', { txHash: txHash || hash, chainId, amount, type: 'Transaction' })
          resolve({ success: true, hash })
          return
        }

        if (gasToken && isGaslessChain(chainId)) {
          const calls = [{
            to: tx.to,
            value: tx.value ? BigInt(tx.value) : 0n,
            data: (tx.data && tx.data !== '0x') ? tx.data : '0x',
          }]
          const bundlerToken = await getBundlerToken({ signer: wallet, bundlerBase })
          const { hash, waitPromise } = await executeSponsored({
            privateKey: wallet.privateKey, chainId, rpcUrl: found.rpc[0].url, bundlerBase, calls, gasToken, bundlerToken,
          })
          updateTxStatus(txId, 'processing', { txHash: hash, chainId, amount, type: 'Transaction' })
          resolve({ success: true, hash })
          waitPromise.then((rcpt) => {
            const ok = rcpt && rcpt.receipt?.status !== 'reverted'
            updateTxStatus(txId, ok ? 'success' : 'error', { txHash: rcpt?.receipt?.transactionHash || hash, chainId, amount, type: 'Transaction' })
          }).catch(() => updateTxStatus(txId, 'error', { error: 'UserOp failed', chainId, amount, type: 'Transaction' }))
          return
        }

        const realTx = deserializeTx(tx)
        const txResponse = await wallet.sendTransaction(realTx)

        const pendingSkeleton = buildPendingSkeleton(txResponse, message.message)
        await saveOrUpdateTxInStorage(pendingSkeleton)

        updateTxStatus(txId, 'processing', { txHash: txResponse.hash, chainId, amount, type: 'Transaction' })
        resolve({ success: true, hash: txResponse.hash })

        // Kuyruğu bloke etmeden Promise'in arka planda tamamlanmasını bekle!
        watchTransactionResolution(txResponse, pendingSkeleton).then((receipt) => {
          if (receipt && receipt.status === 0) {
            updateTxStatus(txId, 'error', { error: 'Transaction failed on-chain', chainId, amount, type: 'Transaction' })
          } else {
            updateTxStatus(txId, 'success', { txHash: txResponse.hash, chainId, amount, type: 'Transaction' })
          }
        }).catch((e) => {
          updateTxStatus(txId, 'error', { error: 'Transaction failed or dropped', chainId, amount, type: 'Transaction' })
        });

      } catch (error) {
        // HAM hatayi HER ZAMAN yaz: asagidaki esleme kullaniciya gosterilecek metni
        // uretirken ethers'in teshis alanlarini (argument/value/shortMessage/info) yok
        // eder. "Invalid parameter." karti hangi cagrinin hangi argumanindan geldigini
        // SOYLEMEZ; bu satir olmadan kullanicidan gelen tek kanit o uc kelimedir.
        console.error('[tx] gonderim basarisiz:', {
          chainId, atsTransfer: !!message.message?.atsTransfer,
          code: error?.code, shortMessage: error?.shortMessage,
          argument: error?.argument, value: String(error?.value),
          message: error?.message, info: error?.info,
        }, error)

        let userMessage = error.message
        if (error.code === 'INSUFFICIENT_FUNDS') userMessage = 'Insufficient native balance (ETH/BNB required for Gas).'
        else if (error.message.includes('insufficient funds')) userMessage = 'Insufficient balance.'
        // Ham `shortMessage`'i metne KAT: kart zaten diger dallarda error.message
        // gosteriyor, yani bu dal tek basina bilgi kaybeden daldi.
        else if (error.code === 'INVALID_ARGUMENT') userMessage = `Invalid parameter: ${error.shortMessage || error.message} (${error.argument})`
        else if (error.message.includes('transfer amount exceeds balance')) userMessage = 'Insufficient token balance.'

        updateTxStatus(txId, 'error', { error: userMessage, chainId, amount, type: 'Transaction' })
        reject({ success: false, error: userMessage })
      }
    });
    processQueue();
  });

  promise.then(sendResponse).catch(sendResponse);
}

// sendTonInternal'in atabilecegi HER bilinen kod/dize burada anlasilir Turkce'ye
// cevrilir. Liste eksik kalirsa (ör. yeni bir TON_* kodu eklenip buraya
// eklenmezse) kullanici ham kodu GORMEZ — TON_SEND_ERROR_FALLBACK devreye girer.
// Yani "unutulan bir kod" kullaniciyi sasirtan teknik metinle degil, genel ama
// anlasilir bir mesajla karsilasir.
const TON_SEND_ERROR_MESSAGES = {
  // Bu dosyada dogrudan atilanlar
  'Unsupported chain': 'Desteklenmeyen ag.',
  'TON_TX_ALREADY_PENDING': 'Bekleyen bir TON islemi var.',
  // createTonKeyPair (bu dosya) / createWalletInstance ile AYNI ingilizce metni kullanir
  'Wallet locked. Please enter your password.': 'Cuzdan kilitli. Lutfen sifrenizi girin.',
  // tonAddress.js -> normalizeTonRecipient (buildTonTransfer icinde cagrilir)
  'TON_ADDRESS_INVALID': 'Gecersiz TON adresi.',
  'TON_ADDRESS_IS_EVM': 'Bu bir TON adresi degil.',
  'TON_ADDRESS_WRONG_NETWORK': 'Adres baska bir TON agina ait.',
  // tonSend.js -> buildTonTransfer
  'TON_AMOUNT_INVALID': 'Gecersiz miktar.',
  // tonAccount.js -> tonKeyPairFromMnemonic / tonKeyPairFromPrivateKey / deriveTonAccount
  'TON_INDEX_INVALID': 'Hesap indeksi gecersiz.',
  'TON_SEED_INVALID': 'Gecersiz ozel anahtar.',
  'TON_SECRET_MISSING': 'Hesap bilgisi okunamadi.',
  // deriveTonAccount'un iki sema kapisi. Ikisi de ULASILABILIR: imzalama yolu
  // artik kasa tipini turetmeye geciriyor (createTonKeyPair -> tonIdentityForAccount),
  // yani kasa tipi ile sema uyusmazsa kullanici bu mesaji GORUR. Eksik kalsalardi
  // gurultulu basarisizlik genel bir "islem gonderilemedi"ye duser ve sebep kaybolurdu.
  'TON_SECRET_KIND_INVALID': 'Hesap turu cozulemedi. Lutfen destege basvurun.',
  'TON_SECRET_KIND_MISMATCH': 'Hesap kasasi ile anahtar turu uyusmuyor. Guvenlik icin islem durduruldu.',
  // tonMnemonic.js -> tonKeyPairFromTonMnemonic (TON kasasindan turetme)
  'TON_MNEMONIC_INVALID': 'TON kurtarma ifadesi gecerli degil.',
  // tonIdentity.js -> tonSecretForAccount
  'ACCOUNT_VAULT_NOT_FOUND': 'Hesap kasasi bulunamadi.',
  'IMPORTED_SECRET_NOT_FOUND': 'Ice aktarilan hesap bilgisi bulunamadi.',
  // tonIdentity.js -> tonVaultForAccount. Hibrit hesabin tonFingerprint i
  // isaret ettigi TON kasasi silinmis/tasinmis demektir; EVM kasasina SESSIZCE
  // dusup yanlis adresi imzalamak yerine kullaniciya acikca soylenir.
  'TON_VAULT_NOT_FOUND': 'Bu hesabin TON kasasi bulunamadi.',
  // tonClient.js -> getTonClient
  'TON_API_BASE_MISSING': 'Sunucuya baglanilamadi.',

  // --- JETTON YOLU ---
  // jettonTransfer.js -> buildJettonTransferBody
  'JETTON_DECIMALS_MISSING': 'Token ondalik bilgisi eksik. Bu token gonderilemez.',
  'JETTON_DECIMALS_INVALID': 'Token ondalik bilgisi gecersiz. Bu token gonderilemez.',
  'JETTON_FORWARD_TON_ZERO': 'Islem kurulamadi. Lutfen tekrar deneyin.',
  'JETTON_AMOUNT_INVALID': 'Gecersiz miktar.',
  'JETTON_AMOUNT_PRECISION': 'Miktar bu tokenin ondalik basamak sayisini asiyor.',
  'JETTON_RESPONSE_DESTINATION_MISSING': 'Islem kurulamadi. Lutfen tekrar deneyin.',
  // jettonSend.js -> dort kapi
  'JETTON_RECIPIENT_IS_JETTON_WALLET': 'Bu adres bir token cuzdani, kisi cuzdani degil. Buraya gonderilen token KAYBOLUR.',
  'JETTON_RECIPIENT_CHECK_FAILED': 'Alici adresi dogrulanamadi. Baglantinizi kontrol edip tekrar deneyin.',
  'JETTON_INSUFFICIENT_BALANCE': 'Token bakiyeniz yetersiz.',
  'JETTON_INSUFFICIENT_TON': 'Islem ucreti icin TON bakiyeniz yetersiz. Token gonderimi TON ile ucretlendirilir.',

  // --- RELAY YOLU (TON ucret sponsorlugu) - tonFeeRelayer.js:TonRelayerError ---
  // Hepsi RELAY'E CIKILMADAN ONCE duser, yani ucret ALINMAMISTIR; metinler bunu
  // ima etmeli - kullaniciyi "ucretim gitti mi" belirsizliginde birakmak yanlis.
  'TON_RELAY_UNAVAILABLE': 'Ucret sponsorlugu su anda kapali. TON ile odeyerek gonderebilirsiniz.',
  'TON_RELAY_NO_EVM_VAULT': 'Bu hesabin ucreti odeyecek BSC anahtari yok. TON ile odeyerek gonderebilirsiniz.',
  'TON_RELAY_PENDING_SETTLEMENT': 'Cozulmemis bir ucret kaydi var. Once onun sonuclanmasi bekleniyor.',
  'TON_RELAY_UNSUPPORTED_ACTION': 'Bu islem ucret sponsorlugu ile gonderilemez.',
  'TON_RELAY_NO_RECEIPT_STORE': 'Islem kaydi diske yazilamadi; ucret ALINMADAN durduruldu.',
  'TON_RELAY_COMMENT_UNSUPPORTED': 'Notlu gonderimler ucret sponsorlugu ile yapilamaz. Notu kaldirin ya da TON ile odeyin.',

  // --- TONCONNECT DAPP YOLU (tonDappSend, gorev 9) ---
  // Imzalayan cuzdan, onay ekraninda kullaniciya gosterilen `from` ile
  // ESLESMEZSE (bkz. tonDappSend'deki assertion) islem DURDURULUR - baska bir
  // hesabin fonlarinin sessizce harcanmasindansa gurultulu bir hata tercih edilir.
  'TON_DAPP_FROM_MISMATCH': 'Imzalayan hesap onaylanan hesapla uyusmuyor. Islem durduruldu.',
  // signingMessage.storeUint(timeout, 32) icin sinir disi bir deger (or. dapp
  // valid_until'i MILISANIYE yollamis).
  'TON_DAPP_VALID_UNTIL_INVALID': 'Islem gecerlilik suresi gecersiz.',
  // Onay ekraninda GECEN sure yuzunden valid_until IMZALAMA aninda dolmus.
  'TON_DAPP_REQUEST_EXPIRED': 'Bu islemin onay suresi doldu. Lutfen tekrar deneyin.',
}
const TON_SEND_ERROR_FALLBACK = 'Islem gonderilemedi. Lutfen tekrar deneyin.'

// Dogrulama reddi (tonQuoteVerify, Task 2) bir AG ARIZASI DEGILDIR: sunucunun
// kurdugu govde kullanicinin niyetinden sapti. On alti ayri kodun HEPSI icin ayri
// metin yazmak listeyi kacinilmaz sekilde eskitirdi (yeni bir kod eklenir, buraya
// yazilmaz) ve zaten kullaniciya soyleyecegimiz sey ayni. Onemli olan, GENEL
// "tekrar deneyin" yedegine DUSMEMESI: ayni istek yine ayni govdeyi getirir ve
// kullanici sonunda "sorun yok" deyip zorlamaya calisir.
const TON_QUOTE_VERIFY_MESSAGE = 'Sunucudan gelen islem govdesi dogrulanamadi. Guvenlik icin gonderim durduruldu.'

// Ham kod/mesaj kullaniciya HIC gecmez (native ve jetton kollarinin ORTAK esleyicisi).
function tonSendUserMessage(error) {
  if (error?.name === 'TonQuoteVerifyError') return TON_QUOTE_VERIFY_MESSAGE
  return TON_SEND_ERROR_MESSAGES[error?.message] || TON_SEND_ERROR_FALLBACK
}

// --- TON UCRET RELAY YOLU (gasless gonderim, tasarim belgesi bolum 5) --------
//
// SIRANIN TAMAMI utils/ton/tonFeeRelayer.js'te (dogrulama -> iki imza -> makbuz ->
// relay) ve orada testle kilitli. Burasi o dosyanin KENDI BASINA URETEMEYECEGI dort
// seyi verir - saf/testlenebilir kalabilmesi icin bilerek disarida birakilmislardi:
//
//   1. ZINCIRDEN TAZE seqno. tonFeeRelayer tazeligi DOGRULAMAZ (dogrulayamaz da: saf
//      dosya zincire cikmaz). Bayat bir seqno sunucunun kurdugu govdeyi gecersiz
//      kilar - iki imza uretilir, ucret tahsil edilir ve mesaj zincirde HIC islenmez.
//   2. GONDERENIN KENDI JETTON CUZDANI (jettonAddress.js - zincir okumasi, paymaster
//      DEGIL). "Hangi token gitti" sorusunun tek cevabi budur: ic alici ve ic tutar
//      niyetle BIREBIR ayni olsa bile, ele gecirilmis bir sunucu kullanicinin BASKA
//      bir jetton cuzdanindan gecen bir govde kurarsa YANLIS token gider
//      (tonQuoteVerify V5). Tasinmazsa dogrulama KAPALI tarafa duser: guvenli, ama
//      jetton yolu tumden olu.
//   3. GERCEK IMZALAYANLAR: ed25519 TON anahtari ve BSC'deki EVM kasasi.
//   4. ISLEM KAYDI ile MAKBUZ SILME arasindaki SIRA (bkz. tonRelayExecute).
//
// KAPILAR: relay yolu sendTon/sendJetton'u ATLADIGI icin onlarin kapilari da
// atlanmis olur. Para-kritik olanlar asagida TEKRAR kurulur - gecersiz bir alici ya
// da alici olarak yazilmis bir jetton cuzdani icin ucret odenmesi (ve tokenin
// kaybolmasi) kabul edilebilir degil. Bakiye kapilari BURADA DEGIL: iliskilendirilen
// TON'u sunucu seciyor (quote.attachNanoton) ve arayuz gonderimden once zaten
// bakiyeye bakiyor.

// Islem kaydinin relay bayragi. YETIM TARAMASI YALNIZ bu bayragi tasiyan kayitlari
// gorur (tonFeeRecovery.js:TON_RELAY_TX_FLAG); self-pay gonderimleri de makbuzsuzdur
// ve bayraksiz bir tarama onlara da "islem baslatilamadi, ucret alinmadi" derdi -
// self-pay'de yanlis olan ve cift gonderim riskini geri acan bir cumle.
//
// Bayrak ILK yazmada ('queued') konur, relay dalina girildikten sonra DEGIL: service
// worker her await'te olebilir ve bayraksiz kalan bir kayit kurtarmanin gorus alanina
// HIC girmez.
const tonTxMeta = (base, relayMode) => (relayMode ? { ...base, [TON_RELAY_TX_FLAG]: true } : base)

// Sunucunun anlamsal eylem sozlesmesinde YORUM ALANI YOK (tasarim 2.2; tonFeeRelayer
// da yalniz kind/to/amountNano ve jetton karsiliklarini taniyor). Yorumu SESSIZCE
// dusurmek en pahali sessiz hata olurdu: memosuz giden bir borsa yatirimi KAYIP
// sayilir (bkz. jettonSend.js JETTON_FORWARD_TON notu). Bu yuzden acikca reddedilir.
// Acik anahtarin TEK yazimi. Iki yerde uretiliyor - onizleme teklifi (TON_FEE_IDENTITY,
// arayuze giden) ve gercek gonderim (tonRelayExecute, dogrulamaya giden) - ve ikisi
// AYRISIRSA sunucunun donderdigi feeAuth.tonPublicKey biriyle eslesir otekiyle
// eslesmez: dogrulama V6 (TON_QUOTE_PUBKEY_MISMATCH) duser ve kullanici fiyati GORDUGU
// bir gonderimde "govde dogrulanamadi" alir.
const tonPublicKeyHex = (keyPair) => '0x' + Buffer.from(keyPair.publicKey).toString('hex')

function assertRelayComment(comment) {
  if (String(comment ?? '').trim()) throw new Error('TON_RELAY_COMMENT_UNSUPPORTED')
}

// IKINCI KEZ ODETMEME KAPISININ SELF-PAY YARISI (tasarim bolum 6: "Ikinci kez
// odetmeme kapisi MODDAN BAGIMSIZ: cozulmemis makbuz varken hem relay hem
// self-pay yolu kapanir").
//
// Kapinin relay yarisi tonFeeRelayer.js'in 4. adiminda (executeTonViaRelayer)
// zaten vardi; self-pay yarisi HIC KURULMAMISTI ve boslugun bedeli tam olarak
// tasarimin adini koydugu kayip:
//
//   relay ucreti tahsil eder -> yanit kaybolur (ag hatasi; esem 'keep', makbuz
//   CANLI kalir) -> islem karti 'error' yazilir ve hasPendingTonTx yalniz
//   'queued'/'processing' saydigi icin ARTIK ENGELLEMEZ -> kullanici tekrar
//   dener -> deneme self-pay'e duserse (not ekledi ya da /status kapandi)
//   sendTon/sendJetton/sendTonSwap SEQNO'YU ILERLETIR ve makbuzdaki payloadBoc
//   (belirli bir seqno'ya KILITLI) KALICI OLARAK olur.
//
// Sonuc: ucret alinmis, islem hicbir zaman gonderilmemis, geri donusu YOK -
// ucret iade edilmiyor. Kilidin cikisi TTL degil `deadline`dir (saniyeler-
// dakikalar; bkz. hasUnsettledTonFee) - tam da kullaniciyi kalici kilitlememek
// icin.
//
// KAPSAM: native (sendTonInternal), jetton (sendJettonInternal) VE takas
// (tonSwapExecute) self-pay kollarinin UCU DE.
//
// TON TAKASI (tonSwapExecute) ONCE DISARIDA birakilmisti: kolun ortak hata
// yakalayicisi (`swap`, EVM ile PAYLASILAN) `error.message`i HAM yaziyor, yani
// kullanici islem kartinda "TON_RELAY_PENDING_SETTLEMENT" dizesini gorurdu.
// Inceleme bunun engel OLMADIGINI gosterdi: ayni kart zaten TON_SWAP_* kodlarini
// (tonSwap.js) ham yaziyor - kapi yeni bir kusur sinifi ACMAZ, var olana katilir.
// Kapi tonSwapExecute icinde KENDI govdesinde kurulur ve firlatmadan once
// tonSendUserMessage ile esler, yani ortak yakalayiciya ZATEN okunabilir metin
// gelir (bkz. tonSwapExecute govdesindeki not).
async function assertNoUnsettledTonFee() {
  const settlements = await loadAllTonSettlements()
  if (hasUnsettledTonFee(settlements)) throw new Error('TON_RELAY_PENDING_SETTLEMENT')
}

/**
 * Relay yolunun ORTAK govdesi - native TON ve jetton kollari AYNI fonksiyonu cagirir;
 * aralarindaki tek fark `actions` ve onu cagiran kurar.
 *
 * @param {object} args
 * @param {object} args.wallet  ZATEN ACILMIS (client.open) W5 sozlesmesi - taze seqno
 *   buradan okunur; self-pay yolunun kullandigi AYNI cagri (`getSeqno`).
 * @param {string} args.tonWallet  gonderenin W5 adresi (friendly)
 * @param {object} args.meta  islem kaydinin meta'si (relay bayragini TASIR)
 */
async function tonRelayExecute({ account, keyPair, wallet, tonWallet, actions, approvedAtsFee, txId, meta }) {
  // 1. TAZE seqno - ZINCIRDEN, onbellekten degil.
  const seqno = await wallet.getSeqno()

  const { vaults } = await chrome.storage.local.get('vaults')

  const out = await executeTonViaRelayer({
    account,
    vaults,
    actions,
    intent: {
      tonWallet,
      tonPublicKey: tonPublicKeyHex(keyPair),
      seqno,
      // Dogrulamanin (V11) deadline penceresini olctugu an. saniye - feeAuth.deadline
      // ile AYNI birim.
      now: Math.floor(Date.now() / 1000),
    },
    approvedAtsFee,
    txId,
    signers: {
      // IMZA A (ed25519): HAM BAYT alir, HAM BAYT doner - hex'e cevirmek
      // tonFeeRelayer'in isi ve orada TEK yerde yapiliyor.
      tonSign: async (bytes) => sign(Buffer.from(bytes), keyPair.secretKey),
      // IMZA B (secp256k1/BSC): kasa yalnizca imza suresince acilir ve anahtar bu
      // fonksiyonun kapsami disina CIKMAZ. TON'a KILITLI bir hesapta buraya HIC
      // gelinmez - tonFeeRelayer'in 3. kapisi (evmVaultResolvable) ondan once
      // TON_RELAY_NO_EVM_VAULT firlatir.
      evmSignTypedData: async (domain, types, value) => {
        const evmWallet = await createWalletInstance(account, null)
        return await evmWallet.signTypedData(domain, types, value)
      },
    },
  })

  // SIRA PAZARLIK DISI: ONCE ISLEM DURUMU, SONRA MAKBUZUN SILINMESI.
  //
  // Ters sirada service worker tam aradan olurse islem 'processing'te MAKBUZSUZ
  // kalir - bu, yetim taramasinin (tonFeeRecovery.js:scanOrphanTxs) imzasinin ta
  // kendisidir ve ucreti GERCEKTEN alinmis bir islemi "ucret alinmadi" diye
  // etiketler. Bayat bir makbuz kurtarilabilir (kurtarma zincirden dogrulayip
  // siler); yanlis etiketlenmis bir islem YALANDIR ve 'unresolved' terminal oldugu
  // icin DUZELMEZ.
  //
  // 'sent' DISINDA hicbir sey yazilmaz: bos/null bir 2xx govdesi GERCEKTEN
  // belirsizdir (tonFeeRelayer'in asimetrik risk kurali) - kart 'processing'te
  // kalir, makbuz durur ve karari kurtarma verir.
  //
  // YAZILAN DEGER 'processing', 'success' DEGIL (inceleme turu 1 hakemligi).
  // /relay'in DOLU bir govde donmesi "RELAYER KABUL ETTI" demektir - "ZINCIR
  // ISLEDI" demek DEGIL. Self-pay yolu 'success'i ancak waitForSeqno seqno'nun
  // ILERLEDIGINI gordukten sonra yaziyor; relay yolunun DAHA ZAYIF bir sinyalle
  // ayni sonucu yazmasi, zincirde reddedilen bir transferi (orn. bakiye yarista
  // dustu) "gonderildi" diye gosterirdi. Onay asagida AYNI standarttan gecer.
  //
  // MAKBUZ yine de SILINIR: makbuzun isi UCRETI yeniden denemek ve /relay govde
  // donduyse ucret ARTIK KESINLESMISTIR. Onayi beklemek icin saklamak, SW olum
  // penceresini hicbir sey kazanmadan genisletirdi - islem DURUMU ayri bir soru.
  if (out?.status === 'sent') {
    // BAYRAK BURADA DUSURULUR. Yetim taramasinin sordugu soru "makbuz yazilmadan
    // mi olduk" - relay KABUL EDIP makbuzu BILEREK sildikten sonra o cikarim ARTIK
    // YANLIS. Bayrak birakilsaydi, waitForSeqno'nun 45 sn icinde dogrulayamadigi
    // her gonderim 10 dakika sonra "islem baslatilamadi, ucret alinmadi" diye
    // etiketlenirdi: tam da bu gorevin onlemek icin var oldugu yalan, bu kez
    // kurtarmanin kendi agzindan.
    const sentMeta = { ...meta, [TON_RELAY_TX_FLAG]: false }
    await updateTxStatus(txId, 'processing', sentMeta)
    await clearTonSettlement(out.settlementKey)

    // ONAY: self-pay yolunun KULLANDIGI AYNI cagri ve AYNI kural. `false`
    // "BASARISIZ" DEGIL, "sure icinde dogrulanamadi" demektir - 'error' yazmak
    // kullaniciyi tekrar gondermeye iter. BEKLENMEZ: kullanici arayuze hemen
    // doner (self-pay yolundaki ayni desen).
    waitForSeqno({ contract: wallet, previous: seqno })
      .then((confirmed) => updateTxStatus(txId, confirmed ? 'success' : 'processing', sentMeta))
      .catch(() => updateTxStatus(txId, 'processing', sentMeta))
  }
  return out
}

// Ucret KARTININ (Task 8) tutar gosterebilmesi icin /quote'a `tonPublicKey` gerekir
// ve o deger yalnizca KASADAN cikar. Bilesen kasaya erisemez - erisMEMELI de: onizleme
// kilitli cuzdanda da calisabilmeli ve bir arayuz bileseninin sifre cozmesi icin hicbir
// sebep yok. Bu mesaj kasadan YALNIZCA ACIK anahtari cikarir; ozel anahtar bu
// fonksiyonun kapsami disina HIC cikmaz.
//
// Cuzdan kilitliyse createTonKeyPair firlatir ve `success:false` doner - kart o zaman
// tutarsiz kalir (bolge kapisi yine calisir), ki dogru davranis budur.
async function tonFeeIdentity(message, sender, sendResponse) {
  try {
    const data = message.message || {}
    const testnet = Number(data.chainId) === TON_TESTNET_ID
    const account = await resolveAccount(data)
    const { keyPair, friendly } = await createTonKeyPair(account, { testnet })
    // `evmCapable` arayuzun relay SECENEGINI hic gostermemesi icin: TON'a kilitli
    // hesapta ATS'i BSC'de imzalayacak anahtar YOK ve bunu gonderim aninda
    // soylemek kullaniciyi cikmaza sokuyordu (ekranda donebilecegi bir secenek
    // yok - mod bolgeden turuyor). Yuklem tonFeeRelayer'in KENDI kapisiyla AYNI
    // fonksiyon; kopyalansaydi ikisi ayrisir ve secenek yine gosterilirdi.
    const { vaults } = await chrome.storage.local.get('vaults')
    sendResponse({
      success: true,
      tonPublicKey: tonPublicKeyHex(keyPair),
      tonWallet: friendly,
      evmCapable: evmVaultResolvable(vaults, account),
    })
  } catch (error) {
    console.error('[ton] ucret kimligi cozulemedi:', error?.message)
    sendResponse({ success: false, error: tonSendUserMessage(error) })
  }
}

// TonConnect onay ekraninin (Task 9+) TEK kimlik kaynagi.
//
// TON_FEE_IDENTITY YENIDEN KULLANILMAZ: o akisin adi ve govdesi ucret
// onizlemesine ait, yalniz ACIK anahtari (hex) ve friendly (UQ/EQ) adresi
// donuyor. TonConnect'in ton_addr yaniti ise RAW adres (0:<hex>), hex
// publicKey VE henuz zincirlenmemis cuzdanlar icin walletStateInit ister --
// bugun hicbiri disari cikmiyor.
//
// Turetme AYNI YOLDAN gecer (createTonKeyPair -> tonIdentityForAccount, bu
// dosyanin TEK turetme bogazi): ikinci bir anahtar turetme yolu ACILMAZ. TEK
// W5 cuzdan fabrikasi da AYNI (walletFromKeyPair -> tonAccount.js:tonWalletContract)
// -- ayri bir kurulum, kullaniciya gosterilen adresle imzalayan sozlesmenin
// zamanla birbirinden SAPMASINA yol acardi (tonSend.js'teki ayni gerekce).
//
// Bu aksiyon INTERNAL_ACTIONS'ta (messageGate.js), DAPP_METHODS'ta DEGIL:
// kasayi acar, bir web sayfasi bunu asla dogrudan cagirabilmemeli.
async function tonConnectIdentity(message, sender, sendResponse) {
  try {
    const data = message.message || {}
    const testnet = Number(data.chainId) === TON_TESTNET_ID
    const account = await resolveAccount(data)
    const { keyPair } = await createTonKeyPair(account, { testnet })

    const contract = walletFromKeyPair(keyPair, testnet)
    // walletStateInit: henuz zincirlenmemis (seqno=0) bir cuzdan icin dapp'in
    // ilk islemi kurabilmesi icin sarttir -- StateInit'i BOC'a saran TEK bicim
    // (@ton/core storeStateInit), elle hucre kurmak degil.
    const stateInit = beginCell().store(storeStateInit(contract.init)).endCell()

    sendResponse({
      success: true,
      address: contract.address.toRawString(),
      publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
      walletStateInit: stateInit.toBoc().toString('base64'),
    })
  } catch (error) {
    console.error('[ton] tonconnect kimligi cozulemedi:', error?.message)
    sendResponse({ success: false, error: tonSendUserMessage(error) })
  }
}

async function sendTonInternal(message, sender, sendResponse) {
  const { chainId, amount, to, comment, apiBase, payWithTonFee, approvedAtsFee } = message.message
  const txId = uniqueKey()
  // Relay modu ARAYUZDEN gelir (kullanici ucret kartini gordu ve onayladi) ama
  // BAGLAYICI DEGILDIR: bolge, EVM kasasi ve cozulmemis makbuz kapilarinin hepsi
  // executeTonViaRelayer'in icinde, sunucunun TAZE /status yanitiyla yeniden olculur.
  // Buradaki bayrak yalnizca "hangi yol" sorusunu cevaplar, yetki vermez.
  const relayMode = payWithTonFee === true
  const meta = tonTxMeta({ chainId, amount, type: 'Transaction' }, relayMode)
  updateTxStatus(txId, 'queued', meta)

  const promise = new Promise((resolve, reject) => {
    transactionQueue.push(async () => {
      try {
        if (!isTon(chainId)) throw new Error('Unsupported chain')

        // Bekleyen TON islemi varken ikinciye izin YOK: ayni seqno ile gonderilen
        // ikinci islem sessizce duser, kullanici tekrar gonderir ve deger iki kez gider.
        // KENDI KAYDIMIZ HARIC - jetton yolundaki (sendJettonInternal) ayni gerekce:
        // yukaridaki `updateTxStatus(txId, 'queued', ...)` bu islemi listeye yaziyor
        // ve 'queued' bekleyen sayiliyor. Bugun kapiya takilmiyoruz cunku
        // updateTxStatus await edilmiyor ve yazma genelde bu okumadan sonra iniyor -
        // yani dogru davranis bir YARISA bagli. Kimligi suzmek yarisi kaldirir;
        // eledigimiz kayit henuz gonderilmemis olan, tam su an kurdugumuz islem.
        const { current_transactions } = await chrome.storage.local.get(CURRENT_TRANSACTIONS)
        if (hasPendingTonTx((current_transactions || []).filter((t) => t?.id !== txId))) {
          throw new Error('TON_TX_ALREADY_PENDING')
        }

        updateTxStatus(txId, 'processing', meta)

        const testnet = Number(chainId) === TON_TESTNET_ID
        const account = await resolveAccount(message.message)
        const { keyPair } = await createTonKeyPair(account, { testnet })

        const client = getTonClient(apiBase)

        if (relayMode) {
          assertRelayComment(comment)
          // Alici + miktar dogrulamasi self-pay ile AYNI fonksiyondan gecer
          // (buildTonTransfer): relay yolu sendTon'u atladigi icin bu kapi burada
          // TEKRAR kurulmali - gecersiz bir adres ya da nanoton'a yuvarlandiginda
          // sifirlanan bir miktar icin ucret odemek kabul edilemez. Kapiyi
          // KOPYALAMIYORUZ, AYNISINI cagiriyoruz; iki ayri kopya kacinilmaz sekilde
          // ayrisirdi.
          const transfer = buildTonTransfer({ to, amount, comment: '', testnet })

          const contract = walletFromKeyPair(keyPair, testnet)
          const address = contract.address.toString({ bounceable: false, testOnly: testnet })

          await tonRelayExecute({
            account, keyPair, wallet: client.open(contract), tonWallet: address,
            approvedAtsFee, txId, meta,
            actions: [{ kind: 'ton', to: transfer.to, amountNano: transfer.value.toString() }],
          })

          // Kart durumunu tonRelayExecute yazdi (ya da BILEREK yazmadi - belirsiz
          // yanitta kurtarma karar verir). Burada seqno DONDURULMEZ: govdeyi biz
          // yayinlamadik, bekleyecek bir seqno degisimimiz de yok.
          resolve({ success: true, address })
          return
        }

        // SELF-PAY YOLUNUN MAKBUZ KAPISI - gonderimden ONCE (bkz.
        // assertNoUnsettledTonFee). Buradan sonrasi seqno'yu ilerletir ve
        // cozulmemis bir makbuzun saklanan govdesini kalici olarak oldurur.
        await assertNoUnsettledTonFee()

        const { seqno, address } = await sendTon({ client, keyPair, to, amount, comment, testnet })

        // TON'da islem hash'i gonderim aninda ELDE DEGIL. seqno degisimi, islemin
        // cuzdan sozlesmesince islendiginin kanitidir; kart bunu bekler.
        resolve({ success: true, seqno, address })

        // seqno izleme kuyrugu BLOKE ETMEZ: kullanici arayuze hemen doner.
        const wallet = client.open(walletFromKeyPair(keyPair, testnet))
        waitForSeqno({ contract: wallet, previous: seqno })
          .then((confirmed) => {
            // `false` "BASARISIZ" DEGIL, "sure icinde dogrulanamadi" demektir. Islem
            // zincire gitmis olabilir; 'error' yazmak kullaniciyi tekrar gondermeye
            // iter ve deger iki kez gidebilir. Bu yuzden 'processing'de birakilir.
            updateTxStatus(txId, confirmed ? 'success' : 'processing', meta)
          })
          .catch(() => {
            updateTxStatus(txId, 'processing', meta)
          })
      } catch (error) {
        // HAM hatayi HER ZAMAN yaz: kullaniciya gosterilen metin asagida GENELLESTIRILIYOR,
        // teshis icin ham kod/mesaj yalnizca burada kalir.
        console.error('[ton] gonderim basarisiz:', { chainId, message: error?.message }, error)

        // Eslenmemis hicbir kod HAM gecmesin: kullanici "TON_SEED_INVALID" gibi bir
        // teknik kod gormemeli. Bilinmeyen bir hata icin GENEL ama anlasilir bir
        // yedek mesaj kullanilir; ham error.message yalnizca yukaridaki console.error'da kalir.
        const userMessage = tonSendUserMessage(error)

        updateTxStatus(txId, 'error', { ...meta, error: userMessage })
        reject({ success: false, error: userMessage })
      }
    })
    processQueue()
  })

  promise.then(sendResponse).catch(sendResponse)
}

/**
 * TonConnect onay ekranindan gelen imzala-ve-yayinla.
 *
 * AYNI KUYRUK, AYNI KAPI: TON'da bekleyen bir islem varken ikincisi AYNI seqno ile
 * gonderilir ve sessizce duser. Dapp islemini ayri bir yola koymak, kullanicinin
 * bekleyen transferiyle carpistirir ve birini kaybettirirdi. sendTonInternal ile
 * AYNI kalip: kuyruk, updateTxStatus (queued->processing), hasPendingTonTx
 * (KENDI kaydi filtrelenerek), assertNoUnsettledTonFee, waitForSeqno.
 */
async function tonDappSend(message, sender, sendResponse) {
  const { messages, validUntil, apiBase, account: accountFromUi, from: approvedFrom } = message.message
  const txId = uniqueKey()

  // meta (chainId DAHIL) ve 'queued' yazmasi KUYRUGA GIRMEDEN ONCE kurulur -
  // sendTonInternal'daki AYNI sira. Aksi halde islem kuyrukta bekleyen BASKA bir
  // gorevin arkasinda kalirsa gecmis karti o bitene kadar hic gorunmez.
  //
  // BU BLOK KENDI try/catch'INE SAHIP (inceleme turu 2): `messages` bozuksa
  // (dizi degil, ya da amountNano BigInt'e cevrilemeyen bir deger tasiyorsa)
  // asagidaki reduce/BigInt cagirisi FIRLAR. Dispatcher tonDappSend'i .catch
  // OLMADAN cagiriyor (case "TON_DAPP_SEND": tonDappSend(...); return true), ve
  // buradaki firlatma KUYRUGA GIRMEDEN once oldugu icin asagidaki kuyruklu isin
  // catch'i buraya ERISMEZ - yakalanmazsa sendResponse HIC CAGRILMAZ ve dapp'in
  // istegi SESSIZCE, SONSUZA KADAR asilir kalir (Gorev 8'de zaman asimi
  // olmayan manifest indirmesiyle KAPATILAN acigin AYNISI).
  let meta
  let testnet
  try {
    const { currentNetwork } = await chrome.storage.local.get('currentNetwork')
    testnet = Number(currentNetwork?.chainId) === TON_TESTNET_ID
    // hasPendingTonTx meta.chainId'ye GERCEK bir TON kimligi (-239/-3) bekler
    // (bkz. tonPending.js:isTon) -- baska bir deger yazilirsa bu kayit kapinin
    // KENDISI icin GORUNMEZ olur ve bekleyen-islem korumasi sessizce delinir.
    const chainId = testnet ? TON_TESTNET_ID : TON_MAINNET_ID
    const amountNanoTotal = messages.reduce((sum, m) => sum + BigInt(m.amountNano), 0n)
    meta = tonTxMeta({ chainId, amount: fromNano(amountNanoTotal), type: 'TonConnect' })
    updateTxStatus(txId, 'queued', meta)
  } catch (error) {
    console.error('[ton] dapp gonderimi kuyruga alinamadi:', error?.message, error)
    sendResponse({ success: false, error: tonSendUserMessage(error) })
    return
  }

  const promise = new Promise((resolve, reject) => {
    transactionQueue.push(async () => {
      try {
        // Bekleyen TON islemi varken ikinciye izin YOK (sendTonInternal'daki AYNI
        // gerekce). KENDI KAYDIMIZ HARIC: yukaridaki updateTxStatus(txId, 'queued', ...)
        // bu islemi ZATEN listeye yaziyor ve 'queued' bekleyen sayiliyor.
        const { current_transactions } = await chrome.storage.local.get(CURRENT_TRANSACTIONS)
        if (hasPendingTonTx((current_transactions || []).filter((t) => t?.id !== txId))) {
          throw new Error('TON_TX_ALREADY_PENDING')
        }

        updateTxStatus(txId, 'processing', meta)

        const account = await resolveAccount({ account: accountFromUi })
        const { keyPair } = await createTonKeyPair(account, { testnet })

        // `walletFromKeyPair` ZATEN import edili ve sendTonInternal de onu kullaniyor.
        // Ikinci bir sozlesme kurma yolu acmak, iki yolun zamanla ayrisip FARKLI
        // adres uretmesi demekti (bkz. tonSend.js'teki ayni not).
        const contract = walletFromKeyPair(keyPair, testnet)

        // ONAYLANAN HESABA KILIT: onay ekraninda kullaniciya gosterilen `from`
        // (current_request.from, session.address) ile burada COZULEN anahtarin
        // adresi AYNI olmali. accountFromUi yanlis/eski bir hesaba (or.
        // resolveAccount'un active_account'a sessiz dusmesiyle) isaret ederse,
        // imzalayan cuzdan kullaniciya gosterilenden BASKA biri olurdu -
        // plumbing (current_request.accountKey) yalnizca kolaylik, GERCEK kilit
        // budur ve GURULTULU basarisiz olur.
        //
        // Address.parse(...).equals(...) KULLANILIR, duz dize karsilastirmasi
        // DEGIL (inceleme turu 2): Gorev 12 (onay ekrani) henuz yazilmadi ve
        // `from`u FRIENDLY (EQ.../UQ...) bicimde geri gonderebilir - o zaman
        // `toRawString()` ile dize karsilastirmasi HER MESRU gonderimi
        // reddederdi. Ayristirilamayan bir deger de (bos, bozuk) parse
        // FIRLATSA BILE GURULTULU sekilde reddedilir (asagidaki try/catch) -
        // sessizce gecmez, ACIK bir eslesmeye DUSER.
        let approvedAddress = null
        if (approvedFrom) {
          try {
            approvedAddress = Address.parse(String(approvedFrom).trim())
          } catch (e) {
            approvedAddress = null
          }
        }
        if (!approvedAddress || !approvedAddress.equals(contract.address)) {
          throw new Error('TON_DAPP_FROM_MISMATCH')
        }

        const client = getTonClient(apiBase)

        // SELF-PAY YOLUNUN MAKBUZ KAPISI - gonderimden ONCE (bkz.
        // assertNoUnsettledTonFee; sendTonInternal/sendJettonInternal/tonSwapExecute
        // ile AYNI kapi, AYNI fonksiyon). Buradan sonrasi seqno'yu ilerletir ve
        // cozulmemis bir makbuzun saklanan govdesini kalici olarak oldurur.
        await assertNoUnsettledTonFee()

        const wallet = client.open(contract)
        const seqno = await wallet.getSeqno()

        // TIMEOUT ONAY EKRANINDA GECEN SUREYI HESABA KATMAZ: Task 4'teki
        // validateSendTransactionRequest bunu istek ANINDA dogruladi, ama o an ile
        // burasi (IMZALAMA ani) arasinda kullanici dakikalarca bekletmis olabilir.
        if (validUntil !== undefined && validUntil !== null) {
          // signingMessage.storeUint(timeout, 32) UINT32'YE SIGMAYAN bir deger icin
          // dusuk seviyeli, kullaniciya anlamsiz bir hatayla patlar. Bir dapp
          // valid_until'i MILISANIYE olarak yollarsa (yaygin bir hata) deger 2^32'yi
          // asar; burada ONCEDEN reddedilir, storeUint'e HIC birakilmaz.
          if (!Number.isInteger(validUntil) || validUntil < 0 || validUntil > 0xFFFFFFFF) {
            throw new Error('TON_DAPP_VALID_UNTIL_INVALID')
          }
          if (validUntil <= Math.floor(Date.now() / 1000)) throw new Error('TON_DAPP_REQUEST_EXPIRED')
        }

        const internals = messages.map((m) => internal({
          to: Address.parse(m.address),
          value: BigInt(m.amountNano),
          // Duz bir transfer (payload YOK) tonSend.js ile AYNI kurali izler: hedef
          // henuz zincirde YOKSA para geri sekmesin (false). payload TASIYAN bir
          // mesaj ise bir KONTRATA yapilan cagridir - cagri basarisiz olursa TON
          // kontratta KILITLI kalmasin diye geri seker (true).
          bounce: Boolean(m.payload),
          // payload/stateInit dapp'ten HAM BOC olarak geliyor ve BU KATMAN ONU
          // COZMEZ; oldugu gibi aktarilir (tasarim belgesi §5.2).
          body: m.payload ? Cell.fromBase64(m.payload) : undefined,
          init: m.stateInit ? loadStateInit(Cell.fromBase64(m.stateInit).beginParse()) : undefined,
        }))

        const body = contract.createTransfer({
          seqno,
          secretKey: keyPair.secretKey,
          // tonSend.js:SEND_MODE ile AYNI deger: ucret gonderilen tutardan AYRI
          // odenir ve tekil mesaj hatasi butun transferi geri almaz.
          sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
          messages: internals,
          timeout: validUntil ?? undefined,
        })

        // DONEN BOC ile YAYINLANAN mesaj AYNI `init` kararini kullanmali. TonClient'in
        // provider.external'i init'i seqno===0'a degil, ZINCIRDEN OKUNAN
        // isContractDeployed'a bakarak ekler (bkz. @ton/ton TonClient.js
        // createProvider().external). seqno===0 ile karar verilseydi, seqno'su
        // hala 0 olan ama BASKA bir yoldan coktan dagitilmis bir cuzdanda BOC'a
        // init eklenir, gercek yayina EKLENMEZ - iki mesajin hash'i FARKLILASIR
        // ve dapp elindeki BOC ile kendi islemini takip edemez.
        const deployed = await client.isContractDeployed(contract.address)
        const ext = external({ to: contract.address, init: deployed ? undefined : contract.init, body })
        const boc = beginCell().store(storeMessage(ext)).endCell().toBoc().toString('base64')

        // Acilmis sozlesmenin kendi `send`i kullanilir (provider.external'i o cagirir
        // ve AYNI isContractDeployed kararini KENDI ICINDE tekrar verir).
        await wallet.send(body)

        // Dapp BOC bekliyor, islem hash'i DEGIL: hash dondurmek dapp'in yaniti
        // ayristirmasini bozar (tasarim belgesi §3.1).
        resolve({ success: true, boc })

        // seqno izleme kuyrugu BLOKE ETMEZ (sendTonInternal'daki AYNI desen):
        // dapp BOC'u zaten aldi, kart durumunu arka planda kendi gunceller.
        waitForSeqno({ contract: wallet, previous: seqno })
          .then((confirmed) => updateTxStatus(txId, confirmed ? 'success' : 'processing', meta))
          .catch(() => updateTxStatus(txId, 'processing', meta))
      } catch (error) {
        console.error('[ton] dapp gonderimi basarisiz:', error?.message, error)
        const userMessage = tonSendUserMessage(error)
        updateTxStatus(txId, 'error', { ...meta, error: userMessage })
        reject({ success: false, error: userMessage })
      }
    })
    processQueue()
  })

  promise.then(sendResponse).catch(sendResponse)
}

/**
 * TonConnect imzalari: `ton_proof` (baglanti kaniti) ve `signData`.
 *
 * IKI MOD TEK ISLEYICIDE, AMA ORTAK GOVDE YOK: her mod, imzalanacak digest'i
 * KENDI saf katmanindan (tonProofMessage / tonSignDataSchemes) baslayarak KENDI
 * BASINA kurar. Govdeyi birlestirmek, bir modda alinan imzanin otekinde tekrar
 * kullanilabilmesi demekti.
 */
async function tonDappSign(message, sender, sendResponse) {
  try {
    const { mode, domain, payload, proofPayload, account: accountFromUi, from: approvedFrom } = message.message

    const { currentNetwork } = await chrome.storage.local.get('currentNetwork')
    const testnet = Number(currentNetwork?.chainId) === TON_TESTNET_ID

    const account = await resolveAccount({ account: accountFromUi })
    const { keyPair, address } = await createTonKeyPair(account, { testnet })

    // ONAYLANAN HESABA KILIT (kapsam genislemesi, gorev 13 kontrolor karari):
    // tonDappSend'deki AYNI assertion (yukarida, ayni Address.parse(...).equals(...)
    // teknigi) burada YOKTU -- COZULEN adres imzaya (addressHash/workChain)
    // DOGRUDAN gomuluyor ve dapp'e "address" olarak GERI bildiriliyordu, ama
    // hicbir yer bunu onay ekraninda gosterilen `from` ile KARSILASTIRMIYORDU.
    // Sonuc: hesap cozumu yanlis bir hesaba duserse (orn. resolveAccount'un
    // active_account'a sessiz dusmesiyle) imza BASKA bir adrese baglanir, ekran
    // ise dapp'e BASKA bir adres bildirmis olurdu -- dogrulama sessizce basarisiz
    // olur, hicbir yerde iz kalmaz.
    //
    // `from` VERILMISSE (kosullu -- proof/signData'nin ESKI cagirani `from`
    // gondermeyebilir) GURULTULU sekilde reddedilir; VERILMEZSE eski davranis
    // KORUNUR, boylece bu degisiklik hicbir mevcut cagiriciyi BOZMAZ.
    if (approvedFrom) {
      let approvedAddress = null
      try {
        approvedAddress = Address.parse(String(approvedFrom).trim())
      } catch (e) {
        approvedAddress = null
      }
      if (!approvedAddress || !approvedAddress.equals(address)) {
        throw new Error('TON_DAPP_FROM_MISMATCH')
      }
    }

    const timestamp = Math.floor(Date.now() / 1000)
    const addressHash = new Uint8Array(address.hash)

    let finalDigest
    if (mode === 'proof') {
      // ton_proof CIFT sha256 ister (protokolun tanimi): once mesaj govdesi
      // hash'lenir, tonProofSignInput o hash'i saran ikinci bir govde kurar,
      // O govde de AYRICA hash'lenip imzalanan budur.
      const msg = buildTonProofMessage({
        workchain: address.workChain,
        addressHash,
        domain,
        timestamp,
        payload: proofPayload ?? '',
      })
      const msgHash = new Uint8Array(await crypto.subtle.digest('SHA-256', msg))
      const signInput = tonProofSignInput(msgHash)
      finalDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', signInput))
    } else {
      // signData: saf katman `prehashed` ile HANGISI oldugunu SOYLUYOR (bkz.
      // tonSignDataSchemes.js basligindaki dogrulama notu) -- text/binary icin
      // `bytes` bir ON-GORUNTU (biz sha256'lariz), cell icin ZATEN NIHAI TVM
      // hash'i (dokunmadan imzalariz). KOSULSUZ hash burada YANLIS: cell icin
      // ikinci bir sha256 uygulamak, hicbir dapp backend'inin dogrulayamayacagi
      // bir imza uretir -- ne cuzdanda ne dapp'te goze CARPAR, kullanici sadece
      // ilerleyemez.
      const built = buildSignDataInput(payload, { workchain: address.workChain, addressHash, domain, timestamp })
      if (!built.ok) throw new Error(built.message)
      finalDigest = built.prehashed
        ? built.bytes
        : new Uint8Array(await crypto.subtle.digest('SHA-256', built.bytes))
    }

    const signature = sign(Buffer.from(finalDigest), Buffer.from(keyPair.secretKey))

    // TIMESTAMP YANITA GIRER: dapp imzayi dogrularken AYNI damgayla mesaji
    // yeniden kurar. Donmezse dogrulama HEP basarisiz olur ve sebebi hicbir
    // yerde gorunmez.
    sendResponse({ success: true, signature: Buffer.from(signature).toString('base64'), timestamp })
  } catch (e) {
    // sendResponse HER YOLDA (basari/hata) TAM OLARAK BIR KEZ cagrilir -- burada
    // atlanirsa dapp'in promise'i sessizce sonsuza kadar askida kalir.
    //
    // FIX ROUND 1 (kontrolor incelemesi): burasi ONCEDEN yalniz TON_DAPP_FROM_MISMATCH'i
    // cevirip GERI KALAN HER SEYI (createTonKeyPair/resolveAccount zincirinin
    // firlattigi HAM token'lar -- ACCOUNT_VAULT_NOT_FOUND, TON_VAULT_NOT_FOUND,
    // TON_SECRET_KIND_INVALID, TON_SECRET_KIND_MISMATCH, TON_SECRET_MISSING vb.)
    // OLDUGU GIBI geciriyordu. Iki ekran de (TonSignData.vue, TonConnectApprove.vue)
    // res.error'i OLDUGU GIBI ekrana basiyor -- yani kullanici TON kasasi eksikse
    // literal "TON_VAULT_NOT_FOUND" METNINI goruyordu. Bu token'larin HEPSI icin
    // TON_SEND_ERROR_MESSAGES'te ZATEN kullanilmayan bir Turkce karsilik vardi.
    // `tonSendUserMessage` KASITLI KULLANILMADI: onun yedegi ("Islem gonderilemedi...")
    // bir GONDERIM metni, bu ise bir IMZA yolu -- yanlis okurdu. `|| e.message`
    // KORUNUR: tabloda karsiligi olmayan (yeni/beklenmeyen) bir kod GIZLENMEZ,
    // ham haliyle yuzeye cikar (sessizce kaybolmaktan iyidir).
    sendResponse({ success: false, error: TON_SEND_ERROR_MESSAGES[e.message] || e.message })
  }
}

// Jetton gonderimi. sendTonInternal ile AYNI kalip: kuyruk, updateTxStatus,
// waitForSeqno. Ayrildigi yerler ve NEDEN:
//
//   - `type: 'Jetton'` yaziliyor: gecmis kartinda satirin native TON gonderimi
//     gibi gorunmesi kullaniciya YANLIS varligi gosterirdi.
//   - `amount` jetton miktaridir, harcanan TON DEGIL. Ikisi ayri varliktir;
//     tek satirda birlestirmek kullaniciya ne odedigini yanlis gosterir.
//   - Dort kapi burada DEGIL sendJetton icinde: para-kritik kararlar saf ve
//     test edilebilir katmanda kalsin diye. Buradaki tek gorev, o katmana
//     ihtiyaci olan taze girdiyi (bekleyen islem listesi, sahip adresi,
//     depo) vermek.
async function sendJettonInternal(message, sender, sendResponse) {
  const { chainId, amount, to, comment, apiBase, master, decimals, symbol,
          payWithTonFee, approvedAtsFee } = message.message
  const txId = uniqueKey()
  // Native yolla AYNI kural: bayrak yalnizca "hangi yol", yetki DEGIL - gercek
  // kapilar executeTonViaRelayer'in icinde ve taze /status ile olculuyor.
  const relayMode = payWithTonFee === true
  const meta = tonTxMeta({ chainId, amount, type: 'Jetton', symbol }, relayMode)
  updateTxStatus(txId, 'queued', meta)

  const promise = new Promise((resolve, reject) => {
    transactionQueue.push(async () => {
      try {
        if (!isTon(chainId)) throw new Error('Unsupported chain')

        // Bekleyen islem kapisi (KAPI 4) sendJetton icinde calisir; listeyi
        // okumak storage erisimi gerektirdigi icin burada okunup ORAYA verilir.
        // Native TON yolundaki kontrolle AYNI kaynak ve AYNI kural.
        // KENDI KAYDIMIZ HARIC. Yukaridaki `updateTxStatus(txId, 'queued', ...)`
        // bu islemi ZATEN listeye yaziyor ve hasPendingTonTx 'queued' durumunu
        // bekleyen sayiyor - yani kapi kendi kendini engelleyebilir. Bugun bu
        // olmuyor ama YALNIZCA BIR YARISI kazandigi icin: updateTxStatus
        // await EDILMIYOR ve depo yazmasi genelde bu okumadan SONRA iniyor.
        // Yarisin diger tarafi kazandiginda gonderim, sebebi hic anlasilmayan
        // bir "Bekleyen bir TON islemi var" ile duserdi. Kimligi suzmek bu
        // yarisi tumden ortadan kaldirir ve cift harcama korumasini ZAYIFLATMAZ:
        // eledigimiz kayit henuz GONDERILMEMIS olan, tam su an kurdugumuz islem.
        const { current_transactions } = await chrome.storage.local.get(CURRENT_TRANSACTIONS)
        const otherPending = (current_transactions || []).filter((t) => t?.id !== txId)

        updateTxStatus(txId, 'processing', meta)

        const testnet = Number(chainId) === TON_TESTNET_ID
        const account = await resolveAccount(message.message)
        const { keyPair } = await createTonKeyPair(account, { testnet })

        const client = getTonClient(apiBase)
        const contract = walletFromKeyPair(keyPair, testnet)
        const owner = contract.address.toString({ bounceable: false, testOnly: testnet })
        const wallet = client.open(contract)

        if (relayMode) {
          assertRelayComment(comment)
          // Ondalik kapisi jettonSend.js'teki ile AYNI ve AYNI sebeple en basta:
          // yanlis/eksik ondalik gonderilen miktari 1000 kat yanlis yapar.
          if (!Number.isInteger(decimals)) throw new Error('JETTON_DECIMALS_MISSING')

          // KAPI 1 (jettonSend.js): alici gecerli VE bir jetton cuzdani DEGIL.
          // Relay yolu sendJetton'u atladigi icin bu kapi burada tekrar kurulur -
          // jetton cuzdanina gonderilen token pratikte KAYBOLUR ve ustune ucret
          // odenmis olur. Kontrolun kendisi KOPYALANMIYOR, AYNI fonksiyon cagriliyor.
          const recipient = normalizeTonRecipient(to, { testnet })
          if (await isJettonWallet({ client, address: recipient })) {
            throw new Error('JETTON_RECIPIENT_IS_JETTON_WALLET')
          }
          // KAPI 4 (jettonSend.js): bekleyen TON islemi varken seqno yarisir ve
          // ikinci govde sessizce duser - relay yolunda ustelik ucreti alinmis olarak.
          if (hasPendingTonTx(otherPending)) throw new Error('TON_TX_ALREADY_PENDING')

          // GONDERENIN kendi jetton cuzdani - ZINCIRDEN (kalici onbellekli).
          // Dogrulamanin "hangi token" sorusunu cevaplayan TEK alan budur ve
          // sunucudan GELMEZ; tasinmazsa tonQuoteVerify kapali tarafa duser.
          const myJettonWallet = await getJettonWalletAddress({
            client, owner, master, chainId, storage: chrome.storage.local,
          })

          // KAPI 2 (jettonSend.js): jetton bakiyesi YETERLI mi - ZINCIRDEN, imzadan
          // ONCE. Bu kapiyi atlamanin bedeli relay yolunda self-pay'dekinden STRIKT
          // OLARAK YUKSEK: self-pay'de bakiyesi yetmeyen bir transfer zincirde duser
          // ve kullanici HICBIR SEY kaybetmez; burada ayni dusus dogrulama + iki imza
          // + makbuz + ~18 ATS TAHSILATINDAN SONRA olur - ucret yanar, jetton hic
          // gitmez. Arayuzun kendi okumasi bunun YERINE GECMEZ (jettonSend.js dosya
          // basi: "BU DOSYA IMZALAMADAN ONCEKI SON KAPIDIR"): iki ekran arasinda
          // bakiye degismis olabilir.
          //
          // KAPI 3 (TON bakiyesi) BURADA YOK ve bu bilincli: iliskilendirilen TON'u
          // sunucu seciyor (quote.attachNanoton) ve relay modunda ag ucretini
          // kullanici odemiyor - ikinci bir esik iki farkli karar uretirdi.
          const jettonBalance = await getJettonBalance({
            client, walletAddress: myJettonWallet, decimals,
          })
          const istenen = Number(amount)
          if (!Number.isFinite(istenen) || istenen <= 0 || !(istenen <= Number(jettonBalance))) {
            throw new Error('JETTON_INSUFFICIENT_BALANCE')
          }

          await tonRelayExecute({
            account, keyPair, wallet, tonWallet: owner, approvedAtsFee, txId, meta,
            actions: [{
              kind: 'jetton',
              to: recipient,
              // Ham birim - ondalik kapisi (decimalToRawUnits) self-pay yolundaki
              // buildJettonTransferBody ile AYNI fonksiyon.
              amount: decimalToRawUnits(amount, decimals).toString(),
              jettonMaster: master,
              jettonWallet: myJettonWallet,
            }],
          })

          resolve({ success: true, address: owner, jettonWallet: myJettonWallet })
          return
        }

        // SELF-PAY YOLUNUN MAKBUZ KAPISI - gonderimden ONCE (bkz.
        // assertNoUnsettledTonFee). Native yolla AYNI kapi, AYNI fonksiyon:
        // jetton gonderimi de ayni cuzdanin seqno'sunu ilerletir.
        await assertNoUnsettledTonFee()

        const { seqno, jettonWallet } = await sendJetton({
          client, wallet, keyPair, to, amount, master, decimals, comment,
          owner, chainId, storage: chrome.storage.local,
          pendingTransactions: otherPending, testnet,
        })

        // TON'da islem hash'i gonderim aninda ELDE DEGIL (native yolla ayni):
        // seqno degisimi, islemin cuzdan sozlesmesince islendiginin kanitidir.
        resolve({ success: true, seqno, address: owner, jettonWallet })

        waitForSeqno({ contract: wallet, previous: seqno })
          .then((confirmed) => {
            // `false` "BASARISIZ" DEGIL, "sure icinde dogrulanamadi" demektir.
            // 'error' yazmak kullaniciyi tekrar gondermeye iter ve deger iki kez
            // gidebilir; bu yuzden 'processing'de birakilir.
            updateTxStatus(txId, confirmed ? 'success' : 'processing', meta)
          })
          .catch(() => {
            updateTxStatus(txId, 'processing', meta)
          })
      } catch (error) {
        // HAM hatayi HER ZAMAN yaz; kullaniciya gosterilen metin genellestiriliyor.
        console.error('[ton] jetton gonderimi basarisiz:', { chainId, master, message: error?.message }, error)

        // Eslenmemis hicbir kod HAM gecmesin (native yolla AYNI esleyici ve AYNI yedek).
        const userMessage = tonSendUserMessage(error)

        updateTxStatus(txId, 'error', { ...meta, error: userMessage })
        reject({ success: false, error: userMessage })
      }
    })
    processQueue()
  })

  promise.then(sendResponse).catch(sendResponse)
}

async function checkTransactionStatus(message, sender, sendResponse) {
  try {
    const { chainId, hash } = message.message
    
    const found = supported_chains.find(chain => chain.chainId === chainId)
    if(!found) throw new Error('Unsupported chain')
    requireEvmChain(found) // bkz. swap(): ayni gerekce
    // 'dapp' akisi = EIP-1193 yolu: TON'un hex chainId karsiligi yok (hexChainIdFor).
    // Kimlik kapisindan SONRA: ayni cevabi verirler, hatanin adini ilki koyar.
    assertChainFlow(found, 'dapp')

    const provider = new ethers.JsonRpcProvider(found.rpc[0].url)

    const receipt = await provider.getTransactionReceipt(hash)
    if(!receipt) return sendResponse({ success: true, status: 'processing' })

    return sendResponse({ success: true, status: receipt.status === 0 ? 'error' : 'success' })

  } catch (error) {
    sendResponse({ success: false, error: error.message })
  }
}

// EIP-7702 delegasyonunu kaldir (revoke): delegasyonu 0x0'a ayarlayan type-4 tx.
// Native gas gerektirir (nadir ayar islemi). ethers v6 7702 API'si testnet'te dogrulanacak (Task 22).
async function revokeDelegation(message, sender, sendResponse) {
  try {
    const { chainId } = message.message
    const found = supported_chains.find((c) => c.chainId === chainId)
    if (!found) throw new Error('Unsupported chain')
    requireEvmChain(found) // bkz. swap(): ayni gerekce
    assertChainFlow(found, 'dapp') // bkz. checkTransactionStatus(): ayni iki katman
    const provider = new ethers.JsonRpcProvider(found.rpc[0].url)
    const account = await resolveAccount(message.message)
    const wallet = await createWalletInstance(account, provider)

    const auth = await wallet.authorize({ address: ethers.ZeroAddress })
    const tx = await wallet.sendTransaction({
      type: 4,
      to: wallet.address,
      value: 0n,
      authorizationList: [auth],
    })
    await tx.wait()
    sendResponse({ success: true, hash: tx.hash })
  } catch (e) {
    sendResponse({ success: false, error: e.message })
  }
}

async function gaslessTokenOptions(message, sender, sendResponse) {
  try {
    const { chainId, address, bundlerBase, sendAsset } = message.message

    const found = supported_chains.find((c) => Number(c.chainId) === Number(chainId))
    if (!found) throw new Error('Unsupported chain')
    // `Number('solana-mainnet')` NaN oldugu icin bu satir bugun zaten Solana'yi
    // bulamiyor (found undefined kalir, yukaridaki throw devreye girer) -- ama bu
    // KAZARA bir koruma (NaN !== NaN). requireEvmChain KASITLI kapi: yarin bu
    // karsilastirma isSameChainId'ye tasinirsa (dogru yontem, ama Solana'nin METIN
    // kimligini de eslerdi) sessizce found.rpc[0] okumaya donmemesi icin burada durur.
    requireEvmChain(found)

    // Aday tokenlar: kullanicinin bu zincirde TUTTUKLARI (imported_tokens) + GONDERILEN token.
    // getGasTokenOptions bunlari Pimlico'ya (getTokenQuotes) dogrulatip bakiyeyle filtreler.
    const { imported_tokens, active_account } = await chrome.storage.local.get(['imported_tokens', 'active_account'])
    const held = imported_tokens?.[active_account?.key]?.[String(chainId)] || []
    const byAddr = new Map()
    const add = (t) => {
      if (!t || !t.address) return
      byAddr.set(String(t.address).toLowerCase(), {
        address: t.address,
        symbol: t.symbol,
        decimals: t.decimals,
        logoURI: t.image?.large || t.logoURI,
      })
    }
    held.forEach(add)
    add(sendAsset)

    const account = await resolveAccount(message.message)
    const wallet = await createWalletInstance(account)
    const bundlerToken = await getBundlerToken({ signer: wallet, bundlerBase })

    const options = await getGasTokenOptions({
      chainId, rpcUrl: found.rpc[0].url, bundlerBase, address,
      candidates: [...byAddr.values()], bundlerToken,
    })
    sendResponse({ success: true, options })
  } catch (e) {
    sendResponse({ success: false, error: e.message })
  }
}

// Header yakit pill'i. Zincir SABIT 56'dir; kullanicinin bulundugu ag onemsiz.
//
// Backend (/status, /quote) CAGRILMAZ: ikisi de bir `call` istiyor ve ucret hesapliyor.
// Pill'in tek ihtiyaci bakiye; header'a gereksiz ag yuku ve gereksiz bir hata yuzeyi
// eklemenin anlami yok.
//
// DIKKAT: burayi "kullanicinin bulundugu agdan oku" diye duzeltmek, kullaniciya sahip
// OLMADIGI bir bakiyeyi gosterir -- hedef zincirlerdeki ATSOFT bakiyeleri gelistirme
// kalintisidir ve kullaniciya hic acilmaz.
async function atsFuelBalance(message, sender, sendResponse) {
  try {
    const { address } = message.message
    if (!address) throw new Error('address gerekli')

    const cfg = getAtsSourceConfig()
    if (!cfg) throw new Error('ATS kaynak zinciri yapilandirilmamis')

    const src = supported_chains.find((c) => Number(c.chainId) === ATS_SRC_CHAIN_ID)
    if (!src) throw new Error('Kaynak zincir (BSC) desteklenen aglarda yok')

    const provider = new ethers.JsonRpcProvider(src.rpc[0].url)
    const token = new ethers.Contract(
      cfg.token.address,
      ['function balanceOf(address) view returns (uint256)'],
      provider,
    )
    const raw = await token.balanceOf(address)

    // formatUnits STRING doner; BigInt mesaj sinirindan gecemez. toMessageSafe yine de
    // duruyor -- yanit alanlari degistiginde bu kilit yerinde kalsin.
    sendResponse(toMessageSafe({
      success: true,
      balance: ethers.formatUnits(raw, cfg.token.decimals),
      symbol: cfg.token.symbol,
    }))
  } catch (e) {
    // Ham hatayi yaz: esleme katmanlari teshis alanlarini yutmasin (2026-08-09 dersi).
    console.error('[ats] yakit bakiyesi okunamadi:', e)
    sendResponse({ success: false, error: e.message })
  }
}

async function atsFeeQuote(message, sender, sendResponse) {
  try {
    // `calls` (cogul): swap/bridge gibi COK CAGRILI op'lar. Ucret ve KOMISYON ayni yerden
    // okunur (belge "Swap ve Bridge Komisyonu"): teklif yaniti commissionAts,
    // commissionTreasury, commissionRegion ve maxAtsSellRaw tasir.
    const { chainId, address, call, calls } = message.message
    if (!isAtsChain(chainId)) {
      return sendResponse({ success: false, error: 'ATS not enabled for chain' })
    }

    const found = supported_chains.find((c) => Number(c.chainId) === Number(chainId))
    if (!found) throw new Error('Unsupported chain')

    // ATS backend'i auth'suz + DOGRUDAN; bundlerToken/proxy YOK. Teklif yalniz OKUMA
    // (bakiye/allowance/quote) — imza gerekmez, cuzdan ornegine gerek yok, adres yeter.
    //
    // `call` gaz tahmini icin ZORUNLU: sabit limitler kalkti, ucret gercek cagri maliyetinden
    // turuyor. Cagri yoksa tahmin yedek sabite duser (bkz. estimateCallGas).
    const quote = await quoteAtsTransfer({ chainId, rpcUrl: found.rpc[0].url, address, call, calls })
    // toMessageSafe SART: `quote` icinde `gas` (alti BigInt alan) ve `maxPriorityFeePerGas`
    // var; Chrome uzanti mesajlari BigInt tasiyamaz ve yanit serilestirilemeyince hata
    // GONDERENIN promise'ine "Could not serialize message." olarak duser — yani popup'ta
    // sebepsiz "Ucret hesaplanamadi" gorunur (2026-08-09, Ethereum mainnet).
    sendResponse({ success: true, ...toMessageSafe(quote) })
  } catch (e) {
    // Kod METINDEN once gelir: UI Turkce mesaja degil koda bakar (atsBlocker).
    // httpStatus SART: kodsuz hatalarda karar ONA gore verilir ve 5xx ile 4xx ayri kartlar.
    sendResponse({ success: false, error: e.message, code: e.code, httpStatus: e.status })
  }
}

// SWAP/BRIDGE UCRET + KOMISYON TEKLIFI — belge "Swap ve Bridge Komisyonu".
//
// NEDEN AYRI UCLAR: teklif, GONDERILECEK op ile AYNI cagri listesi uzerinden fiyatlanmali.
// Gaz tahmini cagrilarin kendisinden turer ve komisyonlu op'ta /quote callData ILE cagrilir
// (§03/§04) — yani cagri listesi ekranda da, gonderimde de ayni sekilde kurulmali. Listeyi
// UI'da bir, background'da bir daha kurmak iki ayri callData (dolayisiyla iki ayri kilit)
// uretme riskidir; tek yer burasi.
//
// Yanit `commissionAts`, `commissionTreasury`, `commissionRegion` ve `maxAtsSellRaw` tasir.
// `maxAtsSellRaw` §06.1'dir: ATS SATAN bir swap'a en fazla bu kadar girebilir. BACKEND BUNU
// DENETLEMEZ — asilirsa op zincirde AA33 ile duser ve gaz yanar.
async function atsSwapFeeQuote(message, sender, sendResponse) {
  try {
    const { chainId, inTokenAddress, outTokenAddress, amount, slippage } = message.message
    if (!isAtsChain(chainId)) {
      return sendResponse({ success: false, error: 'ATS not enabled for chain' })
    }
    const found = supported_chains.find((c) => Number(c.chainId) === Number(chainId))
    if (!found) throw new Error('Unsupported chain')

    const provider = new ethers.JsonRpcProvider(found.rpc[0].url)
    const account = await resolveAccount(message.message)
    const wallet = await createWalletInstance(account, provider)
    const swapManager = new MultiChainSwapManager(wallet.privateKey, chainId)
    // Native girdili swap ENGELLENMEZ — gerekce gonderim kolunda yazili (§06.3'un hedefi
    // native->native KOPRU rotalaridir, swap degil).
    const { calls } = await swapManager.buildSwapCalls(inTokenAddress, outTokenAddress, amount, slippage)

    // Ekran, gonderimin kuracagi callData ile AYNI soruyu sormali; ayrisirsa gosterilen
    // komisyon ve maxAtsSellRaw tavani gercek op'tan kopar.
    const quote = await quoteAtsTransfer({
      chainId, rpcUrl: found.rpc[0].url, address: wallet.address, calls, opKind: 'swap',
    })
    sendResponse({ success: true, ...toMessageSafe(quote) })
  } catch (e) {
    sendResponse({ success: false, error: e.message, code: e.code, httpStatus: e.status })
  }
}

async function atsBridgeFeeQuote(message, sender, sendResponse) {
  try {
    const { chainId, to, data, value, fromTokenAddress, amount_raw, approvalAddress } = message.message
    if (!isAtsChain(chainId)) {
      return sendResponse({ success: false, error: 'ATS not enabled for chain' })
    }
    const found = supported_chains.find((c) => Number(c.chainId) === Number(chainId))
    if (!found) throw new Error('Unsupported chain')

    const provider = new ethers.JsonRpcProvider(found.rpc[0].url)
    const account = await resolveAccount(message.message)
    const wallet = await createWalletInstance(account, provider)

    // buildBridgeCalls native degeri TASIR (kullanicinin kendi bakiyesinden cikar; paymaster
    // yalnizca gazi oder) ve yalnizca bakiye YETMEZSE durdurur — kod:
    // `insufficient-native-for-value`. Kontrol orada, TEK KAPIDA: teklif ve gonderim ayni
    // fonksiyondan geciyor.
    const calls = await buildBridgeCalls({
      to, data, value, fromTokenAddress, owner: wallet.address,
      amountRaw: amount_raw, provider, approvalAddress,
    })
    const quote = await quoteAtsTransfer({
      chainId, rpcUrl: found.rpc[0].url, address: wallet.address, calls, opKind: 'bridge',
    })
    sendResponse({ success: true, ...toMessageSafe(quote) })
  } catch (e) {
    sendResponse({ success: false, error: e.message, code: e.code, httpStatus: e.status })
  }
}

// Onboarding op'lari KAYNAK ZINCIRDE (BSC 56) kosar; kullanicinin bulundugu ag onemsiz.
// Bu yuzden RPC'yi supported_chains'ten 56 icin cozuyoruz, mevcut agdan degil.
async function atsRunOnboarding(message, sender, sendResponse) {
  try {
    const { chainId, address } = message.message
    if (!isAtsChain(chainId)) {
      return sendResponse({ success: false, error: 'ATS not enabled for chain' })
    }
    const src = supported_chains.find((c) => Number(c.chainId) === ATS_SRC_CHAIN_ID)
    if (!src) throw new Error('Kaynak zincir (BSC) desteklenen aglarda yok')

    // Adimlari BACKEND soyler; istemci turetmez. Taze /status SART (force: true — 30 sn'lik
    // onbellek ATLANIR): kullanici arada onboarding'in bir kismini baska bir cihazda
    // tamamlamis olabilir ve bayat bir nextSteps zaten yapilmis bir adimi tekrar gonderir.
    const found = supported_chains.find((c) => Number(c.chainId) === Number(chainId))
    const quote = await quoteAtsTransfer({
      chainId, rpcUrl: found.rpc[0].url, address, call: null, force: true,
    })

    const account = await resolveAccount(message.message)
    const wallet = await createWalletInstance(account)
    const { steps } = await runAtsOnboarding({
      privateKey: wallet.privateKey, address, nextSteps: quote.nextSteps,
      srcRpcUrl: src.rpc[0].url,
    })
    sendResponse({ success: true, steps: toMessageSafe(steps) })
  } catch (e) {
    sendResponse({ success: false, error: e.message, code: e.code, httpStatus: e.status })
  }
}

const TARGET_DATA_VERSION = 2

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "update" || details.reason === "install") await checkAndMigrateData()
})

async function checkAndMigrateData() {
  const result = await chrome.storage.local.get(['vaults', 'data_version', 'active_account', 'user']);
  const currentVersion = result.data_version || 0; 
  let vaults = result.vaults;
  let activeAccount = result.active_account

  // Profil tamamlama YARDIMCI bir adim; kasa migration'inin on kosulu DEGIL.
  // Try/catch olmadan duruyordu: sunucuda profil yoksa getProfile 404 doner, axios
  // reject eder ve hata checkAndMigrateData'nin disina tasarak v1->v2 kasa
  // migration'inin TAMAMINI (fingerprint, imported hesaplarin key'i, derivationPath
  // normalizasyonu, data_version) engelliyordu. Her guncellemede ayni sekilde
  // basarisiz oldugu icin migration kalici olarak bloke kaliyordu.
  if(!result.user?.userID && result.user?.username) {
    try {
      const { data } = await axios.post((import.meta.env.VITE_API_URL || 'http://localhost:8000') + '/profile/getProfile', {
        username: result.user.username
      })

      if(data.success) await chrome.storage.local.set({ user: data.user })
    } catch (e) {
      console.warn('Profil bilgisi alinamadi, migration devam ediyor:', e.message)
    }
  }
  
  if(!vaults) return

  if (currentVersion < TARGET_DATA_VERSION) {
    try {
      // Güvenlik: Orijinal verinin yedeğini al
      await chrome.storage.local.set({ vaults_v1_backup: vaults });

      const newVaults = vaults.map(vault => {
        if (vault.accounts && Array.isArray(vault.accounts)) {
          
          vault.accounts = vault.accounts.map((account, index) => {
            
            // 2. Her hesaba ait olduğu kasanın fingerprint'ini ekle
            account.fingerprint = vault.fingerprint;

            if(account.type === 'imported' && !account.key) {
              account.key = uniqueKey()
              account.index = 0
              delete account.derivationPath
            } else if(account.type === 'hd') {
              const newPath = `m/44'/60'/0'/0/${index}`;
              
              account.derivationPath = newPath;
              account.index = index; 
            }

            // 3. Eğer güncellenen bu hesap, o anki aktif hesapsa onu da yeni verilerle güncelle
            if (activeAccount && activeAccount.address.toLowerCase() === account.address.toLowerCase()) {
              delete activeAccount.derivationPath
              // account objesinde yaptığımız tüm değişiklikleri (fingerprint, path vb.) activeAccount'a aktarır
              activeAccount = { ...activeAccount, ...account };
            }

            return account;
          });
        }
        
        return vault;
      });

      // 4. Yeni vault'ları, yeni data_version'ı ve güncellenmiş active_account'u kaydet
      await chrome.storage.local.set({
        vaults: newVaults,
        active_account: activeAccount,
        data_version: TARGET_DATA_VERSION
      });
      
      console.log("✅ Data migration completed!");

    } catch (error) {
      console.error("❌ data migration error", error);
    }
  }
}