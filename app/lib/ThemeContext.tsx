"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark" | "auto";

interface ThemeContextType {
    theme: Theme;
    toggleTheme: () => void;
    setTheme: (newTheme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Get the effective theme based on system preference when auto is selected
function getEffectiveTheme(theme: Theme): "light" | "dark" {
    if (theme !== "auto") {
        return theme;
    }

    // Use system preference for auto mode
    if (typeof window !== "undefined") {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    return "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setTheme] = useState<Theme>(() => {
        if (typeof window === "undefined") {
            return "auto";
        }

        const savedTheme = localStorage.getItem("theme") as Theme | null;
        return savedTheme ?? "auto";
    });

    function applyTheme(newTheme: Theme) {
        const html = document.documentElement;
        const effectiveTheme = getEffectiveTheme(newTheme);

        if (effectiveTheme === "dark") {
            html.classList.remove("light");
            html.classList.add("dark");
        } else {
            html.classList.remove("dark");
            html.classList.add("light");
        }
    }

    // Keep the document class in sync with the selected theme.
    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    // Listen for system theme changes when in auto mode
    useEffect(() => {
        if (theme !== "auto") return;

        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

        const handleChange = () => {
            applyTheme("auto");
        };

        mediaQuery.addEventListener("change", handleChange);
        return () => mediaQuery.removeEventListener("change", handleChange);
    }, [theme]);

    const toggleTheme = () => {
        setTheme((prevTheme) => {
            const themes: Theme[] = ["dark", "light", "auto"];
            const currentIndex = themes.indexOf(prevTheme);
            const newTheme = themes[(currentIndex + 1) % themes.length];
            localStorage.setItem("theme", newTheme);
            applyTheme(newTheme);
            return newTheme;
        });
    };

    const setThemeValue = (newTheme: Theme) => {
        localStorage.setItem("theme", newTheme);
        applyTheme(newTheme);
        setTheme(newTheme);
    };

    return <ThemeContext.Provider value={{ theme, toggleTheme, setTheme: setThemeValue }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error("useTheme must be used within a ThemeProvider");
    }
    return context;
}
