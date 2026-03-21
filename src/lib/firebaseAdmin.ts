import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";
import { env } from "../env.js";

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

function loadServiceAccount(): ServiceAccount {
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
  }
  if (env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const projectRoot = path.resolve(moduleDir, "..", "..");
    const accountPath = env.FIREBASE_SERVICE_ACCOUNT_PATH;
    const resolvedPath = path.isAbsolute(accountPath)
      ? accountPath
      : path.resolve(projectRoot, accountPath);
    const raw = readFileSync(resolvedPath, "utf8");
    return JSON.parse(raw) as ServiceAccount;
  }
  throw Object.assign(new Error("firebase_admin_not_configured"), { statusCode: 501 });
}

export function getFirebaseAdminAuth() {
  if (!admin.apps.length) {
    const serviceAccount = loadServiceAccount();
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as any)
    });
  }
  return admin.auth();
}
