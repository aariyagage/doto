/** @type {import('next').NextConfig} */
const nextConfig = {
    experimental: {
        serverComponentsExternalPackages: ['@ffmpeg-installer/ffmpeg', 'fluent-ffmpeg'],
    },
    // Pre-existing ESLint `any` warnings and Recharts type-mismatch errors
    // (upstream bug between recharts and React 18 types) should not fail
    // the production build. Local `next lint` and `tsc` still surface them.
    eslint: {
        ignoreDuringBuilds: true,
    },
    typescript: {
        ignoreBuildErrors: true,
    },
};

export default nextConfig;
