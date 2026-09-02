<template>
    <div class="w-90 h-150 flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30">
        <div class="absolute top-0 left-0 right-0 h-64 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 z-10">
            <Back page="home" class="absolute left-5 hover:bg-slate-200 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                {{ crypto.onramp_token.symbol ? crypto.onramp_token.symbol.toUpperCase() : '...' }} {{ $t('buyToken.buy') }}
            </h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pt-8 flex flex-col gap-8 relative z-10">
            
            <div class="w-full flex justify-center py-4">
                <div class="relative group">
                    <div class="absolute inset-0 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-full blur-xl group-hover:blur-2xl transition-all duration-500"></div>
                    <div class="relative w-24 h-24 rounded-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 p-2 shadow-2xl">
                        <img v-if="crypto.onramp_token.image" 
                            :src="crypto.onramp_token.image.large || crypto.onramp_token.image.thumb" 
                            :alt="crypto.onramp_token.name" 
                            class="w-full h-full rounded-full object-cover">
                    </div>
                </div>
            </div>

            <div class="flex flex-col gap-5">
                <div class="flex flex-col gap-2">
                    <label class="text-xs font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider ml-1">{{ $t('buyToken.recipientAddress') }}</label>
                    <div class="w-full px-4 py-3.5 rounded-xl bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 flex items-center justify-between group">
                        <span class="text-sm font-mono text-slate-700 dark:text-zinc-300 truncate">{{ shortenAddress(activeAccount?.address) }}</span>
                        <div class="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                    </div>
                </div>

                <div class="flex flex-col gap-2">
                    <label class="text-xs font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider ml-1">{{ $t('buyToken.amount') }}</label>
                    <div class="relative w-full group">
                        <div class="absolute -inset-0.5 bg-linear-to-r from-indigo-500 to-purple-500 rounded-xl opacity-0 group-focus-within:opacity-20 transition duration-500 blur"></div>
                        <div class="relative w-full px-4 py-4 rounded-xl bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 flex items-center justify-between transition-colors group-focus-within:border-indigo-500/50">
                            <input 
                                v-model="amount" 
                                type="number" 
                                inputmode="numeric" 
                                placeholder="0.00" 
                                min="0"
                                class="w-full bg-transparent text-2xl font-bold text-slate-900 dark:text-white placeholder-slate-300 dark:placeholder-zinc-700 outline-none"
                            >
                            <span class="text-sm font-bold text-slate-500 dark:text-zinc-500 bg-slate-100 dark:bg-white/5 px-2 py-1 rounded border border-slate-200 dark:border-white/5">USD</span>
                        </div>
                    </div>
                </div>

                <div class="flex flex-col gap-2">
                    <label class="text-xs font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider ml-1">{{ $t('buyToken.paymentMethod') }}</label>
                    <button class="w-full px-4 py-3.5 rounded-xl bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 hover:border-indigo-500/30 hover:bg-slate-100 dark:hover:bg-[#18181b] flex items-center justify-between transition-all duration-200 group">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-lg bg-slate-100 dark:bg-zinc-800/50 flex items-center justify-center text-slate-600 dark:text-zinc-300 group-hover:text-indigo-400 group-hover:bg-indigo-500/10 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 14 14"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect width="13" height="9.5" x=".5" y="2.25" rx="1"/><path d="M.5 5.75h13m-4 3.5H11"/></g></svg>
                            </div>
                            <div class="flex flex-col items-start">
                                <span class="text-sm font-bold text-slate-800 dark:text-zinc-200">{{ $t('buyToken.creditCard') }}</span>
                                <span class="text-[10px] text-slate-500 dark:text-zinc-500">{{ $t('buyToken.viaMoonpay') }}</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <img src="https://avatars.githubusercontent.com/u/43662283?s=200&v=4" alt="Moonpay" class="w-5 h-5 rounded-full grayscale opacity-70 group-hover:grayscale-0 group-hover:opacity-100 transition-all">
                            <svg class="w-4 h-4 text-slate-400 dark:text-zinc-600 group-hover:text-slate-600 dark:group-hover:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                        </div>
                    </button>
                </div>
            </div>
        </div>

        <p v-if="buyError" class="px-5 pt-2 text-xs text-red-600 dark:text-red-400 relative z-20">{{ $t('buyToken.buyFailed') }}</p>
        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-[#09090b] relative z-20 flex gap-3">
            <button class="w-1/3 py-3.5 rounded-xl font-bold text-sm bg-slate-200 dark:bg-zinc-800/50 text-slate-600 dark:text-zinc-400 hover:bg-slate-300 dark:hover:bg-zinc-800 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-white/5 transition-all">
                {{ $t('buyToken.cancel') }}
            </button>
            
            <button 
                @click="buyToken" 
                :disabled="Number(amount) <= 0 || loading"
                class="w-2/3 py-3.5 rounded-xl font-bold text-sm text-white shadow-lg flex items-center justify-center gap-2 transition-all relative overflow-hidden group"
                :class="Number(amount) > 0 && !loading 
                    ? 'bg-indigo-600 hover:bg-indigo-500 hover:scale-[1.02] shadow-indigo-500/20' 
                    : 'bg-slate-200 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500 cursor-not-allowed border border-slate-300 dark:border-white/5'"
            >
                <div v-if="Number(amount) > 0 && !loading" class="absolute inset-0 bg-linear-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shine"></div>
                
                <span v-if="loading" class="flex items-center gap-2">
                    <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    {{ $t('buyToken.processing') }}
                </span>
                <span v-else class="flex items-center gap-2">
                    {{ $t('buyToken.buy') }}
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                </span>
            </button>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue' // onMounted sildim çünkü butona basınca çalışacak
import { useI18n } from 'vue-i18n'
import Back from './Back.vue'
import { cryptoStore } from '../store/crypto'
import axios from 'axios'
import { shortenAddress } from '../utils/shortenAddress'
import { configStore } from '../store/config'
import { loadMoonPay } from '@moonpay/moonpay-js'

const { t } = useI18n()
const crypto = cryptoStore()
const config = configStore()

const amount = ref(null) // Başlangıçta 0 yerine null daha temiz durabilir
const loading = ref(false)
const buyError = ref(false)
const activeAccount = ref(null)

onMounted(async() => {
    const { active_account } = await chrome.storage.local.get('active_account')
    activeAccount.value = active_account
})

const buyToken = async () => {
    // activeAccount bir ref: `.address` dogrudan okunursa undefined gelir ve MoonPay
    // URL'ine "walletAddress=undefined" imzalanir. Adres yoksa hic istek atma.
    const walletAddress = activeAccount.value?.address
    if (!walletAddress) {
        alert(t('buyToken.noAccount'))
        return
    }

    loading.value = true;
    buyError.value = false;
    try {
        // 1. Backend'den İmzalı URL'i al
        const { data } = await axios.post(config.api + '/moonpay/getSignUrl', {
            currencyCode: crypto.onramp_token.symbol.toLowerCase(), // örn: 'eth'
            walletAddress,
            baseCurrencyAmount: amount.value, // Kullanıcının girdiği tutar
            baseCurrencyCode: 'usd',
            defaultCurrencyCode: crypto.onramp_token.symbol.toLowerCase(),
            paymentMethod: 'credit_debit_card'
        });

        const signedUrl = data.url;

        // 2. SDK YERİNE: URL'i yeni sekmede aç
        // Chrome eklentilerinde window.open güvenlidir.
        window.open(signedUrl, '_blank');

    } catch (error) {
        console.error(error);
        buyError.value = true;
    } finally {
        loading.value = false;
    }
}
</script>