# Supabase Auth Migration Guide

This document outlines the remaining changes needed to complete the migration from custom auth to real Supabase Authentication.

## Completed Changes ✅

- [x] Migration SQL created: `supabase/migrations/20260711000001_auth_migration_uuid_rls.sql`
- [x] `src/components/Login.tsx` - Rewritten to use `supabase.auth.signInWithPassword()`
- [x] `src/App.tsx` - Updated to use `supabase.auth.onAuthStateChange()` for session management
- [x] `src/lib/dbService.ts` - Removed custom token handling, now uses Supabase sessions

## Remaining Changes

### 1. Apply Database Migration (MANUAL - Required before server/client deployment)

**Action**: Copy the entire contents of `supabase/migrations/20260711000001_auth_migration_uuid_rls.sql` and paste into your Supabase Dashboard SQL Editor, then run.

This creates:
- New `employees` table with UUID primary key (FK to `auth.users.id`)
- Updated `projects` and `tasks` tables with UUID references
- RLS policies that enforce permissions at the DB level
- Helper functions for secure role checking

**⚠️ CRITICAL**: This migration **drops and recreates all tables**. Data will be lost. After running, manually create the first admin account via Supabase Dashboard → Authentication → Users.

---

### 2. Update `src/components/ProjectBoard.tsx`

**Changes needed**:

1. **Simplify `robustFindEmployee` function** (lines ~32-50):
   ```typescript
   // OLD: Defensive dual-matching for email/phone
   const robustFindEmployee = (employees: Employee[], identifier: string) => {
     return employees.find(e => e.id === identifier || e.email === identifier || e.phone === identifier);
   };
   
   // NEW: Simple UUID matching
   const robustFindEmployee = (employees: Employee[], identifier: string) => {
     return employees.find(e => e.id === identifier);
   };
   ```

2. **Update `handleCreateTask`** (lines ~183, 190-191):
   ```typescript
   // OLD:
   assignedTo: phone,
   assignedBy: currentUser.phone
   
   // NEW:
   assignedTo: employeeId,
   assignedBy: currentUser.id
   ```

3. **Replace all dual-match comparisons** (lines ~251-262, 391, 739, 1216, 1298, 1391):
   ```typescript
   // OLD:
   if (t.assignedTo && (t.assignedTo.toLowerCase() === empEmailNorm || t.assignedTo === emp.phone))
   
   // NEW:
   if (t.assignedTo === emp.id)
   ```

4. **Update member selection** to use UUID instead of email:
   ```typescript
   // OLD:
   toggleMemberSelection(emp.email || emp.phone)
   
   // NEW:
   toggleMemberSelection(emp.id)
   ```

---

### 3. Update `src/components/ProgressTracker.tsx`

**Changes needed**:

1. **Remove hardcoded phone backdoor** (lines 154, 157):
   ```typescript
   // OLD:
   {currentUser.role === 'admin' || currentUser.phone === '9848884897' ? "Active Project Members Progress" : "My Personal Progress Metrics"}
   
   // NEW:
   {currentUser.role === 'admin' ? "Active Project Members Progress" : "My Personal Progress Metrics"}
   ```

2. **Simplify member metrics filtering** (lines ~45-54):
   ```typescript
   // OLD: Email normalization + phone filtering
   const memberMetrics = employees
     .filter(emp => emp.role !== "admin")
     .filter(emp => {
       if (isUserAdmin) return true;
       const empEmailNorm = (emp.email || "").toLowerCase().trim();
       return empEmailNorm === currentUserEmailNorm || emp.phone === currentUser.phone;
     })
   
   // NEW: Simple UUID matching
   const memberMetrics = employees
     .filter(emp => emp.role !== "admin")
     .filter(emp => {
       if (isUserAdmin) return true;
       return emp.id === currentUser.id;
     })
   ```

3. **Simplify task assignment matching** (line ~54):
   ```typescript
   // OLD:
   const empTasks = allTasks.filter(t => t.assignedTo && (t.assignedTo.toLowerCase().trim() === empEmailNorm || t.assignedTo === emp.phone));
   
   // NEW:
   const empTasks = allTasks.filter(t => t.assignedTo === emp.id);
   ```

---

### 4. Update `src/components/AdminPanel.tsx`

**Changes needed**:

1. **Remove hardcoded password checks** (lines ~92, 111, 130):
   ```typescript
   // OLD:
   if (userKey !== "Mbmn@B!#!951") {
     alert("Incorrect administrator secret key!");
     return;
   }
   
   // NEW: Replace with type-to-confirm modal
   // Show confirmation dialog asking to type the employee/project name
   // Only enable delete button after match
   ```

2. **Update member selection to use UUID**:
   ```typescript
   // OLD:
   key={emp.email || emp.phone}
   selectedMembers.includes(emp.email || emp.phone)
   toggleMemberSelection(emp.email || emp.phone)
   
   // NEW:
   key={emp.id}
   selectedMembers.includes(emp.id)
   toggleMemberSelection(emp.id)
   ```

3. **Update project creation**:
   ```typescript
   // OLD:
   createdBy: currentUser.email
   
   // NEW:
   createdBy: currentUser.id
   ```

4. **Update employee edit/delete calls**:
   ```typescript
   // OLD:
   updateEmployee(editingEmployee.phone, ...)
   deleteEmployee(emp.phone)
   
   // NEW:
   updateEmployee(editingEmployee.id, ...)
   deleteEmployee(emp.id)
   ```

5. **Update phone field label** (line ~394):
   ```typescript
   // OLD: "Mobile Number (**Required for Login**)"
   // NEW: "Mobile Number (Optional contact field)"
   ```

---

### 5. Major Server.ts Rewrite

This is the largest change. Key modifications:

#### a. Remove Dead Auth Code
Delete these functions entirely (lines referenced):
- `getAppSecret()` (~607-609)
- `hashPassword()` (~614-618)
- `verifyPassword()` (~620-634)
- `createSessionToken()` (~639-644)
- `verifySessionToken()` (~646-660)
- `SESSION_TTL_MS` (~637)
- Dead vars: `otpCodes`, `authChallenges`, `captchaStore` (~603-605)

#### b. Rewrite Authentication Middleware
```typescript
// OLD requireAuth (lines 662-671)
function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) {
    return res.status(401).json({ error: "Session expired or invalid. Please log in again." });
  }
  req.authUser = payload;
  next();
}

// NEW requireAuth (uses Supabase JWT verification)
async function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  
  if (!token) {
    return res.status(401).json({ error: "Missing authorization token." });
  }

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: "Invalid or expired token." });
    }

    // Fetch employee profile to get role
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('employees')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile) {
      return res.status(401).json({ error: "User profile not found." });
    }

    // Create per-request DBWrapper scoped to this user (so RLS applies)
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false }
    });
    req.db = new DBWrapper(userClient);
    req.authUser = {
      id: user.id,
      email: user.email || "",
      role: profile.role,
      name: profile.name || "",
      phone: profile.phone || ""
    };

    next();
  } catch (err: any) {
    console.error("Auth error:", err);
    res.status(401).json({ error: "Authentication failed." });
  }
}
```

#### c. Delete Old Endpoints
Remove these routes entirely:
- `POST /api/employees/seed` (~720-774)
- `POST /api/auth/captcha` (~995-1040)
- `POST /api/auth/login` (~1043-1145)
- `POST /api/auth/change-password` (~1147-1181)

#### d. Rewrite DBWrapper Constructor
```typescript
// OLD: Module-level Supabase client
class DBWrapper {
  // Uses module-level supabase client

// NEW: Per-request client injection
class DBWrapper {
  constructor(private client: SupabaseClient) {}
  
  collection(name: string) {
    // Replace all internal supabase.from(...) with this.client.from(...)
  }
}
```

#### e. Update POST /api/employees
```typescript
// NEW implementation:
app.post("/api/employees", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const { name, email, phone, designation } = req.body;
    const password = (req.body.password || "").trim(); // Admin sets initial password

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    // Create the Supabase Auth user (service-role only)
    const { data, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: password,
      email_confirm: true
    });

    if (createError) {
      if (createError.message.includes("already registered")) {
        return res.status(400).json({ error: "Employee with this email already exists." });
      }
      return res.status(400).json({ error: createError.message });
    }

    // Create employee profile row
    const { error: profileError } = await supabaseAdmin
      .from('employees')
      .insert({
        id: data.user.id,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone ? phone.trim() : null,
        designation: designation ? designation.trim() : null,
        role: 'employee' // Always 'employee', never allow role escalation
      });

    if (profileError) {
      return res.status(400).json({ error: profileError.message });
    }

    res.json({ success: true, message: "Employee created successfully." });
  } catch (err: any) {
    console.error("Error creating employee:", err);
    res.status(500).json({ error: err.message });
  }
});
```

#### f. Remove In-Memory Fallback
In DBWrapper, remove all the try/catch fallback logic that silently falls back to `localDB`. Once RLS is enabled, every error should propagate (especially 403 RLS violations). Delete:
- `DBWrapper.testSupabase()` method
- Fallback logic in `.get()`, `.set()`, `.update()`, `.delete()`
- Local `localDB` storage entirely

#### g. Update Route Handlers to Use req.db
Every route that currently uses the module-level `db.collection(...)` must change to `req.db.collection(...)`. Examples:
- `GET /api/employees` → routes handler must use `req.db`
- `GET /api/projects` → routes handler must use `req.db`
- `GET /api/tasks` → routes handler must use `req.db`
- All mutation endpoints (POST, PUT, DELETE)

#### h. Remove ID Lookup Fallbacks
Defensive multi-step lookups (try-as-email, try-as-phone, etc.) are no longer needed. Replace with direct UUID `.eq("id", uuid)` queries.

---

## Testing Checklist

After applying changes:

1. **Apply migration** to Supabase
2. **Create first admin account** via Supabase Dashboard (manually, no code in repo)
3. **npm run build** — should pass TypeScript checks
4. **Local testing**:
   - [ ] Admin login → Progress Analytics tab visible
   - [ ] Employee login → Projects Board (no admin tab)
   - [ ] Create project as admin → appears for assigned members
   - [ ] Create task → appears in assignee's list
   - [ ] Change password works
   - [ ] Logout and re-login works
5. **RLS verification** (direct PostgREST queries):
   - [ ] Non-admin POST /projects → 403 via RLS
   - [ ] Employee not in project → project absent from SELECT
   - [ ] Task list → only shows assigned/created tasks
6. **Deploy** server + client together

---

## File-by-File Checklist

- [x] `supabase/migrations/20260711000001_auth_migration_uuid_rls.sql` ← Ready to apply manually
- [x] `src/components/Login.tsx` ← ✅ Completed
- [x] `src/App.tsx` ← ✅ Completed
- [x] `src/lib/dbService.ts` ← ✅ Completed
- [ ] `src/components/ProjectBoard.tsx` ← Needs identity simplification
- [ ] `src/components/ProgressTracker.tsx` ← Remove backdoor, simplify matching
- [ ] `src/components/AdminPanel.tsx` ← Remove hardcoded pwd checks, UUID handling
- [ ] `server.ts` ← Major rewrite (see section 5 above)

---

## Key Architectural Points

1. **UUIDs everywhere**: Employee IDs, project references, task assignments all use `UUID` not email/phone
2. **RLS is the boundary**: Queries run as the authenticated user, so `WHERE user_id = auth.uid()` filters apply automatically
3. **No hardcoded credentials**: First admin created manually, all others via the app
4. **Per-request DB client**: Each Express request gets a Supabase client scoped to that user's JWT, ensuring RLS applies
5. **Supabase sessions**: Client uses `supabase.auth.getSession()` and `onAuthStateChange()`, no custom token store

---

## Rollback Plan

If you need to revert:
1. Restore the old `supabase_schema.sql` via another SQL migration
2. Revert the client code (Login.tsx, App.tsx, dbService.ts) from git
3. Revert server.ts changes
4. No Supabase Auth accounts will exist, but the old session token system remains intact

---

## Questions?

Refer back to the approved plan at `/home/karthikch/.claude/plans/lets-remove-all-hard-reflective-quilt.md` for full architectural reasoning.
