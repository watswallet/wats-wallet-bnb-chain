<template>
    <div class="w-90 h-150 flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-emerald-500/30 transition-colors duration-300">
        <div class="absolute top-0 left-0 right-0 h-48 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/20 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex-1 flex flex-col relative px-6 py-3 overflow-y-auto custom-scrollbar z-10">
            
            <div class="flex flex-col items-center gap-6 mt-4">
                <div class="flex items-center gap-4">
                    <div class="relative group">
                        <div class="absolute inset-0 bg-blue-500/10 dark:bg-blue-500/20 rounded-2xl blur-lg group-hover:blur-xl transition-all"></div>
                        <div class="w-16 h-16 rounded-2xl bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 flex items-center justify-center relative shadow-md dark:shadow-xl overflow-hidden transition-colors duration-300">
                            <img 
                                :src="logo" 
                                @error="$event.target.src = 'https://api.dicebear.com/7.x/initials/svg?seed=' + origin"
                                :alt="$t('dapps.connect.alt_dapp_logo')" 
                                class="w-10 h-10 object-contain"
                            >
                        </div>
                    </div>

                    <div class="flex flex-col items-center gap-1">
                        <div class="w-12 h-px bg-linear-to-r from-transparent via-slate-300 dark:via-zinc-500 to-transparent transition-colors duration-300"></div>
                        <div class="p-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-400 dark:text-zinc-400 transition-colors duration-300">
                            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                        </div>
                        <div class="w-12 h-px bg-linear-to-r from-transparent via-slate-300 dark:via-zinc-500 to-transparent transition-colors duration-300"></div>
                    </div>

                    <div class="relative group">
                        <div class="absolute inset-0 bg-emerald-500/10 dark:bg-emerald-500/20 rounded-2xl blur-lg group-hover:blur-xl transition-all"></div>
                        <div class="w-16 h-16 rounded-2xl bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 flex items-center justify-center relative shadow-md dark:shadow-xl transition-colors duration-300">
                            <img 
                                :src="`https://api.dicebear.com/7.x/identicon/svg?seed=${profile?.address}`" 
                                :alt="$t('dapps.connect.alt_wallet_avatar')" 
                                class="w-10 h-10 rounded-full"
                            >
                        </div>
                    </div>
                </div>

                <div class="text-center space-y-3">
                    <h2 class="text-lg font-bold text-slate-900 dark:text-white tracking-tight transition-colors duration-300">{{ $t('dapps.connect.title') }}</h2>
                    <div class="flex items-center justify-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-zinc-800/50 border border-slate-200 dark:border-white/5 mx-auto w-fit transition-colors duration-300">
                        <svg class="w-3 h-3 text-slate-400 dark:text-zinc-400 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                        <p class="text-xs font-mono text-slate-600 dark:text-zinc-300 transition-colors duration-300">{{ origin }}</p>
                    </div>
                </div>
            </div>

            <!-- TON secili: baglanti kurulamaz. Izin/hesap kartlari yerine tek,
                 calisan bir aciklama karti — soluk/kilitli bir "Baglan" dugmesi
                 birakilmiyor, dugme tumden kaldiriliyor (asagida). -->
            <div v-if="tonBlocked" class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-2xl p-4 flex items-start gap-3 mt-5 shadow-sm dark:shadow-none transition-colors duration-300">
                <div class="mt-0.5 text-amber-600 dark:text-amber-400 shrink-0 transition-colors duration-300">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
                </div>
                <p class="text-xs text-amber-700 dark:text-amber-300 leading-relaxed transition-colors duration-300">{{ $t('dapps.connect.ton_not_supported') }}</p>
            </div>

            <template v-else>
                <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl p-4 flex flex-col gap-3 mt-5 shadow-sm dark:shadow-none transition-colors duration-300">
                    <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider transition-colors duration-300">{{ $t('dapps.connect.permissions_title') }}</p>

                    <div class="flex items-start gap-3">
                        <div class="mt-0.5 text-emerald-600 dark:text-emerald-500 transition-colors duration-300">
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                        </div>
                        <div>
                            <p class="text-sm font-bold text-slate-800 dark:text-zinc-200 transition-colors duration-300">{{ $t('dapps.connect.perm_view_title') }}</p>
                            <p class="text-xs text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('dapps.connect.perm_view_desc') }}</p>
                        </div>
                    </div>

                    <div class="flex items-start gap-3">
                        <div class="mt-0.5 text-emerald-600 dark:text-emerald-500 transition-colors duration-300">
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                        </div>
                        <div>
                            <p class="text-sm font-bold text-slate-800 dark:text-zinc-200 transition-colors duration-300">{{ $t('dapps.connect.perm_tx_title') }}</p>
                            <p class="text-xs text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('dapps.connect.perm_tx_desc') }}</p>
                        </div>
                    </div>
                </div>

                <div class="flex flex-col gap-2 mt-4">
                    <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider ml-1 transition-colors duration-300">{{ $t('dapps.connect.account_label') }}</p>
                    <div class="w-full rounded-xl p-3 flex items-center justify-between bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 shadow-sm dark:shadow-none transition-colors duration-300">
                        <div class="flex items-center gap-3">
                            <img :src="`https://api.dicebear.com/7.x/identicon/svg?seed=${profile?.address}`" class="rounded-full w-8 h-8 shadow-sm dark:shadow-none" />
                            <div class="flex flex-col">
                                <span class="text-sm font-bold text-slate-800 dark:text-white transition-colors duration-300">{{ profile?.name || $t('dapps.connect.default_account') }}</span>
                                <span class="text-[10px] font-mono text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ shortenAddress(profile?.address) }}</span>
                            </div>
                        </div>
                        <div class="min-w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)] dark:shadow-[0_0_8px_rgba(16,185,129,0.5)] transition-all"></div>
                    </div>
                </div>
            </template>
        </div>

        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-white dark:bg-[#09090b] relative z-20 flex gap-3 transition-colors duration-300">
            <button @click="cancel" :class="tonBlocked ? 'w-full' : 'w-1/2'" class="py-3.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 hover:text-slate-900 dark:hover:text-white transition-all border border-slate-200 dark:border-white/5 cursor-pointer">
                {{ $t('dapps.connect.btn_reject') }}
            </button>
            <button v-if="!tonBlocked" @click="connect" class="w-1/2 py-3.5 rounded-xl font-bold text-sm bg-emerald-600 text-white hover:bg-emerald-500 hover:scale-[1.02] transition-all shadow-lg shadow-emerald-600/20 dark:shadow-emerald-900/20 cursor-pointer">
                {{ $t('dapps.connect.btn_connect') }}
            </button>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { pageStore } from '../../store/pageStore'
import { LISTED_CHAINS as chains } from '../../data/chains'
import { hexChainIdFor } from '../../utils/dappFunctions'

const page = pageStore()
const url = ref(null)
const logo = ref(null)
const origin = ref(null)
const profile = ref(null)

// TON'un ag kimligi negatif; hexChainIdFor TON'da null doner (dappFunctions.js).
// Ucuncu bir yerde ayni '0x'+chainId.toString(16) hatasini tekrarlamak yerine
// baglanti YOLU BASTAN kapatiliyor: dapp kaydi hic acilmiyor, kullaniciya nedeni
// gosteriliyor. handleGetChainId'nin 4901 donmesiyle ve Header'da dapp baglanti
// pill'inin TON'da gizlenmesiyle tutarli — TON'da dapp yolu ya tamamen kapali ya
// tamamen acik, yari acik degil.
const tonBlocked = ref(false)

const shortenAddress = (addr) => {
    if (!addr) return ''
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

onMounted(async() => {
    const { active_account, current_request, currentNetwork } = await chrome.storage.local.get(['active_account', 'current_request', 'currentNetwork'])
    profile.value = active_account
    tonBlocked.value = !hexChainIdFor(currentNetwork)

    // Load dapp info from current_request (works in both popup and standalone window)
    if (current_request && current_request.type === 'CONNECT') {
        logo.value = current_request.favicon || null
        url.value = current_request.origin || ''
        try {
            origin.value = new URL(current_request.origin).hostname
        } catch {
            origin.value = current_request.origin || ''
        }
    }
})

const connect = async () => {
    const { dapps = {}, current_request, currentNetwork } = await chrome.storage.local.get(['dapps', 'current_request', 'currentNetwork'])

    const hexChainId = hexChainIdFor(currentNetwork)

    // Savunma amacli ikinci kontrol: sablonda buton zaten tonBlocked'ta gizli,
    // ama arayla currentNetwork degismis olabilir. Sahte "0x-ef" ile dapp kaydi
    // ASLA acilmaz; istek 4901 ile reddedilir (handleGetChainId ile ayni kod).
    if (!hexChainId) {
        await chrome.runtime.sendMessage({ type: 'CONNECT_WALLET_REJECTED', requestId: current_request.id, status: 'error', error: { code: 4901, message: 'Wallet is on a non-EVM network (TON)' } })
        page.currentPage = 'home'
        return
    }

    const addr = profile.value.address
    const hostname = origin.value

    // Varsayılan olarak tüm desteklenen ağlara erişim izni ver
    const allSupportedChains = chains.map(c => c.chainId)

    dapps[hostname] = {
        accounts: [addr],
        chainId: hexChainId,
        favicon: logo.value,
        connectedAt: Date.now(),
        allowedChains: allSupportedChains
    }

    await chrome.storage.local.set({ dapps })
    await chrome.runtime.sendMessage({ type: 'CONNECT_WALLET_SUCCESS', requestId: current_request.id, status: 'success', data: { result: [addr] } })

    page.currentPage = 'home'
}

const cancel = async () => {
    const { current_request } = await chrome.storage.local.get('current_request')

    await chrome.runtime.sendMessage({ type: 'CONNECT_WALLET_REJECTED', requestId: current_request.id, status: 'error', error: { code: 4001, message: 'User rejected the connection' } })
    page.currentPage = 'home'
}
</script>