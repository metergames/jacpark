import nextPwa from "next-pwa";

/** @type {import("next").NextConfig} */
const nextConfig = {
    reactStrictMode: true,
};

const withPWA = nextPwa({
    dest: "public",
    disable: process.env.NODE_ENV !== "production",
    register: true,
    skipWaiting: true,
});

export default withPWA(nextConfig);
