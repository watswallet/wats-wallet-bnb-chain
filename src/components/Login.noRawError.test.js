import { it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

it('Login.vue catch ham err.message atamaz', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'Login.vue'), 'utf8')
    expect(src).not.toMatch(/error\.value\s*=\s*err\.message/)
})
