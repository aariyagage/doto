import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LogoutButton from './logout-button'

export default async function DashboardPage() {
    const supabase = createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    const displayName = user.user_metadata?.display_name || 'User'

    return (
        <div className="flex min-h-screen flex-col items-center bg-gray-100 p-4">
            <div className="mt-8 w-full max-w-4xl">
                <div className="mb-8 flex items-center justify-between">
                    <h1 className="text-3xl font-bold">Dashboard</h1>
                    <LogoutButton />
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                    <div className="rounded-xl bg-white p-6 shadow-md">
                        <h2 className="mb-2 text-xl font-semibold">Welcome back, {displayName}</h2>
                        <p className="mb-4 text-gray-600">Manage your video content below.</p>
                    </div>

                    <div className="flex flex-col gap-3 rounded-xl bg-white p-6 shadow-md">
                        <h2 className="mb-2 text-xl font-semibold">Quick Actions</h2>
                        <a
                            href="/upload"
                            className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 hover:bg-zinc-900/90"
                        >
                            Upload Video
                        </a>
                        <a
                            href="/videos"
                            className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-100 hover:text-zinc-900"
                        >
                            View Library
                        </a>
                    </div>
                </div>
            </div>
        </div>
    )
}
