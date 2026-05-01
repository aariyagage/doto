'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import { Check, Minus, Eye, EyeOff } from 'lucide-react'

const MIN_PASSWORD_LENGTH = 10

type PasswordCheck = { label: string; ok: boolean }

function evaluatePassword(pw: string): PasswordCheck[] {
    return [
        { label: `At least ${MIN_PASSWORD_LENGTH} characters`, ok: pw.length >= MIN_PASSWORD_LENGTH },
        { label: 'Contains a lowercase letter', ok: /[a-z]/.test(pw) },
        { label: 'Contains an uppercase letter', ok: /[A-Z]/.test(pw) },
        { label: 'Contains a number', ok: /[0-9]/.test(pw) },
    ]
}

export default function SignupPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [passwordConfirm, setPasswordConfirm] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [showPasswordConfirm, setShowPasswordConfirm] = useState(false)
    const [displayName, setDisplayName] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const router = useRouter()
    const supabase = createClient()

    const checks = useMemo(() => evaluatePassword(password), [password])
    const allChecksPass = checks.every(c => c.ok)
    const passwordsMatch = password.length > 0 && password === passwordConfirm

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)

        if (!allChecksPass) {
            setError('Password does not meet the required strength.')
            return
        }
        if (!passwordsMatch) {
            setError('Passwords do not match.')
            return
        }

        setLoading(true)
        const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    display_name: displayName,
                },
            },
        })

        if (error) {
            setError(error.message)
            setLoading(false)
            return
        }

        router.push('/dashboard')
        router.refresh()
    }

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg-primary)] p-4">
            <Link href="/" className="font-semibold text-3xl tracking-tight mb-6 text-[var(--text-primary)] hover:opacity-80 transition-opacity">
                doto
            </Link>
            <Card className="w-full max-w-md bg-[var(--bg-panel)] border-[var(--border-manila)] shadow-sm rounded-2xl">
                <CardHeader>
                    <CardTitle className="text-2xl font-semibold tracking-tight">Create your account</CardTitle>
                    <CardDescription>Start turning your videos into ideas.</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="displayName">Display name</Label>
                            <Input
                                id="displayName"
                                type="text"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                autoComplete="username"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password">Password</Label>
                            <div className="relative">
                                <Input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    autoComplete="new-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    className="pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(v => !v)}
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    aria-pressed={showPassword}
                                    className="absolute inset-y-0 right-0 flex items-center px-3 text-[var(--text-primary)]/50 hover:text-[var(--text-primary)] transition-colors"
                                >
                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                            <ul className="text-xs space-y-1 mt-1">
                                {checks.map(c => (
                                    <li
                                        key={c.label}
                                        className={`flex items-center gap-1.5 ${c.ok ? 'text-[var(--combo-3-bg)]' : 'text-[var(--text-primary)]/50'}`}
                                    >
                                        {c.ok ? <Check className="h-3 w-3" strokeWidth={3} /> : <Minus className="h-3 w-3" />}
                                        {c.label}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="passwordConfirm">Confirm password</Label>
                            <div className="relative">
                                <Input
                                    id="passwordConfirm"
                                    type={showPasswordConfirm ? 'text' : 'password'}
                                    autoComplete="new-password"
                                    value={passwordConfirm}
                                    onChange={(e) => setPasswordConfirm(e.target.value)}
                                    required
                                    className="pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPasswordConfirm(v => !v)}
                                    aria-label={showPasswordConfirm ? 'Hide password' : 'Show password'}
                                    aria-pressed={showPasswordConfirm}
                                    className="absolute inset-y-0 right-0 flex items-center px-3 text-[var(--text-primary)]/50 hover:text-[var(--text-primary)] transition-colors"
                                >
                                    {showPasswordConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                            {passwordConfirm.length > 0 && !passwordsMatch && (
                                <p role="alert" className="text-xs text-[var(--combo-6-bg)] font-medium">Passwords do not match</p>
                            )}
                        </div>
                        {error && <p role="alert" className="text-sm text-[var(--combo-6-bg)] font-medium">{error}</p>}
                        <Button
                            type="submit"
                            className="w-full rounded-full bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-90 transition-opacity font-medium h-11"
                            disabled={loading || !allChecksPass || !passwordsMatch}
                        >
                            {loading ? 'Creating account…' : 'Create account'}
                        </Button>
                    </form>
                </CardContent>
                <CardFooter className="flex justify-center">
                    <Link href="/login" className="text-sm text-[var(--muted-foreground)] hover:text-[var(--text-primary)] transition-colors">
                        Already have an account? <span className="underline underline-offset-4">Log in</span>
                    </Link>
                </CardFooter>
            </Card>
        </div>
    )
}
