<template>
    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">      
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="settings_security" class="absolute left-5 hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.security.lockTimer.title') }}</h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pt-6 flex flex-col gap-6 relative pb-6 z-10">
            <div class="flex flex-col items-center gap-4">
                <div class="relative group">
                    <div class="absolute inset-0 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-full blur-xl group-hover:blur-2xl transition-all duration-500"></div>
                    <div class="relative w-16 h-16 bg-white dark:bg-linear-to-br dark:from-zinc-800 dark:to-[#09090b] border-2 border-slate-200 dark:border-white/10 rounded-full flex items-center justify-center shadow-lg dark:shadow-2xl transition-colors duration-300">
                        <svg class="w-8 h-8 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                </div>

                <p class="text-xs text-slate-500 dark:text-zinc-500 text-center px-4 leading-relaxed transition-colors duration-300">{{ $t('settings.security.lockTimer.desc') }}</p>
            </div>

            <div class="flex flex-col gap-3">
                <button 
                    v-for="(lock, index) in locks" 
                    :key="index"
                    @click="setTimer(lock.time)"
                    class="group w-full flex items-center justify-between p-4 rounded-xl border transition-all duration-300 cursor-pointer"
                    :class="lockTimer === lock.time 
                        ? 'bg-white dark:bg-[#131315] border-indigo-400 dark:border-indigo-500/50 shadow-md dark:shadow-[0_0_15px_rgba(99,102,241,0.1)]' 
                        : 'bg-white dark:bg-[#131315] border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10 hover:bg-slate-50 dark:hover:bg-[#18181b] shadow-sm dark:shadow-none'"
                >
                    <span class="text-sm font-bold transition-colors duration-300" :class="lockTimer === lock.time ? 'text-indigo-600 dark:text-white' : 'text-slate-600 dark:text-zinc-400 group-hover:text-slate-900 dark:group-hover:text-zinc-200'">
                        {{ lock.content }}
                    </span>

                    <div 
                        class="w-5 h-5 rounded-full border flex items-center justify-center transition-all duration-300"
                        :class="lockTimer === lock.time 
                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/20' 
                            : 'border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800/50 group-hover:border-slate-400 dark:group-hover:border-zinc-500'"
                    >
                        <div 
                            class="w-2.5 h-2.5 rounded-full bg-indigo-600 dark:bg-indigo-500 shadow-[0_0_8px_rgba(79,70,229,0.4)] dark:shadow-[0_0_8px_rgba(99,102,241,0.8)] transition-transform duration-200"
                            :class="lockTimer === lock.time ? 'scale-100' : 'scale-0'"
                        ></div>
                    </div>
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import Back from '../../Back.vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_LOCK_TIMER_MINUTES } from '../../../utils/lockTimer'

const { t } = useI18n()

const lockTimer = ref(null)

const locks = computed(() => [
    { time: 0, content: t('settings.security.lockTimer.time_immediate') },
    { time: 1, content: t('settings.security.lockTimer.time_1_min') },
    { time: 5, content: t('settings.security.lockTimer.time_5_min') },
    { time: 10, content: t('settings.security.lockTimer.time_10_min') },
    { time: 30, content: t('settings.security.lockTimer.time_30_min') },
    { time: 60, content: t('settings.security.lockTimer.time_1_hour') },
    { time: -1, content: t('settings.security.lockTimer.time_never') }
])

const setTimer = async(time) => {
    lockTimer.value = time
    await chrome.storage.local.set({ lock_timer: time })
}

onMounted(async() => {
    // Değerler DAKİKA cinsinden (0, 1, 5, 10, 30, 60, -1). Varsayılan 900000 idi;
    // hiçbir seçenekle eşleşmediği için ilk açılışta hiçbir radyo işaretli gelmiyordu.
    const { lock_timer = DEFAULT_LOCK_TIMER_MINUTES } = await chrome.storage.local.get('lock_timer')
    lockTimer.value = lock_timer
})
</script>