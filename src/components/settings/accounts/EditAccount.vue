<template>
    <div class="w-90 h-150 flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-zinc-800/20 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="settings_manage_accounts" class="absolute left-5 hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.account.editAccount.title') }}</h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-5 py-6 flex flex-col gap-8 relative z-10">
            
            <div class="flex flex-col items-center gap-3">
                <div class="relative group">
                    <div class="absolute inset-0 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-full blur-xl group-hover:blur-2xl transition-all duration-500"></div>
                    <img :src="`https://api.dicebear.com/7.x/identicon/svg?seed=${account?.address}`" class="rounded-full w-20 h-20 shadow-sm dark:shadow-none" />
                </div>
                <p class="text-sm font-bold text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('settings.account.editAccount.profile') }}</p>
            </div>

            <div class="flex flex-col gap-2">
                <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider px-2 transition-colors duration-300">{{ $t('settings.account.editAccount.general') }}</p>
                
                <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm dark:shadow-none transition-colors duration-300">
                    <button 
                        class="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer"
                        @click="page.currentPage = 'settings_edit_account_name'"
                    >
                        <div class="flex items-center gap-3">
                            <div class="p-2 rounded-lg bg-slate-100 dark:bg-zinc-800/50 text-slate-500 dark:text-zinc-400 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 group-hover:text-indigo-600 dark:group-hover:text-white transition-colors duration-300">
                                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            </div>
                            <span class="text-sm font-medium text-slate-700 dark:text-zinc-200 transition-colors duration-300">{{ $t('settings.account.editAccount.name') }}</span>
                        </div>
                        
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-bold text-slate-400 dark:text-zinc-500 mr-1 transition-colors duration-300">{{ account.name }}</span>
                            <svg class="w-4 h-4 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                        </div>
                    </button>
                </div>
            </div>

            <div class="flex flex-col gap-2">
                <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider px-2 transition-colors duration-300">{{ $t('settings.account.editAccount.security') }}</p>
                
                <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-white/5 shadow-sm dark:shadow-none transition-colors duration-300">
                    
                    <button 
                        class="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer"
                        @click="page.currentPage = 'settings_show_phrases'"
                    >
                        <div class="flex items-center gap-3 text-left">
                            <div class="p-2 rounded-lg bg-amber-50 dark:bg-zinc-800/50 text-amber-600 dark:text-amber-500/80 group-hover:bg-amber-100 dark:group-hover:bg-amber-500/20 group-hover:text-amber-700 dark:group-hover:text-amber-500 transition-colors duration-300">
                                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                            </div>
                            <div class="flex flex-col items-start">
                                <span class="text-sm font-medium text-slate-700 dark:text-zinc-200 transition-colors duration-300">{{ $t('settings.account.editAccount.recoveryPhrase') }}</span>
                                <span class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 transition-colors duration-300">{{ $t('settings.account.editAccount.saveWallet') }}</span>
                            </div>
                        </div>
                        <svg class="w-4 h-4 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                    </button>

                    <button
                        v-if="!tonOnly"
                        class="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer"
                        @click="page.currentPage = 'settings_show_private_key'"
                    >
                        <div class="flex items-center gap-3 text-left">
                            <div class="p-2 rounded-lg bg-rose-50 dark:bg-zinc-800/50 text-rose-600 dark:text-rose-500/80 group-hover:bg-rose-100 dark:group-hover:bg-rose-500/20 group-hover:text-rose-700 dark:group-hover:text-rose-500 transition-colors duration-300">
                                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                            </div>
                            <div class="flex flex-col items-start">
                                <span class="text-sm font-medium text-slate-700 dark:text-zinc-200 transition-colors duration-300">{{ $t('settings.account.editAccount.privateKey') }}</span>
                                <span class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 transition-colors duration-300">{{ $t('settings.account.editAccount.exportWallet') }}</span>
                            </div>
                        </div>
                        <svg class="w-4 h-4 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                    </button>

                    <!-- Her agda gorunur: TON adresi mevcut tohumdan farkli bir semayla
                         turetiliyor (bkz. tonExport.js basindaki not), bu yuzden kurtarma
                         yolu kullaniciyi once TON agina gecirmeye zorlamamali -- o ana
                         gecemiyor olabilir. -->
                    <button
                        class="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer"
                        @click="page.currentPage = 'settings_show_ton_key'"
                    >
                        <div class="flex items-center gap-3 text-left">
                            <div class="p-2 rounded-lg bg-sky-50 dark:bg-zinc-800/50 text-sky-600 dark:text-sky-500/80 group-hover:bg-sky-100 dark:group-hover:bg-sky-500/20 group-hover:text-sky-700 dark:group-hover:text-sky-500 transition-colors duration-300">
                                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                            </div>
                            <div class="flex flex-col items-start">
                                <span class="text-sm font-medium text-slate-700 dark:text-zinc-200 transition-colors duration-300">{{ $t('settings.showTonKey.entry') }}</span>
                                <span class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 transition-colors duration-300">{{ $t('settings.showTonKey.entry_desc') }}</span>
                            </div>
                        </div>
                        <svg class="w-4 h-4 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed } from 'vue'
import { pageStore } from '../../../store/pageStore'
import Back from '../../Back.vue'
import { isTonOnlyAccount } from '../../../utils/accountKind'

const props = defineProps(['account'])
const page = pageStore()

// TON hesabinda EVM ozel anahtari YOKTUR (spec §5, §10). Calismayacak bir dugme
// gostermek yerine giris gizlenir. Ifade girisi ve TON anahtari girisi KALIR -
// kullanicinin cuzdanina bu uygulama olmadan da ulasabilmesi gerekir.
const tonOnly = computed(() => isTonOnlyAccount(props.account))
</script>