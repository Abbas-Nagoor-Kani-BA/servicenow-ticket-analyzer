/**
 * Branded string token — zero runtime cost, full type inference at
 * `resolve()` sites.
 *
 * Branded rather than class-based so tokens stay usable as plain `Map` keys
 * and remain readable in a debugger. The brand is optional so a bare string
 * still satisfies the type where inference is not needed.
 */
export type Token<T> = string & { readonly __brand?: T };

/**
 * Declares a dependency token. `T` is the interface the token resolves to,
 * so `container.resolve(SETTINGS_REPO)` is typed as `SettingsRepository`.
 *
 * @param name unique token name; used verbatim in "nothing registered" errors
 * @returns the branded token
 */
export const token = <T>(name: string): Token<T> => name as Token<T>;
