<template>
    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="settings_create_account" class="absolute left-5 hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.selectPhrase.title') }}</h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pt-6 flex flex-col gap-6 relative z-10 pb-6">
            <div class="flex flex-col items-center gap-3 text-center">
                <div class="relative group">
                    <div class="absolute inset-0 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-full blur-xl group-hover:blur-2xl transition-all duration-500"></div>
                    <div class="relative w-16 h-16 bg-white dark:bg-linear-to-br dark:from-zinc-800 dark:to-[#09090b] border-2 border-slate-200 dark:border-white/10 rounded-full flex items-center justify-center shadow-lg dark:shadow-2xl transition-colors duration-300">
                        <svg class="w-7 h-7 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                    </div>
                </div>

                <p class="text-xs text-slate-500 dark:text-zinc-500 leading-relaxed px-4 transition-colors duration-300">{{ $t('settings.selectPhrase.desc') }}</p>
            </div>

            <div class="flex flex-col gap-4">
                <button 
                    v-for="(vault, index) in phrases" 
                    :key="index"
                    @click="selectMnemonic(vault)"
                    class="group relative flex flex-col w-full rounded-2xl transition-all duration-300 text-start overflow-hidden shadow-sm dark:shadow-none outline-none border cursor-pointer"
                    :class="isSelected(vault) 
                        ? 'bg-white dark:bg-linear-to-br dark:from-indigo-900/20 dark:to-[#131315] border-indigo-400 dark:border-indigo-500/50 shadow-md dark:shadow-[0_0_20px_rgba(99,102,241,0.15)]' 
                        : 'bg-white dark:bg-linear-to-br dark:from-[#131315] dark:to-[#0c0c0d] border-slate-200 dark:border-white/5 hover:border-indigo-300 dark:hover:border-indigo-500/30 hover:bg-slate-50 dark:hover:from-[#18181b] dark:hover:to-[#101012]'"
                >
                    <div class="flex items-start justify-between w-full p-4 border-b transition-colors duration-300"
                        :class="isSelected(vault) ? 'border-indigo-100 dark:border-white/5 bg-indigo-50/30 dark:bg-white/2' : 'border-slate-50 dark:border-white/5 bg-transparent'">
                        <div class="flex items-center gap-4">
                            <div class="relative shrink-0">
                                <div v-if="isSelected(vault)" class="absolute inset-0 bg-indigo-500/20 dark:bg-indigo-500/40 blur-sm rounded-xl"></div>
                                <div class="w-12 h-12 rounded-xl flex items-center justify-center border transition-all duration-300 relative overflow-hidden"
                                    :class="isSelected(vault) ? 'bg-indigo-600 dark:bg-indigo-500/10 border-indigo-500/20 text-white dark:text-indigo-400' : 'bg-slate-50 dark:bg-white/5 border-slate-100 dark:border-white/5 text-slate-400 dark:text-zinc-500 group-hover:text-indigo-600 dark:group-hover:text-zinc-300 group-hover:border-indigo-100 dark:group-hover:border-white/10'">
                                    
                                    <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                                </div>
                            </div>
                            
                            <div class="flex flex-col gap-0.5">
                                <h3 class="text-sm font-bold transition-colors duration-300 tracking-wide" 
                                    :class="isSelected(vault) ? 'text-indigo-700 dark:text-indigo-200' : 'text-slate-800 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-200'">
                                    {{ $t('settings.selectPhrase.vault_title', { index: index + 1 }) }}
                                </h3>
                                <span class="text-[11px] font-bold leading-tight transition-colors duration-300" 
                                    :class="isSelected(vault) ? 'text-indigo-500 dark:text-indigo-300/70' : 'text-slate-400 dark:text-zinc-500'">
                                    {{ $t('settings.selectPhrase.accounts_count', { count: accountsOf(vault).length }) }}
                                </span>
                            </div>
                        </div>
                        
                        <div class="shrink-0">
                            <div v-if="isSelected(vault)" class="bg-indigo-600 dark:bg-indigo-500 rounded-full p-1.5 shadow-lg shadow-indigo-200 dark:shadow-indigo-500/50 transition-all">
                                <svg class="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg>
                            </div>
                            <svg v-else class="w-5 h-5 text-slate-300 dark:text-zinc-700 group-hover:text-indigo-400 dark:group-hover:text-zinc-400 transition-all group-hover:translate-x-1 mt-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                        </div>
                    </div>

                    <div class="p-4 flex flex-col gap-2.5">
                        <p class="text-[10px] font-bold uppercase tracking-wider pl-1 transition-colors duration-300"
                            :class="isSelected(vault) ? 'text-indigo-400 dark:text-indigo-500/70' : 'text-slate-400 dark:text-zinc-600'">
                            {{ $t('settings.selectPhrase.accounts_in_group') }}
                        </p>
                        
                        <div class="flex flex-wrap gap-2">
                            <div 
                                v-for="account in accountsOf(vault).slice(0, 4)"
                                :key="account.address" 
                                class="flex items-center gap-1.5 pl-1 pr-3 py-1 rounded-full border transition-all duration-300"
                                :class="isSelected(vault) 
                                    ? 'bg-indigo-100 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/20' 
                                    : 'bg-slate-50 dark:bg-white/5 border-slate-100 dark:border-white/5 group-hover:border-indigo-100 dark:group-hover:border-white/10'"
                            >
                                <div class="w-4 h-4 rounded-full bg-linear-to-br shadow-sm flex items-center justify-center text-[8px] font-bold transition-all"
                                    :class="isSelected(vault) ? 'from-indigo-500 to-indigo-700 text-white' : 'from-slate-200 to-slate-400 dark:from-zinc-700 dark:to-zinc-900 text-white dark:text-zinc-300'">
                                    {{ account.name.charAt(0).toUpperCase() }}
                                </div>
                                <span class="text-[10px] font-bold transition-colors duration-300" 
                                    :class="isSelected(vault) ? 'text-indigo-700 dark:text-indigo-200' : 'text-slate-600 dark:text-zinc-400 group-hover:text-indigo-600'">
                                    {{ account.name }}
                                </span>
                            </div>
                            <span v-if="accountsOf(vault).length > 4" class="text-[10px] font-bold self-center ml-1 transition-colors duration-300"
                                :class="isSelected(vault) ? 'text-indigo-400' : 'text-slate-400 dark:text-zinc-600'">
                                {{ $t('settings.selectPhrase.more_accounts', { count: accountsOf(vault).length - 4 }) }}
                            </span>
                        </div>
                    </div>
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { pageStore } from '../../store/pageStore'
import { userStore } from '../../store/user'
import { accountsForVaultDisplay } from '../../utils/ton/linkedAccounts'
import Back from '../Back.vue'

const page = pageStore()
const user = userStore()

const phrases = ref([])

onMounted(async() => {
    const { vaults } = await chrome.storage.local.get('vaults')
    if (vaults) phrases.value = vaults
})

// Eski hibrit profillerdeki HESAPSIZ TON kasasi listede "0 Hesap Iceriyor"
// gorunmemeli: kullanicinin Tonkeeper ifadesini yedekledigi yer o kasa. Yeni model
// (INV-1) TON kasasi kendi hesabini tasir ve bu dala hic girmez.
const accountsOf = (vault) => accountsForVaultDisplay(phrases.value, vault)

// Hangi vault'un şu an user store'da seçili olduğunu kontrol et
const isSelected = async(vault) => {
    const { active_account } = await chrome.storage.local.get('active_account')
    return active_account.fingerprint === vault.fingerprint
}

// DONDURULDU (2026-09-05 tasarim belgesi §5).
//
// Burada aktif hesabin fingerprint alanina secilen kasanin fingerprint'ini ATAYAN
// bir satir + olmayan bir `chrome.storage.set` cagrisi vardi. Iki ayri sebeple gitti:
//
// 1) `chrome.storage.set` DIYE BIR API YOK (dogrusu `chrome.storage.local.set`),
//    yani yazim hicbir zaman diske inmiyordu -- "calisiyor" gorunen olu kod.
// 2) INV-1 altinda `fingerprint`, hesabin HANGI KASAYA ait oldugunu soyleyen bagdir
//    (her hesap tam olarak bir kasanin accounts[] dizisinde bulunur). "Duzeltilmis"
//    -- yani gercekten diske yazan -- bir surum, bir TON hesabini EVM kasasina
//    baglar ve findVaultForAccount o hesap icin YANLIS sirri acardi. Yani buradaki
//    hata bir eksiklik degil, kapatilmis bir kapi.
//
// Secim `user.vault` uzerinden tasinir; hesap kaydina DOKUNULMAZ.
const selectMnemonic = (vault) => {
    user.vault = vault
    page.currentPage = 'settings_create_account'
}
</script>

<style scoped>
/* Basit bir geçiş animasyonu */
.scale-fade-enter-active,
.scale-fade-leave-active {
    transition: all 0.2s ease;
}
.scale-fade-enter-from,
.scale-fade-leave-to {
    opacity: 0;
    transform: scale(0.8);
}
</style>