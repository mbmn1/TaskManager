// server.ts
import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import { Client } from "pg";
import crypto from "crypto";
dotenv.config();
function sanitizeDatabaseUrl(url) {
  if (!url) return url;
  try {
    const prefixMatch = url.match(/^(postgres(?:ql)?:\/\/)/i);
    if (!prefixMatch) return url;
    const prefix = prefixMatch[1];
    const remaining = url.substring(prefix.length);
    const lastAtIndex = remaining.lastIndexOf("@");
    if (lastAtIndex === -1) return url;
    const credentials = remaining.substring(0, lastAtIndex);
    const hostPart = remaining.substring(lastAtIndex + 1);
    const firstColonIndex = credentials.indexOf(":");
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
async function runSupabaseMigrations() {
  const rawDbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!rawDbUrl) {
    console.warn("No DATABASE_URL or SUPABASE_DB_URL found. Skipping automatic schema migration.");
    return;
  }
  const dbUrl = sanitizeDatabaseUrl(rawDbUrl);
  console.log("Connecting to Supabase PostgreSQL database to run schema setup...");
  let client = null;
  try {
    client = new Client({
      connectionString: dbUrl,
      ssl: {
        rejectUnauthorized: false
      }
    });
    await client.connect();
    console.log("Connected to Supabase PostgreSQL database. Verification and migrations started...");
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
    await client.query(`
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS password TEXT DEFAULT '123456';
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS "trackAttendance" BOOLEAN DEFAULT TRUE;
      ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
      ALTER TABLE employees ADD CONSTRAINT employees_role_check CHECK (role IN ('admin', 'employee', 'client'));
    `);
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
    await client.query(`
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "completionAttachment" JSONB;
    `);
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
    const tables = ["employees", "projects", "tasks", "notifications", "logs", "attendance"];
    for (const table of tables) {
      try {
        await client.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;`);
        await client.query(`DROP POLICY IF EXISTS "Allow public access" ON ${table};`);
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
      } catch (err) {
        console.warn(`Note on table '${table}' RLS configuration: ${err.message}`);
      }
    }
    const adminCheck = await client.query("SELECT COUNT(*) FROM employees WHERE role = 'admin';");
    const adminCount = parseInt(adminCheck.rows[0].count, 10);
    if (adminCount === 0) {
      console.log("No administrator accounts found in Supabase. Seeding default Admin user...");
      const adminId = "9848884897";
      await client.query(`
        INSERT INTO employees (id, name, email, phone, designation, role, password, "trackAttendance")
        VALUES ($1, 'Admin', 'Innovalleyservices@gmail.com', '9848884897', 'Administrator', 'admin', '123456', false);
      `, [adminId]);
      console.log("Default Admin user (Admin, 9848884897) seeded successfully in Supabase.");
    } else {
      console.log("Supabase already has an administrator account. Skipping auto-seeding.");
    }
  } catch (err) {
    console.error("Failed to run Supabase PostgreSQL migrations:", err.message);
  } finally {
    if (client) {
      try {
        await client.end();
      } catch (e) {
      }
    }
  }
}
var supabaseUrl = process.env.SUPABASE_URL || "";
var supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";
var supabase = null;
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
var DBWrapper = class {
  constructor() {
    this.useLocalFallback = false;
  }
  async testSupabase() {
    if (!supabase) {
      console.error("Supabase configuration is missing! Database access is disabled.");
      throw new Error("Supabase is not connected! Database is unavailable.");
    }
    this.useLocalFallback = false;
    console.log("Supabase client active. Strict sync enabled with zero local fallback.");
    console.log("Supabase REST API auto-seeding bypassed as requested.");
  }
  checkRLSError(err) {
    if (!err) return;
    const msg = (err.message || "").toLowerCase();
    console.warn("Supabase query warning:", msg);
  }
  collection(name) {
    const self = this;
    class CollectionQuery {
      constructor() {
        this.filters = [];
        this.sortField = null;
        this.sortDir = "asc";
      }
      where(field, op, val) {
        this.filters.push({ field, op, val });
        return this;
      }
      orderBy(field, direction = "asc") {
        this.sortField = field;
        this.sortDir = direction;
        return this;
      }
      async get() {
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
          const docs = (data || []).map((item) => {
            const rawId = name === "employees" && item.phone ? item.phone : item.id || "";
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
            forEach(callback) {
              docs.forEach((doc) => callback(doc));
            }
          };
        } catch (err) {
          console.error(`Supabase query failed on '${name}':`, err.message);
          self.checkRLSError(err);
          throw err;
        }
      }
    }
    return {
      doc(docId) {
        const rawId = docId || Math.random().toString(36).substring(2, 15);
        const id = rawId;
        return {
          id: rawId,
          async get() {
            if (!supabase) {
              throw new Error("Supabase is not connected!");
            }
            try {
              const { data, error } = await supabase.from(name).select("*").eq("id", id).maybeSingle();
              if (error) {
                if (error.code === "22P02" || error.message && error.message.includes("invalid input syntax for type uuid")) {
                  return {
                    exists: false,
                    id: rawId,
                    data: () => null
                  };
                }
                throw error;
              }
              const mappedData = data ? { ...data, id: name === "employees" && data.phone ? data.phone : data.id || rawId } : null;
              return {
                exists: !!data,
                id: rawId,
                data: () => mappedData
              };
            } catch (err) {
              console.error(`Supabase get doc failed on '${name}/${id}':`, err.message);
              self.checkRLSError(err);
              throw err;
            }
          },
          async set(data, options) {
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
            } catch (err) {
              console.error(`Supabase set doc failed on '${name}/${id}':`, err.message);
              self.checkRLSError(err);
              throw err;
            }
          },
          async update(data) {
            if (!supabase) {
              throw new Error("Supabase is not connected!");
            }
            try {
              const { error } = await supabase.from(name).update(data).eq("id", id);
              if (error) throw error;
            } catch (err) {
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
            } catch (err) {
              console.error(`Supabase delete doc failed on '${name}/${id}':`, err.message);
              self.checkRLSError(err);
              throw err;
            }
          }
        };
      },
      async add(data) {
        const id = Math.random().toString(36).substring(2, 15);
        const ref = this.doc(id);
        await ref.set(data);
        return ref;
      },
      where(field, op, val) {
        return new CollectionQuery().where(field, op, val);
      },
      orderBy(field, direction = "asc") {
        return new CollectionQuery().orderBy(field, direction);
      },
      async get() {
        return new CollectionQuery().get();
      }
    };
  }
};
var db = new DBWrapper();
var migrationsPromise = null;
async function ensureMigrations() {
  if (migrationsPromise) return migrationsPromise;
  migrationsPromise = (async () => {
    try {
      console.log("Verifying database schema and migrations...");
      await runSupabaseMigrations();
      if (supabase) {
        await db.testSupabase().catch((err) => console.warn("Supabase initial check skipped or failed:", err.message));
      }
    } catch (err) {
      console.error("Auto-migration failed:", err);
      migrationsPromise = null;
    }
  })();
  return migrationsPromise;
}
if (!process.env.VERCEL) {
  ensureMigrations().catch((err) => {
    console.error("Initial boot migrations failed:", err);
  });
}
var aiClient = null;
function getGeminiClient() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (key && key !== "MY_GEMINI_API_KEY" && key.trim() !== "") {
      aiClient = new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build"
          }
        }
      });
    }
  }
  return aiClient;
}
var app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function(body) {
    if (res.statusCode >= 400) {
      try {
        const logMsg = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${req.method} ${req.url} - Status: ${res.statusCode} - Body: ${typeof body === "string" ? body : JSON.stringify(body)}
`;
        fs.appendFileSync(path.join(process.cwd(), "server-errors.log"), logMsg);
      } catch (logErr) {
        console.error("Failed to write to error log file:", logErr);
      }
    }
    return originalSend.apply(res, arguments);
  };
  next();
});
app.use((req, res, next) => {
  if (req.url.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  }
  next();
});
app.use(async (req, res, next) => {
  if (req.url.startsWith("/api/")) {
    try {
      await ensureMigrations();
    } catch (err) {
      console.error("Migration middleware error:", err);
    }
  }
  next();
});
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});
app.post("/api/employees/seed", async (req, res) => {
  res.json({ success: true, seeded: false, message: "Automatic seeding disabled as requested. Fetching logins from Supabase only." });
});
app.get("/api/employees", async (req, res) => {
  try {
    const snapshot = await db.collection("employees").get();
    const list = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      list.push({
        id: doc.id,
        phone: data.phone || "",
        ...data
      });
    });
    res.json(list);
  } catch (err) {
    console.error("Error listing employees on server:", err);
    res.status(500).json({ error: err.message });
  }
});
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
      role: employee.role || "employee",
      trackAttendance: employee.trackAttendance !== void 0 ? employee.trackAttendance : true
    };
    await empRef.set(newEmp);
    res.json(newEmp);
  } catch (err) {
    console.error("Error adding employee on server:", err);
    res.status(500).json({ error: err.message });
  }
});
app.put("/api/employees/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const emailNormalized = email.trim().toLowerCase();
    const { name, email: newEmail, phone, designation, role } = req.body;
    let empRef = db.collection("employees").doc(emailNormalized);
    let docSnap = await empRef.get();
    if (!docSnap.exists) {
      let querySnapshot = await db.collection("employees").where("email", "==", emailNormalized).get();
      if (!querySnapshot.empty) {
        let foundDocId = "";
        querySnapshot.forEach((d) => {
          foundDocId = d.id;
        });
        empRef = db.collection("employees").doc(foundDocId);
        docSnap = await empRef.get();
      } else {
        querySnapshot = await db.collection("employees").where("phone", "==", emailNormalized).get();
        if (!querySnapshot.empty) {
          let foundDocId = "";
          querySnapshot.forEach((d) => {
            foundDocId = d.id;
          });
          empRef = db.collection("employees").doc(foundDocId);
          docSnap = await empRef.get();
        } else {
          const cleaned = emailNormalized.replace(/[^0-9]/g, "");
          if (cleaned) {
            querySnapshot = await db.collection("employees").where("phone", "==", cleaned).get();
            if (!querySnapshot.empty) {
              let foundDocId = "";
              querySnapshot.forEach((d) => {
                foundDocId = d.id;
              });
              empRef = db.collection("employees").doc(foundDocId);
              docSnap = await empRef.get();
            }
          }
        }
      }
    }
    const updateData = {};
    if (name !== void 0) updateData.name = name;
    if (newEmail !== void 0) updateData.email = newEmail;
    if (phone !== void 0) updateData.phone = phone;
    if (designation !== void 0) updateData.designation = designation;
    if (role !== void 0) updateData.role = role;
    if (req.body.password !== void 0) updateData.password = req.body.password;
    if (req.body.trackAttendance !== void 0) updateData.trackAttendance = req.body.trackAttendance;
    if (docSnap && docSnap.exists) {
      await empRef.update(updateData);
    } else {
      await empRef.set(updateData, { merge: true });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Error editing employee on server:", err);
    res.status(500).json({ error: err.message });
  }
});
app.delete("/api/employees/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const emailNormalized = email.trim().toLowerCase();
    let empRef = db.collection("employees").doc(emailNormalized);
    let docSnap = await empRef.get();
    if (!docSnap.exists) {
      let querySnapshot = await db.collection("employees").where("email", "==", emailNormalized).get();
      if (!querySnapshot.empty) {
        let foundDocId = "";
        querySnapshot.forEach((d) => {
          foundDocId = d.id;
        });
        empRef = db.collection("employees").doc(foundDocId);
        docSnap = await empRef.get();
      } else {
        querySnapshot = await db.collection("employees").where("phone", "==", emailNormalized).get();
        if (!querySnapshot.empty) {
          let foundDocId = "";
          querySnapshot.forEach((d) => {
            foundDocId = d.id;
          });
          empRef = db.collection("employees").doc(foundDocId);
          docSnap = await empRef.get();
        } else {
          const cleaned = emailNormalized.replace(/[^0-9]/g, "");
          if (cleaned) {
            querySnapshot = await db.collection("employees").where("phone", "==", cleaned).get();
            if (!querySnapshot.empty) {
              let foundDocId = "";
              querySnapshot.forEach((d) => {
                foundDocId = d.id;
              });
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
  } catch (err) {
    console.error("Error deleting employee on server:", err);
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/attendance", async (req, res) => {
  try {
    const { employee_id, date } = req.query;
    let ref = db.collection("attendance");
    if (employee_id) {
      ref = ref.where("employee_id", "==", employee_id.toString());
    }
    if (date) {
      ref = ref.where("date", "==", date.toString());
    }
    const snapshot = await ref.get();
    const list = [];
    snapshot.forEach((doc) => {
      list.push({ id: doc.id, ...doc.data() });
    });
    res.json(list);
  } catch (err) {
    console.error("Error listing attendance logs on server:", err);
    res.status(500).json({ error: err.message });
  }
});
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
  } catch (err) {
    console.error("Error recording punch-in:", err);
    res.status(500).json({ error: err.message });
  }
});
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
  } catch (err) {
    console.error("Error recording punch-out:", err);
    res.status(500).json({ error: err.message });
  }
});
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
  } catch (err) {
    console.error("Error reassigning task on server:", err);
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/auth/captcha", (req, res) => {
  try {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let captchaText = "";
    for (let i = 0; i < 4; i++) {
      captchaText += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const timestamp = Date.now();
    const salt = process.env.JWT_SECRET || "innovalley-secure-salt-2026";
    const hash = crypto.createHmac("sha256", salt).update(`${timestamp}-${captchaText}`).digest("hex");
    const captchaId = `${timestamp}.${hash}`;
    res.json({ captchaId, captchaText });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const input = (identifier || "").toString().trim();
    const pass = (password || "").toString().trim();
    if (!input || !pass) {
      return res.status(400).json({ error: "Mobile Number and PIN are required." });
    }
    const inputNormalized = input.toLowerCase();
    let matchedEmployee = null;
    if (inputNormalized.includes("@")) {
      const emailSnap = await db.collection("employees").where("email", "==", inputNormalized).get();
      if (!emailSnap.empty) {
        emailSnap.forEach((doc) => {
          matchedEmployee = doc.data();
        });
      }
    } else {
      const cleanedPhone = inputNormalized.replace(/[^0-9]/g, "");
      if (cleanedPhone) {
        const empRef = db.collection("employees").doc(cleanedPhone);
        const empSnap = await empRef.get();
        if (empSnap.exists) {
          matchedEmployee = empSnap.data();
        } else {
          const phoneSnap = await db.collection("employees").where("phone", "==", cleanedPhone).get();
          if (!phoneSnap.empty) {
            phoneSnap.forEach((doc) => {
              matchedEmployee = doc.data();
            });
          }
        }
      }
    }
    if (!matchedEmployee) {
      return res.status(404).json({ error: "User is not registered in the system. Please ask Admin to add you." });
    }
    const dbPassword = matchedEmployee.password || "123456";
    if (pass !== dbPassword) {
      return res.status(400).json({ error: "Incorrect PIN. Please try again." });
    }
    return res.json({
      success: true,
      employee: matchedEmployee
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/auth/change-password", async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body;
    const identifier = (email || "").toString().trim();
    if (!identifier || !newPassword) {
      return res.status(400).json({ error: "Identifier and new PIN are required." });
    }
    let empRef = null;
    let employeeData = null;
    if (identifier.includes("@")) {
      const emailNormalized = identifier.toLowerCase();
      const emailSnap = await db.collection("employees").where("email", "==", emailNormalized).get();
      if (!emailSnap.empty) {
        emailSnap.forEach((doc) => {
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
            phoneSnap.forEach((doc) => {
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
    const dbPassword = employeeData.password || "123456";
    const isCurrentCorrect = currentPassword === dbPassword;
    if (!isCurrentCorrect) {
      return res.status(400).json({ error: "Incorrect current PIN." });
    }
    await empRef.update({ password: newPassword });
    res.json({ success: true, message: "PIN updated successfully!" });
  } catch (err) {
    console.error("Error changing PIN:", err);
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/projects", async (req, res) => {
  try {
    const { userPhone, userEmail, role } = req.query;
    const targetEmail = (userEmail || userPhone || "").toString().trim().toLowerCase();
    let queryRef = db.collection("projects");
    let snapshot;
    const isActuallyAdmin = role === "admin";
    if (isActuallyAdmin) {
      snapshot = await queryRef.orderBy("createdAt", "desc").get();
    } else if (targetEmail) {
      snapshot = await queryRef.where("members", "array-contains", targetEmail).get();
    } else {
      snapshot = await queryRef.get();
    }
    const list = [];
    snapshot.forEach((doc) => {
      list.push({ id: doc.id, ...doc.data() });
    });
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json(list);
  } catch (err) {
    console.error("Error listing projects on server:", err);
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/projects", async (req, res) => {
  try {
    const { name, description, createdBy, members } = req.body;
    const uniqueMembers = Array.from(new Set(members || []));
    const adminSnapshot = await db.collection("employees").where("role", "==", "admin").get();
    const adminEmails = /* @__PURE__ */ new Set();
    adminSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data && data.email) {
        adminEmails.add(data.email.trim().toLowerCase());
      }
    });
    const filteredMembers = uniqueMembers.filter((m) => typeof m === "string" && !adminEmails.has(m.trim().toLowerCase()));
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
  } catch (err) {
    console.error("Error creating project on server:", err);
    res.status(500).json({ error: err.message });
  }
});
app.put("/api/projects/:id/members", async (req, res) => {
  try {
    const { id } = req.params;
    const { members } = req.body;
    const adminSnapshot = await db.collection("employees").where("role", "==", "admin").get();
    const adminEmails = /* @__PURE__ */ new Set();
    adminSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data && data.email) {
        adminEmails.add(data.email.trim().toLowerCase());
      }
    });
    const filteredMembers = (members || []).filter((m) => typeof m === "string" && !adminEmails.has(m.trim().toLowerCase()));
    let projRef = db.collection("projects").doc(id);
    let docSnap = await projRef.get();
    if (!docSnap.exists) {
      let querySnapshot = await db.collection("projects").where("id", "==", id).get();
      if (!querySnapshot.empty) {
        let foundProjId = "";
        querySnapshot.forEach((d) => {
          foundProjId = d.id;
        });
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
  } catch (err) {
    console.error("Error updating project members on server:", err);
    res.status(500).json({ error: err.message });
  }
});
app.put("/api/projects/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, members } = req.body;
    let projRef = db.collection("projects").doc(id);
    let docSnap = await projRef.get();
    if (!docSnap.exists) {
      let querySnapshot = await db.collection("projects").where("id", "==", id).get();
      if (!querySnapshot.empty) {
        let foundProjId = "";
        querySnapshot.forEach((d) => {
          foundProjId = d.id;
        });
        projRef = db.collection("projects").doc(foundProjId);
        docSnap = await projRef.get();
      } else if (name) {
        querySnapshot = await db.collection("projects").where("name", "==", name).get();
        if (!querySnapshot.empty) {
          let foundProjId = "";
          querySnapshot.forEach((d) => {
            foundProjId = d.id;
          });
          projRef = db.collection("projects").doc(foundProjId);
          docSnap = await projRef.get();
        }
      }
    }
    const updateData = {};
    if (name !== void 0) updateData.name = name;
    if (description !== void 0) updateData.description = description;
    if (members !== void 0) {
      const adminSnapshot = await db.collection("employees").where("role", "==", "admin").get();
      const adminEmails = /* @__PURE__ */ new Set();
      adminSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data && data.email) {
          adminEmails.add(data.email.trim().toLowerCase());
        }
      });
      updateData.members = members.filter((m) => typeof m === "string" && !adminEmails.has(m.trim().toLowerCase()));
    }
    if (docSnap && docSnap.exists) {
      await projRef.update(updateData);
    } else {
      await projRef.set(updateData, { merge: true });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Error editing project on server:", err);
    res.status(500).json({ error: err.message });
  }
});
app.delete("/api/projects/:id", async (req, res) => {
  try {
    const { id } = req.params;
    let projRef = db.collection("projects").doc(id);
    let docSnap = await projRef.get();
    if (!docSnap.exists) {
      const querySnapshot = await db.collection("projects").where("id", "==", id).get();
      if (!querySnapshot.empty) {
        let foundProjId = "";
        querySnapshot.forEach((d) => {
          foundProjId = d.id;
        });
        projRef = db.collection("projects").doc(foundProjId);
      }
    }
    await projRef.delete();
    const tasksSnap = await db.collection("tasks").where("projectId", "==", id).get();
    tasksSnap.forEach(async (doc) => {
      await db.collection("tasks").doc(doc.id).delete();
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting project on server:", err);
    res.status(500).json({ error: err.message });
  }
});
app.delete("/api/projects/:projectId/tasks/completed", async (req, res) => {
  try {
    const { projectId } = req.params;
    const tasksSnap = await db.collection("tasks").where("projectId", "==", projectId).get();
    let deletedCount = 0;
    const promises = [];
    tasksSnap.forEach((doc) => {
      const taskData = doc.data();
      if (taskData && taskData.status === "completed") {
        promises.push(db.collection("tasks").doc(doc.id).delete());
        deletedCount++;
      }
    });
    await Promise.all(promises);
    res.json({ success: true, deletedCount });
  } catch (err) {
    console.error("Error deleting completed tasks on server:", err);
    res.status(500).json({ error: err.message });
  }
});
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
    const list = [];
    snapshot.forEach((doc) => {
      list.push({ id: doc.id, ...doc.data() });
    });
    let filteredList = list;
    if (!isActuallyAdmin && targetEmail) {
      filteredList = list.filter(
        (t) => t.assignedTo && t.assignedTo.trim().toLowerCase() === targetEmail || t.assignedBy && t.assignedBy.trim().toLowerCase() === targetEmail
      );
    }
    const now = Date.now();
    const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1e3;
    filteredList = filteredList.filter((t) => {
      if (t.status === "completed") {
        const compTime = t.updatedAt || t.createdAt || 0;
        return now - compTime <= FIVE_DAYS_MS;
      }
      return true;
    });
    filteredList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json(filteredList);
  } catch (err) {
    console.error("Error listing tasks on server:", err);
    res.status(500).json({ error: err.message });
  }
});
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
    if (project && creator && assignee) {
      await db.collection("logs").add({
        projectId: project.id,
        projectName: project.name,
        action: "CREATE_TASK",
        details: `Task "${task.title}" was created and assigned to ${assignee.name} (${assignee.email}) by ${creator.name}.`,
        operatorPhone: creator.email,
        // keeping field as operatorPhone for frontend data structure compatibility
        operatorName: creator.name,
        timestamp
      });
    }
    res.json({
      id: docRef.id,
      ...newTaskData
    });
  } catch (err) {
    console.error("Error creating task on server:", err);
    res.status(500).json({ error: err.message });
  }
});
app.put("/api/tasks/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { newStatus, task, project, updater, assignee, rejectionNotes, notDoneNotes, completedRemarks, attachment, completionAttachment } = req.body;
    const updateData = {
      status: newStatus,
      updatedAt: Date.now()
    };
    if (rejectionNotes !== void 0) updateData.rejectionNotes = rejectionNotes;
    if (notDoneNotes !== void 0) updateData.notDoneNotes = notDoneNotes;
    if (completedRemarks !== void 0) updateData.completedRemarks = completedRemarks;
    if (attachment !== void 0) updateData.attachment = attachment;
    if (completionAttachment !== void 0) updateData.completionAttachment = completionAttachment;
    await db.collection("tasks").doc(id).update(updateData);
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
  } catch (err) {
    console.error("Error updating task status on server:", err);
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/logs", async (req, res) => {
  try {
    const snapshot = await db.collection("logs").get();
    const list = [];
    snapshot.forEach((doc) => {
      list.push({ id: doc.id, ...doc.data() });
    });
    list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    res.json(list);
  } catch (err) {
    console.error("Error listing audit logs on server:", err);
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/notifications", async (req, res) => {
  try {
    const snapshot = await db.collection("notifications").get();
    const list = [];
    snapshot.forEach((doc) => {
      list.push({ id: doc.id, ...doc.data() });
    });
    list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    res.json(list);
  } catch (err) {
    console.error("Error listing notifications on server:", err);
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/notifications", async (req, res) => {
  try {
    const notification = req.body;
    const docRef = await db.collection("notifications").add(notification);
    res.json({ id: docRef.id, ...notification });
  } catch (err) {
    console.error("Error logging notification on server:", err);
    res.status(500).json({ error: err.message });
  }
});
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
            - Recipient Name: ${toName || "Team Member"}
            - Project Name: ${projectName}
            - Task Title: ${taskTitle}
            - Updated By: ${updaterName}
            - Action Type: ${actionType}
            ${actionType === "status_change" ? `- Status changed from "${previousStatus}" to "${newStatus}"` : `- New task assigned to them`}
            - Task Description: ${description || "No additional description provided."}
            
            Format the response as a valid JSON object with EXACTLY these two keys:
            "subject": "A concise and relevant email subject line"
            "body": "A clean HTML email body, inside a container with modern but simple inline CSS styling. Use high-contrast, professional slate-colored header, readable text size, and soft margins. Do not use generic placeholders. Mention that this is an automated notification from Innovalley Services."
            
            Return ONLY the raw JSON string, do not wrap it in markdown block tags like \`\`\`json.
          `;
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt
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
      if (actionType === "status_change") {
        subject = `[Task Status Updated] ${taskTitle} in ${projectName}`;
        bodyHtml = `
            <div style="font-family: sans-serif; padding: 20px; color: #334155; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 8px;">
              <h2 style="color: #0f172a; margin-top: 0;">Task Status Updated</h2>
              <p>Hello <strong>${toName || "Team Member"}</strong>,</p>
              <p>An update has been made to a task in project <strong>${projectName}</strong> by <strong>${updaterName}</strong>.</p>
              <div style="background-color: #f8fafc; padding: 15px; border-left: 4px solid #3b82f6; margin: 15px 0; border-radius: 4px;">
                <p style="margin: 0 0 8px 0;"><strong>Task:</strong> ${taskTitle}</p>
                <p style="margin: 0 0 8px 0;"><strong>Status:</strong> <span style="text-decoration: line-through; color: #94a3b8;">${previousStatus}</span> &rarr; <span style="color: #10b981; font-weight: bold; text-transform: uppercase;">${newStatus}</span></p>
                <p style="margin: 0;"><strong>Details:</strong> ${description || "N/A"}</p>
              </div>
              <p style="font-size: 12px; color: #64748b; margin-top: 20px; border-top: 1px solid #f1f5f9; padding-top: 10px;">
                 
              </p>
            </div>
          `;
      } else {
        subject = `[New Task Assigned] ${taskTitle} in ${projectName}`;
        bodyHtml = `
            <div style="font-family: sans-serif; padding: 20px; color: #334155; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 8px;">
              <h2 style="color: #0f172a; margin-top: 0;">New Task Assigned</h2>
              <p>Hello <strong>${toName || "Team Member"}</strong>,</p>
              <p>A new task has been assigned to you in project <strong>${projectName}</strong> by <strong>${updaterName}</strong>.</p>
              <div style="background-color: #f8fafc; padding: 15px; border-left: 4px solid #3b82f6; margin: 15px 0; border-radius: 4px;">
                <p style="margin: 0 0 8px 0;"><strong>Task:</strong> ${taskTitle}</p>
                <p style="margin: 0 0 8px 0;"><strong>Status:</strong> <span style="color: #3b82f6; font-weight: bold; text-transform: uppercase;">ASSIGNED</span></p>
                <p style="margin: 0;"><strong>Details:</strong> ${description || "N/A"}</p>
              </div>
              <p style="font-size: 12px; color: #64748b; margin-top: 20px; border-top: 1px solid #f1f5f9; padding-top: 10px;">
                 
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
  } catch (err) {
    console.error("Error generating notification:", err);
    res.status(500).json({ error: err.message || "Failed to generate notification" });
  }
});
var PORT = 3e3;
if (process.env.NODE_ENV === "production") {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    res.sendFile(path.join(distPath, "index.html"));
  });
}
async function runLocalServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }
  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}
if (!process.env.VERCEL) {
  runLocalServer().catch((err) => {
    console.error("Failed to start server:", err);
  });
}
export {
  app
};
//# sourceMappingURL=server.js.map
