<template>
    <!-- EKSIK ATS. Varsayilan yer UCRET KARTININ ICI: anlattigi sey ucretin kendisiyle
         ayni konudur ("su kadar ATS kesilecek" / "su kadar ATS eksik"), ayri bir kart
         olunca kullanici ayni bilgiyi ekranda iki yerde ariyordu.

         Kart ici dal KENDI ZEMININI SERMEZ (asagidaki not), yalnizca bir ayrac + bosluk
         ekler; bu yuzden kartin dolgusuna BAGLI DEGILDIR. Send/Dapp kartlari p-3,
         takas ekranindaki iki ucret karti px-3 py-2.5 dolgulu - ikisinde de bolum
         kartin alt seridi gibi durur. (Eski surumde `-mx-3 -mb-3` ile dolgu tasiniyor
         ve "kart p-3 OLMAK ZORUNDA" kurali geciyordu; zemin kalkinca o sart da kalkti.)

         `standalone` yalnizca hicbir ucret karti cizilmediginde kullanilir (TON kolunda
         teklif dusmusse ucret karti yoktur ve bu bilgi yine de gorunmelidir).

         IKI DAL ARASINDAKI FARK BIR SUS DEGIL: kart icinde ustte ZATEN bir ATS tutari,
         bir ATS logosu ve (capraz-zincirde) "ucret BSC'deki bakiyenizden alinir" notu
         duruyor. Bolumun kendi kopyalarini basmasi, birlestirmenin cozdugu tekrari
         kartin icine tasimak olurdu. Kendi kartinda ustte HICBIRI yok; orada hepsi
         gerekli. -->
    <!-- KART ICINDE ZEMIN RENGI YOK. Dolu kirmizi bir blok kartin dibine yapistiginda
         ekranin en sert ogesi oluyordu -- ustelik anlattigi sey bir felaket degil, bir
         eksik. Hiyerarsi artik kartin KENDI ic ritminden geliyor: ucret notlariyla ayni
         ince ayrac, ayni bosluk; uyari tonunu yalniz TIPOGRAFI tasiyor. Ayri bir gorsel
         dil acilmamis oluyor -- kart uc katmanli tek bir yuzey.
         Kendi kartinda (standalone) zemin KALIR: orada bolum bir kartin icinde degil,
         ekrandaki diger hata kartlarinin yaninda duruyor ve onlarla ayni kabugu
         paylasmali. -->
    <div :class="standalone
        ? 'shrink-0 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl p-3 flex flex-col gap-2 transition-colors duration-300 shadow-sm dark:shadow-none'
        : 'flex flex-col gap-1.5 border-t border-slate-100 dark:border-white/5 pt-2 transition-colors duration-300'">

        <div class="flex items-baseline justify-between gap-2 min-w-0">
            <span :class="standalone
                ? 'text-xs text-red-600 dark:text-red-400 font-medium shrink-0 transition-colors duration-300'
                : 'text-[11px] text-rose-500 dark:text-rose-400 font-medium shrink-0 transition-colors duration-300'">{{ $t('send.confirmTransaction.atsShortfallLabel') }}</span>

            <!-- Mevcut bakiye kart icinde BASLIK SATIRINDA durur: kendi satirini hak
                 edecek kadar onemli degil ama "ne kadarim var" sorusu sorulmadan
                 cevaplanmali. Kendi kartinda asagidaki dokume birakilir.
                 NOTR renk BILEREK: bakiye bir hata degil, bir olgu. Kirmizi yazmak
                 kullanicinin bakiyesinde bir sorun varmis izlenimi verirdi. -->
            <span v-if="!standalone" class="text-[10px] text-slate-400 dark:text-zinc-500 tabular-nums truncate transition-colors duration-300">
                {{ $t('send.confirmTransaction.feeBalance') }} {{ balanceDisplay }} {{ symbol }}
            </span>
        </div>

        <!-- Kahraman sayi EKSIK MIKTARDIR, gereken toplam degil: kullanicinin borsada
             yapacagi is "su kadar daha al"dir. -->
        <div class="flex items-center gap-2 min-w-0">
            <!-- Logo YALNIZ kendi kartinda: kart icinde ayni logo hemen yukarida, ucret
                 tutarinin onunde duruyor ve ikinci kez basmak tek kartta iki para birimi
                 isareti demek. -->
            <img v-if="standalone && logoUri" :src="logoUri" :alt="symbol" class="w-5 h-5 rounded-full shrink-0 ring-1 ring-black/5 dark:ring-white/10 transition-colors duration-300" @error="e => { e.target.onerror = null; e.target.src = '/default-token.png' }">

            <!-- Tutar zeminsiz dalda TEK uyari sinyali: rengi bu yuzden yumusatilmis
                 ama silikleştirilmemis (rose, doymus kirmizi degil). Ucret tutariyla
                 AYNI boyutta durur -- ikisi ayni cinsten iki sayi. -->
            <div class="flex items-baseline gap-1.5 min-w-0" :title="exact">
                <span :class="standalone
                    ? 'text-lg leading-none font-bold text-red-700 dark:text-red-300 tabular-nums truncate transition-colors duration-300'
                    : 'text-lg leading-none font-bold text-rose-600 dark:text-rose-400 tabular-nums truncate transition-colors duration-300'">{{ amountDisplay }}</span>
                <span :class="standalone
                    ? 'text-xs font-bold text-red-600/80 dark:text-red-400 shrink-0 transition-colors duration-300'
                    : 'text-xs font-bold text-rose-500/70 dark:text-rose-400/70 shrink-0 transition-colors duration-300'">{{ symbol }}</span>
            </div>

            <!-- Dolar karsiligi ayni ailede, bir ton daha sessiz: buradaki sayi odenecek
                 bir ucret degil, TAMAMLANMASI GEREKEN tutar. Kosul kendi metnine bagli --
                 fiyat yoksa satir HIC cizilmez (sifirli bir dolar metni "bedava" demek olurdu). -->
            <span v-if="usdText" :class="standalone
                ? 'text-[11px] text-red-600 dark:text-red-300/80 tabular-nums shrink-0 transition-colors duration-300'
                : 'text-[11px] text-rose-500/70 dark:text-rose-400/60 tabular-nums shrink-0 transition-colors duration-300'">≈ ${{ usdText }}</span>
        </div>

        <!-- Tam dokum YALNIZ kendi kartinda. Kart icinde "Gereken X" hemen ustundeki
             ucret tutarinin TEKRARI olurdu; "ATS'niz BSC'de olmali" da ucret notunun
             (atsPaidOnBsc) tekrari. -->
        <div v-if="standalone" class="flex flex-col gap-1 border-t border-red-200 dark:border-red-500/20 pt-2 transition-colors duration-300">
            <span class="text-[10px] text-red-600 dark:text-red-300/80 transition-colors duration-300">
                {{ $t('send.confirmTransaction.atsShortfallBreakdown', { required: requiredDisplay, balance: balanceDisplay, symbol }) }}
            </span>
            <span class="text-[10px] text-red-600 dark:text-red-300/80 transition-colors duration-300">
                {{ $t('send.confirmTransaction.atsShortfallWhere', { symbol }) }}
            </span>
        </div>
    </div>
</template>

<script setup>
// Tek kaynak: ayni bolum UC yerde cizilir (ATS ucret karti, TON ucret karti ve
// -- ucret karti hic cizilmediginde -- kendi basina). Ucune ayri ayri yazilsaydi
// biri duzeltilip digerleri geride kalirdi; bu depoda ayni sinif ayrisma yasandi.
defineProps({
    symbol: { type: String, default: 'ATS' },
    logoUri: { type: String, default: '' },
    // Tam deger :title'da durur; ekrandaki sayi kompakttir.
    exact: { type: String, default: '' },
    amountDisplay: { type: String, default: '—' },
    usdText: { type: String, default: null },
    requiredDisplay: { type: String, default: '—' },
    balanceDisplay: { type: String, default: '—' },
    standalone: { type: Boolean, default: false },
})
</script>
