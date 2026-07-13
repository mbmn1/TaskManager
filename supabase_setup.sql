-- ========================================================================
-- INNOVALLEY WORKSPACE - FRESH SUPABASE SCHEMA SETUP & IMPORT
-- ========================================================================
-- Run this script in your Supabase SQL Editor to wipe out any legacy 
-- UUID tables and recreate them using TEXT primary keys. This ensures
-- login, tracking, task assignment, and notifications function properly.

-- 1. Wipe out existing tables to start clean
DROP TABLE IF EXISTS attendance CASCADE;
DROP TABLE IF EXISTS logs CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS employees CASCADE;

-- 2. Create employees table (TEXT primary key to accept phone numbers/emails directly)
CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  designation TEXT,
  role TEXT DEFAULT 'employee' CHECK (role IN ('admin', 'employee', 'client')),
  password TEXT DEFAULT '123456',
  "trackAttendance" BOOLEAN DEFAULT TRUE
);

-- 3. Create projects table
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  "createdBy" TEXT,
  members JSONB DEFAULT '[]'::jsonb,
  "createdAt" BIGINT
);

-- 4. Create tasks table
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  "projectId" TEXT,
  title TEXT NOT NULL,
  description TEXT,
  "assignedTo" TEXT,
  "assignedBy" TEXT,
  status TEXT DEFAULT 'assigned' CHECK (status IN ('assigned', 'rejected', 'in progress', 'completed')),
  attachment JSONB,
  "rejectionNotes" TEXT,
  "notDoneNotes" TEXT,
  "completedRemarks" TEXT,
  "completionAttachment" JSONB,
  "createdAt" BIGINT,
  "updatedAt" BIGINT
);

-- 5. Create notifications table
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

-- 6. Create logs table
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

-- 7. Create attendance table
CREATE TABLE attendance (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  date TEXT NOT NULL,
  punch_in TEXT,
  punch_out TEXT,
  status TEXT DEFAULT 'present',
  total_hours TEXT,
  notes TEXT
);

-- 8. Disable RLS and set public policies to allow API operations directly
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE tasks DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendance DISABLE ROW LEVEL SECURITY;

-- 9. Seed Default Admin User
INSERT INTO employees (id, name, email, phone, designation, role, password, "trackAttendance")
VALUES ('9848884897', 'Admin', 'Innovalleyservices@gmail.com', '9848884897', 'Administrator', 'admin', '123456', false)
ON CONFLICT (id) DO UPDATE 
SET name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role, password = EXCLUDED.password, "trackAttendance" = EXCLUDED."trackAttendance";

-- ========================================================================
-- SETUP COMPLETED SUCCESSFULLY
-- ========================================================================
