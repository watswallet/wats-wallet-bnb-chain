<template>
    <!--
        Guvenlik guncellemesi bilgilendirmesi.
        Bilincli olarak kapatilamaz bir modal: kullanicinin okumasi gereken tek seferlik
        bir bilgi. Arka plana tiklamak veya X ile cikis YOK; tek cikislar "Sifreyi degistir"
        ve 3 saniye sonra beliren "Simdi degil".
    -->
    <div class="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 dark:bg-black/70 backdrop-blur-sm px-4">
        <div class="w-full max-w-[320px] bg-white dark:bg-[#09090b] border border-slate-200 dark:border-white/10 rounded-3xl shadow-xl dark:shadow-2xl relative overflow-hidden transition-colors duration-300">
            <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-500/10 to-transparent pointer-events-none"></div>

            <div class="relative z-10 px-6 pt-7 pb-6 flex flex-col">

                <span class="w-11 h-11 rounded-2xl bg-indigo-500/10 dark:bg-indigo-500/15 flex items-center justify-center">
                    <svg class="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M9 12.75 11.25 15 15 9.75M21 12c0 4.97-3.66 9.11-8.44 9.93a1.5 1.5 0 0 1-.51 0C7.26 21.11 3.6 16.97 3.6 12V6.24c0-.6.36-1.14.91-1.38l7.5-3.2a1.5 1.5 0 0 1 1.18 0l7.5 3.2c.55.24.91.78.91 1.38V12Z" />
                    </svg>
                </span>

                <h4 class="mt-4 text-lg font-bold tracking-tight text-slate-900 dark:text-white leading-snug">
                    {{ $t('settings.passwordRotation.title') }}
                </h4>

                <p class="mt-2 text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
                    {{ $t('settings.passwordRotation.lead') }}
                </p>

                <!-- Degisimin kendisi: anahtar nerede tutuluyordu, simdi nerede. -->
                <div class="mt-4 flex items-stretch gap-2">
                    <div class="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5">
                        <span class="block text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-600">{{ $t('settings.passwordRotation.before_label') }}</span>
                        <span class="block mt-1 text-[11px] font-semibold text-slate-500 dark:text-zinc-500 line-through decoration-slate-300 dark:decoration-zinc-700">{{ $t('settings.passwordRotation.before_value') }}</span>
                    </div>

                    <div class="flex items-center shrink-0 text-slate-300 dark:text-zinc-700">
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="m9 5 7 7-7 7" />
                        </svg>
                    </div>

                    <div class="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20">
                        <span class="block text-[9px] font-bold uppercase tracking-wider text-indigo-400 dark:text-indigo-400/70">{{ $t('settings.passwordRotation.after_label') }}</span>
                        <span class="block mt-1 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">{{ $t('settings.passwordRotation.after_value') }}</span>
                    </div>
                </div>

                <p class="mt-4 text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
                    {{ $t('settings.passwordRotation.what_to_do') }}
                </p>

                <p class="mt-3 text-[10px] text-slate-400 dark:text-zinc-600 leading-relaxed">
                    {{ $t('settings.passwordRotation.reassure') }}
                </p>

                <button
                    @click="emit('change-password')"
                    class="mt-5 w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold tracking-wide transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#09090b]"
                >
                    {{ $t('settings.passwordRotation.action') }}
                </button>

                <!-- Yer bastan ayrilir: buton belirince yerlesim ziplamaz. -->
                <div class="h-9 mt-1 flex items-center justify-center">
                    <Transition
                        enter-active-class="transition-opacity duration-500 ease-out"
                        enter-from-class="opacity-0"
                        enter-to-class="opacity-100"
                    >
                        <button
                            v-if="canDismiss"
                            @click="emit('dismiss')"
                            class="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-900/5 dark:hover:bg-white/5 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
                        >
                            {{ $t('settings.passwordRotation.dismiss') }}
                        </button>
                    </Transition>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const emit = defineEmits(['dismiss', 'change-password'])

// "Simdi degil" 3 saniye sonra belirir: bilgilendirmenin okunmadan kapatilmamasi icin.
const DISMISS_DELAY = 3000

const canDismiss = ref(false)
let dismissTimer = null

onMounted(() => {
    dismissTimer = setTimeout(() => { canDismiss.value = true }, DISMISS_DELAY)
})

onUnmounted(() => {
    if (dismissTimer) clearTimeout(dismissTimer)
})
</script>
