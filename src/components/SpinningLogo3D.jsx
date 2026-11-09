
import { Suspense, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, useTexture } from '@react-three/drei'
import {
  BackSide,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  LinearSRGBColorSpace,
  NeutralToneMapping,
  SRGBColorSpace,
  Vector2,
} from 'three'

// ---- Tunable constants ------------------------------------------------------

const LOGO_PATH = '/pandu-logo.svg'
const PLANE_SIZE = 4.8
const THICKNESS = 0.45
const VIEW_HALF = 3.1
const SPIN_SPEED = 0.35
const BG_THRESHOLD = 18
const EMBOSS_STRENGTH = 1.1
const HAS_TEXT = true
const FLIP_WINDOW = 0.2
const FLIP_MIN = 0.02

const BG_TOLERANCE = 24
const BORDER_MATCH_RATIO = 0.85
const ALPHA_OPAQUE_THRESHOLD = 128
const MIN_COMPONENT_RATIO = 0.005

// ---- Background removal -----------------------------------------------------

function detectSolidBackground(data, width, height) {
  const pixelAt = (x, y) => {
    const i = (y * width + x) * 4
    return { r: data[i], g: data[i + 1], b: data[i + 2] }
  }

  const border = []

  for (let x = 0; x < width; x++) {
    border.push(pixelAt(x, 0))
    border.push(pixelAt(x, height - 1))
  }

  for (let y = 1; y < height - 1; y++) {
    border.push(pixelAt(0, y))
    border.push(pixelAt(width - 1, y))
  }

  const median = (vals) =>
    [...vals].sort((a, b) => a - b)[Math.floor(vals.length / 2)]

  const bg = {
    r: median(border.map((p) => p.r)),
    g: median(border.map((p) => p.g)),
    b: median(border.map((p) => p.b)),
  }

  const diff = (p) =>
    Math.max(
      Math.abs(p.r - bg.r),
      Math.abs(p.g - bg.g),
      Math.abs(p.b - bg.b)
    )

  const matches = border.filter(
    (p) => diff(p) <= BG_TOLERANCE
  ).length

  return matches / border.length >= BORDER_MATCH_RATIO ? bg : null
}

function removeBackgroundFromEdges(
  data,
  width,
  height,
  bg,
  tolerance = BG_TOLERANCE
) {
  const n = width * height
  const removed = new Uint8Array(n)
  const visited = new Uint8Array(n)
  const stack = new Int32Array(n)
  let stackLen = 0

  const dist = (i) => {
    const o = i * 4
    return Math.max(
      Math.abs(data[o] - bg.r),
      Math.abs(data[o + 1] - bg.g),
      Math.abs(data[o + 2] - bg.b)
    )
  }

  const visit = (i) => {
    if (visited[i]) return

    visited[i] = 1

    if (dist(i) <= tolerance) {
      removed[i] = 1
      stack[stackLen++] = i
    }
  }

  for (let x = 0; x < width; x++) {
    visit(x)
    visit((height - 1) * width + x)
  }

  for (let y = 0; y < height; y++) {
    visit(y * width)
    visit(y * width + width - 1)
  }

  while (stackLen > 0) {
    const i = stack[--stackLen]
    const x = i % width
    const y = (i / width) | 0

    if (x > 0) visit(i - 1)
    if (x < width - 1) visit(i + 1)
    if (y > 0) visit(i - width)
    if (y < height - 1) visit(i + width)
  }

  for (let i = 0; i < n; i++) {
    const o = i * 4

    if (removed[i]) {
      data[o + 3] = 0
      continue
    }

    const x = i % width
    const y = (i / width) | 0

    const nearRemoved =
      (x > 0 && removed[i - 1] === 1) ||
      (x < width - 1 && removed[i + 1] === 1) ||
      (y > 0 && removed[i - width] === 1) ||
      (y < height - 1 && removed[i + width] === 1)

    if (!nearRemoved) continue

    const d = dist(i)

    if (d > tolerance && d < 2 * tolerance) {
      data[o + 3] = Math.round(
        data[o + 3] * ((d - tolerance) / tolerance)
      )
    }
  }
}

// ---- Components and contour tracing ----------------------------------------

function labelComponents(mask, width, height) {
  const n = width * height
  const labels = new Int32Array(n).fill(-1)
  const sizes = []
  const stack = new Int32Array(n)

  for (let start = 0; start < n; start++) {
    if (mask[start] !== 1 || labels[start] !== -1) continue

    const label = sizes.length
    let size = 0
    let stackLen = 0

    stack[stackLen++] = start
    labels[start] = label

    while (stackLen > 0) {
      const idx = stack[--stackLen]
      size++

      const x = idx % width
      const y = (idx / width) | 0

      if (
        x > 0 &&
        mask[idx - 1] === 1 &&
        labels[idx - 1] === -1
      ) {
        labels[idx - 1] = label
        stack[stackLen++] = idx - 1
      }

      if (
        x < width - 1 &&
        mask[idx + 1] === 1 &&
        labels[idx + 1] === -1
      ) {
        labels[idx + 1] = label
        stack[stackLen++] = idx + 1
      }

      if (
        y > 0 &&
        mask[idx - width] === 1 &&
        labels[idx - width] === -1
      ) {
        labels[idx - width] = label
        stack[stackLen++] = idx - width
      }

      if (
        y < height - 1 &&
        mask[idx + width] === 1 &&
        labels[idx + width] === -1
      ) {
        labels[idx + width] = label
        stack[stackLen++] = idx + width
      }
    }

    sizes.push(size)
  }

  return { labels, sizes }
}

function dropSmallSpecks(opaque, width, height) {
  const n = width * height
  const { labels, sizes } = labelComponents(
    opaque,
    width,
    height
  )

  const result = new Uint8Array(n)

  if (sizes.length === 0) return result

  const largestSize = Math.max(...sizes)
  const minSize = largestSize * MIN_COMPONENT_RATIO

  for (let i = 0; i < n; i++) {
    const label = labels[i]

    if (label !== -1 && sizes[label] >= minSize) {
      result[i] = 1
    }
  }

  return result
}

function clearDetachedSpecks(d, width, height) {
  const n = width * height
  const visible = new Uint8Array(n)

  for (let i = 0; i < n; i++) {
    visible[i] = d[i * 4 + 3] > 0 ? 1 : 0
  }

  const kept = dropSmallSpecks(visible, width, height)

  for (let i = 0; i < n; i++) {
    if (visible[i] && !kept[i]) {
      d[i * 4 + 3] = 0
    }
  }
}

const MOORE_DIRS = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
]

function mooreDirIndex(dx, dy) {
  for (let i = 0; i < 8; i++) {
    if (
      MOORE_DIRS[i][0] === dx &&
      MOORE_DIRS[i][1] === dy
    ) {
      return i
    }
  }

  return 0
}

function traceComponentBoundary(labels, width, height, label) {
  const n = width * height
  let startIdx = -1

  for (let i = 0; i < n; i++) {
    if (labels[i] === label) {
      startIdx = i
      break
    }
  }

  if (startIdx === -1) return []

  const startX = startIdx % width
  const startY = (startIdx / width) | 0

  const isFg = (x, y) =>
    x >= 0 &&
    x < width &&
    y >= 0 &&
    y < height &&
    labels[y * width + x] === label

  let hasNeighbour = false

  for (const [dx, dy] of MOORE_DIRS) {
    if (isFg(startX + dx, startY + dy)) {
      hasNeighbour = true
      break
    }
  }

  if (!hasNeighbour) {
    return [
      [startX, startY],
      [startX + 1, startY],
      [startX + 1, startY + 1],
      [startX, startY + 1],
    ]
  }

  const initialBacktrackX = startX - 1
  const initialBacktrackY = startY

  let cx = startX
  let cy = startY
  let bx = initialBacktrackX
  let by = initialBacktrackY

  const boundary = [[cx, cy]]
  const maxSteps = n * 4 + 16

  for (let step = 0; step < maxSteps; step++) {
    const startDir =
      (mooreDirIndex(bx - cx, by - cy) + 1) % 8

    let foundDir = -1
    let lastBgX = bx
    let lastBgY = by

    for (let k = 0; k < 8; k++) {
      const d = (startDir + k) % 8
      const nx = cx + MOORE_DIRS[d][0]
      const ny = cy + MOORE_DIRS[d][1]

      if (isFg(nx, ny)) {
        foundDir = d
        break
      }

      lastBgX = nx
      lastBgY = ny
    }

    if (foundDir === -1) break

    const nx = cx + MOORE_DIRS[foundDir][0]
    const ny = cy + MOORE_DIRS[foundDir][1]

    bx = lastBgX
    by = lastBgY
    cx = nx
    cy = ny

    if (
      cx === startX &&
      cy === startY &&
      bx === initialBacktrackX &&
      by === initialBacktrackY
    ) {
      break
    }

    boundary.push([cx, cy])
  }

  return boundary
}

function polygonPerimeter(pts) {
  let total = 0

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]

    total += Math.hypot(
      b[0] - a[0],
      b[1] - a[1]
    )
  }

  return total
}

function resampleByArcLength(pts, count) {
  const n = pts.length

  if (n < 2 || count < 1) return pts

  const total = polygonPerimeter(pts)
  if (total === 0) return pts

  const step = total / count
  const result = []

  let edgeIndex = 0
  let edgeStart = pts[0]
  let edgeEnd = pts[1 % n]

  let edgeLen = Math.hypot(
    edgeEnd[0] - edgeStart[0],
    edgeEnd[1] - edgeStart[1]
  )

  let accumulated = 0

  for (let i = 0; i < count; i++) {
    const target = i * step

    while (
      accumulated + edgeLen < target &&
      edgeIndex < n - 1
    ) {
      accumulated += edgeLen
      edgeIndex++

      edgeStart = pts[edgeIndex % n]
      edgeEnd = pts[(edgeIndex + 1) % n]

      edgeLen = Math.hypot(
        edgeEnd[0] - edgeStart[0],
        edgeEnd[1] - edgeStart[1]
      )
    }

    const t =
      edgeLen === 0
        ? 0
        : (target - accumulated) / edgeLen

    result.push([
      edgeStart[0] +
        (edgeEnd[0] - edgeStart[0]) * t,
      edgeStart[1] +
        (edgeEnd[1] - edgeStart[1]) * t,
    ])
  }

  return result
}

function smoothOutline(outline, iterations) {
  let pts = outline
  const n = pts.length

  if (n < 3) return pts

  for (let iter = 0; iter < iterations; iter++) {
    const next = []

    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n]
      const curr = pts[i]
      const nxt = pts[(i + 1) % n]

      next.push([
        curr[0] +
          0.5 * ((prev[0] + nxt[0]) / 2 - curr[0]),
        curr[1] +
          0.5 * ((prev[1] + nxt[1]) / 2 - curr[1]),
      ])
    }

    pts = next
  }

  return pts
}

function extractPerimeter(data, width, height) {
  const n = width * height
  const opaque = new Uint8Array(n)

  for (let i = 0; i < n; i++) {
    opaque[i] =
      data[i * 4 + 3] > ALPHA_OPAQUE_THRESHOLD ? 1 : 0
  }

  const mask = dropSmallSpecks(opaque, width, height)
  const { labels, sizes } = labelComponents(
    mask,
    width,
    height
  )

  if (sizes.length === 0) return []

  const loops = []

  for (let label = 0; label < sizes.length; label++) {
    const traced = traceComponentBoundary(
      labels,
      width,
      height,
      label
    )

    if (traced.length < 3) continue

    const targetCount = Math.max(
      200,
      Math.min(
        900,
        Math.round(polygonPerimeter(traced) / 3)
      )
    )

    const resampled = resampleByArcLength(
      traced,
      targetCount
    )

    const normalized = resampled.map(([px, py]) => [
      px / width - 0.5,
      0.5 - py / height,
    ])

    loops.push(smoothOutline(normalized, 5))
  }

  return loops
}

// ---- Rim geometry -----------------------------------------------------------

function buildRim(outlines, planeSize, thickness) {
  const half = thickness / 2
  const s = planeSize

  const positions = []
  const normals = []
  const indices = []

  let vertexOffset = 0

  for (const outline of outlines) {
    const n = outline.length
    if (n < 3) continue

    for (let i = 0; i < n; i++) {
      const prev = outline[(i - 1 + n) % n]
      const curr = outline[i]
      const next = outline[(i + 1) % n]

      const tx = next[0] - prev[0]
      const ty = next[1] - prev[1]

      const len = Math.sqrt(tx * tx + ty * ty) || 1

      const nx = ty / len
      const ny = -tx / len

      const x = curr[0] * s
      const y = curr[1] * s

      positions.push(x, y, half)
      normals.push(nx, ny, 0)

      positions.push(x, y, -half)
      normals.push(nx, ny, 0)
    }

    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n

      const f1 = vertexOffset + i * 2
      const b1 = vertexOffset + i * 2 + 1
      const f2 = vertexOffset + i2 * 2
      const b2 = vertexOffset + i2 * 2 + 1

      indices.push(f1, b1, f2)
      indices.push(b1, b2, f2)
    }

    vertexOffset += n * 2
  }

  const geo = new BufferGeometry()

  geo.setAttribute(
    'position',
    new Float32BufferAttribute(positions, 3)
  )

  geo.setAttribute(
    'normal',
    new Float32BufferAttribute(normals, 3)
  )

  geo.setIndex(indices)

  return geo
}

// ---- Textures + rim from the logo image -------------------------------------

function useLogoAssets() {
  const srcTexture = useTexture(LOGO_PATH)

  return useMemo(() => {
    const img = srcTexture.image

    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height

    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    const imageData = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    )

    const d = imageData.data

    const bg = detectSolidBackground(
      d,
      canvas.width,
      canvas.height
    )

    if (bg) {
      removeBackgroundFromEdges(
        d,
        canvas.width,
        canvas.height,
        bg
      )
    } else {
      for (let i = 0; i < d.length; i += 4) {
        const brightness =
          (d[i] + d[i + 1] + d[i + 2]) / 3

        if (brightness < BG_THRESHOLD) {
          d[i + 3] = 0
        }
      }
    }

    clearDetachedSpecks(d, canvas.width, canvas.height)
    ctx.putImageData(imageData, 0, 0)

    const colorTexture = new CanvasTexture(canvas)
    colorTexture.colorSpace = SRGBColorSpace
    colorTexture.anisotropy = 16

    // Normal map (Sobel on brightness)
    const w = canvas.width
    const h = canvas.height

    const normalCanvas = document.createElement('canvas')
    normalCanvas.width = w
    normalCanvas.height = h

    const nCtx = normalCanvas.getContext('2d')
    const normalData = nCtx.createImageData(w, h)
    const nd = normalData.data

    const bright = (x, y) => {
      const cx = Math.max(0, Math.min(w - 1, x))
      const cy = Math.max(0, Math.min(h - 1, y))

      const i = (cy * w + cx) * 4

      return (
        (d[i] + d[i + 1] + d[i + 2]) / 765
      )
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = bright(x + 1, y) - bright(x - 1, y)
        const dy = bright(x, y + 1) - bright(x, y - 1)

        const len = Math.sqrt(dx * dx + dy * dy + 1)
        const i = (y * w + x) * 4

        nd[i] = ((-dx / len) * 0.5 + 0.5) * 255
        nd[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255
        nd[i + 2] = ((1 / len) * 0.5 + 0.5) * 255
        nd[i + 3] = d[i + 3]
      }
    }

    nCtx.putImageData(normalData, 0, 0)

    const normalMap = new CanvasTexture(normalCanvas)
    normalMap.colorSpace = LinearSRGBColorSpace
    normalMap.anisotropy = 16

    const outlines = extractPerimeter(
      d,
      canvas.width,
      canvas.height
    )

    const rimGeometry = buildRim(
      outlines,
      PLANE_SIZE,
      THICKNESS
    )

    return {
      colorTexture,
      normalMap,
      rimGeometry,
    }
  }, [srcTexture])
}

// ---- Coin -------------------------------------------------------------------

function flipScale(yaw) {
  const s = Math.min(
    Math.max(Math.cos(yaw) / FLIP_WINDOW, -1),
    1
  )

  return s * (1.5 - 0.5 * s * s)
}

function Coin() {
  const groupRef = useRef(null)
  const facesRef = useRef(null)
  const rimRef = useRef(null)
  const angle = useRef(0)

  const {
    colorTexture,
    normalMap,
    rimGeometry,
  } = useLogoAssets()

  useFrame((_, delta) => {
    if (!groupRef.current) return

    angle.current += Math.min(delta, 0.1) * SPIN_SPEED

    const yaw = angle.current

    groupRef.current.rotation.y = yaw

    const faces = facesRef.current
    const rim = rimRef.current

    if (HAS_TEXT && faces && rim) {
      const m = flipScale(yaw)
      const width = Math.max(Math.abs(m), FLIP_MIN)

      faces.scale.x = width
      rim.scale.x = m < 0 ? -width : width
    }
  })

  const half = THICKNESS / 2

  const face = (side) => (
    <meshStandardMaterial
      map={colorTexture}
      normalMap={normalMap}
      normalScale={new Vector2(
        EMBOSS_STRENGTH,
        EMBOSS_STRENGTH
      )}
      metalness={0.15}
      roughness={0.35}
      envMapIntensity={0.4}
      side={side}
      transparent
      depthWrite={false}
    />
  )

  return (
    <group ref={groupRef}>
      <group ref={facesRef}>
        <mesh position={[0, 0, half]}>
          <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
          {face(FrontSide)}
        </mesh>

        <mesh
          position={[0, 0, -half]}
          scale={[HAS_TEXT ? -1 : 1, 1, 1]}
        >
          <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
          {face(BackSide)}
        </mesh>
      </group>

      <mesh ref={rimRef} geometry={rimGeometry}>
        <meshStandardMaterial
          color="#a5b4fc"
          metalness={0.95}
          roughness={0.26}
          emissive="#22d3ee"
          emissiveIntensity={0.12}
          envMapIntensity={1.5}
          side={DoubleSide}
        />
      </mesh>
    </group>
  )
}

// ---- Camera -----------------------------------------------------------------

function FitOrthoCamera() {
  const camera = useThree((s) => s.camera)
  const height = useThree((s) => s.size.height)

  useLayoutEffect(() => {
    camera.zoom = height / 2 / VIEW_HALF
    camera.updateProjectionMatrix()
  }, [camera, height])

  return null
}

// ---- Public component -------------------------------------------------------

export function SpinningLogo3D({ size = 50 }) {
  return (
    <div
      style={{ width: size, height: size }}
      className="mx-auto"
    >
      <Canvas
        orthographic
        camera={{
          position: [0, 0, 14],
          near: 0.1,
          far: 100,
        }}
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: true,
          toneMapping: NeutralToneMapping,
        }}
        dpr={[1, 2]}
      >
        <FitOrthoCamera />

        <ambientLight intensity={0.8} />

        <directionalLight
          position={[5, 5, 5]}
          intensity={2.5}
        />

        <directionalLight
          position={[-3, -2, 4]}
          intensity={0.8}
          color="#22d3ee"
        />

        <directionalLight
          position={[0, 0, -5]}
          intensity={0.5}
          color="#818cf8"
        />

        <Environment resolution={64}>
          <Lightformer
            form="rect"
            intensity={2}
            position={[0, 5, -4]}
            scale={[10, 4, 1]}
          />

          <Lightformer
            form="rect"
            intensity={1.5}
            position={[-5, 1, 2]}
            rotation-y={Math.PI / 2}
            scale={[8, 3, 1]}
          />

          <Lightformer
            form="rect"
            intensity={1.5}
            position={[5, 1, 2]}
            rotation-y={-Math.PI / 2}
            scale={[8, 3, 1]}
          />

          <Lightformer
            form="ring"
            intensity={1}
            color="#22d3ee"
            position={[0, 0, 6]}
            scale={4}
          />
        </Environment>

        <Suspense fallback={null}>
          <Coin />
        </Suspense>
      </Canvas>
    </div>
  )
}

export default SpinningLogo3D
