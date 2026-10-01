SOCOM Scheduler - Vercel fix

1. Replace your old server.js and package.json with these files.
2. Keep your existing public/ folder.
3. Run:
   npm install
   npm install @vercel/blob@2.4.0
   npm start
4. Commit the updated package-lock.json too.
5. Push to GitHub.
6. In Vercel, connect a PRIVATE Blob store to the project. This provides BLOB_READ_WRITE_TOKEN.
7. Add these Vercel Environment Variables:
   ADMIN_PASSWORD
   SESSION_SECRET
   CRON_SECRET
8. Redeploy.

Do NOT commit data/db.json, .env, node_modules, or secrets.

The new server keeps local data/db.json when running locally, but uses private Vercel Blob in Vercel. It also replaces the old setInterval scheduler with a Vercel Cron endpoint.
