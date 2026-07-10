-- Supabase Full Table Schema & Security Configuration for Innovalley workspace
-- Copy and paste this entire script directly into your Supabase SQL Editor (SQL editor -> New Query -> Paste -> Run)
-- This creates all required tables, disables Row-Level Security (RLS) to allow standard operations,
-- and creates permissive security policies as a robust backup to guarantee error-free connections.

-- ====================================================================================
-- 1. CLEANUP / RESET (Optional: Uncomment the lines below if you want to reset everything)
-- ====================================================================================
-- DROP TABLE IF EXISTS logs CASCADE;
-- DROP TABLE IF EXISTS notifications CASCADE;
-- DROP TABLE IF EXISTS tasks CASCADE;
-- DROP TABLE IF EXISTS projects CASCADE;
-- DROP TABLE IF EXISTS employees CASCADE;

-- ====================================================================================
-- 2. CREATE TABLES
-- ====================================================================================

-- 1. Create employees table
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY, -- Holds normalized email (e.g. mbmnmurali@gmail.com)
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  designation TEXT,
  role TEXT DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
  password TEXT DEFAULT '123456'
);

-- 2. Create projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  "createdBy" TEXT,
  members JSONB DEFAULT '[]'::jsonb, -- List of employee emails
  "createdAt" BIGINT
);

-- 3. Create tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  "projectId" TEXT,
  title TEXT NOT NULL,
  description TEXT,
  "assignedTo" TEXT,
  "assignedBy" TEXT,
  status TEXT DEFAULT 'assigned' CHECK (status IN ('assigned', 'rejected', 'in progress', 'completed')),
  attachment JSONB, -- Attachment object with name, type, size, data (base64)
  "rejectionNotes" TEXT,
  "notDoneNotes" TEXT,
  "completedRemarks" TEXT,
  "completionAttachment" JSONB,
  "createdAt" BIGINT,
  "updatedAt" BIGINT
);

-- 4. Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
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

-- 5. Create logs table
CREATE TABLE IF NOT EXISTS logs (
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
-- 3. ROW LEVEL SECURITY (RLS) BYPASS & PUBLIC ACCESS POLICIES
-- ====================================================================================

-- Explicitly disable Row-Level Security (RLS) for convenience as our backend behaves as a secure proxy
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE tasks DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE logs DISABLE ROW LEVEL SECURITY;

-- Just in case RLS gets automatically enabled, define permissive policies to prevent policy violation errors
DROP POLICY IF EXISTS "Allow public access" ON employees;
CREATE POLICY "Allow public access" ON employees FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public access" ON projects;
CREATE POLICY "Allow public access" ON projects FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public access" ON tasks;
CREATE POLICY "Allow public access" ON tasks FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public access" ON notifications;
CREATE POLICY "Allow public access" ON notifications FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public access" ON logs;
CREATE POLICY "Allow public access" ON logs FOR ALL TO public USING (true) WITH CHECK (true);

-- ====================================================================================
-- 4. SEED REQUIRED ADMIN ACCOUNTS
-- ====================================================================================
INSERT INTO employees (id, name, email, phone, designation, role, password)
VALUES 
  ('9848884897', 'Innovalley Services', 'innovalleyservices@gmail.com', '9848884897', 'Project Director (Admin)', 'admin', 'Mbmn@B!#!951'),
  ('9848884899', 'Murali Krishna', 'mbmnmurali@gmail.com', '9848884899', 'Lead Developer', 'employee', 'Mbmn@B!#!951')
ON CONFLICT (id) DO UPDATE 
SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone, designation = EXCLUDED.designation, role = EXCLUDED.role, password = EXCLUDED.password;
