import React, { useState, useEffect, useRef } from 'react'

export interface SettingsData {
  theme: 'dark' | 'light'
  defaultExportFormat: 'png' | 'jpg'
  jpgQuality: number
  ddsDefaultBackground: 'checkerboard' | 'black' | 'white'
  compressionMode: 'auto' | 'always' | 'never'
  experimentalFeatures: boolean
}

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  settings: SettingsData
  onSave: (settings: SettingsData) => void
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <div>
        <div className="text-sm text-gray-200">{label}</div>
        {description && <div className="text-xs text-gray-500 mt-0.5">{description}</div>}
      </div>
      <div className="ml-4 shrink-0">{children}</div>
    </div>
  )
}

function SelectInput<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as T)}
      className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 min-w-[140px]"
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

export function SettingsDialog({ open, onClose, settings, onSave }: SettingsDialogProps) {
  const [draft, setDraft] = useState<SettingsData>(settings)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) setDraft(settings)
  }, [open, settings])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  const handleSave = () => {
    onSave(draft)
    onClose()
  }

  const update = <K extends keyof SettingsData>(key: K, value: SettingsData[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        ref={ref}
        className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl w-[460px] max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-gray-100">Settings</h2>
        </div>

        {/* Content */}
        <div className="px-5 py-2 overflow-y-auto flex-1">
          {/* Appearance section */}
          <div className="mb-4">
            <h3 className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-1">Appearance</h3>
            <div className="border-b border-gray-700">
              <SettingRow label="Theme">
                <SelectInput
                  value={draft.theme}
                  options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]}
                  onChange={v => update('theme', v)}
                />
              </SettingRow>
            </div>
          </div>

          {/* Export section */}
          <div className="mb-4">
            <h3 className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-1">Export</h3>
            <div className="border-b border-gray-700">
              <SettingRow label="Default image format" description="Format used when exporting textures">
                <SelectInput
                  value={draft.defaultExportFormat}
                  options={[{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPEG' }]}
                  onChange={v => update('defaultExportFormat', v)}
                />
              </SettingRow>
              <SettingRow label="JPEG quality" description={`${draft.jpgQuality}%`}>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={draft.jpgQuality}
                  onChange={e => update('jpgQuality', Number(e.target.value))}
                  className="w-[140px] accent-blue-500"
                />
              </SettingRow>
            </div>
          </div>

          {/* DDS Viewer section */}
          <div className="mb-4">
            <h3 className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-1">DDS Viewer</h3>
            <div className="border-b border-gray-700">
              <SettingRow label="Default background" description="Background shown behind textures">
                <SelectInput
                  value={draft.ddsDefaultBackground}
                  options={[
                    { value: 'checkerboard', label: 'Checkerboard' },
                    { value: 'black', label: 'Black' },
                    { value: 'white', label: 'White' },
                  ]}
                  onChange={v => update('ddsDefaultBackground', v)}
                />
              </SettingRow>
            </div>
          </div>

          {/* Saving section */}
          <div className="mb-4">
            <h3 className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-1">Saving</h3>
            <div className="border-b border-gray-700">
              <SettingRow label="Oodle compression" description="How to compress assets when saving">
                <SelectInput
                  value={draft.compressionMode}
                  options={[
                    { value: 'auto', label: 'Auto (match original)' },
                    { value: 'always', label: 'Always compress' },
                    { value: 'never', label: 'Never compress' },
                  ]}
                  onChange={v => update('compressionMode', v)}
                />
              </SettingRow>
            </div>
          </div>

          {/* Advanced section */}
          <div className="mb-2">
            <h3 className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-1">Advanced</h3>
            <div className="border-b border-gray-700">
              <SettingRow label="Enable experimental features" description="Unlocks asset replacement and save functionality">
                <button
                  onClick={() => update('experimentalFeatures', !draft.experimentalFeatures)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${draft.experimentalFeatures ? 'bg-blue-600' : 'bg-gray-600'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${draft.experimentalFeatures ? 'translate-x-5' : ''}`} />
                </button>
              </SettingRow>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm transition-colors text-white font-medium"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
