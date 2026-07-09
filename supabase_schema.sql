-- Supabase Schema for Firebase Task Manager (Innovalley Workspace)
-- Copy and paste this script directly into your Supabase SQL Editor to create all the required tables.

-- 1. Create employees table
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY, -- Holds normalized email (e.g. mbmnmurali@gmail.com)
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  designation TEXT,
  role TEXT DEFAULT 'employee' CHECK (role IN ('admin', 'employee'))
);

-- Enable row-level security (RLS) but default to allow all reads/writes if desired,
-- or disable RLS for convenience since the backend server acts as a proxy.
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;

-- 2. Create projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  "createdBy" TEXT,
  members JSONB DEFAULT '[]'::jsonb, -- List of employee emails
  "createdAt" BIGINT
);

ALTER TABLE projects DISABLE ROW LEVEL SECURITY;

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
  "createdAt" BIGINT,
  "updatedAt" BIGINT
);

ALTER TABLE tasks DISABLE ROW LEVEL SECURITY;

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

ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;

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

ALTER TABLE logs DISABLE ROW LEVEL SECURITY;

-- Seed default admin profiles (if you want to pre-populate)
INSERT INTO employees (id, name, email, phone, designation, role)
VALUES 
  ('innovalleyservices@gmail.com', 'Innovalley Services', 'innovalleyservices@gmail.com', '9848884897', 'Project Director (Admin)', 'admin'),
  ('mbmnmurali@gmail.com', 'Murali Krishna', 'mbmnmurali@gmail.com', '9848884897', 'Admin (Owner)', 'employee')
ON CONFLICT (id) DO UPDATE 
SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone, designation = EXCLUDED.designation, role = EXCLUDED.role;
