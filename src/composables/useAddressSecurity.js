// Alici adresinin UC bagimsiz kapisi tek yerde (hepsi `blocked`i besler):
//   1) zehirli adres (yerel, sezgisel)  — tanidigin bir adrese benziyor ama o degil
//   2) itibar (uzak, bildirilmis)       — oltalama/hirsizlik veritabanlarinda kayitli
//   3) Gizli Hesap alicisi (yerel, kosulsuz) -- Gizli Hesaba yalniz ozel transferle para girer
//
// Send.vue ve ConfirmTransaction.vue ayni mantigi paylassin diye burada: iki ekranda
// birbirinden kayan iki kopya, kapilardan birinin sessizce acik kalmasi demekti.

import { ref, computed, watch, unref } from 'vue'
import { buildTrustedList, findLookalike, isSupportedAddress, splitAddress } from '../utils/addressPoisoning'
import { accountsForChain, isOwnVaultAddress } from '../utils/knownRecipients'
import { isTon, TON_TESTNET_ID } from '../utils/chainKind'
import { getSentRecipients } from '../utils/sentRecipients'
import { fetchHistoryCounterparties } from '../utils/historyRecipients'
import { CLEAN_REPUTATION, fetchReputation } from '../utils/addressReputation'
import { sameAddress } from '../utils/privacy/privacyGate'
import { isPrivateAccount } from '../utils/privacy/privateAccount'

const POISON_SOURCE_KEYS = {
    account: 'send.poisoning.sourceAccount',
    saved: 'send.poisoning.sourceSaved',
    sent: 'send.poisoning.sourceSent',
    history: 'send.poisoning.sourceHistory'
}

export function useAddressSecurity(address, api, { privateAddress } = {}) {
    const trusted = ref([])
    const reputation = ref({ ...CLEAN_REPUTATION })
    const checking = ref(false)
    // Alici kasadaki kendi hesaplarimdan biri mi (Gizli Hesap dahil)? True iken sunucuya
    // itibar istegi HIC gitmez; ekran 'kendi hesabin' bilgisi gosterebilir.
    const ownRecipient = ref(false)

    const poisonAcknowledged = ref(false)
    const reputationAcknowledged = ref(false)

    // Yalnizca EN SON istegin cevabi uygulanir. Kullanici adresi degistirdiginde onceki
    // sorgu hala yoldadir; gec donup uygulanirsa yeni adres icin YANLIS karar gosterirdi.
    let requestId = 0

    const poisonMatch = computed(() => findLookalike(unref(address), trusted.value))

    const poisonParts = computed(() => poisonMatch.value ? {
        known: splitAddress(poisonMatch.value.address),
        entered: splitAddress(unref(address))
    } : null)

    const poisonSourceKey = computed(() =>
        POISON_SOURCE_KEYS[poisonMatch.value?.source] ?? POISON_SOURCE_KEYS.sent)

    // GIZLI HESAP ALICI OLAMAZ (spec 6.2). Asil kural arka plan kapisinda
    // (RECIPIENT_IS_PRIVATE); bu yalniz erken uyari ve dugme kilidi. Karsilastirma
    // kapiyla AYNI anlamda (harf duyarsiz, 0x'li/0x'siz): ayri bir kopya yazilirsa
    // "0x" silinerek uyari atlanirdi. Pinia burada BILEREK kullanilmaz: composable
    // aktif Pinia olmadan da test edilebilmeli; adres cagiranin verdigi ref'ten gelir.
    const privateRecipient = computed(() => sameAddress(unref(address), unref(privateAddress)))

    // 'block' onaylanamaz — bildirilmis bir hirsiz adresine "anladim" diyerek gonderim
    // yapilabilseydi sert engel diye bir sey olmazdi.
    const blocked = computed(() => {
        if (privateRecipient.value) return true
        if (checking.value) return true
        if (reputation.value.severity === 'block') return true
        if (reputation.value.severity === 'warn' && !reputationAcknowledged.value) return true
        if (poisonMatch.value && !poisonAcknowledged.value) return true
        return false
    })

    // chainId/myAddress verilirse gecmisteki karsi taraflar da kumeye girer: adres
    // defterine kaydetmedigin, bu cihazdan hic gondermedigin muhataplar. Gecmis DUSMANIN
    // da yazabildigi bir kaynak oldugu icin adaylar buildTrustedList'teki valflerden gecer.
    //
    // myAddress cagiranin ZINCIRINE gore degisir: EVM'de hesabin EVM adresi, Solana'da
    // hesabin solanaAddress'i. Yanlis kimlik gecirilirse gecmis sorgusu KENDI adresini
    // taniyamaz ve kendi gonderimlerin de "yabanci karsi taraf" sanilir.
    async function loadTrusted({ chainId, myAddress } = {}) {
        try {
            const { vaults, saved_addresses, active_account } =
                await chrome.storage.local.get(['vaults', 'saved_addresses', 'active_account'])

            // Kendi hesaplarin AKTIF ZINCIRIN adresiyle: TON'da EVM adresi degil TON
            // adresi guvenilirdir (bkz. accountsForChain). Eskiden burada dogrudan
            // flattenVaultAccounts vardi ve TON agindayken listeye hic TON adresi
            // girmiyordu - koruma TON'da SESSIZCE hicbir sey yapmiyordu.
            const accounts = accountsForChain(vaults, chainId)

            // Gecmis KARSI TARAFLARI da dogru kimlikle sorulmali: TON agindayken
            // kullanicinin EVM adresiyle gecmis sorulursa BOS doner ve gecmisten
            // gelen guvenilir adresler hic olusmaz. Turetme YAPILMAZ - hesap
            // kaydindaki ONBELLEKLI TON adresi kullanilir; yoksa cagiranin verdigi
            // adrese dusulur (o da yanlissa gecmis bos doner, liste yine kurulur).
            const tonField = Number(chainId) === TON_TESTNET_ID ? 'tonAddressTestnet' : 'tonAddress'
            const selfAddress = isTon(chainId)
                ? (active_account?.[tonField] || null)
                : myAddress

            // Gonderen Gizli Hesapsa uzak gecmis sorgusu YAPILMAZ: sunucumuza Gizli Hesap
            // adresi ve IP'si gitmesin. Poisoning zenginlestirmesi bu ekranin tamamlayamadigi
            // (ozel gonderim yok) bir akis icin gereksiz bir sizinti olurdu.
            const senderIsPrivate = isPrivateAccount(active_account)

            // Gecmis cagrisi patlasa bile digerleri kurulmali: bos listeye duser.
            const historyRecipients = (selfAddress && !senderIsPrivate)
                ? await fetchHistoryCounterparties(unref(api), selfAddress, chainId)
                : []

            trusted.value = buildTrustedList({
                accounts,
                savedAddresses: saved_addresses || [],
                // Yalniz gonderenin KENDI tarafinin kayitlari (C-I2): normal mod gizli
                // alicilari, gizli mod normal alicilari bilmez/gostermez.
                sentRecipients: await getSentRecipients({ private: senderIsPrivate }),
                historyRecipients
            })
        } catch (e) {
            // Liste bos kalirsa zehirli adres uyarisi cikmaz; ozellik yokken de cikmiyordu.
            console.warn('Guvenilir adres listesi okunamadi:', e.message)
        }
    }

    async function checkReputation(value) {
        const id = ++requestId

        // Eski karar ANINDA dusurulur: adres degistigi anda ekranda onceki adrese ait
        // bir engel/uyari kartinin durmasi kabul edilemez.
        reputation.value = { ...CLEAN_REPUTATION }
        ownRecipient.value = false

        // Yarim yazilmis adres icin sorgu yapilmaz: kullanici yazarken her tus vurusu
        // bir istek olurdu. Karar burada verilir, alt modulun ic korumasina birakilmaz.
        //
        // EVM VE Solana icin de gecerli adreste sorgu yapilir: Solana'da saglayici
        // (GoPlus) destek vermiyor ama bunu SESSIZCE "temiz" gostermek yerine
        // fetchReputation `unsupported: true` ile isaretler, kullaniciya "bu agda
        // itibar kontrolu yok" denir — sorgusuz kalirsa bu bilgi hic uretilemez.
        //
        // TON adresleri de bu kapidan GECER (isSupportedAddress artik onlari da
        // taniyor), ama fetchReputation onlari AGA TASIMAZ: hem sunucu ucu hem
        // istemci EVM kalibi disindaki adresi sorgusuz "temiz" sayar. TON davranisi
        // boylece DEGISMEDI; degisen tek sey kararin ARTIK tek bir yerde (adres
        // bicimini taniyan modulde) verilmesi.
        if (!isSupportedAddress(value)) return

        // Alici Gizli Hesap ise gonderim zaten kosulsuz engelli (blocked); itibar sorgusu
        // karar degeri tasimaz, yalniz Gizli Hesap adresini sunucumuza ve GoPlus'a sizdirir.
        if (privateRecipient.value) return

        // Alici kasadaki kendi hesaplarimdan biriyse (her iki modda, tum zincirler)
        // itibar sorgusu ATILMAZ: kendi adresin icin bildirilmis-hirsiz karari anlamsiz,
        // sorgu ise Gizli moddayken normal hesap adresini /wallet/reputation'a sizdirir.
        // Kasa okunamazsa yabanci adres gibi sorgulanir: koruma kaybolmasin diye.
        let own = false
        try {
            const { vaults } = await chrome.storage.local.get('vaults')
            own = isOwnVaultAddress(vaults, value)
        } catch (e) {
            own = false
        }
        if (id !== requestId) return
        if (own) {
            ownRecipient.value = true
            return
        }

        const result = await fetchReputation(unref(api), value)
        if (id !== requestId) return

        reputation.value = result
    }

    watch(() => unref(address), async (value) => {
        // Her adres degisikliginde onaylar duser: onceki adres icin verilen onay
        // yenisine tasinirsa kapi hic sorulmadan acilmis olur.
        poisonAcknowledged.value = false
        reputationAcknowledged.value = false

        checking.value = true
        try {
            await checkReputation(value)
        } finally {
            checking.value = false
        }
    // immediate SART: ConfirmTransaction.vue'da adres ekran acildiginda zaten bellidir ve
    // hic degismez. Yalnizca degisikligi dinleseydik onay ekrani sorgusuz kalirdi — dapp
    // islemleri icin tek kapi orasi.
    }, { immediate: true })

    return {
        trusted, reputation, checking,
        poisonMatch, poisonParts, poisonSourceKey,
        poisonAcknowledged, reputationAcknowledged,
        privateRecipient, ownRecipient, blocked, loadTrusted,
    }
}
