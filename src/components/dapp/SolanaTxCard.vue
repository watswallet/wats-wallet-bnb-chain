<template>
    <!-- Tek bir islemin karti (signAll'da her islem kendi karti). Satirlar
         `buildTxPreview` ciktisidir: yapilandirilmis alanlar, adresler TAM ve
         ayri hucrede (ceviri dizesine adres GOMULMEZ, Constraint 17). Dapp
         kaynakli hicbir metin (Memo) karar girdisi degildir ve yalniz metin
         dugumu olarak cizilir. -->
    <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex flex-col gap-2">
        <div class="flex justify-between items-center">
            <span class="text-[10px] text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider">{{ $t('dapps.solana.txLabel', { n: kart.index + 1 }) }}</span>
            <span v-if="kart.isDurableNonce" class="text-[10px] text-sky-600 dark:text-sky-400">{{ $t('dapps.solana.durableNonce') }}</span>
        </div>

        <!-- Bu islemin KENDI simulasyon ozeti (yalniz signAll: tek islemde ozet ekranin
             ustundeki kahraman kartindadir, `simOzet` null gelir). Sonuc yoksa uydurma rakam
             yerine yalniz bu kart "hesaplanamadi" der. Kaynak ucuncu taraf simulasyonudur:
             yalniz gosterim, imza kararini baglamaz. -->
        <div v-if="simOzet && simOzet.durum !== 'bekliyor'" class="flex flex-col gap-1">
            <template v-if="simOzet.durum === 'ok'">
                <div v-for="s in simOzet.satirlar" :key="s.key" class="flex justify-between items-center gap-2">
                    <span class="text-sm font-bold tabular-nums min-w-0 break-all" :class="s.negatif ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'">{{ s.metin }}</span>
                    <span v-if="s.dogrulanmamis" class="text-[10px] text-amber-700 dark:text-amber-300">{{ $t('dapps.solana.unverifiedToken') }}</span>
                </div>
                <p v-if="simOzet.degisimYok" class="text-[10px] text-slate-600 dark:text-zinc-300 leading-relaxed">{{ $t('dapps.solana.balanceNoChange') }}</p>
                <p v-if="simOzet.tokenEksik" class="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">{{ $t('dapps.solana.balanceTokensUnreadable') }}</p>
                <p v-if="simOzet.izinNotu" class="text-[10px] text-slate-500 dark:text-zinc-400 leading-relaxed">{{ $t('dapps.solana.balanceNoPermissionNote') }}</p>
            </template>
            <p v-else-if="simOzet.durum === 'programHatasi'" class="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">{{ $t('dapps.solana.simFailedWarning') }}</p>
            <p v-else class="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">{{ $t('dapps.solana.balanceUnavailable') }}</p>
        </div>

        <!-- DURUSTLUK KURALI: gosterilecek satir GERCEKTEN yoksa bu "temiz" bir
             kart DEGILDIR (parsed yoktu ile gercekten sifir talimat ayni bos
             dizidir). Sessizce hicbir sey gostermemek "burada tehlikeli bir sey
             yok" izlenimi verirdi; acikca soylenir. -->
        <div v-if="satirlar.length === 0" class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-lg p-2.5">
            <p class="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">{{ $t('dapps.solana.noInstructions') }}</p>
        </div>

        <div v-for="row in bilinenSatirlar" :key="row.index" class="flex flex-col gap-1.5 border-t border-slate-100 dark:border-white/5 pt-2 first:border-t-0 first:pt-0">
            <div class="flex justify-between items-start gap-2">
                <span class="text-xs font-medium" :class="row.risk ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-zinc-300'">{{ baslik(row) }}</span>
                <!-- Genel "ozetlenmeyen talimat" basligi: kendi cozucumuzun SABIT
                     tip adi yaninda gosterilir (dapp metni degil). -->
                <span v-if="row.kind === 'other' && row.type" class="text-[10px] font-mono text-slate-400 dark:text-zinc-500 shrink-0">{{ row.type }}</span>
            </div>
            <p v-if="kirmiziAnahtar(row)" class="text-[10px] text-red-600 dark:text-red-400 leading-relaxed">{{ $t(kirmiziAnahtar(row)) }}</p>
            <p v-if="row.kind !== 'memo' && row.affectsUser === false" class="text-[10px] text-slate-400 dark:text-zinc-500">{{ $t('dapps.solana.notYourAccount') }}</p>
            <p v-if="row.token2022Nominal" class="text-[10px] text-slate-500 dark:text-zinc-400">{{ $t('dapps.solana.token2022Note') }}</p>

            <!-- Memo: dapp'in yazdigi, DOGRULANMAMIS metin. Sabit etiket, tirnak
                 icinde, tek satir, ayri kutu stili. -->
            <div v-if="row.kind === 'memo'" class="bg-slate-50 dark:bg-zinc-900/60 border border-dashed border-slate-300 dark:border-white/10 rounded-lg p-2 flex flex-col gap-1">
                <span class="text-[10px] text-slate-400 dark:text-zinc-500">{{ $t('dapps.solana.memoUntrusted') }}</span>
                <p v-if="memoMetni(row) !== null" class="text-xs text-slate-600 dark:text-zinc-300 break-words">&ldquo;{{ memoMetni(row) }}&rdquo;</p>
                <p v-else class="text-[10px] text-amber-700 dark:text-amber-300">{{ $t('dapps.solana.unreadableDesc') }}</p>
                <span v-if="row.memoTruncated" class="text-[10px] text-slate-400 dark:text-zinc-500">{{ $t('dapps.solana.memoTruncated') }}</span>
            </div>

            <template v-else>
                <template v-for="f in row.fields" :key="f.labelKey">
                    <!-- Yetki turu: etiketin kendisi tam metin ("Yetki: token uretme"). -->
                    <span v-if="f.labelKey.indexOf('dapps.solana.f.authorityType_') === 0" class="text-[10px] text-slate-500 dark:text-zinc-400">{{ $t(f.labelKey) }}</span>

                    <!-- Yetki kaldirma: yeni yetkili YOK, "cozulemedi" degil. -->
                    <div v-else-if="f.labelKey === 'dapps.solana.f.newAuthority' && row.removesAuthority" class="flex flex-col gap-0.5">
                        <span class="text-[10px] text-slate-400 dark:text-zinc-500">{{ $t(f.labelKey) }}</span>
                        <span class="text-xs text-slate-600 dark:text-zinc-300">{{ $t('dapps.solana.authorityRemoved') }}</span>
                    </div>

                    <!-- Mint: kurasyonlu sembol varsa sembol + kisa adres, yoksa TAM adres
                         ve "dogrulanmamis token" (mint etiketi yalniz kurasyonlu tablodan). -->
                    <div v-else-if="f.labelKey === 'dapps.solana.f.mint'" class="flex flex-col gap-0.5">
                        <span class="text-[10px] text-slate-400 dark:text-zinc-500">{{ $t(f.labelKey) }}</span>
                        <span v-if="f.value === null" class="text-xs text-amber-700 dark:text-amber-300">{{ $t('dapps.solana.tokenUnresolved') }}</span>
                        <template v-else>
                            <span v-if="mintSembol(row, f)" class="text-xs font-medium text-slate-700 dark:text-zinc-200">{{ mintSembol(row, f) }} <span class="font-mono text-[10px] text-slate-400 dark:text-zinc-500">{{ kisa(f.value) }}</span></span>
                            <template v-else>
                                <span class="text-[11px] font-mono break-all text-slate-700 dark:text-zinc-200">{{ adres(f.value) }}</span>
                                <span class="text-[10px] text-amber-700 dark:text-amber-300">{{ $t('dapps.solana.unverifiedToken') }}</span>
                            </template>
                        </template>
                    </div>

                    <!-- CloseAccount: hesaptaki SOL okunamadi -> "tum SOL gidebilir". Etiketin kendisi
                         tam uyari cumlesidir; "cozulemedi (adres tablosu)" metni burada yaniltici olurdu. -->
                    <div v-else-if="f.labelKey === 'dapps.solana.f.closeSolUnknown'" class="flex flex-col gap-0.5">
                        <span class="text-xs font-medium text-amber-700 dark:text-amber-300">{{ $t(f.labelKey) }}</span>
                    </div>

                    <div v-else-if="f.kind === 'amount'" class="flex flex-col gap-0.5">
                        <span class="text-[10px] text-slate-400 dark:text-zinc-500">{{ $t(f.labelKey) }}</span>
                        <span v-if="row.unlimited" class="text-sm font-bold text-red-600 dark:text-red-400">{{ $t('dapps.solana.f.unlimited') }}</span>
                        <template v-else>
                            <span v-if="tutar(f).metin !== null" class="text-sm font-bold tabular-nums min-w-0 break-all">{{ tutar(f).metin }}</span>
                            <span v-if="tutar(f).etiket" class="text-[10px] text-amber-700 dark:text-amber-300">{{ $t('dapps.solana.' + tutar(f).etiket) }}</span>
                            <span v-else-if="tutar(f).dogrulanmamis" class="text-[10px] text-amber-700 dark:text-amber-300">{{ $t('dapps.solana.unverifiedToken') }}</span>
                        </template>
                    </div>

                    <div v-else-if="f.kind === 'address'" class="flex flex-col gap-0.5">
                        <span class="text-[10px] text-slate-400 dark:text-zinc-500">{{ $t(f.labelKey) }}</span>
                        <template v-if="f.value === null">
                            <span class="text-xs text-amber-700 dark:text-amber-300">{{ $t('dapps.solana.fieldUnresolved') }}</span>
                            <!-- Alici SAHIBI okunamadiysa en azindan hedef TOKEN HESABI tam gorunur. -->
                            <span v-if="f.tokenAccount" class="text-[11px] font-mono break-all text-slate-500 dark:text-zinc-400">{{ adres(f.tokenAccount) }}</span>
                        </template>
                        <span v-else-if="kullanici !== null && f.value === kullanici" class="text-xs font-medium text-slate-700 dark:text-zinc-200">{{ $t('dapps.solana.youLabel') }} <span class="font-mono text-[10px] text-slate-400 dark:text-zinc-500">{{ kisa(f.value) }}</span></span>
                        <span v-else class="text-[11px] font-mono break-all text-slate-700 dark:text-zinc-200">{{ adres(f.value) }}</span>
                    </div>

                    <div v-else class="flex flex-col gap-0.5">
                        <span class="text-[10px] text-slate-400 dark:text-zinc-500">{{ $t(f.labelKey) }}</span>
                        <span v-if="f.value === null" class="text-xs text-amber-700 dark:text-amber-300">{{ $t('dapps.solana.fieldUnresolved') }}</span>
                        <span v-else class="text-xs tabular-nums text-slate-700 dark:text-zinc-200">{{ metin(f.value) }}</span>
                    </div>
                </template>
            </template>
        </div>

        <!-- Bilinmeyen programlar TEK satirda gruplanir; ayrintisi acilir icinde.
             Cozemedigimiz talimat icin ozet UYDURULMAZ: ham baytlarin SHA-256'si
             gosterilir (dogrulanabilir ama YANILTMAZ). -->
        <details v-if="bilinmeyenler.length > 0" class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-lg p-2.5">
            <summary class="text-[10px] font-bold text-amber-700 dark:text-amber-300 cursor-pointer">{{ grupBasligi }}</summary>
            <div v-for="u in bilinmeyenler" :key="u.index" class="flex flex-col gap-1 border-t border-amber-200/70 dark:border-amber-800/40 pt-2 mt-2 first:mt-2">
                <span class="text-[10px] text-slate-500 dark:text-zinc-400">{{ $t('dapps.solana.f.program') }}</span>
                <span class="text-[11px] font-mono break-all text-amber-800 dark:text-amber-300">{{ adres(u.fields?.[0]?.value) }}</span>
                <p class="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">{{ $t('dapps.solana.undecodable') }}</p>
                <span class="text-[10px] font-mono text-amber-800 dark:text-amber-300 break-all">{{ $t('dapps.solana.instructionHashLabel') }}: {{ kisaHash(hashOf(u)) }}</span>
            </div>
        </details>
    </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { shortenAddress } from '../../utils/shortenAddress'
import { gorunurKil } from '../../utils/solana/visibleText.js'
import { formatRawAmount } from '../../utils/solana/formatRawAmount'
import { mintDisplaySymbol } from '../../utils/solana/mintDisplay'
import { REDFLAG_UI_TYPES } from '../../utils/solana/decodeInstructions'

const props = defineProps({
    // { index, talimatlar, preview: buildTxPreview ciktisi, isDurableNonce }
    kart: { type: Object, required: true },
    // Onaylayan hesabin Solana adresi (cuzdanin KENDI urettigi oturum adresi); yoksa null.
    kullanici: { type: String, default: null },
    // Bu islemin simulasyon ozeti { durum, satirlar, degisimYok, izinNotu, tokenEksik } (yalniz signAll); yoksa null.
    simOzet: { type: Object, default: null },
})

const { t } = useI18n()

const UNKNOWN_KINDS = new Set(['unknownProgram', 'undecodable'])

const satirlar = computed(() => props.kart.preview?.rows ?? [])
const bilinenSatirlar = computed(() => satirlar.value.filter((r) => !UNKNOWN_KINDS.has(r.kind)))
const bilinmeyenler = computed(() => satirlar.value.filter((r) => UNKNOWN_KINDS.has(r.kind)))

// Tek bilinmeyen: kendi basligi ("Bilinmeyen program" / "okunamayan talimat").
// Birden cok: sayacli grup basligi.
const grupBasligi = computed(() => (bilinmeyenler.value.length === 1
    ? t(bilinmeyenler.value[0].titleKey)
    : t('dapps.solana.ix.unknownGroup', { n: bilinmeyenler.value.length })))

// programId/adresler base58 -- bu alfabede homoglif ya da gorunmez kod noktasi
// olusamaz. Helper yine de uygulanir: asiri-isaretleme zararsizdir, beklenmedik
// bir girdide eksik-isaretlemeye dusmemek icindir.
const adres = (v) => gorunurKil(v ?? '')
const kisa = (v) => gorunurKil(shortenAddress(v || '', 4, 4))
const kisaHash = (v) => shortenAddress(v || '', 16, 8)
const metin = (v) => gorunurKil(String(v))

const baslik = (row) => (row.titleKey ? t(row.titleKey) : t('dapps.solana.ix.other'))
const hashOf = (satir) => props.kart.talimatlar.find((ix) => ix.index === satir.index)?.hash ?? ''

// Kirmizi satirin aciklama anahtari: talimatin cozucu tipinden (REDFLAG_UI_TYPES
// disinda bir tip icin ham anahtar GOSTERILMEZ).
function kirmiziAnahtar(row) {
    if (!row.risk) return null
    const tip = props.kart.talimatlar.find((ix) => ix.index === row.index)?.type
    if (!REDFLAG_UI_TYPES.includes(tip)) return null
    // SINIRLI Approve (final SU-18): miktar okunmus ve sinirsiz degil -> "gosterilen tutara kadar"
    // metni; sinirsiz ya da miktar OKUNAMADI ise mevcut (sinirsiz) metin kalir (fail-closed).
    if ((tip === 'Approve' || tip === 'ApproveChecked') && row.kind === 'approve' && row.unlimited !== true) {
        const miktar = row.fields?.find((f) => f.kind === 'amount')?.value
        if (typeof miktar === 'string' && /^[0-9]+$/.test(miktar)) return 'dapps.solana.redFlag_ApproveLimited'
    }
    return `dapps.solana.redFlag_${tip}`
}

// Tutar hucresi. Ham birim BigInt ile bicimlenir; cozulemezse uydurma YOK:
// miktar var ama token/decimals yoksa ham miktar + `tokenUnresolved`.
function tutar(f) {
    const bicimli = formatRawAmount(f.value, f.decimals)
    if (bicimli !== null) {
        // wSOL kurasyonlu tabloda yok: gosterim katmaninda ozel durum (mintDisplay.js).
        const sembol = f.verified && typeof f.symbol === 'string' && f.symbol !== '' ? f.symbol : (f.mint != null ? mintDisplaySymbol(f.mint, f.decimals) : null)
        return { metin: sembol ? `${bicimli} ${sembol}` : bicimli, dogrulanmamis: !sembol, etiket: null }
    }
    if (typeof f.value === 'string' && /^[0-9]+$/.test(f.value)) return { metin: f.value, dogrulanmamis: false, etiket: 'tokenUnresolved' }
    return { metin: null, dogrulanmamis: false, etiket: 'fieldUnresolved' }
}

// Mint hucresinin sembolu: ya mint alaninin kendisi (ATA / InitializeAccount satirlari)
// ya da ayni mint'e ait tutar alani KURASYONLU ise. Baska kaynak YOK.
function mintSembol(row, f) {
    if (f.verified && f.symbol) return f.symbol
    const tutarAlani = row.fields.find((x) => x.kind === 'amount' && x.mint === f.value)
    if (tutarAlani?.verified && tutarAlani.symbol) return tutarAlani.symbol
    return mintDisplaySymbol(f.value, tutarAlani?.decimals ?? null)
}

// Memo: gorunmez/homoglif isaretli (decoder'da yapildi, burada tekrar zararsiz), TEK satir (satir
// sonlari bosluga katlanir). 140 kod noktasi kirpmasi DECODER'dadir (memoTruncated notunu orada
// belirler); burada ikinci kez KIRPILMAZ (SU-7): etiketler (`[U+200B]`) metni 140 kod noktasinin
// ustune tasirabilir ve kart bunu notsuz kesip bir etiketi yarida birakirdi.
function memoMetni(row) {
    const alan = row.fields.find((f) => f.labelKey === 'dapps.solana.f.memoText')
    if (!alan || alan.value === null || alan.unresolved) return null
    return gorunurKil(String(alan.value).replace(/\s+/g, ' '))
}
</script>
