<template>
    <!-- PAYLASILAN ATS UCRET KARTI -- bes ekranin TEK kaynagi.
         Kabuk Send (ConfirmTransaction.vue) kartindan alindi ve TEK kabuk olarak
         kaldi: Takas/Kopru kartlari eskiden `px-3 py-2.5`, gölgesiz ve yatay
         yerlesimliydi; ayni bilgi iki ekranda iki ayri agirlikta gorunuyordu.

         `rounded-xl` STATIK kalmak ZORUNDA: yerlesim testi (atsFeeCardTogether.test.js)
         kart govdesini kaynak metinden, sinifinda `rounded-xl` gecen div yigini ile
         cikariyor. Kabuk `:class` ile uretilirse o arac kartin sinirini bulamaz ve
         "eksik bakiye kartin ICINDE mi" iddiasi sessizce hicbir sey olcmez. -->
    <div class="shrink-0 bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex flex-col gap-2 transition-colors duration-300 shadow-sm dark:shadow-none">
        <!-- ETIKET EKRANDAN GELIR, component SECMEZ. `gasFee` ("Tahmini") EVM'de
             dogrudur -- kullanilmayan gaz iade edilir, sayi gercekten bir tahmindir.
             TON'da `/relay` TAM OLARAK bu kadar keser ve iade etmez, orada `tonFeeExact`
             ("Kesilen") dogrudur. Tek bir etiket dayatmak ikisinden birinde yalan olurdu. -->
        <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium transition-colors duration-300">{{ $t(labelKey, { symbol }) }}</span>

        <div class="flex items-center gap-2 min-w-0">
            <img v-if="logoUri" :src="logoUri" :alt="symbol" class="w-5 h-5 rounded-full shrink-0 ring-1 ring-black/5 dark:ring-white/10 transition-colors duration-300" @error="e => { e.target.onerror = null; e.target.src = '/default-token.png' }">

            <!-- TUTAR BICIMLENMEZ. Gosterilen dize ekranda hazirlanir ve TON kolunda
                 DOGRUDAN imzalanacak `atsMaxFee` alanidir; araya bir bicimleyici
                 girerse ekrandaki sayi ile imzalanan sayi ayrisir ve kullanici
                 onayladigini sandigindan baska bir tutari imzalar. -->
            <div v-if="amount != null" class="flex items-baseline gap-1.5 min-w-0" :title="exact || undefined">
                <!-- "en fazla" YALNIZ iadenin GERCEKTEN oldugu yolda dogrudur (ayni
                     zincir, postOp fazlayi geri verir). `noRefundKey` doluyken bu
                     niteleyici o satiri CURUTUR -- ikisi daha once ekranda yan yana
                     cizildi. Kapi burada, tek yerde. -->
                <span v-if="showUpToRow" class="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-zinc-500 shrink-0 transition-colors duration-300">{{ $t('send.confirmTransaction.atsFeeUpTo') }}</span>
                <span class="text-lg leading-none font-bold text-slate-900 dark:text-white tabular-nums truncate transition-colors duration-300">{{ amount }}</span>
                <span class="text-xs font-bold text-slate-500 dark:text-zinc-400 shrink-0 transition-colors duration-300">{{ symbol }}</span>
            </div>
            <!-- Yukleniyorken iskelet; yukleme bittiyse ve tutar yoksa TIRE. Ucuncu kol
                 BILEREK var: Takas/Kopru kartlarinda yoktu ve ucret cozulemedigi anda
                 kartin sag tarafi bombos kaliyordu -- sebebi alttaki hata karti anlatir
                 ama kart once bir sey gostermeli. -->
            <div v-else-if="loading" class="h-5 w-28 bg-slate-100 dark:bg-zinc-800 rounded animate-pulse transition-colors duration-300"></div>
            <span v-else class="text-lg leading-none font-bold text-slate-300 dark:text-zinc-700 tabular-nums transition-colors duration-300">—</span>

            <!-- Kosul `amount` DEGIL `usdText`: tutar varken fiyat gelmemis olabilir ve
                 sifirli bir dolar metni bir ucret kartinda "bedava" demektir. -->
            <span v-if="usdText" class="text-[11px] text-slate-500 dark:text-zinc-500 tabular-nums shrink-0 transition-colors duration-300">≈ ${{ usdText }}</span>
        </div>

        <div v-if="hasFooter" class="flex flex-col gap-1 border-t border-slate-100 dark:border-white/5 pt-2 transition-colors duration-300">
            <!-- "Ucret ATS ile odeniyor" satiri -- YESIL, cunku bir uyari degil bir
                 kolaylik: kullanici native gaz varligi tutmak zorunda degil. Takas ve
                 Kopru ekranlarinda ayni dize KARTIN BASLIGI oldugu icin orada bu satir
                 gecilmez; iki kez basmak tek kartta iki baslik olurdu. -->
            <span v-if="paidWithKey" class="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-500 font-bold transition-colors duration-300">
                <svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5 2 4 13.5h6L9.5 22 20 10.5h-6.5L13.5 2Z"/></svg>
                {{ $t(paidWithKey, { symbol }) }}
            </span>

            <!-- Iki not TEK satirda birlesebiliyor (Send/Dapp capraz-zincir yolu):
                 ayri satirlara bolununce kart gereksiz uzuyordu. -->
            <span v-if="footerJoined && noRefundKey && paidOnBscKey" class="text-[10px] text-slate-500 dark:text-zinc-500 transition-colors duration-300">
                {{ $t(noRefundKey, { symbol }) }} · {{ $t(paidOnBscKey, { symbol }) }}
            </span>
            <template v-else>
                <span v-if="paidOnBscKey" class="text-[10px] text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t(paidOnBscKey, { symbol }) }}</span>
                <!-- IADE ANAHTARI EKRANDAN: `atsFeeNoRefund` ve `tonFeeNoRefund` metinleri
                     birbirine yakin ama AYRI anahtarlar ve ayri yollari anlatiyorlar.
                     Tek anahtara indirgemek, cevirilerin birinde olu anahtar birakirdi.
                     Takas/Kopru'da BILEREK bos: ayni-zincir takasta "iade edilmez" yalan. -->
                <span v-if="noRefundKey" class="text-[10px] text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t(noRefundKey, { symbol }) }}</span>
            </template>

            <!-- "Ucret yanar" -- KEHRIBAR, kirmizi DEGIL: bir engel degil bir kosul.
                 Ayri kutu DEGIL kartin alt satiri; iki kutuya bolmek ust kartta bir
                 tutar gosterip hemen altinda onu odeyemeyecegini soylemek oluyordu.
                 Gorunurlugu EKRANIN karari: takasta HER ZAMAN gecerli (sendMode 3 ile
                 fonlanamayan eylem atlanir, islem "basarili" sayilir, ucret kesilmistir
                 ve takas OLMAMISTIR), duz gonderimde yalniz jetton (TON'da bounce:false,
                 zincirde dusecek eylem yok), dapp gonderiminde hic. -->
            <span v-if="burnsWarning" class="flex items-start gap-1 text-[10px] leading-tight text-amber-600 dark:text-amber-400 pt-1">
                {{ $t('send.confirmTransaction.tonFeeBurnsWarning') }}
            </span>
        </div>

        <!-- SERBEST ICERIK EKRANIN. `details` TON teklifinin quoteId/actionHash/seqno'su
             (component'te `tonFee.quote`a erisim yok, acik/kapali durumu da ekranin),
             `shortfall` eksik ATS bolumu (yedi prop'u ekranin computed'leri),
             `decision` yalniz Takas'ta kartin alt bolumune giren engel blogu. -->
        <slot name="details" />
        <slot name="shortfall" />
        <slot name="decision" />
    </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
    // i18n anahtarlari TAM YOL olarak gelir. Component hicbirini kendi turetmez:
    // turetseydi "tahmini/kesin" ve "iade var/yok" ayrimlari component'in ici bir
    // karar olurdu ve iki ekrandan birinde mutlaka yanlis duserdi.
    labelKey: { type: String, required: true },
    paidWithKey: { type: String, default: null },
    noRefundKey: { type: String, default: null },
    paidOnBscKey: { type: String, default: null },

    // Ekranda HAZIRLANMIS dize. `null` -> yukleniyor/bos kollari.
    amount: { type: String, default: null },
    // Kirpilmamis tam deger; yalnizca `title` icin. Bos ise oznitelik hic basilmaz.
    exact: { type: String, default: '' },
    usdText: { type: String, default: null },

    symbol: { type: String, default: 'ATS' },
    logoUri: { type: String, default: '' },

    showUpTo: { type: Boolean, default: false },
    burnsWarning: { type: Boolean, default: false },
    footerJoined: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
})

// CELISKI KAPISI, TEK YERDE. "en fazla" kullanilmayan kismin geri gelecegini,
// "iade edilmez" gelmeyecegini soyler. Ikisi birden cizilirse kart kendi kendini
// curutur -- ve bu daha once ekranda yasandi. Varsayilan guvenli taraftadir:
// eksik bir "en fazla" yalnizca fazla temkinlidir, fazladan bir "en fazla" var
// olmayan bir iade sozu verir.
const showUpToRow = computed(() => props.showUpTo && !props.noRefundKey)

const hasFooter = computed(() => Boolean(
    props.paidWithKey || props.noRefundKey || props.paidOnBscKey || props.burnsWarning
))
</script>
