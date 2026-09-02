<template>
    <div class="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm px-4" @click="closeModal">

        <div
            v-if="popups.addressBook"
            class="w-full max-w-90 max-h-150 flex flex-col bg-white dark:bg-[#09090b] border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl dark:shadow-2xl overflow-hidden relative transition-colors duration-300"
            @click.stop
        >
            <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-500/10 to-transparent pointer-events-none transition-colors duration-300"></div>

            <div class="flex items-center justify-between px-5 pt-5 pb-3 relative z-10">
                <h4 class="font-bold text-slate-900 dark:text-white text-lg tracking-tight transition-colors duration-300">{{ $t('popups.addressBook.title') }}</h4>

                <button
                    class="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-white transition-colors duration-300 cursor-pointer shadow-sm dark:shadow-none"
                    @click="closeModal"
                >
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>

            <div class="flex-1 overflow-y-auto custom-scrollbar px-4 py-2 relative z-10">

                <div v-if="wallets.length === 0 && myAccounts.length === 0 && recent.length === 0" class="flex flex-col items-center justify-center py-10 text-center space-y-4">
                    <div class="w-16 h-16 rounded-full bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 flex items-center justify-center mb-2 transition-colors duration-300">
                        <svg class="w-8 h-8 text-slate-300 dark:text-zinc-600 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                        </svg>
                    </div>
                    <div>
                        <h5 class="text-slate-900 dark:text-white font-bold text-base mb-1 transition-colors duration-300">{{ $t('popups.addressBook.empty_title') }}</h5>
                        <p class="text-slate-500 dark:text-zinc-500 text-xs leading-relaxed max-w-50 mx-auto transition-colors duration-300">{{ $t('popups.addressBook.empty_desc') }}</p>
                    </div>
                </div>

                <template v-else>
                    <div v-if="myAccounts.length" class="mb-4">
                        <h5 class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider px-1 mb-2 transition-colors duration-300">{{ $t('popups.addressBook.section_my_accounts') }}</h5>
                        <div class="space-y-3">
                            <button
                                v-for="account in myAccounts"
                                :key="account.key || account.pickAddress"
                                @click="selectWallet({ address: account.pickAddress, label: account.name })"
                                class="group w-full relative text-left overflow-hidden bg-slate-50 dark:bg-[#131315] hover:bg-white dark:hover:bg-[#18181b] border border-slate-200 dark:border-white/5 hover:border-indigo-400 dark:hover:border-indigo-500/30 rounded-2xl p-3 flex items-center justify-between transition-all duration-300 shadow-sm dark:shadow-none cursor-pointer"
                            >
                                <div class="flex items-center gap-4 w-full">
                                    <img :src="`https://api.dicebear.com/7.x/identicon/svg?seed=${account.pickAddress}`" class="w-10 h-10 rounded-full bg-white dark:bg-black border border-slate-200 dark:border-white/10 shrink-0 shadow-sm dark:shadow-inner transition-colors duration-300" />

                                    <div class="flex-1 min-w-0">
                                        <h5 class="text-sm font-bold text-slate-900 dark:text-white truncate pr-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-200 transition-colors duration-300 mb-0.5">{{ account.name }}</h5>
                                        <span class="text-xs font-mono text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ shortenAddress(account.pickAddress) }}</span>
                                    </div>
                                </div>
                            </button>
                        </div>
                    </div>

                    <h5 v-if="wallets.length" class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider px-1 mb-2 transition-colors duration-300">{{ $t('popups.addressBook.section_saved') }}</h5>
                    <div class="space-y-3">
                    <button
                        v-for="(wallet, index) in wallets"
                        :key="index"
                        @click="selectWallet(wallet)"
                        class="group w-full relative text-left overflow-hidden bg-slate-50 dark:bg-[#131315] hover:bg-white dark:hover:bg-[#18181b] border border-slate-200 dark:border-white/5 hover:border-indigo-400 dark:hover:border-indigo-500/30 rounded-2xl p-3 flex items-center justify-between transition-all duration-300 shadow-sm dark:shadow-none cursor-pointer"
                    >
                        <div class="flex items-center gap-4 w-full">
                            <div class="w-10 h-10 rounded-full bg-white dark:bg-linear-to-br dark:from-zinc-800 dark:to-[#09090b] border border-slate-200 dark:border-white/10 flex items-center justify-center text-sm font-bold text-indigo-600 dark:text-indigo-400 shrink-0 shadow-sm dark:shadow-inner transition-colors duration-300">
                                {{ wallet.label.charAt(0).toUpperCase() }}
                            </div>

                            <div class="flex-1 min-w-0">
                                <div class="flex items-center justify-between mb-0.5">
                                    <div class="flex items-center gap-1.5 min-w-0 pr-2">
                                        <h5 class="text-sm font-bold text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-200 transition-colors duration-300">{{ wallet.label }}</h5>
                                        <!-- Zincir rozeti (F3): filtre sonrasi tum satirlar AYNI vm'e ait olsa
                                             da, kaydin HANGI zincire ait oldugu acikca gorunur -- listede yalniz
                                             tek bicim varmis GIBI SUNMAK yerine, secilen adresin kimligini
                                             kullanici KENDI GOZUYLE dogrulayabilir.
                                             Rozet AKTIF AGDAN degil SATIRIN KENDI adresinden turetilir
                                             (bkz. chainBadge): aktif aga baglansaydi TON agindaki her satira
                                             "EVM" yazardi -- Receive.vue'de ayni hata "uyari etiketi secili
                                             satiri izler" kuraliyla kapatildi. -->
                                        <span v-if="chainBadge(wallet.address)" class="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 transition-colors duration-300">{{ chainBadge(wallet.address) }}</span>
                                    </div>
                                    <span v-if="wallet.balance !== undefined" class="text-sm font-bold text-slate-900 dark:text-white tracking-wide transition-colors duration-300 shrink-0">${{ wallet.balance.toLocaleString() }}</span>
                                </div>

                                <div class="flex items-center justify-between">
                                    <div class="flex items-center gap-2 group/copy" @click.stop="copyAddress(wallet.address)">
                                        <span class="text-xs font-mono text-slate-500 dark:text-zinc-500 group-hover/copy:text-indigo-600 dark:group-hover/copy:text-zinc-300 transition-colors duration-300 cursor-pointer">{{ shortenAddress(wallet.address) }}</span>

                                        <svg v-if="copiedAddress !== wallet.address" class="w-3 h-3 text-slate-400 dark:text-zinc-600 group-hover/copy:text-indigo-500 dark:group-hover/copy:text-zinc-400 opacity-0 group-hover:opacity-100 transition-all duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>

                                        <span v-else class="text-[10px] text-emerald-600 dark:text-emerald-500 flex items-center gap-1 transition-colors duration-300">
                                            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </button>
                    </div>

                    <!-- SON GONDERDIKLERIM.
                         Her basarili gonderimde alici zaten diske yaziliyordu ama
                         bu liste yalnizca zehirli adres tespiti tarafindan
                         okunuyordu; kullanici en sik gonderdigi adresi her
                         seferinde elle yaziyordu.

                         Bolum EN SONDA duruyor ve bu bilincli: kullanicinin
                         kurdugu listeler (kendi hesaplari, kayitli adresler)
                         once gelir. Gecmis DOGRULANMAMIS veridir - bir kez
                         kanip gonderilmis bir zehirli ikiz de buraya yazilir. -->
                    <template v-if="recent.length">
                        <h5 class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider px-1 mb-2 mt-4 transition-colors duration-300">{{ $t('popups.addressBook.section_recent') }}</h5>
                        <div class="space-y-3">
                            <button
                                v-for="item in recent"
                                :key="item.address"
                                @click="selectWallet({ address: item.address, label: item.label })"
                                class="group w-full relative text-left overflow-hidden bg-slate-50 dark:bg-[#131315] hover:bg-white dark:hover:bg-[#18181b] border border-slate-200 dark:border-white/5 hover:border-indigo-400 dark:hover:border-indigo-500/30 rounded-2xl p-3 flex items-center justify-between transition-all duration-300 shadow-sm dark:shadow-none cursor-pointer"
                            >
                                <div class="flex items-center gap-4 w-full">
                                    <!-- Identicon burada bir GUVENLIK ogesi: birbirine cok
                                         benzeyen iki adres tamamen farkli desen uretir. -->
                                    <img :src="`https://api.dicebear.com/7.x/identicon/svg?seed=${item.address}`" class="w-10 h-10 rounded-full bg-white dark:bg-black border border-slate-200 dark:border-white/10 shrink-0 shadow-sm dark:shadow-inner transition-colors duration-300" />

                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-center justify-between gap-2 mb-0.5">
                                            <h5 class="text-sm font-bold text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-200 transition-colors duration-300">{{ item.label || shortenAddress(item.address) }}</h5>
                                            <span v-if="item.count > 1" class="text-[10px] font-medium text-slate-400 dark:text-zinc-600 shrink-0 transition-colors duration-300">{{ $t('popups.addressBook.sent_count', { count: item.count }) }}</span>
                                        </div>
                                        <span class="text-xs font-mono text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ shortenAddress(item.address) }}</span>
                                    </div>
                                </div>
                            </button>
                        </div>
                    </template>
                </template>
            </div>

            <div class="p-4 border-t border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-[#09090b] relative z-10 transition-colors duration-300">
                <button
                    @click="addWallet"
                    class="w-full py-3.5 rounded-xl border border-dashed border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900/50 text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-white hover:border-indigo-400 dark:hover:border-zinc-500 hover:bg-indigo-50 dark:hover:bg-zinc-800 transition-all duration-300 flex items-center justify-center gap-2 font-bold text-sm group cursor-pointer"
                >
                    <div class="w-6 h-6 rounded-full bg-slate-100 dark:bg-zinc-800 group-hover:bg-indigo-100 dark:group-hover:bg-zinc-700 flex items-center justify-center transition-colors duration-300">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
                    </div>
                    {{ $t('popups.addressBook.btn_add_wallet') }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { popupStore } from '../../store/popup'
import { pageStore } from '../../store/pageStore'
import { flattenVaultAccounts } from '../../utils/knownRecipients'
import { getSentRecipients } from '../../utils/sentRecipients'
import { pickRecentRecipients, RECENT_RECIPIENTS_SHOWN } from '../../utils/recentRecipients'
import { networkStore } from '../../store/network'
import { chainVm } from '../../utils/vm'
import { canonicalAddress } from '../../utils/addressForm'

const emit = defineEmits(['select'])

const popups = popupStore()
const page = pageStore()
const network = networkStore()

// KOD INCELEMESI (Task 16b review, F3): bu ekran Send.vue'nun alici SECTIRDIGI
// yerdir -- Receive.vue/Header.vue'de kapatilan ayni acik burada DA vardi:
// `myAccounts` her zaman `account.address` (EVM) yayiyordu ve `wallets`
// (saved_addresses) hicbir zincir filtresi olmadan TUMU listeleniyordu. Solana
// aktifken bu, kullanicinin KENDI hesap adi altinda KENDI EVM adresini "gonder"
// secenegi olarak sunuyordu -- adres bicimsel gecerli oldugu icin
// validateRecipient bunu REDDETMEZ (Solana'da bir EVM adresi zaten gecersiz
// sayilir ve Send bunu yakalar), ama kullaniciya "kendi hesabinla ayni isimdeki
// bir secenek neden gecersiz" diye SASIRTICI bir deneyim yasatirdi.
//
// chainVm UC deger doner: 'evm' | 'ton' | 'solana'. TON kaydinda `vm` alani YOK
// (kind:'ton'), Solana kaydinda `kind` alani YOK (vm:'solana') -- tek bir alana
// bakan her kontrol otekini yanlis siniflandirir, bu yuzden ortak kapi.
const vm = computed(() => chainVm(network.currentNetwork))

const wallets = ref([])
const myAccounts = ref([])
const copiedAddress = ref(null)
// Daha once gonderilmis aliciler. Kayitli adresler ve kendi hesaplar
// pickRecentRecipients icinde eleniyor - ayni adres iki bolumde birden
// gorunmesin.
const recent = ref([])

// addressForm.js YALNIZCA 'evm' ve 'solana' bicimlerini taniyor; TON adresi
// (base64url, '-' ve '_' icerir) hicbirine uymaz ve `canonicalAddress` null doner.
//
// Bu yuzden bicim filtresi TON'da UYGULANMAZ. Uygulansaydi `form === 'ton'`
// hicbir kayitla eslesmez ve adres defteri TON agida TAMAMEN BOSALIRDI --
// sessiz bir ozellik kaybi. TON'da liste bugunku (origin/main) davranisiyla
// filtresiz kalir; satirdaki zincir rozeti yine de EVM/Solana kayitlarini
// isaretler, boylece kullanici yanlis zincirdeki kaydi GORUR.
//
// KALICI COZUM bu bilesende DEGIL: addressForm.js TON bicimini ogrenmeli
// (o dosya "TEK, PAYLASILAN kaynak" olarak tasarlandi ve burada ikinci bir
// tanima kopyasi acmak tam da onun onlemek icin var oldugu sapmayi baslatirdi).
const FILTERABLE_FORMS = new Set(['evm', 'solana'])
const matchesActiveVm = (address, currentVm) => {
    if (!FILTERABLE_FORMS.has(currentVm)) return true
    return canonicalAddress(address)?.form === currentVm
}

// Satirin KENDI adresinden turetilen zincir rozeti. Taninmayan bicim (bugun: TON)
// icin rozet HIC basilmaz -- bilinmeyen bir adrese zincir adi yazmak, yanlis
// zincir adi yazmakla ayni sinifta hatadir.
const chainBadge = (address) => {
    const form = canonicalAddress(address)?.form
    if (form === 'solana') return 'Solana'
    if (form === 'evm') return 'EVM'
    return null
}

// Hesabin AKTIF AGDAKI kimligi.
//
// Solana'da EVM `.address` DEGIL `.solanaAddress`, TON'da `.tonAddress`
// (testnet'te `.tonAddressTestnet` -- ensureTonAddress'in yazdigi AYNI alan adi;
// tek bir alan kullanilsaydi arayuz mainnet adresini gosterirken imzalama
// testnet sozlesmesiyle yapilirdi) teklif edilir. HENUZ cozulmemis (kullanicinin
// hic gecmedigi) hesaplar icin `null` doner ve cagiran onlari LISTELEMEZ --
// yanlis (EVM) adresi "bu hesabin Solana/TON adresi" gibi sunmak, kullanicinin
// kontrol etmedigi bir adrese para gondermesine yol acardi (bkz. Receive.vue ve
// useDisplayAddress.js'deki AYNI ilke: karsi zincirin adresine ASLA DUSULMEZ).
const identityForVm = (account, currentVm, testnet) => {
    if (currentVm === 'solana') return account?.solanaAddress || null
    if (currentVm === 'ton') return (testnet ? account?.tonAddressTestnet : account?.tonAddress) || null
    return account?.address || null
}

// Iki kimligin AYNI hesap olup olmadigi.
//
// EVM hex'inde kasa anlamsizdir ve kucultulerek karsilastirilir. base58/base64url
// (Solana ve TON) adresler BIREBIR karsilastirilir: kucultmek iki FARKLI adresi
// ayni sayardi ve burada bunun bedeli "aktif hesabi kendine gonderim listesinden
// eleyememek" degil, YANLIS hesabi elemek olurdu.
const sameIdentity = (a, b, currentVm) => {
    if (!a || !b) return false
    if (currentVm === 'evm') return a.toLowerCase() === b.toLowerCase()
    return a === b
}

onMounted(async () => {
    const { saved_addresses, vaults, active_account } = await chrome.storage.local.get(['saved_addresses', 'vaults', 'active_account'])
    const currentVm = vm.value
    const testnet = Boolean(network.currentNetwork?.testnet)

    const allSaved = saved_addresses || []

    // Kayitli adresler: yalniz AKTIF vm'in BICIMINE uyanlar gosterilir. `chainId`
    // alanina DEGIL adresin KENDI BICIMINE (addressForm.js) bakilir -- Task 16b
    // ONCESI kaydedilmis TUM adresler chainId:1 tasir (Solana henuz yoktu), yani
    // chainId'ye guvenmek eski kayitlari yanlis sinifa duserdi. Bicim kontrolu
    // hem eski hem yeni kayitlarda dogru calisir.
    wallets.value = allSaved.filter(w => matchesActiveVm(w?.address, currentVm))

    // Kendi hesaplari: aktif (gonderen) hesap haric — kendine gonderim genelde hata.
    //
    // `allAccounts` FILTRESIZ ve ELEMEDEN ONCE alinir: asagidaki "son
    // gonderdiklerim" tekillestirmesi tam da AKTIF hesabi da iceren listeye
    // ihtiyac duyar (bkz. oradaki not). Aktif agin kimligi (`pickAddress`)
    // burada isaretlenir; eleme o kimlik uzerinden yapilir, EVM `.address`
    // uzerinden DEGIL — Solana'da hesabin adresi `solanaAddress` alanindadir.
    const allAccounts = flattenVaultAccounts(vaults)
        .map(acc => ({ ...acc, pickAddress: identityForVm(acc, currentVm, testnet) }))
    const activeIdentity = identityForVm(active_account, currentVm, testnet)

    myAccounts.value = allAccounts.filter(acc => acc.pickAddress && !sameIdentity(acc.pickAddress, activeIdentity, currentVm))

    // AKTIF hesap DAHIL butun hesaplar eleniyor (yukaridaki filtrelenmis liste
    // `myAccounts.value` DEGIL, `allAccounts`): aktif hesap gonderendir ve onu
    // alici olarak onermek dogrudan bir hata yolu. Bu ELEMENIN FILTRESIZ liste
    // uzerinden yapilmasi ZORUNLU, cunku aktif hesabin kimligi aktif vm'e UYAR
    // ve asagidaki bicim filtresi onu ELEYEMEZ.
    //
    // Kayitli adreslerde ise vm ile FILTRELENMIS liste (`wallets.value`) yeter:
    // filtre disi kalan her kayit tanim geregi aktif vm'in BICIMINE uymaz, yani
    // ayni adresi tasiyan bir gecmis satiri zaten asagidaki `matchesActiveVm`
    // kapisinda duser — iki liste ayni sonucu verir.
    try {
        // `limit: -1` = KIRPMA YOK. Kirpma ASAGIDA, bicim filtresinden SONRA
        // yapilir ve bu SIRA ZORUNLUDUR: gecmis butun zincirleri KARISIK tutar
        // ve lastSentAt'e gore siralidir, yani once kirpilirsa (varsayilan
        // RECENT_RECIPIENTS_SHOWN=5) son 5 alicinin hepsi EVM oldugu anda
        // Solana'da bolum BOSALIR -- gecmiste eslesen Solana alicilari OLSA
        // BILE. Kullanici acisindan bu, ozelligin sessizce yok olmasidir.
        const picked = pickRecentRecipients(await getSentRecipients(), {
            savedAddresses: wallets.value,
            myAccounts: allAccounts,
            limit: -1,
        })
        // Gecmis butun zincirleri karisik tutar; kayitli adreslerle AYNI bicim
        // filtresinden gecer ki Solana agida bir EVM alicisi "tekrar gonder"
        // secenegi olarak sunulmasin.
        recent.value = picked
            .filter(item => matchesActiveVm(item?.address, currentVm))
            .slice(0, RECENT_RECIPIENTS_SHOWN)
    } catch (e) {
        // Gecmis okunamadi: bolum gorunmez, defterin geri kalani calismaya devam
        // eder. Bir depo hiccup'i adres secmeyi engellememeli.
        console.warn('Gonderim gecmisi okunamadi:', e.message)
    }
})

const shortenAddress = (addr) => {
    if (!addr) return ''
    if (addr.length < 15) return addr
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

const selectWallet = (wallet) => {
    emit('select', wallet)

    setTimeout(() => {
        closeModal()
    }, 200)
}

const copyAddress = async (address) => {
    try {
        await navigator.clipboard.writeText(address)
        copiedAddress.value = address
        setTimeout(() => { copiedAddress.value = null }, 1500)
    } catch (e) {
        console.error(e)
    }
}

const addWallet = () => {
    closeModal()
    page.currentPage = 'settings_add_address'
}

const closeModal = () => {
    popups.addressBook = false
}
</script>
