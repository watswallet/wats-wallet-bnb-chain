<template>
    <ApprovalShell chain="evm" :title="$t('privacy.blocked.title')" :origin="origin">
        <div class="flex flex-col gap-3 px-1">
            <p class="text-sm text-slate-600 dark:text-zinc-300 leading-relaxed">{{ $t('privacy.blocked.desc') }}</p>
            <p v-if="error" class="text-xs font-medium text-red-600 dark:text-red-400">{{ error }}</p>
        </div>

        <template #footer>
            <div class="grid grid-cols-2 gap-3 w-full">
                <button
                    @click="reject"
                    :disabled="busy"
                    class="py-3.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 hover:text-slate-900 dark:hover:text-white transition-all border border-slate-200 dark:border-white/5 cursor-pointer disabled:opacity-60"
                >{{ $t('privacy.blocked.close') }}</button>
                <button
                    @click="exitPrivacy"
                    :disabled="busy"
                    class="py-3.5 rounded-xl font-bold text-sm bg-violet-600 hover:bg-violet-500 text-white transition-all cursor-pointer disabled:opacity-60"
                >{{ $t('privacy.blocked.exit') }}</button>
            </div>
        </template>
    </ApprovalShell>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ApprovalShell from './ApprovalShell.vue'
import { pageStore } from '../../store/pageStore'
import { requestPrivacyMode } from '../../utils/privacy/privacyModeRequest'
import { POPUP_DAPP_METHODS, privacyBlockResponse } from '../../utils/privacy/privacyGate'

// GIZLI MOD engel popup'i (spec 6.2). Bekleyen dapp istegi "Kapat"ta ve BASARILI
// "Gizli moddan cik"ta reddedilir: cikis yalnizca kullaniciyi normal moda alir, dapp
// ayni istegi KENDISI yeniden gondermeli (kullanici onayi olmadan baglanti yok).
// Cikis BASARISIZ olursa istek beklemede kalir ve hata ekranda gosterilir (ayrinti
// exitPrivacy icinde).
// Sayfaya giden hata nesnesi, saklanan istegin YONTEMININ normal onay ekraninin
// kullanici reddinde gonderdigiyle BIREBIR aynidir (baglanti: ConnectDapp.vue, imza:
// Sign.vue, islem: Dapp.vue, ag degistirme: SwitchChain.vue); tek kaynak
// privacyBlockResponse'tur. Sayfa "kullanici reddetti" ile "cuzdan gizli modda"
// arasindaki farki hicbir yontemde goremez; gizli mod metni ya da PRIVATE_* kodu
// asla sayfaya sizmaz. Yontem yoksa ya da bilinmiyorsa baglanti reddine dusulur.
const page = pageStore()
const { t } = useI18n()
const error = ref('')
const origin = ref('')
const requestId = ref(null)
const busy = ref(false)
const method = ref('eth_requestAccounts')

onMounted(async () => {
    const { current_request } = await chrome.storage.local.get('current_request')
    if (current_request?.type !== 'PRIVACY_BLOCKED') return
    requestId.value = current_request.id
    if (POPUP_DAPP_METHODS.has(current_request.method)) method.value = current_request.method
    try {
        origin.value = new URL(current_request.origin).hostname
    } catch {
        origin.value = current_request.origin || ''
    }
})

async function respond() {
    await chrome.runtime.sendMessage({
        type: 'CONNECT_WALLET_REJECTED',
        requestId: requestId.value,
        status: 'error',
        error: privacyBlockResponse(method.value, 'PRIVATE_DAPP_BLOCKED').error,
    })
    page.currentPage = 'home'
}

async function reject() {
    if (busy.value) return
    busy.value = true
    try {
        await respond()
    } finally {
        busy.value = false
    }
}

async function exitPrivacy() {
    if (busy.value) return
    busy.value = true
    try {
        error.value = ''
        const res = await requestPrivacyMode(false)
        if (res.ok) {
            await respond()
            return
        }
        // Cikis BASARISIZ: istek REDDEDILMEZ, beklemede kalir. Ret gonderilseydi
        // resolvePendingRequest onay penceresini kapatir ve App.vue current_request
        // kalkinca home'a doner: hata kullanicinin gozune hic ulasmazdi. Bunun yerine
        // cevrilmis hata ekranda gorunur, iki dugme de etkin kalir: kullanici cikisi
        // yeniden dener ya da Kapat ile (yontemin normal retiyle) reddeder. Pencereyi
        // kapatmak da mevcut onay penceresi kapanis cevabini uretir; dapp asili kalmaz
        // ve bunu bekleyen normal bir onay popup'indan ayirt edemez. Ham kod ya da
        // istisna metni gosterilmez (requestPrivacyMode bilinmeyeni generic metne dusurur).
        error.value = t(res.errorKey)
    } finally {
        busy.value = false
    }
}
</script>
