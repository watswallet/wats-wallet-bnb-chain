<template>
    <div class="w-90 h-150 flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="settings" class="absolute left-5 hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.secure.title') }}</h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-5 py-6 flex flex-col gap-6 relative z-10">
            
            <div class="flex flex-col gap-2">
                <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider px-2 transition-colors duration-300">{{ $t('settings.secure.section_access') }}</p>
                
                <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-white/5 shadow-sm dark:shadow-none transition-colors duration-300">
                    <button 
                        class="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer"
                        @click="page.currentPage = 'settings_security_change_password'"
                    >
                        <div class="flex items-center gap-3 text-slate-700 dark:text-zinc-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors duration-300">
                            <div class="p-2 rounded-lg bg-slate-100 dark:bg-zinc-800/50 text-slate-500 dark:text-zinc-400 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 group-hover:text-indigo-600 dark:group-hover:text-white transition-colors duration-300">
                                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                            </div>
                            <span class="text-sm font-medium">{{ $t('settings.secure.btn_change_pass') }}</span>
                        </div>
                        <svg class="w-4 h-4 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-zinc-400 transition-all group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                    </button>

                    <button 
                        class="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer"
                        @click="page.currentPage = 'settings_security_lock_timer'"
                    >
                        <div class="flex items-center gap-3 text-slate-700 dark:text-zinc-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors duration-300">
                            <div class="p-2 rounded-lg bg-slate-100 dark:bg-zinc-800/50 text-slate-500 dark:text-zinc-400 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 group-hover:text-indigo-600 dark:group-hover:text-white transition-colors duration-300">
                                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </div>
                            <span class="text-sm font-medium">{{ $t('settings.secure.btn_auto_lock') }}</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-bold text-slate-500 dark:text-zinc-500 bg-slate-100 dark:bg-zinc-800/50 px-2 py-0.5 rounded transition-colors duration-300">{{ activeTimerLabel }}</span>
                            <svg class="w-4 h-4 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-zinc-400 transition-all group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                        </div>
                    </button>
                </div>
            </div>

            <div class="flex flex-col gap-2">
                <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider px-2 transition-colors duration-300">{{ $t('settings.secure.section_backup') }}</p>
                
                <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm dark:shadow-none transition-colors duration-300">
                    <button 
                        class="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer"
                        @click="page.currentPage = 'settings_security_select_phrases'"
                    >
                        <div class="flex items-center gap-3 text-slate-700 dark:text-zinc-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors duration-300">
                            <div class="p-2 rounded-lg bg-amber-50 dark:bg-zinc-800/50 text-amber-600 dark:text-amber-500/80 group-hover:bg-amber-100 dark:group-hover:bg-amber-500 group-hover:text-amber-700 dark:group-hover:text-amber-400 transition-colors duration-300">
                                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            </div>

                            <div class="flex flex-col items-start">
                                <span class="text-sm font-medium">{{ $t('settings.secure.btn_recovery') }}</span>
                                <span class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 transition-colors duration-300">{{ $t('settings.secure.btn_recovery_desc') }}</span>
                            </div>
                        </div>
                        <svg class="w-4 h-4 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-zinc-400 transition-all group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                    </button>
                </div>
            </div>
        </div>

        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-white/90 dark:bg-[#09090b] relative transition-colors duration-300">
            <button 
                class="w-full py-3.5 rounded-xl font-bold text-sm bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20 border border-rose-200 dark:border-rose-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm dark:shadow-none"
                @click="page.currentPage = 'settings_security_reset_app'"
            >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                {{ $t('settings.secure.btn_reset') }}
            </button>

            <p class="text-center text-[10px] font-bold text-slate-400 dark:text-zinc-600 mt-2 transition-colors duration-300">{{ $t('settings.secure.reset_warning') }}</p>
        </div>
    </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { pageStore } from '../../store/pageStore'
import Back from '../Back.vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const page = pageStore()

// Kayıtlı süre (Dakika olarak, -1: Asla, 0: Hemen)
const savedTimer = ref(5) 

// Dile göre dinamik etiket hesaplama
const activeTimerLabel = computed(() => {
    const time = savedTimer.value
    if (time === -1) return t('settings.secure.time_never')
    if (time === 0) return t('settings.secure.time_immediate')
    if (time >= 60) return t('settings.secure.time_hour', { n: time / 60 })
    return t('settings.secure.time_min', { n: time })
})
</script>