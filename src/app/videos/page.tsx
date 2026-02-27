import Link from 'next/link'

export default function VideosPlaceholderPage() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
            <div className="text-center">
                <h1 className="mb-4 text-2xl font-bold">Videos will appear here</h1>
                <Link
                    href="/upload"
                    className="text-blue-600 hover:underline"
                >
                    Go to Upload Page
                </Link>
            </div>
        </div>
    )
}
