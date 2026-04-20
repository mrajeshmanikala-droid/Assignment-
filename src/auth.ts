// ===== Simple LocalStorage Auth =====

const USERS_KEY = 'twinmind_users';
const CURRENT_USER_KEY = 'twinmind_current_user';

export type UserPlan = 'free' | 'pro' | 'enterprise';

interface User {
  username: string;
  email: string;
  passwordHash: string;
  plan: UserPlan;
}

function getUsers(): Record<string, User> {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveUsers(users: Record<string, User>): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

// Very basic hash for demonstration purposes
function hashPassword(password: string): string {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString();
}

export async function register(username: string, email: string, password: string) {
  return new Promise<{success: boolean; error?: string}>((resolve) => {
    setTimeout(() => {
      if (!username || !email || !password) {
        resolve({ success: false, error: 'All fields are required' });
        return;
      }
      if (password.length < 6) {
        resolve({ success: false, error: 'Password must be at least 6 characters' });
        return;
      }

      const users = getUsers();
      if (users[username.toLowerCase()] || Object.values(users).some(u => u.email.toLowerCase() === email.toLowerCase())) {
        resolve({ success: false, error: 'Username or email already exists' });
        return;
      }

      users[username.toLowerCase()] = {
        username,
        email,
        passwordHash: hashPassword(password),
        plan: 'free'
      };
      
      saveUsers(users);
      localStorage.setItem(CURRENT_USER_KEY, username);
      resolve({ success: true });
    }, 500); // Simulate network delay
  });
}

export async function login(identifier: string, password: string) {
  return new Promise<{success: boolean; error?: string}>((resolve) => {
    setTimeout(() => {
      const users = getUsers();
      const identLower = identifier.toLowerCase();
      
      // Find user by username or email
      let user = users[identLower];
      if (!user) {
        user = Object.values(users).find(u => u.email.toLowerCase() === identLower) as User;
      }

      if (!user || user.passwordHash !== hashPassword(password)) {
        resolve({ success: false, error: 'Invalid credentials' });
        return;
      }

      localStorage.setItem(CURRENT_USER_KEY, user.username);
      resolve({ success: true });
    }, 500); // Simulate network delay
  });
}

export function logout(): void {
  localStorage.removeItem(CURRENT_USER_KEY);
}

export function getCurrentUser(): string | null {
  return localStorage.getItem(CURRENT_USER_KEY);
}

export function isLoggedIn(): boolean {
  return !!getCurrentUser();
}

export function getUserData(): User | null {
  const username = getCurrentUser();
  if (!username) return null;
  const users = getUsers();
  return users[username.toLowerCase()] || null;
}

export function updateUserPlan(plan: UserPlan): void {
  const username = getCurrentUser();
  if (!username) return;
  const users = getUsers();
  if (users[username.toLowerCase()]) {
    users[username.toLowerCase()].plan = plan;
    saveUsers(users);
  }
}
