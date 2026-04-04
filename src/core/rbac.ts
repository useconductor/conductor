/**
 * RBAC — Role-Based Access Control foundation for multi-user Conductor.
 *
 * Provides role definitions, permission checks, user management, and
 * persistence. Designed to be plugged into the MCP server's tool routing
 * so every tool call is authorized before execution.
 *
 * Default roles:
 *   admin            — full access to all resources and actions
 *   editor           — create / read / update / execute (no delete)
 *   viewer           — read-only
 *   service_account  — execute only (for automated tool calls)
 */

// ── Role ──────────────────────────────────────────────────────────────────────

export enum Role {
  ADMIN = 'admin',
  EDITOR = 'editor',
  VIEWER = 'viewer',
  SERVICE_ACCOUNT = 'service_account',
}

// ── Action ────────────────────────────────────────────────────────────────────

export enum Action {
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
  EXECUTE = 'execute',
}

// ── Permission ────────────────────────────────────────────────────────────────

export interface Permission {
  resource: string;
  action: Action;
}

// ── RolePermissions ───────────────────────────────────────────────────────────

/**
 * Maps each role to the set of (resource, action) pairs it is allowed to perform.
 *
 * The special resource '*' is a wildcard meaning "all resources".
 */
export type RolePermissions = Map<Role, Permission[]>;

/**
 * Default permission assignments for built-in roles.
 */
export function defaultRolePermissions(): RolePermissions {
  const perms = new Map<Role, Permission[]>();

  perms.set(Role.ADMIN, [
    { resource: '*', action: Action.CREATE },
    { resource: '*', action: Action.READ },
    { resource: '*', action: Action.UPDATE },
    { resource: '*', action: Action.DELETE },
    { resource: '*', action: Action.EXECUTE },
  ]);

  perms.set(Role.EDITOR, [
    { resource: '*', action: Action.CREATE },
    { resource: '*', action: Action.READ },
    { resource: '*', action: Action.UPDATE },
    { resource: '*', action: Action.EXECUTE },
  ]);

  perms.set(Role.VIEWER, [{ resource: '*', action: Action.READ }]);

  perms.set(Role.SERVICE_ACCOUNT, [
    { resource: '*', action: Action.EXECUTE },
    { resource: '*', action: Action.READ },
  ]);

  return perms;
}

// ── User ──────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  role: Role;
  createdAt: Date;
  lastLoginAt: Date | null;
}

// ── Audit log entry ───────────────────────────────────────────────────────────

export interface RBACAuditEntry {
  timestamp: Date;
  userId: string;
  resource: string;
  action: string;
  granted: boolean;
}

// ── Serialised shape ──────────────────────────────────────────────────────────

interface SerialisedUser {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  lastLoginAt: string | null;
}

interface SerialisedState {
  users: SerialisedUser[];
  permissions: Record<string, { resource: string; action: Action }[]>;
}

// ── RBACManager ───────────────────────────────────────────────────────────────

export class RBACManager {
  private users: Map<string, User> = new Map();
  private permissions: RolePermissions;
  private auditLog: RBACAuditEntry[] = [];

  constructor(permissions?: RolePermissions) {
    this.permissions = permissions ?? defaultRolePermissions();
  }

  // ── User CRUD ────────────────────────────────────────────────────────────

  /**
   * Add a user. Throws if the user id already exists.
   */
  addUser(user: User): void {
    if (this.users.has(user.id)) {
      throw new Error(`User already exists: ${user.id}`);
    }
    this.users.set(user.id, { ...user });
  }

  /**
   * Remove a user by id. Returns true if the user existed and was removed.
   */
  removeUser(userId: string): boolean {
    return this.users.delete(userId);
  }

  /**
   * Retrieve a user by id, or undefined if not found.
   */
  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  /**
   * Return a snapshot of all users.
   */
  listUsers(): User[] {
    return Array.from(this.users.values());
  }

  // ── Role management ──────────────────────────────────────────────────────

  /**
   * Assign a new role to an existing user. Returns false if the user doesn't exist.
   */
  assignRole(userId: string, role: Role): boolean {
    const user = this.users.get(userId);
    if (!user) return false;
    user.role = role;
    return true;
  }

  /**
   * Record a login timestamp for a user. Returns false if the user doesn't exist.
   */
  recordLogin(userId: string): boolean {
    const user = this.users.get(userId);
    if (!user) return false;
    user.lastLoginAt = new Date();
    return true;
  }

  // ── Permission checks ────────────────────────────────────────────────────

  /**
   * Check whether a user has permission to perform `action` on `resource`.
   *
   * The check consults the user's role against the RolePermissions map.
   * Wildcard resource '*' in the permission set grants access to all resources.
   *
   * Every check (granted or denied) is appended to the in-memory audit log.
   */
  checkPermission(userId: string, resource: string, action: string): boolean {
    const user = this.users.get(userId);
    if (!user) {
      this.audit({ userId, resource, action, granted: false });
      return false;
    }

    const rolePerms = this.permissions.get(user.role);
    if (!rolePerms || rolePerms.length === 0) {
      this.audit({ userId, resource, action, granted: false });
      return false;
    }

    const granted = rolePerms.some((p) => (p.resource === '*' || p.resource === resource) && p.action === action);

    this.audit({ userId, resource, action, granted });
    return granted;
  }

  /**
   * Check multiple permissions at once. Returns true only if ALL are granted.
   */
  checkPermissions(userId: string, checks: { resource: string; action: string }[]): boolean {
    return checks.every((c) => this.checkPermission(userId, c.resource, c.action));
  }

  // ── Custom permissions ───────────────────────────────────────────────────

  /**
   * Add a custom permission entry for a specific role.
   */
  addPermission(role: Role, permission: Permission): void {
    const existing = this.permissions.get(role) ?? [];
    // Avoid duplicates
    if (!existing.some((p) => p.resource === permission.resource && p.action === permission.action)) {
      existing.push(permission);
      this.permissions.set(role, existing);
    }
  }

  /**
   * Remove a permission entry from a role.
   */
  removePermission(role: Role, resource: string, action: Action): void {
    const existing = this.permissions.get(role);
    if (!existing) return;
    const filtered = existing.filter((p) => !(p.resource === resource && p.action === action));
    this.permissions.set(role, filtered);
  }

  /**
   * Get all permissions for a role.
   */
  getRolePermissions(role: Role): Permission[] {
    return [...(this.permissions.get(role) ?? [])];
  }

  // ── Audit log ────────────────────────────────────────────────────────────

  /**
   * Return the in-memory audit log.
   */
  getAuditLog(): RBACAuditEntry[] {
    return [...this.auditLog];
  }

  /**
   * Clear the audit log (useful for tests or after flushing to persistent storage).
   */
  clearAuditLog(): void {
    this.auditLog = [];
  }

  private audit(entry: Omit<RBACAuditEntry, 'timestamp'>): void {
    this.auditLog.push({ ...entry, timestamp: new Date() });
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  /**
   * Serialise the entire RBAC state (users + custom permissions) to a JSON string.
   * The audit log is intentionally excluded — it should be flushed separately.
   */
  serialize(): string {
    const state: SerialisedState = {
      users: Array.from(this.users.values()).map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      })),
      permissions: Object.fromEntries(
        Array.from(this.permissions.entries()).map(([role, perms]) => [
          role,
          perms.map((p) => ({ resource: p.resource, action: p.action })),
        ]),
      ),
    };
    return JSON.stringify(state);
  }

  /**
   * Restore RBAC state from a previously serialised JSON string.
   * Replaces all existing users and permissions.
   */
  deserialize(data: string): void {
    const state: SerialisedState = JSON.parse(data);

    this.users = new Map(
      state.users.map((u) => [
        u.id,
        {
          id: u.id,
          email: u.email,
          role: u.role,
          createdAt: new Date(u.createdAt),
          lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt) : null,
        },
      ]),
    );

    this.permissions = new Map(
      Object.entries(state.permissions).map(([roleStr, perms]) => [
        roleStr as Role,
        perms.map((p) => ({ resource: p.resource, action: p.action })),
      ]),
    );
  }
}
