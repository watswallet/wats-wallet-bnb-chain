<template>
    <div class="w-90 h-150 flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-zinc-800/20 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="home" class="absolute left-5 hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.title') }}</h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 flex flex-col gap-6 relative z-10">
            
            <button 
                @click="page.currentPage = 'settings_edit_profile'"
                class="flex items-center justify-between w-full p-4 bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl hover:border-indigo-400 dark:hover:border-indigo-500/30 hover:bg-slate-50 dark:hover:bg-[#18181b] transition-all group shadow-sm dark:shadow-none cursor-pointer"
            >
                <div class="flex items-center gap-3">
                    <div class="relative">
                        <img 
                            :src="profile?.icon || `https://api.dicebear.com/7.x/identicon/svg?seed=${user.address || 'user'}`" 
                            alt="Profile" 
                            class="w-12 h-12 rounded-full object-cover border border-slate-200 dark:border-white/10 transition-colors duration-300"
                        >
                        <div class="absolute -bottom-1 -right-1 bg-emerald-500 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-[#131315] transition-colors duration-300"></div>
                    </div>
                    
                    <div class="flex flex-col items-start">
                        <p class="font-bold text-base text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors duration-300">@{{ profile?.username || 'User' }}</p>
                        <p class="text-xs text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('settings.editProfile') }}</p>
                    </div>
                </div>
                <svg class="w-5 h-5 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-zinc-300 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
            </button>

            <div class="flex flex-col gap-2">
                <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider px-2 transition-colors duration-300">{{ $t('settings.general') }}</p>
                
                <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-white/5 shadow-sm dark:shadow-none transition-colors duration-300">
                    <button 
                        @click="page.currentPage = 'settings_manage_accounts'"
                        class="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer"
                    >
                        <div class="flex items-center gap-3 text-slate-700 dark:text-zinc-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors duration-300">
                            <div class="p-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800/50 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors duration-300">
                                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                            </div>
                            <span class="text-sm font-medium">{{ $t('settings.manageAccounts') }}</span>
                        </div>

                        <div class="flex items-center gap-2">
                            <span class="text-xs font-bold text-slate-500 dark:text-zinc-500 bg-slate-100 dark:bg-zinc-800/50 px-2 py-0.5 rounded transition-colors duration-300">{{ total_accounts || 0 }}</span>
                            <svg class="w-4 h-4 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                        </div>
                    </button>

                    <button 
                        @click="page.currentPage = 'settings_preferences'"
                        class="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer"
                    >
                        <div class="flex items-center gap-3 text-slate-700 dark:text-zinc-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors duration-300">
                            <div class="p-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800/50 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors duration-300">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M11 10.27 7 3.34"/><path d="m11 13.73-4 6.93"/><path d="M12 22v-2"/><path d="M12 2v2"/><path d="M14 12h8"/><path d="m17 20.66-1-1.73"/><path d="m17 3.34-1 1.73"/><path d="M2 12h2"/><path d="m20.66 17-1.73-1"/><path d="m20.66 7-1.73 1"/><path d="m3.34 17 1.73-1"/><path d="m3.34 7 1.73 1"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="8"/></svg>
                            </div>
                            <span class="text-sm font-medium">{{ $t('settings.preferences.title') }}</span>
                        </div>
                        <svg class="w-4 h-4 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                    </button>

                    <button 
                        @click="page.currentPage = 'settings_saved_addresses'"
                        class="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer"
                    >
                        <div class="flex items-center gap-3 text-slate-700 dark:text-zinc-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors duration-300">
                            <div class="p-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800/50 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-500/20 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors duration-300">
                                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                            </div>
                            <span class="text-sm font-medium">{{ $t('settings.addressBook') }}</span>
                        </div>
                        <svg class="w-4 h-4 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                    </button>
                </div>
            </div>

            <div class="flex flex-col gap-2">
                <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider px-2 transition-colors duration-300">{{ $t('settings.security.title') }}</p>
                
                <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-white/5 shadow-sm dark:shadow-none transition-colors duration-300">
                    <button 
                        @click="page.currentPage = 'settings_dapps'"
                        class="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer"
                    >
                        <div class="flex items-center gap-3 text-slate-700 dark:text-zinc-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors duration-300">
                            <div class="p-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800/50 group-hover:bg-blue-100 dark:group-hover:bg-blue-500/20 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-300">
                                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                            </div>
                            <span class="text-sm font-medium">{{ $t('settings.dapps.title') }}</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-bold text-slate-500 dark:text-zinc-500 bg-slate-100 dark:bg-zinc-800/50 px-2 py-0.5 rounded transition-colors duration-300">{{ connected_dapps || 0 }}</span>
                            <svg class="w-4 h-4 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                        </div>
                    </button>

                    <button 
                        @click="page.currentPage = 'settings_security'"
                        class="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer"
                    >
                        <div class="flex items-center gap-3 text-slate-700 dark:text-zinc-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors duration-300">
                            <div class="p-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800/50 group-hover:bg-amber-100 dark:group-hover:bg-amber-500/20 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors duration-300">
                                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                            </div>
                            <span class="text-sm font-medium">{{ $t('settings.privacy') }}</span>
                        </div>
                        <svg class="w-4 h-4 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                    </button>
                </div>
            </div>

            <div class="flex flex-col gap-2">
                <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider px-2 transition-colors duration-300">{{ $t('settings.about.title') }}</p>
                
                <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-white/5 shadow-sm dark:shadow-none transition-colors duration-300">
                    <button 
                        @click="page.currentPage = 'settings_about'"
                        class="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer"
                    >
                        <div class="flex items-center gap-3 text-slate-700 dark:text-zinc-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors duration-300">
                            <div class="p-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800/50 group-hover:bg-blue-100 dark:group-hover:bg-blue-500/20 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-300">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><line x1="12" x2="12" y1="16" y2="12"/><line x1="12" x2="12.01" y1="8" y2="8"/></svg>
                            </div>
                            <span class="text-sm font-medium">{{ $t('settings.about.title') }}</span>
                        </div>
                        <svg class="w-4 h-4 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                    </button>
                </div>
            </div>
        </div>

        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-white dark:bg-[#09090b] relative z-20 transition-colors duration-300">
            <button 
                class="w-full py-3.5 rounded-xl font-bold text-sm bg-rose-50 dark:bg-red-500/10 text-rose-600 dark:text-red-500 hover:bg-rose-100 dark:hover:bg-red-500/20 border border-rose-200 dark:border-red-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
                @click="lock"
            >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                {{ $t('settings.lockWallet') }}
            </button>
            <p class="text-center text-[10px] text-slate-400 dark:text-zinc-700 mt-3 font-medium transition-colors duration-300">Version {{ pkg.version }} • WATS Wallet</p>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { pageStore } from '../store/pageStore'
import { userStore } from '../store/user'
import Back from './Back.vue'
import pkg from '../../package.json'

const page = pageStore()
const user = userStore()

const profile = ref(null)
const connected_dapps = ref(0)
const total_accounts = ref(0)

onMounted(async() => {
    const { user, dapps = {}, vaults } = await chrome.storage.local.get(['user', 'dapps', 'vaults'])
    profile.value = user
    connected_dapps.value = Object.keys(dapps).length

    if (vaults) {
        for (const vault of vaults) {
            total_accounts.value += vault.accounts.length
        }
    }
})

const lock = async() => {
    await chrome.runtime.sendMessage({ type: 'LOCK' })
    window.close()
}
</script>