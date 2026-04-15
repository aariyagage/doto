'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const router = useRouter()
    const supabase = createClient()

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setLoading(true)
        setError(null)

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
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
            <Link href="/" className="font-caslon italic font-bold text-4xl tracking-tighter mb-6 text-[var(--text-primary)] hover:opacity-80 transition-opacity">
                doto
            </Link>
            <Card className="w-full max-w-md bg-[var(--bg-panel)] border-gray-200 dark:border-gray-800 shadow-lg rounded-2xl">
                <CardHeader>
                    <CardTitle className="font-heading text-2xl tracking-tight">Welcome back</CardTitle>
                    <CardDescription className="font-ui">Sign in to your account.</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
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
                                    autoComplete="current-password"
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
                        </div>
                        {error && <p role="alert" className="text-sm text-[var(--combo-6-bg)] font-medium">{error}</p>}
                        <Button
                            type="submit"
                            className="w-full rounded-full bg-[var(--text-primary)] text-[var(--bg-primary)] hover:scale-[1.02] transition-transform font-heading h-11"
                            disabled={loading}
                        >
                            {loading ? 'Signing in…' : 'Log in'}
                        </Button>
                    </form>
                </CardContent>
                <CardFooter className="flex justify-center">
                    <Link href="/signup" className="text-sm font-ui text-[var(--muted-foreground)] hover:text-[var(--text-primary)] transition-colors">
                        Don&apos;t have an account? <span className="underline underline-offset-4">Sign up</span>
                    </Link>
                </CardFooter>
            </Card>
        </div>
    )
}
