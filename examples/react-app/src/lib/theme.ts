export const THEME_STORAGE_KEY = "colander:theme";
export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThemeMediaQuery {
  readonly matches: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
}

export interface ThemeRoot {
  readonly classList: {
    add(token: string): void;
    remove(token: string): void;
  };
}

export const THEME_OPTIONS: readonly {
  value: ThemePreference;
  label: string;
}[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * Keep the head bootstrap independent from the runtime module. It runs before
 * hydration, uses only fixed text, and treats unavailable browser APIs as a
 * request to use the light fallback.
 */
export const THEME_BOOTSTRAP = `
(function () {
  var root = document.documentElement;
  var preference = 'system';
  try {
    var stored = window.localStorage.getItem('${THEME_STORAGE_KEY}');
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      preference = stored;
    }
  } catch (error) {}
  var isDark = preference === 'dark';
  if (preference === 'system') {
    try {
      isDark = window.matchMedia('${THEME_MEDIA_QUERY}').matches;
    } catch (error) {}
  }
  try {
    root.classList.toggle('dark', isDark);
  } catch (error) {}
})();
`;

export function parseThemePreference(value: unknown): ThemePreference {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return "system";
}

export function readThemePreference(storage?: ThemeStorage | null): ThemePreference {
  if (storage == null) {
    return "system";
  }

  try {
    return parseThemePreference(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function persistThemePreference(
  preference: ThemePreference,
  storage?: ThemeStorage | null,
): boolean {
  if (storage == null) {
    return false;
  }

  try {
    // Writing System under the same key replaces any stale explicit value.
    storage.setItem(THEME_STORAGE_KEY, parseThemePreference(preference));
    return true;
  } catch {
    return false;
  }
}

export function getThemeStorage(): ThemeStorage | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getThemeMediaQuery(): ThemeMediaQuery | null {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return null;
    }
    return window.matchMedia(THEME_MEDIA_QUERY) as unknown as ThemeMediaQuery;
  } catch {
    return null;
  }
}

export function getThemeRoot(): ThemeRoot | null {
  try {
    if (typeof document === "undefined") {
      return null;
    }
    return document.documentElement;
  } catch {
    return null;
  }
}

export function getSystemTheme(
  mediaQuery?: Pick<ThemeMediaQuery, "matches"> | null,
): ResolvedTheme {
  try {
    return mediaQuery?.matches === true ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function resolveTheme(
  preference: ThemePreference,
  mediaQuery?: Pick<ThemeMediaQuery, "matches"> | null,
): ResolvedTheme {
  const normalizedPreference = parseThemePreference(preference);
  if (normalizedPreference === "dark") {
    return "dark";
  }
  if (normalizedPreference === "light") {
    return "light";
  }
  return getSystemTheme(mediaQuery);
}

export function applyThemeClass(root: ThemeRoot | null | undefined, theme: ResolvedTheme): void {
  if (root == null) {
    return;
  }

  try {
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  } catch {
    // A detached or restricted document must not prevent the app from rendering.
  }
}

export function applyTheme(
  root: ThemeRoot | null | undefined,
  preference: ThemePreference,
  mediaQuery?: Pick<ThemeMediaQuery, "matches"> | null,
): ResolvedTheme {
  const theme = resolveTheme(preference, mediaQuery);
  applyThemeClass(root, theme);
  return theme;
}

export function subscribeToSystemTheme(
  mediaQuery: ThemeMediaQuery | null | undefined,
  listener: () => void,
): () => void {
  if (mediaQuery == null) {
    return () => {};
  }

  const handleChange = () => listener();

  try {
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => {
        try {
          if (typeof mediaQuery.removeEventListener === "function") {
            mediaQuery.removeEventListener("change", handleChange);
          } else {
            mediaQuery.removeListener?.(handleChange);
          }
        } catch {
          // Cleanup is best effort when the browser is shutting down.
        }
      };
    }

    if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(handleChange);
      return () => {
        try {
          mediaQuery.removeListener?.(handleChange);
        } catch {
          // Cleanup is best effort when the browser is shutting down.
        }
      };
    }
  } catch {
    return () => {};
  }

  return () => {};
}
