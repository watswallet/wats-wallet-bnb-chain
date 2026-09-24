<template>
    <!-- z-30 TEK BASINA YETMEZ: burasi bir yiginlama baglami acar, yani icerideki menunun
         z-50'si YALNIZCA bu kabin icinde gecerlidir. Kabin kendisi daha dusuk (ya da esit)
         z'li bir ata icindeyse menu, sonraki kardeslerin altinda kalir — swapFrom ve
         bridgeFrom'da tam olarak bu oldu (2026-08-20). Bu bileseni bir listenin yanina
         koyarken SARAN KABIN listeden yuksek z'li oldugunu dogrula. -->
    <div class="relative z-30">
        <button
            @click="open = !open"
            :disabled="switching"
            :title="triggerTitle"
            class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/50 hover:bg-white/80 dark:bg-zinc-800/50 dark:hover:bg-zinc-800 border border-slate-200 dark:border-white/10 shadow-sm transition-all text-xs font-semibold text-slate-700 dark:text-zinc-300 backdrop-blur-sm cursor-pointer disabled:opacity-60 disabled:cursor-wait"
        >
            <div class="w-4 h-4 rounded-full bg-slate-200 dark:bg-zinc-700 flex items-center justify-center overflow-hidden">
                <svg v-if="showAllLabel" class="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <img v-else :src="chainLogo(labelChainId)" class="w-full h-full object-cover" />
            </div>

            <span>{{ scopeLabel }}</span>

            <!-- AKTIF AG -- MENU ACILMADAN DA OKUNUR.
                 Yukaridaki etiket KAPSAMI gosterir, aktif agi DEGIL, ve kapsam OTURUM
                 ICI olup her acilista "Tum Aglar" ile baslar. Aktif zincirin adini
                 eskiden Header'daki ChangeNetwork chip'i KOSULSUZ basiyordu; o chip
                 birlestirmeyle kaldirilinca ana ekranin VARSAYILAN durumunda hangi
                 zincirde IMZALANDIGINI soyleyen hicbir sey kalmadi -- oysa Buy/Takas/
                 Kopru/dapp ve gonderim hep AKTIF agda kosar.
                 Menu icindeki satir isareti bu boslugu KAPATMAZ: bir tiklamanin
                 arkasindadir ve kendinden emin bir "Polygon" etiketi kullaniciya
                 menuyu acmak icin sebep vermez (kapsam ile aktif ag AYRISABILIR).
                 Kapsam ZATEN aktif zincirse ad tekrar edilmez, yalnizca yesil nokta
                 kalir: etiketin kendisi o zinciri adlandiriyor. -->
            <span v-if="switchesNetwork && activeChainName" class="flex items-center gap-1 shrink-0">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <template v-if="!isActiveChain(labelChainId)">
                    <img :src="activeChainLogo" class="w-3.5 h-3.5 rounded-full" />
                    <span class="max-w-16 truncate text-emerald-600 dark:text-emerald-400">{{ activeChainName }}</span>
                </template>
            </span>

            <svg class="w-3.5 h-3.5 transition-transform" :class="open ? 'rotate-180' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
        </button>

        <div v-if="open" class="fixed inset-0 z-40" @click="open = false"></div>

        <Transition
            enter-active-class="transition-all duration-200 ease-out"
            leave-active-class="transition-all duration-150 ease-in"
            enter-from-class="opacity-0 scale-95 -translate-y-1"
            enter-to-class="opacity-100 scale-100 translate-y-0"
            leave-from-class="opacity-100 scale-100 translate-y-0"
            leave-to-class="opacity-0 scale-95 -translate-y-1"
        >
            <div v-if="open" class="absolute z-50 top-full mt-2 w-48 left-1/2 -translate-x-1/2 bg-white dark:bg-[#131315] rounded-xl border border-slate-200 dark:border-white/10 shadow-xl overflow-hidden py-1 max-h-75 overflow-y-auto">
                <button
                    v-if="showAll"
                    @click="select(ALL_NETWORKS)"
                    class="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-left text-xs font-semibold text-slate-700 dark:text-zinc-300 cursor-pointer"
                >
                    <div class="w-5 h-5 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center">
                        <svg class="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    {{ $t('common.allNetworks') }}
                </button>

                <button
                    v-for="chain in chains" :key="chain.chainId"
                    @click="select(chain.chainId)"
                    :title="chain.name"
                    class="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-left text-xs font-semibold text-slate-700 dark:text-zinc-300 cursor-pointer"
                >
                    <img :src="chain.logoURI" class="w-5 h-5 rounded-full" />
                    <span class="truncate">{{ chain.name }}</span>

                    <!-- AKTIF ZINCIR ISARETI. Yalnizca bu pill agi da degistirirken
                         gosterilir ve birlestirmenin TEK gercek riskini kapatir:
                         "Tum Aglar" seciliyken etiket hicbir zincir adi tasimaz, yani
                         kullanici GORUNTULEDIGI listeyi gorur ama ISLEM YAPACAGI
                         zinciri goremez hale gelirdi (imzalama/gonderim her zaman
                         AKTIF agda olur, kapsamda degil). Nokta + kisa etiket, "hangi
                         agdayim" sorusunu menuyu acan ayni harekette cevaplar. -->
                    <span
                        v-if="switchesNetwork && isActiveChain(chain.chainId)"
                        class="ml-auto flex items-center gap-1 shrink-0"
                    >
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        <span class="text-[9px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">{{ $t('common.activeNetwork') }}</span>
                    </span>
                </button>
            </div>
        </Transition>
    </div>
</template>

<script setup>
/**
 * Bir listenin AG KAPSAMI secicisi: gosterilen bakiyeleri filtreler.
 *
 * VARSAYILAN (switchesNetwork = false) davranis DEGISMEDI: cuzdanin aktif agina
 * DOKUNMAZ. Takas / Kopru / Token Ara / Varlik Sec ekranlarinin dordu de prop'u
 * GECMEZ, yani orada kapsam degistirmek imzalama agini degistirmez -- "Token Ice
 * Aktar"da bir listeyi filtrelemenin cuzdani baska bir zincire tasimasi beklenmez.
 *
 * switchesNetwork = true YALNIZCA ana ekranda (Home.vue) verilir. Orada eskiden
 * GORSEL OLARAK BIRBIRINE BENZEYEN IKI acilir menu vardi: baslikta aktif agi
 * degistiren ChangeNetwork chip'i ve hemen altinda yalnizca gorunumu filtreleyen
 * bu pill. Kullanici ikisini ayirt edemedi; ag anahtari buraya TASINDI.
 *
 * BIRLESTIRME NOTU: bu menu artik EVM disi zincirleri de (Solana, TON) tasir --
 * LISTED_CHAINS ikisini de icerir ve burada VM'e gore DARALTILMAZ. Takas/Kopru
 * gibi EVM'e ozel ekranlardaki daraltma chainsForFlow'un isidir; bu pill cuzdanin
 * GENEL anahtaridir ve daraltilirsa o zincirlere giris yolu tamamen kapanir.
 */
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ALL_NETWORKS } from '../utils/networkFilter'
import { LISTED_CHAINS } from '../data/chains'
import { isSameChainId } from '../utils/vm'
import { chainOf, chainName, chainLogo } from '../utils/chainLogo'
import { chainsForAccount } from '../utils/accountKind'
import { networkStore } from '../store/network'
import { applyNetworkChange } from '../utils/applyNetworkChange'

const props = defineProps({
    modelValue: { type: [String, Number], required: true },
    allowAll: { type: Boolean, default: true },
    // Somut bir zincir secmek AKTIF AGI da degistirsin mi. Varsayilani false OLMAK
    // ZORUNDA: prop'u gecmeyen dort cagri yeri (swapFrom, bridgeFrom, SearchTokens,
    // SelectAssets) boylece TEK KARAKTER degismeden eski davranisini surdurur.
    switchesNetwork: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const network = networkStore()
const { t } = useI18n()

const open = ref(false)

// Ag degisimi UCUSTA mi. Yalnizca switchesNetwork verilen ekranda true olabilir
// (needsNetworkSwitch onu sart kosar), yani diger DORT cagri yeri etkilenmez.
const switching = ref(false)
let selectTicket = 0

// HESAP KAPISI. Menu LISTED_CHAINS'i FILTRESIZ listeliyordu - chainsForFlow'un
// akis icin kapattigi sizintinin HESAP boyutundaki ikizi.
//
// TON'a kilitli hesapta menu Ethereum'u, Polygon'u, hepsini gosteriyordu; birini
// secince kapsam o zincire gecip liste BOSALIYOR ve "bu agda token yok" yaziyordu.
// BIRLESTIRME SONRASI DAHA AGIR: bu pill artik switchesNetwork ile AKTIF AGI da
// degistiriyor, yani TON hesabinda bir EVM satirina basmak cuzdani, anahtari hic
// uretilmemis bir zincire tasimaya calisirdi. (applyNetworkChange kendi
// accountSupportsChain kapisiyla bunu AYRICA reddeder; buradaki filtre secenegin
// HIC sunulmamasini saglar -- iki kapi ayni yanlisi iki farkli katmanda keser.)
//
// Kapi bilesenin ICINDE: ayni pill alti ekranda kullaniliyor (Home, SelectAssets,
// SearchTokens, swapFrom, bridgeFrom) ve hesap kapisi ALTISINDA da gecerli. Cagirana
// birakmak, alti yerde tekrarlanan ve birinde unutulacak bir kural olurdu.
//
// `active_account` cozulene kadar liste FILTRESIZ (chainsForAccount null hesapta
// listeyi aynen dondurur): bir karelik fazla secenek, eksik secenekten iyidir ve
// networksPopup.vue da ayni yonu seciyor. Okuma SARMALANMIS: bu pill `chrome`
// olmayan baglamlarda da olusturulabiliyor ve cozulemeyen bir hesap okumasi
// menunun TAMAMINI dusurmemeli -- fail-open zaten yukaridaki karar.
const activeAccount = ref(null)
onMounted(async () => {
    try {
        const { active_account } = await chrome.storage.local.get('active_account')
        activeAccount.value = active_account
    } catch {
        activeAccount.value = null
    }
})

const chains = computed(() => chainsForAccount(activeAccount.value, LISTED_CHAINS))

// TEK ZINCIRLI hesapta "Tum Aglar" bir SECENEK DEGIL: kume zaten tek zincir.
// Secenek olarak sunmak, kullaniciya olmayan bir genislik vaat eder - kullanicinin
// bildirdigi sikayet tam olarak buydu ("sadece TON'da olmasina ragmen tum aglar").
const showAll = computed(() => props.allowAll && chains.value.length > 1)

const isAll = computed(() => props.modelValue === ALL_NETWORKS)

// Tek zincirli hesapta `modelValue` hala 'all' olabilir (varsayilan oydu ve ag hic
// DEGISMEDIGI icin kimse ezmedi - bkz. networkFilter.js). O durumda 'all' zaten O
// ZINCIRIN ta kendisi; ekranda zincirin adini yazmak DOGRUdur, "Tum Aglar" yazmak
// yanlis.
//
// Deger DEGISTIRILMIYOR, yalnizca dogru adlandiriliyor: store'a yazmak `chosen`
// mandalini kaldirirdi ve effectiveScope'un tek zincirli ekranlardaki davranisini
// sessizce degistirirdi (networkFilter.js'in bas yorumu).
const soleChain = computed(() => (chains.value.length === 1 ? chains.value[0] : null))
const showAllLabel = computed(() => isAll.value && !soleChain.value)

// Etiketin, logonun ve "aktif ag AYRICA yazilsin mi" sorusunun baktigi kimlik.
// Tek zincirli hesapta 'all' zaten O ZINCIRDIR; aktif ag adini ayrica basmak ayni
// adi iki kez yazardi ("TON . TON").
const labelChainId = computed(() => (isAll.value && soleChain.value ? soleChain.value.chainId : props.modelValue))

// Cozumleme ALL_CHAINS uzerinden: secili zincir testnet olabilir ve LISTED_CHAINS
// prod build'de testnet'leri barindirmiyor — adi/logosu yine gosterilmeli.
//
// isSameChainId KULLANILIR, kati Number() esitligi DEGIL: modelValue artik
// Solana'nin METIN kimligini de tasiyabiliyor (nextNetworkFilter/effectiveScope
// artik filtreyi Solana'ya da tasir). Number('solana-mainnet') NaN'dir ve
// NaN === NaN false oldugu icin kati esitlik zinciri hic bulamaz, pill'de ne ad
// ne logo gorunur — Home'un kendi filtre pilinde bos bir etiket kalirdi.
// (TON'un kimligi NEGATIF bir SAYIDIR ve sayisal yoldan gecer; ayni satir Solana'yi
// da tasimak zorunda oldugu icin karsilastirma yine isSameChainId'dir.)
// Uc satirin da govdesi utils/chainLogo.js'e tasindi; kural (ALL_CHAINS +
// isSameChainId) DEGISMEDI, yalniz tek kopyaya indi.

// Cuzdanin GERCEKTEN uzerinde oldugu zincir (kapsamdan BAGIMSIZ). isSameChainId
// SART: Solana'nin kimligi METIN ('solana-mainnet') ve kati === ayni zincirin
// 137 / '137' yazimlarini bile ayri sayardi.
const isActiveChain = (chainId) => isSameChainId(network.currentNetwork?.chainId, chainId)

// AKTIF AGIN adi/logosu KENDI KAYDINDAN okunur; ALL_CHAINS aramasi yalnizca
// yedektir (kayit zaten ikisini de tasir ve listede olmayan bir zincirde arama
// bos donerdi).
const activeChainName = computed(() => network.currentNetwork?.name || chainName(network.currentNetwork?.chainId))
const activeChainLogo = computed(() => network.currentNetwork?.logoURI || chainLogo(network.currentNetwork?.chainId))

const scopeLabel = computed(() => showAllLabel.value ? t('common.allNetworks') : chainName(labelChainId.value))

// Tetikleyicinin title'i iki soruyu birden cevaplar: NE LISTELENIYOR ve HANGI
// AGDAYIM. switchesNetwork VERILMEYEN dort ekranda ikinci soru ANLAMSIZDIR (orada
// kapsam ile aktif ag BILEREK ayrisir), o yuzden baslik orada degismeden kalir.
const triggerTitle = computed(() => {
    if (!props.switchesNetwork || !activeChainName.value) return scopeLabel.value
    if (isActiveChain(labelChainId.value)) return scopeLabel.value + ' (' + t('common.activeNetwork') + ')'
    return scopeLabel.value + ' · ' + t('common.activeNetwork') + ': ' + activeChainName.value
})

const select = async (value) => {
    open.value = false
    // KOSULSUZ EMIT iki gercek tuzak uretiyordu -- asagidaki kapinin sebebi bu:
    //   1) tokenScope'ta `chosen` mandali kalkiyor ve "kapsam sorulmadi" varsayilani
    //      oturum boyunca kayboluyordu (bildirilen "tum aglar" hatasi geri geliyordu),
    //   2) swapFrom pill'i TURETILMIS degeri gosterip PAYLASILAN store'a yazdigi icin,
    //      gorunen degeri onaylamak Home'un portfoy toplamini sessizce daraltiyordu.
    // Karsilastirma gevsek: modelValue sayi ya da 'all' olabilir.
    //
    // Kapi kapsama VE aktif aga BIRLIKTE bakar. YALNIZCA modelValue'ye bakmak OLU
    // BIR DUGME uretiyordu (kod incelemesi, yuksek): kapsam ile aktif ag AYRISABILIR
    // -- Gonder/Takas/Kopru/Token Ara ekranlarindaki pill'ler `switches-network`
    // GECMEDEN ayni PAYLASILAN store'a yazar (SelectAssets: scope.setFilter(value),
    // ag DEGISMEZ). Kullanici orada kapsami Polygon yapip Home'a donunce etiket
    // "Polygon" der ama cuzdan Ethereum'da kalir; o durumda Polygon satirina basmak
    // GERCEK bir "oraya gec" istegidir. Kapsam esitligine takilip yutulursa
    // kullanicinin DOGRUDAN hareketi hicbir sey yapmaz (once baska bir zincire,
    // sonra geri basmasi gerekirdi) -- ve bu pill artik agi degistirmenin TEK yolu
    // (Header'daki chip kaldirildi, Swap'in ChangeNetwork'u EVM-only).
    //
    // "Tum Aglar" bir ZINCIR DEGILDIR: gecilecek ag yoktur, yani orada bu gevseme
    // hic devreye girmez -- aksi halde capraz zincir portfoy toplami (Home'un tum
    // gerekcesi) secilemez hale gelirdi.
    //
    // ZATEN AKTIF OLAN zincir de disarida: applyNetworkChange yan etkisiz DEGILDIR
    // (swap/bridge token secimlerini SIFIRLAR, dapp'lere CHAIN_CHANGED yollar) ve ag
    // hic degismezken bunlari yapmak, kullanicinin girdigi tutari sadece listeyi
    // filtreledigi icin silerdi.
    const needsNetworkSwitch = props.switchesNetwork
        && value !== ALL_NETWORKS
        && !isActiveChain(value)

    // EKRANDA YAZAN degere basmak -- yapilacak bir ag degisimi de YOKKEN -- bir
    // SECIM DEGILDIR, menuyu kapatma hareketidir. switchesNetwork VERILMEYEN dort
    // cagri yerinde `needsNetworkSwitch` HER ZAMAN false'tur, yani onlarin davranisi
    // TEK KARAKTER degismez.
    if (String(value) === String(props.modelValue) && !needsNetworkSwitch) return

    if (needsNetworkSwitch) {
        const chain = chainOf(value)
        if (chain) {
            // YENIDEN GIRIS KORUMASI (kod incelemesi, orta). applyNetworkChange
            // ANINDA donmez: findFastestRPC her RPC icin 3sn zaman asimli iki
            // sonda kosar, yani bozuk baglantida SANIYELER surer. Menu hemen
            // kapaniyor ama tetikleyici acik kaliyordu: kullanici menuyu tekrar
            // acip BASKA bir zincir secebiliyordu. Iki cagri yarisinca ONCE
            // baslayan SONRA bitebiliyor ve emit sirasi tersine donuyordu --
            // kapsam bir zinciri, aktif ag baskasini gosteriyordu.
            //
            // AKIS BILEREK VERILMEZ (ucuncu arguman yok): burasi cuzdanin GENEL ag
            // anahtaridir, bir Takas/Kopru secicisi degil. Bir akis gecirilseydi
            // TON ve Solana bu menuden de reddedilir ve o zincirlere GIRIS yolu
            // kapanirdi. RPC hiz testinin EVM disinda atlanmasi applyNetworkChange'in
            // kendi `chainVm(...) === 'evm'` kapisinda, burada DEGIL.
            const ticket = ++selectTicket
            switching.value = true
            try {
                await applyNetworkChange(chain, t)
            } finally {
                // Bayragi YALNIZCA en son secim indirir; bayat bir cagrinin
                // bitisi, hala suren yeni secimin kilidini acmamali.
                if (ticket === selectTicket) switching.value = false
            }

            // Beklerken daha yeni bir secim basladi: bu cagri BAYAT. Emit etmek
            // kullanicinin YENI secimini eskisiyle ezerdi.
            if (ticket !== selectTicket) return
        }
    }

    // Kapsam zaten ayni degerdeyse bu emit degeri DEGISTIRMEZ ama `chosen` mandalini
    // kaldirir: kullanici bu soruya ACIKCA cevap verdi.
    emit('update:modelValue', value)
}
</script>
