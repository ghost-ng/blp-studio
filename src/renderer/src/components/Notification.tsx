import React, { useEffect } from 'react'

export interface NotificationData {
  type: 'success' | 'error' | 'warning'
  title: string
  message?: string
}

interface NotificationProps {
  notification: NotificationData | null
  onDismiss: () => void
}

const ICONS = {
  success: (
    <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ),
  error: (
    <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  warning: (
    <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2L2 20h20L12 2z" />
    </svg>
  ),
}

const STYLES = {
  success: 'border-green-600 bg-green-950/90',
  error: 'border-red-600 bg-red-950/90',
  warning: 'border-amber-600 bg-amber-950/90',
}

export function Notification({ notification, onDismiss }: NotificationProps) {
  useEffect(() => {
    if (!notification) return
    const duration = notification.type === 'error' ? 8000 : 4000
    const timer = setTimeout(onDismiss, duration)
    return () => clearTimeout(timer)
  }, [notification, onDismiss])

  if (!notification) return null

  return (
    <div className="fixed top-16 right-4 z-50 animate-in slide-in-from-right">
      <div
        className={`border rounded-lg shadow-xl px-4 py-3 max-w-sm cursor-pointer ${STYLES[notification.type]}`}
        onClick={onDismiss}
      >
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">{ICONS[notification.type]}</div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-100">{notification.title}</p>
            {notification.message && (
              <p className="text-xs text-gray-300 mt-1 break-words">{notification.message}</p>
            )}
          </div>
          <button className="shrink-0 text-gray-400 hover:text-gray-200 ml-2" onClick={onDismiss}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
