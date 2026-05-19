Turbo backend setup:
1) Upload this backend folder to Render/Railway/Vercel.
2) Install dependencies: npm install
3) Start: npm start
4) Backend URL for extension:
   Local: http://localhost:3000/convert
   Render/Railway: https://your-app.onrender.com/convert
   Vercel serverless: https://your-app.vercel.app/api/convert

Why backend helps:
- Page image extraction happens on server.
- Browser does not open temporary tabs.
- Direct image links still remain fastest.
