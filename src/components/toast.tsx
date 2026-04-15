'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

type ToastVariant = 'default' | 'success' | 'error'

interface Toast {
    id: string
    message: string
    variant: ToastVariant
}

interface ToastContextValue {
    showToast: (message: string, variant?: ToastVariant) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const TOAST_DURATION_MS = 3500

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([])
    const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

    const dismiss = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id))
        const handle = timeoutsRef.current.get(id)
        if (handle) {
            clearTimeout(handle)
            timeoutsRef.current.delete(id)
        }
    }, [])

    const showToast = useCallback<ToastContextValue['showToast']>((message, variant = 'default') => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        setToasts(prev => [...prev, { id, message, variant }])
        const handle = setTimeout(() => dismiss(id), TOAST_DURATION_MS)
        timeoutsRef.current.set(id, handle)
    }, [dismiss])

    useEffect(() => {
        const timeouts = timeoutsRef.current
        return () => {
            timeouts.forEach(clearTimeout)
            timeouts.clear()
        }
    }, [])

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <div
                aria-live="polite"
                aria-atomic="true"
                className="fixed bottom-6 right-6 flex flex-col gap-2 z-50 pointer-events-none max-w-sm"
            >
                {toasts.map(toast => (
                    <div
                        key={toast.id}
                        role="status"
                        className={`pointer-events-auto px-4 py-3 rounded-lg shadow-xl text-sm font-medium animate-in slide-in-from-bottom-5 fade-in flex items-center gap-2 ${toastClasses(toast.variant)}`}
                    >
                        <span className="flex-1">{toast.message}</span>
                        <button
                            onClick={() => dismiss(toast.id)}
                            aria-label="Dismiss notification"
                            className="opacity-60 hover:opacity-100 transition-opacity text-xs"
                        >
                            ✕
                        </button>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    )
}

function toastClasses(variant: ToastVariant): string {
    switch (variant) {
        case 'success':
            return 'bg-[var(--combo-3-bg)] text-[var(--combo-3-text)]'
        case 'error':
            return 'bg-[var(--combo-6-bg)] text-white'
        default:
            return 'bg-[var(--text-primary)] text-[var(--bg-primary)]'
    }
}

export function useToast(): ToastContextValue {
    const ctx = useContext(ToastContext)
    if (!ctx) {
        throw new Error('useToast must be used inside <ToastProvider>')
    }
    return ctx
}
