<template>
  <div class="w-full">
    <canvas v-show="hasData" ref="chartCanvas"></canvas>
    <!-- Sembol fiyat sağlayıcısında yoksa boş bir tuval yerine bunu göster. -->
    <p v-if="!hasData" class="py-8 text-center text-xs text-slate-400 dark:text-zinc-600">
      {{ $t('token.noChartData') }}
    </p>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from "vue"
import { Chart, LineController, LineElement, PointElement, LinearScale, Title, CategoryScale, Tooltip, Legend, Filler } from "chart.js"
import { fetchPriceHistory } from "../utils/priceHistory"
import { configStore } from "../store/config"

// `id` = coingecko_id. Grafik eskiden `symbol` ile CryptoCompare'e gidiyordu; o uc nokta
// artik anahtarsiz 401 donduyor ve grafik HER token icin bostu. Kimlik uzerinden kendi
// backend'imize sorulmasinin ikinci faydasi: ayni sembolu tasiyan farkli tokenler
// (ornegin coklu "USDT" tureviyle) artik birbirinin fiyatini gostermez.
const props = defineProps(['id'])

const config = configStore()

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Title,
  Tooltip,
  Legend,
  Filler
)

const chartCanvas = ref(null)
const hasData = ref(true)
let chartInstance = null

// yardımcı: RGBA string üret (hex => rgba approximated)
// basitçe borderColor olarak verdiğimiz 'rgb(...)' formatlarını kullanacağım,
// eğer istersen hex->rgba çevirici ekleyebilirim.
function makeGradient(ctx, chartArea, colorRgbString) {
  // chartArea: {left, right, top, bottom}
  const height = chartArea.bottom - chartArea.top
  const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
  // Başta yarı saydam, sonda tamamen transparan
  gradient.addColorStop(0, colorRgbString.replace("rgb(", "rgba(").replace(")", ",0.45)"))
  gradient.addColorStop(0.6, colorRgbString.replace("rgb(", "rgba(").replace(")", ",0.15)"))
  gradient.addColorStop(1, colorRgbString.replace("rgb(", "rgba(").replace(")", ",0)"))
  return gradient
}

function rgbFromHex(hex) {
  // destek: #RRGGBB
  const h = hex.replace("#", "")
  const r = parseInt(h.substring(0,2),16)
  const g = parseInt(h.substring(2,4),16)
  const b = parseInt(h.substring(4,6),16)
  return `rgb(${r}, ${g}, ${b})`
}

async function loadChart() {
  const daily = await fetchPriceHistory(config.api, props.id, 30) // 1 Ay (günlük)

  // Veri yoksa grafik kurulmaz: boş bir grafik çizmeye çalışmak Chart.js içinde
  // ayrı hatalara yol açıyor.
  if (!daily.length) {
    hasData.value = false
    return
  }
  hasData.value = true
  // const weekly = await fetchData("BTC", 52, 7) // 1 Yıl (haftalık)
  // const monthly = await fetchData("BTC", 60, 30) // 5 Yıl (aylık)
  // const quarterly = await fetchData("BTC", 12, 90) // 3 Yıl (3 aylık)
  // const yearly = await fetchData("BTC", 10, 365) // 10 Yıl (yıllık)

  const labels = daily.map(d => d.date)

  const datasets = [
    {
      data: daily.map(d => d.close),
      borderColor: "#2b6cb0", // mavi
      backgroundColor: null, // sonradan gradient koyacağız
      fill: true,
      tension: 0.15,
      pointRadius: 0.8
    },
    // {
    //   label: "Haftalık (1 Yıl)",
    //   data: weekly.map(d => d.close).slice(-labels.length), // hizalama için slice (opsiyonel)
    //   borderColor: "#2f855a", // yeşil
    //   backgroundColor: null,
    //   fill: true,
    //   tension: 0.15,
    //   pointRadius: 0.8
    // },
    // {
    //   label: "Aylık (5 Yıl)",
    //   data: monthly.map(d => d.close).slice(-labels.length),
    //   borderColor: "#dd6b20", // turuncu
    //   backgroundColor: null,
    //   fill: true,
    //   tension: 0.15,
    //   pointRadius: 0.8
    // },
    // {
    //   label: "3 Aylık",
    //   data: quarterly.map(d => d.close).slice(-labels.length),
    //   borderColor: "#6b46c1", // mor
    //   backgroundColor: null,
    //   fill: true,
    //   tension: 0.15,
    //   pointRadius: 0.8
    // },
    // {
    //   label: "Yıllık",
    //   data: yearly.map(d => d.close).slice(-labels.length),
    //   borderColor: "#e53e3e", // kırmızı
    //   backgroundColor: null,
    //   fill: true,
    //   tension: 0.15,
    //   pointRadius: 0.8
    // }
  ]

  const ctx = chartCanvas.value.getContext("2d")

  if (chartInstance) chartInstance.destroy()

  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets
    },
options: {
  responsive: true,
  interaction: {
    mode: "index",
    intersect: false
  },
  plugins: {
    legend: {
      display: false
    },
    tooltip: {
      mode: "index",
      intersect: false
    }
  },
  scales: {
    x: {
      display: false // alt eksen gizlendi
    },
    y: {
      display: false // sol eksen gizlendi
    }
  }
}

  })

  // Gradient'leri oluştur (chartArea hazır olmalı)
  function applyGradients() {
    const chartArea = chartInstance.chartArea
    // chartArea boşsa (renderlanmamış) tekrar dene
    if (!chartArea || chartArea.right === 0) return

    chartInstance.data.datasets.forEach(ds => {
      // borderColor hex -> rgb
      const rgb = rgbFromHex(ds.borderColor || "#2b6cb0")
      ds.backgroundColor = makeGradient(chartInstance.ctx, chartArea, rgb)
    })

    chartInstance.update()
  }

  // İlk uygulama (kısa süre sonra chartArea doluyor)
  setTimeout(applyGradients, 50)

  // Yeniden boyutlandırma veya repaint gerektiğinde yeniden uygula
  const resizeObserver = new ResizeObserver(() => {
    applyGradients()
  })
  resizeObserver.observe(chartCanvas.value)

  // sakla cleanup için
  chartInstance.__resizeObserver = resizeObserver
}

onMounted(() => {
  // catch'siz birakildiginda yakalanmayan promise reddi olusuyor ve kullaniciya
  // hicbir sey gosterilmiyordu.
  loadChart().catch(e => {
    console.warn('Fiyat grafigi yuklenemedi:', e.message)
    hasData.value = false
  })
})

onBeforeUnmount(() => {
  if (chartInstance) {
    if (chartInstance.__resizeObserver) {
      chartInstance.__resizeObserver.disconnect()
    }
    chartInstance.destroy()
    chartInstance = null
  }
})
</script>
