const fs = require("fs")
const path = require("path")
const zlib = require("zlib")

const sizes = [16, 32, 48, 64, 128]
const root = path.resolve(__dirname, "..")
const scaleFactor = 4

function rgba(hex, alpha = 255) {
  const value = hex.replace("#", "")
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
    alpha
  ]
}

function makeCanvas(size) {
  const scale = size / 128
  const width = size * scaleFactor
  const height = size * scaleFactor
  return {
    width,
    height,
    scale: scale * scaleFactor,
    data: new Uint8ClampedArray(width * height * 4)
  }
}

function blendPixel(canvas, x, y, color) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return
  const index = (y * canvas.width + x) * 4
  const sourceAlpha = color[3] / 255
  const targetAlpha = canvas.data[index + 3] / 255
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha)
  if (outAlpha === 0) return

  canvas.data[index] = Math.round(
    (color[0] * sourceAlpha +
      canvas.data[index] * targetAlpha * (1 - sourceAlpha)) /
      outAlpha
  )
  canvas.data[index + 1] = Math.round(
    (color[1] * sourceAlpha +
      canvas.data[index + 1] * targetAlpha * (1 - sourceAlpha)) /
      outAlpha
  )
  canvas.data[index + 2] = Math.round(
    (color[2] * sourceAlpha +
      canvas.data[index + 2] * targetAlpha * (1 - sourceAlpha)) /
      outAlpha
  )
  canvas.data[index + 3] = Math.round(outAlpha * 255)
}

function toDevice(canvas, value) {
  return value * canvas.scale
}

function fillRoundedRect(canvas, x, y, width, height, radius, color) {
  const left = Math.floor(toDevice(canvas, x))
  const top = Math.floor(toDevice(canvas, y))
  const right = Math.ceil(toDevice(canvas, x + width))
  const bottom = Math.ceil(toDevice(canvas, y + height))
  const r = toDevice(canvas, radius)
  const cx1 = toDevice(canvas, x + radius)
  const cy1 = toDevice(canvas, y + radius)
  const cx2 = toDevice(canvas, x + width - radius)
  const cy2 = toDevice(canvas, y + height - radius)

  for (let py = top; py < bottom; py++) {
    for (let px = left; px < right; px++) {
      const nx = px + 0.5
      const ny = py + 0.5
      const dx = nx < cx1 ? cx1 - nx : nx > cx2 ? nx - cx2 : 0
      const dy = ny < cy1 ? cy1 - ny : ny > cy2 ? ny - cy2 : 0
      if (dx * dx + dy * dy <= r * r) blendPixel(canvas, px, py, color)
    }
  }
}

function fillCircle(canvas, x, y, radius, color) {
  const cx = toDevice(canvas, x)
  const cy = toDevice(canvas, y)
  const r = toDevice(canvas, radius)
  const left = Math.floor(cx - r)
  const right = Math.ceil(cx + r)
  const top = Math.floor(cy - r)
  const bottom = Math.ceil(cy + r)

  for (let py = top; py <= bottom; py++) {
    for (let px = left; px <= right; px++) {
      const dx = px + 0.5 - cx
      const dy = py + 0.5 - cy
      if (dx * dx + dy * dy <= r * r) blendPixel(canvas, px, py, color)
    }
  }
}

function strokeSegment(canvas, x1, y1, x2, y2, width, color) {
  const sx1 = toDevice(canvas, x1)
  const sy1 = toDevice(canvas, y1)
  const sx2 = toDevice(canvas, x2)
  const sy2 = toDevice(canvas, y2)
  const radius = toDevice(canvas, width / 2)
  const minX = Math.floor(Math.min(sx1, sx2) - radius)
  const maxX = Math.ceil(Math.max(sx1, sx2) + radius)
  const minY = Math.floor(Math.min(sy1, sy2) - radius)
  const maxY = Math.ceil(Math.max(sy1, sy2) + radius)
  const dx = sx2 - sx1
  const dy = sy2 - sy1
  const lengthSquared = dx * dx + dy * dy || 1

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const t = Math.max(
        0,
        Math.min(1, ((px + 0.5 - sx1) * dx + (py + 0.5 - sy1) * dy) / lengthSquared)
      )
      const nearestX = sx1 + t * dx
      const nearestY = sy1 + t * dy
      const distanceX = px + 0.5 - nearestX
      const distanceY = py + 0.5 - nearestY
      if (distanceX * distanceX + distanceY * distanceY <= radius * radius) {
        blendPixel(canvas, px, py, color)
      }
    }
  }
}

function strokePolyline(canvas, points, width, color) {
  for (let index = 0; index < points.length - 1; index++) {
    strokeSegment(
      canvas,
      points[index][0],
      points[index][1],
      points[index + 1][0],
      points[index + 1][1],
      width,
      color
    )
  }
  for (const [x, y] of points) fillCircle(canvas, x, y, width / 2, color)
}

function downsample(canvas, size) {
  const output = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const totals = [0, 0, 0, 0]
      for (let oy = 0; oy < scaleFactor; oy++) {
        for (let ox = 0; ox < scaleFactor; ox++) {
          const sourceIndex =
            ((y * scaleFactor + oy) * canvas.width + x * scaleFactor + ox) * 4
          totals[0] += canvas.data[sourceIndex]
          totals[1] += canvas.data[sourceIndex + 1]
          totals[2] += canvas.data[sourceIndex + 2]
          totals[3] += canvas.data[sourceIndex + 3]
        }
      }
      const targetIndex = (y * size + x) * 4
      output[targetIndex] = Math.round(totals[0] / 16)
      output[targetIndex + 1] = Math.round(totals[1] / 16)
      output[targetIndex + 2] = Math.round(totals[2] / 16)
      output[targetIndex + 3] = Math.round(totals[3] / 16)
    }
  }
  return output
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, crc])
}

function writePng(filePath, size, pixels) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1)
    raw[rowStart] = 0
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  fs.writeFileSync(
    filePath,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0))
    ])
  )
}

function drawIcon(size) {
  const canvas = makeCanvas(size)
  const forest = rgba("#26392F")
  const forestLight = rgba("#2F473B")
  const cream = rgba("#FFFAF0")
  const gold = rgba("#D6B56D")

  fillRoundedRect(canvas, 6, 6, 116, 116, 28, forest)
  fillRoundedRect(canvas, 13, 13, 102, 102, 24, forestLight)

  strokePolyline(canvas, [[34, 34], [34, 83], [60, 83]], 13, cream)
  strokePolyline(canvas, [[66, 34], [66, 83], [94, 83]], 13, cream)
  strokePolyline(canvas, [[60, 83], [78, 62], [94, 83]], 7, gold)

  fillCircle(canvas, 60, 83, 8, gold)
  fillCircle(canvas, 78, 62, 8, gold)
  fillCircle(canvas, 94, 83, 8, gold)
  fillCircle(canvas, 78, 62, 3.2, forest)

  strokePolyline(canvas, [[34, 34], [34, 83], [60, 83]], 5, cream)
  strokePolyline(canvas, [[66, 34], [66, 83], [94, 83]], 5, cream)

  return downsample(canvas, size)
}

for (const size of sizes) {
  writePng(path.join(root, "assets", `icon${size}.png`), size, drawIcon(size))
}

fs.copyFileSync(
  path.join(root, "assets", "icon128.png"),
  path.join(root, "assets", "icon.png")
)
