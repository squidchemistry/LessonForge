// Imported first so env vars exist before any other module reads them (ES imports are hoisted).
// On hosting platforms, real environment variables are used and the .env file simply doesn't exist.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });
