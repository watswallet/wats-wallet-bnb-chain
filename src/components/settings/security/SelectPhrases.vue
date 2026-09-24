<template>
    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="settings_security" class="absolute left-5 hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.security.selectPhrases.title') }}</h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pt-6 flex flex-col gap-6 relative pb-6 z-10">
            <div class="flex flex-col items-center gap-3 text-center">
                <div class="relative group">
                    <div class="absolute inset-0 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-full blur-xl group-hover:blur-2xl transition-all duration-500"></div>
                    <div class="relative w-16 h-16 bg-white dark:bg-linear-to-br dark:from-zinc-800 dark:to-[#09090b] border-2 border-slate-200 dark:border-white/10 rounded-full flex items-center justify-center shadow-lg dark:shadow-2xl transition-colors duration-300">
                        <svg class="w-8 h-8 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                    </div>
                </div>

                <p class="text-xs text-slate-500 dark:text-zinc-500 leading-relaxed px-2 transition-colors duration-300">{{ $t('settings.security.selectPhrases.desc') }}</p>
            </div>

            <div class="flex flex-col gap-4">
                <button 
                    v-for="(vault, index) in phrases" 
                    :key="index"
                    @click="selectMnemonic(vault)"
                    class="group flex flex-col gap-3 w-full bg-white dark:bg-[#131315] hover:bg-slate-50 dark:hover:bg-[#18181b] border border-slate-200 dark:border-white/5 hover:border-indigo-400 dark:hover:border-indigo-500/30 rounded-2xl p-4 transition-all duration-300 shadow-sm dark:shadow-none text-start relative overflow-hidden cursor-pointer"
                >
                    <div class="flex items-center justify-between w-full border-b border-slate-100 dark:border-white/5 pb-3 transition-colors duration-300">
                        <div class="flex items-center gap-2">
                            <div class="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(79,70,229,0.5)]"></div>
                            <h3 class="text-sm font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors duration-300">
                                {{ $t('settings.security.selectPhrases.vault_title') }} {{ index + 1 }}
                            </h3>
                        </div>

                        <svg class="w-5 h-5 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-white transition-all group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                        </svg>
                    </div>

                    <div class="flex flex-col gap-2">
                        <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider transition-colors duration-300">{{ $t('settings.security.selectPhrases.section_accounts') }}</p>
                        
                        <div class="flex flex-wrap gap-2">
                            <div 
                                v-for="account in accountsOf(vault)"
                                :key="account.address"
                                class="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full bg-slate-100 dark:bg-zinc-800/50 border border-slate-200 dark:border-white/5 transition-all duration-300 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-500/10"
                            >
                                <div class="w-5 h-5 rounded-full bg-linear-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-[9px] font-bold text-white shadow-sm">
                                    {{ account.name.charAt(0).toUpperCase() }}
                                </div>
                                <span class="text-xs text-slate-600 dark:text-zinc-300 font-bold transition-colors duration-300 group-hover:text-indigo-700 dark:group-hover:text-indigo-200">{{ account.name }}</span>
                            </div>
                        </div>
                    </div>
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { pageStore } from '../../../store/pageStore'
import { accountsForVaultDisplay } from '../../../utils/ton/linkedAccounts'
import Back from '../../Back.vue'

const emits = defineEmits(['vault'])
const page = pageStore()
const phrases = ref([])

onMounted(async() => {
    const { vaults } = await chrome.storage.local.get('vaults')
    if (vaults) {
        phrases.value = vaults
    }
})

// Eski hibrit profillerde HESAPSIZ TON kasalari var (INV-1 oncesi model) ve
// listeden gizlenemezler: kullanicinin Tonkeeper ifadesini yedekledigi yer orasi.
// Ham `vault.accounts` okunsaydi kart bos bir hesap seridiyle cikardi - kullanici
// onu "bozuk/bos kasa" sanip ANA ifadesini yedeklemeden gecerdi. Yeni model TON
// kasasi kendi hesabini TASIR ve ilk daldan doner.
const accountsOf = (vault) => accountsForVaultDisplay(phrases.value, vault)

const selectMnemonic = vault => {
    emits('vault', vault)
    page.currentPage = 'settings_security_unlock_vault'
}
</script>