import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import * as THREE from 'three'

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

interface SkeletonViewerProps {
  assetName: string
  /** If provided, auto-select and play this animation on load */
  initialAnimation?: string
}

/** Shared color classification for bone body parts */
function getBoneColor(name: string): [number, number, number] {
  const n = name.toLowerCase()
  if (n.includes('spine') || n.includes('pelvis') || n.includes('neck')) return [0.2, 0.9, 0.4]
  if (n.startsWith('l_')) return [1.0, 0.5, 0.2]
  if (n.startsWith('r_')) return [0.2, 0.7, 1.0]
  if (n.includes('head') || n.includes('eye') || n.includes('jaw') || n.includes('lip') || n.includes('brow') || n.includes('cheek') || n.includes('tongue') || n.includes('nose')) return [1.0, 0.9, 0.3]
  if (n.includes('dress') || n.includes('attach')) return [0.8, 0.3, 0.8]
  return [0.4, 0.6, 1.0]
}

/**
 * Three.js-based skeleton viewer for Civ7 RootNode skeleton data.
 * Shows 3D bone hierarchy with optional animation playback.
 */
export function SkeletonViewer({ assetName, initialAnimation }: SkeletonViewerProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const animFrameRef = useRef<number>(0)
  const boneLineRef = useRef<THREE.LineSegments | null>(null)
  const jointMeshRef = useRef<THREE.InstancedMesh | null>(null)
  const skeletonDataRef = useRef<ParsedSkeleton | null>(null)
  // Pre-allocated arrays for animation frame updates (avoid GC pressure)
  const worldPosPoolRef = useRef<THREE.Vector3[]>([])
  const worldQuatPoolRef = useRef<THREE.Quaternion[]>([])
  const animDummyRef = useRef(new THREE.Object3D())
  const tempVecRef = useRef(new THREE.Vector3()) // temp for animation transform (avoids aliasing)
  const tempQuatRef = useRef(new THREE.Quaternion()) // temp for rest-pose rotation delta

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [skeleton, setSkeleton] = useState<ParsedSkeleton | null>(null)
  const [selectedBone, setSelectedBone] = useState<number | null>(null)
  const [showBoneList, setShowBoneList] = useState(false)

  // Animation state
  const [animations, setAnimations] = useState<{ name: string; size: number }[]>([])
  const [selectedAnim, setSelectedAnim] = useState<string | null>(null)
  const [animData, setAnimData] = useState<ParsedAnimation | null>(null)
  const [animFrame, setAnimFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [animLoading, setAnimLoading] = useState(false)
  const playingRef = useRef(false)
  const animDataRef = useRef<ParsedAnimation | null>(null)
  const animFrameStateRef = useRef(0)

  // Camera orbit
  const isDraggingRef = useRef(false)
  const lastMouseRef = useRef({ x: 0, y: 0 })
  const orbitRef = useRef({ theta: Math.PI / 4, phi: Math.PI / 3, distance: 300, target: new THREE.Vector3(0, 0, 100) })

  // Load skeleton data
  useEffect(() => {
    let mounted = true
    setLoading(true)
    setError(null)
    setSkeleton(null)
    setAnimations([])
    setSelectedAnim(null)
    setAnimData(null)
    setPlaying(false)

    window.electronAPI.parseSkeleton(assetName).then(data => {
      if (!mounted) return
      if (!data) {
        setError('Failed to parse skeleton data')
        setLoading(false)
        return
      }
      setSkeleton(data)
      skeletonDataRef.current = data
      setLoading(false)

      // Pre-allocate transform pools
      worldPosPoolRef.current = Array.from({ length: data.boneCount }, () => new THREE.Vector3())
      worldQuatPoolRef.current = Array.from({ length: data.boneCount }, () => new THREE.Quaternion())

      // Load available animations
      window.electronAPI.listAnimations(data.boneCount).catch(() => []).then(anims => {
        if (!mounted) return
        setAnimations(anims)
        // Auto-select initial animation if provided (e.g. clicked from asset tree)
        if (initialAnimation && anims.some(a => a.name === initialAnimation)) {
          setSelectedAnim(initialAnimation)
        }
      })
    })

    return () => { mounted = false }
  }, [assetName])

  // Build Three.js scene + mouse orbit (merged to avoid race condition)
  useEffect(() => {
    if (!skeleton || !canvasRef.current) return

    const container = canvasRef.current
    const width = container.clientWidth
    const height = container.clientHeight || 400

    // Create renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x1a1a2e, 1)
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer
    const canvas = renderer.domElement

    // Create scene
    const scene = new THREE.Scene()
    sceneRef.current = scene

    // Add lights
    scene.add(new THREE.AmbientLight(0x666688))
    const dirLight = new THREE.DirectionalLight(0xaaaacc, 0.8)
    dirLight.position.set(100, 100, 200)
    scene.add(dirLight)

    // Create camera
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 5000)
    cameraRef.current = camera

    // Build bone lines (parent → child connections)
    const linePositions: number[] = []
    const lineColors: number[] = []
    for (let i = 0; i < skeleton.boneCount; i++) {
      const bone = skeleton.bones[i]
      if (bone.parentIndex >= 0 && bone.parentIndex < skeleton.boneCount) {
        const parent = skeleton.bones[bone.parentIndex]
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

    // Joint spheres via InstancedMesh
    const sphereGeom = new THREE.SphereGeometry(1.2, 8, 6)
    const sphereMat = new THREE.MeshPhongMaterial({ color: 0x44aaff, emissive: 0x112244 })
    const instancedMesh = new THREE.InstancedMesh(sphereGeom, sphereMat, skeleton.boneCount)
    const dummy = new THREE.Object3D()
    const instanceColors = new Float32Array(skeleton.boneCount * 3)

    for (let i = 0; i < skeleton.boneCount; i++) {
      const bone = skeleton.bones[i]
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

    // Auto-frame camera to fit skeleton bounding sphere in viewport
    const bbox = new THREE.Box3()
    for (const bone of skeleton.bones) {
      bbox.expandByPoint(new THREE.Vector3(bone.worldPosition[0], bone.worldPosition[1], bone.worldPosition[2]))
    }
    const center = new THREE.Vector3()
    bbox.getCenter(center)
    const size = new THREE.Vector3()
    bbox.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z)

    // Add grid scaled to skeleton size
    const gridSize = Math.max(50, Math.ceil(maxDim * 2 / 50) * 50)
    const gridHelper = new THREE.GridHelper(gridSize, gridSize / 10, 0x333355, 0x222244)
    gridHelper.rotation.x = Math.PI / 2 // Z-up
    scene.add(gridHelper)

    // Calculate distance that fits the bounding sphere using camera FOV
    const radius = maxDim / 2
    const fovRad = 50 * (Math.PI / 180)
    const aspect = width / height
    const fovH = 2 * Math.atan(Math.tan(fovRad / 2) * aspect)
    const fitFov = Math.min(fovRad, fovH) // use the tighter axis
    const fitDistance = radius / Math.sin(fitFov / 2)

    orbitRef.current.target.copy(center)
    orbitRef.current.distance = fitDistance * 1.1 // 10% margin
    orbitRef.current.theta = Math.PI / 4    // 45° front-right 3/4 view
    orbitRef.current.phi = Math.PI / 2.5    // 72° slightly above eye level

    // Render loop
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate)
      const { theta, phi, distance, target } = orbitRef.current
      camera.position.set(
        target.x + distance * Math.sin(phi) * Math.cos(theta),
        target.y + distance * Math.sin(phi) * Math.sin(theta),
        target.z + distance * Math.cos(phi)
      )
      camera.up.set(0, 0, 1)
      camera.lookAt(target)
      renderer.render(scene, camera)
    }
    animate()

    // Resize observer
    const handleResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight || 400
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(container)

    // Mouse orbit handlers (inside same effect to guarantee canvas exists)
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0 || e.button === 2) {
        isDraggingRef.current = true
        lastMouseRef.current = { x: e.clientX, y: e.clientY }
      }
    }
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      const dx = e.clientX - lastMouseRef.current.x
      const dy = e.clientY - lastMouseRef.current.y
      lastMouseRef.current = { x: e.clientX, y: e.clientY }

      if (e.buttons & 1) {
        orbitRef.current.theta -= dx * 0.01
        orbitRef.current.phi = Math.max(0.1, Math.min(Math.PI - 0.1, orbitRef.current.phi - dy * 0.01))
      } else if (e.buttons & 2) {
        const cam = cameraRef.current
        if (!cam) return
        const right = new THREE.Vector3()
        const up = new THREE.Vector3()
        cam.getWorldDirection(new THREE.Vector3())
        right.crossVectors(cam.up, new THREE.Vector3().subVectors(cam.position, orbitRef.current.target)).normalize()
        up.copy(cam.up)
        const panSpeed = orbitRef.current.distance * 0.002
        orbitRef.current.target.addScaledVector(right, dx * panSpeed)
        orbitRef.current.target.addScaledVector(up, -dy * panSpeed)
      }
    }
    const onMouseUp = () => { isDraggingRef.current = false }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      orbitRef.current.distance *= 1 + e.deltaY * 0.001
      orbitRef.current.distance = Math.max(10, Math.min(5000, orbitRef.current.distance))
    }
    const onContextMenu = (e: MouseEvent) => { e.preventDefault() }

    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContextMenu)

    return () => {
      // Remove event listeners
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContextMenu)

      // Stop render loop + resize
      resizeObserver.disconnect()
      cancelAnimationFrame(animFrameRef.current)

      // Dispose Three.js resources
      lineGeom.dispose()
      lineMat.dispose()
      sphereGeom.dispose()
      sphereMat.dispose()
      instancedMesh.dispose()
      scene.clear()
      renderer.dispose()

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
      rendererRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      boneLineRef.current = null
      jointMeshRef.current = null
    }
  }, [skeleton])

  // Load animation data when selected
  useEffect(() => {
    if (!selectedAnim) {
      setAnimData(null)
      animDataRef.current = null
      setAnimFrame(0)
      setPlaying(false)
      return
    }
    let mounted = true
    setAnimLoading(true)
    setError(null) // Clear any previous error
    window.electronAPI.parseAnimation(selectedAnim).then(data => {
      if (!mounted) return
      setAnimLoading(false)
      if (data && data.keyframes) {
        setAnimData(data as ParsedAnimation)
        animDataRef.current = data as ParsedAnimation
        setAnimFrame(0)
        animFrameStateRef.current = 0
        // Apply frame 0 immediately so the skeleton shows the animation pose
        setTimeout(() => applyAnimationFrame(0), 0)
      } else {
        setAnimData(null)
        animDataRef.current = null
      }
    })
    return () => { mounted = false }
  }, [selectedAnim])

  // Animation playback loop (with proper cancellation)
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

  // Apply animation keyframe using pre-allocated buffers
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
      // V1: keyframes are already in world space — use directly
      for (let i = 0; i < skel.boneCount; i++) {
        if (i < frameData.length) {
          const kf = frameData[i]
          wp[i].set(kf.position[0], kf.position[1], kf.position[2])
          wq[i].set(kf.rotation[1], kf.rotation[2], kf.rotation[3], kf.rotation[0]) // wxyz → xyzw
        } else {
          // Bone not in animation — maintain rest-pose offset relative to animated parent
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
      // V0: keyframes are in local space — chain through parent hierarchy
      for (let i = 0; i < skel.boneCount; i++) {
        if (i < frameData.length) {
          const kf = frameData[i]
          wp[i].set(kf.position[0], kf.position[1], kf.position[2])
          wq[i].set(kf.rotation[1], kf.rotation[2], kf.rotation[3], kf.rotation[0]) // wxyz → xyzw

          const pi = skel.bones[i].parentIndex
          if (pi >= 0 && pi < skel.boneCount) {
            const tmp = tempVecRef.current
            tmp.copy(wp[i]).applyQuaternion(wq[pi])
            wp[i].copy(wp[pi]).add(tmp)
            wq[i].premultiply(wq[pi])
          }
        } else {
          // Non-animated bone: use rest-pose world position
          const bone = skel.bones[i]
          wp[i].set(bone.worldPosition[0], bone.worldPosition[1], bone.worldPosition[2])
          wq[i].set(bone.worldRotation[0], bone.worldRotation[1], bone.worldRotation[2], bone.worldRotation[3])
        }
      }
    }

    // Update line segments
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
  }, [])

  // Reset to rest pose when animation is cleared
  useEffect(() => {
    if (animData || !skeleton || !boneLineRef.current || !jointMeshRef.current) return

    const linePos = boneLineRef.current.geometry.getAttribute('position') as THREE.BufferAttribute
    let lineIdx = 0
    for (const bone of skeleton.bones) {
      if (bone.parentIndex >= 0 && bone.parentIndex < skeleton.boneCount) {
        const parent = skeleton.bones[bone.parentIndex]
        linePos.setXYZ(lineIdx++, parent.worldPosition[0], parent.worldPosition[1], parent.worldPosition[2])
        linePos.setXYZ(lineIdx++, bone.worldPosition[0], bone.worldPosition[1], bone.worldPosition[2])
      }
    }
    linePos.needsUpdate = true

    const dummy = animDummyRef.current
    for (let i = 0; i < skeleton.boneCount; i++) {
      const bone = skeleton.bones[i]
      dummy.position.set(bone.worldPosition[0], bone.worldPosition[1], bone.worldPosition[2])
      dummy.updateMatrix()
      jointMeshRef.current!.setMatrixAt(i, dummy.matrix)
    }
    jointMeshRef.current.instanceMatrix.needsUpdate = true
  }, [animData, skeleton])

  // Bone count summary
  const boneCategorySummary = useMemo(() => {
    if (!skeleton) return null
    let spine = 0, leftArm = 0, rightArm = 0, leftLeg = 0, rightLeg = 0, head = 0, other = 0
    for (const bone of skeleton.bones) {
      const n = bone.name.toLowerCase()
      if (n.includes('spine') || n.includes('pelvis') || n.includes('neck') || n === 'rootnode' || n === 'reference') spine++
      else if (n.startsWith('l_') && (n.includes('arm') || n.includes('elbow') || n.includes('hand') || n.includes('thumb') || n.includes('index') || n.includes('middle') || n.includes('ring') || n.includes('pinky') || n.includes('clav') || n.includes('pec') || n.includes('shoulder'))) leftArm++
      else if (n.startsWith('r_') && (n.includes('arm') || n.includes('elbow') || n.includes('hand') || n.includes('thumb') || n.includes('index') || n.includes('middle') || n.includes('ring') || n.includes('pinky') || n.includes('clav') || n.includes('pec') || n.includes('shoulder'))) rightArm++
      else if (n.startsWith('l_') && (n.includes('hip') || n.includes('knee') || n.includes('foot') || n.includes('toe') || n.includes('shin'))) leftLeg++
      else if (n.startsWith('r_') && (n.includes('hip') || n.includes('knee') || n.includes('foot') || n.includes('toe') || n.includes('shin'))) rightLeg++
      else if (n.includes('head') || n.includes('eye') || n.includes('jaw') || n.includes('lip') || n.includes('brow') || n.includes('cheek') || n.includes('tongue') || n.includes('nose')) head++
      else other++
    }
    return { spine, leftArm, rightArm, leftLeg, rightLeg, head, other }
  }, [skeleton])

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500 text-sm">Loading skeleton...</div>
  }
  if (error && !skeleton) {
    return <div className="flex items-center justify-center h-64 text-red-400 text-sm">{error}</div>
  }
  if (!skeleton) return null

  return (
    <div className="space-y-2 flex flex-col flex-1">
      {/* Info bar */}
      <div className="flex items-center gap-3 text-xs flex-wrap">
        <span className="text-gray-400">{skeleton.boneCount} bones</span>
        {boneCategorySummary && (
          <>
            <span className="text-green-400">{boneCategorySummary.spine} core</span>
            <span className="text-orange-400">{boneCategorySummary.leftArm} L.arm</span>
            <span className="text-blue-400">{boneCategorySummary.rightArm} R.arm</span>
            <span className="text-orange-300">{boneCategorySummary.leftLeg} L.leg</span>
            <span className="text-blue-300">{boneCategorySummary.rightLeg} R.leg</span>
            <span className="text-yellow-400">{boneCategorySummary.head} head</span>
            {boneCategorySummary.other > 0 && <span className="text-purple-400">{boneCategorySummary.other} other</span>}
          </>
        )}
        <button
          onClick={() => setShowBoneList(!showBoneList)}
          className="ml-auto px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 transition-colors"
        >
          {showBoneList ? 'Hide' : 'Show'} Bones
        </button>
      </div>

      {/* 3D viewport */}
      <div className="relative flex-1 min-h-[300px]">
        <div
          ref={canvasRef}
          className="w-full h-full rounded border border-gray-700 bg-[#1a1a2e]"
        />
        <div className="absolute bottom-2 left-2 text-[10px] text-gray-600 select-none">
          Left drag: orbit | Right drag: pan | Scroll: zoom
        </div>
      </div>

      {/* Animation controls */}
      {animations.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Animation:</span>
            <select
              value={selectedAnim || ''}
              onChange={e => { setSelectedAnim(e.target.value || null); setPlaying(false) }}
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-300 max-w-xs"
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
            {error && <span className="text-xs text-red-400">{error}</span>}
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

      {/* Bone list */}
      {showBoneList && (
        <div className="max-h-48 overflow-y-auto border border-gray-700 rounded bg-gray-900/50">
          <table className="w-full text-[10px] font-mono">
            <thead className="sticky top-0 bg-gray-800">
              <tr>
                <th className="text-left px-2 py-0.5 text-gray-500">#</th>
                <th className="text-left px-2 py-0.5 text-gray-500">Name</th>
                <th className="text-left px-2 py-0.5 text-gray-500">Parent</th>
                <th className="text-left px-2 py-0.5 text-gray-500">Position</th>
              </tr>
            </thead>
            <tbody>
              {skeleton.bones.map(bone => (
                <tr
                  key={bone.index}
                  className={`hover:bg-gray-800/50 cursor-pointer ${selectedBone === bone.index ? 'bg-blue-900/30' : ''}`}
                  onClick={() => setSelectedBone(bone.index === selectedBone ? null : bone.index)}
                >
                  <td className="px-2 py-0.5 text-gray-600">{bone.index}</td>
                  <td className="px-2 py-0.5 text-gray-300">{bone.name}</td>
                  <td className="px-2 py-0.5 text-gray-500">
                    {bone.parentIndex >= 0 ? skeleton.bones[bone.parentIndex]?.name || bone.parentIndex : '\u2014'}
                  </td>
                  <td className="px-2 py-0.5 text-gray-600">
                    [{bone.worldPosition.map(v => v.toFixed(1)).join(', ')}]
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
