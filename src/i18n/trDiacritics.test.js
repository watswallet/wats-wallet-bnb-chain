import { describe, it, expect } from 'vitest'
import tr from './locales/tr.json'

const flat = []
;(function walk(o, p) {
  for (const k in o) {
    if (typeof o[k] === 'object' && o[k] !== null) walk(o[k], p + k + '.')
    else if (typeof o[k] === 'string') flat.push([p + k, o[k]])
  }
})(tr, '')

// Bilinen diakritigi dusmus Turkce kaliplar (ASCII'ye katlanmis).
const FOLDED = /\b(varlik|varligi|baska|aga|agda|agin|cuzdan|dogru|gecin|Lutfen|lutfen|baglanilamadi|baglantinizi|olustu|ucreti|dusuldukten|yuksek|buyuklukte|kullanilan|olculemedi|aktarilmis|baskasini|likidite icin|kaldiramiyor|azaltin|secin|gorunuyor|gondermeden|gonderilemez)\b/i

describe('tr.json diakritikleri', () => {
  it('katlanmis ASCII Turkce kalip yok', () => {
    const hits = flat.filter(([, v]) => FOLDED.test(v)).map(([k, v]) => `${k}: ${v}`)
    expect(hits).toEqual([])
  })
})
