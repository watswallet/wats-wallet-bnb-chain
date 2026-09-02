<template>
    <div class="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm px-4" @click="closeModal">
        
        <div 
            class="w-full max-w-[320px] bg-white dark:bg-[#09090b] border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl dark:shadow-2xl relative transition-colors duration-300" 
            @click.stop
        >
            <div class="absolute top-0 left-0 right-0 h-24 bg-linear-to-b from-indigo-500/5 dark:from-indigo-500/10 to-transparent pointer-events-none transition-colors duration-300"></div>

            <div class="flex items-center justify-between px-5 pt-5 pb-4 relative z-10">
                <h4 class="font-bold text-slate-900 dark:text-white text-lg tracking-tight transition-colors duration-300">{{ $t('swap.settings.title') }}</h4>
                <button 
                    class="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-white transition-colors duration-300 cursor-pointer shadow-sm dark:shadow-none" 
                    @click="closeModal"
                >
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>

            <div class="px-5 pb-6 flex flex-col gap-6 relative z-10">
                <div class="flex flex-col gap-3">
                    <div class="flex items-center gap-1.5">
                        <span class="text-sm font-medium text-slate-600 dark:text-zinc-300 transition-colors duration-300">{{ $t('swap.settings.slippage') }}</span>
                        
                        <div class="relative group cursor-help">
                            <svg class="w-4 h-4 text-slate-400 dark:text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            
                            <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-3 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-white/10 rounded-xl text-xs text-slate-600 dark:text-zinc-300 shadow-xl opacity-0 group-hover:opacity-100 invisible group-hover:visible transition-all duration-200 pointer-events-none z-50 text-center leading-relaxed">
                                {{ $t('swap.settings.info') }}
                                <div class="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-white dark:border-t-zinc-800"></div>
                            </div>
                        </div>
                    </div>

                    <div class="grid grid-cols-3 gap-2">
                        <button 
                            v-for="val in [0.5, 1.0, 'Özel']" 
                            :key="val"
                            @click="setTolerance(val)"
                            class="py-2.5 rounded-xl text-sm font-bold border transition-all duration-300 cursor-pointer"
                            :class="selectedTolerance === val 
                                ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-400 dark:border-indigo-500/50 text-indigo-600 dark:text-indigo-400 shadow-sm dark:shadow-[0_0_15px_rgba(99,102,241,0.15)]' 
                                : 'bg-slate-50 dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 hover:border-slate-300 dark:hover:border-zinc-700'"
                        >
                            {{ val === 'Özel' ? $t('swap.settings.custom') : val + '%' }}
                        </button>
                    </div>

                    <div v-if="selectedTolerance === 'Özel'" class="relative mt-1 animate-fade-in-up">
                        <input 
                            type="number" 
                            v-model="customTolerance"
                            placeholder="0.0"
                            step="0.1"
                            min="0.1"
                            max="50"
                            class="w-full bg-slate-50 dark:bg-zinc-900/50 border border-slate-200 dark:border-indigo-500/30 rounded-xl py-3 pl-4 pr-10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/10 transition-all font-mono shadow-sm dark:shadow-none"
                        >
                        <div class="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500 text-sm font-bold">%</div>
                        
                        <p v-if="Number(customTolerance) > 5" class="text-[10px] text-amber-600 dark:text-amber-500 mt-2 flex items-center gap-1 transition-colors duration-300">
                            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                            {{ $t('swap.settings.disclaimer') }}
                        </p>
                    </div>
                </div>

                <button 
                    class="w-full py-3.5 rounded-xl font-bold text-sm transition-all duration-300 shadow-md mt-2 flex items-center justify-center gap-2 cursor-pointer"
                    :class="isValid 
                        ? 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 shadow-indigo-200 dark:shadow-white/10' 
                        : 'bg-slate-100 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500 cursor-not-allowed border border-slate-200 dark:border-white/5'"
                    :disabled="!isValid"
                    @click="applySettings"
                >
                    {{ $t('swap.settings.save') }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref, computed } from 'vue'
import { popupStore } from '../../store/popup'

const popups = popupStore()

const selectedTolerance = ref(0.5)
const customTolerance = ref('')

// Validasyon: Custom seçiliyse değer boş olmamalı ve mantıklı bir aralıkta olmalı
const isValid = computed(() => {
    if (selectedTolerance.value === 'Özel') {
        const val = Number(customTolerance.value)
        return val > 0 && val <= 50
    }
    return true
})

const setTolerance = (val) => {
    selectedTolerance.value = val
    if (val !== 'Özel') customTolerance.value = ''
}

const closeModal = () => {
    popups.swap_settings = false
}

onMounted(async() => {
    try {
        const { swap_slippage } = await chrome.storage.local.get('swap_slippage')
        
        if(swap_slippage) {
            // Eğer kayıtlı değer standartlardan biriyse butonu seç, değilse 'Özel'e at
            if (swap_slippage === 0.5 || swap_slippage === 1.0) {
                selectedTolerance.value = swap_slippage
            } else {
                selectedTolerance.value = 'Özel'
                customTolerance.value = swap_slippage
            }
        }
    } catch (e) {
        console.error(e)
    }
})

const applySettings = async() => {
    if (!isValid.value) return

    const tolerance = selectedTolerance.value === 'Özel' ? Number(customTolerance.value) : selectedTolerance.value
    await chrome.storage.local.set({ swap_slippage: tolerance })

    closeModal()
}
</script>

<style scoped>
@keyframes fade-in-up {
    from { opacity: 0; transform: translateY(-5px); }
    to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in-up {
    animation: fade-in-up 0.2s ease-out;
}
</style>