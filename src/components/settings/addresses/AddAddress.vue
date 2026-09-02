<template>
    <div class="w-90 h-150 flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="settings_saved_addresses" class="absolute left-5 hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.addresses.addAddress.title') }}</h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pt-8 flex flex-col gap-8 relative z-10">
            <div class="flex flex-col items-center gap-4">
                <div class="relative group">
                    <div class="absolute inset-0 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-full blur-xl group-hover:blur-2xl transition-all duration-500"></div>
                    <div class="relative w-20 h-20 bg-white dark:bg-linear-to-br dark:from-zinc-800 dark:to-[#09090b] border-2 border-slate-200 dark:border-white/10 rounded-full flex items-center justify-center shadow-lg dark:shadow-2xl transition-colors duration-300">
                        <svg class="w-8 h-8 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
                    </div>
                </div>
                <p class="text-sm font-medium text-slate-500 dark:text-zinc-500 text-center transition-colors duration-300">{{ $t('settings.addresses.addAddress.desc') }}</p>
            </div>

            <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                    <label class="text-xs font-bold text-slate-400 dark:text-zinc-400 uppercase tracking-wider ml-1 transition-colors duration-300">{{ $t('settings.addresses.addAddress.label_name') }}</label>
                    <input 
                        v-model="label" 
                        type="text" 
                        :placeholder="$t('settings.addresses.addAddress.placeholder_name')" 
                        class="w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 rounded-xl py-3.5 px-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-all duration-300 shadow-sm dark:shadow-none"
                    >
                </div>

                <div class="flex flex-col gap-2">
                    <label class="text-xs font-bold text-slate-400 dark:text-zinc-400 uppercase tracking-wider ml-1 transition-colors duration-300">{{ $t('settings.addresses.addAddress.label_address') }}</label>
                    <div class="relative group">
                        <input
                            v-model="address"
                            type="text"
                            :placeholder="vm === 'solana' ? 'Base58 address...' : '0x...'"
                            class="w-full bg-white dark:bg-[#131315] border rounded-xl py-3.5 pl-4 pr-10 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none transition-all duration-300 font-mono shadow-sm dark:shadow-none"
                            :class="[
                                address && !isValid ? 'border-rose-400 dark:border-rose-500/50 focus:border-rose-500' : 
                                (address && isValid ? 'border-emerald-400 dark:border-emerald-500/50 focus:border-emerald-500' : 'border-slate-200 dark:border-white/10 focus:border-indigo-500')
                            ]"
                        >
                        <div class="absolute right-3 top-1/2 -translate-y-1/2">
                            <svg v-if="address && isValid" class="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                            <svg v-if="address && !isValid" class="w-4 h-4 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </div>
                    </div>
                    
                    <p v-if="address && !isValid" class="text-[10px] font-bold text-rose-600 dark:text-rose-500 ml-1 animate-fade-in transition-colors duration-300">
                        {{ reason === 'RECIPIENT_NOT_WALLET' ? $t('send.recipientNotWallet')
                            : reason === 'INVALID_SOLANA_ADDRESS' ? $t('send.errors.invalidSolanaAddress')
                            : $t('settings.addresses.addAddress.error_invalid') }}
                    </p>
                </div>
            </div>
        </div>

        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-white dark:bg-[#09090b] relative transition-colors duration-300">
            <button 
                @click="add"
                class="w-full py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                :class="canSave 
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-[1.01] shadow-indigo-500/20' 
                    : 'bg-slate-100 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500 cursor-not-allowed border border-slate-200 dark:border-white/5'"
                :disabled="!canSave"
            >
                {{ $t('settings.addresses.addAddress.btn_save') }}
            </button>
        </div>
    </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { pageStore } from '../../../store/pageStore'
import { networkStore } from '../../../store/network'
import { chainVm } from '../../../utils/vm'
import { validateRecipient } from '../../../utils/solana/sendGuards'
import { normalizeSolanaAddress } from '../../../utils/solana/address'
import Back from '../../Back.vue'

const page = pageStore()
const network = networkStore()

const label = ref('')
const address = ref('')

// Bu YENI bir kayit: hangi zincire ait oldugu KULLANICININ O ANKI aktif agidir
// (Send.vue'nun adres dogrulamasiyla AYNI kaynak). Duzenleme ekrani (EditAddress.vue)
// bunun TERSINI yapar -- KAYDIN KENDI chainId'sine bakar, cunku orada aktif ag
// kaydin ait oldugu agdan FARKLI olabilir.
const vm = computed(() => chainVm(network.currentNetwork))

// `watch` yerine BILEREK `computed`: adres degistikce ELLE bir ref guncellemek
// yerine dogrulama HER okundugunda TAZE hesaplanir -- araya bir zamanlayici
// turu (microtask) girmez, "adresi degistir, hemen ayni turda oku" senaryosu
// (SSR harness testleri DAHIL, bkz. AddAddress.ssr.test.js) sessizce eski
// deger okumaz.
const validation = computed(() => (address.value ? validateRecipient(address.value, vm.value) : { valid: false, reason: null }))
const isValid = computed(() => validation.value.valid)
// Gecersizlik SEBEBI: Send.vue ile AYNI ayrim (INVALID_* ile RECIPIENT_NOT_WALLET
// FARKLI seyler soyler -- ikincisinde adres bicimsel DOGRUDUR ama bir cuzdan
// degildir, oraya giden fonlar geri alinamaz).
const reason = computed(() => validation.value.reason)

// Validasyon: Etiket dolu olmalı ve adres geçerli olmalı
const canSave = computed(() => label.value.length > 0 && isValid.value)

const handlePaste = async () => {
    try {
        const text = await navigator.clipboard.readText()
        if (text) address.value = text
    } catch (err) {
        console.error('Paste error:', err)
    }
}

const add = async() => {
    if (!canSave.value) return

    // Base58 BUYUK/KUCUK HARF DUYARLIDIR: zehirli adres tespiti kullanicinin
    // GORDUGU karakterleri karsilastirir (bkz. addressPoisoning.js), kucultulen
    // bir adres baska bir adrese donusur. normalizeSolanaAddress SADECE bosluk
    // atar, harf kasasina DOKUNMAZ. EVM tarafi (address.value) DEGISTIRILMEDI.
    const finalAddress = vm.value === 'solana' ? normalizeSolanaAddress(address.value) : address.value

    const savedAddress = {
        address: finalAddress,
        label: label.value,
        // Onceden SABIT `1` yaziliyordu (yalniz EVM vardi, "hangi EVM zinciri"
        // hicbir yerde okunmuyordu). DUZELTME (Task 16b review, F7 ile AYNI
        // sinif): bu satir bir ara "bu alan HALA hicbir yerde okunmuyor"
        // diyordu -- ARTIK YANLIS ve tam tersine YUK TASIYOR:
        // EditAddress.vue:121 (`isSameChainId(props.savedAddress.chainId,
        // SOLANA_CHAIN_ID)`) duzenleme ekraninin HANGI dogrulayiciyi
        // kullanacagini BURAYA yazilan degerden turetir. Yanlis chainId yazmak
        // bir Solana kaydini EVM olarak dogrulatir.
        chainId: network.currentNetwork?.chainId ?? 1
    }

    let { saved_addresses } = await chrome.storage.local.get('saved_addresses')
    if(!saved_addresses) saved_addresses = []

    saved_addresses.push(savedAddress)

    await chrome.storage.local.set({ saved_addresses })
    page.currentPage = 'settings_saved_addresses'
}
</script>

<style scoped>
@keyframes fade-in {
    from { opacity: 0; transform: scale(0.9); }
    to { opacity: 1; transform: scale(1); }
}
.animate-fade-in {
    animation: fade-in 0.2s ease-out;
}
</style>