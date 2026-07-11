-- Supabase Auth Migration: UUID identities + RLS enforcement
-- Migrates from custom auth (TEXT IDs, email/phone mixing) to real Supabase Auth (UUID identities, RLS policies)
-- Created: 2026-07-11

-- ====================================================================================
-- 1. CLEANUP: Drop old tables (they'll be recreated)
-- ====================================================================================

DROP TABLE IF EXISTS logs CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS employees CASCADE;

-- ====================================================================================
-- 2. CREATE NEW TABLES WITH UUID PRIMARY KEYS
-- ====================================================================================

-- 1. employees: Profile table keyed by auth.users(id)
-- Password is gone — Supabase Auth owns it
CREATE TABLE employees (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,           -- Denormalized display copy, never used as lookup key
  phone TEXT,
  designation TEXT,
  role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin','employee')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. projects: All references now use UUID
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES employees(id),
  members JSONB DEFAULT '[]'::jsonb,   -- JSONB array of employee UUID strings (for array-contains queries)
  "createdAt" BIGINT
);

-- 3. tasks: All references now use UUID, cascade delete on project
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" UUID REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  "assignedTo" UUID REFERENCES employees(id),
  "assignedBy" UUID REFERENCES employees(id),
  status TEXT DEFAULT 'assigned' CHECK (status IN ('assigned', 'rejected', 'in progress', 'completed')),
  attachment JSONB,
  "rejectionNotes" TEXT,
  "notDoneNotes" TEXT,
  "completedRemarks" TEXT,
  "completionAttachment" JSONB,
  "createdAt" BIGINT,
  "updatedAt" BIGINT
);

-- 4. notifications: Unchanged schema (toEmail is display-only, not identity)
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  "toEmail" TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  timestamp BIGINT,
  status TEXT DEFAULT 'sent',
  "taskTitle" TEXT,
  "projectId" TEXT,
  "projectName" TEXT
);

-- 5. logs: Unchanged schema (operatorPhone/operatorName are display-only)
CREATE TABLE logs (
  id TEXT PRIMARY KEY,
  "projectId" TEXT,
  "projectName" TEXT,
  action TEXT,
  details TEXT,
  "operatorPhone" TEXT,
  "operatorName" TEXT,
  timestamp BIGINT
);

-- ====================================================================================
-- 3. ENABLE RLS AND CREATE HELPER FUNCTIONS
-- ====================================================================================

-- Enable RLS on all tables
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;

-- Helper function to avoid RLS recursion: check current user's role without re-evaluating RLS
CREATE OR REPLACE FUNCTION current_employee_role()
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT role FROM employees WHERE id = auth.uid()
$$;

-- Prevent role escalation: only admins can change role field
CREATE OR REPLACE FUNCTION prevent_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND current_employee_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only administrators can change role';
  END IF;
  RETURN NEW;
END;
$$;

-- Grant execute permissions for the RLS helper
REVOKE EXECUTE ON FUNCTION current_employee_role() FROM public;
GRANT EXECUTE ON FUNCTION current_employee_role() TO authenticated;

-- ====================================================================================
-- 4. CREATE RLS POLICIES
-- ====================================================================================

-- EMPLOYEES TABLE POLICIES

-- Employees are visible to all authenticated users (current permission model)
CREATE POLICY "employees_select_authenticated"
  ON employees FOR SELECT
  TO authenticated
  USING (true);

-- Any authenticated user can update employee records (name, email, phone, designation)
-- BUT: role escalation is prevented by the trigger, not the policy
CREATE POLICY "employees_update_authenticated"
  ON employees FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Any authenticated user can delete any employee EXCEPT admins
CREATE POLICY "employees_delete_authenticated"
  ON employees FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND role <> 'admin');

-- Employee creation only via service-role client (auth.admin.createUser + app code)
-- No authenticated policy — RLS will reject insert attempts

-- Add the role-escalation prevention trigger
DROP TRIGGER IF EXISTS trg_prevent_role_escalation ON employees;
CREATE TRIGGER trg_prevent_role_escalation BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION prevent_role_escalation();

-- PROJECTS TABLE POLICIES

-- Admin sees all projects; others see only projects they created or are members of
CREATE POLICY "projects_select_authenticated"
  ON projects FOR SELECT
  TO authenticated
  USING (
    current_employee_role() = 'admin'
    OR members ? (auth.uid())::text
    OR created_by = auth.uid()
  );

-- Only admins can create projects
CREATE POLICY "projects_insert_admin_only"
  ON projects FOR INSERT
  TO authenticated
  WITH CHECK (current_employee_role() = 'admin');

-- Any authenticated user can update/delete projects (app-level requireAuth guards the endpoints)
CREATE POLICY "projects_update_authenticated"
  ON projects FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "projects_delete_authenticated"
  ON projects FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- TASKS TABLE POLICIES

-- Admin sees all tasks; others see only tasks assigned to them or created by them
CREATE POLICY "tasks_select_authenticated"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    current_employee_role() = 'admin'
    OR "assignedTo" = auth.uid()
    OR "assignedBy" = auth.uid()
  );

-- Any authenticated user can create tasks, but assignedBy must be themselves (hardened)
CREATE POLICY "tasks_insert_authenticated"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND "assignedBy" = auth.uid()
  );

-- Only admins or the assigned-to user can update tasks
CREATE POLICY "tasks_update_authenticated"
  ON tasks FOR UPDATE
  TO authenticated
  USING (
    current_employee_role() = 'admin'
    OR "assignedTo" = auth.uid()
  )
  WITH CHECK (
    current_employee_role() = 'admin'
    OR "assignedTo" = auth.uid()
  );

-- Any authenticated user can delete tasks (current permission model)
CREATE POLICY "tasks_delete_authenticated"
  ON tasks FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- NOTIFICATIONS TABLE POLICIES

-- Any authenticated user can view and create/delete notifications (current permission model)
CREATE POLICY "notifications_select_authenticated"
  ON notifications FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "notifications_insert_authenticated"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "notifications_delete_authenticated"
  ON notifications FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- LOGS TABLE POLICIES

-- Any authenticated user can view and create logs (current permission model)
CREATE POLICY "logs_select_authenticated"
  ON logs FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "logs_insert_authenticated"
  ON logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- ====================================================================================
-- 5. INDEXES (for performance on common queries)
-- ====================================================================================

CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks("projectId");
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks("assignedTo");
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON tasks("assignedBy");

-- ====================================================================================
-- NOTES FOR IMPLEMENTER:
-- ====================================================================================
--
-- 1. NO SEED DATA: This migration does NOT create any employees. The first admin account
--    must be created manually via the Supabase Dashboard:
--    - Auth → Users → Add User (set email + password, mark email confirmed)
--    - Table Editor → employees → Insert (id = the auth.users UUID, role = 'admin', plus display fields)
--
-- 2. DBWrapper.add() CHANGE: server.ts currently generates ids via Math.random().toString(36).
--    Change this to crypto.randomUUID() to match the new UUID columns.
--
-- 3. DATABASE CONSTRAINTS: tasks."projectId" now has ON DELETE CASCADE, so the manual
--    "loop and delete tasks" cleanup in server.ts DELETE /api/projects/:id can be removed.
--
-- 4. RLS IS NOW REAL: Every query via authenticated requests now runs as that user,
--    enforced by these policies at the DB level. App-level checks (requireAuth/requireAdmin)
--    remain as a UX fast-fail layer, but RLS is the real security boundary.
