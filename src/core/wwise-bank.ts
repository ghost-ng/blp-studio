/**
 * Wwise SoundBank (.bnk) parser
 *
 * Parses BKHD/DIDX/DATA/HIRC/STID sections from Wwise SoundBank files,
 * extracts embedded .wem audio files, and builds the Event→Action→Sound→FileID
 * hierarchy chain for associating audio with game content.
 *
 * Targets Wwise bank version 145 (Civ VII) with fallback for other versions.
 */

// ---- Interfaces ----

export interface WwiseBankInfo {
  bankVersion: number
  bankId: number
  sections: WwiseSection[]
  embeddedFiles: WwiseEmbeddedFile[]
  /** HIRC hierarchy data (null if no HIRC section present) */
  hirc: WwiseHircSummary | null
  /** STID string table entries (null if no STID section) */
  stid: WwiseStidEntry[] | null
  /**
   * Computed labels for each embedded fileId, derived from the HIRC chain.
   * Maps fileId → array of descriptive labels (e.g. event names, sound descriptions).
   */
  fileLabels: WwiseFileLabel[]
}

export interface WwiseSection {
  tag: string
  offset: number
  size: number
}

export interface WwiseEmbeddedFile {
  id: number
  offset: number  // absolute offset within the buffer (adjusted after parsing)
  size: number
}

export interface WwiseHircSummary {
  totalCount: number
  sounds: WwiseSound[]
  actions: WwiseAction[]
  events: WwiseEvent[]
  /** Count of HIRC objects by type (for types we don't fully parse) */
  otherTypeCounts: [number, number][]  // [type, count][]
}

export interface WwiseSound {
  id: number
  pluginId: number
  streamType: number   // 0=embedded, 1=prefetch, 2=streaming
  sourceId: number     // matches DIDX fileId for embedded audio
  inMemorySize: number // only meaningful for embedded/prefetch
}

export interface WwiseAction {
  id: number
  actionType: number   // high byte = type (4=Play), low byte = scope
  referenceId: number  // target Sound, Container, or Bus ID
}

export interface WwiseEvent {
  id: number
  actionIds: number[]
}

export interface WwiseStidEntry {
  id: number
  name: string
}

export interface WwiseFileLabel {
  fileId: number
  /** Event IDs that reference this file (through Action→Sound chain) */
  eventIds: number[]
  /** Human-readable labels (event hex IDs, resolved names if available) */
  labels: string[]
}

// ---- Action type helpers ----

/** Extract the base action type from a v62+ uint16 actionType */
function actionBaseType(actionType: number): number {
  return (actionType >> 8) & 0xFF
}

const ACTION_TYPE_NAMES: Record<number, string> = {
  0x00: 'None',
  0x01: 'Stop',
  0x02: 'Pause',
  0x03: 'Resume',
  0x04: 'Play',
  0x05: 'Trigger',
  0x06: 'Mute',
  0x07: 'UnMute',
  0x08: 'SetVoicePitch',
  0x09: 'ResetVoicePitch',
  0x0A: 'SetVoiceVolume',
  0x0B: 'ResetVoiceVolume',
  0x0C: 'SetBusVolume',
  0x0D: 'ResetBusVolume',
  0x19: 'SetState',
  0x1A: 'SetSwitch',
}

export function getActionTypeName(actionType: number): string {
  const base = actionBaseType(actionType)
  return ACTION_TYPE_NAMES[base] || `Unknown(0x${base.toString(16)})`
}

// ---- HIRC object type names ----

const HIRC_TYPE_NAMES: Record<number, string> = {
  0x01: 'Settings',
  0x02: 'Sound',
  0x03: 'Action',
  0x04: 'Event',
  0x05: 'RandomSeqContainer',
  0x06: 'SwitchContainer',
  0x07: 'ActorMixer',
  0x08: 'AudioBus',
  0x09: 'BlendContainer',
  0x0A: 'MusicSegment',
  0x0B: 'MusicTrack',
  0x0C: 'MusicSwitchContainer',
  0x0D: 'MusicPlaylistContainer',
  0x0E: 'Attenuation',
  0x0F: 'DialogueEvent',
  0x10: 'FeedbackBus',
  0x11: 'FeedbackNode',
  0x12: 'FxShareSet',
  0x13: 'FxCustom',
  0x14: 'AuxBus',
  0x15: 'LFO',
  0x16: 'Envelope',
  0x17: 'AudioDevice',
}

export function getHircTypeName(type: number): string {
  return HIRC_TYPE_NAMES[type] || `Unknown(0x${type.toString(16).padStart(2, '0')})`
}

// ---- FNV-1 hash (for future name resolution) ----

/**
 * FNV-1 32-bit hash, matching Wwise ShortID generation.
 * Input should be lowercase for event/bank name matching.
 */
export function fnv1Hash32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash = Math.imul(hash, 0x01000193)
    hash ^= input.charCodeAt(i)
  }
  return hash >>> 0
}

// ---- Internal logging ----

type LogFn = (msg: string) => void
let _log: LogFn = () => {}
let _warn: LogFn = () => {}

/** Attach external logger (call once from main process). */
export function setWwiseBankLogger(logFn: LogFn, warnFn: LogFn): void {
  _log = logFn
  _warn = warnFn
}

// ---- Main parser ----

/**
 * Parse a Wwise SoundBank buffer and return its full structure,
 * including HIRC hierarchy and STID string table.
 */
export function parseWwiseBank(data: Buffer | Uint8Array): WwiseBankInfo {
  const buf = data instanceof Buffer ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  let bankVersion = 0
  let bankId = 0
  const sections: WwiseSection[] = []
  const embeddedFiles: WwiseEmbeddedFile[] = []

  // Accumulated section ranges for targeted parsing
  let didxPayloadStart = -1
  let didxPayloadEnd = -1
  let dataOffset = -1
  let hircPayloadStart = -1
  let hircPayloadEnd = -1
  let stidPayloadStart = -1
  let stidPayloadEnd = -1

  // ---- Pass 1: Scan top-level sections ----
  let pos = 0
  while (pos + 8 <= buf.length) {
    const tag = String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3])
    const chunkSize = view.getUint32(pos + 4, true)

    // Validate tag: known names or uppercase 4-char
    if (!/^[A-Z]{4}$/.test(tag) && !['BKHD', 'DIDX', 'DATA', 'HIRC', 'STID', 'STMG', 'ENVS', 'FXPR'].includes(tag)) {
      _warn(`[wwise] unknown section tag at offset 0x${pos.toString(16)}: "${tag}", stopping scan`)
      break
    }

    // Sanity: chunkSize shouldn't exceed remaining buffer
    if (pos + 8 + chunkSize > buf.length) {
      _warn(`[wwise] section ${tag} at 0x${pos.toString(16)} claims size ${chunkSize} but only ${buf.length - pos - 8} bytes remain`)
      // Still record it, but clamp
      sections.push({ tag, offset: pos, size: Math.min(chunkSize, buf.length - pos - 8) })
      break
    }

    sections.push({ tag, offset: pos, size: chunkSize })

    const payloadStart = pos + 8
    const payloadEnd = payloadStart + chunkSize

    if (tag === 'BKHD' && payloadStart + 8 <= buf.length) {
      bankVersion = view.getUint32(payloadStart, true)
      bankId = view.getUint32(payloadStart + 4, true)
      _log(`[wwise] BKHD: version=${bankVersion}, bankId=0x${bankId.toString(16).toUpperCase()}`)
    } else if (tag === 'DIDX') {
      didxPayloadStart = payloadStart
      didxPayloadEnd = payloadEnd
    } else if (tag === 'DATA') {
      dataOffset = payloadStart
    } else if (tag === 'HIRC') {
      hircPayloadStart = payloadStart
      hircPayloadEnd = payloadEnd
    } else if (tag === 'STID') {
      stidPayloadStart = payloadStart
      stidPayloadEnd = payloadEnd
    }

    pos += 8 + chunkSize
  }

  // ---- Pass 2: Parse DIDX entries ----
  if (didxPayloadStart >= 0) {
    let p = didxPayloadStart
    while (p + 12 <= didxPayloadEnd) {
      const fileId = view.getUint32(p, true)
      const fileOffset = view.getUint32(p + 4, true)
      const fileSize = view.getUint32(p + 8, true)
      embeddedFiles.push({ id: fileId, offset: fileOffset, size: fileSize })
      p += 12
    }
    _log(`[wwise] DIDX: ${embeddedFiles.length} embedded files`)
  }

  // Adjust embedded file offsets to absolute positions
  if (dataOffset >= 0) {
    for (const file of embeddedFiles) {
      file.offset += dataOffset
    }
  }

  // ---- Pass 3: Parse STID ----
  const stid = parseStid(buf, view, stidPayloadStart, stidPayloadEnd)

  // ---- Pass 4: Parse HIRC ----
  const hirc = parseHirc(buf, view, hircPayloadStart, hircPayloadEnd, bankVersion)

  // ---- Pass 5: Build file labels from HIRC chain ----
  const fileLabels = buildFileLabels(hirc, embeddedFiles)

  return { bankVersion, bankId, sections, embeddedFiles, hirc, stid, fileLabels }
}

// ---- STID parser ----

function parseStid(
  buf: Buffer, view: DataView,
  start: number, end: number
): WwiseStidEntry[] | null {
  if (start < 0 || end <= start) return null

  const entries: WwiseStidEntry[] = []
  try {
    if (start + 8 > end) return entries

    const stringType = view.getUint32(start, true)
    const bankCount = view.getUint32(start + 4, true)
    _log(`[wwise] STID: stringType=${stringType}, bankCount=${bankCount}`)

    let p = start + 8
    for (let i = 0; i < bankCount && p < end; i++) {
      if (p + 5 > end) {
        _warn(`[wwise] STID: truncated at entry ${i}, offset 0x${p.toString(16)}`)
        break
      }
      const id = view.getUint32(p, true)
      const nameLen = buf[p + 4]
      p += 5
      if (p + nameLen > end) {
        _warn(`[wwise] STID: name length ${nameLen} exceeds remaining data at entry ${i}`)
        break
      }
      const name = buf.subarray(p, p + nameLen).toString('ascii')
      entries.push({ id, name })
      p += nameLen
    }

    _log(`[wwise] STID: parsed ${entries.length} entries${entries.length > 0 ? `: ${entries.map(e => e.name).join(', ')}` : ''}`)
  } catch (e) {
    _warn(`[wwise] STID parse error: ${e}`)
  }
  return entries
}

// ---- HIRC parser ----

function parseHirc(
  buf: Buffer, view: DataView,
  start: number, end: number,
  bankVersion: number
): WwiseHircSummary | null {
  if (start < 0 || end <= start) return null
  if (start + 4 > end) return null

  const totalCount = view.getUint32(start, true)
  _log(`[wwise] HIRC: ${totalCount} objects, bankVersion=${bankVersion}`)

  const sounds: WwiseSound[] = []
  const actions: WwiseAction[] = []
  const events: WwiseEvent[] = []
  const otherCounts = new Map<number, number>()

  let p = start + 4
  let parsed = 0
  let parseErrors = 0

  for (let i = 0; i < totalCount && p + 5 <= end; i++) {
    const objType = buf[p]
    const objSize = view.getUint32(p + 1, true)
    const objDataStart = p + 5  // after type(1) + size(4)
    const objDataEnd = objDataStart + objSize

    if (objDataEnd > end) {
      _warn(`[wwise] HIRC object ${i}: type=0x${objType.toString(16)}, size=${objSize} exceeds section bounds (offset 0x${p.toString(16)})`)
      break
    }

    // Object ID is always first 4 bytes of object data
    if (objSize < 4) {
      _warn(`[wwise] HIRC object ${i}: type=0x${objType.toString(16)}, size=${objSize} too small for ID`)
      p = objDataEnd
      continue
    }
    const objId = view.getUint32(objDataStart, true)

    try {
      switch (objType) {
        case 0x02: { // Sound (CAkSound)
          const sound = parseSound(view, objDataStart + 4, objDataEnd, objId, bankVersion)
          if (sound) {
            sounds.push(sound)
          } else {
            parseErrors++
          }
          break
        }
        case 0x03: { // Action (CAkAction)
          const action = parseAction(view, objDataStart + 4, objDataEnd, objId, bankVersion)
          if (action) {
            actions.push(action)
          } else {
            parseErrors++
          }
          break
        }
        case 0x04: { // Event (CAkEvent)
          const event = parseEvent(view, objDataStart + 4, objDataEnd, objId, bankVersion)
          if (event) {
            events.push(event)
          } else {
            parseErrors++
          }
          break
        }
        default: {
          otherCounts.set(objType, (otherCounts.get(objType) || 0) + 1)
          break
        }
      }
    } catch (e) {
      _warn(`[wwise] HIRC object ${i}: type=0x${objType.toString(16)} id=0x${objId.toString(16)} parse error: ${e}`)
      parseErrors++
    }

    parsed++
    p = objDataEnd
  }

  const otherTypeCounts = Array.from(otherCounts.entries()).sort((a, b) => a[0] - b[0]) as [number, number][]

  _log(`[wwise] HIRC parsed: ${sounds.length} sounds, ${actions.length} actions, ${events.length} events, ${otherTypeCounts.length} other types, ${parseErrors} errors`)

  if (sounds.length > 0) {
    const embedded = sounds.filter(s => s.streamType === 0)
    const prefetch = sounds.filter(s => s.streamType === 1)
    const streamed = sounds.filter(s => s.streamType === 2)
    _log(`[wwise]   sounds: ${embedded.length} embedded, ${prefetch.length} prefetch, ${streamed.length} streamed`)
  }

  return { totalCount, sounds, actions, events, otherTypeCounts }
}

// ---- Sound (type 0x02) parser ----
// Layout for v90+ (Civ VII is v145):
//   AkBankSourceData:
//     [0..3]  pluginId (uint32)
//     [4]     streamType (uint8): 0=embedded, 1=prefetch, 2=streaming
//     AkMediaInformation:
//       [5..8]  sourceId (uint32) - matches DIDX fileId for embedded
//       IF streamType == 0 or 1 (has in-memory data):
//         [9..12]  inMemoryMediaSize (uint32)
//         [13]     sourceBits (uint8)
//       IF streamType == 2 (streamed, no in-memory data):
//         [9]      sourceBits (uint8)

function parseSound(
  view: DataView, dataStart: number, dataEnd: number,
  id: number, bankVersion: number
): WwiseSound | null {
  const available = dataEnd - dataStart
  if (available < 9) {
    _warn(`[wwise] Sound 0x${id.toString(16)}: only ${available} bytes, need ≥9`)
    return null
  }

  const pluginId = view.getUint32(dataStart, true)

  let streamType: number
  let sourceId: number
  let inMemorySize = 0

  if (bankVersion >= 90) {
    // Modern layout: uint8 streamType
    streamType = view.getUint8(dataStart + 4)
    sourceId = view.getUint32(dataStart + 5, true)
    if ((streamType === 0 || streamType === 1) && available >= 13) {
      inMemorySize = view.getUint32(dataStart + 9, true)
    }
  } else {
    // Legacy layout: uint32 streamType
    if (available < 12) {
      _warn(`[wwise] Sound 0x${id.toString(16)}: legacy layout needs ≥12 bytes, got ${available}`)
      return null
    }
    streamType = view.getUint32(dataStart + 4, true)
    sourceId = view.getUint32(dataStart + 8, true)
  }

  // Validate streamType range
  if (streamType > 2) {
    _warn(`[wwise] Sound 0x${id.toString(16)}: unexpected streamType=${streamType}`)
  }

  return { id, pluginId, streamType, sourceId, inMemorySize }
}

// ---- Action (type 0x03) parser ----
// Layout for v62+ (Civ VII is v145):
//   [0..1]  actionType (uint16 LE): high byte = type, low byte = scope
//   [2..5]  referenceId (uint32): target object ID
//   [6]     padding/zero (uint8)

function parseAction(
  view: DataView, dataStart: number, dataEnd: number,
  id: number, bankVersion: number
): WwiseAction | null {
  const available = dataEnd - dataStart

  let actionType: number
  let referenceId: number

  if (bankVersion >= 62) {
    // Modern: uint16 actionType
    if (available < 6) {
      _warn(`[wwise] Action 0x${id.toString(16)}: only ${available} bytes, need ≥6`)
      return null
    }
    actionType = view.getUint16(dataStart, true)
    referenceId = view.getUint32(dataStart + 2, true)
  } else {
    // Legacy: uint8 scope + uint8 type
    if (available < 6) {
      _warn(`[wwise] Action 0x${id.toString(16)}: only ${available} bytes, need ≥6`)
      return null
    }
    const scope = view.getUint8(dataStart)
    const type = view.getUint8(dataStart + 1)
    actionType = (type << 8) | scope  // normalize to same format as modern
    referenceId = view.getUint32(dataStart + 2, true)
  }

  return { id, actionType, referenceId }
}

// ---- Event (type 0x04) parser ----
// Layout for v125+ (Civ VII is v145):
//   [0]     actionCount (uint8 compact)
//   [1..]   actionIds (uint32[] × actionCount)
// Layout for v122-:
//   [0..3]  actionCount (uint32)
//   [4..]   actionIds (uint32[] × actionCount)

function parseEvent(
  view: DataView, dataStart: number, dataEnd: number,
  id: number, bankVersion: number
): WwiseEvent | null {
  const available = dataEnd - dataStart

  let actionCount: number
  let idsStart: number

  if (bankVersion >= 125) {
    // Compact: uint8 count
    if (available < 1) return null
    actionCount = view.getUint8(dataStart)
    idsStart = dataStart + 1
  } else {
    // Legacy: uint32 count
    if (available < 4) return null
    actionCount = view.getUint32(dataStart, true)
    idsStart = dataStart + 4
  }

  // Sanity: reasonable count
  if (actionCount > 256) {
    _warn(`[wwise] Event 0x${id.toString(16)}: suspicious actionCount=${actionCount}, likely parse error`)
    return null
  }

  const bytesNeeded = actionCount * 4
  if (idsStart + bytesNeeded > dataEnd) {
    _warn(`[wwise] Event 0x${id.toString(16)}: actionCount=${actionCount} requires ${bytesNeeded} bytes but only ${dataEnd - idsStart} available`)
    return null
  }

  const actionIds: number[] = []
  for (let i = 0; i < actionCount; i++) {
    actionIds.push(view.getUint32(idsStart + i * 4, true))
  }

  return { id, actionIds }
}

// ---- Chain resolution: build file labels ----

function buildFileLabels(
  hirc: WwiseHircSummary | null,
  embeddedFiles: WwiseEmbeddedFile[]
): WwiseFileLabel[] {
  if (!hirc || embeddedFiles.length === 0) return []

  // Index: soundId → Sound object
  const soundById = new Map<number, WwiseSound>()
  for (const s of hirc.sounds) {
    soundById.set(s.id, s)
  }

  // Index: sourceId → soundId (for embedded sounds matching DIDX entries)
  const sourceToSound = new Map<number, number>()
  const fileIdSet = new Set(embeddedFiles.map(f => f.id))
  for (const s of hirc.sounds) {
    if (s.streamType === 0 && fileIdSet.has(s.sourceId)) {
      sourceToSound.set(s.sourceId, s.id)
    }
  }

  // Index: actionId → Action object
  const actionById = new Map<number, WwiseAction>()
  for (const a of hirc.actions) {
    actionById.set(a.id, a)
  }

  // Resolve: for each Action that is a Play action, find which sourceIds it reaches
  // Action.referenceId → Sound.id → Sound.sourceId (= DIDX fileId)
  // Also handle: Action.referenceId → Container (not a Sound) — brute-force scan later
  const actionToFileIds = new Map<number, number[]>()
  for (const a of hirc.actions) {
    const baseType = actionBaseType(a.actionType)
    if (baseType !== 0x04) continue // Only care about Play actions for labeling

    const fileIds: number[] = []

    // Direct: referenceId is a Sound
    const sound = soundById.get(a.referenceId)
    if (sound && sound.streamType === 0 && fileIdSet.has(sound.sourceId)) {
      fileIds.push(sound.sourceId)
    }

    // Indirect: referenceId might be a container. Scan all sounds whose
    // data might reference this container as parent. This is a heuristic —
    // proper container parsing would require NodeBaseParams.DirectParentID
    // which is deeply version-dependent. Instead, we check if any Sound's
    // sourceId matches and the sound isn't already claimed by a direct action.
    // (Containers are types 5/6/7/9 — we don't parse them but can still find
    //  sounds that belong to them by brute-force matching.)

    if (fileIds.length > 0) {
      actionToFileIds.set(a.id, fileIds)
    }
  }

  // Build: Event → Action → fileIds
  const fileToEvents = new Map<number, Set<number>>()  // fileId → Set<eventId>

  for (const evt of hirc.events) {
    for (const actionId of evt.actionIds) {
      const fileIds = actionToFileIds.get(actionId)
      if (fileIds) {
        for (const fid of fileIds) {
          if (!fileToEvents.has(fid)) fileToEvents.set(fid, new Set())
          fileToEvents.get(fid)!.add(evt.id)
        }
      }
    }
  }

  // Also: for sounds that have no event chain, provide Sound ID as fallback label
  const soundLabelledFiles = new Set<number>()
  for (const fids of actionToFileIds.values()) {
    for (const f of fids) soundLabelledFiles.add(f)
  }

  const labels: WwiseFileLabel[] = []
  for (const file of embeddedFiles) {
    const eventIds = fileToEvents.get(file.id)
    const labelStrings: string[] = []

    if (eventIds && eventIds.size > 0) {
      for (const eid of eventIds) {
        labelStrings.push(`Event:0x${eid.toString(16).toUpperCase()}`)
      }
    }

    // If a Sound object references this fileId, include Sound ID
    const soundId = sourceToSound.get(file.id)
    if (soundId !== undefined) {
      labelStrings.push(`Sound:0x${soundId.toString(16).toUpperCase()}`)
    }

    if (labelStrings.length > 0) {
      labels.push({ fileId: file.id, eventIds: eventIds ? Array.from(eventIds) : [], labels: labelStrings })
    }
  }

  const labelled = labels.filter(l => l.eventIds.length > 0).length
  const unlabelled = embeddedFiles.length - labelled
  _log(`[wwise] file labels: ${labelled} files linked to events, ${unlabelled} unlinked (media-only or container-routed)`)

  return labels
}

// ---- Extraction ----

/**
 * Extract a single embedded .wem file from a SoundBank buffer.
 */
export function extractWemFile(bankData: Buffer | Uint8Array, file: WwiseEmbeddedFile): Buffer {
  const buf = bankData instanceof Buffer ? bankData : Buffer.from(bankData.buffer, bankData.byteOffset, bankData.byteLength)
  return buf.subarray(file.offset, file.offset + file.size) as Buffer
}
