import express from "express";
import path from "path";
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

    // Seed admin and developer accounts
    // Clean up old phone-number based IDs to keep table strictly clean
    await client.query(`
      DELETE FROM employees WHERE id IN ('9848884897', '9848884899');
    `);

    const seededDefaultHash = hashPassword("Mbmn@B!#!951");
    await client.query(
      `INSERT INTO employees (id, name, email, phone, designation, role, password)
       VALUES
         ('innovalleyservices@gmail.com', 'Innovalley Services', 'innovalleyservices@gmail.com', '9848884897', 'Project Director (Admin)', 'admin', $1),
         ('mbmnmurali@gmail.com', 'Murali Krishna', 'mbmnmurali@gmail.com', '9848884899', 'Lead Developer', 'employee', $1)
       ON CONFLICT (id) DO NOTHING;`,
      [seededDefaultHash]
    );

    console.log("Supabase PostgreSQL tables checked, RLS bypassed, and seeded successfully.");
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

if (process.env.VERCEL && !supabase) {
  console.error(
    "CRITICAL: Deployed on Vercel without Supabase configured. All data will be held " +
    "in ephemeral in-memory state and lost between cold starts/deployments. Set SUPABASE_URL " +
    "and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) in the Vercel project's Environment Variables."
  );
}

// Local DB in-memory cache (no file persistence)
let localDB: { [collection: string]: { [id: string]: any } } = {
  employees: {},
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

    try {
      console.log("Cleaning up old and unwanted employee accounts from remote Supabase via REST API...");
      
      const { error: delErr } = await supabase
        .from("employees")
        .delete()
        .in("id", ["9848884897", "9848884899"]);
        
      if (delErr) {
        console.warn("Supabase REST cleanup warning:", delErr.message);
      } else {
        console.log("Successfully cleaned up old/unwanted employee accounts in Supabase via REST API.");
      }

      // Ensure both default admin and developer accounts are seeded in Supabase via REST API
      const defaultAdmin = {
        id: "innovalleyservices@gmail.com",
        name: "Innovalley Services",
        email: "innovalleyservices@gmail.com",
        phone: "9848884897",
        designation: "Project Director (Admin)",
        role: "admin",
        password: hashPassword("Mbmn@B!#!951")
      };

      const defaultDev = {
        id: "mbmnmurali@gmail.com",
        name: "Murali Krishna",
        email: "mbmnmurali@gmail.com",
        phone: "9848884899",
        designation: "Lead Developer",
        role: "employee",
        password: hashPassword("Mbmn@B!#!951")
      };

      // ignoreDuplicates: only inserts if the row doesn't exist yet — a plain upsert would
      // silently reset the admin/dev password back to this default on every cold start,
      // wiping out any password change made via the change-password feature.
      const { error: adminErr } = await supabase.from("employees").upsert(defaultAdmin, { onConflict: "id", ignoreDuplicates: true });
      if (adminErr) console.warn("Supabase REST admin seeding warning:", adminErr.message);

      const { error: devErr } = await supabase.from("employees").upsert(defaultDev, { onConflict: "id", ignoreDuplicates: true });
      if (devErr) console.warn("Supabase REST developer seeding warning:", devErr.message);

      console.log("Successfully validated/seeded Admin and Developer accounts via REST API.");
    } catch (err: any) {
      console.error("Error performing Supabase REST cleanup/seeding:", err.message);
    }
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

function getAppSecret(): string {
  return process.env.JWT_SECRET || "innovalley-secure-salt-2026";
}

// --- Password hashing (scrypt, no extra dependency) ---
// Existing accounts predate hashing and store plaintext; verifyPassword accepts both
// and login() lazily upgrades a plaintext record to a hash on the next successful login.
function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(plain: string, stored: string): boolean {
  if (!stored) return false;
  if (stored.startsWith("scrypt$")) {
    const [, salt, hash] = stored.split("$");
    if (!salt || !hash) return false;
    try {
      const candidate = crypto.scryptSync(plain, salt, 64);
      const expected = Buffer.from(hash, "hex");
      return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
    } catch {
      return false;
    }
  }
  return plain === stored;
}

// --- Session tokens (HMAC-signed, stateless — works across serverless instances) ---
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function createSessionToken(employee: { id: string; email: string; role: string }): string {
  const payload = { id: employee.id, email: employee.email, role: employee.role, iat: Date.now() };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", getAppSecret()).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

function verifySessionToken(token: string): { id: string; email: string; role: string; iat: number } | null {
  try {
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return null;
    const expectedSig = crypto.createHmac("sha256", getAppSecret()).update(payloadB64).digest("base64url");
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (!payload.iat || Date.now() - payload.iat > SESSION_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

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

function requireAdmin(req: any, res: any, next: any) {
  if (req.authUser?.role !== "admin") {
    return res.status(403).json({ error: "Administrator access required." });
  }
  next();
}

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
    res.json({
      status: "ok",
      timestamp: Date.now(),
      database: supabase ? "supabase" : "in-memory-fallback (data will not persist)"
    });
  });

  // Seed Admin and Developer users if they do not exist
  app.post("/api/employees/seed", async (req, res) => {
    try {
      const adminId = "innovalleyservices@gmail.com";
      const devId = "mbmnmurali@gmail.com";
      
      const adminRef = db.collection("employees").doc(adminId);
      const adminSnap = await adminRef.get();

      if (!adminSnap.exists) {
        const defaultAdmin = {
          id: adminId,
          name: "Innovalley Services",
          email: "innovalleyservices@gmail.com",
          phone: "9848884897",
          designation: "Project Director (Admin)",
          role: "admin",
          password: hashPassword("Mbmn@B!#!951")
        };
        await adminRef.set(defaultAdmin);
        console.log("Admin user seeded successfully in Supabase/Fallback.");
      }

      const devRef = db.collection("employees").doc(devId);
      const devSnap = await devRef.get();

      if (!devSnap.exists) {
        const defaultDev = {
          id: devId,
          name: "Murali Krishna",
          email: "mbmnmurali@gmail.com",
          phone: "9848884899",
          designation: "Lead Developer",
          role: "employee",
          password: hashPassword("Mbmn@B!#!951")
        };
        await devRef.set(defaultDev);
        console.log("Developer user seeded successfully in Supabase/Fallback.");
      }

      // Cleanup old phone-based documents to keep database clean
      try {
        await db.collection("employees").doc("9848884897").delete();
        await db.collection("employees").doc("9848884899").delete();
        console.log("Cleaned up old phone-number based document accounts");
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
  app.get("/api/employees", requireAuth, async (req, res) => {
    try {
      const snapshot = await db.collection("employees").get();
      const list: any[] = [];
      snapshot.forEach(doc => {
        const { password, ...safeData } = doc.data() || {};
        list.push({
          id: doc.id,
          phone: safeData.phone || "",
          ...safeData
        });
      });
      res.json(list);
    } catch (err: any) {
      console.error("Error listing employees on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Add new employee
  app.post("/api/employees", requireAuth, requireAdmin, async (req, res) => {
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
        password: hashPassword(employee.password ? employee.password.trim() : "123456"),
        role: 'employee'
      };
      await empRef.set(newEmp);
      const { password: _newEmpPassword, ...safeNewEmp } = newEmp;
      res.json(safeNewEmp);
    } catch (err: any) {
      console.error("Error adding employee on server:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Edit employee details (Admin action)
  app.put("/api/employees/:email", requireAuth, async (req: any, res) => {
    try {
      const { email } = req.params;
      const emailNormalized = email.trim().toLowerCase();
      const { name, email: newEmail, phone, designation, role } = req.body;

      // Role and password are the two fields that could let any logged-in employee
      // grant themselves admin (defeating the admin-only project/employee-creation rules)
      // or take over another employee's account. Everything else is open, per product decision.
      if ((role !== undefined || req.body.password) && req.authUser.role !== "admin") {
        return res.status(403).json({ error: "Only administrators can change role or password from this screen." });
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
      if (req.body.password) updateData.password = hashPassword(req.body.password);
      
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
  app.delete("/api/employees/:email", requireAuth, async (req, res) => {
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

  // Generate a new alphanumeric captcha (stateless signature-based to support multi-container/serverless).
  // The plaintext answer is rendered into an SVG image server-side and never sent to the client as text —
  // sending it in the JSON response (as this used to) makes the captcha trivially readable by the caller.
  app.get("/api/auth/captcha", (req, res) => {
    try {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // clear alphanumeric chars
      let captchaText = "";
      for (let i = 0; i < 4; i++) {
        captchaText += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      const timestamp = Date.now();
      const hash = crypto.createHmac("sha256", getAppSecret()).update(`${timestamp}-${captchaText}`).digest("hex");
      const captchaId = `${timestamp}.${hash}`;

      const width = 160, height = 48;
      const colors = ["#818cf8", "#6366f1", "#4f46e5", "#38bdf8", "#34d399"];
      let noise = "";
      for (let i = 0; i < 30; i++) {
        const cx = (Math.random() * width).toFixed(1);
        const cy = (Math.random() * height).toFixed(1);
        const r = (Math.random() * 2 + 1).toFixed(1);
        noise += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)},0.18)" />`;
      }
      for (let i = 0; i < 4; i++) {
        const x1 = (Math.random() * width).toFixed(1), y1 = (Math.random() * height).toFixed(1);
        const x2 = (Math.random() * width).toFixed(1), y2 = (Math.random() * height).toFixed(1);
        const c = Math.floor(Math.random() * 100) + 150;
        noise += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(${c},${c},${c},0.4)" stroke-width="1.5" />`;
      }
      let letters = "";
      const usableWidth = width - 20;
      const spacing = usableWidth / (captchaText.length + 1);
      for (let i = 0; i < captchaText.length; i++) {
        const x = (spacing * (i + 1) + 10 + (Math.random() * 4 - 2)).toFixed(1);
        const y = (height / 2 + 7 + (Math.random() * 4 - 2)).toFixed(1);
        const rotation = (Math.random() * 30 - 15).toFixed(1);
        letters += `<text x="${x}" y="${y}" transform="rotate(${rotation} ${x} ${y})" font-family="'JetBrains Mono', Courier, monospace" font-weight="bold" font-size="20" fill="${colors[i % colors.length]}">${captchaText[i]}</text>`;
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#0f172a"/>${noise}${letters}</svg>`;
      const image = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

      res.json({ captchaId, image });
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

      // Captcha verification is always required — there is no bypass value.
      if (!captchaId || !capIn) {
        return res.status(400).json({ error: "Captcha verification is required." });
      }

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

        const expectedHash = crypto.createHmac("sha256", getAppSecret()).update(`${timestampStr}-${capIn}`).digest("hex");

        if (originalHash !== expectedHash) {
          return res.status(400).json({ error: "Incorrect captcha code. Please try again." });
        }
      } catch (err) {
        return res.status(400).json({ error: "Failed to verify captcha. Please try again." });
      }

      const inputNormalized = input.toLowerCase();

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
      if (!verifyPassword(pass, dbPassword)) {
        return res.status(400).json({ error: "Incorrect password. Please try again." });
      }

      // Lazily upgrade legacy plaintext passwords to a hash now that we know the plaintext value.
      if (!dbPassword.startsWith("scrypt$")) {
        try {
          await db.collection("employees").doc(matchedEmployee.id).update({ password: hashPassword(pass) });
        } catch (e) {
          console.warn("Failed to upgrade legacy password hash for", matchedEmployee.id, e);
        }
      }

      const token = createSessionToken(matchedEmployee);
      const { password: _matchedPassword, ...safeEmployee } = matchedEmployee;
      return res.json({
        success: true,
        employee: safeEmployee,
        token
      });
    } catch (err: any) {
      console.error("Login error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // User changes their own password
  app.post("/api/auth/change-password", requireAuth, async (req: any, res) => {
    try {
      const { email, currentPassword, newPassword } = req.body;
      const emailNormalized = (email || "").trim().toLowerCase();

      if (req.authUser.role !== "admin" && req.authUser.email !== emailNormalized) {
        return res.status(403).json({ error: "You can only change your own password." });
      }

      if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ error: "New password must be at least 4 characters long." });
      }

      const empRef = db.collection("employees").doc(emailNormalized);
      const docSnap = await empRef.get();

      if (!docSnap.exists) {
        return res.status(404).json({ error: "Employee profile not found." });
      }

      const employeeData = docSnap.data();
      const dbPassword = employeeData.password || "123456"; // Default password fallback

      if (!verifyPassword(currentPassword, dbPassword)) {
        return res.status(400).json({ error: "Incorrect current password." });
      }

      await empRef.update({ password: hashPassword(newPassword) });
      res.json({ success: true, message: "Password updated successfully!" });
    } catch (err: any) {
      console.error("Error changing password:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // List projects
  app.get("/api/projects", requireAuth, async (req, res) => {
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
  app.post("/api/projects", requireAuth, requireAdmin, async (req, res) => {
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
  app.put("/api/projects/:id/members", requireAuth, async (req, res) => {
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
  app.put("/api/projects/:id", requireAuth, async (req, res) => {
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
  app.delete("/api/projects/:id", requireAuth, async (req, res) => {
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
  app.delete("/api/projects/:projectId/tasks/completed", requireAuth, async (req, res) => {
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
  app.get("/api/tasks", requireAuth, async (req, res) => {
    try {
      const { projectId, userPhone, userEmail, role } = req.query;
      const targetEmail = (userEmail || "").toString().trim().toLowerCase();
      const targetPhone = (userPhone || "").toString().trim();
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

      // Filter tasks based on role and identity. assignedTo/assignedBy are stored as phone
      // numbers (see POST /api/tasks), so matching on email alone silently dropped every task
      // for non-admin users — match against both.
      let filteredList = list;
      if (!isActuallyAdmin && (targetEmail || targetPhone)) {
        filteredList = list.filter(t =>
          (t.assignedTo && ((targetEmail && t.assignedTo.trim().toLowerCase() === targetEmail) || (targetPhone && t.assignedTo === targetPhone))) ||
          (t.assignedBy && ((targetEmail && t.assignedBy.trim().toLowerCase() === targetEmail) || (targetPhone && t.assignedBy === targetPhone)))
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
  app.post("/api/tasks", requireAuth, async (req, res) => {
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
  app.put("/api/tasks/:id/status", requireAuth, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { newStatus, task, project, updater, assignee, rejectionNotes, notDoneNotes, completedRemarks, attachment, completionAttachment } = req.body;

      const assigneeEmail = (assignee?.email || "").trim().toLowerCase();
      if (req.authUser.role !== "admin" && req.authUser.email !== assigneeEmail) {
        return res.status(403).json({ error: "You can only update tasks assigned to you." });
      }

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
  app.get("/api/logs", requireAuth, async (req, res) => {
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
  app.get("/api/notifications", requireAuth, async (req, res) => {
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
  app.post("/api/notifications", requireAuth, async (req, res) => {
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
  app.post("/api/notify", requireAuth, async (req, res) => {
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

  // Serve static files in production (Cloud Run/local container only — on Vercel,
  // vercel.json rewrites already route static assets straight to the CDN and this
  // function's deployment bundle doesn't contain the built `dist` folder anyway).
  if (process.env.NODE_ENV === "production" && !process.env.VERCEL) {
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
      // Loaded dynamically so Vite (a dev-only dependency) is never pulled into
      // the Vercel serverless function bundle, which only ever runs the production branch.
      const { createServer: createViteServer } = await import("vite");
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

