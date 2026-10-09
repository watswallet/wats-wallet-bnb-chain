<template>
    <ApprovalShell chain="evm" :title="$t('dapps.signTypedData.title')" :origin="host">
        <template #badge>
            <div class="w-16 h-16 rounded-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 flex items-center justify-center relative shadow-md dark:shadow-xl p-3 transition-colors duration-300">
                <img
                    v-if="logo"
                    :src="logo"
                    @error="logo = ''"
                    :alt="$t('dapps.signTypedData.alt_dapp_logo')"
                    class="w-full h-full object-contain rounded-full"
                >
                <svg v-else class="w-7 h-7 text-slate-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
            </div>
        </template>

        <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex items-center gap-3 shadow-sm dark:shadow-none transition-colors duration-300">
            <div
                class="w-8 h-8 rounded-full shrink-0 border border-slate-200 dark:border-white/5"
                :style="{ backgroundColor: avatarColor }"
                role="img"
                :aria-label="$t('dapps.signTypedData.alt_wallet_avatar')"
            ></div>
            <button type="button" class="flex flex-col cursor-pointer group text-left" @click="copyAddress" :title="$t('dapps.signTypedData.copy_title')" :aria-label="$t('dapps.signTypedData.copy_title')">
                <span class="text-xs text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider transition-colors duration-300">{{ $t('dapps.signTypedData.label_account') }}</span>
                <span class="flex items-center gap-1.5">
                    <span class="text-sm font-bold text-slate-800 dark:text-zinc-200 transition-colors duration-300">{{ activeAccountName }}</span>
                    <span v-if="activeAccountAddress" class="text-[10px] text-slate-400 dark:text-zinc-500 font-mono bg-slate-100 dark:bg-zinc-800/50 px-1.5 py-0.5 rounded transition-colors duration-300">{{ shortenAddress(activeAccountAddress) }}</span>
                </span>
            </button>
        </div>

        <div v-if="failure" role="alert" class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl p-3 transition-colors duration-300">
            <p class="text-xs text-red-700 dark:text-red-300 leading-relaxed transition-colors duration-300">
                <span v-if="failure === 'expired'">{{ $t('dapps.signTypedData.request_expired') }}</span>
                <span v-else-if="failure === 'revoked'">{{ $t('dapps.signTypedData.permission_revoked') }}</span>
                <span v-else>{{ $t('dapps.signTypedData.request_invalid') }}</span>
            </p>
        </div>

        <div v-if="risk" role="alert" :class="riskBandClass">
            <p v-if="risk.kind === 'permit_unknown'" class="text-sm font-bold">{{ $t('dapps.signTypedData.permit_unknown_title') }}</p>
            <template v-else>
                <!-- Seaport ilani token HARCAMA izni degil pazar yeri emri: sahte "tokenlarinizi harcayabilir" alarmi uretilmez, tur etiketi baslik olur. -->
                <p v-if="risk.kind === 'seaport'" class="text-sm font-bold">{{ $t('dapps.signTypedData.kind_seaport') }}</p>
                <p v-else class="text-sm font-bold">{{ $t('dapps.signTypedData.permit_title') }}</p>
                <p v-if="risk.kind !== 'seaport'" class="text-xs font-medium">
                    <span v-if="risk.kind === 'erc2612'">{{ $t('dapps.signTypedData.kind_erc2612') }}</span>
                    <span v-else-if="risk.kind === 'dai'">{{ $t('dapps.signTypedData.kind_dai') }}</span>
                    <span v-else-if="risk.kind === 'permit2'">{{ $t('dapps.signTypedData.kind_permit2') }}</span>
                </p>
            </template>

            <div v-if="risk.spender" class="flex flex-col gap-0.5">
                <span class="text-[10px] font-bold uppercase tracking-wider opacity-70">{{ $t('send.confirmTransaction.spender') }}</span>
                <span class="text-xs font-mono break-all select-text">{{ risk.spender }}</span>
            </div>

            <div v-if="hasAmountLine" class="flex flex-col gap-0.5">
                <span class="text-xs font-mono break-all select-text">{{ risk.amount }}</span>
            </div>
            <ul v-if="permit2Items.length" class="flex flex-col gap-1">
                <li v-for="(item, i) in permit2Items" :key="'p2-' + i" class="text-xs font-mono break-all select-text">{{ describePermit2Item(item) }}</li>
            </ul>
            <p v-if="showUnitsNote" class="text-[10px] opacity-70">{{ $t('dapps.signTypedData.units_unknown') }}</p>

            <ul v-if="hasRiskChips" class="flex flex-wrap gap-1.5">
                <li v-if="hasFlag('unlimited')" class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-600/10 border border-red-600/30">{{ $t('dapps.signTypedData.flag_unlimited') }}</li>
                <li v-if="hasFlag('practically_unlimited')" class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-600/10 border border-red-600/30">{{ $t('dapps.signTypedData.flag_practically_unlimited') }}</li>
                <li v-if="hasFlag('no_expiry')" class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-600/10 border border-red-600/30">{{ $t('dapps.signTypedData.flag_no_expiry') }}</li>
                <li v-if="hasFlag('expired')" class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-600/10 border border-red-600/30">{{ $t('dapps.signTypedData.flag_expired') }}</li>
            </ul>

            <p v-if="hasFlag('replayable')" class="text-xs font-medium">{{ $t('dapps.signTypedData.chain_missing_warning') }}</p>

            <div v-if="risk.kind === 'seaport'" class="flex flex-col gap-2">
                <p v-if="hasFlag('receives_nothing')" class="text-sm font-bold">{{ $t('dapps.signTypedData.seaport_nothing') }}</p>
                <div v-if="seaportGive.length" class="flex flex-col gap-1">
                    <span class="text-[10px] font-bold uppercase tracking-wider opacity-70">{{ $t('dapps.signTypedData.seaport_give') }}</span>
                    <ul class="flex flex-col gap-1">
                        <li v-for="(item, i) in seaportGive" :key="'give-' + i" class="text-xs font-mono break-all select-text">{{ describeSeaportItem(item) }}</li>
                    </ul>
                </div>
                <div v-if="seaportGet.length" class="flex flex-col gap-1">
                    <span class="text-[10px] font-bold uppercase tracking-wider opacity-70">{{ $t('dapps.signTypedData.seaport_get') }}</span>
                    <ul class="flex flex-col gap-1">
                        <li v-for="(item, i) in seaportGet" :key="'get-' + i" class="text-xs font-mono break-all select-text">{{ describeSeaportItem(item) }}</li>
                    </ul>
                </div>
            </div>
        </div>

        <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3.5 flex flex-col gap-2.5 shadow-sm dark:shadow-none transition-colors duration-300">
            <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider transition-colors duration-300">{{ $t('dapps.signTypedData.label_domain') }}</p>
            <dl class="flex flex-col gap-2">
                <div v-for="row in domainRows" :key="row.path" class="flex flex-col gap-0.5">
                    <dt class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">{{ row.label }}</dt>
                    <dd class="text-xs font-mono text-slate-700 dark:text-zinc-300 break-all select-text">{{ row.value }}</dd>
                </div>
            </dl>
            <p v-if="hasWarning('chain_missing')" class="text-xs text-slate-500 dark:text-zinc-400">{{ $t('dapps.signTypedData.chain_missing') }}</p>
            <div v-if="domainExtraRows.length" class="flex flex-col gap-1">
                <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">{{ $t('dapps.signTypedData.domain_extra_fields') }}</p>
                <dl class="flex flex-col gap-1">
                    <div v-for="row in domainExtraRows" :key="row.path" class="flex flex-col gap-0.5">
                        <dt class="text-[10px] font-mono text-slate-500 dark:text-zinc-400 break-all">{{ row.name }}</dt>
                        <dd class="text-xs font-mono text-slate-700 dark:text-zinc-300 break-all select-text">{{ row.value }}</dd>
                    </div>
                </dl>
            </div>
        </div>

        <p v-if="hasWarning('unsigned_fields')" class="text-xs text-amber-700 dark:text-amber-300 leading-relaxed px-1">{{ $t('dapps.signTypedData.unsigned_fields') }}</p>
        <p v-if="hasWarning('hidden_chars')" class="text-xs text-amber-700 dark:text-amber-300 leading-relaxed px-1">{{ $t('dapps.signTypedData.hidden_chars') }}</p>

        <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between px-1">
                <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider transition-colors duration-300">{{ $t('dapps.signTypedData.label_primary_type') }}: <span class="font-mono normal-case">{{ primaryTypeLabel }}</span></p>
            </div>
            <div class="flex items-center justify-between px-1">
                <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider transition-colors duration-300">{{ $t('dapps.signTypedData.label_message') }}</p>
                <button
                    v-if="needsExpand"
                    type="button"
                    @click="showAll = !showAll"
                    class="text-[10px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-bold transition-colors cursor-pointer"
                >{{ showAll ? $t('dapps.signTypedData.show_less') : $t('dapps.signTypedData.show_all') }}</button>
            </div>
            <p v-if="needsExpand && !showAll" class="text-xs text-amber-700 dark:text-amber-300 leading-relaxed px-1">{{ $t('dapps.signTypedData.truncated') }}</p>
            <div class="w-full bg-slate-50 dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 transition-colors duration-300 shadow-inner">
                <dl class="flex flex-col gap-2">
                    <div v-for="row in messageRows" :key="row.path" class="flex flex-col gap-0.5" :style="{ paddingLeft: row.indent + 'px' }">
                        <dt class="text-[10px] font-mono text-slate-500 dark:text-zinc-400 break-all">{{ row.label }} <span class="opacity-60">({{ row.type }})</span></dt>
                        <dd v-if="!row.group" class="text-xs font-mono text-slate-800 dark:text-zinc-200 break-all select-text">{{ row.text }}</dd>
                    </div>
                </dl>
            </div>
        </div>

        <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex flex-col gap-2 shadow-sm dark:shadow-none transition-colors duration-300">
            <button type="button" class="flex items-center justify-between text-left cursor-pointer" @click="showTechnical = !showTechnical" :aria-expanded="showTechnical">
                <span class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">{{ $t('dapps.signTypedData.technical_details') }}</span>
                <svg class="w-3.5 h-3.5 text-slate-400 transition-transform" :class="showTechnical ? 'rotate-180' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
            </button>
            <div v-if="showTechnical" class="flex flex-col gap-3">
                <div class="flex flex-col gap-0.5">
                    <span class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">{{ $t('dapps.signTypedData.digest_label') }}</span>
                    <span class="text-xs font-mono text-slate-700 dark:text-zinc-300 break-all select-text">{{ digest }}</span>
                </div>
                <div class="flex flex-col gap-1">
                    <div class="flex items-center justify-between">
                        <span class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">{{ $t('dapps.signTypedData.raw_label') }}</span>
                        <button type="button" @click="copyJson" class="text-[10px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-bold transition-colors cursor-pointer">{{ copiedJson ? $t('dapps.signTypedData.btn_copied') : $t('dapps.signTypedData.btn_copy_json') }}</button>
                    </div>
                    <pre class="max-h-48 overflow-auto custom-scrollbar text-[10px] font-mono text-slate-700 dark:text-zinc-300 whitespace-pre-wrap break-all bg-slate-50 dark:bg-zinc-900/50 rounded-lg p-2 select-text">{{ rawJson }}</pre>
                </div>
            </div>
        </div>

        <div class="flex gap-2 px-1">
            <svg class="w-4 h-4 text-slate-400 dark:text-zinc-500 shrink-0 mt-0.5 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <p class="text-[10px] text-slate-500 dark:text-zinc-500 leading-relaxed transition-colors duration-300">{{ $t('dapps.signTypedData.info_text') }}</p>
        </div>

        <template #footer>
            <button
                @click="cancel"
                class="w-1/2 py-3.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 hover:text-slate-900 dark:hover:text-white transition-all border border-slate-200 dark:border-white/5 cursor-pointer shadow-sm dark:shadow-none"
                :disabled="loading"
            >
                {{ $t('dapps.signTypedData.btn_reject') }}
            </button>
            <button
                @click="sign"
                class="w-1/2 py-3.5 rounded-xl font-bold text-sm bg-emerald-600 text-white hover:bg-emerald-500 hover:scale-[1.02] transition-all shadow-lg shadow-emerald-600/10 dark:shadow-emerald-900/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                :disabled="signDisabled"
            >
                <svg v-if="loading" class="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span v-else>{{ $t('dapps.signTypedData.btn_sign') }}</span>
            </button>
        </template>
    </ApprovalShell>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { pageStore } from '../../store/pageStore'
import { findAccountByAddress } from '../../utils/deriveAccount'
import { shortenAddress } from '../../utils/shortenAddress'
import { gorunurKil } from '../../utils/solana/visibleText'
import { hashTypedDataDigest } from '../../utils/eip712/digest'
import { buildTypedDataView } from '../../utils/eip712/view'
import { classifyTypedData } from '../../utils/eip712/risk'
import { TYPED_DATA_USER_REJECT_MESSAGE } from '../../utils/eip712/errors'
import ApprovalShell from './ApprovalShell.vue'

const { t } = useI18n()
const page = pageStore()

// N7 (onay penceresi yarisi): Imzala dugmesi mount sonrasi, istek degisince ve
// pencere odagi donunce bu kadar sure kilitli kalir; kullanici A isteginde
// Imzala'ya uzanirken altinda B penceresi acilirsa yanlis tiklama olmasin.
const SIGN_LOCK_MS = 700
// Basarisizlik (izin kalkti / istek gecersiz) metni, ekran home'a donmeden once bu kadar
// sure GORUNUR kalir; aksi halde kullanici nedenini hic goremez (spec G1/8).
const FAILURE_CLOSE_MS = 1500
// Seaport kaleminde baslangic -> bitis miktari oku (kaynak ASCII kalsin diye kod noktasindan).
const ARROW = String.fromCodePoint(0x2192)

const host = ref('')
const logo = ref('')
const request = ref(null)
const signerAccount = ref(null)
const view = ref(null)
const risk = ref(null)
const digest = ref('')
const failure = ref('') // '' | 'expired' | 'revoked' | 'invalid'
const loading = ref(false)
const locked = ref(true)
const showAll = ref(false)
const showTechnical = ref(false)
const copiedJson = ref(false)

const typedData = computed(() => request.value?.typedData || null)

const activeAccountName = computed(() => signerAccount.value?.name || t('dapps.signTypedData.default_account'))
const activeAccountAddress = computed(() => signerAccount.value?.address || '')
// Yerel renk: adres ucuncu tarafa (identicon servisi) GONDERILMEZ.
const avatarColor = computed(() => (/^0x[0-9a-fA-F]{6}/.test(activeAccountAddress.value) ? '#' + activeAccountAddress.value.slice(2, 8) : '#94a3b8'))

const primaryTypeLabel = computed(() => gorunurKil(typedData.value?.primaryType || ''))

// --- gorunum modeli (T2 buildTypedDataView): domain satirlari once, sonra mesaj satirlari ---
const warningCodes = computed(() => (view.value?.warnings || []).map((w) => (typeof w === 'string' ? w : w?.code)))
const hasWarning = (code) => warningCodes.value.includes(code)
const rows = computed(() => view.value?.rows || [])

// Kisaltma (uzun dize, 100 satir ustu) varsa Imzala "tumunu goster"e kadar kilitli: gizleme YOK.
const needsExpand = computed(() => !!view.value && view.value.truncated === true)
const isShown = (row) => showAll.value || !row.hiddenByDefault
const textOf = (row) => String((showAll.value ? row.full : row.display) ?? '')

const domainLabels = computed(() => ({
    'domain.name': t('dapps.signTypedData.domain_name'),
    'domain.version': t('dapps.signTypedData.domain_version'),
    'domain.chainId': t('dapps.signTypedData.domain_chain'),
    'domain.verifyingContract': t('dapps.signTypedData.domain_contract'),
    'domain.salt': t('dapps.signTypedData.domain_salt'),
}))
const isKnownDomainPath = (path) => Object.prototype.hasOwnProperty.call(domainLabels.value, path)
const domainRows = computed(() => rows.value
    .filter((row) => row.section === 'domain' && isShown(row) && isKnownDomainPath(row.path))
    .map((row) => ({ path: row.path, label: domainLabels.value[row.path], value: textOf(row) })))
const domainExtraRows = computed(() => rows.value
    .filter((row) => row.section === 'domain' && isShown(row) && !isKnownDomainPath(row.path))
    .map((row) => ({ path: row.path, name: row.label, value: textOf(row) })))
const messageRows = computed(() => rows.value
    .filter((row) => row.section === 'message' && isShown(row))
    .map((row) => ({
        path: row.path,
        label: row.label,
        type: row.type,
        group: row.kind === 'group',
        indent: Math.min(Number(row.depth) || 0, 6) * 8,
        text: textOf(row),
    })))

// --- risk bandi (T2 classifyTypedData) ---
const hasFlag = (flag) => Array.isArray(risk.value?.flags) && risk.value.flags.includes(flag)
const riskItems = computed(() => (Array.isArray(risk.value?.items) ? risk.value.items : []))
const permit2Items = computed(() => (risk.value?.kind === 'permit2' ? riskItems.value : []))
const seaportGive = computed(() => (risk.value?.kind === 'seaport' ? riskItems.value.filter((item) => item.side === 'give') : []))
const seaportGet = computed(() => (risk.value?.kind === 'seaport' ? riskItems.value.filter((item) => item.side === 'receive') : []))
// Permit2'de token adresi kalemde durur: tek tutar satiri yerine kalem listesi gosterilir.
const hasAmountLine = computed(() => {
    const amount = risk.value?.amount
    return amount !== undefined && amount !== null && amount !== '' && permit2Items.value.length === 0
})
const showUnitsNote = computed(() => hasAmountLine.value || permit2Items.value.length > 0)
const hasRiskChips = computed(() => ['unlimited', 'practically_unlimited', 'no_expiry', 'expired'].some((flag) => hasFlag(flag)))
const riskBandClass = computed(() => 'rounded-xl p-3.5 flex flex-col gap-2 border transition-colors duration-300 ' + (
    risk.value?.level === 'danger'
        ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50 text-red-800 dark:text-red-200'
        : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-200'
))
const describePermit2Item = (item) => [item.token, item.amount].filter((part) => part !== undefined && part !== null && part !== '').join(' ')
const describeSeaportItem = (item) => {
    const parts = [item.itemType, item.token]
    if (item.identifier !== undefined && item.identifier !== null) parts.push('#' + item.identifier)
    if (item.amount !== undefined && item.amount !== null) parts.push('x ' + item.amount)
    if (item.endAmount !== undefined && item.endAmount !== null && item.endAmount !== item.amount) parts.push(ARROW + ' ' + item.endAmount)
    return parts.filter((part) => part !== undefined && part !== null && part !== '').join(' ')
}

// --- teknik ayrintilar: yeniden serilestirilmis, AYRISTIRILMIS nesne (alinan metin DEGIL) ---
const rawJson = computed(() => (typedData.value ? gorunurKil(JSON.stringify(typedData.value, null, 2)) : ''))

// --- Imzala kilidi ---
const ready = computed(() => !!request.value && !!signerAccount.value && !!view.value && !!digest.value && !failure.value)
const signDisabled = computed(() => loading.value || locked.value || !ready.value || (needsExpand.value && !showAll.value))

let lockTimer = null
const armLock = () => {
    locked.value = true
    clearTimeout(lockTimer)
    lockTimer = setTimeout(() => {
        locked.value = false
        lockTimer = null
    }, SIGN_LOCK_MS)
}

const hostOf = (origin) => {
    try {
        return new URL(origin).hostname
    } catch {
        return origin || ''
    }
}

const sendRejected = async (requestId, code, message) => {
    try {
        await chrome.runtime.sendMessage({
            type: 'SIGN_MESSAGE_REJECTED',
            requestId,
            status: 'error',
            error: { code, message }
        })
    } catch (error) {
        // Arka plan yanit vermese de ekran kapanir; dapp tarafi zaman asimina duser.
        console.error('SignTypedData: reject message failed', error)
    }
}

// Gecikmeli eve donus: zamanlayici yalniz olay zincirinde kurulur (setup/render'da DEGIL),
// yeni istek yuklenince ya da ekran kapanirken iptal edilir.
let closeTimer = null
const clearCloseTimer = () => {
    clearTimeout(closeTimer)
    closeTimer = null
}
const scheduleHome = () => {
    clearCloseTimer()
    closeTimer = setTimeout(() => {
        closeTimer = null
        page.currentPage = 'home'
    }, FAILURE_CLOSE_MS)
}

// Reddi dapp'e iletir, nedeni ekranda isaretler; ekran kisa sure sonra temizlenir.
const rejectAndClose = async (requestId, code, message, kind) => {
    failure.value = kind
    await sendRejected(requestId, code, message)
    scheduleHome()
}

let loadSeq = 0
const loadRequest = async () => {
    const seq = ++loadSeq
    clearCloseTimer()
    armLock()
    const { current_request, vaults } = await chrome.storage.local.get(['current_request', 'vaults'])
    if (seq !== loadSeq) return

    if (!current_request || current_request.type !== 'SIGN_TYPED_DATA') {
        request.value = null
        failure.value = 'expired'
        return
    }
    const req = current_request

    // Imza istekteki hesapla atilir (signWith); aktif hesaba ASLA dusulmez.
    const signer = findAccountByAddress(vaults, req.signWith)
    if (!signer) {
        await rejectAndClose(req.id, 4100, 'Requested account is no longer available.', 'invalid')
        return
    }

    // Ekran, arka planin sakladigi kaydi KENDI hesabiyla dogrular: gosterilen veri
    // ile saklanan ozet ayni degilse (bozuk kayit) imza ASLA istenmez.
    let nextDigest
    let nextView
    let nextRisk
    try {
        nextDigest = hashTypedDataDigest(req.typedData).digest
        if (typeof req.digest !== 'string' || req.digest.toLowerCase() !== nextDigest.toLowerCase()) {
            throw new Error('DIGEST_MISMATCH')
        }
        nextView = buildTypedDataView(req.typedData)
        nextRisk = classifyTypedData(req.typedData)
    } catch (error) {
        console.error('SignTypedData: request could not be verified', error)
        await rejectAndClose(req.id, -32603, 'Typed data could not be verified.', 'invalid')
        return
    }

    // Satir tavani asildiysa gorunum eksiktir: eksik gorunen veri ASLA imzalanmaz
    // (normalde istek penceresi hic acilmadan -32602 ile reddedilir; bu ikinci savunma).
    if (nextView.overLimit === true) {
        await rejectAndClose(req.id, -32602, 'Typed data is too large to display.', 'invalid')
        return
    }

    if (request.value && request.value.id !== req.id) {
        showAll.value = false
        showTechnical.value = false
    }
    request.value = req
    signerAccount.value = signer
    digest.value = nextDigest
    view.value = nextView
    risk.value = nextRisk
    host.value = hostOf(req.origin)
    logo.value = req.favicon || ''
    failure.value = ''
    armLock()
}

const copyText = async (text) => {
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        return false
    }
}

const copyAddress = async () => {
    if (activeAccountAddress.value) await copyText(activeAccountAddress.value)
}

const copyJson = async () => {
    if (!typedData.value) return
    if (await copyText(JSON.stringify(typedData.value, null, 2))) {
        copiedJson.value = true
        setTimeout(() => { copiedJson.value = false }, 2000)
    }
}

const sign = async () => {
    // Dugme devre disi olsa da islev KENDISI kilidi uygular (dogrudan cagri/yaris).
    if (signDisabled.value) return
    const req = request.value
    loading.value = true
    try {
        const { current_request } = await chrome.storage.local.get('current_request')
        if (!current_request || current_request.id !== req.id) {
            // Gosterilen istek yerine yenisi gecmis: eskisi icin imza ISTENMEZ.
            await loadRequest()
            return
        }

        // Popup yalniz {account, requestId, expectedDigest} gonderir; arka plan
        // imzalanacak veriyi KENDI kaydindan alir, ozeti yeniden hesaplar ve
        // expectedDigest ile karsilastirir.
        const response = await chrome.runtime.sendMessage({
            type: 'SIGN_TYPED_DATA_CONFIRM',
            message: {
                account: signerAccount.value,
                requestId: req.id,
                expectedDigest: digest.value
            }
        })

        if (response?.success && typeof response.signature === 'string') {
            await chrome.runtime.sendMessage({
                type: 'SIGN_MESSAGE_SUCCESS',
                requestId: req.id,
                status: 'success',
                data: { result: response.signature }
            })
            page.currentPage = 'home'
            return
        }

        const code = Number.isInteger(response?.error?.code) ? response.error.code : -32603
        const message = typeof response?.error?.message === 'string' && response.error.message
            ? response.error.message
            : 'Signing failed.'
        const kind = code === 4100 ? 'revoked' : (message === 'Request expired' ? 'expired' : 'invalid')
        await rejectAndClose(req.id, code, message, kind)
    } catch (error) {
        console.error('Sign typed data error:', error)
        await rejectAndClose(req.id, -32603, 'Signing failed.', 'invalid')
    } finally {
        loading.value = false
    }
}

const cancel = async () => {
    const req = request.value
    // Ret zaten iletildiyse (failure dolu) ikinci bir ret GONDERILMEZ; yalniz ekran kapanir.
    if (req && !failure.value) await sendRejected(req.id, 4001, TYPED_DATA_USER_REJECT_MESSAGE)
    clearCloseTimer()
    page.currentPage = 'home'
}

// Yeni bir SIGN_TYPED_DATA istegi eskisinin yerine gectiyse ekran yeniden yuklenir ve
// kilit yeniden kurulur.
const handleStorageChange = (changes, area) => {
    if (area !== 'local' || !changes?.current_request) return
    const next = changes.current_request.newValue
    if (next && next.type === 'SIGN_TYPED_DATA' && next.id !== request.value?.id) return loadRequest()
}
const handleFocus = () => armLock()

onMounted(async () => {
    chrome.storage.onChanged?.addListener(handleStorageChange)
    globalThis.addEventListener?.('focus', handleFocus)
    await loadRequest()
})

onBeforeUnmount(() => {
    chrome.storage.onChanged?.removeListener(handleStorageChange)
    globalThis.removeEventListener?.('focus', handleFocus)
    clearTimeout(lockTimer)
    clearCloseTimer()
})
</script>
