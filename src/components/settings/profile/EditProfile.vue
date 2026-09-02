<template>
    <div class="w-90 h-150 flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="settings" class="absolute left-5 hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.profile.editProfile.title') }}</h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pt-8 flex flex-col gap-8 relative z-10">
            
            <div class="flex flex-col items-center gap-4">
                <div class="relative group">
                    <div class="absolute inset-0 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-full blur-xl group-hover:blur-2xl transition-all duration-500"></div>
                    
                    <div class="relative w-28 h-28 rounded-full p-1 bg-white dark:bg-linear-to-br dark:from-zinc-800 dark:to-[#09090b] shadow-lg dark:shadow-2xl transition-colors duration-300">
                        <img 
                            :src="profile?.icon || `https://api.dicebear.com/7.x/identicon/svg?seed=${user.address || 'user'}`" 
                            :alt="$t('settings.profile.editProfile.img_alt')" 
                            class="w-full h-full rounded-full object-cover border-4 border-slate-50 dark:border-[#09090b] transition-colors duration-300"
                        >
                    </div>
                </div>

                <p class="text-sm font-medium text-slate-500 dark:text-zinc-500 text-center transition-colors duration-300">{{ $t('settings.profile.editProfile.desc') }}</p>
            </div>

            <div class="flex flex-col gap-2">
                <label class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider ml-1 transition-colors duration-300">{{ $t('settings.profile.editProfile.section_account') }}</label>
                
                <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm dark:shadow-none transition-colors duration-300">
                    <button 
                        class="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-all group cursor-pointer"
                        @click="page.currentPage = 'settings_edit_username'"
                    >
                        <div class="flex items-center gap-3 text-left">
                            <div class="p-2 rounded-lg bg-slate-100 dark:bg-zinc-800/50 text-slate-500 dark:text-zinc-400 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 group-hover:text-indigo-600 dark:group-hover:text-white transition-colors duration-300">
                                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                            </div>
                            <span class="text-sm font-medium text-slate-700 dark:text-zinc-200 transition-colors duration-300">{{ $t('settings.profile.editProfile.label_username') }}</span>
                        </div>
                        
                        <div class="flex items-center gap-2">
                            <span class="text-sm font-bold text-indigo-600 dark:text-indigo-400 group-hover:text-indigo-700 dark:group-hover:text-indigo-300 transition-colors duration-300">@{{ profile?.username }}</span>
                            <svg class="w-4 h-4 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-zinc-400 transition-all group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                            </svg>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { pageStore } from '../../../store/pageStore'
import { userStore } from '../../../store/user'
import Back from '../../Back.vue'

const page = pageStore()
const user = userStore()

const profile = ref(null)

onMounted(async() => {
    const { user } = await chrome.storage.local.get('user')
    profile.value = user
})
</script>