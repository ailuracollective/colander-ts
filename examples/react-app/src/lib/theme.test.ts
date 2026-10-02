import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import {
  THEME_BOOTSTRAP,
  THEME_MEDIA_QUERY,
  THEME_STORAGE_KEY,
  applyTheme,
  parseThemePreference,
  persistThemePreference,
  readThemePreference,
  resolveTheme,
  subscribeToSystemTheme,
  type ThemeMediaQuery,
  type ThemeRoot,
  type ThemeStorage,
} from "./theme";

function createStorage(initialValue?: string) {
  const values = new Map<string, string>();
  if (initialValue !== undefined) {
    values.set(THEME_STORAGE_KEY, initialValue);
  }

  const storage: ThemeStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };

  return { storage, values };
}

function createRoot() {
  const classes = new Set<string>();
  const root: ThemeRoot = {
    classList: {
      add: vi.fn((token: string) => {
        classes.add(token);
      }),
      remove: vi.fn((token: string) => {
        classes.delete(token);
      }),
    },
  };

  return { root, classes };
}

function createMedia(matches: boolean): ThemeMediaQuery {
  return { matches };
}

type BootstrapOptions = {
  storedValue?: string | null;
  systemDark?: boolean;
  storageError?: boolean;
};

function runBootstrap({ storedValue, systemDark = false, storageError = false }: BootstrapOptions) {
  let dark = false;
  const root = {
    classList: {
      toggle: vi.fn((_className: string, force?: boolean) => {
        dark = force === true;
        return dark;
      }),
    },
  };
  const storage = {
    getItem: vi.fn((_key: string) => {
      if (storageError) {
        throw new Error("storage unavailable");
      }
      return storedValue ?? null;
    }),
  };
  const fakeWindow = {
    localStorage: storage,
    matchMedia: vi.fn(() => ({ matches: systemDark })),
  };
  const fakeDocument = { documentElement: root };

  runInNewContext(THEME_BOOTSTRAP, {
    window: fakeWindow,
    document: fakeDocument,
  });

  return {
    isDark: () => dark,
    matchMedia: fakeWindow.matchMedia,
    storage,
  };
}

describe("theme preferences", () => {
  it("accepts only the three supported preference values", () => {
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("sepia")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
  });

  it("reads valid values and defaults missing or malformed values to system", () => {
    const explicit = createStorage("dark");
    const missing = createStorage();
    const malformed = createStorage("unexpected");

    expect(readThemePreference(explicit.storage)).toBe("dark");
    expect(readThemePreference(missing.storage)).toBe("system");
    expect(readThemePreference(malformed.storage)).toBe("system");
    expect(readThemePreference()).toBe("system");
  });

  it("persists explicit choices and replaces stale state with system", () => {
    const explicit = createStorage("light");
    const system = createStorage("dark");

    expect(persistThemePreference("dark", explicit.storage)).toBe(true);
    expect(explicit.storage.setItem).toHaveBeenLastCalledWith(THEME_STORAGE_KEY, "dark");

    expect(persistThemePreference("system", system.storage)).toBe(true);
    expect(system.storage.setItem).toHaveBeenLastCalledWith(THEME_STORAGE_KEY, "system");
    expect(system.values.get(THEME_STORAGE_KEY)).toBe("system");
  });

  it("falls back safely when storage access throws", () => {
    const storage: ThemeStorage = {
      getItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
      setItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
    };

    expect(readThemePreference(storage)).toBe("system");
    expect(persistThemePreference("dark", storage)).toBe(false);
    expect(() => persistThemePreference("system", storage)).not.toThrow();
    expect(persistThemePreference("system")).toBe(false);
  });
});

describe("theme bootstrap", () => {
  it("applies a stored Dark preference before hydration", () => {
    const result = runBootstrap({ storedValue: "dark" });

    expect(result.isDark()).toBe(true);
    expect(result.storage.getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
  });

  it("keeps stored Light ahead of a dark system preference", () => {
    const result = runBootstrap({ storedValue: "light", systemDark: true });

    expect(result.isDark()).toBe(false);
    expect(result.matchMedia).not.toHaveBeenCalled();
  });

  it("resolves stored System from a dark system preference", () => {
    const result = runBootstrap({ storedValue: "system", systemDark: true });

    expect(result.isDark()).toBe(true);
    expect(result.matchMedia).toHaveBeenCalledWith(THEME_MEDIA_QUERY);
  });

  it("falls back to System when storage is unavailable", () => {
    const result = runBootstrap({ storageError: true, systemDark: true });

    expect(result.isDark()).toBe(true);
    expect(result.matchMedia).toHaveBeenCalledWith(THEME_MEDIA_QUERY);
  });

  it("falls back to System when stored data is malformed", () => {
    const result = runBootstrap({ storedValue: "sepia", systemDark: true });

    expect(result.isDark()).toBe(true);
    expect(result.matchMedia).toHaveBeenCalledWith(THEME_MEDIA_QUERY);
  });
});

describe("theme resolution", () => {
  it("resolves system from prefers-color-scheme dark", () => {
    expect(resolveTheme("system", createMedia(true))).toBe("dark");
    expect(resolveTheme("system", createMedia(false))).toBe("light");
    expect(resolveTheme("system")).toBe("light");
  });

  it("keeps explicit choices as overrides of the system preference", () => {
    expect(resolveTheme("light", createMedia(true))).toBe("light");
    expect(resolveTheme("dark", createMedia(false))).toBe("dark");
  });
});

describe("theme root application", () => {
  it("adds and removes the dark root class", () => {
    const { root, classes } = createRoot();

    expect(applyTheme(root, "system", createMedia(true))).toBe("dark");
    expect(classes.has("dark")).toBe(true);
    expect(root.classList.add).toHaveBeenCalledWith("dark");

    expect(applyTheme(root, "light", createMedia(true))).toBe("light");
    expect(classes.has("dark")).toBe(false);
    expect(root.classList.remove).toHaveBeenCalledWith("dark");
  });

  it("subscribes to system changes while the system preference is active", () => {
    const listeners: Array<() => void> = [];
    const media: ThemeMediaQuery = {
      matches: false,
      addEventListener: vi.fn((_type, listener) => {
        listeners.push(listener);
      }),
      removeEventListener: vi.fn(),
    };
    const onChange = vi.fn();

    const unsubscribe = subscribeToSystemTheme(media, onChange);
    expect(listeners).toHaveLength(1);
    listeners[0]?.();
    expect(onChange).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("uses legacy removal when modern removal is unavailable", () => {
    const media: ThemeMediaQuery = {
      matches: false,
      addEventListener: vi.fn(),
      removeListener: vi.fn(),
    };
    const unsubscribe = subscribeToSystemTheme(media, vi.fn());

    unsubscribe();

    expect(media.removeListener).toHaveBeenCalledWith(expect.any(Function));
  });
});
