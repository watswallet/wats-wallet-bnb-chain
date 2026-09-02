<template>
    <div class="min-h-screen w-full flex flex-col items-center justify-center bg-[#050505] text-white font-sans selection:bg-amber-500/30 selection:text-white relative overflow-hidden py-6 px-4 md:px-6">
        
        <div class="absolute top-0 left-0 md:left-1/4 w-64 h-64 md:w-96 md:h-96 lg:w-150 lg:h-150 bg-indigo-900/20 rounded-full blur-[80px] md:blur-[120px] animate-pulse-slow pointer-events-none"></div>
        <div class="absolute bottom-0 right-0 md:right-1/4 w-48 h-48 md:w-80 md:h-80 lg:w-125 lg:h-125 bg-amber-600/10 rounded-full blur-[60px] md:blur-[100px] animate-pulse-slow delay-1000 pointer-events-none"></div>

        <div class="relative w-full max-w-2xl space-y-6 md:space-y-8">
            
            <div class="text-center space-y-3 md:space-y-4">
                <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] md:text-xs font-bold uppercase tracking-wider shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    {{ $t('onboarding.phrases.badge_secret') }}
                </div>

                <h1 class="text-2xl md:text-4xl font-bold tracking-tight text-white">{{ $t('onboarding.phrases.title') }}</h1>
                <p class="text-zinc-400 text-sm md:text-base font-medium max-w-lg mx-auto leading-relaxed px-2">
                    {{ $t('onboarding.phrases.desc_part1') }} <br class="hidden md:block"/> 
                    <span class="text-white font-semibold">{{ $t('onboarding.phrases.desc_part2') }}</span>
                </p>
            </div>

            <div class="relative group">
                <div 
                    v-if="!isRevealed"
                    @click="revealSeed"
                    class="absolute inset-0 z-20 flex flex-col items-center justify-center bg-zinc-900/60 backdrop-blur-xl border border-white/10 rounded-2xl md:rounded-3xl cursor-pointer transition-all duration-500 hover:bg-zinc-900/50 hover:backdrop-blur-lg group-hover:shadow-[0_0_30px_rgba(255,255,255,0.05)] p-4 text-center"
                >
                    <div class="w-12 h-12 md:w-16 md:h-16 bg-white/5 rounded-full flex items-center justify-center mb-3 md:mb-4 border border-white/10 group-hover:scale-110 transition-transform duration-300">
                        <svg class="w-6 h-6 md:w-8 md:h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    </div>
                    <p class="text-white font-bold text-base md:text-lg mb-1">{{ $t('onboarding.phrases.click_to_reveal') }}</p>
                    <p class="text-zinc-400 text-xs md:text-sm px-4">{{ $t('onboarding.phrases.reveal_warning') }}</p>
                </div>

                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-4 p-4 md:p-8 bg-white/5 border border-white/5 rounded-2xl md:rounded-3xl shadow-2xl transition-all duration-500"
                    :class="isRevealed ? 'opacity-100 blur-0' : 'opacity-50 blur-sm'">
                    
                    <div 
                        v-for="(word, index) in mnemonicWords" 
                        :key="index"
                        class="relative flex items-center justify-center py-3 md:py-4 bg-black/20 border border-white/5 rounded-xl hover:bg-white/5 hover:border-white/10 transition-colors group/word"
                    >
                        <span class="absolute top-1.5 left-2 md:top-2 md:left-3 text-[9px] md:text-[10px] font-mono text-zinc-600 group-hover/word:text-indigo-400 transition-colors select-none">{{ index + 1 }}</span>
                        <span class="font-mono text-base md:text-lg font-semibold text-white tracking-wide select-all">{{ word }}</span>
                    </div>
                </div>
            </div>

            <div class="flex flex-col gap-3 md:gap-4 max-w-md mx-auto pt-2">
                <button 
                    @click="copyToClipboard"
                    class="appearance-none bg-transparent flex items-center justify-center gap-2 text-zinc-400 hover:text-white transition-colors text-sm py-2 cursor-pointer active:scale-95 duration-200"
                >
                    <span v-if="!copied" class="flex items-center gap-2">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        {{ $t('onboarding.phrases.btn_copy') }}
                    </span>
                    <span v-else class="flex items-center gap-2 text-emerald-400 animate-fade-in">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                        {{ $t('onboarding.phrases.btn_copied') }}
                    </span>
                </button>

                <button 
                    @click="confirm"
                    class="relative w-full py-4 md:py-5 rounded-2xl font-bold text-base md:text-lg tracking-wide transition-all duration-500 overflow-hidden group"
                    :class="isRevealed 
                        ? 'cursor-pointer hover:-translate-y-1 shadow-[0_0_40px_rgba(245,158,11,0.2)] hover:shadow-[0_0_60px_rgba(245,158,11,0.4)]' 
                        : 'cursor-not-allowed opacity-50 grayscale'"
                    :disabled="!isRevealed"
                >
                    <div class="absolute inset-0 transition-all duration-500"
                        :class="isRevealed ? 'bg-linear-to-r from-amber-600 via-orange-600 to-amber-600 bg-size-[200%_auto] animate-gradient' : 'bg-white/10 backdrop-blur-md'">
                    </div>
                    
                    <span class="relative text-white flex items-center justify-center gap-2">
                        {{ $t('onboarding.phrases.btn_saved') }}
                        <svg class="w-5 h-5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                    </span>
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'

const props = defineProps(['mnemonic'])
const emit = defineEmits(['phrases_saved'])

const isRevealed = ref(false)
const copied = ref(false)
const mnemonicWords = ref([])

const revealSeed = () => {
    isRevealed.value = true
}

onMounted(() => {
    mnemonicWords.value = props.mnemonic.mnemonic.split(" ")
})

const copyToClipboard = async () => {
    try {
        await navigator.clipboard.writeText(mnemonicWords.value.join(" "))
        copied.value = true
        setTimeout(() => copied.value = false, 2000)
    } catch (err) {
        console.error("copyToClipboard error", err)
    }
}

const confirm = () => {
    emit('phrases_saved', 'create_username')
}
</script>

<style scoped>
@keyframes gradient {
    0% { background-position: 0% 50% }
    50% { background-position: 100% 50% }
    100% { background-position: 0% 50% }
}
.animate-gradient {
    animation: gradient 3s ease infinite;
}

@keyframes fade-in {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in {
    animation: fade-in 0.3s ease-out;
}
</style>