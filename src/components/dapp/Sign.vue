<template>
    <ApprovalShell chain="evm" :title="$t('dapps.sign.title')" :origin="host">
        <template #badge>
            <div class="relative group">
                <div class="absolute inset-0 bg-emerald-500/10 dark:bg-emerald-500/20 rounded-full blur-lg group-hover:blur-xl transition-all"></div>
                <div class="w-16 h-16 rounded-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 flex items-center justify-center relative shadow-md dark:shadow-xl p-3 transition-colors duration-300">
                    <img
                        :src="logo"
                        @error="$event.target.src = 'https://api.dicebear.com/7.x/initials/svg?seed=' + host"
                        :alt="$t('dapps.sign.alt_dapp_logo')"
                        class="w-full h-full object-contain rounded-full"
                    >
                </div>
                <div class="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-white dark:bg-[#09090b] border border-slate-200 dark:border-white/10 flex items-center justify-center text-emerald-600 dark:text-emerald-500 shadow-sm transition-colors duration-300">
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                </div>
            </div>
        </template>

        <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex items-center gap-3 shadow-sm dark:shadow-none transition-colors duration-300">
            <img :src="`https://api.dicebear.com/7.x/identicon/svg?seed=${activeAccountAddress}`" class="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 shrink-0 border border-slate-200 dark:border-white/5" v-if="activeAccountAddress" />
            <div v-else class="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 animate-pulse border border-slate-200 dark:border-white/5"></div>
            <button type="button" class="flex flex-col cursor-pointer group text-left" @click="copyAddress" :title="$t('dapps.sign.copy_title')" :aria-label="$t('dapps.sign.copy_title')">
                <span class="text-xs text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider transition-colors duration-300">{{ $t('dapps.sign.label_account') }}</span>
                <span class="flex items-center gap-1.5">
                    <span class="text-sm font-bold text-slate-800 dark:text-zinc-200 transition-colors duration-300">{{ activeAccountName }}</span>
                    <span class="text-[10px] text-slate-400 dark:text-zinc-500 font-mono bg-slate-100 dark:bg-zinc-800/50 px-1.5 py-0.5 rounded transition-colors duration-300" v-if="activeAccountAddress">{{ shortenAddress(activeAccountAddress) }}</span>
                </span>
            </button>
        </div>

        <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between px-1">
                <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider transition-colors duration-300">{{ $t('dapps.sign.label_message') }}</p>
                <button @click="copyMessage" class="text-[10px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-bold flex items-center gap-1 transition-colors cursor-pointer">
                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                    {{ copied ? $t('dapps.sign.btn_copied') : $t('dapps.sign.btn_copy') }}
                </button>
            </div>

            <div class="w-full h-32 bg-slate-50 dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 overflow-y-auto custom-scrollbar relative group transition-colors duration-300 shadow-inner">
                <p class="text-xs font-mono text-slate-700 dark:text-zinc-300 whitespace-pre-wrap wrap-break-word leading-relaxed transition-colors duration-300">{{ displayMessage }}</p>
                <div class="absolute bottom-0 left-0 right-0 h-6 bg-linear-to-t from-slate-50 dark:from-[#131315] to-transparent pointer-events-none group-hover:opacity-0 transition-opacity"></div>
            </div>
        </div>

        <div class="flex gap-2 px-1">
            <svg class="w-4 h-4 text-slate-400 dark:text-zinc-500 shrink-0 mt-0.5 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <p class="text-[10px] text-slate-500 dark:text-zinc-500 leading-relaxed transition-colors duration-300">{{ $t('dapps.sign.info_text') }}</p>
        </div>

        <template #footer>
            <button
                @click="cancel"
                class="w-1/2 py-3.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 hover:text-slate-900 dark:hover:text-white transition-all border border-slate-200 dark:border-white/5 cursor-pointer shadow-sm dark:shadow-none"
                :disabled="loading"
            >
                {{ $t('dapps.sign.btn_reject') }}
            </button>
            <button
                @click="sign"
                class="w-1/2 py-3.5 rounded-xl font-bold text-sm bg-emerald-600 text-white hover:bg-emerald-500 hover:scale-[1.02] transition-all shadow-lg shadow-emerald-600/10 dark:shadow-emerald-900/20 flex items-center justify-center gap-2 cursor-pointer"
                :disabled="loading"
            >
                <svg v-if="loading" class="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span v-else>{{ $t('dapps.sign.btn_sign') }}</span>
            </button>
        </template>
    </ApprovalShell>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { cryptoStore } from '../../store/crypto'
import { pageStore } from '../../store/pageStore'
import { decodePersonalSignMessage } from '../../utils/signMessage'
import { findAccountByAddress } from '../../utils/deriveAccount'
import ApprovalShell from './ApprovalShell.vue'

const { t } = useI18n()
const page = pageStore()
const crypto = cryptoStore()

const host = ref('')
const logo = ref('')
const activeAccountName = ref(t('dapps.sign.default_account'))
const activeAccountAddress = ref('')
const loading = ref(false)
const copied = ref(false)

// Imza istekteki hesapla atilir (current_request.signWith), o anki aktif
// hesapla DEGIL: kullanici baglantidan sonra hesap degistirmis olabilir ve
// dapp hala eski hesabi bagli sanir; aktif hesapla imzalanirsa dapp'e yanlis
// hesabin imzasi doner.
const signerAccount = ref(null)

// Imzalanan sey her zaman ham yuk (crypto.user_message); ekranda ise cozulmus hali
// gosterilir, cunku kullanici "0x48656c6c6f" degil "Hello" okumali.
const displayMessage = computed(() => decodePersonalSignMessage(crypto.user_message))

const shortenAddress = (address) => {
    return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ''
}

const copyAddress = async () => {
    if(!activeAccountAddress.value) return
    try {
        await navigator.clipboard.writeText(activeAccountAddress.value)
    } catch (e) {}
}

onMounted(async () => {
    const { current_request, active_account, vaults } = await chrome.storage.local.get(['current_request', 'active_account', 'vaults'])

    // Load sign message data from storage
    if (current_request && current_request.type === 'SIGN_MESSAGE') {
        crypto.user_message = current_request.messageToSign
        host.value = current_request.origin || ''
        logo.value = current_request.favicon || ''

        // Extract hostname from origin for display
        try {
            host.value = new URL(current_request.origin).hostname
        } catch {
            // origin is already a hostname or unknown
        }

        if (current_request.signWith) {
            signerAccount.value = findAccountByAddress(vaults, current_request.signWith)

            // Istenen hesap artik hicbir kasada yok (silinmis): baska bir hesapla
            // imzalamak yerine istek reddedilir.
            if (!signerAccount.value) {
                await chrome.runtime.sendMessage({
                    type: 'SIGN_MESSAGE_REJECTED',
                    requestId: current_request.id,
                    status: 'error',
                    error: { code: 4100, message: 'Requested account is no longer available.' }
                })
                page.currentPage = 'home'
                return
            }
        }
    }

    // signWith tasimayan (eski) kayitlarda aktif hesaba dusulur.
    if (!signerAccount.value && active_account) {
        signerAccount.value = active_account
    }

    if (signerAccount.value) {
        if (signerAccount.value.name) activeAccountName.value = signerAccount.value.name
        if (signerAccount.value.address) activeAccountAddress.value = signerAccount.value.address
    }
})

const copyMessage = async () => {
    try {
        await navigator.clipboard.writeText(displayMessage.value)
        copied.value = true
        setTimeout(() => copied.value = false, 2000)
    } catch (e) {
        console.error(e)
    }
}

const sign = async() => {
    loading.value = true
    const { current_request } = await chrome.storage.local.get('current_request')

    try {
        const account = signerAccount.value
        if (!account) throw new Error('SIGNER_ACCOUNT_NOT_RESOLVED')

        // resolveAccount (background.js) yalniz `account` NESNESINE bakar;
        // `index` imzalayani secmez. Hesap acikca tasinmazsa arka plan o anki
        // aktif hesapla imzalar.
        const message = {
            account,
            sign_message: crypto.user_message
        }

        const response = await chrome.runtime.sendMessage({ 
            type: 'SIGN', 
            message 
        })
        
        if(response.success) {
            await chrome.runtime.sendMessage({ type: 'SIGN_MESSAGE_SUCCESS', requestId: current_request.id, status: 'success', data: { result: response.signature } })
            page.currentPage = 'home'
        } else {
            console.error('Signing failed')
            await chrome.runtime.sendMessage({ type: 'SIGN_MESSAGE_REJECTED', requestId: current_request.id, status: 'error' })
            page.currentPage = 'home'
        }
    } catch (error) {
        console.error('Sign error:', error)
        await chrome.runtime.sendMessage({ type: 'SIGN_MESSAGE_REJECTED', requestId: current_request.id, status: 'error' })
        page.currentPage = 'home'
    } finally {
        loading.value = false
    }
}

const cancel = async() => {
    const { current_request } = await chrome.storage.local.get('current_request')

    await chrome.runtime.sendMessage({
        type: 'SIGN_MESSAGE_REJECTED',
        requestId: current_request.id,
        status: 'error',
        error: {
            code: 4001,
            message: 'Sign Request cancelled by user.'
        }
    })
    page.currentPage = 'home'
}
</script>