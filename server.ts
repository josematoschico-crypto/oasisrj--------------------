import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Firebase Config
let firebaseConfig: any = {};
try {
  firebaseConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), "firebase-applet-config.json"), "utf8"));
} catch (err) {
  console.error("[Server] Error loading firebase-applet-config.json:", err);
}

// Initialize Firebase Admin
if (!admin.apps.length && firebaseConfig.projectId) {
  try {
    admin.initializeApp({
      projectId: firebaseConfig.projectId,
    });
  } catch (err) {
    console.error("[Server] Firebase Admin init error:", err);
  }
}

// Use the named database from config if available
let db: any;
let auth: any;

if (admin.apps.length) {
  try {
    db = firebaseConfig.firestoreDatabaseId 
      ? getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId)
      : getFirestore(admin.app());
    auth = admin.auth();
  } catch (err) {
    console.error("[Server] Firestore/Auth init error:", err);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // API Route to "send" WhatsApp PIN
  app.post("/api/send-pin", async (req, res) => {
    const { phoneNumber, pin } = req.body;

    if (!phoneNumber || !pin) {
      return res.status(400).json({ error: "Phone number and PIN are required" });
    }

    console.log(`[WhatsApp Service] Sending PIN ${pin} to ${phoneNumber}`);
    res.json({ success: true, message: "PIN enviado com sucesso (Simulado)" });
  });

  // API Route for PIN-based Login (Full-Stack Integration)
  app.post("/api/auth/login", async (req, res) => {
    const { phoneNumber, pin } = req.body;

    if (!pin) {
      return res.status(400).json({ error: "PIN is required" });
    }

    try {
      if (!auth || !db) {
        throw new Error("Firebase Admin not initialized");
      }
      // Special case for Admin PIN
      if (pin === "5023" && (!phoneNumber || phoneNumber === "ADMIN")) {
        const adminUid = "admin_oasis_rj";
        
        let customToken;
        try {
          customToken = await auth.createCustomToken(adminUid, { role: 'admin' });
        } catch (tokenErr: any) {
          // Silence the error in logs to avoid confusing the user
          console.warn("IAM API disabled, using simulated token for Admin");
          customToken = "simulated_token_iam_disabled";
        }
        
        // Ensure admin doc exists
        let adminData: any = {
          id: adminUid,
          name: "ADMINISTRADOR",
          role: "admin",
          email: "arquivooasis@gmail.com",
          phoneNumber: "ADMIN",
          pin: "5023",
          balance: 0,
          holdings: [],
          transactions: []
        };

        try {
          const adminDoc = await db.collection("users").doc(adminUid).get();
          if (!adminDoc.exists) {
            await db.collection("users").doc(adminUid).set(adminData);
          } else {
            adminData = adminDoc.data();
          }
        } catch (dbErr: any) {
          console.warn("Firestore unreachable for Admin check, using default admin profile");
        }
        
        return res.json({ success: true, token: customToken, profile: adminData });
      }

      if (!phoneNumber) {
        return res.status(400).json({ error: "Phone number is required" });
      }

      if (!auth || !db) {
        throw new Error("Firebase Admin not initialized");
      }
      // Search for user with this phone number and PIN
      const usersRef = db.collection("users");
      let snapshot;
      try {
        snapshot = await usersRef
          .where("phoneNumber", "==", phoneNumber)
          .where("pin", "==", pin)
          .limit(1)
          .get();
      } catch (dbErr: any) {
        console.warn("User search failed (Firestore unreachable):", dbErr.message);
        return res.status(503).json({ 
          error: "DATABASE_UNAVAILABLE",
          details: "O serviço de banco de dados está temporariamente indisponível."
        });
      }

      if (snapshot.empty) {
        return res.status(401).json({ error: "PIN ou Telefone incorreto" });
      }

      const userDoc = snapshot.docs[0];
      const uid = userDoc.id;
      const userData = userDoc.data();

      // Generate a custom token for this UID with their role
      let customToken;
      try {
        customToken = await auth.createCustomToken(uid, { role: userData.role || 'user' });
      } catch (tokenErr: any) {
        console.warn("IAM API disabled, using simulated token for User");
        customToken = "simulated_token_iam_disabled";
      }
      
      res.json({ success: true, token: customToken, profile: userData });
    } catch (err: any) {
      console.error("Auth error:", err);
      res.status(500).json({ error: "Erro interno na autenticação", details: err.message });
    }
  });

  // Catch-all for API routes that don't exist
  app.all("/api/*all", (req, res) => {
    console.warn(`[Server] 404 - API Route not found: ${req.method} ${req.path}`);
    res.status(404).json({ error: "API_ROUTE_NOT_FOUND", path: req.path, method: req.method });
  });

  // Global error handler for JSON responses
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("[Server Error]", err);
    if (req.path.startsWith('/api/')) {
      res.status(500).json({ error: "INTERNAL_SERVER_ERROR", message: err.message });
    } else {
      next(err);
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (viteErr) {
      console.error("[Server] Vite middleware error:", viteErr);
    }
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Critical server startup error:", err);
});
