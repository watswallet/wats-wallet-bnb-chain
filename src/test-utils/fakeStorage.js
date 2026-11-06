import { vi } from 'vitest'

// chrome.storage.local seklinde sahte depo (get/set). `data` icerigi testlerin
// dogrudan okuyabilmesi icin disari acilir; get/set vi.fn oldugundan cagri
// sayilari ve argumanlari da dogrulanabilir. get/set chrome.storage gibi KOPYA
// doner/saklar: okunan nesneyi degistirmek depoyu degistirmez.
export function fakeStorage(initial) {
    const data = structuredClone({ ...initial })
    return {
        data,
        get: vi.fn(async (keys) => {
            const list = Array.isArray(keys) ? keys : [keys]
            return structuredClone(Object.fromEntries(list.map((k) => [k, data[k]])))
        }),
        set: vi.fn(async (obj) => { Object.assign(data, structuredClone(obj)) }),
    }
}
