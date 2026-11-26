// KAYMAK G2: tek sekme gostergesi (spec 7.2). Olcum kaydirma ICERIGI koordinatiyla (offsetLeft/offsetWidth)
// yapilir: satir yatay kaymisken de gosterge dogru yerde kalir. Yalniz transform/opacity yazilir.
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'

// Gostergenin CSS taban genisligi (`w-12`). w-px olsaydi rounded-t-full yaricapi 0,5 px'e kirpilirdi.
export const INDICATOR_BASE_PX = 48

export function measureIndicator(button) {
    if (!button) return null
    const x = Number(button.offsetLeft)
    const w = Number(button.offsetWidth)
    if (!Number.isFinite(x) || !Number.isFinite(w) || w <= 0) return null
    return { x, w }
}

export function indicatorStyle(m, animate) {
    if (!m) return { opacity: '0' }
    const s = Number((m.w / INDICATOR_BASE_PX).toFixed(4))
    const style = { transform: `translateX(${m.x}px) scaleX(${s})` }
    if (!animate) style.transition = 'none'
    return style
}

export function useTabIndicator({ rowRef, activeIndex }) {
    const style = ref(indicatorStyle(null, false))
    let observer = null
    let gozlenen = []

    const dugmeler = () => {
        const satir = rowRef.value
        if (!satir || typeof satir.querySelectorAll !== 'function') return []
        return Array.from(satir.querySelectorAll(':scope > button'))
    }

    const olc = (animate) => {
        const list = dugmeler()
        style.value = indicatorStyle(measureIndicator(list[activeIndex()] ?? null), animate)
    }

    const observe = () => {
        if (typeof ResizeObserver !== 'function' || !rowRef.value) return
        if (!observer) observer = new ResizeObserver(() => olc(false))
        const list = dugmeler()
        const ayni = list.length === gozlenen.length && list.every((b, i) => b === gozlenen[i])
        if (ayni) return
        observer.disconnect()
        observer.observe(rowRef.value)
        for (const b of list) observer.observe(b)
        gozlenen = list
    }

    function measure(opts = {}) {
        const animate = opts.animate === true
        if (!rowRef.value) return
        nextTick(() => {
            olc(animate)
            observe()
        })
    }

    onMounted(() => {
        if (!rowRef.value) return
        olc(false)
        observe()
    })

    onBeforeUnmount(() => {
        if (observer) observer.disconnect()
        observer = null
        gozlenen = []
    })

    return { style, measure }
}
