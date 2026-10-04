/**
 * Session join logins on the training provider's platform.
 *
 * Coordinators share one login per provider; on YAT each group also has its
 * own login for the coach. The id doubles as the encryption's additional data,
 * so a login copied onto another group's row fails to decrypt.
 */
export type JoinKind = "coach" | "coordinator";

export function joinAccountId(kind: JoinKind, key: string) {
  return `${kind}:${String(key).trim()}`;
}

/** Who may ask for which login, by role, before the per-group check. */
export const joinLoginRoles: Record<JoinKind, string[]> = {
  coach: ["Coach", "Coach Operations", "Operations Systems / Admin"],
  coordinator: ["Operations Coordinator", "Team Supervisor", "Project Operations", "Operations Systems / Admin"],
};
