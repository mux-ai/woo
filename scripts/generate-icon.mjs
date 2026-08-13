import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const size = 1024
const pixels = Buffer.alloc((size * 4 + 1) * size)

function smooth(distance, halfWidth = 1.2) {
  return Math.max(0, Math.min(1, 0.5 - distance / (halfWidth * 2)))
}

function roundedBoxDistance(x, y, halfSize, radius) {
  const qx = Math.abs(x) - (halfSize - radius)
  const qy = Math.abs(y) - (halfSize - radius)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}

function diamondDistance(x, y, radius) {
  return (Math.abs(x) + Math.abs(y) - radius) / Math.SQRT2
}

for (let y = 0; y < size; y++) {
  const row = y * (size * 4 + 1)
  pixels[row] = 0
  for (let x = 0; x < size; x++) {
    const px = x + 0.5 - size / 2
    const py = y + 0.5 - size / 2
    const outerAlpha = smooth(roundedBoxDistance(px, py, 448, 224))
    const mix = (x + y) / (size * 2)
    let red = 9 + (88 - 9) * mix
    let green = 105 + (166 - 105) * mix
    let blue = 218 + (255 - 218) * mix

    const outerDiamond = Math.abs(diamondDistance(px, py, 584))
    const outerStroke = smooth(outerDiamond - 26)
    const innerDiamondDistance = diamondDistance(px, py, 316)
    const innerFill = smooth(innerDiamondDistance)
    const innerStroke = smooth(Math.abs(innerDiamondDistance) - 17)
    const darkOverlay = innerFill * 0.38
    red *= 1 - darkOverlay
    green *= 1 - darkOverlay
    blue *= 1 - darkOverlay

    const white = Math.max(outerStroke, innerStroke)
    red = red * (1 - white) + 255 * white
    green = green * (1 - white) + 255 * white
    blue = blue * (1 - white) + 255 * white

    const offset = row + 1 + x * 4
    pixels[offset] = Math.round(red)
    pixels[offset + 1] = Math.round(green)
    pixels[offset + 2] = Math.round(blue)
    pixels[offset + 3] = Math.round(outerAlpha * 255)
  }
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const value of buffer) crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const name = Buffer.from(type)
  const result = Buffer.alloc(12 + data.length)
  result.writeUInt32BE(data.length, 0)
  name.copy(result, 4)
  data.copy(result, 8)
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length)
  return result
}

const header = Buffer.alloc(13)
header.writeUInt32BE(size, 0)
header.writeUInt32BE(size, 4)
header[8] = 8
header[9] = 6
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(pixels, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const output = resolve(import.meta.dirname, '../build/icon.png')
mkdirSync(resolve(import.meta.dirname, '../build'), { recursive: true })
writeFileSync(output, png)
console.log(`Generated ${output}`)
