/** @type {import('tailwindcss').Config} */
const config = {
    darkMode: ["selector", ["html.dark", "html:not(.light)"]],
    content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
    theme: {
        extend: {
            colors: {
                "theme-bg": "var(--background)",
                "theme-fg": "var(--foreground)",
                "theme-surface": "var(--surface)",
                "theme-surface-strong": "var(--surface-strong)",
                "theme-muted": "var(--muted)",
                "theme-line": "var(--line)",
                "theme-accent": "var(--accent)",
            },
        },
    },
    plugins: [],
};

export default config;
