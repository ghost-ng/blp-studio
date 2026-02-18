import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'

// ---- Types ----

interface MeshData {
  positions: number[]
  indices: number[]
  normals: number[] | null
  uvs: number[] | null
  boneIndices: number[] | null
  boneWeights: number[] | null
  vertexCount: number
  triangleCount: number
  materialHash: number
  materialName: string
  skeletonIndex: number
}

interface MeshSkeleton {
  hash: number
  deformerStart: number
  deformerCount: number
}

interface MeshDeformer {
  nameHash: number
  transformIndex: number
  parent: number
  inverseBind: { position: number[]; scale: number; rotation: number[] }
}

interface ModelData {
  meshes: MeshData[]
  componentCount: number
  skeletons: MeshSkeleton[]
  deformers: MeshDeformer[]
  skeletonBlobName: string | null
}

interface SkeletonBone {
  index: number
  name: string
  parentIndex: number
  localPosition: number[]
  localRotation: number[]
  worldPosition: number[]
  worldRotation: number[]
}

interface ParsedSkeleton {
  boneCount: number
  bones: SkeletonBone[]
}

interface AnimKeyframe {
  rotation: number[]
  position: number[]
  scale: number[]
}

interface ParsedAnimation {
  fps: number
  frameCount: number
  boneCount: number
  duration: number
  name: string
  isV0: boolean
  isWorldSpace: boolean
  keyframes: AnimKeyframe[][] | null
}

interface MaterialMapEntry {
  diffuse?: string
  normal?: string
  orm?: string
}

interface ModelViewerProps {
  modelData: ModelData | null
  materialMap: Record<string, MaterialMapEntry> | null
}

// ---- Helpers ----

function colorFromHash(hash: number): THREE.Color {
  const r = ((hash >> 16) & 0xff) / 255
  const g = ((hash >> 8) & 0xff) / 255
  const b = (hash & 0xff) / 255
  const max = Math.max(r, g, b, 0.3)
  return new THREE.Color(r / max * 0.8, g / max * 0.8, b / max * 0.8)
}

function getBoneColor(name: string): [number, number, number] {
  const n = name.toLowerCase()
  if (n.includes('spine') || n.includes('pelvis') || n.includes('neck')) return [0.2, 0.9, 0.4]
  if (n.startsWith('l_')) return [1.0, 0.5, 0.2]
  if (n.startsWith('r_')) return [0.2, 0.7, 1.0]
  if (n.includes('head') || n.includes('eye') || n.includes('jaw')) return [1.0, 0.9, 0.3]
  if (n.includes('dress') || n.includes('attach')) return [0.8, 0.3, 0.8]
  return [0.4, 0.6, 1.0]
}

// ---- Texture helpers ----

async function fetchTextureAsDataTexture(textureName: string): Promise<THREE.DataTexture | null> {
  try {
    const resp = await fetch(`blp-preview://${encodeURIComponent(textureName)}`)
    if (!resp.ok) return null

    const buffer = await resp.arrayBuffer()
    const view = new DataView(buffer)
    const metaLen = view.getUint32(0, true)
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, metaLen)))

    if (meta.tooLarge || buffer.byteLength <= 4 + metaLen) return null

    const rgbaPixels = new Uint8Array(buffer, 4 + metaLen)
    const tex = new THREE.DataTexture(rgbaPixels, meta.width, meta.height, THREE.RGBAFormat)
    tex.needsUpdate = true
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.generateMipmaps = true
    tex.flipY = false
    return tex
  } catch (e) {
    console.warn(`Failed to fetch texture ${textureName}:`, e)
    return null
  }
}

// ---- Component ----

export function ModelViewer({ modelData, materialMap }: ModelViewerProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const animFrameRef = useRef<number>(0)
  const boneLineRef = useRef<THREE.LineSegments | null>(null)
  const jointMeshRef = useRef<THREE.InstancedMesh | null>(null)
  const worldPosPoolRef = useRef<THREE.Vector3[]>([])
  const worldQuatPoolRef = useRef<THREE.Quaternion[]>([])
  const animDummyRef = useRef(new THREE.Object3D())
  const tempVecRef = useRef(new THREE.Vector3())
  const tempQuatRef = useRef(new THREE.Quaternion())

  const meshRefsRef = useRef<THREE.Mesh[]>([])
  const textureCacheRef = useRef<Map<string, THREE.DataTexture>>(new Map())
  const texturedMatsRef = useRef<(THREE.Material | null)[]>([])  // textured materials per mesh (null = no texture available)
  const untexturedMatsRef = useRef<THREE.Material[]>([])          // color-hash fallback materials per mesh

  // Skinning data
  const modelDataRef = useRef<ModelData | null>(null)
  const restPositionsRef = useRef<Float32Array[]>([])
  const restNormalsRef = useRef<(Float32Array | null)[]>([])
  const inverseBindMatsRef = useRef<THREE.Matrix4[]>([])
  const skinMatPoolRef = useRef<THREE.Matrix4[]>([])
  const deformerBoneMapRef = useRef<number[]>([])
  const skinUnitScale = useRef(new THREE.Vector3(1, 1, 1))

  const modelScaleRef = useRef(1) // maxDim of model bbox, for scaling skeleton overlay

  const [loading, setLoading] = useState(true)
  const [wireframe, setWireframe] = useState(false)
  const [showTextures, setShowTextures] = useState(true)
  const showTexturesRef = useRef(true)
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [meshInfo, setMeshInfo] = useState('')

  // Animation state
  const [skeleton, setSkeleton] = useState<ParsedSkeleton | null>(null)
  const skeletonDataRef = useRef<ParsedSkeleton | null>(null)
  const [animations, setAnimations] = useState<{ name: string; size: number }[]>([])
  const [selectedAnim, setSelectedAnim] = useState<string | null>(null)
  const [animData, setAnimData] = useState<ParsedAnimation | null>(null)
  const animDataRef = useRef<ParsedAnimation | null>(null)
  const [animFrame, setAnimFrame] = useState(0)
  const animFrameStateRef = useRef(0)
  const [playing, setPlaying] = useState(false)
  const playingRef = useRef(false)
  const [animLoading, setAnimLoading] = useState(false)

  // Camera orbit (Z-up coordinate system)
  const isDraggingRef = useRef(false)
  const lastMouseRef = useRef({ x: 0, y: 0 })
  const orbitRef = useRef({ theta: Math.PI / 4, phi: Math.PI / 2.5, distance: 50, target: new THREE.Vector3(0, 0, 0) })
  const wireframeRef = useRef(false)

  // Keep modelDataRef in sync for use in callbacks
  useEffect(() => { modelDataRef.current = modelData }, [modelData])

  // Build 3D scene when model data loads
  useEffect(() => {
    if (!canvasRef.current || !modelData || modelData.meshes.length === 0) {
      if (modelData && modelData.meshes.length === 0) {
        setLoading(false)
        setMeshInfo('No mesh data found')
      }
      return
    }

    const container = canvasRef.current
    const width = container.clientWidth
    const height = container.clientHeight

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x1a1a2e)
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Scene
    const scene = new THREE.Scene()
    sceneRef.current = scene

    // Lighting (tuned for MeshStandardMaterial PBR + MeshPhongMaterial fallback)
    scene.add(new THREE.AmbientLight(0x606080, 1.5))
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5)
    dirLight.position.set(5, 5, 10)
    scene.add(dirLight)
    const dirLight2 = new THREE.DirectionalLight(0x8888ff, 0.5)
    dirLight2.position.set(-5, -3, -5)
    scene.add(dirLight2)

    // Camera (Z-up)
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000)
    cameraRef.current = camera

    // Build meshes
    const meshGroup = new THREE.Group()
    const bbox = new THREE.Box3()
    let totalVerts = 0
    let totalTris = 0
    const materials: THREE.Material[] = []
    const meshRefsList: THREE.Mesh[] = []
    const restPosList: Float32Array[] = []
    const restNorList: (Float32Array | null)[] = []

    for (const mesh of modelData.meshes) {
      const geometry = new THREE.BufferGeometry()
      const positions = new Float32Array(mesh.positions)
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const indices = new Uint32Array(mesh.indices)
      geometry.setIndex(new THREE.BufferAttribute(indices, 1))

      if (mesh.normals) {
        geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(mesh.normals), 3))
      } else {
        geometry.computeVertexNormals()
      }

      // Set UVs for texture mapping
      if (mesh.uvs) {
        geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(mesh.uvs), 2))
      }

      const color = colorFromHash(mesh.materialHash)
      const material = new THREE.MeshPhongMaterial({
        color,
        wireframe: wireframeRef.current,
        side: THREE.DoubleSide,
        flatShading: !mesh.normals,
      })
      materials.push(material)

      const threeMesh = new THREE.Mesh(geometry, material)
      meshGroup.add(threeMesh)
      meshRefsList.push(threeMesh)

      // Clone rest pose positions/normals for skinning
      restPosList.push(new Float32Array(positions))
      restNorList.push(mesh.normals ? new Float32Array(mesh.normals) : null)

      geometry.computeBoundingBox()
      if (geometry.boundingBox) bbox.union(geometry.boundingBox)
      totalVerts += mesh.vertexCount
      totalTris += mesh.triangleCount
    }

    meshRefsRef.current = meshRefsList
    restPositionsRef.current = restPosList
    restNormalsRef.current = restNorList
    scene.add(meshGroup)

    // Auto-fit camera
    const center = new THREE.Vector3()
    bbox.getCenter(center)
    const size = new THREE.Vector3()
    bbox.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z, 1)
    modelScaleRef.current = maxDim

    // FOV-based fit distance
    const radius = maxDim / 2
    const fovRad = 45 * (Math.PI / 180)
    const aspect = width / height
    const fovH = 2 * Math.atan(Math.tan(fovRad / 2) * aspect)
    const fitFov = Math.min(fovRad, fovH)
    const fitDistance = radius / Math.sin(fitFov / 2)

    orbitRef.current = {
      theta: Math.PI / 4,
      phi: Math.PI / 2.5,
      distance: fitDistance * 1.1,
      target: center.clone(),
    }

    // Grid (Z-up: rotate GridHelper which defaults to Y-up)
    const gridSize = Math.max(50, Math.ceil(maxDim * 3 / 50) * 50)
    const grid = new THREE.GridHelper(gridSize, gridSize / 10, 0x333355, 0x222244)
    grid.rotation.x = Math.PI / 2 // Z-up
    grid.position.z = bbox.min.z
    grid.position.x = center.x
    grid.position.y = center.y
    scene.add(grid)

    setMeshInfo(`${modelData.meshes.length} mesh${modelData.meshes.length > 1 ? 'es' : ''} | ${totalVerts.toLocaleString()} verts | ${totalTris.toLocaleString()} tris`)
    setLoading(false)

    // Camera update (Z-up spherical coordinates)
    function updateCamera() {
      const { theta, phi, distance, target } = orbitRef.current
      camera.position.set(
        target.x + distance * Math.sin(phi) * Math.cos(theta),
        target.y + distance * Math.sin(phi) * Math.sin(theta),
        target.z + distance * Math.cos(phi),
      )
      camera.up.set(0, 0, 1)
      camera.lookAt(target)
    }

    // Mouse handlers
    function onMouseDown(e: MouseEvent) {
      if (e.button === 0 || e.button === 2) {
        isDraggingRef.current = true
        lastMouseRef.current = { x: e.clientX, y: e.clientY }
      }
    }
    function onMouseMove(e: MouseEvent) {
      if (!isDraggingRef.current) return
      const dx = e.clientX - lastMouseRef.current.x
      const dy = e.clientY - lastMouseRef.current.y
      lastMouseRef.current = { x: e.clientX, y: e.clientY }

      if (e.buttons & 1) {
        // Left drag: orbit
        orbitRef.current.theta -= dx * 0.01
        orbitRef.current.phi = Math.max(0.1, Math.min(Math.PI - 0.1, orbitRef.current.phi - dy * 0.01))
      } else if (e.buttons & 2) {
        // Right drag: pan (XY plane + Z vertical)
        const cam = cameraRef.current
        if (!cam) return
        const right = new THREE.Vector3()
        const up = new THREE.Vector3()
        right.crossVectors(cam.up, new THREE.Vector3().subVectors(cam.position, orbitRef.current.target)).normalize()
        up.copy(cam.up)
        const panSpeed = orbitRef.current.distance * 0.002
        orbitRef.current.target.addScaledVector(right, dx * panSpeed)
        orbitRef.current.target.addScaledVector(up, -dy * panSpeed)
      }
    }
    function onMouseUp() { isDraggingRef.current = false }
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      orbitRef.current.distance *= 1 + e.deltaY * 0.001
      orbitRef.current.distance = Math.max(0.5, Math.min(10000, orbitRef.current.distance))
    }
    function onContextMenu(e: MouseEvent) { e.preventDefault() }

    const canvas = renderer.domElement
    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContextMenu)

    // Resize
    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w === 0 || h === 0) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    })
    resizeObserver.observe(container)

    // Render loop
    let cancelled = false
    function animate() {
      if (cancelled) return
      animFrameRef.current = requestAnimationFrame(animate)
      updateCamera()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelled = true
      cancelAnimationFrame(animFrameRef.current)
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContextMenu)
      resizeObserver.disconnect()

      materials.forEach(m => m.dispose())
      meshGroup.children.forEach(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          // Dispose current material if it was swapped (textured)
          if (child.material instanceof THREE.Material && !materials.includes(child.material)) {
            child.material.dispose()
          }
        }
      })
      // Dispose texture cache and stored materials
      for (const tex of textureCacheRef.current.values()) tex.dispose()
      textureCacheRef.current.clear()
      for (const mat of texturedMatsRef.current) { if (mat) mat.dispose() }
      texturedMatsRef.current = []
      untexturedMatsRef.current = [] // already disposed via materials.forEach above
      meshRefsRef.current = []
      restPositionsRef.current = []
      restNormalsRef.current = []
      grid.geometry.dispose()
      ;(grid.material as THREE.Material).dispose()
      renderer.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
    }
  }, [modelData])

  // Load skeleton + animations when in animation mode
  useEffect(() => {
    if (!modelData) return
    let mounted = true

    async function loadSkeleton() {
      try {
        // Use the exact skeleton blob identified by geometry component hash
        const skelName = modelData.skeletonBlobName
        if (!skelName) {
          console.warn('[ModelViewer] No skeleton blob name from geometry component')
          return
        }

        const skelData = await window.electronAPI.parseSkeleton(skelName)
        if (!mounted || !skelData) return

        setSkeleton(skelData as ParsedSkeleton)
        skeletonDataRef.current = skelData as ParsedSkeleton

        // Pre-allocate animation pools
        worldPosPoolRef.current = Array.from({ length: skelData.boneCount }, () => new THREE.Vector3())
        worldQuatPoolRef.current = Array.from({ length: skelData.boneCount }, () => new THREE.Quaternion())

        // Build skeleton overlay
        buildSkeletonOverlay(skelData as ParsedSkeleton)

        // Initialize skinning data (inverse bind matrices + deformer→bone mapping)
        if (modelData.deformers.length > 0) {
          const invBindMats: THREE.Matrix4[] = []
          const boneMap: number[] = []
          const skinPool: THREE.Matrix4[] = []

          for (let d = 0; d < modelData.deformers.length; d++) {
            const def = modelData.deformers[d]
            const ib = def.inverseBind

            // The "InverseBind" field in Civ7 BLP stores the BIND POSE (not its inverse).
            // Compose as bind pose matrix, then invert to get the actual inverse bind matrix.
            const mat = new THREE.Matrix4()
            mat.compose(
              new THREE.Vector3(ib.position[0], ib.position[1], ib.position[2]),
              new THREE.Quaternion(ib.rotation[1], ib.rotation[2], ib.rotation[3], ib.rotation[0]), // [s,i,j,k] → [x,y,z,w]
              new THREE.Vector3(ib.scale, ib.scale, ib.scale),
            )
            mat.invert()
            invBindMats.push(mat)
            boneMap.push(def.transformIndex)
            skinPool.push(new THREE.Matrix4())
          }

          inverseBindMatsRef.current = invBindMats
          deformerBoneMapRef.current = boneMap
          skinMatPoolRef.current = skinPool

          console.log(`[ModelViewer] Skinning initialized: ${invBindMats.length} deformers, ${modelData.skeletons.length} skeleton entries`)
        }

        // Load animation list
        const anims = await window.electronAPI.listAnimations(skelData.boneCount)
        if (!mounted) return
        setAnimations(anims)
      } catch (e) {
        console.error('Failed to load skeleton:', e)
      }
    }

    loadSkeleton()
    return () => { mounted = false }
  }, [modelData])

  // Build skeleton overlay (joints + bones)
  const buildSkeletonOverlay = useCallback((skel: ParsedSkeleton) => {
    const scene = sceneRef.current
    if (!scene) return

    // Remove old skeleton overlay
    if (boneLineRef.current) { scene.remove(boneLineRef.current); boneLineRef.current.geometry.dispose(); (boneLineRef.current.material as THREE.Material).dispose() }
    if (jointMeshRef.current) { scene.remove(jointMeshRef.current); jointMeshRef.current.geometry.dispose(); (jointMeshRef.current.material as THREE.Material).dispose() }

    // Bone lines
    const linePositions: number[] = []
    const lineColors: number[] = []
    for (let i = 0; i < skel.boneCount; i++) {
      const bone = skel.bones[i]
      if (bone.parentIndex >= 0 && bone.parentIndex < skel.boneCount) {
        const parent = skel.bones[bone.parentIndex]
        linePositions.push(parent.worldPosition[0], parent.worldPosition[1], parent.worldPosition[2])
        linePositions.push(bone.worldPosition[0], bone.worldPosition[1], bone.worldPosition[2])
        const color = getBoneColor(bone.name)
        lineColors.push(color[0], color[1], color[2])
        lineColors.push(color[0], color[1], color[2])
      }
    }

    const lineGeom = new THREE.BufferGeometry()
    lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3))
    lineGeom.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3))
    const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 1 })
    const lineSegs = new THREE.LineSegments(lineGeom, lineMat)
    scene.add(lineSegs)
    boneLineRef.current = lineSegs

    // Joint spheres (scale relative to model size)
    const jointRadius = modelScaleRef.current * 0.004
    const sphereGeom = new THREE.SphereGeometry(jointRadius, 8, 6)
    const sphereMat = new THREE.MeshPhongMaterial({ color: 0x44aaff, emissive: 0x112244 })
    const instancedMesh = new THREE.InstancedMesh(sphereGeom, sphereMat, skel.boneCount)
    const dummy = new THREE.Object3D()
    const instanceColors = new Float32Array(skel.boneCount * 3)

    for (let i = 0; i < skel.boneCount; i++) {
      const bone = skel.bones[i]
      dummy.position.set(bone.worldPosition[0], bone.worldPosition[1], bone.worldPosition[2])
      dummy.updateMatrix()
      instancedMesh.setMatrixAt(i, dummy.matrix)
      const color = getBoneColor(bone.name)
      instanceColors[i * 3] = color[0]
      instanceColors[i * 3 + 1] = color[1]
      instanceColors[i * 3 + 2] = color[2]
    }
    instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(instanceColors, 3)
    instancedMesh.instanceMatrix.needsUpdate = true
    scene.add(instancedMesh)
    jointMeshRef.current = instancedMesh
  }, [])

  // Load animation when selected
  useEffect(() => {
    if (!selectedAnim) {
      setAnimData(null)
      animDataRef.current = null
      setAnimFrame(0)
      setPlaying(false)
      // Reset skeleton to rest pose
      if (skeleton && boneLineRef.current && jointMeshRef.current) {
        resetToRestPose()
      }
      return
    }
    let mounted = true
    setAnimLoading(true)
    window.electronAPI.parseAnimation(selectedAnim).then(data => {
      if (!mounted) return
      setAnimLoading(false)
      if (data && data.keyframes) {
        setAnimData(data as ParsedAnimation)
        animDataRef.current = data as ParsedAnimation
        setAnimFrame(0)
        animFrameStateRef.current = 0
        setTimeout(() => applyAnimationFrame(0), 0)
      } else {
        setAnimData(null)
        animDataRef.current = null
      }
    })
    return () => { mounted = false }
  }, [selectedAnim])

  // Animation playback loop
  useEffect(() => {
    playingRef.current = playing
    if (!playing || !animDataRef.current?.keyframes) return

    let cancelled = false
    const anim = animDataRef.current
    const interval = 1000 / anim.fps
    let lastTime = performance.now()

    const tick = () => {
      if (cancelled || !playingRef.current) return
      const now = performance.now()
      if (now - lastTime >= interval) {
        lastTime = now
        const nextFrame = (animFrameStateRef.current + 1) % anim.frameCount
        animFrameStateRef.current = nextFrame
        setAnimFrame(nextFrame)
        applyAnimationFrame(nextFrame)
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)

    return () => { cancelled = true }
  }, [playing])

  // Apply animation keyframe (ported from SkeletonViewer)
  const applyAnimationFrame = useCallback((frame: number) => {
    const anim = animDataRef.current
    const skel = skeletonDataRef.current
    if (!anim?.keyframes || !skel || !boneLineRef.current || !jointMeshRef.current) return

    const frameData = anim.keyframes[frame]
    if (!frameData) return

    const wp = worldPosPoolRef.current
    const wq = worldQuatPoolRef.current
    if (wp.length < skel.boneCount) return

    if (anim.isWorldSpace) {
      // V1: world-space keyframes
      for (let i = 0; i < skel.boneCount; i++) {
        if (i < frameData.length) {
          const kf = frameData[i]
          wp[i].set(kf.position[0], kf.position[1], kf.position[2])
          wq[i].set(kf.rotation[1], kf.rotation[2], kf.rotation[3], kf.rotation[0]) // wxyz → xyzw
        } else {
          const bone = skel.bones[i]
          const pi = bone.parentIndex
          if (pi >= 0 && pi < skel.boneCount) {
            const parentBone = skel.bones[pi]
            const tmp = tempVecRef.current
            tmp.set(
              bone.worldPosition[0] - parentBone.worldPosition[0],
              bone.worldPosition[1] - parentBone.worldPosition[1],
              bone.worldPosition[2] - parentBone.worldPosition[2]
            )
            const restParentRot = tempQuatRef.current
            restParentRot.set(parentBone.worldRotation[0], parentBone.worldRotation[1], parentBone.worldRotation[2], parentBone.worldRotation[3])
            restParentRot.conjugate()
            tmp.applyQuaternion(restParentRot)
            tmp.applyQuaternion(wq[pi])
            wp[i].copy(wp[pi]).add(tmp)
            wq[i].set(bone.worldRotation[0], bone.worldRotation[1], bone.worldRotation[2], bone.worldRotation[3])
              .premultiply(restParentRot)
              .premultiply(wq[pi])
          } else {
            wp[i].set(bone.worldPosition[0], bone.worldPosition[1], bone.worldPosition[2])
            wq[i].set(bone.worldRotation[0], bone.worldRotation[1], bone.worldRotation[2], bone.worldRotation[3])
          }
        }
      }
    } else {
      // V0: local-space keyframes — chain through parents
      for (let i = 0; i < skel.boneCount; i++) {
        if (i < frameData.length) {
          const kf = frameData[i]
          wp[i].set(kf.position[0], kf.position[1], kf.position[2])
          wq[i].set(kf.rotation[1], kf.rotation[2], kf.rotation[3], kf.rotation[0])
          const pi = skel.bones[i].parentIndex
          if (pi >= 0 && pi < skel.boneCount) {
            const tmp = tempVecRef.current
            tmp.copy(wp[i]).applyQuaternion(wq[pi])
            wp[i].copy(wp[pi]).add(tmp)
            wq[i].premultiply(wq[pi])
          }
        } else {
          const bone = skel.bones[i]
          wp[i].set(bone.worldPosition[0], bone.worldPosition[1], bone.worldPosition[2])
          wq[i].set(bone.worldRotation[0], bone.worldRotation[1], bone.worldRotation[2], bone.worldRotation[3])
        }
      }
    }

    // Update bone lines
    const linePos = boneLineRef.current.geometry.getAttribute('position') as THREE.BufferAttribute
    let lineIdx = 0
    for (let i = 0; i < skel.boneCount; i++) {
      const bone = skel.bones[i]
      if (bone.parentIndex >= 0 && bone.parentIndex < skel.boneCount) {
        const parent = wp[bone.parentIndex]
        const child = wp[i]
        linePos.setXYZ(lineIdx++, parent.x, parent.y, parent.z)
        linePos.setXYZ(lineIdx++, child.x, child.y, child.z)
      }
    }
    linePos.needsUpdate = true

    // Update joint instances
    const dummy = animDummyRef.current
    for (let i = 0; i < skel.boneCount; i++) {
      dummy.position.copy(wp[i])
      dummy.updateMatrix()
      jointMeshRef.current!.setMatrixAt(i, dummy.matrix)
    }
    jointMeshRef.current.instanceMatrix.needsUpdate = true

    // ---- Vertex skinning ----
    const invBindMats = inverseBindMatsRef.current
    const skinMats = skinMatPoolRef.current
    const boneMap = deformerBoneMapRef.current
    const md = modelDataRef.current

    if (invBindMats.length > 0 && md) {
      const unitScale = skinUnitScale.current

      // Compute skin matrix for each deformer: boneWorld × inverseBind
      for (let d = 0; d < invBindMats.length; d++) {
        const boneIdx = boneMap[d]
        if (boneIdx >= 0 && boneIdx < skel.boneCount) {
          skinMats[d].compose(wp[boneIdx], wq[boneIdx], unitScale)
          skinMats[d].multiply(invBindMats[d])
        } else {
          skinMats[d].identity()
        }
      }

      // Apply skinning to each mesh (using per-mesh deformerStart from its skeleton entry)
      const meshRefs = meshRefsRef.current
      const restPositions = restPositionsRef.current
      const restNormals = restNormalsRef.current

      for (let mi = 0; mi < meshRefs.length && mi < md.meshes.length; mi++) {
        const meshData = md.meshes[mi]
        if (!meshData.boneIndices || !meshData.boneWeights) continue

        // Per-mesh deformerStart from the mesh's skeleton entry
        const skelEntry = md.skeletons[meshData.skeletonIndex]
        const deformerStart = skelEntry ? skelEntry.deformerStart : 0

        const geom = meshRefs[mi].geometry
        const posAttr = geom.getAttribute('position') as THREE.BufferAttribute
        const restPos = restPositions[mi]
        if (!restPos) continue

        const bi = meshData.boneIndices
        const bw = meshData.boneWeights
        const posArr = posAttr.array as Float32Array

        for (let v = 0; v < meshData.vertexCount; v++) {
          let sx = 0, sy = 0, sz = 0
          const rx = restPos[v * 3]
          const ry = restPos[v * 3 + 1]
          const rz = restPos[v * 3 + 2]

          for (let j = 0; j < 4; j++) {
            const w = bw[v * 4 + j]
            if (w < 0.001) continue
            const di = deformerStart + bi[v * 4 + j]
            if (di >= skinMats.length) continue
            const m = skinMats[di].elements
            // Transform: skinMatrix × vec4(restPos, 1)
            sx += w * (m[0] * rx + m[4] * ry + m[8] * rz + m[12])
            sy += w * (m[1] * rx + m[5] * ry + m[9] * rz + m[13])
            sz += w * (m[2] * rx + m[6] * ry + m[10] * rz + m[14])
          }

          posArr[v * 3] = sx
          posArr[v * 3 + 1] = sy
          posArr[v * 3 + 2] = sz
        }
        posAttr.needsUpdate = true

        // Skin normals (rotation only, no translation)
        const norAttr = geom.getAttribute('normal') as THREE.BufferAttribute | undefined
        const restNor = restNormals[mi]
        if (norAttr && restNor) {
          const norArr = norAttr.array as Float32Array
          for (let v = 0; v < meshData.vertexCount; v++) {
            let nx = 0, ny = 0, nz = 0
            const rnx = restNor[v * 3]
            const rny = restNor[v * 3 + 1]
            const rnz = restNor[v * 3 + 2]

            for (let j = 0; j < 4; j++) {
              const w = bw[v * 4 + j]
              if (w < 0.001) continue
              const di = deformerStart + bi[v * 4 + j]
              if (di >= skinMats.length) continue
              const m = skinMats[di].elements
              nx += w * (m[0] * rnx + m[4] * rny + m[8] * rnz)
              ny += w * (m[1] * rnx + m[5] * rny + m[9] * rnz)
              nz += w * (m[2] * rnx + m[6] * rny + m[10] * rnz)
            }

            const mag = Math.sqrt(nx * nx + ny * ny + nz * nz)
            if (mag > 0.001) {
              norArr[v * 3] = nx / mag
              norArr[v * 3 + 1] = ny / mag
              norArr[v * 3 + 2] = nz / mag
            }
          }
          norAttr.needsUpdate = true
        }
      }
    }
  }, [])

  // Reset skeleton to rest pose
  const resetToRestPose = useCallback(() => {
    const skel = skeletonDataRef.current
    if (!skel || !boneLineRef.current || !jointMeshRef.current) return

    const linePos = boneLineRef.current.geometry.getAttribute('position') as THREE.BufferAttribute
    let lineIdx = 0
    for (const bone of skel.bones) {
      if (bone.parentIndex >= 0 && bone.parentIndex < skel.boneCount) {
        const parent = skel.bones[bone.parentIndex]
        linePos.setXYZ(lineIdx++, parent.worldPosition[0], parent.worldPosition[1], parent.worldPosition[2])
        linePos.setXYZ(lineIdx++, bone.worldPosition[0], bone.worldPosition[1], bone.worldPosition[2])
      }
    }
    linePos.needsUpdate = true

    const dummy = animDummyRef.current
    for (let i = 0; i < skel.boneCount; i++) {
      const bone = skel.bones[i]
      dummy.position.set(bone.worldPosition[0], bone.worldPosition[1], bone.worldPosition[2])
      dummy.updateMatrix()
      jointMeshRef.current!.setMatrixAt(i, dummy.matrix)
    }
    jointMeshRef.current.instanceMatrix.needsUpdate = true

    // Restore mesh rest positions/normals
    const meshRefs = meshRefsRef.current
    const restPositions = restPositionsRef.current
    const restNormals = restNormalsRef.current
    for (let mi = 0; mi < meshRefs.length; mi++) {
      const geom = meshRefs[mi].geometry
      const posAttr = geom.getAttribute('position') as THREE.BufferAttribute
      const restPos = restPositions[mi]
      if (restPos) {
        (posAttr.array as Float32Array).set(restPos)
        posAttr.needsUpdate = true
      }
      const norAttr = geom.getAttribute('normal') as THREE.BufferAttribute | undefined
      const restNor = restNormals[mi]
      if (norAttr && restNor) {
        (norAttr.array as Float32Array).set(restNor)
        norAttr.needsUpdate = true
      }
    }
  }, [])

  // Toggle wireframe (apply to both active and stored materials)
  useEffect(() => {
    wireframeRef.current = wireframe
    // Apply to all active scene materials
    if (sceneRef.current) {
      sceneRef.current.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          const mat = obj.material
          if (mat instanceof THREE.MeshPhongMaterial || mat instanceof THREE.MeshStandardMaterial) {
            mat.wireframe = wireframe
          }
        }
      })
    }
    // Also update stored materials so toggling textures preserves wireframe state
    for (const mat of texturedMatsRef.current) {
      if (mat instanceof THREE.MeshStandardMaterial) mat.wireframe = wireframe
    }
    for (const mat of untexturedMatsRef.current) {
      if (mat instanceof THREE.MeshPhongMaterial) mat.wireframe = wireframe
    }
  }, [wireframe])

  // Apply textures when materialMap arrives
  useEffect(() => {
    if (!materialMap || !modelData || meshRefsRef.current.length === 0) return
    let cancelled = false

    async function loadAndApplyTextures() {
      const cache = textureCacheRef.current
      // Collect unique texture names to fetch
      const toFetch = new Set<string>()
      for (const entry of Object.values(materialMap!)) {
        if (entry.diffuse && !cache.has(entry.diffuse)) toFetch.add(entry.diffuse)
        if (entry.normal && !cache.has(entry.normal)) toFetch.add(entry.normal)
      }

      // Fetch all textures in parallel
      if (toFetch.size > 0) {
        await Promise.all([...toFetch].map(async name => {
          const tex = await fetchTextureAsDataTexture(name)
          if (tex && !cancelled) cache.set(name, tex)
        }))
      }
      if (cancelled) return

      // Build textured materials per mesh, store both variants
      const texturedMats: (THREE.Material | null)[] = []
      const untexturedMats: THREE.Material[] = []

      for (let i = 0; i < modelData!.meshes.length && i < meshRefsRef.current.length; i++) {
        const meshData = modelData!.meshes[i]
        const threeMesh = meshRefsRef.current[i]
        const matEntry = materialMap![meshData.materialName]

        // Keep the current (color-hash) material as untextured variant
        untexturedMats.push(threeMesh.material as THREE.Material)

        if (!matEntry) {
          texturedMats.push(null)
          continue
        }

        const diffuseTex = matEntry.diffuse ? cache.get(matEntry.diffuse) : undefined
        const normalTex = matEntry.normal ? cache.get(matEntry.normal) : undefined

        if (diffuseTex || normalTex) {
          const texMat = new THREE.MeshStandardMaterial({
            map: diffuseTex || null,
            normalMap: normalTex || null,
            side: THREE.DoubleSide,
            wireframe: wireframeRef.current,
          })
          texturedMats.push(texMat)
          // Apply textured material if textures are currently shown
          if (showTexturesRef.current) {
            threeMesh.material = texMat
          }
        } else {
          texturedMats.push(null)
        }
      }

      texturedMatsRef.current = texturedMats
      untexturedMatsRef.current = untexturedMats
    }

    loadAndApplyTextures()
    return () => { cancelled = true }
  }, [materialMap, modelData])

  // Toggle textures on/off
  useEffect(() => {
    showTexturesRef.current = showTextures
    const meshRefs = meshRefsRef.current
    const texturedMats = texturedMatsRef.current
    const untexturedMats = untexturedMatsRef.current
    if (meshRefs.length === 0 || untexturedMats.length === 0) return

    for (let i = 0; i < meshRefs.length; i++) {
      if (showTextures && texturedMats[i]) {
        meshRefs[i].material = texturedMats[i]!
      } else if (untexturedMats[i]) {
        meshRefs[i].material = untexturedMats[i]
      }
    }
  }, [showTextures])

  // Toggle skeleton visibility
  useEffect(() => {
    if (boneLineRef.current) boneLineRef.current.visible = showSkeleton
    if (jointMeshRef.current) jointMeshRef.current.visible = showSkeleton
  }, [showSkeleton])

  if (!modelData) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="text-lg mb-2">Loading 3D viewer...</div>
          <div className="text-sm">Parsing geometry from BLP</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col relative">
      {/* Toolbar */}
      <div className="h-8 flex items-center px-3 gap-3 bg-gray-800 border-b border-gray-700 text-xs text-gray-300 shrink-0">
        <span className="font-medium text-gray-100">3D Viewer</span>
        <span className="text-gray-500">|</span>
        <button
          className={`px-2 py-0.5 rounded ${wireframe ? 'bg-blue-600 text-white' : 'hover:bg-gray-700'}`}
          onClick={() => setWireframe(w => !w)}
        >
          Wireframe
        </button>
        <button
          className={`px-2 py-0.5 rounded ${showTextures ? 'bg-orange-600 text-white' : 'hover:bg-gray-700'}`}
          onClick={() => setShowTextures(t => !t)}
        >
          Textures
        </button>
        {skeleton && (
          <button
            className={`px-2 py-0.5 rounded ${showSkeleton ? 'bg-green-600 text-white' : 'hover:bg-gray-700'}`}
            onClick={() => setShowSkeleton(s => !s)}
          >
            Skeleton
          </button>
        )}
        <span className="text-gray-500">|</span>
        <span>{meshInfo}</span>
        {loading && <span className="text-yellow-400 ml-auto">Parsing...</span>}
      </div>

      {/* 3D viewport */}
      <div ref={canvasRef} className="flex-1" />

      {/* Animation controls (only in animation mode) */}
      {animations.length > 0 && (
        <div className="px-3 py-2 bg-gray-800 border-t border-gray-700 space-y-1 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Animation:</span>
            <select
              value={selectedAnim || ''}
              onChange={e => { setSelectedAnim(e.target.value || null); setPlaying(false) }}
              className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-300 max-w-sm"
            >
              <option value="">None (rest pose)</option>
              {animations.slice(0, 200).map(a => (
                <option key={a.name} value={a.name}>
                  {a.name.replace('BLOB_', '').replace(/^Exp1_/, '')}
                </option>
              ))}
              {animations.length > 200 && <option disabled>...{animations.length - 200} more</option>}
            </select>
            {animData && (
              <>
                <button
                  onClick={() => setPlaying(!playing)}
                  className="px-2 py-0.5 bg-blue-700 hover:bg-blue-600 rounded text-xs transition-colors"
                >
                  {playing ? 'Pause' : 'Play'}
                </button>
                <span className="text-[10px] text-gray-500 font-mono">
                  {animFrame}/{animData.frameCount} ({animData.fps}fps, {animData.duration.toFixed(1)}s)
                </span>
              </>
            )}
            {animLoading && <span className="text-xs text-gray-500">Loading...</span>}
          </div>
          {animData && (
            <input
              type="range"
              min={0}
              max={animData.frameCount - 1}
              value={animFrame}
              onChange={e => {
                const frame = parseInt(e.target.value)
                setAnimFrame(frame)
                animFrameStateRef.current = frame
                applyAnimationFrame(frame)
                setPlaying(false)
              }}
              className="w-full h-1 accent-blue-500"
            />
          )}
        </div>
      )}
    </div>
  )
}
