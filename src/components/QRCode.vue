<template>
  <div class="relative inline-block rounded">
    <canvas ref="qrCanvas" class="rounded-xl"></canvas>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from "vue"
import QRCode from "qrcode"

const props = defineProps({
  text: { type: String, required: true },
  logo: { type: String, required: true },
  size: { type: Number, default: 256 },
  logoSizeRatio: { type: Number, default: 0.38 }, // biraz daha büyük logo
  logoPaddingRatio: { type: Number, default: 0.10 }
})

const qrCanvas = ref(null)

const drawQR = async () => {
  const canvas = qrCanvas.value
  if (!canvas) return

  const ratio = window.devicePixelRatio || 1
  const finalSize = props.size * ratio

  canvas.width = finalSize
  canvas.height = finalSize
  canvas.style.width = props.size + "px"
  canvas.style.height = props.size + "px"

  // QR oluştur
  await QRCode.toCanvas(canvas, props.text, {
    width: finalSize,
    margin: 2,
    color: {
      dark: "#111827",   // modern koyu gri
      light: "#ffffff"
    }
  })

  const ctx = canvas.getContext("2d")
  ctx.imageSmoothingQuality = "high"

  // --- LOGO ALANI ---
  const logoImg = new Image()
  logoImg.crossOrigin = "anonymous"
  logoImg.src = props.logo

  logoImg.onload = () => {
    const totalLogoSize = finalSize * props.logoSizeRatio
    const padding = totalLogoSize * props.logoPaddingRatio
    const innerSize = totalLogoSize - padding * 2

    const scale = Math.min(
      innerSize / logoImg.width,
      innerSize / logoImg.height
    )

    const drawW = logoImg.width * scale
    const drawH = logoImg.height * scale

    const x = (finalSize - totalLogoSize) / 2
    const y = (finalSize - totalLogoSize) / 2

    // ▶ Daha hafif yuvarlatılmış kare çerçeve (ROUND DEĞİL, hafif!)
    ctx.shadowColor = "rgba(0,0,0,0.10)"
    ctx.shadowBlur = 15
    ctx.fillStyle = "#ffffff"
    ctx.beginPath()
    ctx.roundRect(x, y, totalLogoSize, totalLogoSize, 10 * ratio) // az yuvarlatılmış
    ctx.fill()

    // Shadow reset
    ctx.shadowBlur = 0

    // Logo ortalanmış şekilde çiz
    ctx.drawImage(
      logoImg,
      x + (totalLogoSize - drawW) / 2,
      y + (totalLogoSize - drawH) / 2,
      drawW,
      drawH
    )
  }
}

watch(() => [props.text, props.logo], drawQR, { immediate: true })
onMounted(drawQR)
</script>
