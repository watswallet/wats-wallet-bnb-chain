<template>
    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-between px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="settings" class="hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <span class="w-8"></span>

            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.dapps.title') }}</h1>

            <span class="w-8"></span>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar relative z-10">
            
            <div v-if="hicBaglantiYok" class="flex flex-col items-center justify-center h-full gap-4 px-8 text-center -mt-10 transition-colors duration-300">
                <div class="relative group">
                    <div class="absolute inset-0 bg-indigo-500/10 dark:bg-indigo-500/10 rounded-full blur-xl group-hover:blur-2xl transition-all"></div>
                    <div class="relative w-20 h-20 bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 rounded-full flex items-center justify-center shadow-lg dark:shadow-xl transition-colors duration-300">
                        <svg class="w-8 h-8 text-slate-300 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                    </div>
                </div>

                <div class="space-y-1">
                    <h3 class="text-base font-bold text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.dapps.empty_title') }}</h3>
                    <p class="text-xs text-slate-500 dark:text-zinc-500 leading-relaxed transition-colors duration-300">{{ $t('settings.dapps.empty_desc') }}</p>
                </div>
            </div>

            <div v-else class="flex flex-col gap-5 p-4 pb-20">
                <div v-if="dapps_list.length" class="flex flex-col gap-3">
                    <div
                        v-for="dapp in dapps_list"
                        :key="dapp"
                        class="group w-full bg-white dark:bg-[#131315] hover:bg-slate-50 dark:hover:bg-[#18181b] border border-slate-200 dark:border-white/5 hover:border-indigo-400 dark:hover:border-white/10 rounded-2xl p-4 flex items-center justify-between transition-all duration-300 shadow-sm dark:shadow-none"
                    >
                        <div class="flex items-center gap-3 overflow-hidden">
                            <div class="relative w-10 h-10 rounded-xl bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-white/5 flex items-center justify-center shrink-0 overflow-hidden shadow-inner transition-colors duration-300">
                                <img
                                    :src="apps[dapp]?.favicon"
                                    @error="$event.target.src = 'https://api.dicebear.com/7.x/initials/svg?seed=' + dapp"
                                    alt="dapp icon"
                                    class="w-full h-full object-cover p-1"
                                >
                            </div>

                            <div class="flex flex-col items-start min-w-0">
                                <span class="text-sm font-bold text-slate-900 dark:text-white truncate w-full text-start group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors duration-300">{{ getHostname(dapp) }}</span>

                                <span class="text-[10px] text-slate-500 dark:text-zinc-500 truncate w-full text-start font-mono transition-colors duration-300">{{ dapp }}</span>
                            </div>
                        </div>

                        <div class="flex items-center gap-1.5 shrink-0">
                            <button
                                @click="page.data = dapp; page.currentPage = 'settings_dapp_permissions'"
                                class="p-2 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-zinc-800/50 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 text-slate-400 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 border border-slate-200 dark:border-transparent hover:border-indigo-200 dark:hover:border-indigo-500/20 transition-all cursor-pointer"
                                :title="$t('header.manage_permissions') || 'İzinleri Yönet'"
                            >
                                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                            </button>

                            <button
                                @click="disconnect(dapp)"
                                class="p-2 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-zinc-800/50 hover:bg-rose-50 dark:hover:bg-rose-500/10 text-slate-400 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-500 border border-slate-200 dark:border-transparent hover:border-rose-200 dark:hover:border-rose-500/20 transition-all cursor-pointer"
                                :title="$t('settings.dapps.disconnect_tooltip')"
                            >
                                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- TON oturumlari AYRI bir kayitta (ton_dapps) tutulur ve EVM'den
                     AYRI bir bolumde listelenir: kullanicinin bir TON dapp'iyle
                     baglantisini gorebilecegi ve kesebilecegi TEK yer burasi
                     (Header.vue'daki "bu sitede baglisin" acilir menusu bu turda
                     bilincli olarak EVM'e ozel kaldi). Izin dugmesi YOK: TON
                     oturumlari tek hesaba baglidir, EVM'deki gibi hesap izni
                     yonetimi kavrami TON tarafinda mevcut degil. -->
                <div v-if="tonOturumlari.length" class="flex flex-col gap-3">
                    <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider px-1 transition-colors duration-300">{{ $t('settings.dapps.ton_section_title') }}</p>

                    <div
                        v-for="oturum in tonOturumlari"
                        :key="oturum.hostname"
                        class="group w-full bg-white dark:bg-[#131315] hover:bg-slate-50 dark:hover:bg-[#18181b] border border-slate-200 dark:border-white/5 hover:border-indigo-400 dark:hover:border-white/10 rounded-2xl p-4 flex items-center justify-between transition-all duration-300 shadow-sm dark:shadow-none"
                    >
                        <div class="flex items-center gap-3 overflow-hidden">
                            <div class="relative w-10 h-10 rounded-xl bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-white/5 flex items-center justify-center shrink-0 overflow-hidden shadow-inner transition-colors duration-300">
                                <img
                                    :src="oturum.manifest?.iconUrl"
                                    @error="$event.target.src = 'https://api.dicebear.com/7.x/initials/svg?seed=' + oturum.hostname"
                                    alt="ton dapp icon"
                                    class="w-full h-full object-cover p-1"
                                >
                            </div>

                            <div class="flex flex-col items-start min-w-0">
                                <span class="text-sm font-bold text-slate-900 dark:text-white truncate w-full text-start group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors duration-300">{{ getHostname(oturum.hostname) }}</span>

                                <span class="text-[10px] text-slate-500 dark:text-zinc-500 truncate w-full text-start font-mono transition-colors duration-300">{{ shortenTonAddress(oturum.address) }}</span>
                            </div>
                        </div>

                        <div class="flex items-center gap-1.5 shrink-0">
                            <button
                                @click="tonBaglantisiniKes(oturum.hostname)"
                                class="p-2 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-zinc-800/50 hover:bg-rose-50 dark:hover:bg-rose-500/10 text-slate-400 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-500 border border-slate-200 dark:border-transparent hover:border-rose-200 dark:hover:border-rose-500/20 transition-all cursor-pointer"
                                :title="$t('settings.dapps.disconnect_tooltip')"
                            >
                                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Solana oturumlari UCUNCU bir kayitta (solana_dapps) tutulur.
                     TON'dan AYRILAN TEK NOKTA anahtarin TAM ORIGIN olmasidir
                     (K5): hostname yetmez, cunku `https://app.x.com` ile
                     `http://app.x.com` ve o host'un HER portu ayni yetkiyi
                     paylasir gibi gorunurdu -- kullanici hangisini kestigini
                     bilemezdi. Bu yuzden burada getHostname KULLANILMAZ.
                     Izin dugmesi YOK: Solana oturumu tek hesaba SABITTIR (K10).
                     appMeta ikonu (uzak URL) BILEREK render EDILMEZ: Wallet
                     Standard'da manifest dogrulamasi YOKTUR, sayfanin verdigi
                     ikon tamamen saldirgan kontrolundedir ve ayarlar ekranindan
                     her acilista o adrese istek atmak olurdu. -->
                <div v-if="solanaOturumlari.length" class="flex flex-col gap-3">
                    <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider px-1 transition-colors duration-300">{{ $t('settings.dapps.solana_section_title') }}</p>

                    <div
                        v-for="oturum in solanaOturumlari"
                        :key="oturum.origin"
                        class="group w-full bg-white dark:bg-[#131315] hover:bg-slate-50 dark:hover:bg-[#18181b] border border-slate-200 dark:border-white/5 hover:border-indigo-400 dark:hover:border-white/10 rounded-2xl p-4 flex items-center justify-between transition-all duration-300 shadow-sm dark:shadow-none"
                    >
                        <div class="flex items-center gap-3 overflow-hidden">
                            <div class="relative w-10 h-10 rounded-xl bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-white/5 flex items-center justify-center shrink-0 overflow-hidden shadow-inner transition-colors duration-300">
                                <img
                                    :src="'https://api.dicebear.com/7.x/initials/svg?seed=' + getHostname(oturum.origin)"
                                    alt="solana dapp icon"
                                    class="w-full h-full object-cover p-1"
                                >
                            </div>

                            <div class="flex flex-col items-start min-w-0">
                                <span class="text-sm font-bold text-slate-900 dark:text-white truncate w-full text-start group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors duration-300">{{ oturum.origin }}</span>

                                <span class="text-[10px] text-slate-500 dark:text-zinc-500 truncate w-full text-start font-mono transition-colors duration-300">{{ shortenSolanaAddress(oturum.address) }}</span>

                                <!-- C3.2: appMeta.name TAMAMEN dapp (saldirgan) kontrolundedir --
                                     onay ekranlarinin (SolanaSignTx/SignMessage/ConnectApprove) kullandigi
                                     AYNI PAYLASILAN gorunmezlik/homoglif helper'inden (gorunurKil) gecer. -->
                                <span v-if="typeof oturum.appMeta?.name === 'string' && oturum.appMeta.name.trim()" class="text-[10px] text-slate-400 dark:text-zinc-600 truncate w-full text-start transition-colors duration-300">{{ $t('dapps.solana.claimedName') }}: {{ gorunurKil(oturum.appMeta.name) }}</span>
                            </div>
                        </div>

                        <div class="flex items-center gap-1.5 shrink-0">
                            <button
                                @click="solanaBaglantisiniKes(oturum.origin)"
                                class="p-2 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-zinc-800/50 hover:bg-rose-50 dark:hover:bg-rose-500/10 text-slate-400 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-500 border border-slate-200 dark:border-transparent hover:border-rose-200 dark:hover:border-rose-500/20 transition-all cursor-pointer"
                                :title="$t('settings.dapps.disconnect_tooltip')"
                            >
                                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref, computed } from 'vue'
import Back from '../Back.vue'
import { pageStore } from '../../store/pageStore'
import { gorunurKil } from '../../utils/solana/visibleText.js'
import { SOLANA_ENABLED } from '../../utils/featureFlags'

const page = pageStore()
const dapps_list = ref([])
const apps = ref({})
const ton_dapps = ref({})
const solana_dapps = ref({})

onMounted(async() => {
    const { dapps = {}, ton_dapps: tonKayitlar = {}, solana_dapps: solanaKayitlar = {} } =
        await chrome.storage.local.get(['dapps', 'ton_dapps', 'solana_dapps'])
    apps.value = dapps
    dapps_list.value = Object.keys(dapps)
    ton_dapps.value = tonKayitlar
    solana_dapps.value = solanaKayitlar
})

// TON oturumlari EVM'in `dapps` kaydiyla KARISTIRILMAZ: ayri bir depoda
// (`ton_dapps`) tutulur (bkz. tonConnectAuthz.js basindaki not -- notifyConnectedDapps
// TUM `dapps` hostname'lerine EIP-1193 olayi yayinliyor, TON kayitlari oraya
// girseydi TON dapp'lerine anlamsiz chainChanged/accountsChanged giderdi).
// Goruntu icin duz { hostname, ...session } nesnelerine cevrilir.
const tonOturumlari = computed(() =>
    Object.entries(ton_dapps.value).map(([hostname, session]) => ({ hostname, ...session }))
)

// Bos-durum ekrani UC listeye BIRDEN bakmali: yalniz `dapps_list`e bakan bir
// kosul, TON veya Solana baglantisi VARKEN EVM baglantisi yoksa yanlislikla
// bos-durum ekranini (settings.dapps.empty_title) gosterirdi ve kullanici o
// baglantiyi HIC goremezdi.
const hicBaglantiYok = computed(() =>
    dapps_list.value.length === 0 && tonOturumlari.value.length === 0 && solanaOturumlari.value.length === 0
)

// URL'den temiz hostname çıkarma
const getHostname = (url) => {
    try {
        // Eğer protocol yoksa ekle (URL constructor hatasını önlemek için)
        const fullUrl = url.startsWith('http') ? url : `https://${url}`
        return new URL(fullUrl).hostname
    } catch (e) {
        return url.split('://')[1] || url
    }
}

const shortenTonAddress = (addr) => {
    if (!addr) return ''
    return `${addr.slice(0, 8)}...${addr.slice(-6)}`
}

const disconnect = async(dapp) => {
    // Optimistik UI güncellemesi
    const newApps = { ...apps.value }
    delete newApps[dapp]
    apps.value = newApps
    dapps_list.value = dapps_list.value.filter(item => item !== dapp)

    // Storage güncelleme
    await chrome.storage.local.set({ dapps: newApps })
    chrome.runtime.sendMessage({ type: 'DISCONNECT_DAPP', hostname: dapp })
}

// TON kesme EVM'den FARKLI akis izler: silme ARKA PLANDA yapilir
// (DISCONNECT_TON_DAPP isleyicisi ton_dapps'tan zaten siliyor), bilesen
// STORAGE'A YAZMAZ, yalniz mesaji gonderip listeyi TAZELER. EVM'deki gibi
// burada da once silip sonra mesaj gondermek, ikisinden biri basarisiz
// oldugunda ekranla disk arasinda KALICI bir ayrisma birakirdi (Gorev 14
// kontrolor karari: silme TEK yerde olmali).
const tonBaglantisiniKes = async (hostname) => {
    await chrome.runtime.sendMessage({ type: 'DISCONNECT_TON_DAPP', hostname })
    const { ton_dapps: guncel = {} } = await chrome.storage.local.get('ton_dapps')
    ton_dapps.value = guncel
}

// Solana oturumlari UCUNCU bir depoda (`solana_dapps`) durur: `dapps`a
// girselerdi notifyConnectedDapps her hostname'e EIP-1193 olayi yayinladigi
// icin Solana dapp'lerine anlamsiz chainChanged/accountsChanged giderdi;
// `ton_dapps` ise TON sekilli. Goruntu icin duz { origin, ...session }.
//
// SOLANA_ENABLED KAPALIYKEN BOS DONER. Bu bolum zincir kaydina BAKMAZ -- veriyi
// dogrudan depodan okur, yani data/supportedChains filtresi burayi KAPATMAZ.
// Kapi olmadan, bayrak kapatildiktan sonra eskiden kalma oturumlari olan bir
// kullanici bolumu gormeye devam ederdi ve "Baglantiyi kes" dugmesi arka plan
// kapisina (DISCONNECT_SOLANA_DAPP) carpip SESSIZCE hicbir sey yapmazdi.
//
// Depo TEMIZLENMEZ: bayrak yeniden acildiginda kullanicinin verdigi yetkiler
// oldugu gibi geri gelir. Kapali bayrak bir GORUNURLUK karari, bir veri silme
// karari DEGIL.
const solanaOturumlari = computed(() =>
    SOLANA_ENABLED
        ? Object.entries(solana_dapps.value).map(([origin, session]) => ({ origin, ...session }))
        : []
)

// base58 BUYUK/KUCUK harfe DUYARLIDIR (K8): burada hicbir normalizasyon
// yapilmaz, yalnizca ortasi kirpilir. Fix turu 1 (C2): kaynak dapp bozuk bir
// kayit birakabilir (dize olmayan/kisa adres) -- 10 karakterden KISA
// adreslerde slice(0,4)+slice(-4) orta kisim CAKISIR ("abc" -> "abc...abc"
// gibi anlamsiz bir sonuc uretir), dize olmayan bir deger de .slice
// olmadigi icin RENDER'i COKERTIR.
const shortenSolanaAddress = (addr) => {
    if (typeof addr !== 'string') return ''
    if (addr.length <= 10) return addr
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`
}

// TON kesmesiyle AYNI akis: silme ARKA PLANDA (handleDisconnectSolanaDapp)
// yapilir, bilesen STORAGE'A YAZMAZ, yalniz mesaji gonderip listeyi tazeler.
// Iki yerde silmek, biri basarisiz oldugunda ekranla disk arasinda KALICI bir
// ayrisma birakirdi. Fix turu 1 (C1): sendMessage AG hatasi/reddi verebilir
// (servis calisani uykuya dalmis, mesaj kanali kapanmis olabilir) -- bu
// durumda bilesen FIRLAMAMALI (kullanici tikladiginda ekran cokerdi), yalniz
// uyarir ve HER DURUMDA (basarili/basarisiz/hata) listeyi yeniden okur ki
// kullanici GERCEK durumu gorsun -- sessiz basarisizlik "cuzdan bozuk"
// izlenimi birakirdi.
const solanaBaglantisiniKes = async (origin) => {
    try {
        const yanit = await chrome.runtime.sendMessage({ type: 'DISCONNECT_SOLANA_DAPP', origin })
        if (!yanit || yanit.success === false) {
            console.warn('[dapps] DISCONNECT_SOLANA_DAPP basarisiz:', yanit)
        }
    } catch (e) {
        console.warn('[dapps] DISCONNECT_SOLANA_DAPP hata:', e)
    }
    const { solana_dapps: guncel = {} } = await chrome.storage.local.get('solana_dapps')
    solana_dapps.value = guncel
}
</script>
