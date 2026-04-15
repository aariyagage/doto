import type { Metadata } from "next"

export const metadata: Metadata = { title: "Video Library" }

export default function VideosLayout({ children }: { children: React.ReactNode }) {
  return children
}
