import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import { Client } from "pg";
import crypto from "crypto";

dotenv.config();

// Helper to sanitize PostgreSQL URLs if they have special characters in the password (like @)
function sanitizeDatabaseUrl(url: string): string {
  if (!url) return url;
  try {
    const prefixMatch = url.match(/^(postgres(?:ql)?:\/\/)/i);
    if (!prefixMatch) return url;
    const prefix = prefixMatch[1];
    const remaining = url.substring(prefix.length);
    
    const lastAtIndex = remaining.lastIndexOf('@');
    if (lastAtIndex === -1) return url;
    
    const credentials = remaining.substring(0, lastAtIndex);
    const hostPart = remaining.substring(lastAtIndex + 1);
    
    const firstColonIndex = credentials.indexOf(':');
    if (firstColonIndex === -1) return url;
    
    const user = credentials.substring(0, firstColonIndex);
    const rawPassword = credentials.substring(firstColonIndex + 1);
    
    const decodedPassword = decodeURIComponent(rawPassword);
    const encodedPassword = encodeURIComponent(decodedPassword);
    
    return `${prefix}${user}:${encodedPassword}@${hostPart}`;
  } catch (err) {
    console.warn("Failed to sanitize database URL:", err);
    return url;
  }
}

// Convert any string to a deterministic valid UUIDv4-like string using md5 hash
function toUUID(str: string): string {
  if (!str) return str;
  // If it's already a valid UUID format, return it
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
    return str.toLowerCase();
  }
  const hash = crypto.createHash("md5").update(str.toLowerCase().trim()).digest("hex");
  const part1 = hash.substring(0, 8);
  const part2 = hash.substring(8, 12);
  const part3 = "4" + hash.substring(13, 16); // force version 4
  const part4 = "8" + hash.substring(17, 20); // force variant 8
  const part5 = hash.substring(20, 32);
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}


// Automatic Supabase Table Schema & Seed Bootstrapper
async function runSupabaseMigrations() {
  const rawDbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!rawDbUrl) {
    console.warn("No DATABASE_URL or SUPABASE_DB_URL found. Skipping automatic schema migration.");
    return;
  }
  
  const dbUrl = sanitizeDatabaseUrl(rawDbUrl);
  console.log("Connecting to Supabase PostgreSQL database to run schema setup...");
  let client: any = null;

  try {
    client = new Client({
      connectionString: dbUrl,
      ssl: {
        rejectUnauthorized: false
      }
    });

    await client.connect();
    console.log("Connected to Supabase PostgreSQL database. Verification and migrations started...");

    // Pre-check: If legacy employees.id was a UUID (from an old schema or preset), drop the old tables 
    // to perform a clean text-primary-key reset so that non-UUID primary keys work.
    await client.query(`
      DO $$
      DECLARE
        col_type text;
      BEGIN
        SELECT data_type INTO col_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'id';
        
        -- If the table exists and the ID column is NOT a text/varchar type, drop everything to rebuild.
        IF col_type IS NOT NULL AND col_type <> 'text' AND col_type <> 'character varying' THEN
          DROP TABLE IF EXISTS attendance CASCADE;
          DROP TABLE IF EXISTS logs CASCADE;
          DROP TABLE IF EXISTS notifications CASCADE;
          DROP TABLE IF EXISTS tasks CASCADE;
          DROP TABLE IF EXISTS projects CASCADE;
          DROP TABLE IF EXISTS employees CASCADE;
        END IF;
      END $$;
    `);

    // 1. Create employees table
    await client.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        designation TEXT,
        role TEXT DEFAULT 'employee' CHECK (role IN ('admin', 'employee', 'client')),
        password TEXT DEFAULT '123456',
        "trackAttendance" BOOLEAN DEFAULT TRUE
      );
    `);

    // Ensure password and trackAttendance columns exist and drop old check constraint
    await client.query(`
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS password TEXT DEFAULT '123456';
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS "trackAttendance" BOOLEAN DEFAULT TRUE;
      ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
      ALTER TABLE employees ADD CONSTRAINT employees_role_check CHECK (role IN ('admin', 'employee', 'client'));
    `);

    // 2. Create projects table
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        "createdBy" TEXT,
        members JSONB DEFAULT '[]'::jsonb,
        "createdAt" BIGINT
      );
    `);

    // 3. Create tasks table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
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
    `);

    // Ensure completionAttachment column exists if the table was created previously without it
    await client.query(`
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "completionAttachment" JSONB;
    `);

    // 4. Create notifications table
    await client.query(`
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
    `);

    // 5. Create logs table
    await client.query(`
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
    `);

    // 6. Create attendance table
    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance (
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
    `);

    // Ensure Row Level Security (RLS) is disabled, and create permissive public policies
    // to prevent "new row violates row-level security policy" errors if anon key is used.
    const tables = ["employees", "projects", "tasks", "notifications", "logs", "attendance"];
    for (const table of tables) {
      try {
        await client.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;`);
        await client.query(`DROP POLICY IF EXISTS "Allow public access" ON ${table};`);
        // We wrap in a block to safely execute policy creation as CREATE POLICY requires RLS enabled
        await client.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_policies WHERE tablename = '${table}' AND policyname = 'Allow public access'
            ) THEN
              CREATE POLICY "Allow public access" ON ${table} FOR ALL TO public USING (true) WITH CHECK (true);
            END IF;
          END
          $$;
        `);
      } catch (err: any) {
        console.warn(`Note on table '${table}' RLS configuration: ${err.message}`);
      }
    }

    // Safely seed default Admin user if no administrator exists to avoid overriding custom DB modifications
    const adminCheck = await client.query("SELECT COUNT(*) FROM employees WHERE role = 'admin';");
    const adminCount = parseInt(adminCheck.rows[0].count, 10);
    if (adminCount === 0) {
      console.log("No administrator accounts found in Supabase. Seeding default Admin user...");
      const adminId = toUUID('9848884897');
      await client.query(`
        INSERT INTO employees (id, name, email, phone, designation, role, password, "trackAttendance")
        VALUES ($1, 'Admin', 'Innovalleyservices@gmail.com', '9848884897', 'Administrator', 'admin', '123456', false);
      `, [adminId]);
      console.log("Default Admin user (Admin, 9848884897) seeded successfully in Supabase.");
    } else {
      console.log("Supabase already has an administrator account. Skipping auto-seeding.");
    }
  } catch (err: any) {
    console.error("Failed to run Supabase PostgreSQL migrations:", err.message);
  } finally {
    if (client) {
      try {
        await client.end();
      } catch (e) {}
    }
  }
}


// Initialize Supabase if keys are provided
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";

let supabase: any = null;
if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false
      }
    });
    console.log("Supabase Client initialized successfully.");
  } catch (err) {
    console.error("Failed to initialize Supabase Client:", err);
  }
}

// Local DB in-memory cache (no file persistence)
let localDB: { [collection: string]: { [id: string]: any } } = {
  employees: {
    "9848884897": {
      id: "9848884897",
      name: "Admin",
      email: "Innovalleyservices@gmail.com",
      phone: "9848884897",
      designation: "Administrator",
      role: "admin",
      password: "123456",
      trackAttendance: false
    }
  },
  projects: {},
  tasks: {},
  notifications: {},
  logs: {}
};

class DBWrapper {
  public useLocalFallback = false;

  async testSupabase() {
    if (!supabase) {
      console.error("Supabase configuration is missing! Database access is disabled.");
      throw new Error("Supabase is not connected! Database is unavailable.");
    }
    this.useLocalFallback = false;
    console.log("Supabase client active. Strict sync enabled with zero local fallback.");

    // No-op. Skip REST API cleanup/seeding to avoid overriding custom DB modifications
    console.log("Supabase REST API auto-seeding bypassed as requested.");
  }

  checkRLSError(err: any) {
    if (!err) return;
    const msg = (err.message || "").toLowerCase();
    console.warn("Supabase query warning:", msg);
  }

  collection(name: string) {
    const self = this;
    
    class CollectionQuery {
      private filters: Array<{ field: string; op: string; val: any }> = [];
      private sortField: string | null = null;
      private sortDir: "asc" | "desc" = "asc";

      where(field: string, op: string, val: any) {
        this.filters.push({ field, op, val });
        return this;
      }

      orderBy(field: string, direction: "asc" | "desc" = "asc") {
        this.sortField = field;
        this.sortDir = direction;
        return this;
      }

      async get(): Promise<any> {
        if (!supabase) {
          throw new Error("Supabase is not connected!");
        }
        try {
          let query = supabase.from(name).select("*");
          
          for (const filter of this.filters) {
            const { field, op, val } = filter;
            if (op === "==") {
              query = query.eq(field, val);
            } else if (op === "array-contains") {
              // Handle JSONB array contains or text array contains in Supabase
              if (field === "members") {
                query = query.contains(field, JSON.stringify([val]));
              } else {
                query = query.contains(field, [val]);
              }
            }
          }

          if (this.sortField) {
            query = query.order(this.sortField, { ascending: this.sortDir === "asc" });
          }

          const { data, error } = await query;
          if (error) {
            console.error(`Supabase query error on '${name}':`, error.message);
            throw error;
          }

          const docs = (data || []).map((item: any) => {
            const rawId = (name === "employees" && item.phone) ? item.phone : (item.id || "");
            const mappedItem = { ...item, id: rawId };
            return {
              id: rawId,
              data: () => mappedItem
            };
          });

          return {
            empty: docs.length === 0,
            size: docs.length,
            docs,
            forEach(callback: any) {
              docs.forEach(doc => callback(doc));
            }
          };
        } catch (err: any) {
          console.error(`Supabase query failed on '${name}':`, err.message);
          self.checkRLSError(err);
          throw err;
        }
      }
    }

    return {
      doc(docId?: string) {
        const rawId = docId || Math.random().toString(36).substring(2, 15);
        const id = (name === "employees") ? toUUID(rawId) : rawId;
        return {
          id: rawId,
          async get() {
            if (!supabase) {
              throw new Error("Supabase is not connected!");
            }
            try {
              const { data, error } = await supabase.from(name).select("*").eq("id", id).maybeSingle();
              if (error) {
                if (error.code === "22P02" || (error.message && error.message.includes("invalid input syntax for type uuid"))) {
                  return {
                    exists: false,
                    id: rawId,
                    data: () => null
                  };
                }
                throw error;
              }
              const mappedData = data ? { ...data, id: (name === "employees" && data.phone) ? data.phone : (data.id || rawId) } : null;
              return {
                exists: !!data,
                id: rawId,
                data: () => mappedData
              };
            } catch (err: any) {
              console.error(`Supabase get doc failed on '${name}/${id}':`, err.message);
              self.checkRLSError(err);
              throw err;
            }
          },

          async set(data: any, options?: { merge?: boolean }) {
            const isMerge = options?.merge === true;
            if (!supabase) {
              throw new Error("Supabase is not connected!");
            }
            try {
              let mergedData = { ...data };
              if (isMerge) {
                const { data: existing, error: getErr } = await supabase.from(name).select("*").eq("id", id).maybeSingle();
                if (getErr) throw getErr;
                if (existing) {
                  mergedData = { ...existing, ...data };
                }
              }
              const { error } = await supabase.from(name).upsert({ id, ...mergedData });
              if (error) throw error;
            } catch (err: any) {
              console.error(`Supabase set doc failed on '${name}/${id}':`, err.message);
              self.checkRLSError(err);
              throw err;
            }
          },

          async update(data: any) {
            if (!supabase) {
              throw new Error("Supabase is not connected!");
            }
            try {
              const { error } = await supabase.from(name).update(data).eq("id", id);
              if (error) throw error;
            } catch (err: any) {
              console.error(`Supabase update doc failed on '${name}/${id}':`, err.message);
              self.checkRLSError(err);
              throw err;
            }
          },

          async delete() {
            if (!supabase) {
              throw new Error("Supabase is not connected!");
            }
            try {
              const { error } = await supabase.from(name).delete().eq("id", id);
              if (error) throw error;
            } catch (err: any) {
              console.error(`Supabase delete doc failed on '${name}/${id}':`, err.message);
              self.checkRLSError(err);
              throw err;
            }
          }
        };
      },

      async add(data: any) {
        const id = Math.random().toString(36).substring(2, 15);
        const ref = this.doc(id);
        await ref.set(data);
        return ref;
      },

      where(field: string, op: string, val: any) {
        return new CollectionQuery().where(field, op, val);
      },

      orderBy(field: string, direction: "asc" | "desc" = "asc") {
        return new CollectionQuery().orderBy(field, direction);
      },

      async get() {
        return new CollectionQuery().get();
      }
    };
  }
}

const db = new DBWrapper();
runSupabaseMigrations()
  .then(() => {
    db.testSupabase();
  })
  .catch((err) => {
    console.error("Critical error in runSupabaseMigrations on startup:", err);
  });

// Lazy initialization of Gemini client
let aiClient: GoogleGenAI | null = null;
function getGeminiClient() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (key && key !== "MY_GEMINI_API_KEY" && key.trim() !== "") {
      aiClient = new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
    }
  }
  return aiClient;
}

const app = express();
export { app };

const otpCodes = new Map<string, string>();
const authChallenges = new Map<string, any>();
const captchaStore = new Map<string, string>();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Monitor and log all server errors (status >= 400) to a local file for diagnosis
app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function (body) {
    if (res.statusCode >= 400) {
      try {
        const logMsg = `[${new Date().toISOString()}] ${req.method} ${req.url} - Status: ${res.statusCode} - Body: ${typeof body === 'string' ? body : JSON.stringify(body)}\n`;
        fs.appendFileSync(path.join(process.cwd(), "server-errors.log"), logMsg);
      } catch (logErr) {
        console.error("Failed to write to error log file:", logErr);
      }
    }
    return originalSend.apply(res, arguments as any);
  };
  next();
});

// Prevent caching for all API endpoints to ensure maximum data privacy and zero local storing/caching
app.use((req, res, next) => {
  if (req.url.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  }
  next();
});

  // API Route for health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // Seed endpoint bypassed to preserve existing Supabase-only logins
  app.post("/api/employees/seed", async (req, res) => {
    res.json({ success: true, seeded: false, message: "Automatic seeding disabled as requested. Fetching logins from Supabase only." });
  });

  // List all employees
  app.get("/api/employees", async (req, res) => {
    try {
      const snapshot = await db.collection("employees").get();
      const list: any[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        list.push({
          id: doc.id,
          phone: data.phone || "",
          ...data
        });
      });
      res.json(list);
    } catch (err: any) {
      console.error("Error listing employees on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Add new employee
  app.post("/api/employees", async (req, res) => {
    try {
      const employee = req.body;
      const phoneNormalized = employee.phone ? employee.phone.replace(/[^0-9]/g, "") : "";
      if (!phoneNormalized || phoneNormalized.length < 10) {
        return res.status(400).json({ error: "A valid 10-digit mobile number is required as the primary ID." });
      }
      
      const empRef = db.collection("employees").doc(phoneNormalized);
      const existing = await empRef.get();
      if (existing.exists) {
        return res.status(400).json({ error: "An employee with this mobile number already exists." });
      }

      const emailNormalized = employee.email.trim().toLowerCase();
      const newEmp = {
        ...employee,
        id: phoneNormalized,
        email: emailNormalized,
        phone: phoneNormalized,
        password: employee.password ? employee.password.trim() : "123456",
        role: employee.role || 'employee',
        trackAttendance: employee.trackAttendance !== undefined ? employee.trackAttendance : true
      };
      await empRef.set(newEmp);
      res.json(newEmp);
    } catch (err: any) {
      console.error("Error adding employee on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Edit employee details (Admin action)
  app.put("/api/employees/:email", async (req, res) => {
    try {
      const { email } = req.params;
      const emailNormalized = email.trim().toLowerCase();
      const { name, email: newEmail, phone, designation, role } = req.body;
      
      let empRef = db.collection("employees").doc(emailNormalized);
      let docSnap = await empRef.get();
      
      if (!docSnap.exists) {
        // 1. Try query by email field
        let querySnapshot = await db.collection("employees").where("email", "==", emailNormalized).get();
        if (!querySnapshot.empty) {
          let foundDocId = "";
          querySnapshot.forEach((d: any) => { foundDocId = d.id; });
          empRef = db.collection("employees").doc(foundDocId);
          docSnap = await empRef.get();
        } else {
          // 2. Try query by phone field
          querySnapshot = await db.collection("employees").where("phone", "==", emailNormalized).get();
          if (!querySnapshot.empty) {
            let foundDocId = "";
            querySnapshot.forEach((d: any) => { foundDocId = d.id; });
            empRef = db.collection("employees").doc(foundDocId);
            docSnap = await empRef.get();
          } else {
            // 3. Try query by cleaned phone number
            const cleaned = emailNormalized.replace(/[^0-9]/g, "");
            if (cleaned) {
              querySnapshot = await db.collection("employees").where("phone", "==", cleaned).get();
              if (!querySnapshot.empty) {
                let foundDocId = "";
                querySnapshot.forEach((d: any) => { foundDocId = d.id; });
                empRef = db.collection("employees").doc(foundDocId);
                docSnap = await empRef.get();
              }
            }
          }
        }
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (newEmail !== undefined) updateData.email = newEmail;
      if (phone !== undefined) updateData.phone = phone;
      if (designation !== undefined) updateData.designation = designation;
      if (role !== undefined) updateData.role = role;
      if (req.body.password !== undefined) updateData.password = req.body.password;
      if (req.body.trackAttendance !== undefined) updateData.trackAttendance = req.body.trackAttendance;
      
      if (docSnap && docSnap.exists) {
        await empRef.update(updateData);
      } else {
        // Fallback: If document still doesn't exist, use set with merge to avoid crash
        await empRef.set(updateData, { merge: true });
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error editing employee on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Delete an employee (Admin action)
  app.delete("/api/employees/:email", async (req, res) => {
    try {
      const { email } = req.params;
      const emailNormalized = email.trim().toLowerCase();
      
      let empRef = db.collection("employees").doc(emailNormalized);
      let docSnap = await empRef.get();
      if (!docSnap.exists) {
        // 1. Try query by email field
        let querySnapshot = await db.collection("employees").where("email", "==", emailNormalized).get();
        if (!querySnapshot.empty) {
          let foundDocId = "";
          querySnapshot.forEach((d: any) => { foundDocId = d.id; });
          empRef = db.collection("employees").doc(foundDocId);
          docSnap = await empRef.get();
        } else {
          // 2. Try query by phone field
          querySnapshot = await db.collection("employees").where("phone", "==", emailNormalized).get();
          if (!querySnapshot.empty) {
            let foundDocId = "";
            querySnapshot.forEach((d: any) => { foundDocId = d.id; });
            empRef = db.collection("employees").doc(foundDocId);
            docSnap = await empRef.get();
          } else {
            // 3. Try query by cleaned phone number
            const cleaned = emailNormalized.replace(/[^0-9]/g, "");
            if (cleaned) {
              querySnapshot = await db.collection("employees").where("phone", "==", cleaned).get();
              if (!querySnapshot.empty) {
                let foundDocId = "";
                querySnapshot.forEach((d: any) => { foundDocId = d.id; });
                empRef = db.collection("employees").doc(foundDocId);
                docSnap = await empRef.get();
              }
            }
          }
        }
      }

      if (docSnap.exists) {
        const empData = docSnap.data();
        if (empData && empData.role === "admin") {
          res.status(400).json({ error: "Administrator accounts cannot be deleted." });
          return;
        }
      }

      await empRef.delete();
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error deleting employee on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET Attendance logs (Admin or Employee query)
  app.get("/api/attendance", async (req, res) => {
    try {
      const { employee_id, date } = req.query;
      let ref: any = db.collection("attendance");
      if (employee_id) {
        ref = ref.where("employee_id", "==", employee_id.toString());
      }
      if (date) {
        ref = ref.where("date", "==", date.toString());
      }
      const snapshot = await ref.get();
      const list: any[] = [];
      snapshot.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() });
      });
      res.json(list);
    } catch (err: any) {
      console.error("Error listing attendance logs on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST Attendance Punch-In
  app.post("/api/attendance/punch-in", async (req, res) => {
    try {
      const { employee_id, employee_name, date, punch_in, notes } = req.body;
      if (!employee_id || !date || !punch_in) {
        return res.status(400).json({ error: "employee_id, date, and punch_in are required." });
      }
      const recordId = `${employee_id}_${date}`;
      const docRef = db.collection("attendance").doc(recordId);
      const existing = await docRef.get();
      if (existing.exists) {
        return res.status(400).json({ error: "Already punched in for today." });
      }
      const newRecord = {
        id: recordId,
        employee_id,
        employee_name,
        date,
        punch_in,
        punch_out: null,
        status: "present",
        total_hours: null,
        notes: notes || ""
      };
      await docRef.set(newRecord);
      res.json(newRecord);
    } catch (err: any) {
      console.error("Error recording punch-in:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST Attendance Punch-Out
  app.post("/api/attendance/punch-out", async (req, res) => {
    try {
      const { employee_id, date, punch_out, total_hours } = req.body;
      if (!employee_id || !date || !punch_out) {
        return res.status(400).json({ error: "employee_id, date, and punch_out are required." });
      }
      const recordId = `${employee_id}_${date}`;
      const docRef = db.collection("attendance").doc(recordId);
      const existing = await docRef.get();
      if (!existing.exists) {
        return res.status(400).json({ error: "No punch-in record found for today." });
      }
      const recordData = existing.data();
      if (recordData.punch_out) {
        return res.status(400).json({ error: "Already punched out for today." });
      }
      await docRef.update({
        punch_out,
        total_hours: total_hours || ""
      });
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error recording punch-out:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST Task reassignment / pushing
  app.post("/api/tasks/:id/reassign", async (req, res) => {
    try {
      const { id } = req.params;
      const { assignedTo, operatorPhone, operatorName } = req.body;
      if (!assignedTo) {
        return res.status(400).json({ error: "assignedTo is required" });
      }

      const taskRef = db.collection("tasks").doc(id);
      const taskSnap = await taskRef.get();
      if (!taskSnap.exists) {
        return res.status(404).json({ error: "Task not found" });
      }

      const taskData = taskSnap.data();
      const previousAssignee = taskData.assignedTo;

      await taskRef.update({
        assignedTo,
        updatedAt: Date.now()
      });

      // Write log
      const logId = Math.random().toString(36).substring(2, 15);
      await db.collection("logs").doc(logId).set({
        id: logId,
        projectId: taskData.projectId,
        projectName: "",
        action: "TASK_REASSIGNED",
        details: `Task "${taskData.title}" was re-assigned to ${assignedTo} by ${operatorName}`,
        operatorPhone: operatorPhone || "",
        operatorName: operatorName || "",
        timestamp: Date.now()
      });

      res.json({ success: true, previousAssignee, newAssignee: assignedTo });
    } catch (err: any) {
      console.error("Error reassigning task on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Helper to generate the randomized email masking challenge
  function generateEmailChallenge(email: string) {
    const parts = email.split("@");
    const prefix = parts[0] || "";
    const domain = parts[1] || "gmail.com";
    
    if (prefix.length <= 2) {
      return {
        maskedEmail: `*${prefix.slice(1)}@${domain}`,
        missingAnswer: prefix[0].toLowerCase()
      };
    }
    
    // Choose random indices to mask (e.g., about 40% of characters)
    const len = prefix.length;
    const numToMask = Math.max(2, Math.min(5, Math.floor(len * 0.4)));
    
    const indices: number[] = [];
    while (indices.length < numToMask) {
      const idx = Math.floor(Math.random() * len);
      if (!indices.includes(idx)) {
        indices.push(idx);
      }
    }
    indices.sort((a, b) => a - b);
    
    const chars = prefix.split("");
    const missingLetters: string[] = [];
    indices.forEach(idx => {
      missingLetters.push(chars[idx]);
      chars[idx] = "*";
    });
    
    return {
      maskedEmail: `${chars.join("")}@${domain}`,
      missingAnswer: missingLetters.join("").toLowerCase()
    };
  }

  // Generate a new alphanumeric captcha (stateless signature-based to support multi-container/serverless)
  app.get("/api/auth/captcha", (req, res) => {
    try {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // clear alphanumeric chars
      let captchaText = "";
      for (let i = 0; i < 4; i++) {
        captchaText += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      
      const timestamp = Date.now();
      const salt = process.env.JWT_SECRET || "innovalley-secure-salt-2026";
      const hash = crypto.createHmac("sha256", salt).update(`${timestamp}-${captchaText}`).digest("hex");
      const captchaId = `${timestamp}.${hash}`;

      res.json({ captchaId, captchaText });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Verify and Login
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { identifier, password } = req.body;
      const input = (identifier || "").toString().trim();
      const pass = (password || "").toString().trim();

      if (!input || !pass) {
        return res.status(400).json({ error: "Mobile Number and PIN are required." });
      }

      const inputNormalized = input.toLowerCase();

      // Search for employee by email or phone
      let matchedEmployee: any = null;
      
      if (inputNormalized.includes("@")) {
        // Query by email
        const emailSnap = await db.collection("employees").where("email", "==", inputNormalized).get();
        if (!emailSnap.empty) {
          emailSnap.forEach((doc: any) => {
            matchedEmployee = doc.data();
          });
        }
      } else {
        const cleanedPhone = inputNormalized.replace(/[^0-9]/g, "");
        if (cleanedPhone) {
          // 1. Try document ID first (which is primary phone)
          const empRef = db.collection("employees").doc(cleanedPhone);
          const empSnap = await empRef.get();
          if (empSnap.exists) {
            matchedEmployee = empSnap.data();
          } else {
            // 2. Query by phone field fallback
            const phoneSnap = await db.collection("employees").where("phone", "==", cleanedPhone).get();
            if (!phoneSnap.empty) {
              phoneSnap.forEach((doc: any) => {
                matchedEmployee = doc.data();
              });
            }
          }
        }
      }

      if (!matchedEmployee) {
        return res.status(404).json({ error: "User is not registered in the system. Please ask Admin to add you." });
      }

      // Check PIN (stored in .password column for backwards compatibility)
      const dbPassword = matchedEmployee.password || "123456"; // default fallback for pre-existing accounts
      if (pass !== dbPassword) {
        return res.status(400).json({ error: "Incorrect PIN. Please try again." });
      }

      return res.json({
        success: true,
        employee: matchedEmployee
      });
    } catch (err: any) {
      console.error("Login error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // User changes their own password/PIN
  app.post("/api/auth/change-password", async (req, res) => {
    try {
      const { email, currentPassword, newPassword } = req.body;
      const identifier = (email || "").toString().trim();
      if (!identifier || !newPassword) {
        return res.status(400).json({ error: "Identifier and new PIN are required." });
      }

      let empRef: any = null;
      let employeeData: any = null;

      if (identifier.includes("@")) {
        const emailNormalized = identifier.toLowerCase();
        const emailSnap = await db.collection("employees").where("email", "==", emailNormalized).get();
        if (!emailSnap.empty) {
          emailSnap.forEach((doc: any) => {
            empRef = db.collection("employees").doc(doc.id);
            employeeData = doc.data();
          });
        }
      } else {
        const cleanedPhone = identifier.replace(/[^0-9]/g, "");
        if (cleanedPhone) {
          const directRef = db.collection("employees").doc(cleanedPhone);
          const directSnap = await directRef.get();
          if (directSnap.exists) {
            empRef = directRef;
            employeeData = directSnap.data();
          } else {
            const phoneSnap = await db.collection("employees").where("phone", "==", cleanedPhone).get();
            if (!phoneSnap.empty) {
              phoneSnap.forEach((doc: any) => {
                empRef = db.collection("employees").doc(doc.id);
                employeeData = doc.data();
              });
            }
          }
        }
      }

      if (!employeeData || !empRef) {
        return res.status(404).json({ error: "Employee profile not found." });
      }

      const dbPassword = employeeData.password || "123456"; // Default password fallback
      const isCurrentCorrect = currentPassword === dbPassword;
        
      if (!isCurrentCorrect) {
        return res.status(400).json({ error: "Incorrect current PIN." });
      }

      await empRef.update({ password: newPassword });
      res.json({ success: true, message: "PIN updated successfully!" });
    } catch (err: any) {
      console.error("Error changing PIN:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // List projects
  app.get("/api/projects", async (req, res) => {
    try {
      const { userPhone, userEmail, role } = req.query;
      const targetEmail = (userEmail || userPhone || "").toString().trim().toLowerCase();
      
      let queryRef: any = db.collection("projects");
      let snapshot;
      
      const isActuallyAdmin = role === "admin";
      
      if (isActuallyAdmin) {
        snapshot = await queryRef.orderBy("createdAt", "desc").get();
      } else if (targetEmail) {
        snapshot = await queryRef.where("members", "array-contains", targetEmail).get();
      } else {
        snapshot = await queryRef.get();
      }

      const list: any[] = [];
      snapshot.forEach((doc: any) => {
        list.push({ id: doc.id, ...doc.data() });
      });

      list.sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));
      res.json(list);
    } catch (err: any) {
      console.error("Error listing projects on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Create project
  app.post("/api/projects", async (req, res) => {
    try {
      const { name, description, createdBy, members } = req.body;
      const uniqueMembers = Array.from(new Set(members || []));
      
      // Fetch administrative accounts to exclude from standard membership lists
      const adminSnapshot = await db.collection("employees").where("role", "==", "admin").get();
      const adminEmails = new Set<string>();
      adminSnapshot.forEach((doc: any) => {
        const data = doc.data();
        if (data && data.email) {
          adminEmails.add(data.email.trim().toLowerCase());
        }
      });

      const filteredMembers = uniqueMembers.filter((m: any) => typeof m === "string" && !adminEmails.has(m.trim().toLowerCase()));
      const timestamp = Date.now();
      
      const docRef = await db.collection("projects").add({
        name,
        description,
        createdBy,
        members: filteredMembers,
        createdAt: timestamp
      });

      res.json({
        id: docRef.id,
        name,
        description,
        createdBy,
        members: filteredMembers,
        createdAt: timestamp
      });
    } catch (err: any) {
      console.error("Error creating project on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Update project members
  app.put("/api/projects/:id/members", async (req, res) => {
    try {
      const { id } = req.params;
      const { members } = req.body;
      
      const adminSnapshot = await db.collection("employees").where("role", "==", "admin").get();
      const adminEmails = new Set<string>();
      adminSnapshot.forEach((doc: any) => {
        const data = doc.data();
        if (data && data.email) {
          adminEmails.add(data.email.trim().toLowerCase());
        }
      });

      const filteredMembers = (members || []).filter((m: any) => typeof m === "string" && !adminEmails.has(m.trim().toLowerCase()));
      
      let projRef = db.collection("projects").doc(id);
      let docSnap = await projRef.get();
      if (!docSnap.exists) {
        let querySnapshot = await db.collection("projects").where("id", "==", id).get();
        if (!querySnapshot.empty) {
          let foundProjId = "";
          querySnapshot.forEach((d: any) => { foundProjId = d.id; });
          projRef = db.collection("projects").doc(foundProjId);
          docSnap = await projRef.get();
        }
      }

      if (docSnap && docSnap.exists) {
        await projRef.update({ members: filteredMembers });
      } else {
        await projRef.set({ members: filteredMembers }, { merge: true });
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error updating project members on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Edit project details (Admin action)
  app.put("/api/projects/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, members } = req.body;
      
      let projRef = db.collection("projects").doc(id);
      let docSnap = await projRef.get();
      if (!docSnap.exists) {
        // Try query by id
        let querySnapshot = await db.collection("projects").where("id", "==", id).get();
        if (!querySnapshot.empty) {
          let foundProjId = "";
          querySnapshot.forEach((d: any) => { foundProjId = d.id; });
          projRef = db.collection("projects").doc(foundProjId);
          docSnap = await projRef.get();
        } else if (name) {
          // Backup query by name
          querySnapshot = await db.collection("projects").where("name", "==", name).get();
          if (!querySnapshot.empty) {
            let foundProjId = "";
            querySnapshot.forEach((d: any) => { foundProjId = d.id; });
            projRef = db.collection("projects").doc(foundProjId);
            docSnap = await projRef.get();
          }
        }
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (members !== undefined) {
        const adminSnapshot = await db.collection("employees").where("role", "==", "admin").get();
        const adminEmails = new Set<string>();
        adminSnapshot.forEach((doc: any) => {
          const data = doc.data();
          if (data && data.email) {
            adminEmails.add(data.email.trim().toLowerCase());
          }
        });

        updateData.members = members.filter((m: any) => typeof m === "string" && !adminEmails.has(m.trim().toLowerCase()));
      }
      
      if (docSnap && docSnap.exists) {
        await projRef.update(updateData);
      } else {
        await projRef.set(updateData, { merge: true });
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error editing project on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a project and its tasks (Admin action)
  app.delete("/api/projects/:id", async (req, res) => {
    try {
      const { id } = req.params;
      
      let projRef = db.collection("projects").doc(id);
      let docSnap = await projRef.get();
      if (!docSnap.exists) {
        const querySnapshot = await db.collection("projects").where("id", "==", id).get();
        if (!querySnapshot.empty) {
          let foundProjId = "";
          querySnapshot.forEach((d: any) => { foundProjId = d.id; });
          projRef = db.collection("projects").doc(foundProjId);
        }
      }

      await projRef.delete();
      
      // Clean up tasks for this project
      const tasksSnap = await db.collection("tasks").where("projectId", "==", id).get();
      tasksSnap.forEach(async (doc: any) => {
        await db.collection("tasks").doc(doc.id).delete();
      });
      
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error deleting project on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Delete completed tasks for a specific project (Admin action)
  app.delete("/api/projects/:projectId/tasks/completed", async (req, res) => {
    try {
      const { projectId } = req.params;
      const tasksSnap = await db.collection("tasks").where("projectId", "==", projectId).get();
      let deletedCount = 0;
      
      const promises: Promise<any>[] = [];
      tasksSnap.forEach((doc: any) => {
        const taskData = doc.data();
        if (taskData && taskData.status === 'completed') {
          promises.push(db.collection("tasks").doc(doc.id).delete());
          deletedCount++;
        }
      });
      
      await Promise.all(promises);
      res.json({ success: true, deletedCount });
    } catch (err: any) {
      console.error("Error deleting completed tasks on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // List tasks
  app.get("/api/tasks", async (req, res) => {
    try {
      const { projectId, userPhone, userEmail, role } = req.query;
      const targetEmail = (userEmail || userPhone || "").toString().trim().toLowerCase();
      let snapshot;
      
      const isActuallyAdmin = role === "admin";
      
      if (projectId) {
        snapshot = await db.collection("tasks").where("projectId", "==", projectId).get();
      } else {
        snapshot = await db.collection("tasks").get();
      }

      const list: any[] = [];
      snapshot.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() });
      });

      // Filter tasks based on role and email
      let filteredList = list;
      if (!isActuallyAdmin && targetEmail) {
        filteredList = list.filter(t => 
          (t.assignedTo && t.assignedTo.trim().toLowerCase() === targetEmail) || 
          (t.assignedBy && t.assignedBy.trim().toLowerCase() === targetEmail)
        );
      }

      // Filter out completed tasks older than 5 days
      const now = Date.now();
      const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
      filteredList = filteredList.filter(t => {
        if (t.status === 'completed') {
          const compTime = t.updatedAt || t.createdAt || 0;
          return (now - compTime) <= FIVE_DAYS_MS;
        }
        return true;
      });

      filteredList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      res.json(filteredList);
    } catch (err: any) {
      console.error("Error listing tasks on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Create task
  app.post("/api/tasks", async (req, res) => {
    try {
      const { task, project, creator, assignee } = req.body;
      const timestamp = Date.now();
      const newTaskData = {
        ...task,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      const docRef = await db.collection("tasks").add(newTaskData);

      // Create activity audit log
      if (project && creator && assignee) {
        await db.collection("logs").add({
          projectId: project.id,
          projectName: project.name,
          action: "CREATE_TASK",
          details: `Task "${task.title}" was created and assigned to ${assignee.name} (${assignee.email}) by ${creator.name}.`,
          operatorPhone: creator.email, // keeping field as operatorPhone for frontend data structure compatibility
          operatorName: creator.name,
          timestamp
        });
      }

      res.json({
        id: docRef.id,
        ...newTaskData
      });
    } catch (err: any) {
      console.error("Error creating task on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Update task status
  app.put("/api/tasks/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { newStatus, task, project, updater, assignee, rejectionNotes, notDoneNotes, completedRemarks, attachment, completionAttachment } = req.body;
      
      const updateData: any = {
        status: newStatus,
        updatedAt: Date.now()
      };
      
      if (rejectionNotes !== undefined) updateData.rejectionNotes = rejectionNotes;
      if (notDoneNotes !== undefined) updateData.notDoneNotes = notDoneNotes;
      if (completedRemarks !== undefined) updateData.completedRemarks = completedRemarks;
      if (attachment !== undefined) updateData.attachment = attachment;
      if (completionAttachment !== undefined) updateData.completionAttachment = completionAttachment;

      await db.collection("tasks").doc(id).update(updateData);

      // Write log
      if (project && updater && task) {
        let remarkDetails = "";
        if (newStatus === "rejected" && rejectionNotes) {
          remarkDetails = ` Reason/Notes: "${rejectionNotes}".`;
        } else if (newStatus === "in progress" && notDoneNotes) {
          remarkDetails = ` Feedback/Notes: "${notDoneNotes}".`;
        } else if (newStatus === "completed" && completedRemarks) {
          remarkDetails = ` Remarks: "${completedRemarks}".`;
        }

        await db.collection("logs").add({
          projectId: project.id,
          projectName: project.name,
          action: "UPDATE_TASK_STATUS",
          details: `Task "${task.title}" status updated from "${task.status}" to "${newStatus}" by ${updater.name}.${remarkDetails}`,
          operatorPhone: updater.email,
          operatorName: updater.name,
          timestamp: Date.now()
        });
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error("Error updating task status on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // List all audit logs for Admin
  app.get("/api/logs", async (req, res) => {
    try {
      const snapshot = await db.collection("logs").get();
      const list: any[] = [];
      snapshot.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() });
      });
      list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      res.json(list);
    } catch (err: any) {
      console.error("Error listing audit logs on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // List notifications
  app.get("/api/notifications", async (req, res) => {
    try {
      const snapshot = await db.collection("notifications").get();
      const list: any[] = [];
      snapshot.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() });
      });
      list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      res.json(list);
    } catch (err: any) {
      console.error("Error listing notifications on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Log notification
  app.post("/api/notifications", async (req, res) => {
    try {
      const notification = req.body;
      const docRef = await db.collection("notifications").add(notification);
      res.json({ id: docRef.id, ...notification });
    } catch (err: any) {
      console.error("Error logging notification on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // API Route for automated notifications using Gemini
  app.post("/api/notify", async (req, res) => {
    try {
      const {
        toEmail,
        toName,
        taskTitle,
        projectName,
        updaterName,
        previousStatus,
        newStatus,
        actionType,
        description
      } = req.body;

      if (!toEmail) {
        res.status(400).json({ error: "Recipient email is required" });
        return;
      }

      let subject = `Task Notification - ${taskTitle}`;
      let bodyHtml = "";

      const ai = getGeminiClient();
      if (ai) {
        try {
          const prompt = `
            You are an automated notification system for the project management app "Innovalley Workspace".
            Compose a highly professional, polite, and clean notification email regarding a task update.
            
            Details:
            - Recipient Name: ${toName || 'Team Member'}
            - Project Name: ${projectName}
            - Task Title: ${taskTitle}
            - Updated By: ${updaterName}
            - Action Type: ${actionType}
            ${actionType === 'status_change' ? `- Status changed from "${previousStatus}" to "${newStatus}"` : `- New task assigned to them`}
            - Task Description: ${description || 'No additional description provided.'}
            
            Format the response as a valid JSON object with EXACTLY these two keys:
            "subject": "A concise and relevant email subject line"
            "body": "A clean HTML email body, inside a container with modern but simple inline CSS styling. Use high-contrast, professional slate-colored header, readable text size, and soft margins. Do not use generic placeholders. Mention that this is an automated notification from Innovalley Services."
            
            Return ONLY the raw JSON string, do not wrap it in markdown block tags like \`\`\`json.
          `;

          const response = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: prompt,
          });

          const textResult = response.text || "";
          const cleanJsonText = textResult.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
          const parsed = JSON.parse(cleanJsonText);
          
          subject = parsed.subject || subject;
          bodyHtml = parsed.body || `<h3>Update on ${taskTitle}</h3><p>Status changed to ${newStatus}</p>`;
        } catch (aiErr) {
          console.error("Gemini failed, falling back to template:", aiErr);
        }
      }

      if (!bodyHtml) {
        // Fallback templates
        if (actionType === 'status_change') {
          subject = `[Task Status Updated] ${taskTitle} in ${projectName}`;
          bodyHtml = `
            <div style="font-family: sans-serif; padding: 20px; color: #334155; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 8px;">
              <h2 style="color: #0f172a; margin-top: 0;">Task Status Updated</h2>
              <p>Hello <strong>${toName || 'Team Member'}</strong>,</p>
              <p>An update has been made to a task in project <strong>${projectName}</strong> by <strong>${updaterName}</strong>.</p>
              <div style="background-color: #f8fafc; padding: 15px; border-left: 4px solid #3b82f6; margin: 15px 0; border-radius: 4px;">
                <p style="margin: 0 0 8px 0;"><strong>Task:</strong> ${taskTitle}</p>
                <p style="margin: 0 0 8px 0;"><strong>Status:</strong> <span style="text-decoration: line-through; color: #94a3b8;">${previousStatus}</span> &rarr; <span style="color: #10b981; font-weight: bold; text-transform: uppercase;">${newStatus}</span></p>
                <p style="margin: 0;"><strong>Details:</strong> ${description || 'N/A'}</p>
              </div>
              <p style="font-size: 12px; color: #64748b; margin-top: 20px; border-top: 1px solid #f1f5f9; padding-top: 10px;">
                This is an automated notification from Innovalley Workspace. Please do not reply directly to this email.
              </p>
            </div>
          `;
        } else {
          subject = `[New Task Assigned] ${taskTitle} in ${projectName}`;
          bodyHtml = `
            <div style="font-family: sans-serif; padding: 20px; color: #334155; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 8px;">
              <h2 style="color: #0f172a; margin-top: 0;">New Task Assigned</h2>
              <p>Hello <strong>${toName || 'Team Member'}</strong>,</p>
              <p>A new task has been assigned to you in project <strong>${projectName}</strong> by <strong>${updaterName}</strong>.</p>
              <div style="background-color: #f8fafc; padding: 15px; border-left: 4px solid #3b82f6; margin: 15px 0; border-radius: 4px;">
                <p style="margin: 0 0 8px 0;"><strong>Task:</strong> ${taskTitle}</p>
                <p style="margin: 0 0 8px 0;"><strong>Status:</strong> <span style="color: #3b82f6; font-weight: bold; text-transform: uppercase;">ASSIGNED</span></p>
                <p style="margin: 0;"><strong>Details:</strong> ${description || 'N/A'}</p>
              </div>
              <p style="font-size: 12px; color: #64748b; margin-top: 20px; border-top: 1px solid #f1f5f9; padding-top: 10px;">
                This is an automated notification from Innovalley Workspace. Please do not reply directly to this email.
              </p>
            </div>
          `;
        }
      }

      res.json({
        success: true,
        notification: {
          toEmail,
          subject,
          body: bodyHtml,
          timestamp: Date.now()
        }
      });
    } catch (err: any) {
      console.error("Error generating notification:", err);
      res.status(500).json({ error: err.message || "Failed to generate notification" });
    }
  });

  // Vite middleware and local server setup
  const PORT = 3000;

  // Serve static files in production (works on both Cloud Run/local and Vercel)
  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  async function runLocalServer() {
    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    }

    if (!process.env.VERCEL) {
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${PORT}`);
      });
    }
  }

  // Run local server listener if we are in local container development/production, or not on Vercel
  if (!process.env.VERCEL || process.env.NODE_ENV !== "production") {
    runLocalServer().catch(err => {
      console.error("Failed to start server:", err);
    });
  }

