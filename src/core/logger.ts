import { createWriteStream, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { WriteStream } from 'fs'

let stream: WriteStream | null = null
let logDir = ''

function ts(): string { return new Date().toISOString().slice(11, 23) }

export function initLogger(userDataPath: string): void {
  logDir = join(userDataPath, 'logs')
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
  const logPath = join(logDir, 'blp-studio.log')
  stream = createWriteStream(logPath, { flags: 'w' })
  stream.write(`=== BLP Studio started ${new Date().toISOString()} ===\n`)
}

function write(level: string, msg: string): void {
  const line = `${ts()} [${level}] ${msg}\n`
  stream?.write(line)
}

export function log(msg: string): void {
  console.log(`${ts()} ${msg}`)
  write('INFO', msg)
}

export function warn(msg: string): void {
  console.warn(`${ts()} [WARN] ${msg}`)
  write('WARN', msg)
}

export function error(msg: string, err?: unknown): void {
  const detail = err ? ` ${err instanceof Error ? err.stack || err.message : String(err)}` : ''
  console.error(`${ts()} [ERROR] ${msg}${detail}`)
  write('ERROR', `${msg}${detail}`)
}

export function getLogPath(): string {
  return logDir ? join(logDir, 'blp-studio.log') : ''
}
