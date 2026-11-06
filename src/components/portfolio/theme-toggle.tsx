import { useEffect, useState } from "react";
import { useHydrated } from "@tanstack/react-router";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const THEME_KEY = "equilibre.theme.v1";

export function ThemeToggle() {
  const hydrated = useHydrated();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    let savedDark = document.documentElement.classList.contains("dark");
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "dark" || saved === "light") savedDark = saved === "dark";
    } catch {
      // The switch remains usable when browser storage is unavailable.
    }
    document.documentElement.classList.toggle("dark", savedDark);
    setDark(savedDark);
  }, []);

  const label = dark ? "Activer le mode clair" : "Activer le mode sombre";
  return <Button variant="ghost" size="icon" disabled={!hydrated} aria-label={label} title={label} aria-pressed={dark} onClick={() => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
    try { localStorage.setItem(THEME_KEY, next ? "dark" : "light"); } catch {
      // Do not prevent a theme change if storage is blocked.
    }
  }}>{dark ? <Sun /> : <Moon />}</Button>;
}