import express from 'express';
import cors from 'cors';
import { convertHandler } from './api/convert.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.post('/convert', convertHandler);
app.get('/', (req,res)=>res.json({ ok:true, message:'WebP CDN Source Maker backend is running. Use POST /convert' }));
const port = process.env.PORT || 3000;
app.listen(port, ()=>console.log('Backend running on port', port));
