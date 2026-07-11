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

    console.log("Supabase PostgreSQL tables checked and created successfully.");
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


// Initialize Supabase clients
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

// Service-role client for admin operations and JWT verification
let supabaseAdmin: any = null;
if (supabaseUrl && supabaseServiceRoleKey) {
  try {
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false }
    });
    console.log("Supabase admin client initialized.");
  } catch (err) {
    console.error("Failed to initialize Supabase admin client:", err);
  }
}

// Keep module-level supabase for backwards compatibility with existing code
const supabase = supabaseAdmin;

if (process.env.VERCEL && !supabaseAdmin) {
  console.error(
    "CRITICAL: Deployed on Vercel without Supabase configured. Set SUPABASE_URL " +
    "and SUPABASE_SERVICE_ROLE_KEY in Vercel Environment Variables."
  );
}

// DBWrapper: Supabase-only, no fallback. Fails fast if DB not configured.
class DBWrapper {
  collection(name: string) {
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
        if (error) throw error;

        const docs = (data || []).map((item: any) => ({
          id: item.id || "",
          data: () => item
        }));

        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
          forEach(callback: (doc: any) => void) {
            docs.forEach(doc => callback(doc));
          }
        };
      }
    }

    return {
      doc(docId?: string) {
        const id = docId || crypto.randomUUID();
        return {
          id,
          async get() {
            const { data, error } = await supabase.from(name).select("*").eq("id", id).maybeSingle();
            if (error) throw error;
            return {
              exists: !!data,
              id,
              data: () => data || null
            };
          },

          async set(data: any, options?: { merge?: boolean }) {
            const isMerge = options?.merge === true;
            let finalData = { ...data };

            if (isMerge) {
              const { data: existing } = await supabase.from(name).select("*").eq("id", id).maybeSingle();
              if (existing) {
                finalData = { ...existing, ...data };
              }
            }

            const { error } = await supabase.from(name).upsert({ id, ...finalData });
            if (error) throw error;
          },

          async update(data: any) {
            const { error } = await supabase.from(name).update(data).eq("id", id);
            if (error) throw error;
          },

          async delete() {
            const { error } = await supabase.from(name).delete().eq("id", id);
            if (error) throw error;
          }
        };
      },

      async add(data: any) {
        const id = crypto.randomUUID();
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

async function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Missing authorization token." });
  }

  try {
    // Verify Supabase JWT
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

    // Attach user info for route handlers
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
      const { name, email, phone, designation, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
      }

      const emailTrimmed = email.trim().toLowerCase();
      const passwordTrimmed = password.trim();

      // Create Supabase Auth user (service-role only)
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: emailTrimmed,
        password: passwordTrimmed,
        email_confirm: true
      });

      if (authError) {
        if (authError.message?.includes("already registered")) {
          return res.status(400).json({ error: "Employee with this email already exists." });
        }
        return res.status(400).json({ error: authError.message });
      }

      // Create employee profile row with UUID from auth user
      const { error: profileError } = await supabaseAdmin
        .from('employees')
        .insert({
          id: authData.user.id,
          name: name?.trim() || "",
          email: emailTrimmed,
          phone: phone?.trim() || null,
          designation: designation?.trim() || null,
          role: 'employee'
        });

      if (profileError) {
        return res.status(400).json({ error: profileError.message });
      }

      res.json({ success: true, message: "Employee created successfully." });
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

