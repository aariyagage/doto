'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export default function LogoutButton() {
    const router = useRouter()
    const supabase = createClient()

    async function handleLogout() {
        await supabase.auth.signOut()
        router.push('/login')
        router.refresh()
    }

    return <Button onClick={handleLogout} className="rounded-full border border-rule bg-transparent text-ink hover:bg-paper-elevated px-5 py-2">log out</Button>
}
