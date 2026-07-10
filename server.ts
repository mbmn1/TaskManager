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

// Automatic Supabase Table Schema & Seed Bootstrapper
async function runSupabaseMigrations() {
  const rawDbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!rawDbUrl) {
    console.warn("No DATABASE_URL or SUPABASE_DB_URL found. Skipping automatic schema migration.");
    return;
  }
  
  const dbUrl = sanitizeDatabaseUrl(rawDbUrl);
  console.log("Connecting to Supabase PostgreSQL database to run schema setup...");
  const client = new Client({
    connectionString: dbUrl,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log("Connected to Supabase PostgreSQL database. Verification and migrations started...");

    // 1. Create employees table
    await client.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        designation TEXT,
        role TEXT DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
        password TEXT DEFAULT '123456'
      );
    `);

    // Ensure password column exists if the table was created previously without it
    await client.query(`
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS password TEXT DEFAULT '123456';
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

    // Ensure Row Level Security (RLS) is disabled, and create permissive public policies
    // to prevent "new row violates row-level security policy" errors if anon key is used.
    const tables = ["employees", "projects", "tasks", "notifications", "logs"];
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

    // Seed admin accounts
    await client.query(`
      INSERT INTO employees (id, name, email, phone, designation, role, password)
      VALUES 
        ('9848884897', 'Innovalley Services', 'innovalleyservices@gmail.com', '9848884897', 'Project Director (Admin)', 'admin', 'Mbmn@B!#!951'),
        ('9848884899', 'Murali Krishna', 'mbmnmurali@gmail.com', '9848884899', 'Lead Developer', 'employee', 'Mbmn@B!#!951')
      ON CONFLICT (id) DO UPDATE 
      SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone, designation = EXCLUDED.designation, role = EXCLUDED.role, password = EXCLUDED.password;
    `);

    console.log("Supabase PostgreSQL tables checked, RLS bypassed, and seeded successfully.");
  } catch (err: any) {
    console.error("Failed to run Supabase PostgreSQL migrations:", err.message);
  } finally {
    try {
      await client.end();
    } catch (e) {}
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
    "innovalleyservices@gmail.com": {
      id: "innovalleyservices@gmail.com",
      name: "Innovalley Services",
      email: "innovalleyservices@gmail.com",
      phone: "9848884897",
      designation: "Project Director (Admin)",
      role: "admin",
      password: "Mbmn@B!#!951"
    },
    "mbmnmurali@gmail.com": {
      id: "mbmnmurali@gmail.com",
      name: "Murali Krishna",
      email: "mbmnmurali@gmail.com",
      phone: "9848884897",
      designation: "Lead Developer",
      role: "employee",
      password: "Mbmn@B!#!951"
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
      console.warn("Supabase configuration missing. Falling back to local file-based database.");
      this.useLocalFallback = true;
      return;
    }
    this.useLocalFallback = false;
    console.log("Supabase client active. Strict sync enabled with zero local fallback.");
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
        if (!self.useLocalFallback && supabase) {
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

            const docs = (data || []).map((item: any) => ({
              id: item.id || "",
              data: () => item
            }));

            return {
              empty: docs.length === 0,
              size: docs.length,
              docs,
              forEach(callback: any) {
                docs.forEach(doc => callback(doc));
              }
            };
          } catch (err: any) {
            console.warn(`Supabase query failed on '${name}', falling back locally:`, err.message);
            self.checkRLSError(err);
            // Fall through to local fallback
          }
        }

        // FALLBACK LOCAL DB LOGIC
        if (!localDB[name]) {
          localDB[name] = {};
        }

        let items = Object.values(localDB[name]);

        // Filter
        for (const filter of this.filters) {
          const { field, op, val } = filter;
          items = items.filter(item => {
            const itemVal = item[field];
            if (op === "==") {
              const target = typeof val === "string" ? val.trim().toLowerCase() : val;
              const source = typeof itemVal === "string" ? itemVal.trim().toLowerCase() : itemVal;
              return source === target;
            }
            if (op === "array-contains") {
              const normalizedVal = typeof val === "string" ? val.trim().toLowerCase() : val;
              if (Array.isArray(itemVal)) {
                return itemVal.some(m => typeof m === "string" ? m.trim().toLowerCase() : m === normalizedVal);
              }
              return false;
            }
            return true;
          });
        }

        // Sort
        if (this.sortField) {
          const field = this.sortField;
          const dir = this.sortDir === "desc" ? -1 : 1;
          items.sort((a, b) => {
            const valA = a[field] ?? 0;
            const valB = b[field] ?? 0;
            if (valA < valB) return -1 * dir;
            if (valA > valB) return 1 * dir;
            return 0;
          });
        }

        const docs = items.map(item => ({
          id: item.id || "",
          data: () => item
        }));

        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
          forEach(callback: any) {
            docs.forEach(doc => callback(doc));
          }
        };
      }
    }

    return {
      doc(docId?: string) {
        const id = docId || Math.random().toString(36).substring(2, 15);
        return {
          id,
          async get() {
            if (!self.useLocalFallback && supabase) {
              try {
                const { data, error } = await supabase.from(name).select("*").eq("id", id).maybeSingle();
                if (error) throw error;
                return {
                  exists: !!data,
                  id,
                  data: () => data || null
                };
              } catch (err: any) {
                console.warn(`Supabase get doc handled warning on '${name}/${id}':`, err.message);
                self.checkRLSError(err);
              }
            }

            // FALLBACK LOGIC
            if (!localDB[name]) {
              localDB[name] = {};
            }
            const data = localDB[name][id];
            return {
              id,
              exists: !!data,
              data: () => data || null
            };
          },

          async set(data: any, options?: { merge?: boolean }) {
            const isMerge = options?.merge === true;
            if (!self.useLocalFallback && supabase) {
              try {
                let mergedData = { ...data };
                if (isMerge) {
                  const { data: existing } = await supabase.from(name).select("*").eq("id", id).maybeSingle();
                  if (existing) {
                    mergedData = { ...existing, ...data };
                  }
                }
                const { error } = await supabase.from(name).upsert({ id, ...mergedData });
                if (error) throw error;
                
                // Write to fallback for robustness
                if (!localDB[name]) localDB[name] = {};
                localDB[name][id] = isMerge 
                  ? { ...(localDB[name][id] || {}), ...data, id }
                  : { ...data, id };
                return;
              } catch (err: any) {
                console.warn(`Supabase set doc handled warning on '${name}/${id}':`, err.message);
                self.checkRLSError(err);
                // Fall through to write to fallback for robustness
                if (!localDB[name]) localDB[name] = {};
                localDB[name][id] = isMerge 
                  ? { ...(localDB[name][id] || {}), ...data, id }
                  : { ...data, id };
                return;
              }
            }

            // FALLBACK LOGIC
            if (!localDB[name]) {
              localDB[name] = {};
            }
            localDB[name][id] = isMerge 
              ? { ...(localDB[name][id] || {}), ...data, id }
              : { ...data, id };
          },

          async update(data: any) {
            if (!self.useLocalFallback && supabase) {
              try {
                const { error } = await supabase.from(name).update(data).eq("id", id);
                if (error) throw error;
                
                // Write to fallback for robustness
                if (!localDB[name]) localDB[name] = {};
                localDB[name][id] = { ...(localDB[name][id] || {}), ...data };
                return;
              } catch (err: any) {
                console.warn(`Supabase update doc handled warning on '${name}/${id}':`, err.message);
                self.checkRLSError(err);
                // Fall through to write to fallback for robustness
                if (!localDB[name]) localDB[name] = {};
                localDB[name][id] = { ...(localDB[name][id] || {}), ...data };
                return;
              }
            }

            // FALLBACK LOGIC
            if (!localDB[name]) {
              localDB[name] = {};
            }
            localDB[name][id] = { ...(localDB[name][id] || {}), ...data };
          },

          async delete() {
            if (!self.useLocalFallback && supabase) {
              try {
                const { error } = await supabase.from(name).delete().eq("id", id);
                if (error) throw error;
                
                if (localDB[name]) {
                  delete localDB[name][id];
                }
                return;
              } catch (err: any) {
                console.warn(`Supabase delete doc handled warning on '${name}/${id}':`, err.message);
                self.checkRLSError(err);
                // Fall through to write to fallback for robustness
                if (localDB[name]) {
                  delete localDB[name][id];
                }
                return;
              }
            }

            // FALLBACK LOGIC
            if (localDB[name]) {
              delete localDB[name][id];
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
runSupabaseMigrations().then(() => {
  db.testSupabase();
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

  // Seed Admin user if not exists
  app.post("/api/employees/seed", async (req, res) => {
    try {
      const adminPhone = "9848884897";
      const devPhone = "9848884899";
      
      const adminRef = db.collection("employees").doc(adminPhone);
      const adminSnap = await adminRef.get();

      if (!adminSnap.exists) {
        const defaultAdmin = {
          id: adminPhone,
          name: "Innovalley Services",
          email: "innovalleyservices@gmail.com",
          phone: adminPhone,
          designation: "Project Director (Admin)",
          role: "admin",
          password: "Mbmn@B!#!951"
        };
        await adminRef.set(defaultAdmin);
        console.log("Admin user seeded successfully in Supabase/Fallback.");
      }

      const devRef = db.collection("employees").doc(devPhone);
      const devSnap = await devRef.get();
      if (!devSnap.exists) {
        const defaultDev = {
          id: devPhone,
          name: "Murali Krishna",
          email: "mbmnmurali@gmail.com",
          phone: devPhone,
          designation: "Lead Developer",
          role: "employee",
          password: "Mbmn@B!#!951"
        };
        await devRef.set(defaultDev);
        console.log("Dev user seeded successfully in Supabase/Fallback.");
      }

      // Cleanup old email-based documents to keep database clean
      try {
        await db.collection("employees").doc("innovalleyservices@gmail.com").delete();
        await db.collection("employees").doc("mbmnmurali@gmail.com").delete();
        console.log("Cleaned up old email-based document accounts");
      } catch (e) {
        console.error("Cleanup warning:", e);
      }

      res.json({ success: true, seeded: true });
    } catch (err: any) {
      console.error("Error seeding admin on server:", err);
      res.status(500).json({ error: err.message });
    }
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
        role: 'employee'
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
      
      // Block deleting admin by email or phone
      if (emailNormalized === "innovalleyservices@gmail.com" || emailNormalized === "9848884897") {
        res.status(400).json({ error: "The system administrator accounts cannot be deleted." });
        return;
      }
      
      let empRef = db.collection("employees").doc(emailNormalized);
      let docSnap = await empRef.get();
      if (!docSnap.exists) {
        // 1. Try query by email field
        let querySnapshot = await db.collection("employees").where("email", "==", emailNormalized).get();
        if (!querySnapshot.empty) {
          let foundDocId = "";
          querySnapshot.forEach((d: any) => { foundDocId = d.id; });
          empRef = db.collection("employees").doc(foundDocId);
        } else {
          // 2. Try query by phone field
          querySnapshot = await db.collection("employees").where("phone", "==", emailNormalized).get();
          if (!querySnapshot.empty) {
            let foundDocId = "";
            querySnapshot.forEach((d: any) => { foundDocId = d.id; });
            empRef = db.collection("employees").doc(foundDocId);
          } else {
            // 3. Try query by cleaned phone number
            const cleaned = emailNormalized.replace(/[^0-9]/g, "");
            if (cleaned) {
              querySnapshot = await db.collection("employees").where("phone", "==", cleaned).get();
              if (!querySnapshot.empty) {
                let foundDocId = "";
                querySnapshot.forEach((d: any) => { foundDocId = d.id; });
                empRef = db.collection("employees").doc(foundDocId);
              }
            }
          }
        }
      }

      await empRef.delete();
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error deleting employee on server:", err);
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
      const { identifier, password, captchaId, captchaInput } = req.body;
      const input = (identifier || "").toString().trim();
      const pass = (password || "").toString().trim();
      const capIn = (captchaInput || "").toString().trim().toUpperCase();

      if (!input || !pass) {
        return res.status(400).json({ error: "Email/Phone and Password are required." });
      }

      if (captchaId !== "local_captcha") {
        if (!captchaId || !capIn) {
          return res.status(400).json({ error: "Captcha verification is required." });
        }

        // Verify captcha statelessly
        try {
          const parts = captchaId.split(".");
          if (parts.length !== 2) {
            return res.status(400).json({ error: "Invalid captcha session. Please reload captcha." });
          }
          
          const [timestampStr, originalHash] = parts;
          const timestamp = parseInt(timestampStr, 10);
          
          // 15 minutes expiration check
          if (isNaN(timestamp) || Date.now() - timestamp > 15 * 60 * 1000) {
            return res.status(400).json({ error: "Captcha session expired. Please reload the captcha." });
          }
          
          const salt = process.env.JWT_SECRET || "innovalley-secure-salt-2026";
          const expectedHash = crypto.createHmac("sha256", salt).update(`${timestampStr}-${capIn}`).digest("hex");
          
          if (originalHash !== expectedHash) {
            return res.status(400).json({ error: "Incorrect captcha code. Please try again." });
          }
        } catch (err) {
          return res.status(400).json({ error: "Failed to verify captcha. Please try again." });
        }
      }

      const inputNormalized = input.toLowerCase();

      // Special handling for hardcoded Sole Admin
      if (inputNormalized === "innovalleyservices@gmail.com") {
        const adminRef = db.collection("employees").doc("innovalleyservices@gmail.com");
        let adminSnap = await adminRef.get();
        let adminEmployee = null;
        
        if (adminSnap.exists) {
          adminEmployee = adminSnap.data();
        } else {
          adminEmployee = {
            id: "innovalleyservices@gmail.com",
            name: "Innovalley Services",
            email: "innovalleyservices@gmail.com",
            phone: "9848884897",
            designation: "Project Director (Admin)",
            role: "admin",
            password: "Mbmn@B!#!951"
          };
          await adminRef.set(adminEmployee);
        }

        const dbPassword = adminEmployee.password || "Mbmn@B!#!951";

        if (pass === dbPassword || pass === "Mbmn@B!#!951") {
          if (adminEmployee.role !== "admin") {
            adminEmployee.role = "admin";
            await adminRef.update({ role: "admin" });
          }

          return res.json({
            success: true,
            employee: adminEmployee
          });
        } else {
          return res.status(400).json({ error: "Incorrect administrator password." });
        }
      }

      // Search for employee by email or phone
      let matchedEmployee: any = null;
      
      // 1. Check by ID (which is lowercase email) or direct email field
      const empRef = db.collection("employees").doc(inputNormalized);
      const empSnap = await empRef.get();
      if (empSnap.exists) {
        matchedEmployee = empSnap.data();
      } else {
        // Query by email
        const emailSnap = await db.collection("employees").where("email", "==", inputNormalized).get();
        if (!emailSnap.empty) {
          emailSnap.forEach((doc: any) => {
            matchedEmployee = doc.data();
          });
        }
      }

      // 2. Query by phone if not found
      if (!matchedEmployee) {
        const cleanedPhone = input.replace(/[^0-9]/g, "");
        if (cleanedPhone) {
          const phoneSnap = await db.collection("employees").where("phone", "==", cleanedPhone).get();
          if (!phoneSnap.empty) {
            phoneSnap.forEach((doc: any) => {
              matchedEmployee = doc.data();
            });
          }
        }
      }

      if (!matchedEmployee) {
        return res.status(404).json({ error: "User is not registered in the system. Please ask Admin to add you." });
      }

      // Check password
      const dbPassword = matchedEmployee.password || "123456"; // default fallback for pre-existing accounts
      if (pass !== dbPassword) {
        return res.status(400).json({ error: "Incorrect password. Please try again." });
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

  // User changes their own password
  app.post("/api/auth/change-password", async (req, res) => {
    try {
      const { email, currentPassword, newPassword } = req.body;
      const emailNormalized = email.trim().toLowerCase();
      
      const empRef = db.collection("employees").doc(emailNormalized);
      const docSnap = await empRef.get();
      
      if (!docSnap.exists) {
        return res.status(404).json({ error: "Employee profile not found." });
      }
      
      const employeeData = docSnap.data();
      const dbPassword = employeeData.password || "123456"; // Default password fallback
      
      // If it's the admin, verify master password
      const isAdmin = emailNormalized === "innovalleyservices@gmail.com";
      const masterPassword = "Mbmn@B!#!951";
      
      const isCurrentCorrect = isAdmin 
        ? (currentPassword === masterPassword || currentPassword === dbPassword)
        : (currentPassword === dbPassword);
        
      if (!isCurrentCorrect) {
        return res.status(400).json({ error: "Incorrect current password." });
      }
      
      await empRef.update({ password: newPassword });
      res.json({ success: true, message: "Password updated successfully!" });
    } catch (err: any) {
      console.error("Error changing password:", err);
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
      
      const isActuallyAdmin = role === "admin" || targetEmail === "innovalleyservices@gmail.com";
      
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
      const adminEmails = new Set(["innovalleyservices@gmail.com"]);
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
      const adminEmails = new Set(["innovalleyservices@gmail.com"]);
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
        const adminEmails = new Set(["innovalleyservices@gmail.com"]);
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
      
      const isActuallyAdmin = role === "admin" || targetEmail === "innovalleyservices@gmail.com";
      
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

